import { describe, it, expect, beforeEach } from "vitest";
import {
  MockDatabaseClient,
  ConnectionPool,
  resolveConfig,
  select,
  insert,
  update,
  del,
  raw,
  TransactionManager,
  MigrationRunner,
  parseMigrationFile,
} from "../src/index.js";
import type { MigrationRunnerDeps } from "../src/index.js";

// ===========================================================================
// Mock Client
// ===========================================================================

describe("MockDatabaseClient", () => {
  let mock: MockDatabaseClient;

  beforeEach(() => {
    mock = new MockDatabaseClient();
  });

  it("should start alive and pass health check", async () => {
    expect(await mock.healthCheck()).toBe(true);
  });

  it("should report unhealthy when setAlive(false)", async () => {
    mock.setAlive(false);
    expect(await mock.healthCheck()).toBe(false);
  });

  it("should record all queries", async () => {
    await mock.query("SELECT 1");
    await mock.query("SELECT 2", [42]);

    expect(mock.queries).toHaveLength(2);
    expect(mock.queries[0]).toBe("SELECT 1");
    expect(mock.queryLog[1]!.params).toEqual([42]);
  });

  it("should clear the query log", async () => {
    await mock.query("SELECT 1");
    mock.clearLog();
    expect(mock.queries).toHaveLength(0);
  });

  it("should assert query contains", async () => {
    await mock.query("SELECT * FROM users WHERE id = $1", [1]);
    expect(() => mock.assertQueryContains("FROM users")).not.toThrow();
    expect(() => mock.assertQueryContains("FROM orders")).toThrow();
  });

  it("should return canned responses via onQuery", async () => {
    mock.onQuery("select count", { rows: [{ count: 42 }], rowCount: 1 });
    const result = await mock.query("SELECT count(*) FROM users");
    expect(result.rows[0]).toEqual({ count: 42 });
  });

  it("should reject queries after shutdown", async () => {
    await mock.shutdown();
    await expect(mock.query("SELECT 1")).rejects.toThrow("shut down");
  });

  describe("in-memory CRUD", () => {
    beforeEach(() => {
      mock.seed("users", [
        { id: 1, name: "Alice", email: "alice@test.com" },
        { id: 2, name: "Bob", email: "bob@test.com" },
      ]);
    });

    it("should SELECT seeded rows", async () => {
      const result = await mock.query('SELECT * FROM "users"');
      expect(result.rows).toHaveLength(2);
      expect(result.rowCount).toBe(2);
    });

    it("should SELECT with WHERE", async () => {
      const result = await mock.query(
        'SELECT * FROM "users" WHERE "id" = $1',
        [1],
      );
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as Record<string, unknown>)["name"]).toBe("Alice");
    });

    it("should INSERT and retrieve", async () => {
      await mock.query(
        'INSERT INTO "users" ("id", "name", "email") VALUES ($1, $2, $3)',
        [3, "Charlie", "charlie@test.com"],
      );
      const result = await mock.query('SELECT * FROM "users"');
      expect(result.rows).toHaveLength(3);
    });

    it("should UPDATE rows", async () => {
      await mock.query(
        'UPDATE "users" SET "name" = $1 WHERE "id" = $2',
        ["Alicia", 1],
      );
      const result = await mock.query(
        'SELECT * FROM "users" WHERE "id" = $1',
        [1],
      );
      expect((result.rows[0] as Record<string, unknown>)["name"]).toBe("Alicia");
    });

    it("should DELETE rows", async () => {
      await mock.query('DELETE FROM "users" WHERE "id" = $1', [2]);
      const result = await mock.query('SELECT * FROM "users"');
      expect(result.rows).toHaveLength(1);
      expect((result.rows[0] as Record<string, unknown>)["name"]).toBe("Alice");
    });
  });
});

// ===========================================================================
// Connection Pool
// ===========================================================================

