/**
 * Peer Interview room store.
 *
 * Holds the room ID for the peer-interview session the CURRENT dashboard
 * user started or joined via matchmaking. Persisted so switching dashboard
 * tabs (which unmount the overview) or reopening the dashboard doesn't wipe
 * the visible room ID — the actual PeerMeet session lives in a separate
 * origin/tab.
 *
 * Only the room ID is persisted. The short-lived PeerMeet auth token is
 * NEVER put here — it lives in memory in the PeerMeet tab, per the
 * existing `PeerMeet/client/src/utils/authToken.js` contract.
 *
 * Every persisted room carries a `createdAt` timestamp; anything older than
 * ROOM_TTL_MS is treated as stale and dropped on access (see
 * `getActiveRoom()`). This prevents a stale `localStorage` room ID from a
 * previous session from misleading the user into re-opening a room that no
 * longer exists on the PeerMeet server (rooms are in-memory server-side).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ActivePeerRoom {
  roomId: string;
  createdAt: number;
  keepPrivate: boolean;
}

/** Rooms are dropped from the persisted store after this age. Matches
 * PeerMeet's server-side room lifetime headroom for a real interview. */
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface PeerInterviewState {
  activeRoom: ActivePeerRoom | null;
  setActiveRoom: (roomId: string, keepPrivate: boolean) => void;
  clearActiveRoom: () => void;
  /** Read the active room ONLY if it is still within TTL; drops it otherwise. */
  getActiveRoom: () => ActivePeerRoom | null;
  /** Bumped whenever scheduled meetings are created / cancelled, so any
   * consumer subscribed to it can re-fetch the persisted list. Kept out
   * of the persisted slice — it's a per-session refresh signal only. */
  scheduledMeetingsVersion: number;
  bumpScheduledMeetings: () => void;
}

export const usePeerInterviewStore = create<PeerInterviewState>()(
  persist(
    (set, get) => ({
      activeRoom: null,
      setActiveRoom: (roomId, keepPrivate) =>
        set({ activeRoom: { roomId, createdAt: Date.now(), keepPrivate } }),
      clearActiveRoom: () => set({ activeRoom: null }),
      getActiveRoom: () => {
        const r = get().activeRoom;
        if (!r) return null;
        if (Date.now() - r.createdAt > ROOM_TTL_MS) {
          set({ activeRoom: null });
          return null;
        }
        return r;
      },
      scheduledMeetingsVersion: 0,
      bumpScheduledMeetings: () =>
        set((s) => ({ scheduledMeetingsVersion: s.scheduledMeetingsVersion + 1 })),
    }),
    {
      name: "mirracle.peerInterview",
      // scheduledMeetingsVersion is per-session refresh state, never persisted.
      partialize: (s) => ({ activeRoom: s.activeRoom }),
    },
  ),
);
