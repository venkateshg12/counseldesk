// Statuses a host's proxy answers with while the app behind it is still booting.
const GATEWAY_STATUSES = [502, 503, 504];

/**
 * True when the failure says "the server isn't up yet" rather than "your request was wrong":
 * no response at all (status 0 — timeout, refused connection) or the proxy's gateway statuses.
 * Retrying these is safe and usually succeeds once the free-tier backend has finished waking.
 */
export const isServerUnavailable = (status: unknown): boolean =>
  status === 0 ||
  (typeof status === "number" && GATEWAY_STATUSES.includes(status));
