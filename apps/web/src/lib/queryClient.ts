import { QueryClient } from "@tanstack/react-query";
import { isServerUnavailable } from "@/lib/serverStatus";
import { useServerStore } from "@/store/server.store";

// About two minutes of patience in total — enough for a slow free-tier cold start with margin.
const MAX_WAKE_RETRIES = 24;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Only "the server isn't up yet" is worth retrying; a 4xx or a business error would just
      // fail again. While a query retries it stays pending, so the page keeps its skeletons
      // instead of flipping to an error or empty state.
      retry: (failureCount, error) =>
        failureCount < MAX_WAKE_RETRIES &&
        isServerUnavailable((error as { status?: unknown } | null)?.status),
      retryDelay: (attempt) => Math.min(2000 * (attempt + 1), 5000),
    },
  },
});

// Safety net: a query that ran out of retries before the server finished waking is refetched the
// moment the server answers, rather than staying failed until the visitor reloads.
useServerStore.subscribe((state, previous) => {
  if (previous.status === "waking" && state.status === "ready") {
    queryClient.refetchQueries({
      type: "active",
      predicate: (query) => query.state.status === "error",
    });
  }
});

export default queryClient;
