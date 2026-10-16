import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerReportDialog } from "@/components/candidate/peer/PeerReportDialog";
import { BlockedPeopleDialog } from "@/components/candidate/peer/BlockedPeopleDialog";
import { suspensionMessage } from "@/components/candidate/peer/PeerSuspensionNotice";
import { REPORT_REASONS, validateReport } from "@/services/api/candidate/peerSafety";

const api = vi.hoisted(() => ({
  report: vi.fn(),
  blocks: vi.fn(),
  unblock: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/services/api/candidate/peerSafety", async (orig) => ({
  ...(await orig<typeof import("@/services/api/candidate/peerSafety")>()),
  peerSafetyService: api,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe("validateReport", () => {
  it("needs a known reason and bounded details", () => {
    expect(validateReport("", "")).toBeTruthy();
    expect(validateReport("bogus", "")).toBeTruthy();
    expect(validateReport("spam", "x".repeat(1001))).toBeTruthy();
    expect(validateReport("spam", "x".repeat(1000))).toBeNull();
    for (const r of REPORT_REASONS) expect(validateReport(r.id, "")).toBeNull();
  });
});

describe("PeerReportDialog", () => {
  it("does nothing until a reason is chosen, then sends the room (never a person)", async () => {
    api.report.mockResolvedValue({ id: "r1", status: "open", created: true, blocked: true });
    const user = userEvent.setup();
    render(<PeerReportDialog roomId="room-123" onClose={() => undefined} />);
    const send = screen.getByRole("button", { name: /send report/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.click(screen.getByLabelText("Harassment or abuse"));
    await user.type(screen.getByLabelText(/details/i), "  rude  ");
    expect(send.disabled).toBe(false);
    await user.click(send);
    await waitFor(() =>
      expect(api.report).toHaveBeenCalledWith({
        room_id: "room-123",
        reason: "harassment",
        details: "rude",
        block: true, // blocking is on by default
      }),
    );
    expect(await screen.findByRole("status")).toHaveProperty("textContent");
    expect(screen.getByText(/will not be matched with this person again/i)).toBeTruthy();
  });

  it("can report without blocking", async () => {
    api.report.mockResolvedValue({ id: "r1", status: "open", created: true, blocked: false });
    const user = userEvent.setup();
    render(<PeerReportDialog roomId="room-123" onClose={() => undefined} />);
    await user.click(screen.getByLabelText("Spam or off-topic"));
    await user.click(screen.getByLabelText(/also block this person/i));
    await user.click(screen.getByRole("button", { name: /send report/i }));
    await waitFor(() =>
      expect(api.report).toHaveBeenCalledWith(expect.objectContaining({ block: false })),
    );
    expect(screen.queryByText(/will not be matched/i)).toBeNull();
  });

  it("shows the server's reason when it fails and lets the person try again", async () => {
    api.report.mockRejectedValueOnce(
      new Error("You can only report someone from a meeting you were in."),
    );
    const user = userEvent.setup();
    render(<PeerReportDialog roomId="room-123" onClose={() => undefined} />);
    await user.click(screen.getByLabelText("Spam or off-topic"));
    await user.click(screen.getByRole("button", { name: /send report/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /only report someone from a meeting/,
    );
    expect(
      (screen.getByRole("button", { name: /send report/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("is closed when there is no room", () => {
    render(<PeerReportDialog roomId={null} onClose={() => undefined} />);
    expect(screen.queryByText("Report this person")).toBeNull();
  });
});

describe("BlockedPeopleDialog", () => {
  it("lists anonymity-preserving labels and unblocks", async () => {
    api.blocks.mockResolvedValue([
      { id: "b1", label: "Anonymous Candidate", created_at: "2030-01-01T00:00:00Z" },
      { id: "b2", label: "Bob B", created_at: "2030-01-02T00:00:00Z" },
    ]);
    api.unblock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<BlockedPeopleDialog open onOpenChange={() => undefined} />);
    expect(await screen.findByText("Anonymous Candidate")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Unblock Bob B" }));
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith("b2"));
    await waitFor(() => expect(screen.queryByText("Bob B")).toBeNull());
    expect(screen.getByText("Anonymous Candidate")).toBeTruthy();
  });

  it("says so when nobody is blocked, and when it cannot load", async () => {
    api.blocks.mockResolvedValueOnce([]);
    const { unmount } = render(<BlockedPeopleDialog open onOpenChange={() => undefined} />);
    expect(await screen.findByText(/have not blocked anyone/i)).toBeTruthy();
    unmount();
    api.blocks.mockRejectedValueOnce(new Error("x"));
    render(<BlockedPeopleDialog open onOpenChange={() => undefined} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not load/i);
  });
});

describe("suspensionMessage", () => {
  it("is empty unless suspended, and names the end date when there is one", () => {
    expect(suspensionMessage(null)).toBeNull();
    expect(suspensionMessage({ suspended: false, suspended_until: null })).toBeNull();
    expect(suspensionMessage({ suspended: true, suspended_until: null })).toMatch(
      /paused on your account while/,
    );
    expect(suspensionMessage({ suspended: true, suspended_until: "2031-03-04T00:00:00Z" })).toMatch(
      /until/,
    );
  });
});
