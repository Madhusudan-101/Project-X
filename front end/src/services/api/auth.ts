import type { Session, User, UserRole } from "@/types";
import { request } from "./client";

// Mock in-memory user; replaced once FastAPI /auth endpoints are wired.
// NOTE: we intentionally leave `name` blank so the app prompts the user for
// their real first/last name on first login instead of guessing from email.
const mockUser = (role: UserRole, email: string): User => ({
  id: crypto.randomUUID(),
  email,
  name: "",
  role,
  onboarded: false,
});

export const authService = {
  login: (email: string, _password: string, role: UserRole) =>
    request<Session>("/auth/login", { method: "POST", body: { email, role } }, () => ({
      user: mockUser(role, email),
      token: "mock-jwt-token",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    })),

  signup: (email: string, _password: string, role: UserRole, name: string, firstName?: string, lastName?: string) =>
    request<Session>("/auth/signup", { method: "POST", body: { email, role, name, firstName, lastName } }, () => ({
      user: { ...mockUser(role, email), name, firstName, lastName },
      token: "mock-jwt-token",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    })),

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/auth/forgot", { method: "POST", body: { email } }, () => ({
      ok: true as const,
    })),

  verifyOtp: (email: string, code: string) =>
    request<{ ok: true }>("/auth/otp/verify", { method: "POST", body: { email, code } }, () => ({
      ok: true as const,
    })),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>(
      "/auth/reset",
      { method: "POST", body: { token, password } },
      () => ({ ok: true as const }),
    ),

  updateProfile: (patch: Partial<User>) =>
    request<User>("/auth/profile", { method: "PATCH", body: patch }, () => ({
      id: "mock",
      email: "mock@example.com",
      name: "Mock User",
      role: "candidate",
      onboarded: true,
      ...patch,
    })),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }, () => ({ ok: true })),
};
