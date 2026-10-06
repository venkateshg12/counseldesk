export const RateLimiterAlgorithm = {
  SLIDING_WINDOW: "SLIDING_WINDOW",
} as const;

export type RateLimiterAlgorithm =
  (typeof RateLimiterAlgorithm)[keyof typeof RateLimiterAlgorithm];

export const CircuitState = {
  CLOSED: "CLOSED", // Normal operation: Requests go to Redis
  OPEN: "OPEN", // Outage detected: Requests failover immediately to Memory
  HALF_OPEN: "HALF_OPEN", // Trial mode: Single probe dispatched to Redis
} as const;

export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

export interface RateLimiterRequest {
  headers?:
    | Record<string, string | string[] | undefined>
    | { get(name: string): string | null };
  ip?: string;
  // The peer that opened the connection. Unlike any header, a remote client cannot choose it,
  // so it is what decides whether proxy headers are trusted at all.
  socket?: { remoteAddress?: string };
  body?: unknown;
  cookies?: Record<string, unknown>;
  visitorId?: string;
  userId?: unknown;
  role?: unknown;
}

export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  limit: number;
  remaining: number;
  resetTimeMs: number;
  isFallback: boolean;
  isLocked?: boolean;
}

export interface DualRateLimitResult {
  allowed: boolean;
  visitorHits: number;
  visitorRemaining: number;
  ipHits: number;
  ipRemaining: number;
  resetTimeMs: number;
  rejectedReason: "none" | "visitor" | "ip";
  isFallback: boolean;
}

export interface RateLimiterStore {
  increment(
    key: string,
    windowMs: number,
    maxLimit: number,
    algorithm?: RateLimiterAlgorithm,
  ): Promise<RateLimitResult>;

  incrementPunitive(
    key: string,
    lockKey: string,
    windowMs: number,
    maxLimit: number,
    lockoutMs: number,
  ): Promise<RateLimitResult>;

  incrementDual(
    visitorKey: string,
    ipKey: string,
    windowMs: number,
    visitorLimit: number,
    ipLimit: number,
  ): Promise<DualRateLimitResult>;

  resetKey(key: string): Promise<void>;
}

import type { Request } from "express";

export type LimitProvider = (req: Request) => Promise<number> | number;
export type KeyResolver = (req: Request) => Promise<string> | string;

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of consecutive errors to trip circuit
  resetTimeoutMs: number; // Time in MS before trying HALF_OPEN recovery
}

export interface RateLimiterOptions {
  prefix?: string;
  windowMs: number;
  blockDurationMs?: number; // If > 0, activates atomic punitive lockout behavior
  max: number | LimitProvider;
  algorithm?: RateLimiterAlgorithm;
  keyResolver?: KeyResolver;
  skip?: (req: Request) => boolean | Promise<boolean>;
  store?: RateLimiterStore;
}

export interface DualRateLimiterOptions {
  visitorPrefix?: string;
  ipPrefix?: string;
  windowMs: number;
  visitorLimit: number | LimitProvider;
  ipLimit: number | LimitProvider;
  visitorKeyResolver?: KeyResolver;
  ipKeyResolver?: KeyResolver;
  skip?: (req: Request) => boolean | Promise<boolean>;
  store?: RateLimiterStore;
}

export interface MemoryEntry {
  timestamps: number[];
}

export interface MemoryLockEntry {
  expiresAt: number;
}
