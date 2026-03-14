import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from openclaw_trending_pipeline import (
    analyze_repo,
    build_analysis_task,
    clone_or_update_repo,
    derive_batch_keywords,
    extract_readme_summary,
    inspect_repo,
    parse_trending_html,
)


class ParseTrendingHtmlTests(unittest.TestCase):
    def test_extracts_repositories_from_github_trending_markup(self) -> None:
        html = """
        <article class="Box-row">
          <h2 class="h3 lh-condensed">
            <a href="/acme/rocket"> acme / rocket </a>
          </h2>
          <p class="col-9 color-fg-muted my-1 pr-4">
            Ship features fast
          </p>
          <span itemprop="programmingLanguage">TypeScript</span>
          <span class="d-inline-block float-sm-right">321 stars today</span>
        </article>
        <article class="Box-row">
          <h2 class="h3 lh-condensed">
            <a href="/beta/payments"> beta / payments </a>
          </h2>
          <span itemprop="programmingLanguage">Python</span>
          <span class="d-inline-block float-sm-right">54 stars today</span>
        </article>
        """

        repos = parse_trending_html(html)

        self.assertEqual(2, len(repos))
        self.assertEqual("acme/rocket", repos[0]["full_name"])
        self.assertEqual("https://github.com/acme/rocket", repos[0]["url"])
        self.assertEqual("TypeScript", repos[0]["language"])
        self.assertEqual(321, repos[0]["stars_today"])
        self.assertEqual("Ship features fast", repos[0]["description"])


class CloneOrUpdateRepoTests(unittest.TestCase):
    def test_clones_when_repo_is_missing(self) -> None:
        calls: list[list[str]] = []

        def runner(argv: list[str], cwd: str | None = None) -> None:
          calls.append(argv)

        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "acme__rocket"

            clone_or_update_repo(
                {
                    "full_name": "acme/rocket",
                    "url": "https://github.com/acme/rocket",
                },
                clone_root=Path(tmpdir),
                runner=runner,
            )

            self.assertEqual(
                [["git", "clone", "--depth", "1", "https://github.com/acme/rocket", str(target)]],
                calls,
            )

    def test_updates_when_repo_already_exists(self) -> None:
        calls: list[list[str]] = []

        def runner(argv: list[str], cwd: str | None = None) -> None:
            calls.append(argv)

        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "acme__rocket"
            target.mkdir()

            clone_or_update_repo(
                {
                    "full_name": "acme/rocket",
                    "url": "https://github.com/acme/rocket",
                },
                clone_root=Path(tmpdir),
                runner=runner,
            )

            self.assertEqual(
                [
                    ["git", "-C", str(target), "fetch", "--all", "--prune"],
                    ["git", "-C", str(target), "pull", "--ff-only"],
                ],
                calls,
            )


class InspectRepoTests(unittest.TestCase):
    def test_detects_basic_repo_profile_from_package_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_dir = Path(tmpdir)
            package_json = {
                "name": "acme-rocket",
                "scripts": {
                    "build": "tsc -p tsconfig.json",
                    "test": "vitest run",
                },
            }
            (repo_dir / "package.json").write_text(json.dumps(package_json), encoding="utf-8")
            (repo_dir / "README.md").write_text("# Acme Rocket", encoding="utf-8")

            profile = inspect_repo(repo_dir)

            self.assertEqual(["node"], profile["ecosystems"])
            self.assertEqual(["npm run build"], profile["build_commands"])
            self.assertEqual(["npm test"], profile["test_commands"])
            self.assertTrue(profile["has_readme"])


