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
import { sleep } from "./utils";

/**
 * Core liquidation monitoring engine.
 *
 * Polls positions at a configurable interval, computes health factors,
 * and triggers callbacks when positions become liquidatable and profitable.
 *
 * @example
 * ```ts
 * const monitor = new LiquidationMonitor({
 *   provider: "https://eth-mainnet.g.alchemy.com/v2/KEY",
 *   pollInterval: 10_000,
 *   healthFactorThreshold: 1.0,
 *   minProfitEth: 0.01,
 *   maxGasPriceGwei: 50,
 *   priceFeed: myPriceFeed,
 *   positions: myPositions,
 * });
 *
 * monitor
 *   .onAlert(async (report) => console.log("Alert:", report))
 *   .onLiquidation(async (report) => console.log("Liquidate:", report));
 *
 * await monitor.start();
 * ```
 */
export class LiquidationMonitor {
  private readonly provider: Provider;
  private readonly gasGuard: GasGuard;
  private running = false;
  private readonly liquidationCallbacks: LiquidationCallback[] = [];
  private readonly alertCallbacks: AlertCallback[] = [];
  private readonly errorCallbacks: Array<(error: Error) => void> = [];

  constructor(private config: MonitorConfig) {
    this.provider =
      typeof config.provider === "string"
        ? new JsonRpcProvider(config.provider)
        : (config.provider as Provider);
    this.gasGuard = new GasGuard(this.provider, config.maxGasPriceGwei);
  }

  /**
   * Register a callback for profitable liquidation opportunities.
   */
  onLiquidation(callback: LiquidationCallback): this {
    this.liquidationCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for positions approaching liquidation.
   * Fires when health factor drops below threshold * 1.1 (alert zone).
   */
  onAlert(callback: AlertCallback): this {
    this.alertCallbacks.push(callback);
    return this;
  }

  /**
   * Register an error callback for monitoring loop errors.
   */
  onError(callback: (error: Error) => void): this {
    this.errorCallbacks.push(callback);
    return this;
  }

  /**
   * Update the positions list dynamically.
   * Useful for adding/removing positions without restarting the monitor.
   */
  updatePositions(positions: Position[]): void {
    this.config.positions = positions;
  }

  /**
   * Add a single position to the watch list.
   */
  addPosition(position: Position): void {
    this.config.positions.push(position);
  }

  /**
   * Remove a position by ID.
   */
  removePosition(positionId: string): boolean {
    const idx = this.config.positions.findIndex((p) => p.id === positionId);
    if (idx === -1) return false;
    this.config.positions.splice(idx, 1);
    return true;
  }

  /**
   * Start the monitoring loop. Runs until stop() is called.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Monitor is already running");
    }

    this.running = true;

    while (this.running) {
      try {
        await this.checkAllPositions();
      } catch (error) {
        const err =
          error instanceof Error ? error : new Error(String(error));
        this.emitError(err);
      }
      if (this.running) {
        await sleep(this.config.pollInterval);
      }
    }
  }

  /**
   * Stop the monitoring loop gracefully.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if the monitor is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check a single position and return its health report.
   * Can be called independently of the monitoring loop.
   */
  async checkPosition(position: Position): Promise<HealthReport> {
    let report = await calculateHealthFactor(position, this.config.priceFeed);

    // Alert zone: approaching liquidation threshold
    if (report.healthFactor < this.config.healthFactorThreshold * 1.1) {
      for (const cb of this.alertCallbacks) {
        await cb(report);
      }
    }

    // Liquidation check
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

  /**
   * Check all monitored positions in sequence.
   * Returns all health reports.
   */
  async checkAllPositions(): Promise<HealthReport[]> {
    const reports: HealthReport[] = [];
    for (const position of this.config.positions) {
      const report = await this.checkPosition(position);
      reports.push(report);
    }
    return reports;
  }

  private emitError(error: Error): void {
    if (this.errorCallbacks.length > 0) {
      for (const cb of this.errorCallbacks) {
        cb(error);
      }
    } else {
      console.error("[liquidation-monitor] Error:", error.message);
    }
  }
}