describe("ConnectionPool", () => {
  it("should connect using the mock client factory", async () => {
    const config = resolveConfig({ database: "test_db", poolSize: 5 });
    const pool = new ConnectionPool({
      config,
      clientFactory: () => new MockDatabaseClient(),
      logger: silentLogger(),
    });

    await pool.connect();
    expect(await pool.healthCheck()).toBe(true);
    await pool.shutdown();
  });

  it("should reject queries before connect()", async () => {
    const config = resolveConfig();
    const pool = new ConnectionPool({
      config,
      clientFactory: () => new MockDatabaseClient(),
      logger: silentLogger(),
    });

    await expect(pool.query("SELECT 1")).rejects.toThrow("not connected");
  });

  it("should reject queries after shutdown", async () => {
    const config = resolveConfig();
    const pool = new ConnectionPool({
      config,
      clientFactory: () => new MockDatabaseClient(),
      logger: silentLogger(),
    });

    await pool.connect();
    await pool.shutdown();
    await expect(pool.query("SELECT 1")).rejects.toThrow("shut down");
  });

  it("should return false for healthCheck after shutdown", async () => {
    const config = resolveConfig();
    const pool = new ConnectionPool({
      config,
      clientFactory: () => new MockDatabaseClient(),
      logger: silentLogger(),
    });

    await pool.connect();
    await pool.shutdown();
    expect(await pool.healthCheck()).toBe(false);
  });

  it("should retry on failed connect", async () => {
    let attempt = 0;
    const config = resolveConfig();
    const pool = new ConnectionPool({
      config,
      clientFactory: () => {
        attempt++;
        const client = new MockDatabaseClient();
        // Fail the first two attempts.
        if (attempt <= 2) {
          client.setAlive(false);
        }
        return client;
      },
      logger: silentLogger(),
      maxRetries: 5,
      retryBaseMs: 1, // near-instant for tests
    });

    await pool.connect();
    expect(attempt).toBe(3); // failed twice, succeeded on third
    await pool.shutdown();
  });
});

// ===========================================================================
// resolveConfig
// ===========================================================================

describe("resolveConfig", () => {
  it("should apply sensible defaults", () => {
    const cfg = resolveConfig();
    expect(cfg.host).toBe("localhost");
    expect(cfg.port).toBe(5432);
    expect(cfg.poolSize).toBe(10);
    expect(cfg.connectionTimeoutMs).toBe(30_000);
  });

  it("should allow overrides", () => {
    const cfg = resolveConfig({ host: "db.example.com", poolSize: 20 });
    expect(cfg.host).toBe("db.example.com");
    expect(cfg.poolSize).toBe(20);
  });
});

// ===========================================================================
// Query Builder
// ===========================================================================

