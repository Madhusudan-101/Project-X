import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DOMAINS, domainInfo } from "@/components/candidate/ai-interview/domains";
import { InterviewBriefing } from "@/components/candidate/ai-interview/InterviewBriefing";
import { MeetingRoom } from "@/components/candidate/ai-interview/MeetingRoom";
import { DeviceCheck } from "@/components/candidate/ai-interview/DeviceCheck";
import { useIntegrityMonitor } from "@/components/candidate/ai-interview/useIntegrityMonitor";
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
    selfVideo: null,
    cameraLost: false,
    retryCamera: vi.fn(),
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

  it("states that the camera is required and the session is supervised", () => {
    setup();
    expect(screen.getByText("Supervision and plagiarism checks")).toBeTruthy();
    expect(screen.getByText(/camera is live in the interview room/i)).toBeTruthy();
    expect(screen.getByText(/Do not switch tabs or windows/i)).toBeTruthy();
    expect(screen.getByText("Live voice and video")).toBeTruthy();
    expect(screen.getByText(/with my camera on/i)).toBeTruthy();
  });

  it("keeps Continue disabled until a track is chosen and consent is given", async () => {
    const user = userEvent.setup();
    const { onContinue } = setup("ai_ml");
    const btn = screen.getByRole("button", { name: /continue to equipment check/i });
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
    const btn = screen.getByRole("button", { name: /continue to equipment check/i });
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

describe("DeviceCheck", () => {
  const stubMedia = () => {
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices } });
    class FakeCtx {
      createAnalyser() {
        return { fftSize: 0, getByteTimeDomainData: (b: Uint8Array) => b.fill(128) };
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

  it("requests camera and microphone, enables Join, and releases devices on unmount", async () => {
    const { getUserMedia, track } = stubMedia();
    const onJoin = vi.fn();
    const { unmount } = render(<DeviceCheck domain="ai_ml" onBack={vi.fn()} onJoin={onJoin} />);
    const join = screen.getByRole("button", { name: /join interview/i }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    await waitFor(() => expect(join.disabled).toBe(false));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(screen.getByLabelText("Camera preview")).toBeTruthy();
    expect(screen.getByText("Keep your face centered and well lit")).toBeTruthy();
    await userEvent.setup().click(join);
    expect(onJoin).toHaveBeenCalledWith({ micId: undefined, camId: undefined });
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("keeps the camera preview muted so the mic is never played back", async () => {
    stubMedia();
    render(<DeviceCheck domain="ai_ml" onBack={vi.fn()} onJoin={vi.fn()} />);
    const video = screen.getByLabelText("Camera preview") as HTMLVideoElement;
    expect(video.muted).toBe(true);
    await screen.findByText("Permission granted");
  });

  it("explains blocked permissions and keeps Join disabled", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: vi.fn() } });
    render(<DeviceCheck domain="ai_ml" onBack={vi.fn()} onJoin={vi.fn()} />);
    await screen.findByText(/blocked\. allow the camera and microphone/i);
    expect(
      (screen.getByRole("button", { name: /join interview/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("Camera unavailable")).toBeTruthy();
  });

  it("reports missing hardware", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices: vi.fn() } });
    render(<DeviceCheck domain="ai_ml" onBack={vi.fn()} onJoin={vi.fn()} />);
    await screen.findByText(/no camera or microphone found/i);
  });
});

describe("useIntegrityMonitor", () => {
  it("counts one tab switch per departure and clears the warning on return", () => {
    const { result } = renderHook(() => useIntegrityMonitor(true));
    expect(result.current).toEqual({ tabSwitches: 0, away: false });
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("blur")); // duplicate event must not double count
    });
    expect(result.current).toEqual({ tabSwitches: 1, away: true });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(result.current.away).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current.tabSwitches).toBe(2);
  });

  it("ignores events while inactive", () => {
    const { result } = renderHook(() => useIntegrityMonitor(false));
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(result.current).toEqual({ tabSwitches: 0, away: false });
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

  it("shows the supervised, camera-on status and the self view", () => {
    render(<MeetingRoom room={makeRoom()} domain="ai_ml" />);
    expect(screen.getByText(/camera on · supervised/i)).toBeTruthy();
    expect(screen.getByLabelText("Your camera")).toBeTruthy();
  });

  it("attaches the published camera track to the self view and detaches it", () => {
    const selfVideo = { attach: vi.fn(), detach: vi.fn() };
    const { unmount } = render(
      <MeetingRoom room={makeRoom({ selfVideo } as Partial<RoomProp>)} domain="ai_ml" />,
    );
    const el = screen.getByLabelText("Your camera");
    expect(selfVideo.attach).toHaveBeenCalledWith(el);
    unmount();
    expect(selfVideo.detach).toHaveBeenCalledWith(el);
  });

  it("flags leaving the tab and keeps a running count", () => {
    render(<MeetingRoom room={makeRoom()} domain="ai_ml" />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => {
      fireEvent(window, new Event("blur"));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/left the interview tab/i);
    expect(screen.getByText("Tab switches flagged: 1")).toBeTruthy();
  });

  it("warns when the camera stops and lets the candidate restore it", async () => {
    const room = makeRoom({ cameraLost: true });
    render(<MeetingRoom room={room} domain="ai_ml" />);
    expect(screen.getByRole("alert").textContent).toMatch(/camera stopped/i);
    await userEvent.setup().click(screen.getByRole("button", { name: /restore camera/i }));
    expect(room.retryCamera).toHaveBeenCalledOnce();
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
