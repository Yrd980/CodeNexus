# OpenClaw Growth Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next OpenClaw iteration as a reality-first research engine that discovers high-signal repositories, scores extraction and PR opportunities, verifies claims beyond happy paths, runs continuously, and gets better from feedback.

**Architecture:** The implementation is organized around a small set of explicit pipeline stages: discovery, repository intelligence, extraction, contribution evaluation, distillation, verification, runtime orchestration, and learning. The plan assumes implementation will happen in the OpenClaw repository, while this document is authored inside CodeNexus as the source-of-truth design handoff. The current workspace is CodeNexus, not OpenClaw; all source paths below refer to the target OpenClaw repository unless a task explicitly names CodeNexus files.

**Tech Stack:** Node.js 20+, TypeScript, GitHub REST/GraphQL APIs, git CLI, JSONL event logs, lightweight scheduler, prompt/rubric files shared with CodeNexus. SQLite is optional in a later phase if JSONL checkpoints and feedback logs become a bottleneck.

---

## Assumed OpenClaw Repository Layout

- `src/config/runtime.ts` — runtime budgets, cadence, thresholds
- `src/config/scoring.ts` — repo / extraction / PR scoring weights
- `src/domain/candidates/types.ts` — candidate repo data structures
- `src/domain/candidates/repo-score.ts` — repo relevance scoring
- `src/domain/candidates/pr-opportunity-score.ts` — PR value scoring
- `src/domain/candidates/extraction-score.ts` — extraction worthiness scoring
- `src/discovery/github-trending.ts` — GitHub Trending ingestion
- `src/discovery/discovery-runner.ts` — discovery stage orchestration
- `src/repos/repo-cache.ts` — clone, fetch, pull, TTL, eviction
- `src/repos/repo-inspector.ts` — detect language, layout, test/build entrypoints
- `src/analysis/project-summary.ts` — structured project understanding
- `src/analysis/valuable-patterns.ts` — extract transferable patterns
- `src/analysis/anti-patterns.ts` — detect misleading or non-transferable decisions
- `src/contribution/pr-candidate.ts` — normalize candidate PR opportunities
- `src/contribution/pr-proof.ts` — attach evidence, reproduction, and risk notes
- `src/distill/module-blueprint.ts` — convert findings into CodeNexus artifacts
- `src/verification/runtime-check.ts` — minimal real execution verification
- `src/verification/assumption-break.ts` — assumption-breaking scenarios
- `src/verification/portability-check.ts` — portability validation
- `src/runtime/checkpoint-store.ts` — save and restore loop state
- `src/runtime/update-manager.ts` — safe self-update via git pull
- `src/runtime/loop.ts` — 24h orchestration loop
- `src/runtime/batch-runner.ts` — per-batch execution boundaries
- `src/learning/feedback-log.ts` — capture outcomes
- `src/learning/strategy-update.ts` — derive updated heuristics
- `.prompts/system/code-extractor.md` — updated extraction rubric
- `.prompts/system/pr-reviewer.md` — updated PR value rubric
- `.prompts/system/repo-scorer.md` — new repo evaluation rubric
- `.prompts/system/pr-opportunity-scorer.md` — new PR opportunity rubric
- `.prompts/system/verification-rubric.md` — new first-principles verification rubric
- `tests/discovery/github-trending.test.ts`
- `tests/domain/repo-score.test.ts`
- `tests/domain/extraction-score.test.ts`
- `tests/domain/pr-opportunity-score.test.ts`
- `tests/repos/repo-cache.test.ts`
- `tests/repos/repo-inspector.test.ts`
- `tests/analysis/project-summary.test.ts`
- `tests/distill/module-blueprint.test.ts`
- `tests/verification/runtime-check.test.ts`
- `tests/runtime/update-manager.test.ts`
- `tests/runtime/loop.test.ts`

## Chunk 1: Lock The Product Boundary

### Task 1: Add the explicit product contract

**Files:**
- Create: `docs/architecture/openclaw-growth-engine.md`
- Modify: `README.md`
- Modify: `docs/architecture/decision-log.md`
- Test: review document consistency manually

- [ ] **Step 1: Write the failing check**

List the required sections that do not exist yet:

```text
- mission
- goals / non-goals
- pipeline stages
- PR value rules
- verification philosophy
- learning loop
```

- [ ] **Step 2: Verify the gap exists**

Run: `rg -n "PR value|learning loop|verification philosophy" README.md docs/architecture 2>/dev/null`
Expected: missing or incomplete coverage

- [ ] **Step 3: Write the minimal architecture document**

Include:

```md
# OpenClaw Growth Engine
## Mission
## Goals
## Non-goals
## Pipeline
## PR Value Rules
## Verification Model
## Learning Loop
```

- [ ] **Step 4: Link the architecture from top-level docs**

Add a short section in `README.md` that points contributors to the architecture document and explicitly states:

```md
OpenClaw optimizes for insight quality, contribution quality, and learning speed.
It does not optimize for PR count or easy green tests.
```

- [ ] **Step 5: Verify**

Run: `rg -n "learning loop|PR count|easy green tests|verification" README.md docs/architecture`
Expected: all concepts present

- [ ] **Step 6: Commit**

```bash
git add README.md docs/architecture/openclaw-growth-engine.md docs/architecture/decision-log.md
git commit -m "docs: define openclaw growth engine boundaries"
```

## Chunk 2: Build Repository Discovery And Scoring

### Task 2: Add GitHub Trending discovery

**Files:**
- Create: `src/discovery/github-trending.ts`
- Create: `src/discovery/discovery-runner.ts`
- Create: `src/domain/candidates/types.ts`
- Test: `tests/discovery/github-trending.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseTrendingHtml } from "../../src/discovery/github-trending";

describe("parseTrendingHtml", () => {
  it("extracts repo name, language, stars, and description", () => {
    const html = `
      <article>
        <h2><a href="/acme/tool">acme / tool</a></h2>
        <p>Useful project</p>
        <span itemprop="programmingLanguage">TypeScript</span>
      </article>
    `;

    expect(parseTrendingHtml(html)[0]).toMatchObject({
      fullName: "acme/tool",
      language: "TypeScript",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/discovery/github-trending.test.ts`
Expected: FAIL because parser does not exist

- [ ] **Step 3: Implement minimal parser and runner**

Create types like:

```ts
export interface DiscoveredRepo {
  fullName: string;
  description: string | null;
  language: string | null;
  starsToday: number | null;
  discoveredAt: string;
  source: "github-trending";
}
```

- [ ] **Step 4: Verify passing behavior**

Run: `npm test -- tests/discovery/github-trending.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/github-trending.ts src/discovery/discovery-runner.ts src/domain/candidates/types.ts tests/discovery/github-trending.test.ts
git commit -m "feat: add github trending discovery stage"
```

### Task 3: Add repo scoring

**Files:**
- Create: `src/config/scoring.ts`
- Create: `src/domain/candidates/repo-score.ts`
- Test: `tests/domain/repo-score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { scoreRepository } from "../../src/domain/candidates/repo-score";

describe("scoreRepository", () => {
  it("rewards startup relevance and transferability", () => {
    const result = scoreRepository({
      domainTags: ["auth", "infra"],
      transferability: 0.9,
      designDepth: 0.8,
      maintenanceSignal: 0.7,
      operationalReality: 0.9,
    });

    expect(result.decision).toBe("research");
    expect(result.totalScore).toBeGreaterThan(0.75);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/domain/repo-score.test.ts`
Expected: FAIL because scoring logic does not exist

- [ ] **Step 3: Implement weighted scoring**

Define weights in `src/config/scoring.ts`:

```ts
export const REPO_SCORE_WEIGHTS = {
  startupRelevance: 0.3,
  transferability: 0.25,
  designDepth: 0.2,
  operationalReality: 0.15,
  maintenanceSignal: 0.1,
} as const;
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/domain/repo-score.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/scoring.ts src/domain/candidates/repo-score.ts tests/domain/repo-score.test.ts
git commit -m "feat: add repository relevance scoring"
```

### Task 4: Add clone/update cache and repository inspection