class ReadmeSummaryTests(unittest.TestCase):
    def test_extracts_first_meaningful_paragraph_from_readme(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_dir = Path(tmpdir)
            (repo_dir / "README.md").write_text(
                "# Acme Rocket\n\nShip startup features fast with auth, billing, and webhooks.\n\n## Install\n\n...",
                encoding="utf-8",
            )

            summary = extract_readme_summary(repo_dir)

            self.assertEqual("Ship startup features fast with auth, billing, and webhooks.", summary)

    def test_skips_html_wrapper_blocks_and_keeps_first_real_sentence(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_dir = Path(tmpdir)
            (repo_dir / "README.md").write_text(
                "# Open Viking\n\n<div align=\"center\">\n  <img src=\"banner.png\" />\n</div>\n\nOpen-source AI coding agent for software engineering teams.\n\n## Install\n",
                encoding="utf-8",
            )

            summary = extract_readme_summary(repo_dir)

            self.assertEqual("Open-source AI coding agent for software engineering teams.", summary)

    def test_skips_language_picker_navigation_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_dir = Path(tmpdir)
            (repo_dir / "README.md").write_text(
                "# Open Viking\n\nEnglish / [中文](README_CN.md)\n\nContext engineering database designed specifically for AI agents.\n",
                encoding="utf-8",
            )

            summary = extract_readme_summary(repo_dir)

            self.assertEqual("Context engineering database designed specifically for AI agents.", summary)

    def test_skips_badge_wall_before_real_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_dir = Path(tmpdir)
            (repo_dir / "README.md").write_text(
                "# Open Viking\n\n[![][release-shield]][release-link] [![][github-stars-shield]][github-stars-link]\n\nContext engineering database designed specifically for AI agents.\n",
                encoding="utf-8",
            )

            summary = extract_readme_summary(repo_dir)

            self.assertEqual("Context engineering database designed specifically for AI agents.", summary)


class AnalyzeRepoTests(unittest.TestCase):
    def test_generates_repo_keywords_and_research_decision(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_dir = Path(tmpdir)
            package_json = {
                "name": "acme-agent",
                "scripts": {
                    "build": "tsc -p tsconfig.json",
                    "test": "vitest run",
                },
            }
            (repo_dir / "package.json").write_text(json.dumps(package_json), encoding="utf-8")
            (repo_dir / "README.md").write_text(
                "# Acme Agent\n\nAn AI agent platform with auth, realtime collaboration, and workflow automation.",
                encoding="utf-8",
            )

            analysis = analyze_repo(
                {
                    "full_name": "acme/agent-platform",
                    "description": "AI agent platform for auth and realtime automation",
                    "stars_today": 420,
                    "language": "TypeScript",
                },
                repo_dir,
            )

            self.assertEqual("research", analysis["recommended_action"])
            self.assertIn("agent", analysis["repo_keywords"])
            self.assertIn("auth", analysis["repo_keywords"])
            self.assertIn("realtime", analysis["repo_keywords"])
            self.assertNotIn("acme", analysis["repo_keywords"])
            self.assertTrue(analysis["summary"].startswith("An AI agent platform"))


class BatchKeywordTests(unittest.TestCase):
    def test_derives_keywords_from_current_trending_batch_instead_of_static_taxonomy(self) -> None:
        repos = [
            {
                "full_name": "acme/agent-ops",
                "description": "Agent automation platform for engineering teams",
                "analysis_summary": "Agent automation workflows for coding teams.",
                "repo_keywords": ["agent", "automation", "coding", "teams"],
            },
            {
                "full_name": "beta/agent-workbench",
                "description": "Agent workbench for automation and code review",
                "analysis_summary": "Automation tools for agent-assisted code review.",
                "repo_keywords": ["agent", "automation", "review", "tools"],
            },
            {
                "full_name": "gamma/docs-site",
                "description": "Documentation site generator",
                "analysis_summary": "Static docs with search.",
                "repo_keywords": ["docs", "search", "static"],
            },
        ]

        keywords = derive_batch_keywords(repos)

        self.assertIn("agent", keywords)
        self.assertIn("automation", keywords)
        self.assertNotIn("auth", keywords)


class AnalysisTaskTests(unittest.TestCase):
    def test_builds_ai_ready_analysis_task_for_each_repo(self) -> None:
        task = build_analysis_task(
            {
                "full_name": "acme/agent-ops",
                "url": "https://github.com/acme/agent-ops",
                "language": "TypeScript",
                "description": "Agent automation platform",
            },
            local_path="/tmp/repos/acme__agent-ops",
            analysis={
                "summary": "Agent automation platform for engineering teams.",
                "profile": {
                    "ecosystems": ["node"],
                    "build_commands": ["npm run build"],
                    "test_commands": ["npm test"],
                    "has_readme": True,
                },
                "repo_keywords": ["agent", "automation", "engineering"],
                "matched_batch_keywords": ["agent", "automation"],
                "recommended_action": "research",
                "reasons": ["Has README", "Has test entrypoints"],
            },
            batch_keywords=["agent", "automation"],
        )

        self.assertEqual(".prompts/system/code-extractor.md", task["system_prompt_path"])
        self.assertEqual("/tmp/repos/acme__agent-ops", task["local_path"])
        self.assertEqual("research", task["recommended_action"])
        self.assertIn("agent", task["batch_keywords"])
        self.assertIn("Use the local checkout as the source of truth.", task["operator_notes"])


if __name__ == "__main__":
    unittest.main()
