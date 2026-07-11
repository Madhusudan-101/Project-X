import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Session, User } from "@/types";

interface AuthState {
  session: Session | null;
  setSession: (s: Session | null) => void;
  updateUser: (u: Partial<User>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      updateUser: (patch) =>
        set((s) => (s.session ? { session: { ...s.session, user: { ...s.session.user, ...patch } } } : s)),
      logout: () => set({ session: null }),
    }),
    { name: "projectx.auth" },
  ),
);
