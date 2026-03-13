/**
 * Pipeline Builder — Type-safe GitHub Actions workflow generator
 *
 * Converts a high-level PipelineConfig into a valid GitHub Actions Workflow
 * object, which can then be serialized to YAML. The builder encodes best
 * practices: caching, concurrency, matrix builds, and minimal permissions.
 */

import type {
  CacheConfig,
  PackageManager,
  PipelineConfig,
  PipelineStage,
  Workflow,
  WorkflowJob,
  WorkflowStep,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Install command per package manager */
const INSTALL_COMMANDS: Record<PackageManager, string> = {
  npm: "npm ci",
  pnpm: "pnpm install --frozen-lockfile",
  yarn: "yarn install --frozen-lockfile",
  pip: "pip install -r requirements.txt",
  poetry: "poetry install --no-interaction",
};

/** Lock file per package manager (used as cache key input) */
const LOCK_FILES: Record<PackageManager, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  pip: "requirements.txt",
  poetry: "poetry.lock",
};

/** Cache path per package manager */
const CACHE_PATHS: Record<PackageManager, string> = {
  npm: "~/.npm",
  pnpm: "~/.pnpm-store",
  yarn: "~/.cache/yarn",
  pip: "~/.cache/pip",
  poetry: "~/.cache/pypoetry",
};

/** Setup action per package manager */
function setupStep(pm: PackageManager, nodeVersions?: string[]): WorkflowStep[] {
  if (pm === "pip" || pm === "poetry") {
    return [
      {
        name: "Set up Python",
        uses: "actions/setup-python@v5",
        with: { "python-version": "3.12" },
      },
    ];
  }

  const step: WorkflowStep = {
    name: "Set up Node.js",
    uses: "actions/setup-node@v4",
    with: {
      "node-version":
        nodeVersions && nodeVersions.length > 1
          ? "${{ matrix.node-version }}"
          : nodeVersions?.[0] ?? "20",
    },
  };

  const steps: WorkflowStep[] = [step];

  if (pm === "pnpm") {
    steps.unshift({
      name: "Install pnpm",
      uses: "pnpm/action-setup@v4",
      with: { version: "latest" },
    });
  }

  return steps;
}

/** Generate cache step */
function cacheStep(pm: PackageManager): WorkflowStep {
  const config: CacheConfig = {
    path: CACHE_PATHS[pm],
    key: `\${{ runner.os }}-${pm}-\${{ hashFiles('${LOCK_FILES[pm]}') }}`,
    "restore-keys": `\${{ runner.os }}-${pm}-`,
  };

  return {
    name: `Cache ${pm} dependencies`,
    uses: "actions/cache@v4",
    with: {
      path: config.path,
      key: config.key,
      "restore-keys": config["restore-keys"] ?? "",
    },
  };
}

/** Checkout step (always first) */
function checkoutStep(): WorkflowStep {
  return {
    name: "Checkout code",
    uses: "actions/checkout@v4",
    with: { "fetch-depth": 0 },
  };
}

/** Install dependencies step */
function installStep(pm: PackageManager): WorkflowStep {
  return {
    name: "Install dependencies",
    run: INSTALL_COMMANDS[pm],
  };
}

// ---------------------------------------------------------------------------
// Stage Builders
// ---------------------------------------------------------------------------

function buildLintJob(config: PipelineConfig): WorkflowJob {
  const pm = config.packageManager ?? "npm";
  const steps: WorkflowStep[] = [
    checkoutStep(),
    ...setupStep(pm, config.nodeVersions),
  ];

  if (config.cache !== false) {
    steps.push(cacheStep(pm));
  }

  steps.push(installStep(pm));
  steps.push({
    name: "Lint",
    run: config.lintCommand ?? `${pm} run lint`,
  });

  return {
    name: "Lint",
    "runs-on": "ubuntu-latest",
    steps,
  };
}

function buildTestJob(config: PipelineConfig): WorkflowJob {
  const pm = config.packageManager ?? "npm";
  const needsMatrix =
    (config.nodeVersions && config.nodeVersions.length > 1) ||
    (config.os && config.os.length > 1);

  const steps: WorkflowStep[] = [
    checkoutStep(),
    ...setupStep(pm, config.nodeVersions),
  ];

  if (config.cache !== false) {
    steps.push(cacheStep(pm));
  }

  steps.push(installStep(pm));
  steps.push({
    name: "Run tests",
    run: config.testCommand ?? `${pm} run test`,
  });

  if (config.coverage) {
    steps.push({
      name: "Upload coverage",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "coverage-report",
        path: "coverage/",
      },
    });
  }

  const job: WorkflowJob = {
    name: "Test",
    "runs-on": config.os && config.os.length > 1
      ? "${{ matrix.os }}"
      : config.os?.[0] ?? "ubuntu-latest",
    steps,
  };

  if (needsMatrix) {
    const matrix: Record<string, (string | number)[]> = {};
    if (config.nodeVersions && config.nodeVersions.length > 1) {
      matrix["node-version"] = config.nodeVersions;
    }
    if (config.os && config.os.length > 1) {
      matrix.os = config.os;
    }
    job.strategy = { matrix, "fail-fast": false };
  }

  return job;
}

