/**
 * Asks the person to accept the peer-interview guidelines when the server says they have not
 * (HTTP 428), then lets the original action carry on. One dialog for the whole dashboard.
 */
import { create } from "zustand";

interface GuidelinesState {
  open: boolean;
  /** Resolves true when accepted, false when dismissed. Concurrent callers share one dialog. */
  ensure: () => Promise<boolean>;
  finish: (accepted: boolean) => void;
}

let waiting: Array<(ok: boolean) => void> = [];

export const usePeerGuidelinesStore = create<GuidelinesState>((set) => ({
  open: false,
  ensure: () =>
    new Promise<boolean>((resolve) => {
      waiting.push(resolve);
      set({ open: true });
    }),
  finish: (accepted) => {
    const list = waiting;
    waiting = [];
    set({ open: false });
    list.forEach((resolve) => resolve(accepted));
  },
}));

export const PRECONDITION_REQUIRED = 428;

/**
 * Run a peer-interview action. If the server answers "accept the guidelines first", show the
 * guidelines, and when accepted run the action once more. Any other error passes straight through.
 */
export async function withGuidelines<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== PRECONDITION_REQUIRED) throw err;
    const accepted = await usePeerGuidelinesStore.getState().ensure();
    if (!accepted) throw err;
    return action();
  }
}