describe("Query Builder", () => {
  describe("select()", () => {
    it("should build a simple SELECT *", () => {
      const q = select().from("users").build();
      expect(q.text).toBe('SELECT * FROM "users"');
      expect(q.values).toEqual([]);
    });

    it("should build SELECT with specific columns", () => {
      const q = select().columns("id", "name").from("users").build();
      expect(q.text).toBe('SELECT "id", "name" FROM "users"');
    });

    it("should build SELECT with WHERE", () => {
      const q = select()
        .from("users")
        .where("active", "=", true)
        .where("age", ">=", 18)
        .build();

      expect(q.text).toBe(
        'SELECT * FROM "users" WHERE "active" = $1 AND "age" >= $2',
      );
      expect(q.values).toEqual([true, 18]);
    });

    it("should build SELECT with IS NULL", () => {
      const q = select()
        .from("users")
        .where("deleted_at", "IS NULL")
        .build();

      expect(q.text).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NULL');
      expect(q.values).toEqual([]);
    });

    it("should build SELECT with IN", () => {
      const q = select()
        .from("users")
        .where("role", "IN", ["admin", "moderator"])
        .build();

      expect(q.text).toBe(
        'SELECT * FROM "users" WHERE "role" IN ($1, $2)',
      );
      expect(q.values).toEqual(["admin", "moderator"]);
    });

    it("should build SELECT with JOIN", () => {
      const q = select()
        .from("orders")
        .innerJoin("users", "users.id = orders.user_id")
        .columns("orders.id", "users.name")
        .build();

      expect(q.text).toContain('INNER JOIN "users" ON users.id = orders.user_id');
    });

    it("should build SELECT with ORDER BY, LIMIT, OFFSET", () => {
      const q = select()
        .from("users")
        .orderBy("created_at", "DESC")
        .limit(10)
        .offset(20)
        .build();

      expect(q.text).toBe(
        'SELECT * FROM "users" ORDER BY "created_at" DESC LIMIT $1 OFFSET $2',
      );
      expect(q.values).toEqual([10, 20]);
    });

    it("should throw if no table is set", () => {
      expect(() => select().build()).toThrow("requires a table");
    });
  });

  describe("insert()", () => {
    it("should build a simple INSERT", () => {
      const q = insert()
        .into("users")
        .values({ name: "Alice", email: "alice@test.com" })
        .build();

      expect(q.text).toBe(
        'INSERT INTO "users" ("name", "email") VALUES ($1, $2)',
      );
      expect(q.values).toEqual(["Alice", "alice@test.com"]);
    });

    it("should build INSERT with RETURNING", () => {
      const q = insert()
        .into("users")
        .values({ name: "Bob" })
        .returning("id", "name")
        .build();

      expect(q.text).toContain('RETURNING "id", "name"');
    });

    it("should build INSERT with multiple rows", () => {
      const q = insert()
        .into("users")
        .values({ name: "Alice" })
        .values({ name: "Bob" })
        .build();

      expect(q.text).toBe(
        'INSERT INTO "users" ("name") VALUES ($1), ($2)',
      );
      expect(q.values).toEqual(["Alice", "Bob"]);
    });

    it("should throw if no table is set", () => {
      expect(() => insert().values({ x: 1 }).build()).toThrow("requires a table");
    });

    it("should throw if no values are set", () => {
      expect(() => insert().into("t").build()).toThrow("requires at least one row");
    });
  });

  describe("update()", () => {
    it("should build an UPDATE with WHERE", () => {
      const q = update()
        .table("users")
        .set({ name: "Alicia" })
        .where("id", "=", 1)
        .build();

      expect(q.text).toBe(
        'UPDATE "users" SET "name" = $1 WHERE "id" = $2',
      );
      expect(q.values).toEqual(["Alicia", 1]);
    });

    it("should build UPDATE with RETURNING", () => {
      const q = update()
        .table("users")
        .set({ active: false })
        .where("id", "=", 5)
        .returning("id")
        .build();

      expect(q.text).toContain('RETURNING "id"');
    });

    it("should throw if no table is set", () => {
      expect(() => update().set({ x: 1 }).build()).toThrow("requires a table");
    });

    it("should throw if no set data", () => {
      expect(() => update().table("t").build()).toThrow("requires at least one column");
    });
  });

  describe("del()", () => {
    it("should build a DELETE with WHERE", () => {
      const q = del().from("users").where("id", "=", 1).build();

      expect(q.text).toBe('DELETE FROM "users" WHERE "id" = $1');
      expect(q.values).toEqual([1]);
    });

    it("should build a DELETE without WHERE (delete all)", () => {
      const q = del().from("users").build();
      expect(q.text).toBe('DELETE FROM "users"');
    });

    it("should throw if no table is set", () => {
      expect(() => del().build()).toThrow("requires a table");
    });
  });

  describe("raw()", () => {
    it("should pass through text and values", () => {
      const q = raw("SELECT * FROM users WHERE email = $1", ["test@test.com"]);
      expect(q.text).toBe("SELECT * FROM users WHERE email = $1");
      expect(q.values).toEqual(["test@test.com"]);
    });
  });

  describe("SQL injection prevention", () => {
    it("should never interpolate values into the SQL text", () => {
      const malicious = "'; DROP TABLE users; --";
      const q = select().from("users").where("name", "=", malicious).build();

      // The malicious string must only appear in values, never in text.
      expect(q.text).not.toContain(malicious);
      expect(q.values).toContain(malicious);
      expect(q.text).toContain("$1"); // placeholder, not interpolated value
    });

    it("should escape identifier names with double quotes", () => {
      const q = select().from("users").where('col"injection', "=", 1).build();
      // The double quote in the column name should be escaped.
      expect(q.text).toContain('"col""injection"');
    });
  });
});

// ===========================================================================
// Transaction Management
// ===========================================================================

