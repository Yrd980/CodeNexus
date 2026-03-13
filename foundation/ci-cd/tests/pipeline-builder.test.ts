import { describe, expect, it } from "vitest";
import { buildPipeline, serializeWorkflow } from "../src/pipeline-builder.js";
import type { PipelineConfig, Workflow } from "../src/types.js";

describe("buildPipeline", () => {
  it("generates a workflow with the correct name", () => {
    const config: PipelineConfig = {
      name: "My CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
    };
    const workflow = buildPipeline(config);
    expect(workflow.name).toBe("My CI");
  });

  it("includes the correct triggers", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["test"],
      triggers: {
        push: { branches: ["main", "develop"] },
        pull_request: { branches: ["main"] },
      },
    };
    const workflow = buildPipeline(config);
    expect(workflow.on.push?.branches).toEqual(["main", "develop"]);
    expect(workflow.on.pull_request?.branches).toEqual(["main"]);
  });

  it("generates a lint job with correct steps", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      packageManager: "npm",
    };
    const workflow = buildPipeline(config);
    expect(workflow.jobs["lint"]).toBeDefined();
    const steps = workflow.jobs["lint"].steps;
    const stepNames = steps.map((s) => s.name);
    expect(stepNames).toContain("Checkout code");
    expect(stepNames).toContain("Set up Node.js");
    expect(stepNames).toContain("Install dependencies");
    expect(stepNames).toContain("Lint");
  });

  it("uses custom lint command when provided", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      lintCommand: "npx biome check .",
    };
    const workflow = buildPipeline(config);
    const lintStep = workflow.jobs["lint"].steps.find((s) => s.name === "Lint");
    expect(lintStep?.run).toBe("npx biome check .");
  });

  it("generates a test job with matrix builds", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["test"],
      triggers: { push: { branches: ["main"] } },
      nodeVersions: ["18", "20", "22"],
      packageManager: "npm",
    };
    const workflow = buildPipeline(config);
    const testJob = workflow.jobs["test"];
    expect(testJob.strategy).toBeDefined();
    expect(testJob.strategy?.matrix["node-version"]).toEqual(["18", "20", "22"]);
    expect(testJob.strategy?.["fail-fast"]).toBe(false);
  });

  it("generates matrix with multiple OS", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["test"],
      triggers: { push: { branches: ["main"] } },
      os: ["ubuntu-latest", "macos-latest", "windows-latest"],
    };
    const workflow = buildPipeline(config);
    const testJob = workflow.jobs["test"];
    expect(testJob.strategy?.matrix.os).toEqual([
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
    ]);
    expect(testJob["runs-on"]).toBe("${{ matrix.os }}");
  });

  it("does not create matrix for single node version", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["test"],
      triggers: { push: { branches: ["main"] } },
      nodeVersions: ["20"],
    };
    const workflow = buildPipeline(config);
    expect(workflow.jobs["test"].strategy).toBeUndefined();
  });

  it("includes cache step by default", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      packageManager: "npm",
    };
    const workflow = buildPipeline(config);
    const cacheStep = workflow.jobs["lint"].steps.find((s) =>
      s.name.includes("Cache"),
    );
    expect(cacheStep).toBeDefined();
    expect(cacheStep?.uses).toBe("actions/cache@v4");
  });

  it("skips cache when cache=false", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      cache: false,
    };
    const workflow = buildPipeline(config);
    const cacheStep = workflow.jobs["lint"].steps.find((s) =>
      s.name.includes("Cache"),
    );
    expect(cacheStep).toBeUndefined();
  });

  it("generates build job with dependencies on lint and test", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint", "test", "build"],
      triggers: { push: { branches: ["main"] } },
    };
    const workflow = buildPipeline(config);
    const buildJob = workflow.jobs["build"];
    expect(buildJob.needs).toContain("lint");
    expect(buildJob.needs).toContain("test");
  });

  it("generates deploy job with environment", () => {
    const config: PipelineConfig = {
      name: "CD",
      stages: ["build", "deploy"],
      triggers: { push: { branches: ["main"] } },
      environment: {
        name: "staging",
        url: "https://staging.example.com",
      },
    };
    const workflow = buildPipeline(config);
    const deployJob = workflow.jobs["deploy"];
    expect(deployJob.environment).toEqual({
      name: "staging",
      url: "https://staging.example.com",
    });
  });

  it("deploy job depends on build", () => {
    const config: PipelineConfig = {
      name: "CD",
      stages: ["build", "deploy"],
      triggers: { push: { branches: ["main"] } },
    };
    const workflow = buildPipeline(config);
    expect(workflow.jobs["deploy"].needs).toContain("build");
  });

  it("uses pnpm install command and setup for pnpm", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      packageManager: "pnpm",
    };
    const workflow = buildPipeline(config);
    const steps = workflow.jobs["lint"].steps;
    const pnpmSetup = steps.find((s) => s.name === "Install pnpm");
    expect(pnpmSetup).toBeDefined();
    expect(pnpmSetup?.uses).toBe("pnpm/action-setup@v4");
    const installStep = steps.find((s) => s.name === "Install dependencies");
    expect(installStep?.run).toBe("pnpm install --frozen-lockfile");
  });

  it("uses pip for Python package manager", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      packageManager: "pip",
    };
    const workflow = buildPipeline(config);
    const steps = workflow.jobs["lint"].steps;
    const pythonSetup = steps.find((s) => s.name === "Set up Python");
    expect(pythonSetup).toBeDefined();
    expect(pythonSetup?.uses).toBe("actions/setup-python@v5");
    const installStep = steps.find((s) => s.name === "Install dependencies");
    expect(installStep?.run).toBe("pip install -r requirements.txt");
  });

  it("adds concurrency group when specified", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      concurrencyGroup: "ci-${{ github.ref }}",
    };
    const workflow = buildPipeline(config);
    expect(workflow.concurrency).toEqual({
      group: "ci-${{ github.ref }}",
      "cancel-in-progress": true,
    });
  });

  it("includes coverage upload step when coverage=true", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["test"],
      triggers: { push: { branches: ["main"] } },
      coverage: true,
    };
    const workflow = buildPipeline(config);
    const coverageStep = workflow.jobs["test"].steps.find((s) =>
      s.name === "Upload coverage",
    );
    expect(coverageStep).toBeDefined();
    expect(coverageStep?.uses).toBe("actions/upload-artifact@v4");
  });

  it("adds global env when specified", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint"],
      triggers: { push: { branches: ["main"] } },
      env: { CI: "true", NODE_ENV: "test" },
    };
    const workflow = buildPipeline(config);
    expect(workflow.env).toEqual({ CI: "true", NODE_ENV: "test" });
  });

  it("ignores unknown stages gracefully", () => {
    const config: PipelineConfig = {
      name: "CI",
      stages: ["lint", "release"],
      triggers: { push: { branches: ["main"] } },
    };
    const workflow = buildPipeline(config);
    // release stage has no builder, so only lint job is created
    expect(Object.keys(workflow.jobs)).toEqual(["lint"]);
  });
});

describe("serializeWorkflow", () => {
  it("produces valid YAML-like output with correct structure", () => {
    const workflow: Workflow = {
      name: "Test",
      on: { push: { branches: ["main"] } },
      jobs: {
        test: {
          name: "Test",
          "runs-on": "ubuntu-latest",
          steps: [
            { name: "Checkout", uses: "actions/checkout@v4" },
            { name: "Run tests", run: "npm test" },
          ],
        },
      },
    };

    const yaml = serializeWorkflow(workflow);
    expect(yaml).toContain("name: Test");
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain("actions/checkout@v4");
    expect(yaml).toContain("npm test");
  });

  it("handles boolean and number values correctly", () => {
    const workflow: Workflow = {
      name: "Test",
      on: { push: { branches: ["main"] } },
      jobs: {
        build: {
          name: "Build",
          "runs-on": "ubuntu-latest",
          steps: [
            {
              name: "Checkout",
              uses: "actions/checkout@v4",
              with: { "fetch-depth": 0 },
            },
          ],
        },
      },
    };

    const yaml = serializeWorkflow(workflow);
    expect(yaml).toContain("fetch-depth: 0");
  });
});
