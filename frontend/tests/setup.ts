import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  try {
    localStorage.clear();
  } catch {
    /* jsdom storage unavailable */
  }
});
