import type { Session, User, UserRole } from "@/types";
import { request } from "./client";
import { useAuthStore } from "@/store/auth";

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
    useAuthStore.getState().setSession(session);
    return session;
  },

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot", { method: "POST", body: { email } }),

  verifyOtp: (email: string, code: string) =>
    request<{ ok: true }>("/auth/otp/verify", { method: "POST", body: { email, code } }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/auth/reset", { method: "POST", body: { token, password } }),

  updateProfile: (patch: Partial<User>) =>
    request<User>("/auth/profile", { method: "PATCH", body: patch }),

  logout: async () => {
    await request<{ ok: true }>("/auth/logout", { method: "POST" });
    useAuthStore.getState().logout();
  },
};