**Files:**
- Create: `src/repos/repo-cache.ts`
- Create: `src/repos/repo-inspector.ts`
- Test: `tests/repos/repo-cache.test.ts`
- Test: `tests/repos/repo-inspector.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { ensureRepoCached } from "../../src/repos/repo-cache";

describe("ensureRepoCached", () => {
  it("clones a repo when missing and fetches when it already exists", async () => {
    const calls: string[] = [];

    await ensureRepoCached({
      exists: async () => false,
      clone: async () => calls.push("clone"),
      fetch: async () => calls.push("fetch"),
    });

    expect(calls).toEqual(["clone"]);
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { inspectRepository } from "../../src/repos/repo-inspector";

describe("inspectRepository", () => {
  it("detects language, package manager, and likely test command without assuming TypeScript only", async () => {
    const result = await inspectRepository({
      files: ["pyproject.toml", "src/main.py", "tests/test_api.py"],
    });

    expect(result.language).toBe("python");
    expect(result.testCommand).toContain("pytest");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/repos/repo-cache.test.ts tests/repos/repo-inspector.test.ts`
Expected: FAIL because repo cache and inspector do not exist

- [ ] **Step 3: Implement the cache and inspector**

Include:

```ts
export interface RepoCacheDecision {
  action: "clone" | "fetch" | "skip";
  localPath: string;
}

export interface RepoInspection {
  language: string | null;
  packageManager: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/repos/repo-cache.test.ts tests/repos/repo-inspector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repos/repo-cache.ts src/repos/repo-inspector.ts tests/repos/repo-cache.test.ts tests/repos/repo-inspector.test.ts
git commit -m "feat: add repository cache and inspection"
```

## Chunk 3: Build Extraction, Distillation, And PR Value Judgment

### Task 5: Normalize extraction findings

**Files:**
- Create: `src/analysis/project-summary.ts`
- Create: `src/analysis/valuable-patterns.ts`
- Create: `src/analysis/anti-patterns.ts`
- Test: `tests/analysis/project-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { summarizeProject } from "../../src/analysis/project-summary";

describe("summarizeProject", () => {
  it("captures transferable patterns and anti-patterns separately", async () => {
    const summary = await summarizeProject({
      files: ["src/auth.ts", "README.md"],
      focusAreas: ["auth"],
    });

    expect(summary).toHaveProperty("valuablePatterns");
    expect(summary).toHaveProperty("antiPatterns");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/analysis/project-summary.test.ts`
Expected: FAIL because summary pipeline does not exist

- [ ] **Step 3: Implement the structured output**

Use a normalized shape like:

```ts
export interface ProjectSummary {
  projectSummary: string;
  architectureInsights: string[];
  valuablePatterns: Array<{
    name: string;
    problemSolved: string;
    generalizationPlan: string;
  }>;
  antiPatterns: Array<{
    pattern: string;
    whyBad: string;
  }>;
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/analysis/project-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/analysis/project-summary.ts src/analysis/valuable-patterns.ts src/analysis/anti-patterns.ts tests/analysis/project-summary.test.ts
git commit -m "feat: add structured extraction summaries"
```

### Task 6: Add extraction scoring and CodeNexus distillation blueprints

**Files:**
- Create: `src/domain/candidates/extraction-score.ts`
- Create: `src/distill/module-blueprint.ts`
- Test: `tests/domain/extraction-score.test.ts`
- Test: `tests/distill/module-blueprint.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { scoreExtractionWorthiness } from "../../src/domain/candidates/extraction-score";

describe("scoreExtractionWorthiness", () => {
  it("prefers transferable patterns over project-specific glue", () => {
    const result = scoreExtractionWorthiness({
      transferability: 0.9,
      projectSpecificity: 0.1,
      insightDepth: 0.8,
      runnablePotential: 0.7,
    });

    expect(result.decision).toBe("distill");
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { buildModuleBlueprint } from "../../src/distill/module-blueprint";

describe("buildModuleBlueprint", () => {
  it("separates runnable module output from knowledge-card-only output", () => {
    const result = buildModuleBlueprint({
      outputType: "knowledge-card",
      title: "Auth Session Rotation",
    });

    expect(result.files).toContain(".meta.yml");
    expect(result.outputType).toBe("knowledge-card");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/domain/extraction-score.test.ts tests/distill/module-blueprint.test.ts`
Expected: FAIL because extraction scoring and distillation do not exist

- [ ] **Step 3: Implement the score and blueprint builder**

Use shapes like:

