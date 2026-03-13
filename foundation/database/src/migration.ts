/**
 * @module foundation/database/migration
 *
 * File-based migration runner.
 *
 * Convention:
 *   migrations/
 *     001_create_users.sql
 *     002_add_email_index.sql
 *
 * Each file contains an UP section and an optional DOWN section separated
 * by the marker `-- DOWN`:
 *
 * ```sql
 * -- UP
 * CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);
 *
 * -- DOWN
 * DROP TABLE users;
 * ```
 *
 * If no `-- DOWN` marker is present the entire file is treated as the UP
 * migration and the DOWN migration is empty.
 */

import type {
  DatabaseClient,
  MigrationConfig,
  MigrationFile,
  MigrationRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

/** Filename pattern: `<number>_<name>.sql` */
const MIGRATION_FILENAME_RE = /^(\d+)_(.+)\.sql$/;

/**
 * Parse a migration SQL file into up/down parts.
 *
 * Accepts the file content and filename; returns a `MigrationFile`.
 */
export function parseMigrationFile(
  filename: string,
  content: string,
): MigrationFile {
  const match = MIGRATION_FILENAME_RE.exec(filename);
  if (!match) {
    throw new Error(
      `Invalid migration filename "${filename}". Expected format: 001_create_users.sql`,
    );
  }

  const id = Number(match[1]);
  const name = match[2]!.replace(/_/g, " ");

  // Split on `-- DOWN` (case-insensitive, optional leading whitespace).
  const downMarker = /^--\s*DOWN\s*$/im;
  const downIdx = content.search(downMarker);

  let upSql: string;
  let downSql: string;

  if (downIdx === -1) {
    upSql = content.trim();
    downSql = "";
  } else {
    upSql = content.slice(0, downIdx).trim();
    // Skip the marker line itself.
    const afterMarker = content.slice(downIdx);
    const firstNewline = afterMarker.indexOf("\n");
    downSql =
      firstNewline === -1 ? "" : afterMarker.slice(firstNewline + 1).trim();
  }

  // Strip optional `-- UP` header from upSql.
  upSql = upSql.replace(/^--\s*UP\s*\n?/i, "").trim();

  return { id, name, filename, upSql, downSql };
}

// ---------------------------------------------------------------------------
// MigrationRunner
// ---------------------------------------------------------------------------

export interface MigrationRunnerDeps {
  /** Database client used to run migration SQL. */
  client: DatabaseClient;
  /**
   * Function that lists filenames in the migrations directory.
   * Abstracted so the runner doesn't depend on Node `fs` directly.
   */
  listFiles: (dir: string) => Promise<string[]>;
  /**
   * Function that reads file content.
   * Abstracted so the runner doesn't depend on Node `fs` directly.
   */
  readFile: (dir: string, filename: string) => Promise<string>;
  /** Optional logger. */
  logger?: Pick<Console, "info" | "warn">;
}

/**
 * Migration runner: reads SQL files from a directory, tracks which
 * migrations have been applied in a database table, and applies them
 * in order.
 */
export class MigrationRunner {
  private readonly client: DatabaseClient;
  private readonly listFiles: MigrationRunnerDeps["listFiles"];
  private readonly readFile: MigrationRunnerDeps["readFile"];
  private readonly logger: Pick<Console, "info" | "warn">;
  private readonly config: Required<MigrationConfig>;

  constructor(deps: MigrationRunnerDeps, config: MigrationConfig) {
    this.client = deps.client;
    this.listFiles = deps.listFiles;
    this.readFile = deps.readFile;
    this.logger = deps.logger ?? console;
    this.config = {
      migrationsDir: config.migrationsDir,
      tableName: config.tableName ?? "_migrations",
      dryRun: config.dryRun ?? false,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Ensure the migrations tracking table exists.
   */
  async ensureTable(): Promise<void> {
    const table = this.config.tableName;
    const sql = [
      `CREATE TABLE IF NOT EXISTS "${table}" (`,
      `  id INTEGER PRIMARY KEY,`,
      `  name TEXT NOT NULL,`,
      `  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`,
      `)`,
    ].join("\n");

    if (this.config.dryRun) {
      this.logger.info(`[migration/dry-run] Would create table "${table}"`);
      return;
    }
    await this.client.query(sql);
  }

  /**
   * List migrations that have already been applied (from the tracking table).
   */
  async getApplied(): Promise<MigrationRecord[]> {
    const table = this.config.tableName;
    const result = await this.client.query<{
      id: number;
      name: string;
      applied_at: string;
    }>(`SELECT id, name, applied_at FROM "${table}" ORDER BY id ASC`);

    return result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      appliedAt: new Date(r.applied_at),
    }));
  }

  /**
   * Load and parse all migration files from the configured directory.
   */
  async loadFiles(): Promise<MigrationFile[]> {
    const dir = this.config.migrationsDir;
    const filenames = await this.listFiles(dir);

    const sqlFiles = filenames
      .filter((f) => MIGRATION_FILENAME_RE.test(f))
      .sort(); // lexical sort works because IDs are zero-padded.

    const migrations: MigrationFile[] = [];
    for (const filename of sqlFiles) {
      const content = await this.readFile(dir, filename);
      migrations.push(parseMigrationFile(filename, content));
    }

    return migrations;
  }

  /**
   * Run all pending UP migrations.
   *
   * Returns the list of newly applied migrations.
   */
  async up(): Promise<MigrationFile[]> {
    await this.ensureTable();

    const applied = await this.getApplied();
    const appliedIds = new Set(applied.map((r) => r.id));
    const allFiles = await this.loadFiles();
    const pending = allFiles.filter((f) => !appliedIds.has(f.id));

    if (pending.length === 0) {
      this.logger.info("[migration] No pending migrations");
      return [];
    }

    for (const migration of pending) {
      if (this.config.dryRun) {
        this.logger.info(
          `[migration/dry-run] Would apply: ${migration.filename}`,
        );
        continue;
      }

      this.logger.info(`[migration] Applying: ${migration.filename}`);
      await this.client.query(migration.upSql);

      // Record in tracking table.
      await this.client.query(
        `INSERT INTO "${this.config.tableName}" (id, name) VALUES ($1, $2)`,
        [migration.id, migration.name],
      );
    }

    return pending;
  }

  /**
   * Roll back the last N applied migrations (default 1).
   *
   * Returns the list of rolled-back migrations.
   */
  async down(count = 1): Promise<MigrationFile[]> {
    await this.ensureTable();

    const applied = await this.getApplied();
    const allFiles = await this.loadFiles();
    const fileMap = new Map(allFiles.map((f) => [f.id, f]));

    // Roll back in reverse order.
    const toRollback = applied.slice(-count).reverse();
    const rolledBack: MigrationFile[] = [];

    for (const record of toRollback) {
      const file = fileMap.get(record.id);
      if (!file) {
        this.logger.warn(
          `[migration] File for migration #${record.id} not found, skipping rollback`,
        );
        continue;
      }

      if (!file.downSql) {
        throw new Error(
          `Migration "${file.filename}" has no DOWN section — cannot roll back`,
        );
      }

      if (this.config.dryRun) {
        this.logger.info(
          `[migration/dry-run] Would roll back: ${file.filename}`,
        );
        rolledBack.push(file);
        continue;
      }

      this.logger.info(`[migration] Rolling back: ${file.filename}`);
      await this.client.query(file.downSql);

      await this.client.query(
        `DELETE FROM "${this.config.tableName}" WHERE id = $1`,
        [record.id],
      );

      rolledBack.push(file);
    }

    return rolledBack;
  }

  /**
   * Get migration status: which are applied, which are pending.
   */
  async status(): Promise<{
    applied: MigrationRecord[];
    pending: MigrationFile[];
  }> {
    await this.ensureTable();

    const applied = await this.getApplied();
    const appliedIds = new Set(applied.map((r) => r.id));
    const allFiles = await this.loadFiles();
    const pending = allFiles.filter((f) => !appliedIds.has(f.id));

    return { applied, pending };
  }
}
