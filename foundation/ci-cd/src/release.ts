/**
 * Release Automation
 *
 * Semantic versioning from conventional commits, changelog generation,
 * and version bumping. No dependencies — just pure TypeScript logic
 * that you can integrate into any CI pipeline.
 */

import type {
  BumpLevel,
  ChangelogEntry,
  ChangelogSection,
  ConventionalCommitType,
  ParsedCommit,
  ReleaseConfig,
  ReleaseResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Conventional Commit Parsing
// ---------------------------------------------------------------------------

/**
 * Valid conventional commit types.
 * Used both for parsing and for ordering in changelogs.
 */
const VALID_TYPES: ReadonlySet<string> = new Set<string>([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

/**
 * Regex for parsing conventional commits.
 *
 * Matches: `type(scope)?: description`
 * Optional body after blank line.
 * Breaking changes indicated by `!` before `:` or `BREAKING CHANGE:` in body.
 */
const COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/;

/**
 * Parse a conventional commit message.
 *
 * Returns null for non-conventional commits (they're skipped in release notes).
 */
export function parseConventionalCommit(message: string): ParsedCommit | null {
  const lines = message.trim().split("\n");
  const firstLine = lines[0] ?? "";

  const match = COMMIT_REGEX.exec(firstLine);
  if (!match) return null;

  const type = match[1];
  const scope = match[2];
  const bang = match[3];
  const description = match[4];

  if (!type || !description || !VALID_TYPES.has(type)) return null;

  const bodyLines = lines.slice(1);
  // Skip leading empty lines in body
  const bodyStart = bodyLines.findIndex((line) => line.trim() !== "");
  const body = bodyStart >= 0 ? bodyLines.slice(bodyStart).join("\n").trim() : undefined;

  const breakingInBody = body
    ? /^BREAKING[ -]CHANGE\s*:/m.test(body)
    : false;

  return {
    type: type as ConventionalCommitType,
    scope: scope || undefined,
    description: description.trim(),
    body,
    breaking: bang === "!" || breakingInBody,
    raw: message.trim(),
  };
}

/**
 * Parse multiple commit messages.
 *
 * Non-conventional commits are silently skipped.
 */
export function parseCommits(messages: string[]): ParsedCommit[] {
  const parsed: ParsedCommit[] = [];
  for (const msg of messages) {
    const commit = parseConventionalCommit(msg);
    if (commit) {
      parsed.push(commit);
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Version Bumping
// ---------------------------------------------------------------------------

/** Parse a semver string into components */
export function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const clean = version.replace(/^v/, "");
  const parts = clean.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid semver: ${version}`);
  }
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return { major, minor, patch };
}

/**
 * Determine the bump level based on conventional commits.
 *
 * - Any breaking change -> major
 * - Any `feat` -> minor
 * - Everything else -> patch
 */
export function determineBumpLevel(
  commits: ParsedCommit[],
  respectBreaking = true,
): BumpLevel {
  let hasBreaking = false;
  let hasFeature = false;

  for (const commit of commits) {
    if (commit.breaking && respectBreaking) {
      hasBreaking = true;
    }
    if (commit.type === "feat") {
      hasFeature = true;
    }
  }

  if (hasBreaking) return "major";
  if (hasFeature) return "minor";
  return "patch";
}

/**
 * Bump a semver version string.
 *
 * @param currentVersion - e.g. "1.2.3" or "v1.2.3"
 * @param level - "major" | "minor" | "patch"
 * @returns New version string (without "v" prefix)
 */
export function bumpVersion(currentVersion: string, level: BumpLevel): string {
  const { major, minor, patch } = parseSemver(currentVersion);

  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

// ---------------------------------------------------------------------------
// Changelog Generation
// ---------------------------------------------------------------------------

/** Human-readable labels for commit types in changelogs */
const TYPE_LABELS: Record<ConventionalCommitType, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  docs: "Documentation",
  style: "Styles",
  refactor: "Code Refactoring",
  perf: "Performance Improvements",
  test: "Tests",
  build: "Build System",
  ci: "CI/CD",
  chore: "Chores",
  revert: "Reverts",
};

/** Types that appear in changelogs (we skip noise like chore, style, etc.) */
const CHANGELOG_TYPES: ReadonlySet<ConventionalCommitType> = new Set([
  "feat",
  "fix",
  "perf",
  "revert",
  "docs",
  "refactor",
]);

/**
 * Generate a changelog section for a version.
 */
export function generateChangelog(section: ChangelogSection): string {
  const lines: string[] = [];

  lines.push(`## ${section.version} (${section.date})`);
  lines.push("");

  // Group entries by type
  const groups = new Map<ConventionalCommitType, ChangelogEntry[]>();
  for (const entry of section.entries) {
    const existing = groups.get(entry.type) ?? [];
    existing.push(entry);
    groups.set(entry.type, existing);
  }

  // Breaking changes first
  const breakingEntries = section.entries.filter((e) => e.breaking);
  if (breakingEntries.length > 0) {
    lines.push("### BREAKING CHANGES");
    lines.push("");
    for (const entry of breakingEntries) {
      const scope = entry.scope ? `**${entry.scope}:** ` : "";
      lines.push(`- ${scope}${entry.description}`);
    }
    lines.push("");
  }

  // Then by type
  for (const type of Object.keys(TYPE_LABELS) as ConventionalCommitType[]) {
    const entries = groups.get(type);
    if (!entries || !CHANGELOG_TYPES.has(type)) continue;

    // Don't re-list breaking changes in their category
    const nonBreaking = entries.filter((e) => !e.breaking);
    if (nonBreaking.length === 0) continue;

    lines.push(`### ${TYPE_LABELS[type]}`);
    lines.push("");
    for (const entry of nonBreaking) {
      const scope = entry.scope ? `**${entry.scope}:** ` : "";
      lines.push(`- ${scope}${entry.description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Version File Updaters
// ---------------------------------------------------------------------------

/**
 * Update version in package.json content.
 *
 * Returns the updated file content as a string.
 */
export function updatePackageJsonVersion(content: string, newVersion: string): string {
  return content.replace(
    /("version"\s*:\s*")([^"]+)(")/,
    `$1${newVersion}$3`,
  );
}

/**
 * Update version in pyproject.toml content.
 *
 * Returns the updated file content as a string.
 */
export function updatePyprojectVersion(content: string, newVersion: string): string {
  return content.replace(
    /(version\s*=\s*")([^"]+)(")/,
    `$1${newVersion}$3`,
  );
}

// ---------------------------------------------------------------------------
// Release Orchestrator
// ---------------------------------------------------------------------------

/**
 * Prepare a release based on conventional commits.
 *
 * This computes the new version, generates a changelog, and returns
 * everything needed to carry out the release. It does NOT perform git
 * operations — that's left to the caller (or the CI workflow).
 *
 * @param config - Release configuration
 * @param commitMessages - Raw commit messages since last release
 * @returns Release result with new version, changelog, etc.
 */
export function prepareRelease(
  config: ReleaseConfig,
  commitMessages: string[],
): ReleaseResult | null {
  const commits = parseCommits(commitMessages);

  if (commits.length === 0) {
    return null;
  }

  const bumpLevel = determineBumpLevel(
    commits,
    config.respectBreakingChanges ?? true,
  );

  const newVersion = bumpVersion(config.currentVersion, bumpLevel);
  const prefix = config.tagPrefix ?? "v";

  const entries: ChangelogEntry[] = commits.map((c) => ({
    type: c.type,
    scope: c.scope,
    description: c.description,
    breaking: c.breaking,
  }));

  const today = new Date().toISOString().split("T")[0] ?? "";
  const changelogText = config.changelog !== false
    ? generateChangelog({
        version: `${prefix}${newVersion}`,
        date: today,
        entries,
      })
    : "";

  return {
    previousVersion: config.currentVersion,
    newVersion,
    bumpLevel,
    changelog: changelogText,
    tag: `${prefix}${newVersion}`,
    commits,
  };
}
