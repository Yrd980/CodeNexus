/**
 * Release Template — Automated release with changelog
 *
 * Generates a GitHub Actions workflow that:
 * 1. Parses conventional commits since last tag
 * 2. Determines version bump
 * 3. Generates changelog
 * 4. Creates a GitHub release with tag
 *
 * Uses the release module's logic via inline script steps.
 */

import type { Workflow } from "../types.js";

/**
 * Configuration for the release workflow template.
 */
export interface ReleaseWorkflowConfig {
  /** Branch to release from (default: "main") */
  releaseBranch?: string;

  /** Tag prefix (default: "v") */
  tagPrefix?: string;

  /** Node.js version (default: "20") */
  nodeVersion?: string;

  /** Package manager (default: "npm") */
  packageManager?: "npm" | "pnpm" | "yarn";
}

// GitHub Actions expression helper — avoids template literal parsing issues
function gha(expr: string): string {
  return "$" + "{{" + " " + expr + " " + "}}";
}

/**
 * Generate an automated release workflow.
 *
 * This workflow runs on manual trigger (workflow_dispatch) and:
 * - Checks out code with full git history
 * - Determines the next version from conventional commits
 * - Generates changelog
 * - Creates a GitHub release with the changelog as body
 *
 * @example
 * ```ts
 * const workflow = createReleaseWorkflow({
 *   releaseBranch: "main",
 *   tagPrefix: "v",
 * });
 * ```
 */
export function createReleaseWorkflow(config?: ReleaseWorkflowConfig): Workflow {
  const branch = config?.releaseBranch ?? "main";
  const prefix = config?.tagPrefix ?? "v";
  const nodeVersion = config?.nodeVersion ?? "20";

  const tagOutput = gha("steps.get_tag.outputs.tag");
  const commitsOutput = gha("steps.get_commits.outputs.commits");
  const versionOutput = gha("steps.bump.outputs.version");
  const changelogOutput = gha("steps.changelog.outputs.changelog");
  const secretsToken = gha("secrets.GITHUB_TOKEN");

  return {
    name: "Release",
    on: {
      workflow_dispatch: {},
    },
    permissions: {
      contents: "write",
    },
    jobs: {
      release: {
        name: "Create Release",
        "runs-on": "ubuntu-latest",
        steps: [
          {
            name: "Checkout code",
            uses: "actions/checkout@v4",
            with: {
              "fetch-depth": 0,
              ref: branch,
            },
          },
          {
            name: "Set up Node.js",
            uses: "actions/setup-node@v4",
            with: {
              "node-version": nodeVersion,
            },
          },
          {
            name: "Get latest tag",
            id: "get_tag",
            run: [
              "LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo \"" + prefix + "0.0.0\")",
              "echo \"tag=$LATEST_TAG\" >> $GITHUB_OUTPUT",
              "echo \"Latest tag: $LATEST_TAG\"",
            ].join("\n"),
          },
          {
            name: "Get commits since last tag",
            id: "get_commits",
            run: [
              "COMMITS=$(git log " + tagOutput + "..HEAD --pretty=format:\"%s\" 2>/dev/null || git log --pretty=format:\"%s\")",
              "echo \"commits<<EOF\" >> $GITHUB_OUTPUT",
              "echo \"$COMMITS\" >> $GITHUB_OUTPUT",
              "echo \"EOF\" >> $GITHUB_OUTPUT",
            ].join("\n"),
          },
          {
            name: "Determine version bump",
            id: "bump",
            run: [
              "COMMITS=\"" + commitsOutput + "\"",
              "BUMP=\"patch\"",
              "if echo \"$COMMITS\" | grep -qE \"^feat\"; then BUMP=\"minor\"; fi",
              "if echo \"$COMMITS\" | grep -qE \"!:\"; then BUMP=\"major\"; fi",
              "if echo \"$COMMITS\" | grep -q \"BREAKING CHANGE\"; then BUMP=\"major\"; fi",
              "",
              "CURRENT=\"" + tagOutput + "\"",
              "CURRENT=${CURRENT#" + prefix + "}",
              "IFS='.' read -r MAJOR MINOR PATCH <<< \"$CURRENT\"",
              "",
              "case $BUMP in",
              "  major) NEW=\"$((MAJOR+1)).0.0\" ;;",
              "  minor) NEW=\"$MAJOR.$((MINOR+1)).0\" ;;",
              "  patch) NEW=\"$MAJOR.$MINOR.$((PATCH+1))\" ;;",
              "esac",
              "",
              "echo \"version=$NEW\" >> $GITHUB_OUTPUT",
              "echo \"bump=$BUMP\" >> $GITHUB_OUTPUT",
              "echo \"New version: " + prefix + "$NEW ($BUMP)\"",
            ].join("\n"),
          },
          {
            name: "Generate changelog",
            id: "changelog",
            run: [
              "COMMITS=\"" + commitsOutput + "\"",
              "VERSION=\"" + prefix + versionOutput + "\"",
              "DATE=$(date +%Y-%m-%d)",
              "",
              "CHANGELOG=\"## $VERSION ($DATE)\\n\\n\"",
              "",
              "# Features",
              "FEATS=$(echo \"$COMMITS\" | grep -E \"^feat\" || true)",
              "if [ -n \"$FEATS\" ]; then",
              "  CHANGELOG+=\"### Features\\n\\n\"",
              "  while IFS= read -r line; do",
              "    DESC=${line#*: }",
              "    CHANGELOG+=\"- $DESC\\n\"",
              "  done <<< \"$FEATS\"",
              "  CHANGELOG+=\"\\n\"",
              "fi",
              "",
              "# Bug Fixes",
              "FIXES=$(echo \"$COMMITS\" | grep -E \"^fix\" || true)",
              "if [ -n \"$FIXES\" ]; then",
              "  CHANGELOG+=\"### Bug Fixes\\n\\n\"",
              "  while IFS= read -r line; do",
              "    DESC=${line#*: }",
              "    CHANGELOG+=\"- $DESC\\n\"",
              "  done <<< \"$FIXES\"",
              "  CHANGELOG+=\"\\n\"",
              "fi",
              "",
              "echo \"changelog<<EOF\" >> $GITHUB_OUTPUT",
              "echo -e \"$CHANGELOG\" >> $GITHUB_OUTPUT",
              "echo \"EOF\" >> $GITHUB_OUTPUT",
            ].join("\n"),
          },
          {
            name: "Create GitHub Release",
            uses: "actions/create-release@v1",
            env: {
              GITHUB_TOKEN: secretsToken,
            },
            with: {
              tag_name: prefix + versionOutput,
              release_name: prefix + versionOutput,
              body: changelogOutput,
              draft: false,
              prerelease: false,
            },
          },
        ],
      },
    },
  };
}
