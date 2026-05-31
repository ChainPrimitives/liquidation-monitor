import { Contract, Provider } from "ethers";
import { PriceFeed } from "../types";
import { retry } from "../utils";

const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];

/**
 * Chainlink oracle price feed adapter.
 *
 * Reads prices from Chainlink aggregator contracts and normalizes
 * them to 18 decimal precision (WAD format).
 *
 * @example
 * ```ts
 * const feed = new ChainlinkPriceFeed(provider, {
 *   "0xC02a...": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // WETH/USD
 *   "0xA0b8...": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // USDC/USD
 * });
 * ```
 */
export class ChainlinkPriceFeed implements PriceFeed {
  private readonly feeds: Map<string, string>;
  private readonly decimalsCache: Map<string, bigint> = new Map();

  constructor(
    private readonly provider: Provider,
    feedMapping: Record<string, string>,
    private readonly stalePriceThresholdSec: number = 3600,
  ) {
    this.feeds = new Map(
      Object.entries(feedMapping).map(([token, aggregator]) => [
        token.toLowerCase(),
        aggregator,
      ]),
    );
  }

  /**
   * Get price for a single token in USD (18 decimals).
   */
  async getPrice(tokenAddress: string): Promise<bigint> {
    const feedAddr = this.feeds.get(tokenAddress.toLowerCase());
    if (!feedAddr) {
      throw new Error(`No Chainlink price feed configured for ${tokenAddress}`);
    }

    return retry(async () => {
      const aggregator = new Contract(feedAddr, AGGREGATOR_ABI, this.provider);

      const [, answer, , updatedAt] = await aggregator.latestRoundData();

      // Validate price is positive
      if (answer <= 0n) {
        throw new Error(
          `Invalid price from Chainlink feed ${feedAddr}: ${answer}`,
        );
      }

      // Check for stale price
      const now = Math.floor(Date.now() / 1000);
      if (now - Number(updatedAt) > this.stalePriceThresholdSec) {
        throw new Error(
          `Stale price from Chainlink feed ${feedAddr}: last updated ${now - Number(updatedAt)}s ago`,
        );
      }

      // Get decimals (cached)
      let feedDecimals = this.decimalsCache.get(feedAddr);
      if (feedDecimals === undefined) {
        feedDecimals = BigInt(await aggregator.decimals());
        this.decimalsCache.set(feedAddr, feedDecimals);
      }

      // Normalize to 18 decimals
      return BigInt(answer) * 10n ** (18n - feedDecimals);
    });
  }

  /**
   * Get prices for multiple tokens. Fetches in parallel.
   */
  async getPrices(tokenAddresses: string[]): Promise<Map<string, bigint>> {
    const results = new Map<string, bigint>();
    const entries = await Promise.all(
      tokenAddresses.map(async (addr) => {
        const price = await this.getPrice(addr);
        return [addr, price] as const;
      }),
    );

    for (const [addr, price] of entries) {
      results.set(addr, price);
    }

    return results;
  }
}
