import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
  PeerGuidelinesDialog,
  PeerGuidelinesGate,
} from "@/components/candidate/peer/PeerGuidelinesDialog";
import { PeerFeedbackDialog } from "@/components/candidate/peer/PeerFeedbackDialog";
import { usePeerGuidelinesStore, withGuidelines } from "@/store/candidate/peerGuidelines";

const api = vi.hoisted(() => ({
  guidelines: vi.fn(),
  acceptGuidelines: vi.fn(),
  saveFeedback: vi.fn(),
}));
vi.mock("@/services/api/candidate/peerSafety", async (orig) => ({
  ...(await orig<typeof import("@/services/api/candidate/peerSafety")>()),
  peerSafetyService: api,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const err428 = Object.assign(
  new Error("Please read and accept the peer interview guidelines first."),
  { status: 428 },
);

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.guidelines.mockResolvedValue({ version: "v-test", accepted: false, accepted_at: null });
  usePeerGuidelinesStore.setState({ open: false });
});

describe("withGuidelines", () => {
  it("passes a successful action straight through, without asking", async () => {
    const action = vi.fn().mockResolvedValue("ok");
    await expect(withGuidelines(action)).resolves.toBe("ok");
    expect(action).toHaveBeenCalledTimes(1);
    expect(usePeerGuidelinesStore.getState().open).toBe(false);
  });

  it("other errors are not mistaken for a guidelines problem", async () => {
    const boom = Object.assign(new Error("nope"), { status: 403 });
    await expect(withGuidelines(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(usePeerGuidelinesStore.getState().open).toBe(false);
  });

  it("on 428 opens the guidelines, and once accepted runs the action again", async () => {
    const action = vi.fn().mockRejectedValueOnce(err428).mockResolvedValueOnce("done");
    const p = withGuidelines(action);
    await waitFor(() => expect(usePeerGuidelinesStore.getState().open).toBe(true));
    act(() => usePeerGuidelinesStore.getState().finish(true));
    await expect(p).resolves.toBe("done");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("if the person says 'not now' the original refusal is surfaced and nothing is retried", async () => {
    const action = vi.fn().mockRejectedValue(err428);
    const p = withGuidelines(action);
    await waitFor(() => expect(usePeerGuidelinesStore.getState().open).toBe(true));
    act(() => usePeerGuidelinesStore.getState().finish(false));
    await expect(p).rejects.toBe(err428);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("several actions at once share one dialog", async () => {
    const mk = () => vi.fn().mockRejectedValueOnce(err428).mockResolvedValueOnce("x");
    const a = withGuidelines(mk());
    const b = withGuidelines(mk());
    await waitFor(() => expect(usePeerGuidelinesStore.getState().open).toBe(true));
    act(() => usePeerGuidelinesStore.getState().finish(true));
    await expect(Promise.all([a, b])).resolves.toEqual(["x", "x"]);
  });
});

describe("PeerGuidelinesDialog", () => {
  it("shows the rules and data handling, and needs all three statements ticked", async () => {
    api.acceptGuidelines.mockResolvedValue({
      version: "v-test",
      accepted: true,
      accepted_at: "now",
    });
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<PeerGuidelinesDialog open onFinish={onFinish} />);
    expect(await screen.findByText(/Be respectful/)).toBeTruthy();
    expect(screen.getByText(/Deepgram and analysed by Google Gemini/)).toBeTruthy();
    const go = screen.getByRole("button", { name: /i agree, continue/i }) as HTMLButtonElement;
    await waitFor(() => expect(api.guidelines).toHaveBeenCalled());
    for (const label of [
      /read the guidelines/,
      /camera and microphone are shared/,
      /live captions and AI feedback/,
    ]) {
      expect(go.disabled).toBe(true);
      await user.click(screen.getByLabelText(label));
    }
    expect(go.disabled).toBe(false);
    await user.click(go);
    await waitFor(() => expect(api.acceptGuidelines).toHaveBeenCalledWith("v-test"));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(true));
  });

  it("'Not now' dismisses it without accepting", async () => {
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<PeerGuidelinesDialog open onFinish={onFinish} />);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(onFinish).toHaveBeenCalledWith(false);
    expect(api.acceptGuidelines).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and explains when saving fails", async () => {
    api.acceptGuidelines.mockRejectedValue(
      new Error("The guidelines were updated. Please read them again."),
    );
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<PeerGuidelinesDialog open onFinish={onFinish} />);
    await waitFor(() => expect(api.guidelines).toHaveBeenCalled());
    for (const label of [
      /read the guidelines/,
      /camera and microphone are shared/,
      /live captions and AI feedback/,
    ]) {
      await user.click(await screen.findByLabelText(label));
    }
    await user.click(screen.getByRole("button", { name: /i agree, continue/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/were updated/);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("the gate opens from the store", async () => {
    render(<PeerGuidelinesGate />);
    expect(screen.queryByText("Peer interview guidelines")).toBeNull();
    act(() => usePeerGuidelinesStore.setState({ open: true }));
    expect(await screen.findByText("Peer interview guidelines")).toBeTruthy();
  });
});

describe("PeerFeedbackDialog", () => {
  it("has a Report button on the feedback screen that hands this room to the report form", async () => {
    const onReport = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PeerFeedbackDialog roomId="room-9" onClose={onClose} onReport={onReport} />);
    await user.click(screen.getByRole("button", { name: /report this person/i }));
    expect(onReport).toHaveBeenCalledWith("room-9");
    expect(onClose).toHaveBeenCalled();
    expect(api.saveFeedback).not.toHaveBeenCalled(); // reporting is not rating
  });

  it("shows no Report button when nothing can handle it", () => {
    render(<PeerFeedbackDialog roomId="room-9" onClose={() => undefined} />);
    expect(screen.queryByRole("button", { name: /report this person/i })).toBeNull();
  });

  it("needs a star rating, then sends the rating, tags and note for that room", async () => {
    api.saveFeedback.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PeerFeedbackDialog roomId="room-9" onClose={onClose} onSaved={onSaved} />);
    const send = screen.getByRole("button", { name: /send feedback/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: "4 stars" }));
    await user.click(screen.getByRole("button", { name: "Respectful" }));
    await user.click(screen.getByRole("button", { name: "Good questions" }));
    await user.type(screen.getByLabelText(/anything else/i), "  great session ");
    await user.click(send);
    await waitFor(() =>
      expect(api.saveFeedback).toHaveBeenCalledWith({
        room_id: "room-9",
        rating: 4,
        tags: ["respectful", "good_questions"],
        comment: "great session",
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("room-9", 4);
    expect(onClose).toHaveBeenCalled();
  });

  it("tags can be switched off again, and Skip closes without saving", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PeerFeedbackDialog roomId="room-9" onClose={onClose} />);
    const tag = screen.getByRole("button", { name: "Helpful" });
    await user.click(tag);
    expect(tag.getAttribute("aria-pressed")).toBe("true");
    await user.click(tag);
    expect(tag.getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.saveFeedback).not.toHaveBeenCalled();
  });

  it("shows the reason when saving fails", async () => {
    api.saveFeedback.mockRejectedValue(new Error("You can only rate a meeting you were in."));
    const user = userEvent.setup();
    render(<PeerFeedbackDialog roomId="room-9" onClose={() => undefined} />);
    await user.click(screen.getByRole("radio", { name: "5 stars" }));
    await user.click(screen.getByRole("button", { name: /send feedback/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/only rate a meeting/);
  });

  it("is closed with no room", () => {
    render(<PeerFeedbackDialog roomId={null} onClose={() => undefined} />);
    expect(screen.queryByText("How was your session?")).toBeNull();
  });
});
