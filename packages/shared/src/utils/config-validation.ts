import { parseDurationToMs } from "./duration";

/**
 * Result of validating worker configuration
 */
export interface ConfigValidation {
  /** Critical errors that prevent the worker from running correctly */
  errors: string[];
  /** Whether the config is valid (no errors) */
  isValid: boolean;
  /** Non-critical issues that will be auto-corrected */
  warnings: string[];
}

/**
 * Worker configuration fields relevant for validation
 */
export interface WorkerConfigForValidation {
  idleTimeout?: number | string;
  timeout?: number | string;
  ttl?: number | string;
}

/**
 * Validate worker config relationships
 *
 * Rules for persistent workers (ttl > 0):
 * - ttl must be >= timeout (worker shouldn't expire during a request)
 * - idleTimeout must be >= timeout (worker shouldn't be marked idle during a request)
 * - idleTimeout > ttl is auto-adjusted (warning only)
 *
 * @param config - Worker configuration to validate
 * @returns Validation result with errors and warnings
 */
export function validateWorkerConfig(config: WorkerConfigForValidation): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const timeoutMs = parseDurationToMs(config.timeout ?? 30);
  const ttlMs = parseDurationToMs(config.ttl ?? 0);
  const idleTimeoutMs = parseDurationToMs(config.idleTimeout ?? 60);

  // Only validate for persistent workers (ttl > 0)
  if (ttlMs > 0) {
    if (ttlMs < timeoutMs) {
      errors.push(`ttl (${ttlMs}ms) must be >= timeout (${timeoutMs}ms)`);
    }

    if (idleTimeoutMs < timeoutMs) {
      errors.push(`idleTimeout (${idleTimeoutMs}ms) must be >= timeout (${timeoutMs}ms)`);
    }

    if (idleTimeoutMs > ttlMs) {
      warnings.push(`idleTimeout (${idleTimeoutMs}ms) > ttl (${ttlMs}ms), will be auto-adjusted`);
    }
  }

  return {
    errors,
    isValid: errors.length === 0,
    warnings,
  };
}
