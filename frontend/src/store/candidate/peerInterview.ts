/**
 * Peer Interview room store.
 *
 * Holds the room ID for the peer-interview session the CURRENT dashboard
 * user started. Persisted so switching dashboard tabs (which unmount the
 * overview) or reopening the dashboard doesn't wipe the visible room ID —
 * the actual PeerMeet session lives in a separate origin/tab.
 *
 * Only the room ID is persisted. The short-lived PeerMeet auth token is
 * NEVER put here — it lives in memory in the PeerMeet tab, per the
 * existing `PeerMeet/client/src/utils/authToken.js` contract.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ActivePeerRoom {
  roomId: string;
  createdAt: number;
  keepPrivate: boolean;
}

interface PeerInterviewState {
  activeRoom: ActivePeerRoom | null;
  setActiveRoom: (roomId: string, keepPrivate: boolean) => void;
  clearActiveRoom: () => void;
}

export const usePeerInterviewStore = create<PeerInterviewState>()(
  persist(
    (set) => ({
      activeRoom: null,
      setActiveRoom: (roomId, keepPrivate) =>
        set({ activeRoom: { roomId, createdAt: Date.now(), keepPrivate } }),
      clearActiveRoom: () => set({ activeRoom: null }),
    }),
    { name: "mirracle.peerInterview" },
  ),
);
