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
STOPWORDS = {
    "about",
    "agentic",
    "align",
    "and",
    "build",
    "code",
    "for",
    "from",
    "github",
    "into",
    "open",
    "opensource",
    "open-source",
    "platform",
    "project",
    "software",
    "source",
    "system",
    "teams",
    "that",
    "the",
    "this",
    "with",
    "your",
}


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


def extract_readme_summary(repo_dir: Path) -> str | None:
    for name in ("README.md", "README.rst", "README"):
        path = repo_dir / name
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8", errors="ignore")
        paragraphs = [chunk.strip() for chunk in re.split(r"\n\s*\n", content) if chunk.strip()]
        for paragraph in paragraphs:
            if paragraph.startswith("#"):
                continue
            if paragraph.lstrip().startswith("<"):
                continue
            if "[![][" in paragraph:
                continue
            cleaned = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", paragraph)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            if re.fullmatch(r"(english|中文|japanese|español|français|deutsch)(\s*/\s*(english|中文|japanese|español|français|deutsch))+", cleaned, re.IGNORECASE):
                continue
            if cleaned:
                return cleaned
    return None


def _tokenize_keywords(*parts: str | None) -> list[str]:
    haystack = " ".join(part for part in parts if part).lower()
    tokens = re.findall(r"[a-z0-9][a-z0-9\-]{2,}", haystack)
    filtered = [
        token
        for token in tokens
        if token not in STOPWORDS and not token.isdigit() and len(token) >= 3
    ]
    ordered: list[str] = []
    seen: set[str] = set()
    for token in filtered:
        if token not in seen:
            ordered.append(token)
            seen.add(token)
    return ordered[:8]


def derive_batch_keywords(repos: list[TrendingRepo]) -> list[str]:
    counts: dict[str, int] = {}
    for repo in repos:
        repo_keywords = repo.get("repo_keywords") or _tokenize_keywords(
            repo.get("full_name"),
            repo.get("description"),
            repo.get("analysis_summary"),
        )
        for token in set(repo_keywords):
            counts[token] = counts.get(token, 0) + 1
    ranked = sorted(
        (token for token, count in counts.items() if count >= 2),
        key=lambda token: (-counts[token], token),
    )
    return ranked[:12]


def analyze_repo(
    repo: TrendingRepo,
    repo_dir: Path,
    *,
    batch_keywords: list[str] | None = None,
) -> dict[str, Any]:
    profile = inspect_repo(repo_dir)
    summary = extract_readme_summary(repo_dir) or repo.get("description")
    repo_keywords = _tokenize_keywords(
        repo.get("description"),
        summary,
        repo.get("language"),
    )
    matched_batch_keywords = [
        keyword for keyword in (batch_keywords or []) if keyword in set(repo_keywords)
    ]

    reasons: list[str] = []
    score = 0
    if repo_keywords:
        score += 1
        reasons.append(f"Repo keywords: {', '.join(repo_keywords[:4])}")
    if matched_batch_keywords:
        score += 1
        reasons.append(f"Matched batch keywords: {', '.join(matched_batch_keywords)}")
    if profile["has_readme"]:
        score += 1
        reasons.append("Has README")
    if profile["test_commands"]:
        score += 1
        reasons.append("Has test entrypoints")
    if profile["build_commands"]:
        score += 1
        reasons.append("Has build entrypoints")
    if len(profile["ecosystems"]) > 1:
        score += 1
        reasons.append("Multi-ecosystem project")
    if (repo.get("stars_today") or 0) >= 100:
        score += 1
        reasons.append("Strong trending signal")

    if score >= 4:
        recommended_action = "research"
    elif score >= 2:
        recommended_action = "extract-only"
    else:
        recommended_action = "skip"

    return {
        "summary": summary,
        "repo_keywords": repo_keywords,
        "matched_batch_keywords": matched_batch_keywords,
        "recommended_action": recommended_action,
        "reasons": reasons,
        "profile": profile,
    }


def build_analysis_task(
    repo: TrendingRepo,
    *,
    local_path: str,
    analysis: dict[str, Any],
    batch_keywords: list[str],
) -> dict[str, Any]:
    return {
        "system_prompt_path": ".prompts/system/code-extractor.md",
        "project_url": repo["url"],
        "local_path": local_path,
        "language": repo.get("language"),
        "description": repo.get("description"),
        "summary_hint": analysis.get("summary"),
        "analysis_profile": analysis.get("profile"),
        "batch_keywords": batch_keywords,
        "repo_keywords": analysis.get("repo_keywords", []),
        "recommended_action": analysis.get("recommended_action"),
        "operator_notes": [
            "Use the local checkout as the source of truth.",
            "Read code and README before drawing conclusions.",
            "Explain why this repository is trending in engineering terms, not hype terms.",
        ],
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
    seed_analyses = []
    for repo in repos:
        checkout = clone_or_update_repo(repo, clone_root=clone_root)
        seed_analysis = analyze_repo(repo, Path(checkout["path"]))
        seed_analyses.append((repo, checkout, seed_analysis))

    batch_keywords = derive_batch_keywords(
        [
            {
                **repo,
                "analysis_summary": analysis["summary"],
                "repo_keywords": analysis["repo_keywords"],
            }
            for repo, _, analysis in seed_analyses
        ]
    )

    results = []
    for repo, checkout, seed_analysis in seed_analyses:
        analysis = analyze_repo(
            repo,
            Path(checkout["path"]),
            batch_keywords=batch_keywords,
        )
        results.append(
            {
                **repo,
                "clone_status": checkout["status"],
                "local_path": checkout["path"],
                "analysis_profile": analysis["profile"],
                "analysis_summary": analysis["summary"],
                "repo_keywords": analysis["repo_keywords"],
                "matched_batch_keywords": analysis["matched_batch_keywords"],
                "recommended_action": analysis["recommended_action"],
                "analysis_reasons": analysis["reasons"],
                "extractor_prompt": ".prompts/system/code-extractor.md",
                "analysis_task": build_analysis_task(
                    repo,
                    local_path=checkout["path"],
                    analysis=analysis,
                    batch_keywords=batch_keywords,
                ),
            }
        )

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "github-trending",
        "since": since,
        "language": language,
        "batch_keywords": batch_keywords,
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
