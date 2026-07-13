/**
 * Company Zustand store.
 * Persists the active company profile across page refreshes.
 * Cleared on logout (see useAuthStore.logout).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Company } from "@/types/company";

interface CompanyState {
  company: Company | null;
  setCompany: (c: Company | null) => void;
  clearCompany: () => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      company: null,
      setCompany: (company) => set({ company }),
      clearCompany: () => set({ company: null }),
    }),
    { name: "projectx.company" },
  ),
);
