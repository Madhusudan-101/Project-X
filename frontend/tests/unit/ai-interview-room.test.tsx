import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInterviewRoom } from "@/components/candidate/ai-interview/useInterviewRoom";

const svc = vi.hoisted(() => ({
  startSession: vi.fn(),
  startInviteSession: vi.fn(),
  logIntegrityEvents: vi.fn(),
}));
vi.mock("@/services/api/candidate/aiInterview", () => ({ aiInterviewService: svc }));
vi.mock("@/services/api/client", () => ({
  ApiClientError: class ApiClientError extends Error {},
}));

type Handler = (...a: unknown[]) => void;

/** A stand-in for a LiveKit local track: like the real one it emits "ended" when the device
 *  drops out and "restarted" when it comes back, and can be restarted / unmuted. */
const lk = vi.hoisted(() => {
  const makeTrack = (kind: "audio" | "video") => {
    const listeners: Record<string, Handler[]> = {};
    return {
      kind,
      on(ev: string, fn: Handler) {
        (listeners[ev] ??= []).push(fn);
      },
      fire(ev: string) {
        (listeners[ev] ?? []).forEach((f) => f());
      },
      restartTrack: vi.fn().mockResolvedValue(undefined),
      unmute: vi.fn().mockResolvedValue(undefined),
    };
  };
  return {
    makeTrack,
    handlers: {} as Record<string, Handler[]>,
    cameraError: null as Error | null,
    micError: null as Error | null,
    rooms: [] as unknown[],
    cam: makeTrack("video"),
    mic: makeTrack("audio"),
  };
});

const dispatch = (ev: string, ...args: unknown[]) =>
  (lk.handlers[ev] ?? []).forEach((h) => h(...args));

vi.mock("livekit-client", () => {
  class FakeRoom {
    remoteParticipants = new Map<string, unknown>([["agent", {}]]);
    localParticipant = {
      setMicrophoneEnabled: vi.fn(async () => {
        if (lk.micError) throw lk.micError;
        dispatch("localTrackPublished", { track: lk.mic });
      }),
      setCameraEnabled: vi.fn(async () => {
        if (lk.cameraError) throw lk.cameraError;
        dispatch("localTrackPublished", { track: lk.cam });
      }),
    };
    constructor() {
      lk.handlers = {};
      lk.rooms.push(this);
    }
    on(ev: string, fn: Handler) {
      (lk.handlers[ev] ??= []).push(fn);
      return this;
    }
    removeAllListeners() {}
    connect = vi.fn().mockResolvedValue(undefined);
    startAudio = vi.fn().mockResolvedValue(undefined);
    canPlaybackAudio = true;
    // Like the real SDK, closing the call unpublishes local tracks before "disconnected".
    disconnect = vi.fn(async () => {
      dispatch("localTrackUnpublished", { track: lk.cam });
      dispatch("localTrackUnpublished", { track: lk.mic });
      dispatch("disconnected");
    });
  }
  return {
    Room: FakeRoom,
    TrackEvent: { Ended: "ended", Restarted: "restarted" },
    RoomEvent: {
      TrackSubscribed: "trackSubscribed",
      TrackUnsubscribed: "trackUnsubscribed",
      ParticipantConnected: "participantConnected",
      ActiveSpeakersChanged: "activeSpeakersChanged",
      DataReceived: "dataReceived",
      LocalTrackPublished: "localTrackPublished",
      LocalTrackUnpublished: "localTrackUnpublished",
      AudioPlaybackStatusChanged: "audioPlaybackStatusChanged",
      TranscriptionReceived: "transcriptionReceived",
      Disconnected: "disconnected",
    },
  };
});

const emit = (ev: string, ...args: unknown[]) =>
  act(() => {
    dispatch(ev, ...args);
  });

/** The device drops out / comes back, as the browser reports it on the track. */
const deviceEnds = (t: { fire: (e: string) => void }) =>
  act(() => {
    t.fire("ended");
  });
const deviceRestarts = (t: { fire: (e: string) => void }) =>
  act(() => {
    t.fire("restarted");
  });

const kindsSent = () =>
  svc.logIntegrityEvents.mock.calls.flatMap((c) => c[1].map((e: { kind: string }) => e.kind));

