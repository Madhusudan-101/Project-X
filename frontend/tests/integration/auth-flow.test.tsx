/**
 * Integration: authService + api client + zustand stores + route guard working
 * together against a scripted fake backend (no network).
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { authService } from "@/services/api/auth";
import { request } from "@/services/api/client";
import { useAuthStore } from "@/store/auth";
import { useResumeAnalysisStore } from "@/store/candidate/resumeAnalysis";
import { useCompanyStore } from "@/store/company/company";
import { useRoleGuard } from "@/hooks/use-role-guard";
import type { Session } from "@/types";

const mkSession = (token: string, role: Session["user"]["role"] = "candidate"): Session =>
  ({
    token,
    refreshToken: `r-${token}`,
    expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
    user: { id: "u", email: "a@b.co", name: "A", role },
  }) as Session;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  navigate.mockClear();
  toastError.mockClear();
  useAuthStore.setState({ session: null });
});

describe("login → authenticated call → token expiry → logout", () => {
  it("full lifecycle keeps stores consistent and wipes account-scoped caches", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url, "http://x").pathname.replace(/^\/api/, "");
        calls.push(`${init.method} ${path}`);
        const auth = (init.headers as Record<string, string>).Authorization;
        if (path === "/auth/login") return json(mkSession("t1"));
        if (path === "/auth/refresh") return json(mkSession("t2"));
        if (path === "/auth/logout") return json({ ok: true });
        if (path === "/candidate/jobs") {
          return auth === "Bearer t2" ? json([{ id: "j1" }]) : json({ detail: "expired" }, 401);
        }
        return json({}, 404);
      }),
    );

    const s = await authService.login("a@b.co", "pw", "candidate");
    expect(s.token).toBe("t1");
    expect(useAuthStore.getState().session?.token).toBe("t1");

    useResumeAnalysisStore.getState().setResult({} as never, "SDE");
    useCompanyStore.getState().setCompany({ id: "c1" } as never);

    // token t1 is rejected by the server -> transparent refresh -> retry
    expect(await request("/candidate/jobs")).toEqual([{ id: "j1" }]);
    expect(useAuthStore.getState().session?.token).toBe("t2");
    expect(calls).toEqual([
      "POST /auth/login",
      "GET /candidate/jobs",
      "POST /auth/refresh",
      "GET /candidate/jobs",
    ]);

    await authService.logout();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useResumeAnalysisStore.getState().result).toBeNull();
    expect(useCompanyStore.getState().company).toBeNull();
  });

  it("signup that still needs email verification does NOT create a logged-in session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ ...mkSession(""), token: "", refreshToken: "" })),
    );
    await authService.signup("n@b.co", "pw12345678", "candidate", "New User", "New", "User");
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("signup sends first/last name in snake_case to the API", async () => {
    const f = vi.fn().mockResolvedValue(json(mkSession("tok")));
    vi.stubGlobal("fetch", f);
    await authService.signup("n@b.co", "pw", "company", "Co", "First", "Last");
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({
      first_name: "First",
      last_name: "Last",
      role: "company",
    });
    expect(useAuthStore.getState().session?.token).toBe("tok");
  });

  it("a failed login leaves any previous session untouched and surfaces the API message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ detail: "Invalid login credentials" }, 401)),
    );
    await expect(authService.login("a@b.co", "bad", "candidate")).rejects.toThrow(
      "Invalid login credentials",
    );
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("profile update returns the user from the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ id: "u", name: "Z" })));
    expect(await authService.updateProfile({ name: "Z" })).toMatchObject({ name: "Z" });
  });
});

describe("useRoleGuard with the auth store", () => {
  it("redirects anonymous visitors to login for that role", async () => {
    const { result } = renderHook(() => useRoleGuard("company", "Company only"));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith({ to: "/auth/login", search: { role: "company" } });
    expect(result.current).toBeNull();
  });

  it("bounces a wrong-role user to the portal picker with a toast", async () => {
    useAuthStore.setState({ session: mkSession("t", "candidate") });
    const { result } = renderHook(() => useRoleGuard("admin", "Admins only"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/portals" }));
    expect(toastError).toHaveBeenCalledWith("Admins only");
    expect(result.current).toBeNull();
  });

  it("lets the right role through without redirecting", async () => {
    useAuthStore.setState({ session: mkSession("t", "college") });
    const { result } = renderHook(() => useRoleGuard("college", "x"));
    expect(result.current?.user.role).toBe("college");
    await new Promise((r) => setTimeout(r, 10));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reacts when the session is cleared mid-visit (e.g. refresh failure)", async () => {
    useAuthStore.setState({ session: mkSession("t", "candidate") });
    const { result } = renderHook(() => useRoleGuard("candidate", "x"));
    expect(result.current).not.toBeNull();
    useAuthStore.getState().logout();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/auth/login", search: { role: "candidate" } }),
    );
  });
});
