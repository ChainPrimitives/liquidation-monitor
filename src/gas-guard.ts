import { Provider } from "ethers";
import { HealthReport } from "./types";

/**
 * Gas price guard that checks whether a liquidation is profitable
 * after accounting for gas costs.
 *
 * Prevents executing liquidations during gas spikes that would
 * eat into or exceed the liquidation bonus.
 */
export class GasGuard {
  private readonly maxGasWei: bigint;

  constructor(
    private readonly provider: Provider,
    maxGasPriceGwei: number,
    private readonly estimatedGasUnits: bigint = 350_000n,
  ) {
    this.maxGasWei = BigInt(maxGasPriceGwei) * 10n ** 9n;
  }

  /**
   * Evaluate whether a liquidation is profitable after gas costs.
   *
   * @param report - Health report to evaluate
   * @returns Updated report with gas cost and profitability info
   */
  async checkProfitability(report: HealthReport): Promise<HealthReport> {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 0n;

    // Reject if gas price exceeds ceiling
    if (gasPrice > this.maxGasWei) {
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

  /**
   * Get the current gas price from the provider.
   */
  async getCurrentGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice ?? 0n;
  }

  /**
   * Check if current gas price is below the configured maximum.
   */
  async isGasPriceAcceptable(): Promise<boolean> {
    const currentGas = await this.getCurrentGasPrice();
    return currentGas <= this.maxGasWei;
  }
}
