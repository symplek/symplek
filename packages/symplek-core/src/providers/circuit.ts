/**
 * @fileoverview Circuit Breaker for @symplek/core
 * @description Implements the circuit breaker pattern to handle provider failures gracefully.
 */

import { SymplekError } from "../errors";

/**
 * Circuit Breaker States
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Configuration for the Circuit Breaker
 */
export interface CircuitConfig {
  /** Number of consecutive failures before tripping the circuit */
  failureThreshold: number;
  /** Time in milliseconds to wait before attempting recovery */
  recoveryTimeout: number;
}

/**
 * Circuit Breaker implementation for protecting provider calls.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime?: number;
  private nextAttemptTime?: number;

  constructor(private readonly config: CircuitConfig) {}

  /**
   * Returns the current state of the circuit.
   */
  getState(): CircuitState {
    this.evaluateState();
    return this.state;
  }

  /**
   * Executes a function protected by the circuit breaker.
   *
   * @param fn - The async function to execute
   * @returns The result of the function
   * @throws SymplekError if the circuit is OPEN or if the function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.evaluateState();

    if (this.state === "OPEN" && this.nextAttemptTime !== undefined) {
      throw new SymplekError({
        code: "NETWORK_ERROR",
        message:
          "Circuit breaker is OPEN. Request rejected to prevent cascading failures.",
        action: `Wait until ${new Date(
          this.nextAttemptTime,
        ).toISOString()} for the circuit to enter HALF_OPEN state.`,
        context: {
          state: this.state,
          failureCount: this.failureCount,
          nextAttemptTime: this.nextAttemptTime,
        },
      });
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Evaluates and updates the internal state based on time and failure history.
   */
  private evaluateState(): void {
    if (
      this.state === "OPEN" &&
      this.nextAttemptTime !== undefined &&
      Date.now() >= this.nextAttemptTime
    ) {
      this.state = "HALF_OPEN";
    }
  }

  /**
   * Handles a successful execution.
   */
  private onSuccess(): void {
    if (this.state === "HALF_OPEN" || this.state === "CLOSED") {
      this.state = "CLOSED";
      this.failureCount = 0;
      this.lastFailureTime = undefined;
      this.nextAttemptTime = undefined;
    }
  }

  /**
   * Handles a failed execution.
   */
  private onFailure(_error: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (
      this.state === "HALF_OPEN" ||
      this.failureCount >= this.config.failureThreshold
    ) {
      this.state = "OPEN";
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
    }
  }

  /**
   * Gets the last failure time.
   */
  getLastFailureTime(): number | undefined {
    return this.lastFailureTime;
  }
}
