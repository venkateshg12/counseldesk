"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import queryClient from "@/lib/queryClient";
import { ServerWakeNotice } from "./ServerWakeNotice";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ServerWakeNotice />
    </QueryClientProvider>
  );
}
