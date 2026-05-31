import { Wallet } from "ethers";

/**
 * Manages nonces for sequential liquidation transactions.
 *
 * Prevents nonce conflicts when multiple liquidations trigger simultaneously
 * by maintaining a local nonce counter with mutex-style locking.
 */
export class NonceManager {
  private currentNonce: number = -1;
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly wallet: Wallet) {}

  /**
   * Get the next available nonce, auto-syncing with chain on first call.
   *
   * Uses a simple mutex pattern to ensure sequential nonce assignment
   * even when called concurrently.
   */
  async getNextNonce(): Promise<number> {
    let release: () => void;
    const prevLock = this.lock;
    this.lock = new Promise<void>((r) => {
      release = r;
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
      release!();
    }
  }

  /**
   * Reset nonce tracking. Call this after a transaction failure
   * to re-sync with the chain on the next getNextNonce() call.
   */
  reset(): void {
    this.currentNonce = -1;
  }

  /**
   * Get the current tracked nonce without incrementing.
   * Returns -1 if not yet initialized.
   */
  getCurrentNonce(): number {
    return this.currentNonce;
  }
}
