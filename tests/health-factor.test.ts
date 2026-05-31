import { describe, it, expect } from "vitest";
import { calculateHealthFactor } from "../src/health-factor";
import { StaticPriceFeed } from "../src/price-feeds/static";
import { Position } from "../src/types";
import { WAD } from "../src/utils";

const ETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "test-pos-1",
    userAddress: "0x1234567890123456789012345678901234567890",
    collateralToken: ETH_ADDRESS,
    collateralAmount: 10n * WAD, // 10 ETH
    debtToken: USDC_ADDRESS,
    debtAmount: 15000n * WAD, // 15000 USDC (normalized to 18 decimals)
    liquidationThreshold: 0.825,
    ...overrides,
  };
}

describe("calculateHealthFactor", () => {
  it("should compute a healthy position correctly", async () => {
    const priceFeed = new StaticPriceFeed({
      [ETH_ADDRESS]: 2000n * WAD, // $2000
      [USDC_ADDRESS]: 1n * WAD, // $1
    });

    const position = makePosition();
    const report = await calculateHealthFactor(position, priceFeed);

    // HF = (10 * 2000 * 0.825) / 15000 = 16500 / 15000 = 1.1
    expect(report.healthFactor).toBeCloseTo(1.1, 4);
    expect(report.isLiquidatable).toBe(false);
    expect(report.estimatedProfit).toBe(0n);
  });

  it("should detect a liquidatable position", async () => {
    const priceFeed = new StaticPriceFeed({
      [ETH_ADDRESS]: 1500n * WAD, // $1500 — price dropped
      [USDC_ADDRESS]: 1n * WAD,
    });

    const position = makePosition();
    const report = await calculateHealthFactor(position, priceFeed);

    // HF = (10 * 1500 * 0.825) / 15000 = 12375 / 15000 = 0.825
    expect(report.healthFactor).toBeCloseTo(0.825, 4);
    expect(report.isLiquidatable).toBe(true);
    expect(report.estimatedProfit).toBeGreaterThan(0n);
  });

  it("should return Infinity health factor when debt is zero", async () => {
    const priceFeed = new StaticPriceFeed({
      [ETH_ADDRESS]: 2000n * WAD,
      [USDC_ADDRESS]: 1n * WAD,
    });

    const position = makePosition({ debtAmount: 0n });
    const report = await calculateHealthFactor(position, priceFeed);

    expect(report.healthFactor).toBe(Infinity);
    expect(report.isLiquidatable).toBe(false);
  });

  it("should throw when price is missing for collateral token", async () => {
    const priceFeed = new StaticPriceFeed({
      [USDC_ADDRESS]: 1n * WAD,
    });

    const position = makePosition();
    await expect(calculateHealthFactor(position, priceFeed)).rejects.toThrow(
      /No static price configured/,
    );
  });

  it("should throw when price is missing for debt token", async () => {
    const priceFeed = new StaticPriceFeed({
      [ETH_ADDRESS]: 2000n * WAD,
    });

    const position = makePosition();
    await expect(calculateHealthFactor(position, priceFeed)).rejects.toThrow(
      /No static price configured/,
    );
  });

  it("should compute estimated profit as 5% of collateral value", async () => {
    const priceFeed = new StaticPriceFeed({
      [ETH_ADDRESS]: 1000n * WAD, // Very low price to trigger liquidation
      [USDC_ADDRESS]: 1n * WAD,
    });

    const position = makePosition();
    const report = await calculateHealthFactor(position, priceFeed);

    expect(report.isLiquidatable).toBe(true);
    // Collateral value = 10 * 1000 = $10000
    // 5% bonus = $500 = 500 * WAD
    const expectedProfit = 500n * WAD;
    expect(report.estimatedProfit).toBe(expectedProfit);
  });

  it("should handle positions at exactly the threshold", async () => {
    // HF = (collateral * threshold) / debt = 1.0 exactly
    // collateral * price * threshold = debt * price
    // 10 * price_eth * 0.825 = debt * 1
    // For HF = 1.0: debt = 10 * 2000 * 0.825 = 16500
    const priceFeed = new StaticPriceFeed({
      [ETH_ADDRESS]: 2000n * WAD,
      [USDC_ADDRESS]: 1n * WAD,
    });

    const position = makePosition({ debtAmount: 16500n * WAD });
    const report = await calculateHealthFactor(position, priceFeed);

    expect(report.healthFactor).toBeCloseTo(1.0, 4);
    // At exactly 1.0, not liquidatable (< 1.0 required)
    expect(report.isLiquidatable).toBe(false);
  });
});
