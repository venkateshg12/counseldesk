import { create } from "zustand";

export type StaffUser = { id: string; email: string; name: string };

type AuthStore = {
  user: StaffUser | null;
  setUser: (user: StaffUser) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthStore>()((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clearAuth: () => set({ user: null }),
}));
