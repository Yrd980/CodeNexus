# Database

## 解决什么问题

Database code is the #1 source of security vulnerabilities (SQL injection) and performance issues (connection leaks, N+1 queries) in web applications. Every startup eventually needs:

- **Connection pooling** — raw connections per request don't scale past a dozen users.
- **Parameterized queries** — SQL injection is still the #1 web vulnerability (OWASP Top 10).
- **Migrations** — schema changes must be tracked, versioned, and reversible.
- **Testability** — database-dependent code needs to be testable without spinning up PostgreSQL.

This module provides all four as a cohesive, zero-dependency pattern that you can adapt to any driver (pg, mysql2, better-sqlite3, etc.).

## 为什么这样设计

**Pattern module, not a full ORM.** The goal is to teach the patterns (how to structure pooling, queries, transactions, migrations) rather than replace Drizzle or Prisma. When you outgrow this module, the interfaces translate directly to those tools.

**Parameterized queries by construction.** The query builder never concatenates user values into SQL strings. Every value goes through `$1, $2, …` placeholders. This makes SQL injection structurally impossible when using the builder API.

**Connection pool with retry and graceful shutdown.** Production databases go down. The pool retries on startup with exponential back-off. On shutdown it drains connections cleanly, preventing the "connection reset" errors that plague naive setups.

**Transaction manager with savepoints.** The callback-based `withTransaction` API auto-commits on success and auto-rolls-back on error — no more forgotten `COMMIT` or leaked transactions. Savepoints enable nested transaction patterns without full serialization overhead.

**File-based migrations with a tracking table.** Inspired by Prisma's approach: SQL files in a directory, a `_migrations` table tracks what's been applied. Simple, auditable, works with any CI/CD pipeline. Supports up/down directions and dry-run mode.

**Mock client for real testing.** The `MockDatabaseClient` implements the full `DatabaseClient` interface with an in-memory store. It records every query for assertions, supports seeding data, and can simulate connection failures. This means you can unit-test database logic without Docker or test databases.

### 权衡

| 决策 | 选择 | 放弃 |
|------|------|------|
| Pattern module vs real driver | Portable, zero deps, educational | Can't talk to a real database out of the box |
| Query builder vs ORM | Transparent SQL, small surface area | No schema inference, no relation mapping |
| File-based migrations vs code | Auditable, CI-friendly, simple | No programmatic migration generation |
| Mock client vs test containers | Fast, no infra needed | Less realistic than a real database |

## 快速使用

### 1. Connection Pool

```typescript
import { ConnectionPool, MockDatabaseClient, resolveConfig } from "@codenexus/database";

// Config from environment variables (DATABASE_URL, DB_HOST, etc.) or explicit
const config = resolveConfig({ database: "myapp", poolSize: 5 });

// Create a pool (swap MockDatabaseClient for your real driver adapter)
const pool = new ConnectionPool({
  config,
  clientFactory: () => new MockDatabaseClient(),
});

await pool.connect();
console.log("Healthy:", await pool.healthCheck()); // true

// ... use pool.query(), pool.withTransaction(), etc.

// On process exit:
await pool.shutdown();
```

### 2. Type-Safe Query Builder

```typescript
import { select, insert, update, del, raw } from "@codenexus/database";

// SELECT with WHERE, ORDER BY, LIMIT
const q1 = select()
  .from("users")
  .columns("id", "name", "email")
  .where("active", "=", true)
  .where("age", ">=", 18)
  .orderBy("created_at", "DESC")
  .limit(10)
  .build();
// q1.text  = 'SELECT "id", "name", "email" FROM "users" WHERE "active" = $1 AND "age" >= $2 ORDER BY "created_at" DESC LIMIT $3'
// q1.values = [true, 18, 10]

// INSERT with RETURNING
const q2 = insert()
  .into("users")
  .values({ name: "Alice", email: "alice@startup.com" })
  .returning("id")
  .build();

// UPDATE
const q3 = update()
  .table("users")
  .set({ name: "Alicia", updated_at: new Date() })
  .where("id", "=", 1)
  .build();

// DELETE
const q4 = del()
  .from("sessions")
  .where("expired_at", "<", new Date())
  .build();

// Raw escape hatch (still parameterized!)
const q5 = raw("SELECT * FROM users WHERE email = $1", ["test@test.com"]);

// Execute against any DatabaseClient
const result = await pool.query(q1.text, q1.values);
```

### 3. Transactions

