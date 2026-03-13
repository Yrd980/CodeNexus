/**
 * @module foundation/database/transaction
 *
 * Transaction management utilities.
 *
 * Provides a `TransactionManager` that wraps any `DatabaseClient` to offer:
 * - Automatic commit on success / rollback on error
 * - Nested transactions via SAVEPOINTs
 * - Configurable isolation levels
 */

import type {
  DatabaseClient,
  IsolationLevel,
  QueryResult,
  Transaction,
  TransactionOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Transaction implementation
// ---------------------------------------------------------------------------

/**
 * Concrete `Transaction` implementation backed by a `DatabaseClient`.
 *
 * In a real driver adapter this would hold a dedicated connection from the
 * pool.  Here we delegate to the client's `query` for portability.
 */
export class TransactionImpl implements Transaction {
  private _committed = false;
  private _rolledBack = false;
  private readonly _savepoints: Set<string> = new Set();

  constructor(
    private readonly client: DatabaseClient,
    private readonly isolationLevel: IsolationLevel,
    private readonly readOnly: boolean,
  ) {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Send the BEGIN statement (called by `TransactionManager`). */
  async begin(): Promise<void> {
    let sql = "BEGIN";
    if (this.isolationLevel !== "READ COMMITTED") {
      sql += ` ISOLATION LEVEL ${this.isolationLevel}`;
    }
    if (this.readOnly) {
      sql += " READ ONLY";
    }
    await this.client.query(sql);
  }

  async commit(): Promise<void> {
    this.assertOpen();
    await this.client.query("COMMIT");
    this._committed = true;
  }

  async rollback(): Promise<void> {
    if (this._committed || this._rolledBack) return;
    await this.client.query("ROLLBACK");
    this._rolledBack = true;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    this.assertOpen();
    return this.client.query<T>(sql, params);
  }

  // -----------------------------------------------------------------------
  // Savepoints (nested transactions)
  // -----------------------------------------------------------------------

  async savepoint(name: string): Promise<void> {
    this.assertOpen();
    validateSavepointName(name);
    await this.client.query(`SAVEPOINT ${name}`);
    this._savepoints.add(name);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    this.assertOpen();
    if (!this._savepoints.has(name)) {
      throw new Error(`Savepoint "${name}" does not exist`);
    }
    await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  async releaseSavepoint(name: string): Promise<void> {
    this.assertOpen();
    if (!this._savepoints.has(name)) {
      throw new Error(`Savepoint "${name}" does not exist`);
    }
    await this.client.query(`RELEASE SAVEPOINT ${name}`);
    this._savepoints.delete(name);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  get isFinished(): boolean {
    return this._committed || this._rolledBack;
  }

  private assertOpen(): void {
    if (this._committed) throw new Error("Transaction already committed");
    if (this._rolledBack) throw new Error("Transaction already rolled back");
  }
}

// ---------------------------------------------------------------------------
// TransactionManager
// ---------------------------------------------------------------------------

/**
 * High-level helper that wraps a `DatabaseClient` and provides
 * callback-based transaction management.
 */
export class TransactionManager {
  constructor(private readonly client: DatabaseClient) {}

  /**
   * Execute `fn` inside a transaction.
   *
   * - If `fn` resolves, the transaction is **committed** and the result
   *   returned.
   * - If `fn` throws, the transaction is **rolled back** and the error
   *   re-thrown.
   */
  async run<T>(
    fn: (tx: Transaction) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    const {
      isolationLevel = "READ COMMITTED",
      readOnly = false,
    } = options;

    const tx = new TransactionImpl(this.client, isolationLevel, readOnly);
    await tx.begin();

    try {
      const result = await fn(tx);
      if (!tx.isFinished) {
        await tx.commit();
      }
      return result;
    } catch (err) {
      if (!tx.isFinished) {
        await tx.rollback();
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Savepoint names must be simple identifiers to prevent SQL injection.
 * We allow alphanumeric + underscores only.
 */
function validateSavepointName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid savepoint name "${name}". Use only letters, digits, and underscores.`,
    );
  }
}
