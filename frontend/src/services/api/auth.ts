import type { Session, User, UserRole } from "@/types";
import { request } from "./client";
import { useAuthStore } from "@/store/auth";
import { useResumeAnalysisStore } from "@/store/candidate/resumeAnalysis";
import { useCompanyStore } from "@/store/company/company";

// Real backend calls — no mocks
export const authService = {
  login: async (email: string, password: string, role: UserRole): Promise<Session> => {
    const session = await request<Session>("/auth/login", {
      method: "POST",
      body: { email, password, role },
    });
    useAuthStore.getState().setSession(session);
    return session;
  },

  signup: async (
    email: string,
    password: string,
    role: UserRole,
    name: string,
    firstName?: string,
    lastName?: string,
  ): Promise<Session> => {
    const session = await request<Session>("/auth/signup", {
      method: "POST",
      body: { email, password, role, name, first_name: firstName, last_name: lastName },
    });
    // Only persist a "logged in" session when a real token came back — an
    // empty token means email verification is still pending (OTP required).
    if (session.token) {
      useAuthStore.getState().setSession(session);
    }
    return session;
  },

  /** Exchange a Supabase OAuth (Google) session for an app session — creates
   * the profiles row on first sign-in via the backend's self-heal logic. */
  completeOAuthSession: (
    accessToken: string,
    refreshToken: string,
    expiresAt: string,
    role: UserRole,
  ): Promise<Session> =>
    request<Session>("/auth/oauth-session", {
      method: "POST",
      body: { accessToken, refreshToken, expiresAt, role },
    }),

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot", { method: "POST", body: { email } }),

  verifyOtp: (email: string, code: string) =>
    request<Session>("/auth/otp/verify", { method: "POST", body: { email, code } }),

  /** Re-send the signup confirmation code. Password-reset codes are re-sent
   * via forgotPassword() instead. */
  resendOtp: (email: string) =>
    request<{ ok: true }>("/auth/otp/resend", { method: "POST", body: { email } }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/auth/reset", { method: "POST", body: { token, password } }),

  /** One-time password set for accounts created via Google — they never
   * have a password otherwise, since Google never shares it with us. */
  setPassword: (password: string) =>
    request<{ ok: true }>("/auth/set-password", { method: "POST", body: { password } }),

  updateProfile: (patch: Partial<User>) =>
    request<User>("/auth/profile", { method: "PATCH", body: patch }),

  logout: async () => {
    await request<{ ok: true }>("/auth/logout", { method: "POST" });
    useAuthStore.getState().logout();
    // Account-scoped client caches must not survive a logout — otherwise
    // the next login on this browser (any account) can see stale data.
    useResumeAnalysisStore.getState().clear();
    useCompanyStore.getState().clearCompany();
  },
};
