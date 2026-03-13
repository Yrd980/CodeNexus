# CI/CD Pipeline Builder

## 解决什么问题

Every startup spends days setting up CI/CD from scratch. Copy-pasting from Stack Overflow leads to insecure, slow, unmaintainable pipelines. YAML typos cause silent failures that waste hours of debugging. And most teams don't understand the tradeoffs between deployment strategies like rolling, blue-green, and canary — knowledge that typically requires a senior engineer to codify.

This module gives you type-safe GitHub Actions workflow generation, battle-tested deployment strategy patterns, and automated release management — all as importable TypeScript code with zero runtime dependencies.

## 为什么这样设计

**GitHub Actions because 90% of startups use GitHub.** We don't abstract over multiple CI providers — that's a complexity trap. GitHub Actions has the largest ecosystem, best marketplace, and tightest integration with the tools startups already use.

**Type-safe builder because YAML typos cause silent failures.** Instead of writing raw YAML and discovering errors 10 minutes into a CI run, you get compile-time validation. The builder encodes best practices: caching, concurrency groups, minimal permissions, matrix builds.

**Template-based because most startups need the same 4 workflows.** CI (lint, test, build), CD to staging, CD to production with approval gates, and automated releases. We provide opinionated defaults that you can override.

**Deployment strategies as code because this is senior engineer knowledge that should be codified.** Rolling, blue-green, and canary patterns are implemented as dependency-injected functions — you plug in your platform-specific operations (Fly.io, Vercel, K8s) and get the orchestration logic for free.

**Zero runtime dependencies.** The YAML serializer is minimal. The conventional commit parser is pure regex. No `js-yaml`, no `semver` package — just TypeScript.

### Tradeoffs

- We generate GitHub Actions workflows only, not GitLab CI, CircleCI, etc. If you use another CI, this module's deployment and release logic still works — only the pipeline builder is GitHub-specific.
- The YAML serializer is intentionally minimal. For complex workflows, consider piping the Workflow object through `js-yaml` for full spec compliance.
- Deployment strategies model the *logic* but not the platform-specific API calls. You must implement the `DeploymentDeps` interface for your infrastructure.

## 快速使用

### Install

```bash
cd foundation/ci-cd
npm install
npm run build
```

### Generate a CI Workflow

```typescript
import { createCIWorkflow, serializeWorkflow } from "@codenexus/ci-cd";

// Sensible defaults: lint, test, build on push/PR to main
const workflow = createCIWorkflow({
  packageManager: "pnpm",
  nodeVersions: ["18", "20"],
  coverage: true,
});

// Serialize to YAML for .github/workflows/ci.yml
console.log(serializeWorkflow(workflow));
```

### Custom Pipeline

```typescript
import { buildPipeline } from "@codenexus/ci-cd";

const workflow = buildPipeline({
  name: "CI/CD",
  stages: ["lint", "test", "build", "deploy"],
  triggers: {
    push: { branches: ["main"] },
    pull_request: { branches: ["main"] },
  },
  packageManager: "pnpm",
  nodeVersions: ["20"],
  cache: true,
  coverage: true,
  environment: {
    name: "staging",
    url: "https://staging.myapp.com",
    secrets: ["FLY_API_TOKEN"],
  },
  concurrencyGroup: "ci-${{ github.ref }}",
});
```

### Deployment Strategies

```typescript
import { deploy } from "@codenexus/ci-cd";
import type { DeploymentDeps, DeploymentConfig } from "@codenexus/ci-cd";

const config: DeploymentConfig = {
  strategy: "canary",
  environment: { name: "production", url: "https://myapp.com" },
  healthCheck: {
    endpoint: "https://myapp.com/health",
    retries: 3,
    intervalMs: 5000,
  },
  canarySteps: [10, 25, 50, 100],
};

// Implement these for your platform (Fly.io, Vercel, K8s, etc.)
const deps: DeploymentDeps = {
  runCommand: async (cmd) => { /* ... */ return { success: true, output: "" }; },
  checkHealth: async (url, timeout) => { /* ... */ return 200; },
  deployCanary: async () => { /* ... */ return true; },
  deployBatch: async () => true,
  deployGreen: async () => true,
  switchTraffic: async (percent) => { /* ... */ return true; },
  rollback: async () => { /* ... */ },
};

const result = await deploy(config, deps);
console.log(result.success ? "Deployed!" : "Failed, rolled back.");
```

### Release Automation

```typescript
import { prepareRelease } from "@codenexus/ci-cd";

const result = prepareRelease(
  { currentVersion: "1.2.3" },
  [
    "feat(auth): add OAuth2 support",
    "fix(api): handle timeout errors",
    "chore: update deps",
  ],
);

if (result) {
  console.log(result.newVersion);  // "1.3.0"
  console.log(result.tag);         // "v1.3.0"
  console.log(result.changelog);   // Formatted markdown
}
```

## 配置项

### PipelineConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | `string` | (required) | Workflow name |
| `stages` | `PipelineStage[]` | (required) | Pipeline stages: lint, test, build, deploy, release |
| `triggers` | `TriggerConfig` | (required) | GitHub Actions trigger events |
| `packageManager` | `PackageManager` | `"npm"` | npm, pnpm, yarn, pip, or poetry |
| `nodeVersions` | `string[]` | `["20"]` | Node versions for matrix builds |
| `os` | `string[]` | `["ubuntu-latest"]` | OS matrix |
| `cache` | `boolean` | `true` | Enable dependency caching |
| `coverage` | `boolean` | `false` | Upload coverage artifact |
| `lintCommand` | `string` | `"npm run lint"` | Custom lint command |
| `testCommand` | `string` | `"npm run test"` | Custom test command |
| `buildCommand` | `string` | `"npm run build"` | Custom build command |
| `environment` | `EnvironmentConfig` | - | Deployment target |
| `concurrencyGroup` | `string` | - | Prevent duplicate runs |

### DeploymentConfig

| 参数 | 类型 | 说明 |
|------|------|------|
| `strategy` | `"rolling" \| "blue-green" \| "canary"` | Deployment strategy |
| `healthCheck` | `HealthCheckConfig` | Health verification config |
| `canarySteps` | `number[]` | Traffic percentage steps for canary (e.g. `[10, 25, 50, 100]`) |
| `rollingBatchPercent` | `number` | Batch size for rolling deploys (default: 25) |
| `keepOldEnvironment` | `boolean` | Keep old env after blue-green switch |
| `preDeployHooks` | `DeployHook[]` | Commands to run before deploy |
| `postDeployHooks` | `DeployHook[]` | Commands to run after deploy |

### ReleaseConfig

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `currentVersion` | `string` | (required) | Current semver version |
| `changelog` | `boolean` | `true` | Generate changelog |
| `createTag` | `boolean` | `true` | Create git tag |
| `tagPrefix` | `string` | `"v"` | Tag prefix |
| `respectBreakingChanges` | `boolean` | `true` | Breaking changes trigger major bump |

## 来源 & 致谢

- [semantic-release](https://github.com/semantic-release/semantic-release) — Conventional commits + automated changelog removes human error from releases
- [GitHub Actions documentation](https://docs.github.com/en/actions) — Reusable workflows and matrix builds dramatically reduce pipeline maintenance
- Deployment strategy patterns synthesized from Kubernetes, Fly.io, and Vercel deployment documentation

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | Initial module creation | Startups need type-safe CI/CD that encodes best practices, not more YAML copy-paste |
