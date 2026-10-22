import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollegeSuspensionControls } from "@/components/admin/CollegeSuspensionControls";
import { ApiClientError } from "@/services/api/client";
import type { AdminMe, CollegeSuspension } from "@/types/admin/admin";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  suspend: vi.fn(),
  reactivate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/services/api/admin/admin", () => ({
  adminService: {
    me: mocks.me,
    colleges: { suspend: mocks.suspend, reactivate: mocks.reactivate },
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const COLLEGE = "c1000000-0000-0000-0000-000000000001";
const OTHER = "c2000000-0000-0000-0000-000000000002";

const state = (s: CollegeSuspension["state"], total = 2, suspended = 0): CollegeSuspension => ({
  state: s,
  accounts_total: total,
  accounts_suspended: suspended,
  accounts_active: total - suspended,
});
const ACTIVE = state("active");
const SUSPENDED = state("suspended", 2, 2);

const grant = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  user_id: "a",
  permission: "colleges.suspend",
  scope_type: "global",
  scope_id: null,
  granted_by: null,
  granted_at: "",
  expires_at: null,
  is_active: true,
  ...over,
});
const me = (over: Partial<AdminMe> = {}): AdminMe =>
  ({ id: "a", email: "a@x", is_super_admin: false, permissions: [], ...over }) as AdminMe;

const user = userEvent.setup();

function renderControls(
  suspension: CollegeSuspension | undefined,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  render(
    <QueryClientProvider client={qc}>
      <CollegeSuspensionControls
        collegeId={COLLEGE}
        collegeName="Alpha College"
        suspension={suspension}
      />
    </QueryClientProvider>,
  );
  return qc;
}

const button = (name: RegExp | string) => screen.queryByRole("button", { name });

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m === "function" && m.mockReset());
  mocks.toast.success.mockReset();
  mocks.toast.error.mockReset();
  mocks.me.mockResolvedValue(me({ is_super_admin: true }));
});

