/**
 * Configuration for the liquidation monitor.
 */
export interface MonitorConfig {
  /** Ethers provider instance or JSON-RPC URL string */
  provider: string | unknown;
  /** Polling interval in milliseconds (default: 10_000) */
  pollInterval: number;
  /** Health factor threshold to trigger liquidation (e.g., 1.0 = 100%) */
  healthFactorThreshold: number;
  /** Minimum profit in ETH to proceed with liquidation */
  minProfitEth: number;
  /** Maximum gas price in gwei to allow liquidation */
  maxGasPriceGwei: number;
  /** Price feed provider implementation */
  priceFeed: PriceFeed;
  /** Positions to monitor */
  positions: Position[];
}

/**
 * Represents a lending position to monitor.
 */
export interface Position {
  /** Unique identifier for this position */
  id: string;
  /** Address of the borrower */
  userAddress: string;
  /** Token address used as collateral */
  collateralToken: string;
  /** Amount of collateral (in token's native decimals, as bigint) */
  collateralAmount: bigint;
  /** Token address of the borrowed asset */
  debtToken: string;
  /** Amount of debt (in token's native decimals, as bigint) */
  debtAmount: bigint;
  /** Liquidation threshold as a decimal (e.g., 0.825 = 82.5%) */
  liquidationThreshold: number;
}

/**
 * Interface for price feed providers.
 * Implementations must return prices normalized to 18 decimals (WAD).
 */
export interface PriceFeed {
  /** Get price in USD with 18 decimal precision */
  getPrice(tokenAddress: string): Promise<bigint>;
  /** Get multiple prices in one call */
  getPrices(tokenAddresses: string[]): Promise<Map<string, bigint>>;
}

/**
 * Health report for a monitored position.
 */
export interface HealthReport {
  /** The position this report is for */
  position: Position;
  /** Computed health factor (< 1.0 means liquidatable) */
  healthFactor: number;
  /** Collateral value in USD (18 decimals) */
  collateralValueUsd: bigint;
  /** Debt value in USD (18 decimals) */
  debtValueUsd: bigint;
  /** Whether the position can be liquidated */
  isLiquidatable: boolean;
  /** Estimated profit from liquidation (18 decimals) */
  estimatedProfit: bigint;
  /** Estimated gas cost in wei */
  estimatedGasCost: bigint;
  /** Whether liquidation is profitable after gas */
  isProfitable: boolean;
}

/** Callback invoked when a profitable liquidation opportunity is found */
export type LiquidationCallback = (report: HealthReport) => Promise<void>;

/** Callback invoked when a position approaches liquidation threshold */
export type AlertCallback = (report: HealthReport) => Promise<void>;
