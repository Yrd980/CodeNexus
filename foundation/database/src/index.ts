/**
 * @module foundation/database
 *
 * Production-quality database patterns for Startup engineering teams.
 *
 * This module provides:
 * - **Connection pooling** with retry, health check, and graceful shutdown
 * - **Type-safe query builder** with parameterized queries (no SQL injection)
 * - **Transaction management** with automatic rollback and savepoints
 * - **Migration runner** for file-based, trackable schema changes
 * - **Mock client** for unit testing without a real database
 *
 * @example
 * ```ts
 * import {
 *   ConnectionPool,
 *   MockDatabaseClient,
 *   resolveConfig,
 *   select,
 *   insert,
 *   MigrationRunner,
 * } from "@codenexus/database";
 *
 * // 1. Create a connection pool (using mock for demo)
 * const config = resolveConfig({ database: "myapp", poolSize: 5 });
 * const pool = new ConnectionPool({
 *   config,
 *   clientFactory: () => new MockDatabaseClient(),
 * });
 * await pool.connect();
 *
 * // 2. Build and run a type-safe query
 * const q = select().from("users").where("active", "=", true).limit(10).build();
 * const result = await pool.query(q.text, q.values);
 *
 * // 3. Run inside a transaction
 * await pool.withTransaction(async (tx) => {
 *   const ins = insert().into("users").values({ name: "Alice" }).build();
 *   await tx.query(ins.text, ins.values);
 * });
 *
 * // 4. Graceful shutdown
 * await pool.shutdown();
 * ```
 */

// Types
export type {
  DatabaseConfig,
  SslConfig,
  QueryResult,
  FieldInfo,
  ParameterizedQuery,
  IsolationLevel,
  TransactionOptions,
  Transaction,
  MigrationConfig,
  MigrationRecord,
  MigrationFile,
  DatabaseClient,
} from "./types.js";

// Connection management
export { ConnectionPool, resolveConfig } from "./connection.js";
export type { ConnectionPoolOptions } from "./connection.js";

// Query builder
export {
  SelectBuilder,
  InsertBuilder,
  UpdateBuilder,
  DeleteBuilder,
  select,
  insert,
  update,
  del,
  raw,
} from "./query-builder.js";
export type {
  WhereOperator,
  WhereCondition,
  JoinType,
  JoinClause,
  OrderDirection,
  OrderByClause,
} from "./query-builder.js";

// Transaction management
export { TransactionImpl, TransactionManager } from "./transaction.js";

// Migration
export { MigrationRunner, parseMigrationFile } from "./migration.js";
export type { MigrationRunnerDeps } from "./migration.js";

// Mock client (for testing)
export { MockDatabaseClient } from "./mock-client.js";
export type { RecordedQuery, RowData } from "./mock-client.js";
