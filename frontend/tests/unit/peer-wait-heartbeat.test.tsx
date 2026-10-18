import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  requestMatch: vi.fn(),
  getPreferences: vi.fn(),
  endMatch: vi.fn(),
  cancelMatch: vi.fn(),
  joinByRoomId: vi.fn(),
}));
vi.mock("@/services/api/candidate/peer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  peerService: api,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/peerMeetTab", () => ({
  reservePeerMeetTab: () => ({ navigate: vi.fn(), abort: vi.fn(), isAvailable: () => true }),
  untilParam: () => null,
}));

import { PeerInterviewMatchModal } from "@/components/candidate/PeerInterviewMatchModal";
import userEvent from "@testing-library/user-event";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getPreferences.mockResolvedValue({ default_private: true });
  api.requestMatch.mockResolvedValue({ status: "waiting", ticket_id: "t1" });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("waiting for a partner keeps the ticket alive", () => {
  it("keeps asking the server while this tab is in the background (each ask is the 'still here' signal)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PeerInterviewMatchModal open onOpenChange={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: /find a partner now/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const afterStart = api.requestMatch.mock.calls.length;
    expect(afterStart).toBeGreaterThanOrEqual(1);

    // the PeerMeet "Finding a partner" tab is in front; this dashboard tab is hidden
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // 20 seconds hidden: well over the 30s limit would be crossed within two more minutes of silence,
    // so it must still be asking roughly every 2 seconds
    expect(api.requestMatch.mock.calls.length - afterStart).toBeGreaterThanOrEqual(8);
  });
});
