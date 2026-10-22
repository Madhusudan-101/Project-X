import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformPanel } from "@/components/college/PlatformPanel";
import { useCollegeDemoStore } from "@/store/demo/collegeDemo";
import type { PlatformOverview } from "@/types/college/college";

const overview = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/college/college", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api/college/college")>();
  // Only the live/demo switch is replaced: demo-mode tests below use the real service by restoring the original.
  return {
    ...actual,
    platformService: new Proxy(actual.platformService, {
      get: (target, prop) =>
        prop === "overview" && !window.location.pathname.startsWith("/demo/")
          ? overview
          : Reflect.get(target, prop),
    }),
  };
});

const data = (over: Partial<PlatformOverview> = {}): PlatformOverview => ({
  drives: [
    {
      id: "d1",
      jobTitle: "Software Engineer",
      companyName: "Acme",
      location: "Pune",
      employmentType: "full-time",
      status: "live",
      isOnCampus: true,
      applyDeadline: "2030-01-10T00:00:00+00:00",
      eligibility: { minCgpa: 7.5, branches: ["CSE"], batchYears: [2026] },
      rounds: [
        { number: 1, type: "tech", mode: "ai", windowStart: null, windowEnd: null },
        { number: 2, type: "hr", mode: "live", windowStart: null, windowEnd: null },
      ],
      funnel: {
        applicants: 3,
        inProgress: 1,
        shortlisted: 1,
        inInterview: 0,
        selected: 1,
        rejected: 0,
      },
    },
    {
      id: "d2",
      jobTitle: "QA Analyst",
      companyName: "Globex",
      location: "Remote",
      employmentType: "internship",
      status: "closed",
      isOnCampus: false,
      applyDeadline: "2029-01-01T00:00:00+00:00",
      eligibility: { minCgpa: null, branches: [], batchYears: [] },
      rounds: [],
      funnel: {
        applicants: 0,
        inProgress: 0,
        shortlisted: 0,
        inInterview: 0,
        selected: 0,
        rejected: 0,
      },
    },
  ],
  students: [
    {
      studentId: "s1",
      name: "Asha A",
      email: "asha@a.edu",
      branch: "CSE",
      graduationYear: 2026,
      placementStatus: "not_placed",
      selectedOnPlatform: true,
      rosterNeedsReview: true,
      applications: [
        {
          driveId: "d1",
          jobTitle: "Software Engineer",
          companyName: "Acme",
          status: "hired",
          appliedAt: "2029-12-10T00:00:00+00:00",
          rounds: [
            { number: 1, type: "tech", mode: "ai", status: "shortlisted" },
            { number: 2, type: "hr", mode: "live", status: "shortlisted" },
          ],
        },
      ],
    },
    {
      studentId: "s2",
      name: "Ben B",
      email: "ben@a.edu",
      branch: "IT",
      graduationYear: 2026,
      placementStatus: "placed",
      selectedOnPlatform: false,
      rosterNeedsReview: false,
      applications: [
        {
          driveId: "d1",
          jobTitle: "Software Engineer",
          companyName: "Acme",
          status: "shortlisted",
          appliedAt: "2029-12-11T00:00:00+00:00",
          rounds: [{ number: 1, type: "tech", mode: "ai", status: "pending" }],
        },
      ],
    },
  ],
  studentsOnPlatform: 2,
  totals: { applications: 2, selected: 1, needsRosterUpdate: 1 },
  ...over,
});

const user = userEvent.setup();

beforeEach(() => {
  overview.mockReset();
  window.history.pushState({}, "", "/college/drives");
});