async function joined() {
  const hook = renderHook(() => useInterviewRoom());
  await act(async () => {
    await hook.result.current.start("ai_ml", "v-test", { micId: "mic1", camId: "cam1" });
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("live"));
  return hook;
}

describe("useInterviewRoom (camera, microphone + integrity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lk.cameraError = null;
    lk.micError = null;
    lk.rooms = [];
    lk.cam = lk.makeTrack("video");
    lk.mic = lk.makeTrack("audio");
    svc.startSession.mockResolvedValue({
      serverUrl: "wss://x",
      roomName: "ai-room1",
      participantToken: "t",
      maxMinutes: 20,
    });
    svc.logIntegrityEvents.mockResolvedValue({ accepted: 1 });
  });

  it("starts with the rules version and publishes mic and camera on the chosen devices", async () => {
    const { result } = await joined();
    expect(svc.startSession).toHaveBeenCalledWith("ai_ml", "v-test");
    const room = lk.rooms[0] as {
      localParticipant: { setMicrophoneEnabled: unknown; setCameraEnabled: unknown };
    };
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true, {
      deviceId: "mic1",
    });
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, {
      deviceId: "cam1",
    });
    expect(result.current.roomName).toBe("ai-room1");
    expect(result.current.micLost).toBe(false);
    expect(result.current.cameraLost).toBe(false);
  });

  it("a company interview starts from the invitation, with the same devices, not as practice", async () => {
    svc.startInviteSession.mockResolvedValue({
      serverUrl: "wss://x",
      roomName: "ai-inv1",
      participantToken: "t",
      maxMinutes: 25,
    });
    const hook = renderHook(() => useInterviewRoom());
    await act(async () => {
      await hook.result.current.startInvite("inv-1", "v-test", { micId: "mic1", camId: "cam1" });
    });
    await waitFor(() => expect(hook.result.current.phase).toBe("live"));
    expect(svc.startInviteSession).toHaveBeenCalledWith("inv-1", "v-test");
    expect(svc.startSession).not.toHaveBeenCalled();
    expect(hook.result.current.roomName).toBe("ai-inv1");
    const room = lk.rooms[0] as { localParticipant: { setCameraEnabled: unknown } };
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, { deviceId: "cam1" });
  });

  it("a rejected invitation (expired, already used) returns to setup with the reason", async () => {
    svc.startInviteSession.mockRejectedValue(new Error("This invitation has expired."));
    const hook = renderHook(() => useInterviewRoom());
    await act(async () => {
      await hook.result.current.startInvite("inv-1", "v-test");
    });
    await waitFor(() => expect(hook.result.current.phase).toBe("setup"));
    expect(hook.result.current.error).toBeTruthy();
    expect(lk.rooms).toHaveLength(0); // no room was opened
  });

  it("refuses to run without a camera and returns to setup with a clear error", async () => {
    lk.cameraError = new Error("denied");
    const hook = renderHook(() => useInterviewRoom());
    await act(async () => {
      await hook.result.current.start("ai_ml", "v-test");
    });
    await waitFor(() => expect(hook.result.current.phase).toBe("setup"));
    expect(hook.result.current.error).toMatch(/camera access is required/i);
  });

  it("refuses to run without a microphone and returns to setup with a clear error", async () => {
    lk.micError = new Error("denied");
    const hook = renderHook(() => useInterviewRoom());
    await act(async () => {
      await hook.result.current.start("ai_ml", "v-test");
    });
    await waitFor(() => expect(hook.result.current.phase).toBe("setup"));
    expect(hook.result.current.error).toMatch(/microphone access is required/i);
  });

  it("saves a reported tab departure against the live room with its time offset", async () => {
    const { result } = await joined();
    act(() => result.current.reportIntegrity("tab_hidden"));
    await waitFor(() => expect(svc.logIntegrityEvents).toHaveBeenCalledTimes(1));
    const [room, events] = svc.logIntegrityEvents.mock.calls[0];
    expect(room).toBe("ai-room1");
    expect(events).toEqual([{ kind: "tab_hidden", offsetSeconds: expect.any(Number) }]);
  });

  describe("device dropouts", () => {
    it("records camera_lost once when the camera ends, camera_restored when it restarts", async () => {
      const { result } = await joined();
      deviceEnds(lk.cam);
      deviceEnds(lk.cam); // duplicate must not double report
      await waitFor(() => expect(kindsSent()).toEqual(["camera_lost"]));
      expect(result.current.cameraLost).toBe(true);
      expect(result.current.micLost).toBe(false);

      deviceRestarts(lk.cam);
      await waitFor(() => expect(kindsSent()).toEqual(["camera_lost", "camera_restored"]));
      expect(result.current.cameraLost).toBe(false);
    });

    it("records mic_lost once when the microphone ends, mic_restored when it restarts", async () => {
      const { result } = await joined();
      deviceEnds(lk.mic);
      deviceEnds(lk.mic);
      await waitFor(() => expect(kindsSent()).toEqual(["mic_lost"]));
      expect(result.current.micLost).toBe(true);
      expect(result.current.cameraLost).toBe(false);

      deviceRestarts(lk.mic);
      await waitFor(() => expect(kindsSent()).toEqual(["mic_lost", "mic_restored"]));
      expect(result.current.micLost).toBe(false);
    });

    it("tracks the camera and microphone independently", async () => {
      const { result } = await joined();
      deviceEnds(lk.cam);
      deviceEnds(lk.mic);
      deviceRestarts(lk.cam);
      await waitFor(() =>
        expect(kindsSent()).toEqual(["camera_lost", "mic_lost", "camera_restored"]),
      );
      expect(result.current.cameraLost).toBe(false);
      expect(result.current.micLost).toBe(true);
    });

    it("treats an unpublished camera or microphone as lost", async () => {
      const { result } = await joined();
      emit("localTrackUnpublished", { track: lk.mic });
      await waitFor(() => expect(kindsSent()).toEqual(["mic_lost"]));
      expect(result.current.micLost).toBe(true);
      // Publishing it again means the device is back.
      emit("localTrackPublished", { track: lk.mic });
      await waitFor(() => expect(kindsSent()).toEqual(["mic_lost", "mic_restored"]));
    });

    it("retrying restarts and unmutes the lost microphone", async () => {
      const { result } = await joined();
      deviceEnds(lk.mic);
      await waitFor(() => expect(result.current.micLost).toBe(true));
      await act(async () => {
        await result.current.retryMic();
      });
      expect(lk.mic.restartTrack).toHaveBeenCalledOnce();
      expect(lk.mic.unmute).toHaveBeenCalledOnce();
      await waitFor(() => expect(result.current.micLost).toBe(false));
      await waitFor(() => expect(kindsSent()).toEqual(["mic_lost", "mic_restored"]));
    });

    it("retrying restarts and unmutes the lost camera", async () => {
      const { result } = await joined();
      deviceEnds(lk.cam);
      await waitFor(() => expect(result.current.cameraLost).toBe(true));
      await act(async () => {
        await result.current.retryCamera();
      });
      expect(lk.cam.restartTrack).toHaveBeenCalledOnce();
      await waitFor(() => expect(result.current.cameraLost).toBe(false));
    });

    it("stays lost, without a false restore, when the device still fails", async () => {
      const { result } = await joined();
      deviceEnds(lk.mic);
      await waitFor(() => expect(result.current.micLost).toBe(true));
      lk.mic.restartTrack.mockRejectedValueOnce(new Error("device busy"));
      await act(async () => {
        await result.current.retryMic();
      });
      expect(result.current.micLost).toBe(true);
      expect(kindsSent()).toEqual(["mic_lost"]);
    });

    it("does not report any device fault when the candidate ends the call", async () => {
      const { result } = await joined();
      await act(async () => {
        result.current.end();
      });
      await waitFor(() => expect(result.current.phase).toBe("ended"));
      expect(svc.logIntegrityEvents).not.toHaveBeenCalled();
      expect(result.current.cameraLost).toBe(false);
      expect(result.current.micLost).toBe(false);
    });
  });

  it("keeps events queued when saving fails and resends them with the next event", async () => {
    svc.logIntegrityEvents.mockRejectedValueOnce(new Error("offline"));
    const { result } = await joined();
    act(() => result.current.reportIntegrity("tab_hidden"));
    await waitFor(() => expect(svc.logIntegrityEvents).toHaveBeenCalledTimes(1));

    act(() => result.current.reportIntegrity("window_blur"));
    await waitFor(() => expect(svc.logIntegrityEvents).toHaveBeenCalledTimes(2));
    const resent = svc.logIntegrityEvents.mock.calls[1][1].map((e: { kind: string }) => e.kind);
    expect(resent).toEqual(["tab_hidden", "window_blur"]);
  });

  describe("interviewer's video check notices", () => {
    const send = (obj: unknown, topic = "integrity", from: unknown = { isLocal: false }) =>
      emit("dataReceived", new TextEncoder().encode(JSON.stringify(obj)), from, 0, topic);

    it("shows a flagged problem, then clears it when the interviewer clears it", async () => {
      const { result } = await joined();
      send({ kind: "multiple_faces", state: "flagged" });
      expect(result.current.videoFlag).toBe("multiple_faces");
      send({ kind: "multiple_faces", state: "cleared" });
      expect(result.current.videoFlag).toBeNull();
    });

    it("keeps a newer problem when an older one clears", async () => {
      const { result } = await joined();
      send({ kind: "no_face", state: "flagged" });
      send({ kind: "camera_blocked", state: "flagged" });
      send({ kind: "no_face", state: "cleared" });
      expect(result.current.videoFlag).toBe("camera_blocked");
    });

    it("ignores notices from other topics, from the local participant, or with no sender", async () => {
      const { result } = await joined();
      send({ kind: "no_face", state: "flagged" }, "chat");
      send({ kind: "no_face", state: "flagged" }, "integrity", { isLocal: true });
      send({ kind: "no_face", state: "flagged" }, "integrity", null);
      expect(result.current.videoFlag).toBeNull();
    });

    it("does not save interviewer notices as browser integrity events", async () => {
      await joined();
      send({ kind: "no_face", state: "flagged" });
      expect(svc.logIntegrityEvents).not.toHaveBeenCalled();
    });
  });

  it("ignores integrity signals when there is no live session", () => {
    const { result } = renderHook(() => useInterviewRoom());
    act(() => result.current.reportIntegrity("tab_hidden"));
    expect(svc.logIntegrityEvents).not.toHaveBeenCalled();
  });
});
