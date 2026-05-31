/**
 * WAD constant: 10^18 — standard precision for DeFi math.
 */
export const WAD = 10n ** 18n;

/**
 * Half WAD for rounding in multiplication.
 */
export const HALF_WAD = WAD / 2n;

/**
 * WAD multiplication: (a * b + WAD/2) / WAD
 * Rounds to nearest integer.
 */
export function wadMul(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a * b + HALF_WAD) / WAD;
}

/**
 * WAD division: (a * WAD + b/2) / b
 * Rounds to nearest integer.
 */
export function wadDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return (a * WAD + b / 2n) / b;
}

/**
 * Convert a decimal number to WAD bigint.
 * e.g., toWad(0.825) => 825000000000000000n
 */
export function toWad(value: number): bigint {
  return BigInt(Math.floor(value * 1e18));
}

/**
 * Convert WAD bigint to a floating point number.
 * Precision loss is expected for display purposes only.
 */
export function fromWad(value: bigint): number {
  return Number(value) / 1e18;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