function buildBuildJob(config: PipelineConfig): WorkflowJob {
  const pm = config.packageManager ?? "npm";
  const steps: WorkflowStep[] = [
    checkoutStep(),
    ...setupStep(pm, config.nodeVersions),
  ];

  if (config.cache !== false) {
    steps.push(cacheStep(pm));
  }

  steps.push(installStep(pm));
  steps.push({
    name: "Build",
    run: config.buildCommand ?? `${pm} run build`,
  });

  steps.push({
    name: "Upload build artifacts",
    uses: "actions/upload-artifact@v4",
    with: {
      name: "build-output",
      path: "dist/",
    },
  });

  const needs: string[] = [];
  if (config.stages.includes("lint")) needs.push("lint");
  if (config.stages.includes("test")) needs.push("test");

  const job: WorkflowJob = {
    name: "Build",
    "runs-on": "ubuntu-latest",
    steps,
  };

  if (needs.length > 0) {
    job.needs = needs;
  }

  return job;
}

function buildDeployJob(config: PipelineConfig): WorkflowJob {
  const env = config.environment;
  const steps: WorkflowStep[] = [
    checkoutStep(),
    {
      name: "Download build artifacts",
      uses: "actions/download-artifact@v4",
      with: { name: "build-output", path: "dist/" },
    },
    {
      name: "Deploy",
      run: "echo \"Deploying to ${{ env.DEPLOY_ENV }}...\"",
      env: {
        DEPLOY_ENV: env?.name ?? "staging",
      },
    },
  ];

  if (env?.url) {
    steps.push({
      name: "Verify deployment",
      run: `curl -sf ${env.url}/health || exit 1`,
    });
  }

  const needs: string[] = [];
  if (config.stages.includes("build")) needs.push("build");
  else if (config.stages.includes("test")) needs.push("test");

  const job: WorkflowJob = {
    name: `Deploy to ${env?.name ?? "staging"}`,
    "runs-on": "ubuntu-latest",
    steps,
  };

  if (needs.length > 0) {
    job.needs = needs;
  }

  if (env) {
    job.environment = env.url ? { name: env.name, url: env.url } : env.name;
  }

  return job;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Map of pipeline stage to its job builder */
const STAGE_BUILDERS: Record<
  PipelineStage,
  ((config: PipelineConfig) => WorkflowJob) | undefined
> = {
  lint: buildLintJob,
  test: buildTestJob,
  build: buildBuildJob,
  deploy: buildDeployJob,
  release: undefined, // handled by release module
};

/**
 * Build a complete GitHub Actions workflow from a pipeline config.
 *
 * @example
 * ```ts
 * const workflow = buildPipeline({
 *   name: "CI",
 *   stages: ["lint", "test", "build"],
 *   triggers: { push: { branches: ["main"] } },
 *   packageManager: "pnpm",
 *   nodeVersions: ["18", "20"],
 *   cache: true,
 * });
 * ```
 */
export function buildPipeline(config: PipelineConfig): Workflow {
  const jobs: Record<string, WorkflowJob> = {};

  for (const stage of config.stages) {
    const builder = STAGE_BUILDERS[stage];
    if (builder) {
      jobs[stage] = builder(config);
    }
  }

  const workflow: Workflow = {
    name: config.name,
    on: config.triggers,
    jobs,
  };

  if (config.env) {
    workflow.env = config.env;
  }

  if (config.concurrencyGroup) {
    workflow.concurrency = {
      group: config.concurrencyGroup,
      "cancel-in-progress": true,
    };
  }

  return workflow;
}

/**
 * Serialize a Workflow object to a YAML-like string.
 *
 * This is a lightweight serializer that produces human-readable output
 * suitable for `.github/workflows/*.yml` files. For production use,
 * pipe the Workflow object through a full YAML library (e.g. js-yaml).
 *
 * The output is a JSON representation that can be converted with any
 * YAML serializer. We intentionally keep this dependency-free.
 */
export function serializeWorkflow(workflow: Workflow): string {
  return yamlStringify(workflow, 0);
}

/** Minimal YAML serializer — handles the subset used by GitHub Actions */
function yamlStringify(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    // Quote strings that could be misinterpreted
    if (
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null" ||
      value.includes(": ") ||
      value.includes("#") ||
      value.includes("\n") ||
      value.startsWith("${{") ||
      value.startsWith("{") ||
      value.startsWith("[") ||
      /^\d+$/.test(value)
    ) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    // Simple scalar arrays on one line
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return `[${value.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(", ")}]`;
    }

    // Complex arrays as block sequences
    const items = value.map((item) => {
      const serialized = yamlStringify(item, indent + 1);
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // Object items: first key on same line as dash
        const lines = serialized.split("\n");
        const firstLine = (lines[0] ?? "").trimStart();
        const rest = lines.slice(1).map((l) => `  ${l}`).join("\n");
        return `${pad}- ${firstLine}${rest ? `\n${rest}` : ""}`;
      }
      return `${pad}- ${serialized}`;
    });

    return items.join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";

    const lines = entries.map(([key, val]) => {
      const serializedVal = yamlStringify(val, indent + 1);

      // If the value is a multi-line block, put it on the next line
      if (
        typeof val === "object" &&
        val !== null &&
        !Array.isArray(val) &&
        Object.keys(val as Record<string, unknown>).length > 0
      ) {
        return `${pad}${key}:\n${serializedVal}`;
      }

      if (
        Array.isArray(val) &&
        val.length > 0 &&
        val.some((v) => typeof v === "object" && v !== null)
      ) {
        return `${pad}${key}:\n${serializedVal}`;
      }

      return `${pad}${key}: ${serializedVal}`;
    });

    return lines.join("\n");
  }

  return String(value);
}
