import { describe, expect, it } from "vitest";
import { createCIWorkflow } from "../src/templates/ci.js";
import { createStagingCDWorkflow } from "../src/templates/cd-staging.js";
import { createProductionCDWorkflow } from "../src/templates/cd-production.js";
import { createReleaseWorkflow } from "../src/templates/release.js";

describe("createCIWorkflow", () => {
  it("returns a workflow with lint, test, and build jobs", () => {
    const workflow = createCIWorkflow();
    expect(workflow.name).toBe("CI");
    expect(Object.keys(workflow.jobs)).toContain("lint");
    expect(Object.keys(workflow.jobs)).toContain("test");
    expect(Object.keys(workflow.jobs)).toContain("build");
  });

  it("allows overriding package manager", () => {
    const workflow = createCIWorkflow({ packageManager: "pnpm" });
    const lintSteps = workflow.jobs["lint"].steps;
    const pnpmStep = lintSteps.find((s) => s.name === "Install pnpm");
    expect(pnpmStep).toBeDefined();
  });

  it("allows overriding node versions for matrix", () => {
    const workflow = createCIWorkflow({ nodeVersions: ["18", "20", "22"] });
    const testJob = workflow.jobs["test"];
    expect(testJob.strategy?.matrix["node-version"]).toEqual(["18", "20", "22"]);
  });
});

describe("createStagingCDWorkflow", () => {
  it("triggers on push to main", () => {
    const workflow = createStagingCDWorkflow();
    expect(workflow.on.push?.branches).toContain("main");
  });

  it("includes deploy job with staging environment", () => {
    const workflow = createStagingCDWorkflow();
    const deployJob = workflow.jobs["deploy"];
    expect(deployJob).toBeDefined();
  });

  it("allows custom environment URL", () => {
    const workflow = createStagingCDWorkflow({
      environment: {
        name: "staging",
        url: "https://staging.myapp.com",
      },
    });
    const deployJob = workflow.jobs["deploy"];
    expect(deployJob.environment).toEqual({
      name: "staging",
      url: "https://staging.myapp.com",
    });
  });
});

describe("createProductionCDWorkflow", () => {
  it("triggers on release published", () => {
    const workflow = createProductionCDWorkflow();
    expect(workflow.on.release?.types).toContain("published");
  });

  it("includes deploy job", () => {
    const workflow = createProductionCDWorkflow();
    expect(workflow.jobs["deploy"]).toBeDefined();
  });
});

describe("createReleaseWorkflow", () => {
  it("triggers on workflow_dispatch", () => {
    const workflow = createReleaseWorkflow();
    expect(workflow.on.workflow_dispatch).toBeDefined();
  });

  it("has write permissions for contents", () => {
    const workflow = createReleaseWorkflow();
    expect(workflow.permissions?.contents).toBe("write");
  });

  it("includes release job with correct steps", () => {
    const workflow = createReleaseWorkflow();
    const releaseJob = workflow.jobs["release"];
    expect(releaseJob).toBeDefined();
    const stepNames = releaseJob.steps.map((s) => s.name);
    expect(stepNames).toContain("Checkout code");
    expect(stepNames).toContain("Get latest tag");
    expect(stepNames).toContain("Determine version bump");
    expect(stepNames).toContain("Generate changelog");
    expect(stepNames).toContain("Create GitHub Release");
  });

  it("uses custom release branch", () => {
    const workflow = createReleaseWorkflow({ releaseBranch: "release" });
    const checkoutStep = workflow.jobs["release"].steps.find(
      (s) => s.name === "Checkout code",
    );
    expect(checkoutStep?.with?.ref).toBe("release");
  });
});
