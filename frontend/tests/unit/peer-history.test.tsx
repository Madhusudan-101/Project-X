import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PeerHistoryDialog, filterHistory } from "@/components/candidate/peer/PeerHistoryDialog";
import type { PeerHistoryItem } from "@/services/api/candidate/peer";

const api = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/services/api/candidate/peer", () => ({ peerService: api }));
vi.mock("@/components/candidate/peer/PeerReportDialog", () => ({
  PeerReportDialog: ({ roomId }: { roomId: string | null }) =>
    roomId ? <div data-testid="report-dialog">report {roomId}</div> : null,
}));
vi.mock("@/components/candidate/peer/PeerFeedbackDialog", () => ({
  PeerFeedbackDialog: ({
    roomId,
    onSaved,
  }: {
    roomId: string | null;
    onSaved?: (r: string, n: number) => void;
  }) =>
    roomId ? (
      <div data-testid="rate-dialog">
        rate {roomId}
        <button onClick={() => onSaved?.(roomId, 5)}>save-rating</button>
      </div>
    ) : null,
}));

const item = (over: Partial<PeerHistoryItem>): PeerHistoryItem => ({
  room_id: "r1",
  kind: "matched",
  title: null,
  when: "2030-01-02T10:00:00Z",
  status: "completed",
  partner_label: "Anonymous Candidate",
  report_id: null,
  has_report: false,
  rated: false,
  blocked: false,
  can_report_or_rate: true,
  ...over,
});

beforeEach(() => api.history.mockReset());

describe("filterHistory", () => {
  const rows = [
    item({ room_id: "a" }),
    item({
      room_id: "b",
      kind: "scheduled",
      status: "scheduled",
      can_report_or_rate: false,
      partner_label: null,
    }),
    item({ room_id: "c", rated: true }),
    item({
      room_id: "d",
      kind: "scheduled",
      status: "no_show",
      partner_label: null,
      can_report_or_rate: false,
    }),
  ];
  const ids = (f: Parameters<typeof filterHistory>[1]) =>
    filterHistory(rows, f).map((r) => r.room_id);
  it("filters by kind", () => {
    expect(ids("all")).toEqual(["a", "b", "c", "d"]);
    expect(ids("matched")).toEqual(["a", "c"]);
    expect(ids("scheduled")).toEqual(["b", "d"]);
  });
  it("'not rated yet' means a real session with a partner that I have not rated", () => {
    expect(ids("needs-feedback")).toEqual(["a"]);
  });
});

describe("PeerHistoryDialog", () => {
  it("lists sessions with plain-words status and who the partner was", async () => {
    api.history.mockResolvedValue([
      item({ room_id: "r1" }),
      item({
        room_id: "r2",
        kind: "scheduled",
        status: "no_show",
        partner_label: null,
        can_report_or_rate: false,
        title: "Mock round",
      }),
    ]);
    render(<PeerHistoryDialog open onOpenChange={() => undefined} />);
    expect(await screen.findByText("Instant match")).toBeTruthy();
    expect(screen.getByText("Mock round")).toBeTruthy();
    expect(screen.getByText("Partner did not come")).toBeTruthy();
    expect(screen.getByText(/No partner joined/)).toBeTruthy();
    expect(screen.getByText(/Anonymous Candidate/)).toBeTruthy();
  });

  it("offers report and rate only where there was a partner", async () => {
    api.history.mockResolvedValue([
      item({ room_id: "r1" }),
      item({ room_id: "r2", can_report_or_rate: false, partner_label: null, status: "expired" }),
    ]);
    render(<PeerHistoryDialog open onOpenChange={() => undefined} />);
    await screen.findAllByRole("listitem");
    expect(screen.getAllByRole("button", { name: "Report" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Rate" })).toHaveLength(1);
  });

  it("report and rate open for the right room, and rating updates the row", async () => {
    api.history.mockResolvedValue([item({ room_id: "room-xyz" })]);
    const user = userEvent.setup();
    render(<PeerHistoryDialog open onOpenChange={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: "Report" }));
    expect(screen.getByTestId("report-dialog").textContent).toBe("report room-xyz");
    await user.click(screen.getByRole("button", { name: "Rate" }));
    await user.click(screen.getByRole("button", { name: "save-rating" }));
    expect(await screen.findByRole("button", { name: "Change rating" })).toBeTruthy();
  });

  it("filters, and says so when nothing matches or there is no history", async () => {
    api.history.mockResolvedValue([item({ room_id: "r1" })]);
    const user = userEvent.setup();
    const { unmount } = render(<PeerHistoryDialog open onOpenChange={() => undefined} />);
    await screen.findByText("Instant match");
    await user.click(screen.getByRole("button", { name: "Scheduled" }));
    expect(screen.getByText(/Nothing matches this filter/)).toBeTruthy();
    unmount();
    api.history.mockResolvedValue([]);
    render(<PeerHistoryDialog open onOpenChange={() => undefined} />);
    expect(await screen.findByText(/No peer interviews yet/)).toBeTruthy();
  });

  it("shows an error with a retry that reloads", async () => {
    api.history.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce([item({})]);
    const user = userEvent.setup();
    render(<PeerHistoryDialog open onOpenChange={() => undefined} />);
    const alert = await screen.findByRole("alert");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Instant match")).toBeTruthy());
  });
});
