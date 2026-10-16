import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInterviewRoom } from "@/components/candidate/ai-interview/useInterviewRoom";

const svc = vi.hoisted(() => ({
  startSession: vi.fn(),
  logIntegrityEvents: vi.fn(),
}));
vi.mock("@/services/api/candidate/aiInterview", () => ({ aiInterviewService: svc }));
vi.mock("@/services/api/client", () => ({
  ApiClientError: class ApiClientError extends Error {},
}));

type Handler = (...a: unknown[]) => void;
const lk = vi.hoisted(() => ({
  handlers: {} as Record<string, Handler[]>,
  cameraError: null as Error | null,
  rooms: [] as unknown[],
}));

vi.mock("livekit-client", () => {
  class FakeRoom {
    remoteParticipants = new Map<string, unknown>([["agent", {}]]);
    localParticipant = {
      setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
      setCameraEnabled: vi.fn(async () => {
        if (lk.cameraError) throw lk.cameraError;
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
      emit("localTrackUnpublished", { track: { kind: "video" } });
      emit("disconnected");
    });
  }
  return {
    Room: FakeRoom,
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
    (lk.handlers[ev] ?? []).forEach((h) => h(...args));
  });

const videoPub = { track: { kind: "video" } };

async function joined() {
  const hook = renderHook(() => useInterviewRoom());
  await act(async () => {
    await hook.result.current.start("ai_ml", "v-test", { micId: "mic1", camId: "cam1" });
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("live"));
  return hook;
}

describe("useInterviewRoom (camera + integrity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lk.cameraError = null;
    lk.rooms = [];
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

  it("saves a reported tab departure against the live room with its time offset", async () => {
    const { result } = await joined();
    act(() => result.current.reportIntegrity("tab_hidden"));
    await waitFor(() => expect(svc.logIntegrityEvents).toHaveBeenCalledTimes(1));
    const [room, events] = svc.logIntegrityEvents.mock.calls[0];
    expect(room).toBe("ai-room1");
    expect(events).toEqual([{ kind: "tab_hidden", offsetSeconds: expect.any(Number) }]);
  });

  it("records camera_lost once, then camera_restored when the camera returns", async () => {
    const { result } = await joined();
    emit("localTrackUnpublished", videoPub);
    emit("localTrackUnpublished", videoPub); // duplicate must not double report
    await waitFor(() => expect(svc.logIntegrityEvents).toHaveBeenCalledTimes(1));
    expect(svc.logIntegrityEvents.mock.calls[0][1][0].kind).toBe("camera_lost");
    expect(result.current.cameraLost).toBe(true);

    emit("localTrackPublished", videoPub);
    await waitFor(() => expect(svc.logIntegrityEvents).toHaveBeenCalledTimes(2));
    expect(svc.logIntegrityEvents.mock.calls[1][1][0].kind).toBe("camera_restored");
    expect(result.current.cameraLost).toBe(false);
  });

  it("does not report a camera fault when the candidate ends the call", async () => {
    const { result } = await joined();
    await act(async () => {
      result.current.end();
    });
    await waitFor(() => expect(result.current.phase).toBe("ended"));
    expect(svc.logIntegrityEvents).not.toHaveBeenCalled();
    expect(result.current.cameraLost).toBe(true); // UI state only; nothing was logged
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

  it("sends the rules version and consent flags to the backend on join", async () => {
    await joined();
    expect(svc.startSession).toHaveBeenCalledWith("ai_ml", "v-test");
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
