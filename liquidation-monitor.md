# liquidation-monitor — Production Guide

## Overview

A configurable DeFi health-factor monitoring library for lending protocols. Watches positions, checks collateral ratios against price feeds, and triggers liquidation callbacks with gas price guards and nonce management.

**Why this package?** Every DeFi lending protocol needs position monitoring. Most teams build this as tightly-coupled application code. This package makes it a pluggable middleware layer.

---

## Package Metadata

```
Name: liquidation-monitor
License: MIT
Node: >=18
Peer Dependencies: ethers ^6.0.0
```

---

## Directory Structure

```
liquidation-monitor/
├── src/
│   ├── index.ts               # Public API
│   ├── monitor.ts             # Core monitoring loop
│   ├── health-factor.ts       # Health factor computation
│   ├── price-feeds/
│   │   ├── interface.ts       # Price feed interface
│   │   ├── chainlink.ts       # Chainlink oracle adapter
│   │   ├── uniswap-twap.ts   # Uniswap V3 TWAP adapter
│   │   └── static.ts         # Static prices (for testing)
│   ├── gas-guard.ts           # Gas price profitability check
│   ├── nonce-manager.ts       # Sequential tx nonce management
│   ├── types.ts
│   └── utils.ts
├── tests/
│   ├── health-factor.test.ts
│   ├── monitor.test.ts
│   ├── gas-guard.test.ts
│   └── nonce-manager.test.ts
├── tsconfig.json
├── tsup.config.ts
├── package.json
└── README.md
```

---

## Implementation

### src/types.ts

```ts
export interface MonitorConfig {
  /** Ethers provider or RPC URL */
  provider: string | any;
  /** Polling interval in ms (default: 10000) */
  pollInterval: number;
  /** Health factor threshold to trigger liquidation (e.g., 1.0 = 100%) */
  healthFactorThreshold: number;
  /** Minimum profit in ETH to proceed with liquidation */
  minProfitEth: number;
  /** Maximum gas price in gwei to allow liquidation */
  maxGasPriceGwei: number;
  /** Price feed provider */
  priceFeed: PriceFeed;
  /** Positions to monitor */
  positions: Position[];
}

export interface Position {
  id: string;
  userAddress: string;
  collateralToken: string;
  collateralAmount: bigint;
  debtToken: string;
  debtAmount: bigint;
  liquidationThreshold: number; // e.g., 0.825 = 82.5%
}

export interface PriceFeed {
  /** Get price in USD (18 decimals) */
  getPrice(tokenAddress: string): Promise<bigint>;
  /** Get multiple prices in one call */
  getPrices(tokenAddresses: string[]): Promise<Map<string, bigint>>;
}

export interface HealthReport {
  position: Position;
  healthFactor: number;
  collateralValueUsd: bigint;
  debtValueUsd: bigint;
  isLiquidatable: boolean;
  estimatedProfit: bigint;
  estimatedGasCost: bigint;
  isProfitable: boolean;
}

export type LiquidationCallback = (report: HealthReport) => Promise<void>;
export type AlertCallback = (report: HealthReport) => Promise<void>;
```

### src/health-factor.ts

```ts
import { Position, PriceFeed, HealthReport } from "./types";
import { wadMul, wadDiv, WAD } from "./wad-helpers";

/**
 * Calculate health factor for a lending position.
 *
 * healthFactor = (collateralValue * liquidationThreshold) / debtValue
 *
 * If healthFactor < 1.0, position is liquidatable.
 */
export async function calculateHealthFactor(
  position: Position,
  priceFeed: PriceFeed,
): Promise<HealthReport> {
  const prices = await priceFeed.getPrices([
    position.collateralToken,
    position.debtToken,
  ]);

  const collateralPrice = prices.get(position.collateralToken)!;
  const debtPrice = prices.get(position.debtToken)!;

  // Collateral value in USD (wad precision)
  const collateralValueUsd = wadMul(position.collateralAmount, collateralPrice);

  // Debt value in USD (wad precision)
  const debtValueUsd = wadMul(position.debtAmount, debtPrice);

  // Health factor
  const thresholdWad = BigInt(Math.floor(position.liquidationThreshold * 1e18));
  const adjustedCollateral = wadMul(collateralValueUsd, thresholdWad);

  let healthFactor: number;
  if (debtValueUsd === 0n) {
    healthFactor = Infinity;
  } else {
    const hfWad = wadDiv(adjustedCollateral, debtValueUsd);
    healthFactor = Number(hfWad) / 1e18;
  }

  const isLiquidatable = healthFactor < 1.0;

  // Estimate liquidation profit (simplified: 5% liquidation bonus)
  const liquidationBonus = wadMul(collateralValueUsd, BigInt(5e16)); // 5%
  const estimatedProfit = isLiquidatable ? liquidationBonus : 0n;

  return {
    position,
    healthFactor,
    collateralValueUsd,
    debtValueUsd,
    isLiquidatable,
    estimatedProfit,
    estimatedGasCost: 0n, // Set by gas guard
    isProfitable: false, // Set by gas guard
  };
}

// Internal wad helpers (same as wad-ray-math, inlined to avoid dependency)
function wadMul(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a * b + WAD / 2n) / WAD;
}

function wadDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return (a * WAD + b / 2n) / b;
}

const WAD = 10n ** 18n;
```

