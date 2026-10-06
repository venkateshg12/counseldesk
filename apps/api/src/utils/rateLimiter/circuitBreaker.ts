import { CIRCUIT_BREAKER_DEFAULTS } from "../../constants/rateLimiter.constant.js";
import {
  CircuitState,
  type CircuitBreakerOptions,
} from "../../types/rateLimiter.types.js";

export class RedisCircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastStateChange: number = Date.now();
  private halfOpenProbe: Promise<{
    success: boolean;
    result?: unknown;
    error?: unknown;
  }> | null = null;
  private readonly options: CircuitBreakerOptions;
  private onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(
    options?: Partial<CircuitBreakerOptions>,
    onStateChange?: (from: CircuitState, to: CircuitState) => void,
  ) {
    this.options = {
      failureThreshold:
        options?.failureThreshold ?? CIRCUIT_BREAKER_DEFAULTS.FAILURE_THRESHOLD,
      resetTimeoutMs:
        options?.resetTimeoutMs ?? CIRCUIT_BREAKER_DEFAULTS.RESET_TIMEOUT_MS,
    };
    this.onStateChange = onStateChange;
  }

  public getState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.options.resetTimeoutMs) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
    return this.state;
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.transitionTo(CircuitState.CLOSED);
  }

  public recordFailure(): void {
    this.failureCount++;
    if (
      this.state === CircuitState.HALF_OPEN ||
      this.failureCount >= this.options.failureThreshold
    ) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.lastStateChange = Date.now();
      if (newState === CircuitState.CLOSED) {
        this.failureCount = 0;
      }
      if (this.onStateChange) {
        this.onStateChange(oldState, newState);
      }
    }
  }

  /**
   * Executes a Redis operation with circuit breaker protection.
   * During HALF_OPEN, only a single probe executes against Redis while
   * concurrent requests use the in-memory fallback.
   */
  public async execute<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      return fallback();
    }

    if (currentState === CircuitState.HALF_OPEN) {
      if (this.halfOpenProbe) {
        // A probe is already in flight. Concurrent requests fall back to memory
        return fallback();
      }

      this.halfOpenProbe = (async () => {
        try {
          const result = await operation();
          this.recordSuccess();
          return { success: true, result };
        } catch (error) {
          this.recordFailure();
          return { success: false, error };
        }
      })();

      try {
        const probe = await this.halfOpenProbe;
        if (probe.success) {
          return probe.result as T;
        }
        return fallback();
      } finally {
        this.halfOpenProbe = null;
      }
    }

    // Circuit is CLOSED
    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch {
      this.recordFailure();
      return fallback();
    }
  }
}
