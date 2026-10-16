import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOMAINS, domainInfo } from "@/components/candidate/ai-interview/domains";
import { aiInterviewService } from "@/services/api/candidate/aiInterview";
import type { AiInterviewConfig, AiInterviewReportDetail } from "@/types/candidate/aiInterview";
import { InterviewBriefing } from "@/components/candidate/ai-interview/InterviewBriefing";
import { MeetingRoom } from "@/components/candidate/ai-interview/MeetingRoom";
import { DeviceCheck } from "@/components/candidate/ai-interview/DeviceCheck";
import { useIntegrityMonitor } from "@/components/candidate/ai-interview/useIntegrityMonitor";
import { IntegrityBlock } from "@/components/candidate/ai-interview/ReportView";
import { WaitingRoom } from "@/components/candidate/ai-interview/WaitingRoom";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/api/client", () => ({
  request: requestMock,
  ApiClientError: class ApiClientError extends Error {},
}));

const CONFIG: AiInterviewConfig = {
  maxMinutes: 20,
  dailyLimit: 3,
  usedToday: 1,
  remainingToday: 2,
  consentVersion: "v-test",
};

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
    reportIntegrity: vi.fn(),
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
  const setup = (
    domain: "ai_ml" | null = null,
    error: string | null = null,
    over: { config?: AiInterviewConfig | null; configError?: string | null } = {},
  ) => {
    const onDomain = vi.fn();
    const onContinue = vi.fn();
    const onRetryConfig = vi.fn();
    render(
      <InterviewBriefing
        domain={domain}
        onDomain={onDomain}
        onContinue={onContinue}
        error={error}
        config={over.config === undefined ? CONFIG : over.config}
        configError={over.configError ?? null}
        onRetryConfig={onRetryConfig}
      />,
    );
    return { onDomain, onContinue, onRetryConfig };
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

describe("InterviewBriefing live config", () => {
  const base = (over: Parameters<typeof InterviewBriefing>[0]["config"]) =>
    render(
      <InterviewBriefing
        domain="ai_ml"
        onDomain={vi.fn()}
        onContinue={vi.fn()}
        error={null}
        config={over}
        configError={null}
        onRetryConfig={vi.fn()}
      />,
    );

  it("shows the backend's duration and attempts left", () => {
    base({ ...CONFIG, maxMinutes: 30, remainingToday: 2 });
    expect(screen.getByText("Up to 30 min")).toBeTruthy();
    expect(screen.getByText("2 of 3 interviews left today.")).toBeTruthy();
  });

  it("blocks starting when today's interviews are used up", async () => {
    const user = userEvent.setup();
    base({ ...CONFIG, usedToday: 3, remainingToday: 0 });
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByText(/used all 3 interviews for today/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /continue to equipment check/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("cannot continue until the config has loaded", async () => {
    const user = userEvent.setup();
    base(null);
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /continue to equipment check/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows a config error with a working retry", async () => {
    const onRetryConfig = vi.fn();
    render(
      <InterviewBriefing
        domain="ai_ml"
        onDomain={vi.fn()}
        onContinue={vi.fn()}
        error={null}
        config={null}
        configError="Could not load interview details."
        onRetryConfig={onRetryConfig}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryConfig).toHaveBeenCalledOnce();
  });
});

describe("aiInterviewService", () => {
  beforeEach(() => requestMock.mockReset().mockResolvedValue({}));

  it("sends consent and the rules version when starting", async () => {
    await aiInterviewService.startSession("dsa", "v-test");
    expect(requestMock).toHaveBeenCalledWith("/candidate/ai-interview/session", {
      method: "POST",
      body: { domain: "dsa", consent: true, consentVersion: "v-test" },
    });
  });

  it("loads the live config", async () => {
    await aiInterviewService.getConfig();
    expect(requestMock).toHaveBeenCalledWith("/candidate/ai-interview/config", {
      signal: undefined,
    });
  });

  it("posts integrity events to the live session", async () => {
    await aiInterviewService.logIntegrityEvents("ai-abc", [
      { kind: "tab_hidden", offsetSeconds: 12 },
    ]);
    expect(requestMock).toHaveBeenCalledWith(
      "/candidate/ai-interview/session/ai-abc/integrity-events",
      { method: "POST", body: { events: [{ kind: "tab_hidden", offsetSeconds: 12 }] } },
    );
  });
});

describe("IntegrityBlock", () => {
  const report = (over: Partial<AiInterviewReportDetail>) =>
    ({
      id: "1",
      room_id: "r",
      domain: "dsa",
      per_question: [],
      ...over,
    }) as AiInterviewReportDetail;

  it("renders nothing for reports from before integrity tracking", () => {
    const { container } = render(<IntegrityBlock report={report({})} />);
    expect(container.firstChild).toBeNull();
  });

  it("confirms a clean session", () => {
    render(
      <IntegrityBlock
        report={report({ integrity: { tab_switches: 0, camera_lost: 0, total: 0 } })}
      />,
    );
    expect(screen.getByText(/no tab switches or camera interruptions/i)).toBeTruthy();
  });

  it("lists flagged events with timestamps", () => {
    render(
      <IntegrityBlock
        report={report({
          integrity: { tab_switches: 1, camera_lost: 1, total: 2 },
          integrity_events: [
            { kind: "tab_hidden", offset_seconds: 75 },
            { kind: "camera_lost", offset_seconds: 130 },
          ],
        })}
      />,
    );
    expect(screen.getByText(/1 tab switch and 1 camera interruption recorded/i)).toBeTruthy();
    expect(screen.getByText("1:15")).toBeTruthy();
    expect(screen.getByText("Left the interview tab")).toBeTruthy();
    expect(screen.getByText("2:10")).toBeTruthy();
    expect(screen.getByText("Camera stopped")).toBeTruthy();
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

  it("reports which kind of departure it was, once per departure", () => {
    const onLeave = vi.fn();
    renderHook(() => useIntegrityMonitor(true, onLeave));
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledWith("window_blur");
  });

  it("reports a hidden tab as tab_hidden", () => {
    const onLeave = vi.fn();
    renderHook(() => useIntegrityMonitor(true, onLeave));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onLeave).toHaveBeenCalledWith("tab_hidden");
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

  it("sends each tab departure to the backend", () => {
    const room = makeRoom();
    render(<MeetingRoom room={room} domain="ai_ml" />);
    act(() => {
      fireEvent(window, new Event("blur"));
    });
    expect(room.reportIntegrity).toHaveBeenCalledWith("window_blur");
    expect(room.reportIntegrity).toHaveBeenCalledTimes(1);
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
