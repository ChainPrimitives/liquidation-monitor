import { describe, it, expect, vi } from "vitest";
import { NonceManager } from "../src/nonce-manager";

function mockWallet(startingNonce: number = 5) {
  return {
    getNonce: vi.fn().mockResolvedValue(startingNonce),
  } as any;
}

describe("NonceManager", () => {
  it("should fetch nonce from chain on first call", async () => {
    const wallet = mockWallet(10);
    const manager = new NonceManager(wallet);

    const nonce = await manager.getNextNonce();

    expect(nonce).toBe(10);
    expect(wallet.getNonce).toHaveBeenCalledWith("pending");
  });

  it("should increment nonce on subsequent calls", async () => {
    const wallet = mockWallet(5);
    const manager = new NonceManager(wallet);

    const n1 = await manager.getNextNonce();
    const n2 = await manager.getNextNonce();
    const n3 = await manager.getNextNonce();

    expect(n1).toBe(5);
    expect(n2).toBe(6);
    expect(n3).toBe(7);
    // Should only fetch from chain once
    expect(wallet.getNonce).toHaveBeenCalledTimes(1);
  });

  it("should handle concurrent calls sequentially", async () => {
    const wallet = mockWallet(0);
    const manager = new NonceManager(wallet);

    // Fire multiple concurrent requests
    const results = await Promise.all([
      manager.getNextNonce(),
      manager.getNextNonce(),
      manager.getNextNonce(),
      manager.getNextNonce(),
      manager.getNextNonce(),
    ]);

    // Should get sequential nonces
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("should reset and re-fetch from chain", async () => {
    const wallet = mockWallet(5);
    const manager = new NonceManager(wallet);

    await manager.getNextNonce(); // 5
    await manager.getNextNonce(); // 6

    // Simulate a tx failure — reset
    manager.reset();

    // Update mock to return new chain nonce
    wallet.getNonce.mockResolvedValue(5); // tx at nonce 5 failed, still pending

    const nonce = await manager.getNextNonce();
    expect(nonce).toBe(5);
    expect(wallet.getNonce).toHaveBeenCalledTimes(2);
  });

  it("getCurrentNonce should return -1 before initialization", () => {
    const wallet = mockWallet(0);
    const manager = new NonceManager(wallet);

    expect(manager.getCurrentNonce()).toBe(-1);
  });

  it("getCurrentNonce should return current nonce after calls", async () => {
    const wallet = mockWallet(10);
    const manager = new NonceManager(wallet);

    await manager.getNextNonce();
    expect(manager.getCurrentNonce()).toBe(10);

    await manager.getNextNonce();
    expect(manager.getCurrentNonce()).toBe(11);
  });
});