### src/gas-guard.ts

```ts
import { Provider } from "ethers";
import { HealthReport } from "./types";

export class GasGuard {
  constructor(
    private provider: Provider,
    private maxGasPriceGwei: number,
    private estimatedGasUnits: bigint = 350000n, // Typical liquidation gas
  ) {}

  /**
   * Check if a liquidation is profitable after gas costs.
   */
  async checkProfitability(report: HealthReport): Promise<HealthReport> {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    const maxGasWei = BigInt(this.maxGasPriceGwei) * 10n ** 9n;

    // Check gas price ceiling
    if (gasPrice > maxGasWei) {
      return {
        ...report,
        estimatedGasCost: gasPrice * this.estimatedGasUnits,
        isProfitable: false,
      };
    }

    const gasCost = gasPrice * this.estimatedGasUnits;
    const isProfitable = report.estimatedProfit > gasCost;

    return {
      ...report,
      estimatedGasCost: gasCost,
      isProfitable,
    };
  }
}
```

### src/nonce-manager.ts

```ts
import { Wallet, Provider } from "ethers";

/**
 * Manages nonces for sequential liquidation transactions.
 * Prevents nonce conflicts when multiple liquidations trigger simultaneously.
 */
export class NonceManager {
  private currentNonce: number = -1;
  private lock: Promise<void> = Promise.resolve();

  constructor(private wallet: Wallet) {}

  /**
   * Get next nonce, auto-syncing with chain if needed.
   */
  async getNextNonce(): Promise<number> {
    // Simple mutex pattern
    let resolve: () => void;
    const prevLock = this.lock;
    this.lock = new Promise<void>((r) => {
      resolve = r;
    });

    await prevLock;

    try {
      if (this.currentNonce === -1) {
        this.currentNonce = await this.wallet.getNonce("pending");
      } else {
        this.currentNonce++;
      }
      return this.currentNonce;
    } finally {
      resolve!();
    }
  }

  /** Reset nonce tracking (e.g., after a tx failure) */
  reset(): void {
    this.currentNonce = -1;
  }
}
```

### src/monitor.ts

```ts
import { JsonRpcProvider, Provider } from "ethers";
import {
  MonitorConfig,
  HealthReport,
  LiquidationCallback,
  AlertCallback,
  Position,
} from "./types";
import { calculateHealthFactor } from "./health-factor";
import { GasGuard } from "./gas-guard";

export class LiquidationMonitor {
  private provider: Provider;
  private gasGuard: GasGuard;
  private running = false;
  private liquidationCallbacks: LiquidationCallback[] = [];
  private alertCallbacks: AlertCallback[] = [];

  constructor(private config: MonitorConfig) {
    this.provider =
      typeof config.provider === "string"
        ? new JsonRpcProvider(config.provider)
        : config.provider;
    this.gasGuard = new GasGuard(this.provider, config.maxGasPriceGwei);
  }

  /** Register liquidation callback */
  onLiquidation(callback: LiquidationCallback): this {
    this.liquidationCallbacks.push(callback);
    return this;
  }

  /** Register alert callback (fires before liquidation check) */
  onAlert(callback: AlertCallback): this {
    this.alertCallbacks.push(callback);
    return this;
  }

  /** Update the positions list dynamically */
  updatePositions(positions: Position[]): void {
    this.config.positions = positions;
  }

  /** Start the monitoring loop */
  async start(): Promise<void> {
    this.running = true;
    console.log(
      `[monitor] Started — watching ${this.config.positions.length} positions`,
    );

    while (this.running) {
      try {
        await this.checkAllPositions();
      } catch (error) {
        console.error("[monitor] Error:", error);
      }
      await new Promise((r) => setTimeout(r, this.config.pollInterval));
    }
  }

  stop(): void {
    this.running = false;
  }

  /** Check a single position */
  async checkPosition(position: Position): Promise<HealthReport> {
    let report = await calculateHealthFactor(position, this.config.priceFeed);

    if (report.healthFactor < this.config.healthFactorThreshold * 1.1) {
      // Alert zone — approaching liquidation
      for (const cb of this.alertCallbacks) {
        await cb(report);
      }
    }

    if (report.isLiquidatable) {
      report = await this.gasGuard.checkProfitability(report);
      if (report.isProfitable) {
        for (const cb of this.liquidationCallbacks) {
          await cb(report);
        }
      }
    }

    return report;
  }

  private async checkAllPositions(): Promise<void> {
    for (const position of this.config.positions) {
      await this.checkPosition(position);
    }
  }
}
```

