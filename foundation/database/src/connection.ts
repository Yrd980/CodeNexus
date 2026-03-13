/**
 * @module foundation/database/connection
 *
 * Connection pool management pattern.
 *
 * This is a **pattern module** — it demonstrates HOW to structure database
 * connection code (pooling, health checks, graceful shutdown, retry).  The
 * default export uses the `MockDatabaseClient` so everything is runnable
 * without a real database.  In production you would swap in a real driver
 * adapter that implements `DatabaseClient`.
 */

import type {
  DatabaseClient,
  DatabaseConfig,
  QueryResult,
  Transaction,
  TransactionOptions,
} from "./types.js";

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

const ENV_MAP: Record<string, keyof DatabaseConfig> = {
  DATABASE_URL: "connectionString",
  DB_HOST: "host",
  DB_PORT: "port",
  DB_NAME: "database",
  DB_USER: "user",
  DB_PASSWORD: "password",
  DB_POOL_SIZE: "poolSize",
  DB_CONNECTION_TIMEOUT_MS: "connectionTimeoutMs",
  DB_IDLE_TIMEOUT_MS: "idleTimeoutMs",
  DB_APP_NAME: "applicationName",
};

/**
 * Build a `DatabaseConfig` by merging explicit values with environment
 * variables.  Explicit values take precedence.
 */
export function resolveConfig(
  explicit: Partial<DatabaseConfig> = {},
): DatabaseConfig {
  const fromEnv: Partial<DatabaseConfig> = {};

  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    const val = typeof process !== "undefined" ? process.env[envKey] : undefined;
    if (val === undefined) continue;

    if (configKey === "port" || configKey === "poolSize" ||
        configKey === "connectionTimeoutMs" || configKey === "idleTimeoutMs") {
      const num = Number(val);
      if (!Number.isNaN(num)) {
        (fromEnv as Record<string, unknown>)[configKey] = num;
      }
    } else {
      (fromEnv as Record<string, unknown>)[configKey] = val;
    }
  }

  // SSL from env: DB_SSL=true | DB_SSL=false
  if (typeof process !== "undefined" && process.env["DB_SSL"] !== undefined) {
    fromEnv.ssl = process.env["DB_SSL"] === "true";
  }

  return {
    host: "localhost",
    port: 5432,
    database: "app",
    user: "postgres",
    password: "",
    poolSize: 10,
    connectionTimeoutMs: 30_000,
    idleTimeoutMs: 10_000,
    ssl: false,
    applicationName: "codenexus-app",
    ...fromEnv,
    ...explicit,
  };
}

// ---------------------------------------------------------------------------
// Connection pool wrapper
// ---------------------------------------------------------------------------

export interface ConnectionPoolOptions {
  /** Concrete client factory.  Called once per pool slot. */
  clientFactory: (config: DatabaseConfig) => DatabaseClient;
  /** Resolved database configuration. */
  config: DatabaseConfig;
  /** Logger — defaults to console. */
  logger?: Pick<Console, "info" | "warn" | "error">;
  /** Max retries when connecting at startup. @default 5 */
  maxRetries?: number;
  /** Base delay between retries in ms (exponential back-off). @default 1000 */
  retryBaseMs?: number;
}

/**
 * Connection pool that wraps a `DatabaseClient`.
 *
 * In a real app the `clientFactory` would return a `pg.Pool` adapter.
 * Here it can be the `MockDatabaseClient` or any other implementation.
 */
export class ConnectionPool implements DatabaseClient {
  private client: DatabaseClient | null = null;
  private readonly factory: (config: DatabaseConfig) => DatabaseClient;
  private readonly config: DatabaseConfig;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private isShutdown = false;

  constructor(options: ConnectionPoolOptions) {
    this.factory = options.clientFactory;
    this.config = options.config;
    this.logger = options.logger ?? console;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Establish the connection with retry logic.
   *
   * Uses exponential back-off: `retryBaseMs * 2^attempt`.
   */
  async connect(): Promise<void> {
    if (this.isShutdown) {
      throw new Error("ConnectionPool has been shut down");
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.client = this.factory(this.config);
        const ok = await this.client.healthCheck();
        if (!ok) throw new Error("Health check failed after connect");
        this.logger.info(
          `[database] Connected (pool_size=${this.config.poolSize})`,
        );
        return;
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          const delay = this.retryBaseMs * 2 ** attempt;
          this.logger.warn(
            `[database] Connection attempt ${attempt + 1} failed, retrying in ${delay}ms…`,
          );
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `[database] Failed to connect after ${this.maxRetries + 1} attempts: ${String(lastError)}`,
    );
  }

  /** Return the underlying client (throws if not connected). */
  private getClient(): DatabaseClient {
    if (this.isShutdown) {
      throw new Error("ConnectionPool has been shut down");
    }
    if (!this.client) {
      throw new Error("ConnectionPool not connected — call connect() first");
    }
    return this.client;
  }

  // -------------------------------------------------------------------------
  // DatabaseClient implementation
  // -------------------------------------------------------------------------

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.getClient().query<T>(sql, params);
  }

  async withTransaction<T>(
    fn: (tx: Transaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return this.getClient().withTransaction(fn, options);
  }

  async healthCheck(): Promise<boolean> {
    try {
      return await this.getClient().healthCheck();
    } catch {
      return false;
    }
  }

  /**
   * Gracefully shut down: drain connections and prevent new queries.
   */
  async shutdown(): Promise<void> {
    if (this.isShutdown) return;
    this.isShutdown = true;

    if (this.client) {
      this.logger.info("[database] Draining connections…");
      await this.client.shutdown();
      this.client = null;
      this.logger.info("[database] Shut down complete");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
