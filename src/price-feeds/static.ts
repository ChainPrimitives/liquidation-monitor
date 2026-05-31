import { PriceFeed } from "../types";

/**
 * Static price feed for testing and development.
 *
 * Returns pre-configured prices without any network calls.
 * Useful for unit tests and local development.
 *
 * @example
 * ```ts
 * const feed = new StaticPriceFeed({
 *   "0xC02a...": 2000n * 10n ** 18n, // ETH = $2000
 *   "0xA0b8...": 1n * 10n ** 18n,    // USDC = $1
 * });
 * ```
 */
export class StaticPriceFeed implements PriceFeed {
  private readonly prices: Map<string, bigint>;

  constructor(priceMapping: Record<string, bigint>) {
    this.prices = new Map(
      Object.entries(priceMapping).map(([token, price]) => [
        token.toLowerCase(),
        price,
      ]),
    );
  }

  async getPrice(tokenAddress: string): Promise<bigint> {
    const price = this.prices.get(tokenAddress.toLowerCase());
    if (price === undefined) {
      throw new Error(`No static price configured for ${tokenAddress}`);
    }
    return price;
  }

  async getPrices(tokenAddresses: string[]): Promise<Map<string, bigint>> {
    const results = new Map<string, bigint>();
    for (const addr of tokenAddresses) {
      results.set(addr, await this.getPrice(addr));
    }
    return results;
  }

  /**
   * Update a price dynamically (useful for simulating price movements in tests).
   */
  setPrice(tokenAddress: string, price: bigint): void {
    this.prices.set(tokenAddress.toLowerCase(), price);
  }
}
