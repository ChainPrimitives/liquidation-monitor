import { Position, PriceFeed, HealthReport } from "./types";
import { wadMul, wadDiv, WAD, toWad } from "./utils";

/**
 * Calculate health factor for a lending position.
 *
 * Formula:
 *   healthFactor = (collateralValue * liquidationThreshold) / debtValue
 *
 * If healthFactor < 1.0, the position is liquidatable.
 *
 * @param position - The lending position to evaluate
 * @param priceFeed - Price feed provider for token prices
 * @returns Health report with computed metrics
 */
export async function calculateHealthFactor(
  position: Position,
  priceFeed: PriceFeed,
): Promise<HealthReport> {
  const prices = await priceFeed.getPrices([
    position.collateralToken,
    position.debtToken,
  ]);

  const collateralPrice = prices.get(position.collateralToken);
  const debtPrice = prices.get(position.debtToken);

  if (collateralPrice === undefined) {
    throw new Error(
      `No price available for collateral token: ${position.collateralToken}`,
    );
  }
  if (debtPrice === undefined) {
    throw new Error(
      `No price available for debt token: ${position.debtToken}`,
    );
  }

  // Collateral value in USD (WAD precision)
  const collateralValueUsd = wadMul(position.collateralAmount, collateralPrice);

  // Debt value in USD (WAD precision)
  const debtValueUsd = wadMul(position.debtAmount, debtPrice);

  // Health factor calculation
  const thresholdWad = toWad(position.liquidationThreshold);
  const adjustedCollateral = wadMul(collateralValueUsd, thresholdWad);

  let healthFactor: number;
  if (debtValueUsd === 0n) {
    healthFactor = Infinity;
  } else {
    const hfWad = wadDiv(adjustedCollateral, debtValueUsd);
    healthFactor = Number(hfWad) / 1e18;
  }

  const isLiquidatable = healthFactor < 1.0;

  // Estimate liquidation profit (simplified: 5% liquidation bonus on collateral)
  const LIQUIDATION_BONUS = WAD / 20n; // 5% = 0.05 * WAD
  const liquidationBonus = wadMul(collateralValueUsd, LIQUIDATION_BONUS);
  const estimatedProfit = isLiquidatable ? liquidationBonus : 0n;

  return {
    position,
    healthFactor,
    collateralValueUsd,
    debtValueUsd,
    isLiquidatable,
    estimatedProfit,
    estimatedGasCost: 0n, // Set by GasGuard
    isProfitable: false, // Set by GasGuard
  };
}
