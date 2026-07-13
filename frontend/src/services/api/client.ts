/**
 * Mock API client — swap the base + fetch implementation for the FastAPI backend later.
 * All service files consume this so the migration is a one-file change.
 */

import { useAuthStore } from "@/store/auth";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

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

  const token = useAuthStore.getState().session?.token;
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof body.detail === "string" ? body.detail : (body.message ?? res.statusText);
    throw new ApiClientError(message, res.status, body.code);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
