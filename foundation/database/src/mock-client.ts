/**
 * @module foundation/database/mock-client
 *
 * In-memory mock that implements `DatabaseClient`.
 *
 * Useful for:
 * - Unit testing code that depends on a database
 * - Verifying that the correct queries are generated
 * - Running the full module without any external dependencies
 *
 * The mock stores tables as arrays of plain objects and supports a
 * simplified query recording mechanism.
 */

import type {
  DatabaseClient,
  QueryResult,
  Transaction,
  TransactionOptions,
} from "./types.js";
import { TransactionImpl } from "./transaction.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recorded query for later assertion. */
export interface RecordedQuery {
  sql: string;
  params: unknown[];
  timestamp: Date;
}

/** Row data stored in an in-memory table. */
export type RowData = Record<string, unknown>;

// ---------------------------------------------------------------------------
// MockDatabaseClient
// ---------------------------------------------------------------------------

export class MockDatabaseClient implements DatabaseClient {
  /** In-memory tables: `{ tableName: rows[] }`. */
  private tables: Map<string, RowData[]> = new Map();

  /** Every query run against this client. */
  private _queryLog: RecordedQuery[] = [];

  /** Pre-programmed responses for specific SQL patterns. */
  private _responses: Map<string, QueryResult<RowData>> = new Map();

  /** Whether the client is "connected". */
  private _alive = true;

  /** Whether the client has been shut down. */
  private _shutdown = false;

  /** Auto-increment counters per table. */
  private _autoId: Map<string, number> = new Map();

  // -----------------------------------------------------------------------
  // Setup helpers
  // -----------------------------------------------------------------------

  /**
   * Seed an in-memory table with rows.
   *
   * @example
   * ```ts
   * mock.seed("users", [
   *   { id: 1, name: "Alice", email: "alice@example.com" },
   *   { id: 2, name: "Bob", email: "bob@example.com" },
   * ]);
   * ```
   */
  seed(table: string, rows: RowData[]): void {
    this.tables.set(table, [...rows]);
  }

  /**
   * Register a canned response for a SQL pattern.
   *
   * The pattern is matched as a substring of the SQL (case-insensitive).
   *
   * @example
   * ```ts
   * mock.onQuery("SELECT count", { rows: [{ count: 42 }], rowCount: 1 });
   * ```
   */
  onQuery(pattern: string, response: QueryResult<RowData>): void {
    this._responses.set(pattern.toLowerCase(), response);
  }

  /**
   * Simulate the client being unreachable (health check returns false).
   */
  setAlive(alive: boolean): void {
    this._alive = alive;
  }

  // -----------------------------------------------------------------------
  // Query log inspection
  // -----------------------------------------------------------------------

  /** Return all recorded queries. */
  get queryLog(): ReadonlyArray<RecordedQuery> {
    return this._queryLog;
  }

  /** Return only the SQL strings of recorded queries. */
  get queries(): string[] {
    return this._queryLog.map((q) => q.sql);
  }

  /** Clear the query log. */
  clearLog(): void {
    this._queryLog = [];
  }

