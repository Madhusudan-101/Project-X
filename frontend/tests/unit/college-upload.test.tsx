import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadCsvDialog } from "@/components/college/UploadCsvDialog";
import {
  assertCsvUploadResult,
  CsvUploadError,
  studentsService,
} from "@/services/api/college/college";
import { useCollegeDemoStore } from "@/store/demo/collegeDemo";
import type { CsvUploadResult } from "@/types/college/college";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const summary = (over: Partial<CsvUploadResult> = {}): CsvUploadResult => ({
  message: "Students uploaded successfully",
  addedStudents: 3,
  created: 2,
  updated: 1,
  unchanged: 4,
  warnings: [],
  warningsTotal: 0,
  planId: "plan-abc",
  dryRun: false,
  students: [],
  ...over,
});

const csv = (text: string, name = "roster.csv") => new File([text], name, { type: "text/csv" });

describe("assertCsvUploadResult — the client never trusts an unexpected response", () => {
  it("accepts a well-formed preview and a well-formed import", () => {
    expect(assertCsvUploadResult(summary({ dryRun: true }), true).created).toBe(2);
    expect(assertCsvUploadResult(summary(), false).unchanged).toBe(4);
  });

  it.each([
    ["an old server without counts", { message: "ok", addedStudents: 2, students: [] }],
    ["negative counts", { ...summary(), created: -1 }],
    ["a non-numeric count", { ...summary(), updated: "2" }],
    ["missing warnings", { ...summary(), warnings: undefined }],
    ["missing warning total", { ...summary(), warningsTotal: undefined }],
    ["missing plan id", { ...summary(), planId: undefined }],
    ["an empty plan id", { ...summary(), planId: "" }],
    ["null", null],
  ])("rejects %s", (_label, body) => {
    expect(() => assertCsvUploadResult(body, false)).toThrow(CsvUploadError);
  });

  it("words the failure for the mode: a preview saved nothing, a real import may have saved something", () => {
    const message = (dryRun: boolean) => {
      try {
        assertCsvUploadResult({ message: "ok" }, dryRun);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    expect(message(true)).toMatch(/No students were changed by this preview/);
    expect(message(false)).toMatch(/may have been saved/);
    expect(message(false)).not.toMatch(/No students were changed/);
  });

  it("rejects a response whose dryRun flag does not match the request (a preview must be a preview)", () => {
    expect(() => assertCsvUploadResult(summary({ dryRun: false }), true)).toThrow(CsvUploadError);
    expect(() => assertCsvUploadResult(summary({ dryRun: true }), false)).toThrow(CsvUploadError);
  });
});

describe("live studentsService.uploadCsv", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("sends ?dryRun=true for a preview and no query for the real import", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(summary({ dryRun: true })))
      .mockResolvedValueOnce(json(summary()));
    vi.stubGlobal("fetch", f);
    await studentsService.uploadCsv(csv("a"), { dryRun: true });
    await studentsService.uploadCsv(csv("a"));
    expect(String(f.mock.calls[0][0])).toMatch(/\/api\/students\/upload\?dryRun=true$/);
    expect(String(f.mock.calls[1][0])).toMatch(/\/api\/students\/upload$/);
  });

  it("surfaces the invalid rows of a rejected file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            detail: {
              message: "CSV file has missing or invalid required fields",
              invalidRows: [{ line: 3, missing: ["email"], row: {} }],
            },
          },
          400,
        ),
      ),
    );
    await expect(studentsService.uploadCsv(csv("a"), { dryRun: true })).rejects.toMatchObject({
      status: 400,
      invalidRows: [{ line: 3, missing: ["email"] }],
    });
  });

  it("treats a 200 with an unreadable body as a failure, never as a successful preview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(studentsService.uploadCsv(csv("a"), { dryRun: true })).rejects.toBeInstanceOf(
      CsvUploadError,
    );
  });
});

