import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DOMAINS, domainInfo } from "@/components/candidate/ai-interview/domains";
import { InterviewBriefing } from "@/components/candidate/ai-interview/InterviewBriefing";
import { MeetingRoom } from "@/components/candidate/ai-interview/MeetingRoom";
import { MicCheck } from "@/components/candidate/ai-interview/MicCheck";
import { WaitingRoom } from "@/components/candidate/ai-interview/WaitingRoom";

type RoomProp = Parameters<typeof MeetingRoom>[0]["room"];

const makeRoom = (over: Partial<RoomProp> = {}): RoomProp =>
  ({
    phase: "live",
    roomName: "r1",
    error: null,
    muted: false,
    captions: [],
    secondsLeft: 600,
    interviewerJoined: true,
    interviewerMissing: false,
    interviewerSpeaking: false,
    needsAudioUnlock: false,
    audioHostRef: { current: null },
    start: vi.fn(),
    end: vi.fn(),
    toggleMute: vi.fn(),
    unlockAudio: vi.fn(),
    reset: vi.fn(),
    ...over,
  }) as RoomProp;

describe("interview domains", () => {
  it("maps each track to a formal role", () => {
    expect(DOMAINS.map((d) => d.id)).toEqual(["ai_ml", "web_dev", "dsa"]);
    expect(domainInfo("ai_ml")?.role).toBe("AI / ML Engineer");
    expect(domainInfo("dsa")?.role).toBe("Software Engineer");
  });
});

describe("InterviewBriefing", () => {
  const setup = (domain: "ai_ml" | null = null, error: string | null = null) => {
    const onDomain = vi.fn();
    const onContinue = vi.fn();
    render(
      <InterviewBriefing
        domain={domain}
        onDomain={onDomain}
        onContinue={onContinue}
        error={error}
      />,
    );
    return { onDomain, onContinue };
  };

  it("shows the rules, integrity and data sections", () => {
    setup();
    expect(screen.getByText("Interview rules and academic integrity")).toBeTruthy();
    expect(screen.getByText("You should")).toBeTruthy();
    expect(screen.getByText("You must not")).toBeTruthy();
    expect(screen.getByText("AI disclosure and your data")).toBeTruthy();
    expect(screen.getByText("Up to 20 min")).toBeTruthy();
  });

  it("keeps Continue disabled until a track is chosen and consent is given", async () => {
    const user = userEvent.setup();
    const { onContinue } = setup("ai_ml");
    const btn = screen.getByRole("button", { name: /continue to microphone check/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await user.click(btn);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("stays disabled with consent but no track", async () => {
    const user = userEvent.setup();
    setup(null);
    await user.click(screen.getByRole("checkbox"));
    const btn = screen.getByRole("button", { name: /continue to microphone check/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/choose an interview track/i)).toBeTruthy();
  });

  it("selects a track and shows its topics", async () => {
    const user = userEvent.setup();
    const { onDomain } = setup("ai_ml");
    expect(screen.getByText("Topics for AI / ML Engineer")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /web developer/i }));
    expect(onDomain).toHaveBeenCalledWith("web_dev");
  });

  it("renders a join error", () => {
    setup("ai_ml", "Microphone access is required.");
    expect(screen.getByText("Microphone access is required.")).toBeTruthy();
  });
});

describe("WaitingRoom", () => {
  it("names the role being interviewed for", () => {
    render(<WaitingRoom domain="web_dev" />);
    expect(screen.getByText("Your interviewer is joining")).toBeTruthy();
    expect(screen.getByText(/Web Developer interview/)).toBeTruthy();
  });
});

describe("MicCheck", () => {
  const stubAudio = () => {
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices } });
    class FakeCtx {
      createAnalyser() {
        return {
          fftSize: 0,
          getByteTimeDomainData: (b: Uint8Array) => b.fill(128),
        };
      }
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("AudioContext", FakeCtx);
    return { getUserMedia, track };
  };

  it("enables Join once the microphone is granted, then releases it on unmount", async () => {
    const { getUserMedia, track } = stubAudio();
    const onJoin = vi.fn();
    const { unmount } = render(<MicCheck domain="ai_ml" onBack={vi.fn()} onJoin={onJoin} />);
    const join = screen.getByRole("button", { name: /join interview/i }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    await waitFor(() => expect(join.disabled).toBe(false));
    expect(getUserMedia).toHaveBeenCalled();
    expect(screen.getByText("Say a few words and watch the meter move")).toBeTruthy();
    await userEvent.setup().click(join);
    expect(onJoin).toHaveBeenCalledOnce();
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("explains a blocked microphone and keeps Join disabled", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: vi.fn() } });
    render(<MicCheck domain="ai_ml" onBack={vi.fn()} onJoin={vi.fn()} />);
    await screen.findByText(/blocked\. allow the microphone/i);
    expect(
      (screen.getByRole("button", { name: /join interview/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("reports a missing microphone", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: vi.fn() } });
    render(<MicCheck domain="ai_ml" onBack={vi.fn()} onJoin={vi.fn()} />);
    await screen.findByText(/no microphone found/i);
  });
});

describe("MeetingRoom", () => {
  it("shows role, timer and interviewer status", () => {
    render(<MeetingRoom room={makeRoom({ secondsLeft: 125 })} domain="ai_ml" />);
    expect(screen.getByText("AI / ML Engineer interview")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("2:05 left");
    expect(screen.getByText("Listening")).toBeTruthy();
  });

  it("reflects speaking, joining and missing states", () => {
    const { rerender } = render(
      <MeetingRoom room={makeRoom({ interviewerSpeaking: true })} domain="dsa" />,
    );
    expect(screen.getByText("Speaking")).toBeTruthy();
    rerender(<MeetingRoom room={makeRoom({ interviewerJoined: false })} domain="dsa" />);
    expect(screen.getByText("Joining…")).toBeTruthy();
    rerender(
      <MeetingRoom
        room={makeRoom({ interviewerJoined: false, interviewerMissing: true })}
        domain="dsa"
      />,
    );
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByText(/didn't join the call/i)).toBeTruthy();
  });

  it("renders captions with speaker labels", () => {
    const captions = [
      { id: "1", who: "interviewer" as const, text: "Tell me about overfitting." },
      { id: "2", who: "you" as const, text: "It is when a model memorizes." },
    ];
    render(<MeetingRoom room={makeRoom({ captions })} domain="ai_ml" />);
    expect(screen.getByText(/Tell me about overfitting/)).toBeTruthy();
    expect(screen.getByText(/memorizes/)).toBeTruthy();
  });

  it("toggles mute and shows the audio unlock button when needed", async () => {
    const user = userEvent.setup();
    const room = makeRoom({ muted: true, needsAudioUnlock: true });
    render(<MeetingRoom room={room} domain="ai_ml" />);
    await user.click(screen.getByRole("button", { name: /unmute/i }));
    expect(room.toggleMute).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: /enable audio/i }));
    expect(room.unlockAudio).toHaveBeenCalledOnce();
  });

  it("only ends the call after confirmation", async () => {
    const user = userEvent.setup();
    const room = makeRoom();
    render(<MeetingRoom room={room} domain="ai_ml" />);
    await user.click(screen.getByRole("button", { name: /end interview/i }));
    expect(room.end).not.toHaveBeenCalled();
    await screen.findByText("End the interview?");
    await user.click(screen.getByRole("button", { name: /go back/i }));
    expect(room.end).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /end interview/i }));
    await user.click(await screen.findByRole("button", { name: "End interview", hidden: false }));
    expect(room.end).toHaveBeenCalledOnce();
  });
});
