# liquidation-monitor

A configurable DeFi health-factor monitoring library for lending protocols. Watches positions, checks collateral ratios against price feeds, and triggers liquidation callbacks with gas price guards and nonce management.

## Features

- **Health factor computation** — Calculates position health using WAD-precision math
- **Multiple price feed adapters** — Chainlink oracles, Uniswap V3 TWAP, or bring your own
- **Gas profitability guard** — Only triggers liquidations when profitable after gas costs
- **Nonce management** — Sequential transaction nonces with mutex locking
- **Event-driven callbacks** — Alert and liquidation hooks for custom logic
- **Dynamic position management** — Add/remove positions without restarting

## Install

```bash
npm install liquidation-monitor ethers
```

> `ethers ^6.0.0` is a peer dependency.

## Quick Start

```ts
import { LiquidationMonitor, ChainlinkPriceFeed } from "liquidation-monitor";
import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider("https://eth-mainnet.g.alchemy.com/v2/KEY");

const priceFeed = new ChainlinkPriceFeed(provider, {
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", // ETH/USD
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // USDC/USD
});

const monitor = new LiquidationMonitor({
  provider,
  pollInterval: 10_000,
  healthFactorThreshold: 1.0,
  minProfitEth: 0.01,
  maxGasPriceGwei: 50,
  priceFeed,
  positions: [
    {
      id: "pos-1",
      userAddress: "0x...",
      collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      collateralAmount: 10n * 10n ** 18n,
      debtToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      debtAmount: 15000n * 10n ** 18n,
      liquidationThreshold: 0.825,
    },
  ],
});

monitor
  .onAlert(async (report) => {
    console.log(`⚠️ Position ${report.position.id} HF: ${report.healthFactor.toFixed(4)}`);
  })
  .onLiquidation(async (report) => {
    console.log(`🔴 LIQUIDATE ${report.position.id} — profit: ${report.estimatedProfit}`);
    // Execute your liquidation transaction here
  })
  .onError((err) => {
    console.error("Monitor error:", err.message);
  });

await monitor.start();
```

## API

### `LiquidationMonitor`

The core monitoring engine.

| Method | Description |
|--------|-------------|
| `onLiquidation(cb)` | Register callback for profitable liquidation opportunities |
| `onAlert(cb)` | Register callback when positions approach liquidation |
| `onError(cb)` | Register error handler for the monitoring loop |
| `start()` | Start the polling loop |
| `stop()` | Stop the polling loop |
| `checkPosition(pos)` | Check a single position (one-shot) |
| `checkAllPositions()` | Check all positions (one-shot) |
| `updatePositions(pos[])` | Replace the position list |
| `addPosition(pos)` | Add a position to the watch list |
| `removePosition(id)` | Remove a position by ID |

### `GasGuard`

Evaluates whether a liquidation is profitable after gas costs.

### `NonceManager`

Manages sequential nonces for liquidation transactions with mutex-style locking.

### Price Feeds

| Class | Description |
|-------|-------------|
| `ChainlinkPriceFeed` | Reads from Chainlink aggregator contracts |
| `UniswapTwapPriceFeed` | Computes TWAP from Uniswap V3 pool observations |
| `StaticPriceFeed` | Fixed prices for testing |

All price feeds implement the `PriceFeed` interface — bring your own by implementing `getPrice()` and `getPrices()`.

### Utilities

```ts
import { wadMul, wadDiv, toWad, fromWad, WAD, retry } from "liquidation-monitor";
```

## Configuration

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `string \| Provider` | Ethers provider or RPC URL |
| `pollInterval` | `number` | Polling interval in ms |
| `healthFactorThreshold` | `number` | HF below this triggers liquidation (typically 1.0) |
| `minProfitEth` | `number` | Minimum profit in ETH to proceed |
| `maxGasPriceGwei` | `number` | Gas price ceiling in gwei |
| `priceFeed` | `PriceFeed` | Price feed implementation |
| `positions` | `Position[]` | Initial positions to monitor |

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

## License

MIT
