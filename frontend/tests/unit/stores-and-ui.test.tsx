import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/auth";
import { ROOM_TTL_MS, usePeerInterviewStore } from "@/store/candidate/peerInterview";
import { useAdminRangeStore } from "@/store/admin/dateRange";
import { useResumeAnalysisStore } from "@/store/candidate/resumeAnalysis";
import { useCompanyStore } from "@/store/company/company";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SafeHtml } from "@/components/candidate/oa/SafeHtml";
import { reservePeerMeetTab } from "@/lib/peerMeetTab";
import { consumeLastCapturedError } from "@/lib/error-capture";
import type { Session } from "@/types";

const sess = (): Session =>
  ({
    token: "t",
    refreshToken: "r",
    expiresAt: "9999999999",
    user: { id: "1", email: "a@b.co", name: "A", role: "candidate" },
  }) as Session;

describe("auth store", () => {
  it("sets, patches and clears the session", () => {
    const s = useAuthStore.getState();
    s.setSession(sess());
    s.updateUser({ name: "New", skills: ["Go"] });
    expect(useAuthStore.getState().session?.user).toMatchObject({ name: "New", skills: ["Go"] });
    expect(useAuthStore.getState().session?.user.email).toBe("a@b.co");
    s.logout();
    expect(useAuthStore.getState().session).toBeNull();
  });
  it("updateUser is a no-op when logged out", () => {
    useAuthStore.setState({ session: null });
    useAuthStore.getState().updateUser({ name: "x" });
    expect(useAuthStore.getState().session).toBeNull();
  });
  it("persists under the mirracle.auth key", () => {
    useAuthStore.getState().setSession(sess());
    expect(JSON.parse(localStorage.getItem("mirracle.auth")!).state.session.token).toBe("t");
    useAuthStore.setState({ session: null });
  });
});

describe("peer interview store", () => {
  it("returns a fresh room and drops a stale one", () => {
    vi.useFakeTimers();
    const st = usePeerInterviewStore.getState();
    st.setActiveRoom("room-1", true);
    expect(usePeerInterviewStore.getState().getActiveRoom()?.roomId).toBe("room-1");
    vi.advanceTimersByTime(ROOM_TTL_MS + 1);
    expect(usePeerInterviewStore.getState().getActiveRoom()).toBeNull();
    expect(usePeerInterviewStore.getState().activeRoom).toBeNull();
    vi.useRealTimers();
  });
  it("does not persist the per-session refresh counter", () => {
    usePeerInterviewStore.getState().bumpScheduledMeetings();
    expect(usePeerInterviewStore.getState().scheduledMeetingsVersion).toBeGreaterThan(0);
    const persisted = JSON.parse(localStorage.getItem("mirracle.peerInterview") ?? "{}");
    expect(persisted.state).not.toHaveProperty("scheduledMeetingsVersion");
  });
});

describe("admin range store", () => {
  it("switching to custom stores the dates and a preset resets the mode", () => {
    const s = useAdminRangeStore.getState();
    s.setCustom("2026-01-01", "2026-01-31");
    expect(useAdminRangeStore.getState()).toMatchObject({
      preset: "custom",
      customFrom: "2026-01-01",
    });
    s.setPreset("today");
    expect(useAdminRangeStore.getState().preset).toBe("today");
  });
});

describe("useDebouncedValue", () => {
  it("only emits the last value after the delay", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });
    rerender({ v: "ab" });
    rerender({ v: "abc" });
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe("abc");
    vi.useRealTimers();
  });
});

