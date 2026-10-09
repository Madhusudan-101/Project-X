import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, buildQuery, getAuthHeader, request } from "@/services/api/client";
import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";

const session = (over: Partial<Session> = {}): Session =>
  ({
    token: "tok-1",
    refreshToken: "ref-1",
    expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
    user: { id: "u1", email: "a@b.co", name: "A", role: "candidate" },
    ...over,
  }) as Session;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  useAuthStore.setState({ session: null });
});

describe("buildQuery", () => {
  it("skips empty, null and undefined but keeps 0 and false", () => {
    expect(buildQuery({ a: 1, b: "", c: null, d: undefined, e: 0, f: false })).toBe(
      "?a=1&e=0&f=false",
    );
  });
  it("returns empty string when nothing to serialise", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ a: "" })).toBe("");
  });
  it("url-encodes values", () => {
    expect(buildQuery({ q: "a b&c" })).toBe("?q=a+b%26c");
  });
});

describe("request()", () => {
  it("sends bearer token + JSON body and parses JSON", async () => {
    useAuthStore.setState({ session: session() });
    const f = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal("fetch", f);
    const out = await request<{ ok: boolean }>("/x", { method: "POST", body: { a: 1 } });
    expect(out).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toMatch(/\/x$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe('{"a":1}');
  });

  it("does not set a JSON content-type for FormData (browser sets the boundary)", async () => {
    const f = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal("fetch", f);
    await request("/upload", { method: "POST", body: new FormData() });
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
    expect(f.mock.calls[0][1].body).toBeInstanceOf(FormData);
  });

  it("returns undefined on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await request("/x", { method: "DELETE" })).toBeUndefined();
  });

  it("surfaces string detail from FastAPI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "Nope" }, 409)));
    await expect(request("/x")).rejects.toMatchObject({ message: "Nope", status: 409 });
  });

  it("joins pydantic validation messages and strips 'Value error,'", async () => {
    const detail = [
      { loc: ["body", "email"], msg: "Value error, bad email", type: "value_error" },
      { loc: ["body", "x"], msg: "field required", type: "missing" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail }, 422)));
    await expect(request("/x")).rejects.toMatchObject({
      message: "bad email; field required",
      status: 422,
    });
  });

  it("falls back to statusText when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 502, statusText: "Bad Gateway" })),
    );
    const e = await request("/x").catch((x) => x);
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e.status).toBe(502);
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    useAuthStore.setState({ session: session() });
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ detail: "expired" }, 401))
      .mockResolvedValueOnce(json(session({ token: "tok-2", refreshToken: "ref-2" })))
      .mockResolvedValueOnce(json({ data: 1 }));
    vi.stubGlobal("fetch", f);
    expect(await request("/secure")).toEqual({ data: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[1][0]).toMatch(/\/auth\/refresh$/);
    expect(f.mock.calls[2][1].headers.Authorization).toBe("Bearer tok-2");
    expect(useAuthStore.getState().session?.token).toBe("tok-2");
  });

  it("dedupes concurrent 401s into ONE refresh call", async () => {
    useAuthStore.setState({ session: session() });
    let refreshes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/auth/refresh")) {
          refreshes++;
          await new Promise((r) => setTimeout(r, 10));
          return json(session({ token: "tok-2" }));
        }
        const auth = (init.headers as Record<string, string>).Authorization;
        return auth === "Bearer tok-2" ? json({ ok: 1 }) : json({ detail: "expired" }, 401);
      }),
    );
    await Promise.all([request("/a"), request("/b"), request("/c")]);
    expect(refreshes).toBe(1);
  });

  it("logs out and throws session_expired when refresh is rejected", async () => {
    useAuthStore.setState({ session: session() });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ detail: "expired" }, 401))
        .mockResolvedValueOnce(json({ detail: "bad refresh" }, 401)),
    );
    await expect(request("/secure")).rejects.toMatchObject({
      status: 401,
      code: "session_expired",
    });
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("clears the stale session when a 401 arrives and there is no refresh token", async () => {
    useAuthStore.setState({ session: session({ refreshToken: "" }) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "expired" }, 401)));
    await expect(request("/secure")).rejects.toMatchObject({ code: "session_expired" });
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("does not try to refresh on the login endpoint (wrong password stays a 401)", async () => {
    useAuthStore.setState({ session: session() });
    const f = vi.fn().mockResolvedValue(json({ detail: "Invalid credentials" }, 401));
    vi.stubGlobal("fetch", f);
    await expect(request("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      message: "Invalid credentials",
      status: 401,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("mock handler short-circuits the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.useFakeTimers();
    const p = request("/x", {}, () => "mocked");
    await vi.advanceTimersByTimeAsync(400);
    expect(await p).toBe("mocked");
    vi.useRealTimers();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("getAuthHeader()", () => {
  it("is empty without a session", async () => {
    expect(await getAuthHeader()).toEqual({});
  });
  it("returns the bearer for a live token", async () => {
    useAuthStore.setState({ session: session() });
    expect(await getAuthHeader()).toEqual({ Authorization: "Bearer tok-1" });
  });
  it("proactively refreshes an expired token", async () => {
    useAuthStore.setState({
      session: session({ expiresAt: String(Math.floor(Date.now() / 1000) - 10) }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(session({ token: "fresh" }))));
    expect(await getAuthHeader()).toEqual({ Authorization: "Bearer fresh" });
  });
  it("returns no header when the expired token cannot be refreshed", async () => {
    useAuthStore.setState({
      session: session({ expiresAt: String(Math.floor(Date.now() / 1000) - 10) }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 401)));
    expect(await getAuthHeader()).toEqual({});
  });
});