### src/price-feeds/chainlink.ts

```ts
import { Contract, Provider } from "ethers";
import { PriceFeed } from "../types";

const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() external view returns (uint8)",
];

export class ChainlinkPriceFeed implements PriceFeed {
  private feeds: Map<string, string>; // token address → aggregator address

  constructor(
    private provider: Provider,
    feedMapping: Record<string, string>,
  ) {
    this.feeds = new Map(
      Object.entries(feedMapping).map(([k, v]) => [k.toLowerCase(), v]),
    );
  }

  async getPrice(tokenAddress: string): Promise<bigint> {
    const feedAddr = this.feeds.get(tokenAddress.toLowerCase());
    if (!feedAddr) throw new Error(`No price feed for ${tokenAddress}`);

    const aggregator = new Contract(feedAddr, AGGREGATOR_ABI, this.provider);
    const [, answer, , ,] = await aggregator.latestRoundData();
    const decimals = await aggregator.decimals();

    // Normalize to 18 decimals
    return BigInt(answer) * 10n ** (18n - BigInt(decimals));
  }

  async getPrices(tokenAddresses: string[]): Promise<Map<string, bigint>> {
    const results = new Map<string, bigint>();
    for (const addr of tokenAddresses) {
      results.set(addr, await this.getPrice(addr));
    }
    return results;
  }
}
```

### src/index.ts

```ts
export { LiquidationMonitor } from "./monitor";
export { GasGuard } from "./gas-guard";
export { NonceManager } from "./nonce-manager";
export { calculateHealthFactor } from "./health-factor";
export { ChainlinkPriceFeed } from "./price-feeds/chainlink";
export type {
  MonitorConfig,
  Position,
  HealthReport,
  PriceFeed,
  LiquidationCallback,
  AlertCallback,
} from "./types";
```

---

## Usage Example

```ts
import { LiquidationMonitor, ChainlinkPriceFeed } from "liquidation-monitor";

const monitor = new LiquidationMonitor({
  provider: "https://eth-mainnet.g.alchemy.com/v2/KEY",
  pollInterval: 10000,
  healthFactorThreshold: 1.0,
  minProfitEth: 0.01,
  maxGasPriceGwei: 50,
  priceFeed: new ChainlinkPriceFeed(provider, {
    "0xA0b8...": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // ETH/USD
    "0x6B17...": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // USDC/USD
  }),
  positions: [
    {
      id: "pos-1",
      userAddress: "0x...",
      collateralToken: "0xA0b8...",
      collateralAmount: 10n * 10n ** 18n,
      debtToken: "0x6B17...",
      debtAmount: 15000n * 10n ** 6n,
      liquidationThreshold: 0.825,
    },
  ],
});

monitor
  .onAlert(async (report) => {
    console.log(
      `⚠️ Position ${report.position.id} HF: ${report.healthFactor.toFixed(4)}`,
    );
  })
  .onLiquidation(async (report) => {
    console.log(
      `🔴 LIQUIDATE ${report.position.id} — profit: ${report.estimatedProfit}`,
    );
    // Execute liquidation transaction here
  });

await monitor.start();
```

---

## Testing & Publishing — same pattern as other packages.