```ts
export interface ExtractionScoreInput {
  transferability: number;
  projectSpecificity: number;
  insightDepth: number;
  runnablePotential: number;
}

export interface ModuleBlueprint {
  outputType: "runnable-module" | "starter-pattern" | "knowledge-card" | "pseudo-code";
  files: string[];
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/domain/extraction-score.test.ts tests/distill/module-blueprint.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/candidates/extraction-score.ts src/distill/module-blueprint.ts tests/domain/extraction-score.test.ts tests/distill/module-blueprint.test.ts
git commit -m "feat: add extraction scoring and distillation blueprints"
```

### Task 7: Add PR opportunity scoring

**Files:**
- Create: `src/domain/candidates/pr-opportunity-score.ts`
- Create: `src/contribution/pr-candidate.ts`
- Create: `src/contribution/pr-proof.ts`
- Test: `tests/domain/pr-opportunity-score.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { scorePrOpportunity } from "../../src/domain/candidates/pr-opportunity-score";

describe("scorePrOpportunity", () => {
  it("rejects cosmetic changes with low user impact", () => {
    const result = scorePrOpportunity({
      userImpactScore: 0.1,
      maintainerAcceptanceScore: 0.4,
      proofStrengthScore: 0.2,
      changeSurfaceScore: 0.1,
      brandRiskScore: 0.7,
    });

    expect(result.decision).toBe("skip");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/domain/pr-opportunity-score.test.ts`
Expected: FAIL because scorer does not exist

- [ ] **Step 3: Implement the scorer and proof contract**

Require each PR candidate to carry:

```ts
export interface PrProof {
  reproductionSteps: string[];
  evidence: string[];
  userImpact: string;
  maintainerFit: string;
  rollbackPlan: string | null;
}
```

The first implementation should stop at **proposal generation**:

- produce a ranked PR candidate
- attach proof and brand-risk notes
- require human review before any branch push or PR submission

- [ ] **Step 4: Verify**

Run: `npm test -- tests/domain/pr-opportunity-score.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/domain/candidates/pr-opportunity-score.ts src/contribution/pr-candidate.ts src/contribution/pr-proof.ts tests/domain/pr-opportunity-score.test.ts
git commit -m "feat: add pr opportunity scoring"
```

## Chunk 4: Replace Easy-Green Testing With First-Principles Verification

### Task 8: Add minimal real-runtime verification

**Files:**
- Create: `src/verification/runtime-check.ts`
- Test: `tests/verification/runtime-check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { verifyRuntimeClaim } from "../../src/verification/runtime-check";

describe("verifyRuntimeClaim", () => {
  it("marks a claim invalid when the documented startup command fails", async () => {
    const result = await verifyRuntimeClaim({
      command: "false",
      cwd: process.cwd(),
    });

    expect(result.ok).toBe(false);
    expect(result.kind).toBe("runtime-failure");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/verification/runtime-check.test.ts`
Expected: FAIL because verifier does not exist

- [ ] **Step 3: Implement the verifier**

Return a result shape like:

```ts
export interface RuntimeVerificationResult {
  ok: boolean;
  kind: "success" | "runtime-failure" | "missing-command";
  stdout: string;
  stderr: string;
  exitCode: number | null;
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/verification/runtime-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verification/runtime-check.ts tests/verification/runtime-check.test.ts
git commit -m "feat: add minimal runtime verification"
```

### Task 9: Add assumption-break and portability checks

**Files:**
- Create: `src/verification/assumption-break.ts`
- Create: `src/verification/portability-check.ts`
- Test: `tests/verification/assumption-break.test.ts`
- Test: `tests/verification/portability-check.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("runAssumptionBreakCheck", () => {
  it("reports which critical assumption was intentionally broken", async () => {
    const result = await runAssumptionBreakCheck({
      name: "missing-env",
      setup: async () => {},
      probe: async () => ({ ok: false, boundary: "config-loader" }),
    });

    expect(result.assumptionName).toBe("missing-env");
    expect(result.ok).toBe(false);
  });
});
```

