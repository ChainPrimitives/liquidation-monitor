import { describe, it, expect, vi } from "vitest";
import { GasGuard } from "../src/gas-guard";
import { HealthReport, Position } from "../src/types";
import { WAD } from "../src/utils";

function mockProvider(gasPriceGwei: number) {
  return {
    getFeeData: vi.fn().mockResolvedValue({
      gasPrice: BigInt(gasPriceGwei) * 10n ** 9n,
    }),
  } as any;
}

function makeReport(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    position: {
      id: "test-pos",
      userAddress: "0x1234",
      collateralToken: "0xAAA",
      collateralAmount: 10n * WAD,
      debtToken: "0xBBB",
      debtAmount: 15000n * WAD,
      liquidationThreshold: 0.825,
    },
    healthFactor: 0.9,
    collateralValueUsd: 20000n * WAD,
    debtValueUsd: 15000n * WAD,
    isLiquidatable: true,
    estimatedProfit: 1000n * WAD, // $1000 profit
    estimatedGasCost: 0n,
    isProfitable: false,
    ...overrides,
  };
}

describe("GasGuard", () => {
  it("should mark as profitable when gas cost is below profit", async () => {
    const provider = mockProvider(20); // 20 gwei
    const guard = new GasGuard(provider, 50); // max 50 gwei

    const report = makeReport({ estimatedProfit: 1000n * WAD });
    const result = await guard.checkProfitability(report);

    // Gas cost = 20 gwei * 350000 = 7_000_000 gwei = 0.007 ETH
    // At ~$2000/ETH that's $14 — well below $1000 profit
    expect(result.isProfitable).toBe(true);
    expect(result.estimatedGasCost).toBe(20n * 10n ** 9n * 350_000n);
  });

  it("should mark as not profitable when gas price exceeds max", async () => {
    const provider = mockProvider(100); // 100 gwei — above max
    const guard = new GasGuard(provider, 50); // max 50 gwei

    const report = makeReport();
    const result = await guard.checkProfitability(report);

    expect(result.isProfitable).toBe(false);
  });

  it("should mark as not profitable when gas cost exceeds profit", async () => {
    const provider = mockProvider(30); // 30 gwei
    const guard = new GasGuard(provider, 50, 10_000_000n); // Very high gas units

    // Small profit that gas will exceed
    const report = makeReport({ estimatedProfit: 1n }); // 1 wei profit
    const result = await guard.checkProfitability(report);

    expect(result.isProfitable).toBe(false);
    expect(result.estimatedGasCost).toBeGreaterThan(report.estimatedProfit);
  });

  it("should handle zero gas price", async () => {
    const provider = {
      getFeeData: vi.fn().mockResolvedValue({ gasPrice: null }),
    } as any;
    const guard = new GasGuard(provider, 50);

    const report = makeReport({ estimatedProfit: 100n });
    const result = await guard.checkProfitability(report);

    // 0 gas price means 0 cost, so any profit is profitable
    expect(result.isProfitable).toBe(true);
    expect(result.estimatedGasCost).toBe(0n);
  });

  it("should use custom gas units estimate", async () => {
    const provider = mockProvider(10);
    const customGasUnits = 500_000n;
    const guard = new GasGuard(provider, 50, customGasUnits);

    const report = makeReport();
    const result = await guard.checkProfitability(report);

    const expectedCost = 10n * 10n ** 9n * customGasUnits;
    expect(result.estimatedGasCost).toBe(expectedCost);
  });

  it("getCurrentGasPrice should return current gas price", async () => {
    const provider = mockProvider(42);
    const guard = new GasGuard(provider, 50);

    const gasPrice = await guard.getCurrentGasPrice();
    expect(gasPrice).toBe(42n * 10n ** 9n);
  });

  it("isGasPriceAcceptable should return true when below max", async () => {
    const provider = mockProvider(30);
    const guard = new GasGuard(provider, 50);

    expect(await guard.isGasPriceAcceptable()).toBe(true);
  });

  it("isGasPriceAcceptable should return false when above max", async () => {
    const provider = mockProvider(60);
    const guard = new GasGuard(provider, 50);

    expect(await guard.isGasPriceAcceptable()).toBe(false);
  });
});
