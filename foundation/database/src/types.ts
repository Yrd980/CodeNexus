/**
 * @module foundation/database/types
 *
 * Core type definitions for the database module.
 * These types form the contract that all database clients must satisfy.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** SSL configuration options for the database connection. */
export interface SslConfig {
  /** Reject connections to servers with unauthorized certificates. */
  rejectUnauthorized: boolean;
  /** Path to CA certificate file. */
  ca?: string;
  /** Path to client certificate file. */
  cert?: string;
  /** Path to client private key file. */
  key?: string;
}

/** Full configuration for a database connection. */
export interface DatabaseConfig {
  /** PostgreSQL-style connection string (takes precedence over individual fields). */
  connectionString?: string;
  /** Database host. */
  host?: string;
  /** Database port. */
  port?: number;
  /** Database name. */
  database?: string;
  /** Database user. */
  user?: string;
  /** Database password. */
  password?: string;
  /** Maximum connections in the pool. @default 10 */
  poolSize?: number;
  /** Milliseconds to wait for a connection from the pool. @default 30_000 */
  connectionTimeoutMs?: number;
  /** Milliseconds a connection can sit idle before being closed. @default 10_000 */
  idleTimeoutMs?: number;
  /** SSL configuration. `true` enables default SSL, `false` disables. */
  ssl?: boolean | SslConfig;
  /** Application name sent to the server (useful for monitoring). */
  applicationName?: string;
}

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

/** The result of executing a database query. */
export interface QueryResult<T = Record<string, unknown>> {
  /** Rows returned by the query (empty array for non-SELECT statements). */
  rows: T[];
  /** Number of rows affected by INSERT/UPDATE/DELETE. */
  rowCount: number;
  /** Column metadata, if available. */
  fields?: FieldInfo[];
}

/** Metadata for a single column in a query result. */
export interface FieldInfo {
  name: string;
  dataTypeId?: number;
}

/** A parameterized query — the only safe way to execute SQL. */
export interface ParameterizedQuery {
  /** SQL text with $1, $2, … placeholders. */
  text: string;
  /** Values bound to the placeholders. */
  values: unknown[];
}

// ---------------------------------------------------------------------------
// Transaction types
// ---------------------------------------------------------------------------

/** Supported transaction isolation levels (PostgreSQL). */
export type IsolationLevel =
  | "READ UNCOMMITTED"
  | "READ COMMITTED"
  | "REPEATABLE READ"
  | "SERIALIZABLE";

/** Options when beginning a transaction. */
export interface TransactionOptions {
  /** Isolation level. @default "READ COMMITTED" */
  isolationLevel?: IsolationLevel;
  /** Whether the transaction is read-only. */
  readOnly?: boolean;
}

/**
 * A transaction handle.
 *
 * Use `query` to execute statements inside the transaction, `savepoint` for
 * nested checkpoints, `commit` / `rollback` for explicit control.  In most
 * cases prefer the callback-based `withTransaction` which handles
 * commit/rollback automatically.
 */
export interface Transaction {
  /** Execute a parameterized query inside this transaction. */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;

  /** Create a named savepoint (nested transaction). */
  savepoint(name: string): Promise<void>;

  /** Roll back to a previously created savepoint. */
  rollbackToSavepoint(name: string): Promise<void>;

  /** Release (remove) a savepoint. */
  releaseSavepoint(name: string): Promise<void>;

  /** Commit the transaction. */
  commit(): Promise<void>;

  /** Roll back the transaction. */
  rollback(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Migration types
// ---------------------------------------------------------------------------

/** Configuration for the migration runner. */
export interface MigrationConfig {
  /** Directory containing migration SQL files. */
  migrationsDir: string;
  /** Table name used to track applied migrations. @default "_migrations" */
  tableName?: string;
  /** When true, log what *would* happen without executing. @default false */
  dryRun?: boolean;
}

/** A record stored in the migrations tracking table. */
export interface MigrationRecord {
  /** Sequential id (matches file prefix). */
  id: number;
  /** Human-readable name derived from the filename. */
  name: string;
  /** Timestamp when the migration was applied. */
  appliedAt: Date;
}

/** Parsed migration file with up/down SQL. */
export interface MigrationFile {
  /** Numeric id from the file prefix. */
  id: number;
  /** Human-readable name from the filename (e.g. "create_users"). */
  name: string;
  /** Filename on disk. */
  filename: string;
  /** SQL for the "up" direction. */
  upSql: string;
  /** SQL for the "down" direction (may be empty). */
  downSql: string;
}

// ---------------------------------------------------------------------------
// Client interface — the core abstraction
// ---------------------------------------------------------------------------

/**
 * Abstract database client.
 *
 * This is the contract that any concrete driver adapter must implement.
 * The module ships a `MockDatabaseClient` for testing; real projects
 * would implement this around `pg`, `mysql2`, `better-sqlite3`, etc.
 */
export interface DatabaseClient {
  /** Execute a parameterized query. */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;

  /**
   * Run a callback inside a transaction.  The transaction is committed when
   * the callback resolves and rolled back if it throws.
   */
  withTransaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;

  /** Check that the database connection is alive. */
  healthCheck(): Promise<boolean>;

  /** Drain all connections and shut down. */
  shutdown(): Promise<void>;
}
