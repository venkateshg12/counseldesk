"use client";

import { useEffect } from "react";
import { useServerStore } from "@/store/server.store";

const READY_VISIBLE_MS = 2000;

export function ServerWakeNotice() {
  const status = useServerStore((state) => state.status);
  const reset = useServerStore((state) => state.reset);

  useEffect(() => {
    if (status !== "ready") return;
    const timer = setTimeout(reset, READY_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status, reset]);

  if (status === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-lg"
    >
      <p className="font-semibold">
        {status === "waking" ? "Waking up the server" : "Server is ready"}
      </p>
      <p className="mt-1 text-stone-600">
        {status === "waking"
          ? "The API runs on a free tier that sleeps when idle; the first request can take up to a minute."
          : "Loading your data now."}
      </p>
    </div>
  );
}
