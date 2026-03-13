import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  determineBumpLevel,
  generateChangelog,
  parseCommits,
  parseConventionalCommit,
  parseSemver,
  prepareRelease,
  updatePackageJsonVersion,
  updatePyprojectVersion,
} from "../src/release.js";
import type { ChangelogSection, ParsedCommit } from "../src/types.js";

// ---------------------------------------------------------------------------
// Conventional Commit Parsing
// ---------------------------------------------------------------------------

describe("parseConventionalCommit", () => {
  it("parses a simple feat commit", () => {
    const result = parseConventionalCommit("feat: add user login");
    expect(result).not.toBeNull();
    expect(result?.type).toBe("feat");
    expect(result?.description).toBe("add user login");
    expect(result?.breaking).toBe(false);
    expect(result?.scope).toBeUndefined();
  });

  it("parses a commit with scope", () => {
    const result = parseConventionalCommit("fix(auth): resolve token expiry");
    expect(result?.type).toBe("fix");
    expect(result?.scope).toBe("auth");
    expect(result?.description).toBe("resolve token expiry");
  });

  it("detects breaking change via bang", () => {
    const result = parseConventionalCommit("feat!: remove deprecated API");
    expect(result?.breaking).toBe(true);
  });

  it("detects breaking change via body", () => {
    const message = `feat: new auth flow

BREAKING CHANGE: old tokens are no longer valid`;
    const result = parseConventionalCommit(message);
    expect(result?.breaking).toBe(true);
    expect(result?.body).toContain("BREAKING CHANGE");
  });

  it("detects BREAKING-CHANGE with hyphen in body", () => {
    const message = `refactor: update API

BREAKING-CHANGE: response format changed`;
    const result = parseConventionalCommit(message);
    expect(result?.breaking).toBe(true);
  });

  it("returns null for non-conventional commits", () => {
    expect(parseConventionalCommit("Update readme")).toBeNull();
    expect(parseConventionalCommit("WIP stuff")).toBeNull();
    expect(parseConventionalCommit("")).toBeNull();
  });

  it("returns null for unknown commit types", () => {
    expect(parseConventionalCommit("yolo: whatever")).toBeNull();
  });

  it("preserves the raw commit message", () => {
    const message = "docs: update API reference";
    const result = parseConventionalCommit(message);
    expect(result?.raw).toBe(message);
  });

  it("handles all valid commit types", () => {
    const types = [
      "feat", "fix", "docs", "style", "refactor",
      "perf", "test", "build", "ci", "chore", "revert",
    ];
    for (const type of types) {
      const result = parseConventionalCommit(`${type}: something`);
      expect(result).not.toBeNull();
      expect(result?.type).toBe(type);
    }
  });
});

describe("parseCommits", () => {
  it("parses multiple commits and skips non-conventional", () => {
    const messages = [
      "feat: add login",
      "random commit",
      "fix(db): connection pool leak",
      "update readme",
    ];
    const parsed = parseCommits(messages);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("feat");
    expect(parsed[1].type).toBe("fix");
  });
});

// ---------------------------------------------------------------------------
// Version Bumping
// ---------------------------------------------------------------------------

