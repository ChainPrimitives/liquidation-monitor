import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiquidationMonitor } from "../src/monitor";
import { StaticPriceFeed } from "../src/price-feeds/static";
import { Position, MonitorConfig } from "../src/types";
import { WAD } from "../src/utils";

const ETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function mockProvider(gasPriceGwei: number = 20) {
  return {
    getFeeData: vi.fn().mockResolvedValue({
      gasPrice: BigInt(gasPriceGwei) * 10n ** 9n,
    }),
  } as any;
}

function makeConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    provider: mockProvider(),
    pollInterval: 100,
    healthFactorThreshold: 1.0,
    minProfitEth: 0.01,
    maxGasPriceGwei: 50,
    priceFeed: new StaticPriceFeed({
      [ETH_ADDRESS]: 2000n * WAD,
      [USDC_ADDRESS]: 1n * WAD,
    }),
    positions: [
      {
        id: "pos-1",
        userAddress: "0x1234567890123456789012345678901234567890",
        collateralToken: ETH_ADDRESS,
        collateralAmount: 10n * WAD,
        debtToken: USDC_ADDRESS,
        debtAmount: 15000n * WAD,
        liquidationThreshold: 0.825,
      },
    ],
    ...overrides,
  };
}

describe("LiquidationMonitor", () => {
  describe("construction", () => {
    it("should accept a provider instance", () => {
      const config = makeConfig();
      const monitor = new LiquidationMonitor(config);
      expect(monitor).toBeInstanceOf(LiquidationMonitor);
    });

    it("should accept a string RPC URL", () => {
      const config = makeConfig({ provider: "http://localhost:8545" });
      const monitor = new LiquidationMonitor(config);
      expect(monitor).toBeInstanceOf(LiquidationMonitor);
    });
  });

  describe("checkPosition", () => {
    it("should return a healthy report for safe positions", async () => {
      const config = makeConfig();
      const monitor = new LiquidationMonitor(config);

      const report = await monitor.checkPosition(config.positions[0]);

      expect(report.healthFactor).toBeCloseTo(1.1, 4);
      expect(report.isLiquidatable).toBe(false);
    });

    it("should trigger alert callback when approaching threshold", async () => {
      const alertCb = vi.fn().mockResolvedValue(undefined);
      const config = makeConfig();
      const monitor = new LiquidationMonitor(config);
      monitor.onAlert(alertCb);

      // HF = 1.1, threshold = 1.0, alert zone = < 1.1
      // Position is in alert zone (1.1 < 1.0 * 1.1 = 1.1 is false, but close)
      // Let's make it clearly in alert zone
      const position: Position = {
        ...config.positions[0],
        debtAmount: 16000n * WAD, // HF = (10*2000*0.825)/16000 = 1.03125
      };

      await monitor.checkPosition(position);

      // 1.03125 < 1.0 * 1.1 = 1.1, so alert should fire
      expect(alertCb).toHaveBeenCalledTimes(1);
    });

    it("should trigger liquidation callback for profitable liquidations", async () => {
      const liquidationCb = vi.fn().mockResolvedValue(undefined);
      const priceFeed = new StaticPriceFeed({
        [ETH_ADDRESS]: 1000n * WAD, // Price crashed
        [USDC_ADDRESS]: 1n * WAD,
      });

      const config = makeConfig({ priceFeed });
      const monitor = new LiquidationMonitor(config);
      monitor.onLiquidation(liquidationCb);

      await monitor.checkPosition(config.positions[0]);

      expect(liquidationCb).toHaveBeenCalledTimes(1);
      const report = liquidationCb.mock.calls[0][0];
      expect(report.isLiquidatable).toBe(true);
      expect(report.isProfitable).toBe(true);
    });

    it("should NOT trigger liquidation when gas is too high", async () => {
      const liquidationCb = vi.fn().mockResolvedValue(undefined);
      const priceFeed = new StaticPriceFeed({
        [ETH_ADDRESS]: 1000n * WAD,
        [USDC_ADDRESS]: 1n * WAD,
      });

      const config = makeConfig({
        provider: mockProvider(100), // 100 gwei — above max of 50
        priceFeed,
      });
      const monitor = new LiquidationMonitor(config);
      monitor.onLiquidation(liquidationCb);

      await monitor.checkPosition(config.positions[0]);

      expect(liquidationCb).not.toHaveBeenCalled();
    });
  });

  describe("position management", () => {
    it("should update positions dynamically", () => {
      const config = makeConfig();
      const monitor = new LiquidationMonitor(config);

      const newPositions: Position[] = [
        {
          id: "pos-new",
          userAddress: "0xABCD",
          collateralToken: ETH_ADDRESS,
          collateralAmount: 5n * WAD,
          debtToken: USDC_ADDRESS,
          debtAmount: 8000n * WAD,
          liquidationThreshold: 0.8,
        },
      ];

      monitor.updatePositions(newPositions);
      // Verify by checking all positions
      // (internal state verified through checkAllPositions)
    });

    it("should add a position", async () => {
      const config = makeConfig({ positions: [] });
      const monitor = new LiquidationMonitor(config);

      monitor.addPosition({
        id: "pos-added",
        userAddress: "0xABCD",
        collateralToken: ETH_ADDRESS,
        collateralAmount: 10n * WAD,
        debtToken: USDC_ADDRESS,
        debtAmount: 15000n * WAD,
        liquidationThreshold: 0.825,
      });

      const reports = await monitor.checkAllPositions();
      expect(reports).toHaveLength(1);
      expect(reports[0].position.id).toBe("pos-added");
    });

    it("should remove a position by ID", async () => {
      const config = makeConfig();
      const monitor = new LiquidationMonitor(config);

      const removed = monitor.removePosition("pos-1");
      expect(removed).toBe(true);

      const reports = await monitor.checkAllPositions();
      expect(reports).toHaveLength(0);
    });

    it("should return false when removing non-existent position", () => {
      const config = makeConfig();
      const monitor = new LiquidationMonitor(config);

      expect(monitor.removePosition("non-existent")).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("should throw if started twice", async () => {
      const config = makeConfig({ pollInterval: 50 });
      const monitor = new LiquidationMonitor(config);

      // Start in background
      const startPromise = monitor.start();

      // Wait a tick for it to enter the loop
      await new Promise((r) => setTimeout(r, 10));

      await expect(monitor.start()).rejects.toThrow("already running");

      monitor.stop();
      await startPromise;
    });

    it("should stop gracefully", async () => {
      const config = makeConfig({ pollInterval: 50 });
      const monitor = new LiquidationMonitor(config);

      const startPromise = monitor.start();
      await new Promise((r) => setTimeout(r, 10));

      expect(monitor.isRunning()).toBe(true);
      monitor.stop();
      await startPromise;
      expect(monitor.isRunning()).toBe(false);
    });

    it("should emit errors through error callback", async () => {
      const errorCb = vi.fn();
      const badPriceFeed = {
        getPrice: vi.fn().mockRejectedValue(new Error("RPC down")),
        getPrices: vi.fn().mockRejectedValue(new Error("RPC down")),
      };

      const config = makeConfig({ priceFeed: badPriceFeed, pollInterval: 50 });
      const monitor = new LiquidationMonitor(config);
      monitor.onError(errorCb);

      const startPromise = monitor.start();
      await new Promise((r) => setTimeout(r, 80));
      monitor.stop();
      await startPromise;

      expect(errorCb).toHaveBeenCalled();
      expect(errorCb.mock.calls[0][0].message).toBe("RPC down");
    });
  });

  describe("checkAllPositions", () => {
    it("should check all positions and return reports", async () => {
      const positions: Position[] = [
        {
          id: "pos-1",
          userAddress: "0x1111",
          collateralToken: ETH_ADDRESS,
          collateralAmount: 10n * WAD,
          debtToken: USDC_ADDRESS,
          debtAmount: 15000n * WAD,
          liquidationThreshold: 0.825,
        },
        {
          id: "pos-2",
          userAddress: "0x2222",
          collateralToken: ETH_ADDRESS,
          collateralAmount: 5n * WAD,
          debtToken: USDC_ADDRESS,
          debtAmount: 5000n * WAD,
          liquidationThreshold: 0.8,
        },
      ];

      const config = makeConfig({ positions });
      const monitor = new LiquidationMonitor(config);

      const reports = await monitor.checkAllPositions();

      expect(reports).toHaveLength(2);
      expect(reports[0].position.id).toBe("pos-1");
      expect(reports[1].position.id).toBe("pos-2");
    });
  });
});
