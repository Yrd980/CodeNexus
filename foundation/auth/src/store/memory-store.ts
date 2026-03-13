/**
 * @module foundation/auth - In-Memory Token Store
 *
 * A simple in-memory implementation of TokenStore for development and testing.
 *
 * DO NOT use this in production:
 * - Data is lost on process restart
 * - No horizontal scaling (each process has its own store)
 * - Memory grows unbounded without cleanup
 *
 * For production, implement TokenStore backed by Redis (fast, TTL support built-in)
 * or your database (PostgreSQL, MongoDB, etc.).
 */

import type { RefreshToken, TokenStore } from "../types.js";

export class MemoryTokenStore implements TokenStore {
  /** Primary storage: token string -> RefreshToken */
  private tokens = new Map<string, RefreshToken>();

  /** Index: userId -> Set of token strings (for efficient user lookups) */
  private userIndex = new Map<string, Set<string>>();

  /** Index: family -> Set of token strings (for efficient family lookups) */
  private familyIndex = new Map<string, Set<string>>();

  /** Interval handle for periodic cleanup */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new MemoryTokenStore.
   *
   * @param cleanupIntervalMs - How often to run expired token cleanup.
   *   Set to 0 to disable automatic cleanup. Default: 60000 (1 minute).
   */
  constructor(cleanupIntervalMs = 60_000) {
    if (cleanupIntervalMs > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpired();
      }, cleanupIntervalMs);

      // Allow Node.js to exit even if the interval is still running
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  async save(token: RefreshToken): Promise<void> {
    this.tokens.set(token.token, token);

    // Update user index
    let userTokens = this.userIndex.get(token.userId);
    if (!userTokens) {
      userTokens = new Set();
      this.userIndex.set(token.userId, userTokens);
    }
    userTokens.add(token.token);

    // Update family index
    let familyTokens = this.familyIndex.get(token.family);
    if (!familyTokens) {
      familyTokens = new Set();
      this.familyIndex.set(token.family, familyTokens);
    }
    familyTokens.add(token.token);
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    const stored = this.tokens.get(token);
    if (!stored) return null;

    // Return the token even if expired — the caller (rotateRefreshToken)
    // is responsible for checking expiry and returning the correct error code.
    // This enables distinguishing "not found" from "expired".
    return stored;
  }

  async findByUserId(userId: string): Promise<RefreshToken[]> {
    const tokenStrings = this.userIndex.get(userId);
    if (!tokenStrings) return [];

    const now = Math.floor(Date.now() / 1000);
    const results: RefreshToken[] = [];

    for (const tokenString of tokenStrings) {
      const token = this.tokens.get(tokenString);
      if (token && token.expiresAt > now) {
        results.push(token);
      }
    }

    return results;
  }

  async findByFamily(family: string): Promise<RefreshToken[]> {
    const tokenStrings = this.familyIndex.get(family);
    if (!tokenStrings) return [];

    const now = Math.floor(Date.now() / 1000);
    const results: RefreshToken[] = [];

    for (const tokenString of tokenStrings) {
      const token = this.tokens.get(tokenString);
      if (token && token.expiresAt > now) {
        results.push(token);
      }
    }

    return results;
  }

  async delete(token: string): Promise<void> {
    const stored = this.tokens.get(token);
    if (!stored) return;

    this.tokens.delete(token);

    // Clean up user index
    const userTokens = this.userIndex.get(stored.userId);
    if (userTokens) {
      userTokens.delete(token);
      if (userTokens.size === 0) {
        this.userIndex.delete(stored.userId);
      }
    }

    // Clean up family index
    const familyTokens = this.familyIndex.get(stored.family);
    if (familyTokens) {
      familyTokens.delete(token);
      if (familyTokens.size === 0) {
        this.familyIndex.delete(stored.family);
      }
    }
  }

  async deleteByFamily(family: string): Promise<void> {
    const tokenStrings = this.familyIndex.get(family);
    if (!tokenStrings) return;

    // Copy the set to avoid mutation during iteration
    for (const tokenString of [...tokenStrings]) {
      await this.delete(tokenString);
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    const tokenStrings = this.userIndex.get(userId);
    if (!tokenStrings) return;

    // Copy the set to avoid mutation during iteration
    for (const tokenString of [...tokenStrings]) {
      await this.delete(tokenString);
    }
  }

  /** Remove all expired tokens. Called automatically if cleanup interval is set. */
  cleanupExpired(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [tokenString, token] of this.tokens) {
      if (token.expiresAt <= now) {
        // Synchronous delete to avoid async issues in cleanup
        this.tokens.delete(tokenString);

        const userTokens = this.userIndex.get(token.userId);
        if (userTokens) {
          userTokens.delete(tokenString);
          if (userTokens.size === 0) {
            this.userIndex.delete(token.userId);
          }
        }

        const familyTokens = this.familyIndex.get(token.family);
        if (familyTokens) {
          familyTokens.delete(tokenString);
          if (familyTokens.size === 0) {
            this.familyIndex.delete(token.family);
          }
        }
      }
    }
  }

  /** Stop the cleanup interval. Call this when you're done with the store. */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /** Get the number of stored tokens (for testing/debugging) */
  get size(): number {
    return this.tokens.size;
  }
}