describe("parseSemver", () => {
  it("parses standard semver", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("strips v prefix", () => {
    expect(parseSemver("v2.0.1")).toEqual({ major: 2, minor: 0, patch: 1 });
  });

  it("throws on invalid semver", () => {
    expect(() => parseSemver("1.2")).toThrow("Invalid semver");
    expect(() => parseSemver("abc")).toThrow("Invalid semver");
  });
});

describe("determineBumpLevel", () => {
  it("returns major for breaking changes", () => {
    const commits: ParsedCommit[] = [
      { type: "feat", description: "new API", breaking: true, raw: "" },
    ];
    expect(determineBumpLevel(commits)).toBe("major");
  });

  it("returns minor for features", () => {
    const commits: ParsedCommit[] = [
      { type: "feat", description: "add search", breaking: false, raw: "" },
      { type: "fix", description: "fix typo", breaking: false, raw: "" },
    ];
    expect(determineBumpLevel(commits)).toBe("minor");
  });

  it("returns patch for fixes only", () => {
    const commits: ParsedCommit[] = [
      { type: "fix", description: "fix crash", breaking: false, raw: "" },
      { type: "chore", description: "update deps", breaking: false, raw: "" },
    ];
    expect(determineBumpLevel(commits)).toBe("patch");
  });

  it("ignores breaking changes when respectBreaking is false", () => {
    const commits: ParsedCommit[] = [
      { type: "feat", description: "new API", breaking: true, raw: "" },
    ];
    expect(determineBumpLevel(commits, false)).toBe("minor");
  });
});

describe("bumpVersion", () => {
  it("bumps major", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("bumps minor", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("bumps patch", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
  });

  it("handles v prefix", () => {
    expect(bumpVersion("v1.0.0", "minor")).toBe("1.1.0");
  });

  it("handles 0.x versions correctly", () => {
    expect(bumpVersion("0.1.0", "major")).toBe("1.0.0");
    expect(bumpVersion("0.1.0", "minor")).toBe("0.2.0");
    expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
  });
});

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

describe("generateChangelog", () => {
  it("generates a formatted changelog with version header", () => {
    const section: ChangelogSection = {
      version: "v1.1.0",
      date: "2026-03-14",
      entries: [
        { type: "feat", description: "add search", breaking: false },
        { type: "fix", description: "fix crash", breaking: false },
      ],
    };
    const changelog = generateChangelog(section);
    expect(changelog).toContain("## v1.1.0 (2026-03-14)");
    expect(changelog).toContain("### Features");
    expect(changelog).toContain("- add search");
    expect(changelog).toContain("### Bug Fixes");
    expect(changelog).toContain("- fix crash");
  });

  it("lists breaking changes in a separate section", () => {
    const section: ChangelogSection = {
      version: "v2.0.0",
      date: "2026-03-14",
      entries: [
        { type: "feat", description: "new API", breaking: true },
        { type: "feat", description: "add logout", breaking: false },
      ],
    };
    const changelog = generateChangelog(section);
    expect(changelog).toContain("### BREAKING CHANGES");
    expect(changelog).toContain("- new API");
    // Non-breaking feat should be in Features section
    expect(changelog).toContain("### Features");
    expect(changelog).toContain("- add logout");
  });

  it("includes scope in changelog entries", () => {
    const section: ChangelogSection = {
      version: "v1.0.1",
      date: "2026-03-14",
      entries: [
        { type: "fix", scope: "auth", description: "token refresh", breaking: false },
      ],
    };
    const changelog = generateChangelog(section);
    expect(changelog).toContain("**auth:** token refresh");
  });

  it("skips non-changelog types like chore", () => {
    const section: ChangelogSection = {
      version: "v1.0.1",
      date: "2026-03-14",
      entries: [
        { type: "chore", description: "update deps", breaking: false },
        { type: "fix", description: "fix bug", breaking: false },
      ],
    };
    const changelog = generateChangelog(section);
    expect(changelog).not.toContain("update deps");
    expect(changelog).toContain("fix bug");
  });
});

// ---------------------------------------------------------------------------
// Version File Updaters
// ---------------------------------------------------------------------------

describe("updatePackageJsonVersion", () => {
  it("updates version in package.json content", () => {
    const content = `{
  "name": "my-app",
  "version": "1.0.0",
  "description": "test"
}`;
    const updated = updatePackageJsonVersion(content, "2.0.0");
    expect(updated).toContain('"version": "2.0.0"');
    expect(updated).toContain('"name": "my-app"');
  });
});

describe("updatePyprojectVersion", () => {
  it("updates version in pyproject.toml content", () => {
    const content = `[tool.poetry]
name = "my-app"
version = "1.0.0"
description = "test"`;
    const updated = updatePyprojectVersion(content, "2.0.0");
    expect(updated).toContain('version = "2.0.0"');
  });
});

// ---------------------------------------------------------------------------
// Release Orchestrator
// ---------------------------------------------------------------------------

describe("prepareRelease", () => {
  it("calculates new version and generates changelog", () => {
    const result = prepareRelease(
      { currentVersion: "1.0.0" },
      [
        "feat: add search",
        "fix: fix crash",
      ],
    );

    expect(result).not.toBeNull();
    expect(result?.previousVersion).toBe("1.0.0");
    expect(result?.newVersion).toBe("1.1.0");
    expect(result?.bumpLevel).toBe("minor");
    expect(result?.tag).toBe("v1.1.0");
    expect(result?.changelog).toContain("add search");
  });

  it("returns null when no conventional commits", () => {
    const result = prepareRelease(
      { currentVersion: "1.0.0" },
      ["update readme", "misc changes"],
    );
    expect(result).toBeNull();
  });

  it("uses custom tag prefix", () => {
    const result = prepareRelease(
      { currentVersion: "1.0.0", tagPrefix: "release-" },
      ["fix: bug"],
    );
    expect(result?.tag).toBe("release-1.0.1");
  });

  it("respects breaking changes for major bump", () => {
    const result = prepareRelease(
      { currentVersion: "1.0.0", respectBreakingChanges: true },
      ["feat!: breaking change"],
    );
    expect(result?.bumpLevel).toBe("major");
    expect(result?.newVersion).toBe("2.0.0");
  });

  it("skips changelog when configured", () => {
    const result = prepareRelease(
      { currentVersion: "1.0.0", changelog: false },
      ["feat: something"],
    );
    expect(result?.changelog).toBe("");
  });
});
