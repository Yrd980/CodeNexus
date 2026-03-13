# CLI Tool Starter

## 解决什么问题

Building a CLI tool from scratch means writing argument parsing, help text generation, colored output, configuration management, and interactive prompts. Most developers reach for Commander.js + Inquirer + Chalk — three dependencies (with 50+ transitive deps) for what should be straightforward functionality.

This starter gives you a production-ready CLI framework with **zero runtime dependencies**. Everything is built on Node.js built-ins: `readline` for prompts, ANSI escape codes for colors, `fs` for config persistence.

## 为什么这样设计

**Zero dependencies** — A CLI tool should be fast to install and fast to start. Every dependency adds install time, supply chain risk, and potential breakage. Node.js already has everything you need.

**Built-in arg parser** — Commander.js is excellent but overkill for most startup CLIs. Our parser covers positional args, named options (`--name value`, `--name=value`, `-n value`), boolean flags (`--verbose`, `--no-color`), subcommands, type coercion, and validation — all in ~250 lines.

**ANSI colors without Chalk** — Colored terminal output is 6 lines of code. We respect `NO_COLOR` (https://no-color.org/) and `FORCE_COLOR` environment variables.

**Readline prompts** — Inquirer brings 50+ transitive dependencies. Node's built-in `readline` handles text input, confirmation, and selection prompts perfectly.

**Config in ~/.config** — Following the XDG Base Directory Specification. Environment variables override file values using the `APP_NAME_KEY` convention.

**JSON and quiet modes** — Every CLI should support `--json` for scripting and `--quiet` for CI. These are built into the output layer.

## 快速使用

```bash
# Install and build
npm install
npm run build

# Run the CLI
node dist/cli.js --help
node dist/cli.js --version
node dist/cli.js init
```

### Use as a library

```typescript
import { createCLI } from "@codenexus/cli-tool";

const cli = createCLI({
  name: "myapp",
  version: "1.0.0",
  description: "My startup CLI",
});

cli.command({
  name: "deploy",
  description: "Deploy to production",
  positionals: [{ name: "env", description: "Target environment" }],
  options: [
    { name: "force", alias: "f", type: "boolean", description: "Skip confirmation" },
    { name: "region", alias: "r", type: "string", default: "us-east-1" },
  ],
  handler: async (args, ctx) => {
    const env = args.positionals["env"];
    const force = args.options["force"];
    // ... your logic
  },
});

cli.run();
```

### Argument parser standalone

```typescript
import { parse, type ParserConfig } from "@codenexus/cli-tool";

const config: ParserConfig = {
  name: "deploy",
  positionals: [{ name: "env" }],
  options: [
    { name: "replicas", alias: "r", type: "number", default: 3 },
    { name: "dry-run", type: "boolean" },
  ],
};

const result = parse(config, ["production", "--replicas", "5", "--dry-run"]);
// result.positionals.env === "production"
// result.options.replicas === 5
// result.options["dry-run"] === true
```

### Configuration management

```typescript
import { createConfig } from "@codenexus/cli-tool";

const config = createConfig({
  appName: "myapp",
  schema: {
    defaults: { theme: "dark", port: 3000, debug: false },
    validate: (c) =>
      typeof c["port"] === "number" && c["port"] > 65535
        ? "Port out of range"
        : undefined,
  },
});

// Read merged config (defaults < file < env vars)
const all = config.read();

// Set a value and persist
config.set("theme", "light");

// Env vars override: MYAPP_PORT=8080 overrides port
```

### Output helpers

```typescript
import {
  createOutputContext,
  success,
  error,
  warning,
  info,
  printTable,
  createSpinner,
} from "@codenexus/cli-tool";

const ctx = createOutputContext({ json: false, quiet: false });

success(ctx, "Deployment complete");
error(ctx, "Connection refused");
warning(ctx, "Using deprecated API");
info(ctx, "Building 3 packages...");

printTable(ctx, {
  headers: ["Service", "Status", "Uptime"],
  rows: [
    ["api", "running", "14d"],
    ["worker", "running", "7d"],
  ],
});

const spinner = createSpinner(ctx, "Deploying...");
// ... async work ...
spinner.succeed("Deployed in 4.2s");
```

## 配置项

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--help`, `-h` | boolean | false | Show help text |
| `--version`, `-V` | boolean | false | Show version |
| `--json` | boolean | false | Output as JSON (for scripting) |
| `--quiet`, `-q` | boolean | false | Suppress non-error output |
| `--no-color` | boolean | false | Disable ANSI colors |

Environment variables:
- `NO_COLOR` — Disable colors (https://no-color.org/)
- `FORCE_COLOR` — Force colors even when not a TTY
- `XDG_CONFIG_HOME` — Override config directory base (default: `~/.config`)
- `<APP_NAME>_<KEY>` — Override any config value (e.g., `MYAPP_PORT=8080`)

## 模块结构

```
starters/cli-tool/
├── src/
│   ├── cli.ts              # CLI framework — createCLI(), command dispatch
│   ├── parser.ts           # Argument parser — zero-dep, full-featured
│   ├── output.ts           # Colored output, tables, spinners, JSON/quiet modes
│   ├── config.ts           # Config management — file + env var + defaults
│   ├── prompts.ts          # Interactive prompts — text, confirm, select
│   ├── index.ts            # Public API re-exports
│   └── commands/
│       ├── help.ts         # Built-in help command
│       └── init.ts         # Example init command with prompts
├── tests/
│   ├── parser.test.ts      # Arg parsing tests
│   ├── output.test.ts      # Output formatting tests
│   ├── config.test.ts      # Config management tests
│   └── cli.test.ts         # CLI framework tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .meta.yml
└── README.md
```

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本 | 从 Commander.js, Inquirer, oclif 模式中提炼零依赖 CLI 框架 |