describe("UploadCsvDialog (live service mocked at the network edge)", () => {
  const user = userEvent.setup({ applyAccept: false });
  let fetchMock: ReturnType<typeof vi.fn>;

  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const deferred = () => {
    let resolve!: (r: Response) => void;
    const promise = new Promise<Response>((res) => (resolve = res));
    return { promise, resolve };
  };
  const uploadCalls = (dryRun: boolean) =>
    fetchMock.mock.calls.filter(
      ([url]) =>
        String(url).includes("/api/students/upload") === true &&
        String(url).includes("dryRun=true") === dryRun,
    );

  async function openAndChoose(file: File, onUploaded = vi.fn()) {
    render(<UploadCsvDialog onUploaded={onUploaded} />);
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.upload(screen.getByLabelText("Roster CSV file"), file);
    return onUploaded;
  }

  beforeEach(() => {
    toast.success.mockReset();
    toast.error.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("previews the counts without importing, then imports exactly once on confirm", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true })))
      .mockResolvedValueOnce(respond(summary()));
    const onUploaded = await openAndChoose(csv("name,email,branch,graduationYear\n"));

    await user.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Will be added")).toBeInTheDocument();
    expect(screen.getByText("Will be updated")).toBeInTheDocument();
    expect(screen.getByText("Already up to date")).toBeInTheDocument();
    expect(screen.getByText(/nothing has been saved/i)).toBeInTheDocument();
    expect(uploadCalls(false)).toHaveLength(0);
    expect(onUploaded).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm import \(3 students\)/i }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(uploadCalls(true)).toHaveLength(1);
    expect(uploadCalls(false)).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith(
      "Students uploaded successfully",
      expect.objectContaining({ description: "2 added, 1 updated, 4 unchanged." }),
    );
  });

  it("cancelling after a preview imports nothing", async () => {
    fetchMock.mockResolvedValueOnce(respond(summary({ dryRun: true })));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByText("Will be added");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("Upload student roster")).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadCalls(false)).toHaveLength(0);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows actionable row errors for a rejected file and offers no way to confirm", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(
        {
          detail: {
            message: "CSV file has missing or invalid required fields",
            invalidRows: [
              { line: 2, missing: ["email"], row: {} },
              { line: 5, missing: ["name", "graduationYear"], row: {} },
            ],
          },
        },
        400,
      ),
    );
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("CSV file has missing or invalid required fields");
    expect(alert).toHaveTextContent("Line 2: missing or invalid email");
    expect(alert).toHaveTextContent("Line 5: missing or invalid name, graduationYear");
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(uploadCalls(false)).toHaveLength(0);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("a failed or unexpected preview never proceeds as a successful import", async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ message: "ok", addedStudents: 2, students: [] })) // old server: no counts
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onUploaded = await openAndChoose(csv("x"));

    await user.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/unexpected response/i);
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(uploadCalls(false)).toHaveLength(0);
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("rejects an empty file and a non-CSV file before any request", async () => {
    await openAndChoose(csv("", "empty.csv"));
    expect(screen.getByRole("alert")).toHaveTextContent("This file is empty.");
    expect(screen.getByRole("button", { name: "Check file" })).toBeDisabled();

    await user.upload(screen.getByLabelText("Roster CSV file"), csv("a,b", "notes.txt"));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a .csv file.");
    expect(screen.getByRole("button", { name: "Check file" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables confirm when the file would change nothing", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(summary({ dryRun: true, created: 0, updated: 0, unchanged: 5 })),
    );
    await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText(/nothing to import/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm import/i })).toBeDisabled();
  });

  it("lists values that will be ignored instead of hiding them", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(
        summary({
          dryRun: true,
          warnings: [
            {
              line: 4,
              column: "placementStatus",
              value: "hired",
              reason: "must be one of not_placed, offer_declined, placed",
            },
            {
              line: 6,
              column: "email",
              value: "a@x.com",
              reason: "repeats line 2 with the same values — counted once",
            },
          ],
          warningsTotal: 25,
        }),
      ),
    );
    await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    expect(
      await screen.findByText(/Line 4, placementStatus: "hired" — must be one of/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Line 6, email: "a@x.com" — repeats line 2 with the same values/),
    ).toBeInTheDocument();
    expect(screen.getByText("…and 23 more.")).toBeInTheDocument(); // never silently truncated
  });

  it("blocks duplicate submissions while a check or an import is running", async () => {
    const check = deferred();
    const send = deferred();
    fetchMock.mockReturnValueOnce(check.promise).mockReturnValueOnce(send.promise);
    await openAndChoose(csv("x"));

    const checkBtn = screen.getByRole("button", { name: "Check file" });
    await user.dblClick(checkBtn);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /checking/i })).toBeDisabled();
    await act(async () => check.resolve(respond(summary({ dryRun: true }))));

    const confirm = await screen.findByRole("button", { name: /confirm import/i });
    await user.dblClick(confirm);
    expect(uploadCalls(false)).toHaveLength(1);
    expect(await screen.findByRole("button", { name: /importing/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => send.resolve(respond(summary())));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(uploadCalls(false)).toHaveLength(1);
  });

  it("an unreadable reply to the real import does not claim that nothing changed, and reloads the roster", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true })))
      .mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/may have been saved/);
    expect(alert).not.toHaveTextContent(/No students were changed/);
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled(); // an unreadable reply is never reported as a success
    expect(screen.getByText("Upload student roster")).toBeInTheDocument(); // the dialog stays open
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
  });

  it("a failed preview does not reload the roster (nothing could have changed)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByText("Failed to fetch");
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("a failed import reports the error, keeps the dialog open and requires a fresh preview", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true })))
      .mockResolvedValueOnce(respond({ detail: "Insert failed: numeric field overflow" }, 400));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Insert failed: numeric field overflow",
    );
    expect(toast.error).toHaveBeenCalledWith("Import failed");
    // Earlier batches of a failed import may already be saved, so the roster behind the dialog is reloaded.
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled(); // a failed import is never reported as a success
    expect(screen.getByText("Upload student roster")).toBeInTheDocument(); // the dialog stays open
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check file" })).toBeEnabled();
  });

  it("confirming sends the plan that was previewed, so the server can refuse a stale one", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true, planId: "plan-xyz" })))
      .mockResolvedValueOnce(respond(summary({ planId: "plan-xyz" })));
    await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\?dryRun=true$/);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\?expectedPlan=plan-xyz$/);
  });

  it("a preview that went stale (the server answers 409) is not imported, says so, clears the preview and reloads the roster", async () => {
    fetchMock.mockResolvedValueOnce(respond(summary({ dryRun: true }))).mockResolvedValueOnce(
      respond(
        {
          detail: {
            message:
              "The file or the roster has changed since the preview, so nothing was imported.",
          },
        },
        409,
      ),
    );
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed since the preview, so nothing was imported/,
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check file" })).toBeEnabled(); // check again to see the current result
  });

  it("shows which lines repeat a student with different values and offers no way to import", async () => {
    fetchMock.mockResolvedValueOnce(
      respond(
        {
          detail: {
            message:
              "CSV file repeats an email with different values — fix it so each student appears once",
            duplicates: [
              { email: "ann@x.com", lines: [2, 5], conflicts: ["name", "employabilityScore"] },
            ],
          },
        },
        400,
      ),
    );
    await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Lines 2, 5 all use ann@x.com but disagree on name, employabilityScore",
    );
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
  });

  it("choosing a different file after a preview discards the preview, so it can never be confirmed for the wrong file", async () => {
    fetchMock.mockResolvedValueOnce(respond(summary({ dryRun: true })));
    await openAndChoose(csv("first"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByRole("button", { name: /confirm import/i });

    await user.upload(screen.getByLabelText("Roster CSV file"), csv("second", "other.csv"));
    expect(screen.queryByText("Will be added")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check file" })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cannot be closed with Escape while a check or an import is running", async () => {
    const check = deferred();
    const send = deferred();
    fetchMock.mockReturnValueOnce(check.promise).mockReturnValueOnce(send.promise);
    await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByRole("button", { name: /checking/i });
    await user.keyboard("{Escape}");
    expect(screen.getByText("Upload student roster")).toBeInTheDocument();

    await act(async () => check.resolve(respond(summary({ dryRun: true }))));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));
    await screen.findByRole("button", { name: /importing/i });
    await user.keyboard("{Escape}");
    expect(screen.getByText("Upload student roster")).toBeInTheDocument(); // the import may be writing
    await act(async () => send.resolve(respond(summary())));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it("two clicks that land before the screen re-renders start only one request (the in-flight guard)", async () => {
    const check = deferred();
    const send = deferred();
    fetchMock.mockReturnValueOnce(check.promise).mockReturnValueOnce(send.promise);
    await openAndChoose(csv("x"));

    const checkBtn = screen.getByRole("button", { name: "Check file" });
    await act(async () => {
      checkBtn.click();
      checkBtn.click(); // same tick: the button is not disabled yet
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => check.resolve(respond(summary({ dryRun: true }))));

    const confirm = await screen.findByRole("button", { name: /confirm import/i });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(uploadCalls(false)).toHaveLength(1);
    await act(async () => send.resolve(respond(summary())));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(uploadCalls(false)).toHaveLength(1);
  });

  it("a dropped connection during the real import is reported as an unknown outcome, never as success or as nothing saved", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true })))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/unknown whether the import was applied/);
    expect(alert).not.toHaveTextContent(/nothing was saved|No students were changed/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("a server error that does not say what was saved is described as unknown, and the roster is reloaded", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true })))
      .mockResolvedValueOnce(respond({ detail: "Bad Gateway" }, 502));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bad Gateway");
    expect(alert).toHaveTextContent(/result of the import is unknown/);
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it("a partial failure shows the server's exact account of what was and was not saved", async () => {
    const message =
      "The import stopped part-way: 1 of 2 changed students were saved before the database refused the next batch (numeric field overflow). Upload the same file again to finish — students already saved will show as unchanged.";
    fetchMock
      .mockResolvedValueOnce(respond(summary({ dryRun: true })))
      .mockResolvedValueOnce(respond({ detail: { message, saved: 1, notSaved: 1 } }, 400));
    const onUploaded = await openAndChoose(csv("x"));
    await user.click(screen.getByRole("button", { name: "Check file" }));
    await user.click(await screen.findByRole("button", { name: /confirm import/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledTimes(1); // the saved student must show up in the table
  });
});

describe("UploadCsvDialog in Demo Mode — same workflow, no network, no live API", () => {
  const user = userEvent.setup({ applyAccept: false });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.pushState({}, "", "/demo/college/students");
    sessionStorage.clear();
    useCollegeDemoStore.getState().reset();
    fetchMock = vi.fn(() => {
      throw new Error("the demo must never reach the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    return () => window.history.pushState({}, "", "/");
  });

  it("previews against the fictional roster without changing it, then applies on confirm", async () => {
    const existing = useCollegeDemoStore.getState().data.students[0];
    const before = JSON.stringify(useCollegeDemoStore.getState().data);
    const onUploaded = vi.fn();
    render(<UploadCsvDialog onUploaded={onUploaded} />);
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.upload(
      screen.getByLabelText("Roster CSV file"),
      csv(
        `name,email,branch,graduationYear\n${existing.name} Renamed,${existing.email},${existing.branch},${existing.graduation_year}\nNew Demo,new.demo@example.test,IT,2027\n`,
      ),
    );

    await user.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByText("Will be added", {}, { timeout: 3000 });
    const counts = screen.getByText("Will be added").previousSibling;
    expect(counts).toHaveTextContent("1");
    expect(JSON.stringify(useCollegeDemoStore.getState().data)).toBe(before); // preview wrote nothing
    expect(onUploaded).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm import \(2 students\)/i }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1), { timeout: 3000 });
    const after = useCollegeDemoStore.getState().data.students;
    const updated = after.find((s) => s.id === existing.id)!;
    expect(updated.name).toBe(`${existing.name} Renamed`);
    expect(updated.placement_status).toBe(existing.placement_status); // omitted columns survive
    expect(updated.employability_score).toBe(existing.employability_score);
    expect(after.some((s) => s.email === "new.demo@example.test")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the same row errors for an invalid file and leaves the roster alone", async () => {
    const before = JSON.stringify(useCollegeDemoStore.getState().data);
    render(<UploadCsvDialog onUploaded={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /upload csv/i }));
    await user.upload(
      screen.getByLabelText("Roster CSV file"),
      csv("name,email,branch,graduationYear\n,missing@example.test,CSE,2027\n"),
    );
    await user.click(screen.getByRole("button", { name: "Check file" }));
    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert).toHaveTextContent("Line 2: missing or invalid name");
    expect(screen.queryByRole("button", { name: /confirm import/i })).not.toBeInTheDocument();
    expect(JSON.stringify(useCollegeDemoStore.getState().data)).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