describe("Transaction Management", () => {
  let mock: MockDatabaseClient;

  beforeEach(() => {
    mock = new MockDatabaseClient();
  });

  it("should commit on successful callback", async () => {
    const mgr = new TransactionManager(mock);

    const result = await mgr.run(async (tx) => {
      await tx.query("INSERT INTO t (v) VALUES ($1)", [1]);
      return "ok";
    });

    expect(result).toBe("ok");
    mock.assertQueryContains("BEGIN");
    mock.assertQueryContains("COMMIT");
  });

  it("should rollback on error", async () => {
    const mgr = new TransactionManager(mock);

    await expect(
      mgr.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    mock.assertQueryContains("BEGIN");
    mock.assertQueryContains("ROLLBACK");
  });

  it("should support savepoints (nested transactions)", async () => {
    const mgr = new TransactionManager(mock);

    await mgr.run(async (tx) => {
      await tx.query("INSERT INTO t (v) VALUES ($1)", [1]);

      await tx.savepoint("sp1");
      await tx.query("INSERT INTO t (v) VALUES ($1)", [2]);
      await tx.rollbackToSavepoint("sp1");

      await tx.query("INSERT INTO t (v) VALUES ($1)", [3]);
    });

    mock.assertQueryContains("SAVEPOINT sp1");
    mock.assertQueryContains("ROLLBACK TO SAVEPOINT sp1");
    mock.assertQueryContains("COMMIT");
  });

  it("should reject invalid savepoint names", async () => {
    const mgr = new TransactionManager(mock);

    await expect(
      mgr.run(async (tx) => {
        await tx.savepoint("invalid name!");
      }),
    ).rejects.toThrow("Invalid savepoint name");
  });

  it("should support custom isolation levels", async () => {
    const mgr = new TransactionManager(mock);

    await mgr.run(
      async (tx) => {
        await tx.query("SELECT 1");
      },
      { isolationLevel: "SERIALIZABLE" },
    );

    mock.assertQueryContains("ISOLATION LEVEL SERIALIZABLE");
  });

  it("should support read-only transactions", async () => {
    const mgr = new TransactionManager(mock);

    await mgr.run(
      async (tx) => {
        await tx.query("SELECT 1");
      },
      { readOnly: true },
    );

    mock.assertQueryContains("READ ONLY");
  });

  it("should reject queries after commit", async () => {
    const mgr = new TransactionManager(mock);

    await expect(
      mgr.run(async (tx) => {
        await tx.commit();
        await tx.query("SELECT 1");
      }),
    ).rejects.toThrow("already committed");
  });

  it("should use withTransaction on DatabaseClient", async () => {
    const result = await mock.withTransaction(async (tx) => {
      await tx.query("INSERT INTO t (v) VALUES ($1)", [1]);
      return 42;
    });

    expect(result).toBe(42);
    mock.assertQueryContains("BEGIN");
    mock.assertQueryContains("COMMIT");
  });

  it("should rollback via withTransaction on error", async () => {
    await expect(
      mock.withTransaction(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    mock.assertQueryContains("ROLLBACK");
  });
});

// ===========================================================================
// Migration Runner
// ===========================================================================

describe("MigrationRunner", () => {
  describe("parseMigrationFile", () => {
    it("should parse a file with UP and DOWN sections", () => {
      const content = `-- UP
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- DOWN
DROP TABLE users;`;

      const migration = parseMigrationFile("001_create_users.sql", content);
      expect(migration.id).toBe(1);
      expect(migration.name).toBe("create users");
      expect(migration.upSql).toBe("CREATE TABLE users (id SERIAL PRIMARY KEY);");
      expect(migration.downSql).toBe("DROP TABLE users;");
    });

    it("should treat entire file as UP when no DOWN marker", () => {
      const content = "CREATE INDEX idx_email ON users (email);";
      const migration = parseMigrationFile("002_add_index.sql", content);
      expect(migration.upSql).toBe(content);
      expect(migration.downSql).toBe("");
    });

    it("should reject invalid filename format", () => {
      expect(() => parseMigrationFile("bad.sql", "")).toThrow(
        "Invalid migration filename",
      );
    });
  });

  describe("MigrationRunner (full flow)", () => {
    let mock: MockDatabaseClient;
    let runner: MigrationRunner;

    const migrationFiles: Record<string, string> = {
      "001_create_users.sql": `-- UP
CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT NOT NULL);

-- DOWN
DROP TABLE users;`,
      "002_add_posts.sql": `-- UP
CREATE TABLE posts (id SERIAL PRIMARY KEY, user_id INTEGER, title TEXT);

-- DOWN
DROP TABLE posts;`,
    };

    beforeEach(() => {
      mock = new MockDatabaseClient();

      const deps: MigrationRunnerDeps = {
        client: mock,
        listFiles: async () => Object.keys(migrationFiles).sort(),
        readFile: async (_dir: string, filename: string) => {
          const content = migrationFiles[filename];
          if (!content) throw new Error(`File not found: ${filename}`);
          return content;
        },
        logger: silentLogger(),
      };

      runner = new MigrationRunner(deps, {
        migrationsDir: "/fake/migrations",
        tableName: "_migrations",
      });
    });

    it("should run all pending UP migrations", async () => {
      const applied = await runner.up();

      expect(applied).toHaveLength(2);
      expect(applied[0]!.name).toBe("create users");
      expect(applied[1]!.name).toBe("add posts");

      // Tracking records should be inserted.
      mock.assertQueryContains("INSERT INTO");
    });

    it("should skip already-applied migrations", async () => {
      // Run once.
      await runner.up();
      mock.clearLog();

      // Run again — nothing new to apply.
      const applied = await runner.up();
      expect(applied).toHaveLength(0);
    });

    it("should roll back the last migration", async () => {
      await runner.up();
      mock.clearLog();

      const rolledBack = await runner.down(1);
      expect(rolledBack).toHaveLength(1);
      expect(rolledBack[0]!.name).toBe("add posts");

      mock.assertQueryContains("DROP TABLE posts");
      mock.assertQueryContains("DELETE FROM");
    });

    it("should report status correctly", async () => {
      // Before any migration.
      const statusBefore = await runner.status();
      expect(statusBefore.applied).toHaveLength(0);
      expect(statusBefore.pending).toHaveLength(2);

      // After running all.
      await runner.up();
      const statusAfter = await runner.status();
      expect(statusAfter.applied).toHaveLength(2);
      expect(statusAfter.pending).toHaveLength(0);
    });

    it("should support dry-run mode", async () => {
      const dryDeps: MigrationRunnerDeps = {
        client: mock,
        listFiles: async () => Object.keys(migrationFiles).sort(),
        readFile: async (_dir: string, filename: string) => {
          const content = migrationFiles[filename];
          if (!content) throw new Error(`File not found: ${filename}`);
          return content;
        },
        logger: silentLogger(),
      };

      const dryRunner = new MigrationRunner(dryDeps, {
        migrationsDir: "/fake/migrations",
        dryRun: true,
      });

      const applied = await dryRunner.up();
      expect(applied).toHaveLength(2);

      // In dry-run, no CREATE TABLE or INSERT should have been run
      // (the only queries should be from ensureTable dry-run log and getApplied).
      // We verify no INSERT INTO _migrations was run.
      const insertQueries = mock.queries.filter((q) =>
        q.includes('INSERT INTO "_migrations"'),
      );
      expect(insertQueries).toHaveLength(0);
    });
  });
});

// ===========================================================================
// Integration: Query Builder + Mock Client
// ===========================================================================

describe("Integration: Query Builder + Mock Client", () => {
  it("should execute a built query against the mock", async () => {
    const mock = new MockDatabaseClient();
    mock.seed("users", [
      { id: 1, name: "Alice", active: true },
      { id: 2, name: "Bob", active: false },
      { id: 3, name: "Charlie", active: true },
    ]);

    const q = select()
      .from("users")
      .where("active", "=", true)
      .build();

    const result = await mock.query(q.text, q.values);
    expect(result.rows).toHaveLength(2);
  });

  it("should insert via builder and retrieve", async () => {
    const mock = new MockDatabaseClient();

    const ins = insert()
      .into("products")
      .values({ name: "Widget", price: 9.99 })
      .build();

    await mock.query(ins.text, ins.values);

    const sel = select().from("products").build();
    const result = await mock.query(sel.text, sel.values);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as Record<string, unknown>)["name"]).toBe("Widget");
  });
});

// ===========================================================================
// Helpers
// ===========================================================================

function silentLogger(): Pick<Console, "info" | "warn" | "error"> {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
