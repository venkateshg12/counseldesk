import type { IncomingMessage } from "http";
import ipaddr from "ipaddr.js";
import proxyaddr from "proxy-addr";

import { TRUSTED_PROXY_CIDRS } from "../../constants/env.js";
import type { RateLimiterRequest } from "../../types/rateLimiter.types.js";

/*
  Used when no trustworthy client IP can be determined.
 */
export const UNKNOWN_IP = "unknown";

/*
  Headers provided by trusted edge infrastructure.

 These headers are ONLY trusted when the actual TCP peer belongs
  to TRUSTED_PROXY_CIDRS.

  Only headers the edge always overwrites qualify. Cloudflare replaces any client-sent
  CF-Connecting-IP, but sets True-Client-IP only on Enterprise zones with the Managed
  Transform enabled — elsewhere a client's True-Client-IP passes straight through. Render's
  zone does set it today, but that is undocumented, and CF-Connecting-IP already carries the
  same value, so trusting True-Client-IP would add risk and nothing else.
 */
const EDGE_HEADERS = ["cf-connecting-ip"] as const;

/*
  Compile trusted proxy configuration once at startup.
 */
export const trustProxy = createTrustProxy(TRUSTED_PROXY_CIDRS);

/*
  Extract the client IP used by the rate limiter.
 
  Security model:
  1. Determine the actual TCP peer.
  2. Only trust Cloudflare's CF-Connecting-IP when that peer
     belongs to infrastructure we explicitly trust.
  3. Otherwise resolve the client IP using proxy-addr and our
     trusted-proxy configuration.
  4. Never manually trust X-Forwarded-For.
  5. Return UNKNOWN_IP if no valid IP can be determined.
 */
export function extractClientIp(req: RateLimiterRequest): string {
  const peer = req.socket?.remoteAddress;

  /*
   * First check whether the actual connection came from one
   * of our trusted edge proxies.
   */
  if (peer) {
    const normalizedPeer = normalizeIp(peer);

    if (trustProxy(normalizedPeer)) {
      for (const header of EDGE_HEADERS) {
        const value = getHeaderValue(req, header);

        if (!value) {
          continue;
        }

        const normalizedValue = normalizeIp(value);

        if (isValidIp(normalizedValue)) {
          return normalizedValue;
        }
      }
    }
  }

  /*
   * Resolve the client IP using proxy-addr.
   *
   * proxy-addr:
   * - understands X-Forwarded-For
   * - walks the proxy chain from the application outward
   * - stops at the first untrusted address
   * - supports IPv4 and IPv6
   */
  try {
    const xForwardedFor = getHeaderValue(req, "x-forwarded-for");
    const adaptedReq = {
      headers: {
        "x-forwarded-for": xForwardedFor,
      },
      socket: req.socket,
    } as unknown as IncomingMessage;

    const resolvedIp = proxyaddr(adaptedReq, trustProxy);

    if (resolvedIp) {
      const normalizedIp = normalizeIp(resolvedIp);

      if (isValidIp(normalizedIp)) {
        return normalizedIp;
      }
    }
  } catch {
    /*
     * Never allow malformed proxy information to become
     * a rate-limit key.
     */
  }

  return UNKNOWN_IP;
}

/**
 * Compile trusted proxy CIDRs.
 *
 * Example:
 *
 * TRUSTED_PROXY_CIDRS=10.20.30.0/24,2001:db8::/32
 */
function createTrustProxy(
  raw: string,
): (ip: string, index?: number) => boolean {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  try {
    const compiled = proxyaddr.compile(entries);

    return (ip: string, index: number = 0) => {
      return compiled(ip, index);
    };
  } catch (error) {
    throw new Error(
      `Invalid TRUSTED_PROXY_CIDRS configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Read a header from either:
 *
 * - Fetch Headers / Headers-like objects
 * - Node / Express IncomingHttpHeaders
 */
function getHeaderValue(
  req: RateLimiterRequest,
  headerName: string,
): string | undefined {
  if (!req.headers) {
    return undefined;
  }

  /*
   * Headers-like API.
   */
  if ("get" in req.headers && typeof req.headers.get === "function") {
    return req.headers.get(headerName) ?? undefined;
  }

  /*
   * Node / Express headers object.
   */
  const headersObj = req.headers as Record<
    string,
    string | string[] | undefined
  >;

  const value = headersObj[headerName.toLowerCase()] ?? headersObj[headerName];

  /*
   * Don't arbitrarily select one value when multiple
   * edge identity headers are present.
   */
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      return undefined;
    }

    return value[0];
  }

  return value;
}

/**
 * Normalize an IP using ipaddr.js.
 *
 * Examples:
 *
 * ::ffff:192.168.1.10
 *     -> 192.168.1.10
 *
 * ::1
 *     -> ::1
 */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();

  if (!isValidIp(trimmed)) {
    return trimmed;
  }

  try {
    return ipaddr.process(trimmed).toString();
  } catch {
    return trimmed;
  }
}

/**
 * Validate IPv4 or IPv6.
 */
function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") {
    return false;
  }

  return ipaddr.isValid(ip.trim());
}