```ts
describe("runPortabilityCheck", () => {
  it("fails when extracted code still depends on source-project globals", async () => {
    const result = await runPortabilityCheck({
      forbiddenDependencies: ["@source/internal"],
      referencedImports: ["@source/internal"],
    });

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/verification/assumption-break.test.ts tests/verification/portability-check.test.ts`
Expected: FAIL because checks do not exist

- [ ] **Step 3: Implement the checks**

Use small result types:

```ts
export interface AssumptionBreakResult {
  assumptionName: string;
  ok: boolean;
  boundary: string;
  notes: string[];
}

export interface PortabilityCheckResult {
  ok: boolean;
  leakedDependencies: string[];
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/verification/assumption-break.test.ts tests/verification/portability-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verification/assumption-break.ts src/verification/portability-check.ts tests/verification/assumption-break.test.ts tests/verification/portability-check.test.ts
git commit -m "feat: add first-principles verification checks"
```

## Chunk 5: Add Continuous Runtime And Safe Self-Update

### Task 10: Add checkpointing and batch execution

**Files:**
- Create: `src/runtime/checkpoint-store.ts`
- Create: `src/runtime/batch-runner.ts`
- Create: `src/runtime/loop.ts`
- Test: `tests/runtime/loop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { runBatchLoop } from "../../src/runtime/loop";

describe("runBatchLoop", () => {
  it("writes a checkpoint after each batch", async () => {
    const events: string[] = [];

    await runBatchLoop({
      runBatch: async () => {
        events.push("batch");
      },
      saveCheckpoint: async () => {
        events.push("checkpoint");
      },
      iterations: 1,
    });

    expect(events).toEqual(["batch", "checkpoint"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/runtime/loop.test.ts`
Expected: FAIL because loop does not exist

- [ ] **Step 3: Implement the loop**

Keep the first version deliberately small:

```ts
export interface BatchLoopDeps {
  iterations: number;
  runBatch: () => Promise<void>;
  saveCheckpoint: () => Promise<void>;
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/runtime/loop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/checkpoint-store.ts src/runtime/batch-runner.ts src/runtime/loop.ts tests/runtime/loop.test.ts
git commit -m "feat: add batch loop and checkpointing"
```

### Task 11: Add safe git pull self-update

**Files:**
- Create: `src/runtime/update-manager.ts`
- Test: `tests/runtime/update-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { runSafeSelfUpdate } from "../../src/runtime/update-manager";

describe("runSafeSelfUpdate", () => {
  it("runs fetch, pull, and health check in order", async () => {
    const calls: string[] = [];

    await runSafeSelfUpdate({
      fetch: async () => calls.push("fetch"),
      pull: async () => calls.push("pull"),
      healthCheck: async () => calls.push("health"),
      rollback: async () => calls.push("rollback"),
    });

    expect(calls).toEqual(["fetch", "pull", "health"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/runtime/update-manager.test.ts`
Expected: FAIL because update manager does not exist

- [ ] **Step 3: Implement safe self-update**

The first version should:

1. refuse to update during an active batch
2. fetch remote changes
3. fast-forward pull
4. run minimal health check
5. rollback on health-check failure

- [ ] **Step 4: Verify**

Run: `npm test -- tests/runtime/update-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/update-manager.ts tests/runtime/update-manager.test.ts
git commit -m "feat: add safe self-update manager"
```

## Chunk 6: Add Learning And Shared Rubrics

### Task 12: Add feedback logging and strategy updates

**Files:**
- Create: `src/learning/feedback-log.ts`
- Create: `src/learning/strategy-update.ts`
- Create: `data/feedback/.gitkeep`
- Test: `tests/learning/strategy-update.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { summarizeFeedback } from "../../src/learning/strategy-update";

describe("summarizeFeedback", () => {
  it("surfaces rejected low-value PR patterns", () => {
    const summary = summarizeFeedback([
      { kind: "pr-rejected", reason: "cosmetic-only" },
      { kind: "pr-rejected", reason: "cosmetic-only" },
      { kind: "pr-accepted", reason: "docs-bugfix" },
    ]);

    expect(summary.topRejectedReasons[0]).toBe("cosmetic-only");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/learning/strategy-update.test.ts`
Expected: FAIL because learning pipeline does not exist

- [ ] **Step 3: Implement feedback storage and summarization**

Support events like:

