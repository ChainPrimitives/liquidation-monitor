import { Contract, Provider } from "ethers";
import { PriceFeed } from "../types";
import { retry } from "../utils";

const POOL_ABI = [
  "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const ERC20_DECIMALS_ABI = ["function decimals() external view returns (uint8)"];

/**
 * Uniswap V3 TWAP (Time-Weighted Average Price) feed adapter.
 *
 * Computes prices from Uniswap V3 pool tick observations over a
 * configurable time window. More manipulation-resistant than spot prices.
 *
 * @example
 * ```ts
 * const feed = new UniswapTwapPriceFeed(provider, {
 *   "0xC02a...": {
 *     pool: "0x8ad5...",
 *     quoteToken: "0xA0b8...",
 *     quoteTokenPriceUsd: 1000000000000000000n, // $1 in WAD
 *   }
 * }, 1800); // 30 min TWAP
 * ```
 */
export interface TwapPoolConfig {
  /** Uniswap V3 pool address */
  pool: string;
  /** The quote token address in the pool */
  quoteToken: string;
  /** Price of the quote token in USD (18 decimals) — use a stable reference */
  quoteTokenPriceUsd: bigint;
}

export class UniswapTwapPriceFeed implements PriceFeed {
  private readonly pools: Map<string, TwapPoolConfig>;
  private readonly decimalsCache: Map<string, number> = new Map();

  constructor(
    private readonly provider: Provider,
    poolMapping: Record<string, TwapPoolConfig>,
    private readonly twapWindowSeconds: number = 1800,
  ) {
    this.pools = new Map(
      Object.entries(poolMapping).map(([token, config]) => [
        token.toLowerCase(),
        config,
      ]),
    );
  }

  async getPrice(tokenAddress: string): Promise<bigint> {
    const config = this.pools.get(tokenAddress.toLowerCase());
    if (!config) {
      throw new Error(
        `No Uniswap TWAP pool configured for ${tokenAddress}`,
      );
    }

    return retry(async () => {
      const pool = new Contract(config.pool, POOL_ABI, this.provider);

      // Observe tick cumulatives at [twapWindow, 0] seconds ago
      const secondsAgos = [this.twapWindowSeconds, 0];
      const [tickCumulatives] = await pool.observe(secondsAgos);

      const tickCumDiff =
        BigInt(tickCumulatives[1]) - BigInt(tickCumulatives[0]);
      const avgTick = Number(tickCumDiff) / this.twapWindowSeconds;

      // Convert tick to price: price = 1.0001^tick
      // price represents token0 in terms of token1
      const price = Math.pow(1.0001, avgTick);

      // Determine if our token is token0 or token1
      const token0 = (await pool.token0()).toLowerCase();
      const isToken0 = tokenAddress.toLowerCase() === token0;

      // Get decimal adjustment
      const tokenDecimals = await this.getDecimals(tokenAddress);
      const quoteDecimals = await this.getDecimals(config.quoteToken);
      const decimalAdjustment = 10 ** (quoteDecimals - tokenDecimals);

      // If our token is token0, price is in terms of token1 (quote)
      // If our token is token1, we need to invert
      const adjustedPrice = isToken0
        ? price * decimalAdjustment
        : (1 / price) * decimalAdjustment;

      // Convert to WAD and multiply by quote token USD price
      const priceWad = BigInt(Math.floor(adjustedPrice * 1e18));
      const priceUsd =
        (priceWad * config.quoteTokenPriceUsd) / 10n ** 18n;

      return priceUsd;
    });
  }

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

  private async getDecimals(tokenAddress: string): Promise<number> {
    const cached = this.decimalsCache.get(tokenAddress.toLowerCase());
    if (cached !== undefined) return cached;

    const token = new Contract(
      tokenAddress,
      ERC20_DECIMALS_ABI,
      this.provider,
    );
    const decimals = Number(await token.decimals());
    this.decimalsCache.set(tokenAddress.toLowerCase(), decimals);
    return decimals;
  }
}