describe("PlatformPanel (live service mocked)", () => {
  it("shows the drives with their rounds and funnel, and the students with their application and round progress", async () => {
    overview.mockResolvedValue(data());
    render(<PlatformPanel />);

    const drives = await screen.findByRole("table", { name: "Platform drives at your college" });
    const acme = within(drives).getByText("Acme").closest("tr")!;
    expect(acme).toHaveTextContent("Software Engineer · Pune · On campus");
    expect(acme).toHaveTextContent("Live");
    expect(acme).toHaveTextContent("Tech (AI) → Hr (live)");
    expect(acme).toHaveTextContent("3 applied · 1 in progress");
    expect(acme).toHaveTextContent("1 selected · 0 not selected");
    expect(within(drives).getByText("Globex").closest("tr")).toHaveTextContent("Closed");

    const students = screen.getByRole("table", { name: "Your students' platform applications" });
    const asha = within(students).getByText("Asha A").closest("tr")!;
    expect(asha).toHaveTextContent("Not placed");
    expect(asha).toHaveTextContent("Selected on platform — review");
    expect(asha).toHaveTextContent("Software Engineer");
    expect(asha).toHaveTextContent("Selected");
    expect(asha).toHaveTextContent("Round 1 passed · Round 2 passed");
    expect(within(students).getByText("Ben B").closest("tr")).toHaveTextContent("Round 1 pending");
    expect(within(students).getByText("Ben B").closest("tr")).not.toHaveTextContent("review");
  });

  it("explains a roster mismatch and says it never changes the roster", async () => {
    overview.mockResolvedValue(data());
    render(<PlatformPanel />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent(
      /1 student was selected on the platform but isn't marked Placed/,
    );
    expect(note).toHaveTextContent(/nothing here changes your roster/);

    overview.mockResolvedValue(
      data({ totals: { applications: 2, selected: 1, needsRosterUpdate: 3 } }),
    );
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(await screen.findByText(/3 students were selected/)).toBeInTheDocument();
  });

  it("says plainly when no company has opened a drive here", async () => {
    overview.mockResolvedValue({
      drives: [],
      students: [],
      studentsOnPlatform: 0,
      totals: { applications: 0, selected: 0, needsRosterUpdate: 0 },
    });
    render(<PlatformPanel />);
    expect(
      await screen.findByText(/No company has opened a drive for your college/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says why a student is missing when none of the roster has applied", async () => {
    overview.mockResolvedValue(
      data({
        students: [],
        studentsOnPlatform: 0,
        totals: { applications: 0, selected: 0, needsRosterUpdate: 0 },
      }),
    );
    render(<PlatformPanel />);
    expect(
      await screen.findByText(/only when their Mirracle account uses the email on your roster/),
    ).toBeInTheDocument();
  });

  it("shows a failure with a retry instead of an empty page, and recovers", async () => {
    overview
      .mockRejectedValueOnce(new Error("Could not load platform activity."))
      .mockResolvedValue(data());
    render(<PlatformPanel />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load platform activity.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: /try again/i }));
    expect(
      await screen.findByRole("table", { name: "Platform drives at your college" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a loading state while the data is on its way, and disables Refresh meanwhile", async () => {
    let resolve!: (v: PlatformOverview) => void;
    overview.mockReturnValue(new Promise<PlatformOverview>((r) => (resolve = r)));
    render(<PlatformPanel />);
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
    resolve(data());
    await screen.findByRole("table", { name: "Platform drives at your college" });
    expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled();
  });

  it("offers no way to change anything: it has no buttons other than Refresh and Try again", async () => {
    overview.mockResolvedValue(data());
    render(<PlatformPanel />);
    await screen.findByRole("table", { name: "Platform drives at your college" });
    expect(screen.getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Refresh"]);
  });

  it("never shows scores, resumes or answers", async () => {
    overview.mockResolvedValue(data());
    render(<PlatformPanel />);
    const drives = await screen.findByRole("table", { name: "Platform drives at your college" });
    const students = screen.getByRole("table", { name: "Your students' platform applications" });
    for (const table of [drives, students]) {
      expect(table.textContent).not.toMatch(/score|resume|cover letter|answer|probab|ctc|salary/i);
    }
  });
});

describe("PlatformPanel in Demo Mode — same panel, fictional data, no network", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    window.history.pushState({}, "", "/demo/college/drives");
    sessionStorage.clear();
    useCollegeDemoStore.getState().reset();
    fetchMock = vi.fn(() => {
      throw new Error("the demo must never reach the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    return () => window.history.pushState({}, "", "/");
  });

  it("renders the sample drives and students from the demo service without any request", async () => {
    render(<PlatformPanel />);
    const drives = await screen.findByRole(
      "table",
      { name: "Platform drives at your college" },
      { timeout: 3000 },
    );
    expect(within(drives).getByText("Meridian Systems (sample)")).toBeInTheDocument();
    expect(within(drives).getByText("Harbor & Co (sample)")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Your students' platform applications" }),
    ).toBeInTheDocument();
    expect(overview).not.toHaveBeenCalled(); // the live service was never used
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reflects roster changes made in the demo and leaves the roster alone", async () => {
    const before = JSON.stringify(useCollegeDemoStore.getState().data.students);
    render(<PlatformPanel />);
    await screen.findByRole(
      "table",
      { name: "Platform drives at your college" },
      { timeout: 3000 },
    );
    expect(JSON.stringify(useCollegeDemoStore.getState().data.students)).toBe(before);
  });
});
