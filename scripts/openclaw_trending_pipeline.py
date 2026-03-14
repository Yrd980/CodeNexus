#!/usr/bin/env python3
"""Minimal Trending -> clone/update -> analysis manifest pipeline."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TrendingRepo = dict[str, Any]
CommandRunner = Callable[[list[str], str | None], None]


def _clean_text(value: str | None) -> str | None:
    if value is None:
      return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def parse_trending_html(html: str) -> list[TrendingRepo]:
    repos: list[TrendingRepo] = []
    article_pattern = re.compile(r"<article\b[^>]*>(.*?)</article>", re.IGNORECASE | re.DOTALL)

    for article in article_pattern.findall(html):
        href_match = re.search(r'href="/([^"/]+/[^"/]+)"', article)
        if not href_match:
            continue

        description_match = re.search(r"<p\b[^>]*>(.*?)</p>", article, re.IGNORECASE | re.DOTALL)
        language_match = re.search(
            r'<span\b[^>]*itemprop="programmingLanguage"[^>]*>(.*?)</span>',
            article,
            re.IGNORECASE | re.DOTALL,
        )
        stars_today_match = re.search(r"([0-9][0-9,]*)\s+stars today", article, re.IGNORECASE)

        full_name = href_match.group(1).strip()
        repos.append(
            {
                "full_name": full_name,
                "url": f"https://github.com/{full_name}",
                "description": _clean_text(description_match.group(1) if description_match else None),
                "language": _clean_text(language_match.group(1) if language_match else None),
                "stars_today": int(stars_today_match.group(1).replace(",", ""))
                if stars_today_match
                else None,
            }
        )

    return repos


def _default_runner(argv: list[str], cwd: str | None = None) -> None:
    subprocess.run(argv, cwd=cwd, check=True)


def _repo_dir(repo: TrendingRepo, clone_root: Path) -> Path:
    return clone_root / repo["full_name"].replace("/", "__")


def clone_or_update_repo(
    repo: TrendingRepo,
    clone_root: Path,
    runner: CommandRunner | None = None,
) -> dict[str, Any]:
    runner = runner or _default_runner
    target = _repo_dir(repo, clone_root)
    clone_root.mkdir(parents=True, exist_ok=True)

    if target.exists():
        runner(["git", "-C", str(target), "fetch", "--all", "--prune"], None)
        runner(["git", "-C", str(target), "pull", "--ff-only"], None)
        status = "updated"
    else:
        runner(["git", "clone", "--depth", "1", repo["url"], str(target)], None)
        status = "cloned"

    return {"status": status, "path": str(target)}


def inspect_repo(repo_dir: Path) -> dict[str, Any]:
    ecosystems: list[str] = []
    build_commands: list[str] = []
    test_commands: list[str] = []

    package_json = repo_dir / "package.json"
    pyproject = repo_dir / "pyproject.toml"
    cargo_toml = repo_dir / "Cargo.toml"
    go_mod = repo_dir / "go.mod"

    if package_json.exists():
        ecosystems.append("node")
        parsed = json.loads(package_json.read_text(encoding="utf-8"))
        scripts = parsed.get("scripts", {})
        if "build" in scripts:
            build_commands.append("npm run build")
        if "test" in scripts:
            test_commands.append("npm test")

    if pyproject.exists():
        ecosystems.append("python")
        build_commands.append("python -m build")
        test_commands.append("pytest")

    if cargo_toml.exists():
        ecosystems.append("rust")
        build_commands.append("cargo build")
        test_commands.append("cargo test")

    if go_mod.exists():
        ecosystems.append("go")
        build_commands.append("go build ./...")
        test_commands.append("go test ./...")

    return {
        "ecosystems": ecosystems,
        "build_commands": build_commands,
        "test_commands": test_commands,
        "has_readme": any((repo_dir / name).exists() for name in ("README.md", "README.rst", "README")),
    }


def fetch_trending_html(*, since: str = "daily", language: str | None = None) -> str:
    query = {"since": since}
    if language:
        query["l"] = language
    url = f"https://github.com/trending?{urlencode(query)}"
    request = Request(
        url,
        headers={
            "User-Agent": "CodeNexus-OpenClaw-Trending-Prototype/1.0",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def run_pipeline(
    *,
    limit: int,
    clone_root: Path,
    manifest_path: Path,
    since: str = "daily",
    language: str | None = None,
    html: str | None = None,
) -> dict[str, Any]:
    html = html if html is not None else fetch_trending_html(since=since, language=language)
    repos = parse_trending_html(html)[:limit]

    results = []
    for repo in repos:
        checkout = clone_or_update_repo(repo, clone_root=clone_root)
        profile = inspect_repo(Path(checkout["path"]))
        results.append(
            {
                **repo,
                "clone_status": checkout["status"],
                "local_path": checkout["path"],
                "analysis_profile": profile,
                "extractor_prompt": ".prompts/system/code-extractor.md",
            }
        )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "github-trending",
        "since": since,
        "language": language,
        "repos": results,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch GitHub Trending repositories, clone/update them, and write an analysis manifest."
    )
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--since", default="daily", choices=["daily", "weekly", "monthly"])
    parser.add_argument("--language", default=None)
    parser.add_argument(
        "--clone-root",
        type=Path,
        default=Path(tempfile.gettempdir()) / "codenexus-openclaw-trending" / "repos",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(tempfile.gettempdir()) / "codenexus-openclaw-trending" / "analysis-manifest.json",
    )
    args = parser.parse_args()

    manifest = run_pipeline(
        limit=args.limit,
        since=args.since,
        language=args.language,
        clone_root=args.clone_root,
        manifest_path=args.manifest,
    )
    print(json.dumps({"manifest": str(args.manifest), "repos": len(manifest["repos"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