```ts
export interface FeedbackEvent {
  kind: "pr-accepted" | "pr-rejected" | "extract-promoted" | "extract-discarded";
  reason: string;
  createdAt: string;
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/learning/strategy-update.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/learning/feedback-log.ts src/learning/strategy-update.ts data/feedback/.gitkeep tests/learning/strategy-update.test.ts
git commit -m "feat: add learning feedback loop"
```

### Task 13: Add PR submission safety gate

**Files:**
- Create: `src/contribution/submission-gate.ts`
- Test: `tests/contribution/submission-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateSubmissionGate } from "../../src/contribution/submission-gate";

describe("evaluateSubmissionGate", () => {
  it("routes high-risk changes to human review instead of auto-submit", () => {
    const result = evaluateSubmissionGate({
      proofStrengthScore: 0.5,
      brandRiskScore: 0.8,
      changeSurfaceScore: 0.9,
    });

    expect(result.decision).toBe("draft-for-human-review");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/contribution/submission-gate.test.ts`
Expected: FAIL because submission gate does not exist

- [ ] **Step 3: Implement the gate**

Use a minimal contract:

```ts
export interface SubmissionGateResult {
  decision: "skip" | "draft-for-human-review" | "ready-for-submit";
  reasons: string[];
}
```

- [ ] **Step 4: Verify**

Run: `npm test -- tests/contribution/submission-gate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contribution/submission-gate.ts tests/contribution/submission-gate.test.ts
git commit -m "feat: add pr submission safety gate"
```

### Task 14: Update shared rubrics and prompts

**Files:**
- Modify: `.prompts/system/code-extractor.md`
- Modify: `.prompts/system/pr-reviewer.md`
- Create: `.prompts/system/repo-scorer.md`
- Create: `.prompts/system/pr-opportunity-scorer.md`
- Create: `.prompts/system/verification-rubric.md`
- Test: manual prompt review

- [ ] **Step 1: Write the failing review checklist**

List the missing prompt constraints:

```text
- trending is an input source, not proof of value
- PRs must optimize for maintainer gratitude
- verification must include runtime truth, assumption break, portability
- low-value cosmetic PRs are disallowed
- growth loop requires explicit feedback capture
- high-risk changes must stop at human review
```

- [ ] **Step 2: Verify the current prompts are missing these rules**

Run: `rg -n "maintainer gratitude|assumption break|portability|feedback capture" .prompts/system`
Expected: limited or no coverage

- [ ] **Step 3: Update and add prompts**

Add explicit sections that:

- tell extraction to separate strong patterns from anti-patterns
- tell PR review to reject water PRs
- tell verification to distrust easy-green tests
- tell repo scoring to favor transferability and startup relevance
- tell submission policy to route high-risk changes to human review

- [ ] **Step 4: Verify**

Run: `rg -n "water PR|maintainer|portability|runtime truth|feedback|human review" .prompts/system`
Expected: all concepts present

- [ ] **Step 5: Commit**

```bash
git add .prompts/system/code-extractor.md .prompts/system/pr-reviewer.md .prompts/system/repo-scorer.md .prompts/system/pr-opportunity-scorer.md .prompts/system/verification-rubric.md
git commit -m "docs: upgrade openclaw scoring and verification rubrics"
```

## Final Verification

- [ ] Ensure workspace scripts exist in the OpenClaw root `package.json`
Expected: root scripts include `test`, `lint`, `build`, and `dry-run`

- [ ] Run: `npm test`
Expected: all unit tests pass through the workspace root

- [ ] Run: `npm run lint`
Expected: no lint errors

- [ ] Run: `npm run build`
Expected: build succeeds

- [ ] Run one dry-run batch against a small fixture set
Expected: discovery -> scoring -> extraction -> verification -> checkpoint completes without manual intervention

## Delivery Notes

- Keep the first release narrow: GitHub Trending only, limited budgets, explicit logs.
- Do not implement autonomous PR submission until repo scoring, PR scoring, and first-principles verification are all in place.
- In the first shipping version, PR handling stays in proposal mode with a human approval gate.
- Treat accepted and rejected PRs as training data for the next iteration.

Plan complete and saved to `docs/superpowers/plans/2026-03-14-openclaw-growth-engine.md`. Ready to execute once the OpenClaw repository is available.
