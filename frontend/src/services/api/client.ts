/**
 * Mock API client — swap the base + fetch implementation for the FastAPI backend later.
 * All service files consume this so the migration is a one-file change.
 */

import { useAuthStore } from "@/store/auth";
import type { Session } from "@/types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// Paths that must never trigger a refresh-and-retry (avoids infinite loops
// and refreshing on the very endpoints that establish/replace the session).
const NO_REFRESH_PATHS = new Set(["/auth/refresh", "/auth/login", "/auth/signup"]);

// Dedupes concurrent 401s into a single in-flight refresh call.
let refreshPromise: Promise<string | null> | null = null;

/** Exchange the stored refresh_token for a new access token. Logs the user
 * out (clearing the session) if the refresh_token itself is invalid/expired. */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  const refreshToken = useAuthStore.getState().session?.refreshToken;
  if (!refreshToken) return null;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        useAuthStore.getState().logout();
        return null;
      }
      const session = (await res.json()) as Session;
      useAuthStore.getState().setSession(session);
      return session.token;
    } catch {
      useAuthStore.getState().logout();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class ApiClientError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Base URL for services that need to build a `fetch()` call manually (file uploads, blobs). */
export function getApiBaseUrl(): string {
  return BASE_URL;
}

/** Authorization header for services that bypass `request()` (FormData/blob calls).
 * Proactively refreshes first if the current access token has already expired. */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const session = useAuthStore.getState().session;
  if (!session) return {};

  let token = session.token;
  const expiresAt = Number(session.expiresAt);
  if (expiresAt && Date.now() / 1000 >= expiresAt) {
    token = (await refreshAccessToken()) ?? "";
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Mock request. Currently resolves via `mockHandler` — replace with `fetch(BASE_URL + path)`
 * when FastAPI endpoints are live.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
  mockHandler?: () => Promise<T> | T,
): Promise<T> {
  if (mockHandler) {
    // Simulate network latency so loading states are exercised in the UI.
    await new Promise((r) => setTimeout(r, 350));
    return mockHandler();
  }

  const isFormData = options.body instanceof FormData;
  const method = options.method ?? "GET";
  const body = options.body
    ? (isFormData ? (options.body as any) : JSON.stringify(options.body))
    : undefined;

  const buildHeaders = (token: string | undefined): Record<string, string> => {
    const headers: Record<string, string> = { ...options.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (!isFormData) headers["Content-Type"] = "application/json";
    return headers;
  };

  const initialToken = useAuthStore.getState().session?.token;
  let res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: buildHeaders(initialToken),
    body,
    signal: options.signal,
  });

  // Expired access token: refresh once and retry the same request.
  if (res.status === 401 && initialToken && !NO_REFRESH_PATHS.has(path)) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: buildHeaders(newToken),
        body,
        signal: options.signal,
      });
    } else {
      // No (or no longer valid) refresh_token — refreshAccessToken() already
      // logged the user out. Surface a message the UI can actually act on
      // instead of leaking Supabase's raw "invalid JWT" string.
      throw new ApiClientError("Your session has expired. Please log in again.", 401, "session_expired");
    }
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message =
      typeof errBody.detail === "string" ? errBody.detail : (errBody.message ?? res.statusText);
    throw new ApiClientError(message, res.status, errBody.code);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