describe("SafeHtml (XSS hardening of problem statements)", () => {
  const html = (h: string) => render(<SafeHtml html={h} />).container.firstElementChild!.innerHTML;

  it("keeps allowed text-level tags", () => {
    expect(html("<p>Hi <strong>there</strong></p>")).toBe("<p>Hi <strong>there</strong></p>");
  });
  it("drops script/style/iframe/svg content entirely", () => {
    const out = html(
      '<p>ok</p><script>alert(1)</script><style>x{}</style><iframe src="//e"></iframe><svg><circle/></svg>',
    );
    expect(out).toBe("<p>ok</p>");
  });
  it("never copies attributes (onerror/href/style/class)", () => {
    const out = html(
      '<p onclick="x()" style="color:red" class="a">hi</p><span id="z" onmouseover="y()">s</span>',
    );
    expect(out).not.toMatch(/onclick|onmouseover|style=|class=|id=/);
  });
  it("unwraps unknown elements but keeps their text", () => {
    expect(html("<a href='javascript:alert(1)'>click</a>")).toBe("click");
    expect(html("<img src=x onerror=alert(1)>")).toBe("");
  });
  it("escapes text that looks like markup", () => {
    expect(html("a &lt;b&gt; c")).toBe("a &lt;b&gt; c");
  });
  it("renders nothing harmful for empty input", () => {
    expect(html("")).toBe("");
  });
});

describe("reservePeerMeetTab", () => {
  const fakeWin = () => {
    const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    return {
      closed: false,
      document: doc,
      location: { replace: vi.fn() },
      close: vi.fn(function (this: { closed: boolean }) {
        this.closed = true;
      }),
    };
  };

  it("writes a placeholder and navigates the reserved tab (exactly one tab)", () => {
    const w = fakeWin();
    const open = vi.fn().mockReturnValue(w);
    vi.stubGlobal("open", open);
    const h = reservePeerMeetTab({ title: "T<script>", message: "M" });
    expect(h.isAvailable()).toBe(true);
    expect(w.document.write.mock.calls[0][0]).toContain("T&lt;script>");
    h.navigate("https://peer/room");
    h.navigate("https://peer/other"); // idempotent
    expect(w.location.replace).toHaveBeenCalledTimes(1);
    expect(w.location.replace).toHaveBeenCalledWith("https://peer/room");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("falls back to ONE fresh tab when the pop-up was blocked", () => {
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);
    const h = reservePeerMeetTab();
    expect(h.isAvailable()).toBe(false);
    h.navigate("https://peer/room");
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith("https://peer/room", "_blank");
  });

  it("falls back when location.replace throws, closing the placeholder tab", () => {
    const w = fakeWin();
    w.location.replace.mockImplementation(() => {
      throw new Error("sandboxed");
    });
    const open = vi.fn().mockReturnValue(w);
    vi.stubGlobal("open", open);
    reservePeerMeetTab().navigate("https://p/r");
    expect(w.close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("abort closes the tab and blocks a later navigate from opening anything", () => {
    const w = fakeWin();
    const open = vi.fn().mockReturnValue(w);
    vi.stubGlobal("open", open);
    const h = reservePeerMeetTab();
    h.abort();
    h.navigate("https://p/r");
    expect(w.close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("survives window.open throwing", () => {
    vi.stubGlobal(
      "open",
      vi.fn().mockImplementation(() => {
        throw new Error("blocked");
      }),
    );
    expect(() => reservePeerMeetTab()).not.toThrow();
  });
});

describe("error-capture", () => {
  it("returns undefined when nothing captured and consumes once", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
    const err = new Error("boom");
    globalThis.dispatchEvent(new ErrorEvent("error", { error: err }));
    expect(consumeLastCapturedError()).toBe(err);
    expect(consumeLastCapturedError()).toBeUndefined();
  });
  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    globalThis.dispatchEvent(new ErrorEvent("error", { error: new Error("old") }));
    vi.advanceTimersByTime(6000);
    expect(consumeLastCapturedError()).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("persisted stores clear independently", () => {
  it("resume + company stores reset", () => {
    useResumeAnalysisStore.getState().setResult({} as never, "SDE");
    useCompanyStore.getState().setCompany({ id: "c" } as never);
    useResumeAnalysisStore.getState().clear();
    useCompanyStore.getState().clearCompany();
    expect(useResumeAnalysisStore.getState().result).toBeNull();
    expect(useCompanyStore.getState().company).toBeNull();
    // unrelated usage so render import isn't flagged
    expect(screen).toBeDefined();
  });
});