  /**
   * Assert that at least one recorded query matches a substring.
   * Throws if not found.
   */
  assertQueryContains(substring: string): void {
    const lower = substring.toLowerCase();
    const found = this._queryLog.some((q) =>
      q.sql.toLowerCase().includes(lower),
    );
    if (!found) {
      throw new Error(
        `Expected a query containing "${substring}" but none was found.\n` +
        `Recorded queries:\n${this._queryLog.map((q) => `  ${q.sql}`).join("\n")}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // DatabaseClient implementation
  // -----------------------------------------------------------------------

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    if (this._shutdown) {
      throw new Error("MockDatabaseClient has been shut down");
    }

    // Record.
    this._queryLog.push({ sql, params, timestamp: new Date() });

    // Check for canned response.
    const sqlLower = sql.toLowerCase();
    for (const [pattern, response] of this._responses) {
      if (sqlLower.includes(pattern)) {
        return response as unknown as QueryResult<T>;
      }
    }

    // Very basic SQL interpretation for the in-memory store.
    // This is intentionally simplistic — for testing, not a real engine.
    return this.interpret<T>(sql, params);
  }

  async withTransaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (this._shutdown) {
      throw new Error("MockDatabaseClient has been shut down");
    }

    const tx = new TransactionImpl(
      this,
      options?.isolationLevel ?? "READ COMMITTED",
      options?.readOnly ?? false,
    );
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

  async healthCheck(): Promise<boolean> {
    if (this._shutdown) return false;
    return this._alive;
  }

  async shutdown(): Promise<void> {
    this._shutdown = true;
  }

  // -----------------------------------------------------------------------
  // Simplified SQL interpreter
  // -----------------------------------------------------------------------

  private interpret<T>(sql: string, params: unknown[]): QueryResult<T> {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    // Transaction control statements — no-ops in the mock.
    if (
      upper.startsWith("BEGIN") ||
      upper.startsWith("COMMIT") ||
      upper.startsWith("ROLLBACK") ||
      upper.startsWith("SAVEPOINT") ||
      upper.startsWith("RELEASE SAVEPOINT") ||
      upper.startsWith("ROLLBACK TO SAVEPOINT")
    ) {
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    // CREATE TABLE — just ensure the table map entry exists.
    if (upper.startsWith("CREATE TABLE")) {
      const tableMatch = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i.exec(trimmed);
      if (tableMatch) {
        const tableName = tableMatch[1]!;
        if (!this.tables.has(tableName)) {
          this.tables.set(tableName, []);
        }
      }
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    // DROP TABLE
    if (upper.startsWith("DROP TABLE")) {
      const tableMatch = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i.exec(trimmed);
      if (tableMatch) {
        this.tables.delete(tableMatch[1]!);
      }
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    // INSERT INTO "table" (cols) VALUES (...)
    if (upper.startsWith("INSERT")) {
      return this.interpretInsert<T>(trimmed, params);
    }

    // SELECT ... FROM "table" ...
    if (upper.startsWith("SELECT")) {
      return this.interpretSelect<T>(trimmed, params);
    }

    // UPDATE "table" SET ...
    if (upper.startsWith("UPDATE")) {
      return this.interpretUpdate<T>(trimmed, params);
    }

    // DELETE FROM "table" ...
    if (upper.startsWith("DELETE")) {
      return this.interpretDelete<T>(trimmed, params);
    }

    // Fallback: return empty result.
    return { rows: [] as unknown as T[], rowCount: 0 };
  }

  // ---- INSERT -----------------------------------------------------------

  private interpretInsert<T>(sql: string, params: unknown[]): QueryResult<T> {
    const match = /INSERT\s+INTO\s+"?(\w+)"?\s*\(([^)]+)\)\s*VALUES\s+(.+?)(?:\s+RETURNING\s+(.+))?$/is.exec(sql);
    if (!match) {
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    const tableName = match[1]!;
    const columns = match[2]!.split(",").map((c) => c.trim().replace(/"/g, ""));
    const valuesBlock = match[3]!;
    const returningCols = match[4]
      ?.split(",")
      .map((c) => c.trim().replace(/"/g, ""));

    // Parse value groups: (v1, v2), (v3, v4)
    const groupRegex = /\(([^)]+)\)/g;
    let groupMatch: RegExpExecArray | null;
    const rows: RowData[] = [];

    while ((groupMatch = groupRegex.exec(valuesBlock)) !== null) {
      const placeholders = groupMatch[1]!.split(",").map((p) => p.trim());
      const row: RowData = {};
      for (let i = 0; i < columns.length; i++) {
        const ph = placeholders[i];
        if (ph && ph.startsWith("$")) {
          const idx = Number(ph.slice(1)) - 1;
          row[columns[i]!] = params[idx];
        } else {
          row[columns[i]!] = ph;
        }
      }

      // Auto-generate id if not provided.
      if (!("id" in row)) {
        const counter = (this._autoId.get(tableName) ?? 0) + 1;
        this._autoId.set(tableName, counter);
        row["id"] = counter;
      }

      rows.push(row);
    }

    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, []);
    }
    this.tables.get(tableName)!.push(...rows);

    // RETURNING
    if (returningCols) {
      const projected = rows.map((r) => {
        const out: RowData = {};
        for (const col of returningCols) {
          out[col] = r[col];
        }
        return out;
      });
      return { rows: projected as unknown as T[], rowCount: rows.length };
    }

    return { rows: [] as unknown as T[], rowCount: rows.length };
  }

  // ---- SELECT -----------------------------------------------------------

  private interpretSelect<T>(sql: string, params: unknown[]): QueryResult<T> {
    const match = /SELECT\s+(.+?)\s+FROM\s+"?(\w+)"?(?:\s+(.*))?$/is.exec(sql);
    if (!match) {
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    const tableName = match[2]!;
    const afterFrom = match[3] ?? "";

    const tableRows = this.tables.get(tableName) ?? [];
    let filtered = [...tableRows];

    // Very simple WHERE parsing: "column" = $N AND ...
    filtered = this.applyWhere(filtered, afterFrom, params);

    // ORDER BY
    filtered = this.applyOrderBy(filtered, afterFrom);

    // LIMIT
    const limitMatch = /LIMIT\s+\$(\d+)/i.exec(afterFrom);
    if (limitMatch) {
      const limitIdx = Number(limitMatch[1]) - 1;
      const limit = Number(params[limitIdx]);
      if (!Number.isNaN(limit)) {
        filtered = filtered.slice(0, limit);
      }
    }

    return { rows: filtered as unknown as T[], rowCount: filtered.length };
  }

  // ---- UPDATE -----------------------------------------------------------

  private interpretUpdate<T>(sql: string, params: unknown[]): QueryResult<T> {
    const match = /UPDATE\s+"?(\w+)"?\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/is.exec(sql);
    if (!match) {
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    const tableName = match[1]!;
    const setClause = match[2]!;
    const whereClause = match[3] ?? "";
    const returningCols = match[4]
      ?.split(",")
      .map((c) => c.trim().replace(/"/g, ""));

    const tableRows = this.tables.get(tableName) ?? [];
    const targets = whereClause
      ? this.applyWhere(tableRows, `WHERE ${whereClause}`, params)
      : tableRows;

    // Parse SET: "col" = $N, "col2" = $M
    const setParts = setClause.split(",").map((s) => s.trim());
    const updates: Record<string, unknown> = {};
    for (const part of setParts) {
      const m = /"?(\w+)"?\s*=\s*\$(\d+)/i.exec(part);
      if (m) {
        const col = m[1]!;
        const idx = Number(m[2]) - 1;
        updates[col] = params[idx];
      }
    }

    const targetSet = new Set(targets);
    let count = 0;
    for (const row of tableRows) {
      if (targetSet.has(row)) {
        Object.assign(row, updates);
        count++;
      }
    }

    if (returningCols) {
      const projected = targets.map((r) => {
        const out: RowData = {};
        for (const col of returningCols) {
          out[col] = r[col];
        }
        return out;
      });
      return { rows: projected as unknown as T[], rowCount: count };
    }

    return { rows: [] as unknown as T[], rowCount: count };
  }

  // ---- DELETE -----------------------------------------------------------

  private interpretDelete<T>(sql: string, params: unknown[]): QueryResult<T> {
    const match = /DELETE\s+FROM\s+"?(\w+)"?(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/is.exec(sql);
    if (!match) {
      return { rows: [] as unknown as T[], rowCount: 0 };
    }

    const tableName = match[1]!;
    const whereClause = match[2] ?? "";
    const returningCols = match[3]
      ?.split(",")
      .map((c) => c.trim().replace(/"/g, ""));

    const tableRows = this.tables.get(tableName) ?? [];

    let toDelete: RowData[];
    if (whereClause) {
      toDelete = this.applyWhere(tableRows, `WHERE ${whereClause}`, params);
    } else {
      toDelete = [...tableRows];
    }

    const deleteSet = new Set(toDelete);
    const remaining = tableRows.filter((r) => !deleteSet.has(r));
    this.tables.set(tableName, remaining);

    if (returningCols) {
      const projected = toDelete.map((r) => {
        const out: RowData = {};
        for (const col of returningCols) {
          out[col] = r[col];
        }
        return out;
      });
      return { rows: projected as unknown as T[], rowCount: toDelete.length };
    }

    return { rows: [] as unknown as T[], rowCount: toDelete.length };
  }

  // -----------------------------------------------------------------------
  // Shared WHERE / ORDER BY helpers
  // -----------------------------------------------------------------------

  private applyWhere(
    rows: RowData[],
    afterFrom: string,
    params: unknown[],
  ): RowData[] {
    const whereMatch = /WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+GROUP\s+BY|\s+RETURNING|$)/is.exec(afterFrom);
    if (!whereMatch) return rows;

    const conditions = whereMatch[1]!;
    // Split on AND.
    const parts = conditions.split(/\s+AND\s+/i);

    let result = rows;
    for (const part of parts) {
      // "column" = $N
      const eqMatch = /"?(\w+)"?\s*=\s*\$(\d+)/i.exec(part);
      if (eqMatch) {
        const col = eqMatch[1]!;
        const idx = Number(eqMatch[2]) - 1;
        const val = params[idx];
        result = result.filter((r) => r[col] === val);
        continue;
      }

      // "column" IS NULL
      const nullMatch = /"?(\w+)"?\s+IS\s+NULL/i.exec(part);
      if (nullMatch) {
        const col = nullMatch[1]!;
        result = result.filter((r) => r[col] === null || r[col] === undefined);
        continue;
      }

      // "column" IS NOT NULL
      const notNullMatch = /"?(\w+)"?\s+IS\s+NOT\s+NULL/i.exec(part);
      if (notNullMatch) {
        const col = notNullMatch[1]!;
        result = result.filter(
          (r) => r[col] !== null && r[col] !== undefined,
        );
      }
    }

    return result;
  }

  private applyOrderBy(rows: RowData[], afterFrom: string): RowData[] {
    const orderMatch = /ORDER\s+BY\s+"?(\w+)"?\s+(ASC|DESC)/i.exec(afterFrom);
    if (!orderMatch) return rows;

    const col = orderMatch[1]!;
    const dir = orderMatch[2]!.toUpperCase();

    return [...rows].sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = va < vb ? -1 : 1;
      return dir === "DESC" ? -cmp : cmp;
    });
  }
}
