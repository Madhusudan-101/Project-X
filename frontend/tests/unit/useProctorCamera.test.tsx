import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProctorCamera } from "@/components/candidate/oa/useProctorCamera";

function fakeStream() {
  const track = { stop: vi.fn(), onended: null as null | (() => void) };
  const stream = {
    active: true,
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

describe("useProctorCamera", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    // jsdom has no canvas/video pipeline: stand in for the pieces the hook touches.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,AAAA",
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const opts = (over = {}) => ({
    enabled: true,
    intervalSeconds: 60,
    onSnapshot: vi.fn(),
    onEvent: vi.fn(),
    ...over,
  });

  /** give the hook a <video> that looks like it is playing */
  const withVideo = (result: { current: { videoRef: { current: HTMLVideoElement | null } } }) => {
    const v = document.createElement("video");
    Object.defineProperty(v, "readyState", { value: 4 });
    Object.defineProperty(v, "videoWidth", { value: 640 });
    result.current.videoRef.current = v;
  };

  it("does nothing while disabled (no consent / camera off)", () => {
    const o = opts({ enabled: false });
    const { result } = renderHook(() => useProctorCamera(o));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("opens the camera and sends a snapshot shortly after, then again on a jittered interval", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const o = opts();
    const { result } = renderHook(() => useProctorCamera(o));
    withVideo(result);
    await act(async () => {});
    expect(result.current.status).toBe("on");
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(o.onSnapshot).toHaveBeenCalledTimes(1);
    expect(o.onSnapshot).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA", null);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 * 1.31); // the longest the jitter allows
    });
    expect(o.onSnapshot).toHaveBeenCalledTimes(2);
  });

  it("reports camera_denied when permission is refused", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const o = opts();
    const { result } = renderHook(() => useProctorCamera(o));
    await act(async () => {});
    expect(result.current.status).toBe("denied");
    expect(o.onEvent).toHaveBeenCalledWith("camera_denied");
    expect(o.onSnapshot).not.toHaveBeenCalled();
  });

  it("reports camera_lost when the track ends, and camera_restored after a retry", async () => {
    const first = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream);
    const o = opts();
    const { result } = renderHook(() => useProctorCamera(o));
    await act(async () => {});
    act(() => first.track.onended?.());
    expect(result.current.status).toBe("lost");
    expect(o.onEvent).toHaveBeenCalledWith("camera_lost");

    getUserMedia.mockResolvedValueOnce(fakeStream().stream);
    await act(async () => result.current.retry());
    expect(result.current.status).toBe("on");
    expect(o.onEvent).toHaveBeenCalledWith("camera_restored");
  });

  it("stops the camera and the snapshots when disabled again (submit / unmount)", async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const o = opts();
    const { result, rerender, unmount } = renderHook((p) => useProctorCamera(p), {
      initialProps: o,
    });
    withVideo(result);
    await act(async () => {});
    rerender({ ...o, enabled: false });
    expect(track.stop).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(o.onSnapshot).not.toHaveBeenCalled();
    unmount();
  });

  it("includes the browser's face count when it can detect faces", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    (window as unknown as { FaceDetector: unknown }).FaceDetector = class {
      detect = async () => [{}, {}];
    };
    const o = opts();
    const { result } = renderHook(() => useProctorCamera(o));
    withVideo(result);
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(o.onSnapshot).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA", 2);
    delete (window as unknown as { FaceDetector?: unknown }).FaceDetector;
  });
});
