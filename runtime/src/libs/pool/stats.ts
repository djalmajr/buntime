/**
 * Round a number to 2 decimal places
 * Used for metrics display (response times, percentages, etc)
 */
export function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compute average response time with protection against division by zero.
 * Rounds to 2 decimal places for consistency.
 */
export function computeAvgResponseTime(totalMs: number, count: number): number {
  if (count <= 0) return 0;
  return roundTwoDecimals(totalMs / count);
}
