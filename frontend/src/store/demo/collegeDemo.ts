import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
// Relative (not "@/") so the store can be unit-tested with plain `node --test`.
import { buildSeedState, DEMO_STATE_VERSION, type DemoState } from "../../lib/demo/college/seed.ts";

/**
 * The visitor's private copy of the sample college.
 *
 * - Lives in sessionStorage: it survives refreshes and in-tab navigation, but is
 *   per-tab, never shared with other tabs/users, and gone when the tab closes.
 * - Entirely separate from the real auth store ("mirracle.auth") and from every
 *   API: nothing in here is ever sent anywhere.
 * - Anything unreadable, stale or tampered with is replaced by a fresh seed.
 */

interface CollegeDemoStore {
  data: DemoState;
  /** Run a mutation on a private copy; it is committed only if `fn` doesn't throw. */
  mutate: <T>(fn: (draft: DemoState) => T) => T;
  /** Discard every demo change and restore the original sample college. */
  reset: () => void;
}

export const COLLEGE_DEMO_STORAGE_KEY = "mirracle.demo.college";

/** sessionStorage can be missing (SSR), blocked or full — the demo must keep working in memory. */
const safeSessionStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.sessionStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.sessionStorage.setItem(name, value);
    } catch {
      /* quota / blocked — keep the in-memory state */
    }
  },
  removeItem: (name) => {
    try {
      window.sessionStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

function isValidState(value: unknown): value is DemoState {
  const v = value as Partial<DemoState> | null;
  return (
    !!v &&
    v.version === DEMO_STATE_VERSION &&
    Array.isArray(v.students) &&
    Array.isArray(v.drives) &&
    Array.isArray(v.departments)
  );
}

export const useCollegeDemoStore = create<CollegeDemoStore>()(
  persist(
    (set, get) => ({
      data: buildSeedState(),
      mutate: (fn) => {
        const draft = structuredClone(get().data);
        const result = fn(draft);
        set({ data: draft });
        return result;
      },
      reset: () => set({ data: buildSeedState() }),
    }),
    {
      name: COLLEGE_DEMO_STORAGE_KEY,
      version: DEMO_STATE_VERSION,
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: (s) => ({ data: s.data }),
      merge: (persisted, current) => {
        const data = (persisted as { data?: unknown } | null)?.data;
        return { ...current, data: isValidState(data) ? data : current.data };
      },
    },
  ),
);
