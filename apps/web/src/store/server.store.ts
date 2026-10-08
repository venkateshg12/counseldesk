import { create } from "zustand";

/*
  Whether the backend is answering. The free tier sleeps when idle and takes up to a minute to boot,
  so the first requests of a visit can hang or be turned away by the host's proxy.
 
  - `idle`   — nothing to report; the server is answering normally.
  - `waking` — a request is taking too long or was turned away; the wake-up notice is showing.
  - `ready`  — the server answered after `waking`; the notice says so, then returns to `idle`.
 */
export type ServerStatus = "idle" | "waking" | "ready";

type ServerStore = {
  status: ServerStatus;
  markWaking: () => void;
  markReady: () => void;
  reset: () => void;
};

export const useServerStore = create<ServerStore>()((set) => ({
  status: "idle",
  markWaking: () => set({ status: "waking" }),
  // Only a server that was waking has anything to announce; a normal response changes nothing.
  markReady: () =>
    set((state) => (state.status === "waking" ? { status: "ready" } : state)),
  reset: () => set({ status: "idle" }),
}));
