import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from openclaw_trending_pipeline import (
    clone_or_update_repo,
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


if __name__ == "__main__":
    unittest.main()