describe("status", () => {
  it.each([
    [state("active"), "College portal active"],
    [state("suspended", 2, 2), "Suspended"],
    [state("partial", 3, 2), "Partly suspended"],
    [state("no_accounts", 0), "No TPO account"],
  ])("shows %# as a labelled badge, not just a colour", async (s, label) => {
    renderControls(s);
    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("renders nothing until the detail has loaded", () => {
    renderControls(undefined);
    expect(document.body.textContent).toBe("");
  });
});

describe("who sees the actions (a convenience — the API is the real gate)", () => {
  it("a super admin sees Suspend on an active college and Reactivate on a suspended one", async () => {
    renderControls(ACTIVE);
    expect(await screen.findByRole("button", { name: "Suspend college" })).toBeInTheDocument();
    expect(button("Reactivate college")).not.toBeInTheDocument();
  });

  it("a suspended college offers Reactivate only", async () => {
    renderControls(SUSPENDED);
    expect(await screen.findByRole("button", { name: "Reactivate college" })).toBeInTheDocument();
    expect(button("Suspend college")).not.toBeInTheDocument();
  });

  it("a partly suspended college offers both", async () => {
    renderControls(state("partial", 3, 2));
    expect(await screen.findByRole("button", { name: "Suspend college" })).toBeInTheDocument();
    expect(button("Reactivate college")).toBeInTheDocument();
  });

  it("a college without a TPO account offers neither", async () => {
    renderControls(state("no_accounts", 0));
    await screen.findByText("No TPO account");
    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    expect(button(/college$/)).not.toBeInTheDocument();
  });

  it.each([
    ["no grants", me()],
    ["only colleges.view", me({ permissions: [grant({ permission: "colleges.view" })] as never })],
    [
      "a grant scoped to a DIFFERENT college",
      me({ permissions: [grant({ scope_type: "college", scope_id: OTHER })] as never }),
    ],
    ["an expired grant", me({ permissions: [grant({ is_active: false })] as never })],
  ])("an admin with %s sees the status but no action", async (_label, who) => {
    mocks.me.mockResolvedValue(who);
    renderControls(ACTIVE);
    await screen.findByText("College portal active");
    await waitFor(() => expect(mocks.me).toHaveBeenCalled());
    expect(button("Suspend college")).not.toBeInTheDocument();
  });

  it.each([
    ["a global grant", me({ permissions: [grant()] as never })],
    [
      "a grant scoped to this college",
      me({ permissions: [grant({ scope_type: "college", scope_id: COLLEGE })] as never }),
    ],
  ])("an admin with %s sees the action", async (_label, who) => {
    mocks.me.mockResolvedValue(who);
    renderControls(ACTIVE);
    expect(await screen.findByRole("button", { name: "Suspend college" })).toBeInTheDocument();
  });

  it("shows no action while the admin's permissions are still loading", async () => {
    mocks.me.mockReturnValue(new Promise(() => {}));
    renderControls(ACTIVE);
    await screen.findByText("College portal active");
    expect(button("Suspend college")).not.toBeInTheDocument();
  });
});

describe("suspending", () => {
  it("explains exactly what happens and what does not, and will not proceed without a reason", async () => {
    renderControls(ACTIVE);
    await user.click(await screen.findByRole("button", { name: "Suspend college" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Suspend Alpha College?");
    expect(dialog).toHaveTextContent(/2 TPO accounts will be blocked immediately/);
    expect(dialog).toHaveTextContent(/Nothing is deleted/);
    expect(dialog).toHaveTextContent(/Students and companies are not affected/);
    const confirm = screen.getAllByRole("button", { name: "Suspend college" }).at(-1)!;
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), "   ");
    expect(confirm).toBeDisabled(); // blank is not a reason
    await user.type(screen.getByLabelText(/Reason/), "Contract dispute");
    expect(confirm).toBeEnabled();
    expect(mocks.suspend).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason exactly once, confirms, closes, and refreshes the college", async () => {
    mocks.suspend.mockResolvedValue({ college_id: COLLEGE, suspension: SUSPENDED });
    const qc = renderControls(ACTIVE);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await user.click(await screen.findByRole("button", { name: "Suspend college" }));
    await user.type(await screen.findByLabelText(/Reason/), "  Contract dispute  ");
    await user.dblClick(screen.getAllByRole("button", { name: "Suspend college" }).at(-1)!);

    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Alpha College has been suspended."),
    );
    expect(mocks.suspend).toHaveBeenCalledTimes(1);
    expect(mocks.suspend).toHaveBeenCalledWith(COLLEGE, "Contract dispute");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "college", COLLEGE] });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the server's message when it refuses, keeps the dialog open and still refreshes what is shown", async () => {
    mocks.suspend.mockRejectedValue(new ApiClientError("This college is already suspended.", 409));
    const qc = renderControls(ACTIVE);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await user.click(await screen.findByRole("button", { name: "Suspend college" }));
    await user.type(await screen.findByLabelText(/Reason/), "x");
    await user.click(screen.getAllByRole("button", { name: "Suspend college" }).at(-1)!);

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("This college is already suspended."),
    );
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "college", COLLEGE] });
  });

  it("says nothing was changed when the request fails for an unknown reason", async () => {
    mocks.suspend.mockRejectedValue(new Error("network"));
    renderControls(ACTIVE);
    await user.click(await screen.findByRole("button", { name: "Suspend college" }));
    await user.type(await screen.findByLabelText(/Reason/), "x");
    await user.click(screen.getAllByRole("button", { name: "Suspend college" }).at(-1)!);
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/Nothing was changed/)),
    );
  });

  it("cannot be cancelled or closed while the request is running", async () => {
    let resolve!: (v: unknown) => void;
    mocks.suspend.mockReturnValue(new Promise((r) => (resolve = r)));
    renderControls(ACTIVE);
    await user.click(await screen.findByRole("button", { name: "Suspend college" }));
    await user.type(await screen.findByLabelText(/Reason/), "x");
    await user.click(screen.getAllByRole("button", { name: "Suspend college" }).at(-1)!);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => resolve({ college_id: COLLEGE, suspension: SUSPENDED }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelling changes nothing", async () => {
    renderControls(ACTIVE);
    await user.click(await screen.findByRole("button", { name: "Suspend college" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(mocks.suspend).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("reactivating", () => {
  it("explains that only the accounts this suspension blocked come back, and the note is optional", async () => {
    mocks.reactivate.mockResolvedValue({ college_id: COLLEGE, suspension: ACTIVE });
    renderControls(SUSPENDED);
    await user.click(await screen.findByRole("button", { name: "Reactivate college" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/2 TPO accounts that this suspension blocked/);
    expect(dialog).toHaveTextContent(/blocked separately for another reason stays blocked/);
    const confirm = screen.getAllByRole("button", { name: "Reactivate college" }).at(-1)!;
    expect(confirm).toBeEnabled(); // no reason needed
    await user.click(confirm);
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith(COLLEGE, undefined));
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith("Alpha College has been reactivated."),
    );
  });

  it("passes the optional note along, trimmed", async () => {
    mocks.reactivate.mockResolvedValue({ college_id: COLLEGE, suspension: ACTIVE });
    renderControls(SUSPENDED);
    await user.click(await screen.findByRole("button", { name: "Reactivate college" }));
    await user.type(await screen.findByLabelText(/Note/), " Dispute resolved ");
    await user.click(screen.getAllByRole("button", { name: "Reactivate college" }).at(-1)!);
    await waitFor(() => expect(mocks.reactivate).toHaveBeenCalledWith(COLLEGE, "Dispute resolved"));
  });
});