```typescript
import { TransactionManager } from "@codenexus/database";

const txManager = new TransactionManager(pool);

// Auto-commit on success, auto-rollback on error
const userId = await txManager.run(async (tx) => {
  const { rows } = await tx.query(
    'INSERT INTO users (name) VALUES ($1) RETURNING id',
    ["Alice"]
  );
  await tx.query(
    'INSERT INTO audit_log (action, user_id) VALUES ($1, $2)',
    ["user_created", rows[0].id]
  );
  return rows[0].id;
});

// Nested transactions with savepoints
await txManager.run(async (tx) => {
  await tx.query("INSERT INTO orders (user_id) VALUES ($1)", [userId]);

  await tx.savepoint("items");
  try {
    await tx.query("INSERT INTO order_items (order_id, sku) VALUES ($1, $2)", [1, "WIDGET"]);
  } catch {
    await tx.rollbackToSavepoint("items");
    // Items failed but order is still intact
  }
});

// Custom isolation level
await txManager.run(
  async (tx) => { /* ... */ },
  { isolationLevel: "SERIALIZABLE", readOnly: false }
);
```

### 4. Migrations

```typescript
import { MigrationRunner } from "@codenexus/database";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const runner = new MigrationRunner(
  {
    client: pool,
    listFiles: (dir) => readdir(dir),
    readFile: (dir, file) => readFile(join(dir, file), "utf-8"),
  },
  { migrationsDir: "./migrations" }
);

// Apply all pending migrations
await runner.up();

// Roll back the last migration
await runner.down(1);

// Check status
const { applied, pending } = await runner.status();
console.log(`Applied: ${applied.length}, Pending: ${pending.length}`);
```

Migration file format (`migrations/001_create_users.sql`):

```sql
-- UP
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- DOWN
DROP TABLE users;
```

### 5. Testing with MockDatabaseClient

```typescript
import { MockDatabaseClient } from "@codenexus/database";
import { describe, it, expect } from "vitest";

describe("UserService", () => {
  it("should create a user", async () => {
    const mock = new MockDatabaseClient();
    const service = new UserService(mock); // your code takes DatabaseClient

    await service.createUser("Alice", "alice@test.com");

    // Assert the right queries were generated
    mock.assertQueryContains("INSERT INTO");
    expect(mock.queryLog).toHaveLength(1);
    expect(mock.queryLog[0].params).toEqual(["Alice", "alice@test.com"]);
  });

  it("should handle database failures", async () => {
    const mock = new MockDatabaseClient();
    mock.setAlive(false);

    const service = new UserService(mock);
    await expect(service.healthCheck()).resolves.toBe(false);
  });
});
```

## 配置项

### DatabaseConfig

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `connectionString` | `DATABASE_URL` | — | PostgreSQL 连接字符串（优先于其他字段） |
| `host` | `DB_HOST` | `"localhost"` | 数据库主机 |
| `port` | `DB_PORT` | `5432` | 数据库端口 |
| `database` | `DB_NAME` | `"app"` | 数据库名称 |
| `user` | `DB_USER` | `"postgres"` | 数据库用户 |
| `password` | `DB_PASSWORD` | `""` | 数据库密码 |
| `poolSize` | `DB_POOL_SIZE` | `10` | 连接池最大连接数 |
| `connectionTimeoutMs` | `DB_CONNECTION_TIMEOUT_MS` | `30000` | 从连接池获取连接的超时时间（ms） |
| `idleTimeoutMs` | `DB_IDLE_TIMEOUT_MS` | `10000` | 空闲连接自动关闭时间（ms） |
| `ssl` | `DB_SSL` | `false` | SSL 配置（`true`/`false` 或详细配置对象） |
| `applicationName` | `DB_APP_NAME` | `"codenexus-app"` | 发送给服务器的应用名称（用于监控） |

### ConnectionPoolOptions

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `clientFactory` | （必填） | 返回 `DatabaseClient` 实例的工厂函数 |
| `config` | （必填） | 数据库配置 |
| `logger` | `console` | 日志输出 |
| `maxRetries` | `5` | 启动连接最大重试次数 |
| `retryBaseMs` | `1000` | 重试基础延迟（指数退避） |

### MigrationConfig

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `migrationsDir` | （必填） | 迁移文件目录路径 |
| `tableName` | `"_migrations"` | 迁移记录追踪表名 |
| `dryRun` | `false` | 仅打印将要执行的操作，不实际执行 |

## 来源 & 致谢

- **[Drizzle ORM](https://github.com/drizzle-team/drizzle-orm)** — Type-safe SQL queries without code generation. Drizzle proved that you can have type safety and transparency at the same time.
- **[Prisma](https://github.com/prisma/prisma)** — File-based migration system with a tracking table. The most battle-tested migration pattern in the Node.js ecosystem.
- **[node-postgres (pg)](https://github.com/brianc/node-postgres)** — The reference for connection pooling patterns in Node.js.

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-13 | 初始版本 | 数据库代码是 startup 最高频的基础设施需求，SQL 注入仍是 #1 安全漏洞。选择 pattern module 路线而非完整 ORM，因为目标是教会团队正确的模式，而不是增加一个依赖。 |
