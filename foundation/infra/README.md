# foundation/infra

Infrastructure-as-code patterns: type-safe config loading, environment management, Docker generation, and service dependency management.

## 解决什么问题

Environment config is the #1 source of "works on my machine" bugs. Developers copy-paste `.env.example` files, forget to add new variables, and discover the mistake at 2am in production. Dockerfiles are copy-pasted from Stack Overflow without understanding security implications — running as root, no multi-stage builds, bloated images. Service dependencies are implicit — "just start postgres before the API" works until you have 5 services and a new team member.

This module provides:

- **Type-safe config loader** — declare your schema, get validated config with proper types or a clear error listing everything that's wrong
- **Built-in .env parser** — no dotenv dependency for a 20-line parser
- **Environment management** — detect, override, and feature-flag per environment
- **Dockerfile generator** — production-quality Dockerfiles with security best practices baked in
- **Service manifest** — declare dependencies, detect conflicts, compute start order

## 为什么这样设计

**Built-in .env parser** because dotenv is a trivial parser (read lines, split on `=`, trim quotes) wrapped in a package with 25 million weekly downloads. We inline it and cover 95% of real-world `.env` files.

**Schema-first config** because:
- Wrong config types cause runtime crashes hours after deploy
- Missing env vars are discovered one-at-a-time without schema validation
- Config should be immutable after load — accidental mutation is a bug

**Docker generator** because most Dockerfiles have security issues:
- Running as root (the default) means a container escape = full host access
- No multi-stage build means build tools (compilers, dev deps) ship to production
- No `dumb-init` for Node.js means `SIGTERM` is swallowed and containers take 10s to stop
- Bloated base images increase attack surface and pull times

**Topological sort for service start order** because manual ordering breaks with 3+ services. Circular dependency detection prevents infinite loops.

## 快速使用

### Config Loading

```typescript
import { loadConfig } from "@codenexus/infra";

const config = loadConfig({
  port: { env: "PORT", type: "number", default: 3000 },
  dbUrl: { env: "DATABASE_URL", type: "string", required: true, description: "PostgreSQL connection string" },
  debug: { env: "DEBUG", type: "boolean", default: false },
  redis: {
    host: { env: "REDIS_HOST", type: "string", default: "localhost" },
    port: { env: "REDIS_PORT", type: "number", default: 6379 },
  },
}, { envFile: ".env" });

// config is frozen — typed, validated, immutable
console.log(config.port);        // number
console.log(config.redis.host);  // string
```

### Environment Management

```typescript
import { getEnvironment, isDev, isProd, resolveFeatureFlags, applyEnvOverrides } from "@codenexus/infra";

// Detection
const env = getEnvironment(); // "development" | "staging" | "production" | "test"

// Helpers
if (isDev()) console.log("Debug mode");
if (isProd()) console.log("Production mode");

// Per-environment overrides
const settings = applyEnvOverrides(
  { logLevel: "info", debug: false },
  {
    development: { logLevel: "debug", debug: true },
    production: { logLevel: "warn" },
  },
);

// Feature flags
const flags = resolveFeatureFlags({
  newCheckout: { development: true, staging: true, production: false },
  betaApi: { development: true, production: false },
});
```

### Dockerfile Generation

```typescript
import { generateDockerfile, generateCompose } from "@codenexus/infra";

// Node.js Dockerfile (multi-stage, non-root, dumb-init)
const dockerfile = generateDockerfile({
  language: "node",
  nodeVersion: "22",
  port: 3000,
  entrypoint: "dist/server.js",
});

// Python Dockerfile
const pyDockerfile = generateDockerfile({
  language: "python",
  pythonVersion: "3.12",
  port: 8000,
  entrypoint: "app/main.py",
});

// Docker Compose
const compose = generateCompose([
  {
    name: "db",
    image: "postgres:16",
    ports: [{ host: 5432, container: 5432 }],
    healthcheck: { command: "pg_isready", interval: "10s", retries: 3 },
    environment: { POSTGRES_DB: "myapp" },
  },
  {
    name: "api",
    image: "myapp:latest",
    ports: [{ host: 3000, container: 3000 }],
    dependencies: ["db"],
  },
]);
```

### Service Manifest

```typescript
import { createManifest, getStartOrder, getTransitiveDependencies } from "@codenexus/infra";

const manifest = createManifest("myapp", [
  { name: "db", image: "postgres:16", ports: [{ host: 5432, container: 5432 }] },
  { name: "cache", image: "redis:7", ports: [{ host: 6379, container: 6379 }] },
  { name: "api", image: "myapp:latest", dependencies: ["db", "cache"] },
  { name: "worker", image: "myapp-worker:latest", dependencies: ["db", "cache"] },
  { name: "web", image: "myapp-web:latest", dependencies: ["api"] },
]);

// Topological sort — correct start order
const order = getStartOrder(manifest);
// ["cache", "db", "api", "worker", "web"]

// What does "web" need?
const deps = getTransitiveDependencies(manifest, "web");
// Set { "api", "db", "cache" }
```

## 配置项

### Config Schema Fields

| Property | Type | Description |
|----------|------|-------------|
| `env` | `string` | Environment variable name |
| `type` | `"string" \| "number" \| "boolean"` | Expected type (auto-coerced) |
| `required` | `boolean` | Whether field must be present (default: `true`) |
| `default` | `string \| number \| boolean` | Default value if missing |
| `description` | `string` | Shown in error messages |

### Dockerfile Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `language` | `"node" \| "python"` | — | Target language |
| `nodeVersion` | `string` | `"20"` | Node.js version |
| `pythonVersion` | `string` | `"3.12"` | Python version |
| `port` | `number` | `3000` / `8000` | Exposed port |
| `entrypoint` | `string` | `"dist/index.js"` / `"app/main.py"` | Entry point |
| `multiStage` | `boolean` | `true` | Multi-stage build |
| `systemPackages` | `string[]` | `[]` | Additional apt packages |

## 来源 & 致谢

- [12-Factor App](https://12factor.net/) — config in env vars, not files
- [Docker Best Practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/) — multi-stage, minimal images
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md) — dumb-init, non-root user
- Internal synthesis — combined patterns observed across dozens of startup codebases

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 12-Factor App、Docker 最佳实践和多个 Startup 项目中提炼。内置 .env 解析器替代 dotenv 依赖。|
