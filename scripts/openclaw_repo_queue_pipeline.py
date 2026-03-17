#!/usr/bin/env python3
"""Manual repo queue -> repo sync -> evidence manifest pipeline."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

TrendingRepo = dict[str, Any]
CommandRunner = Callable[[list[str], str | None], None]
REPO_ROOT = Path(__file__).resolve().parent.parent

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

CURRENT_SIGNAL_DOMAINS = {
    "agent",
    "agents",
    "api",
    "assistant",
    "assistants",
    "automation",
    "browser",
    "cache",
    "claude",
    "code",
    "coding",
    "collaboration",
    "context",
    "copilot",
    "eval",
    "evaluation",
    "inference",
    "knowledge",
    "llm",
    "memory",
    "mcp",
    "model",
    "multimodal",
    "orchestration",
    "plugin",
    "plugins",
    "prompt",
    "queue",
    "rag",
    "retrieval",
    "retry",
    "session",
    "sessions",
    "tool",
    "tools",
    "workflow",
}

TRANSFERABILITY_HINTS = {
    "adapter",
    "cli",
    "client",
    "extension",
    "integration",
    "library",
    "middleware",
    "plugin",
    "plugins",
    "protocol",
    "sdk",
    "service",
    "storage",
    "sync",
    "template",
    "tooling",
    "workflow",
}

DESIGN_HINTS = {
    "cache",
    "concurrency",
    "compression",
    "config",
    "error",
    "graph",
    "index",
    "memory",
    "pipeline",
    "protocol",
    "queue",
    "reliability",
    "retry",
    "schema",
    "session",
    "state",
    "sync",
    "workflow",
}

HYPE_MARKERS = (
    "predict anything",
    "universal",
    "all-in-one",
    "ultimate",
    "best ever",
)

NOISE_MARKERS = (
    "awesome",
    "curated list",
    "roadmap",
    "tutorial",
    "course",
    "interview",
    "leetcode",
    "cheatsheet",
)

DOCKER_CONTEXT_FILES = (
    "Dockerfile",
    "Dockerfile.dev",
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    ".devcontainer/devcontainer.json",
)

EXTERNAL_SERVICE_MARKERS = {
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
}

MONOREPO_MARKERS = (
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
    "lerna.json",
)


@dataclass(frozen=True)
class RepoActionContext:
    signals: dict[str, Any]
    profile: dict[str, Any]
    has_problem_fit: bool
    has_batch_alignment: bool
    has_migration_shape: bool
    has_real_entry: bool
    has_high_signal: bool
    has_medium_signal: bool
    is_hype_only: bool
    is_noise_repo: bool


@dataclass(frozen=True)
class RepoActionRule:
    name: str
    predicate: Callable[[RepoActionContext], bool]
    decision: str


REPO_ACTION_RULES = (
    RepoActionRule(
        name="noise-repo",
        predicate=lambda ctx: ctx.is_noise_repo,
        decision="skip",
    ),
    RepoActionRule(
        name="hype-only-low-signal",
        predicate=lambda ctx: ctx.is_hype_only and ctx.signals["signal_band"] == "low",
        decision="skip",
    ),
    RepoActionRule(
        name="high-signal-real-entry",
        predicate=lambda ctx: ctx.has_high_signal and ctx.has_real_entry and (ctx.has_problem_fit or ctx.has_migration_shape),
        decision="research",
    ),
    RepoActionRule(
        name="problem-fit-real-entry",
        predicate=lambda ctx: ctx.has_problem_fit and ctx.has_real_entry,
        decision="research",
    ),
    RepoActionRule(
        name="medium-signal-real-entry",
        predicate=lambda ctx: ctx.has_medium_signal and ctx.has_real_entry and (ctx.has_problem_fit or ctx.has_migration_shape),
        decision="extract-only",
    ),
    RepoActionRule(
        name="batch-aligned-real-entry",
        predicate=lambda ctx: ctx.has_batch_alignment and ctx.has_real_entry and not ctx.is_hype_only,
        decision="extract-only",
    ),
    RepoActionRule(
        name="readme-and-transferable-shape",
        predicate=lambda ctx: (ctx.has_problem_fit or ctx.has_migration_shape)
        and ctx.signals["has_readme"]
        and not ctx.is_hype_only,
        decision="extract-only",
    ),
)


def _unique(values: list[str]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value not in seen:
            ordered.append(value)
            seen.add(value)
    return ordered


def _read_text_if_exists(path: Path) -> str | None:
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="ignore")


def _parse_manual_repo_url(raw_value: str) -> tuple[str, str] | None:
    value = raw_value.strip()
    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.netloc.lower() not in {"github.com", "www.github.com"}:
        return None

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2:
        return None
    full_name = "/".join(parts[:2])

    if full_name.endswith(".git"):
        full_name = full_name[:-4]

    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", full_name):
        return None
    return full_name, f"https://github.com/{full_name}"


def load_manual_repo_queue(queue_path: Path | None) -> list[TrendingRepo]:
    if queue_path is None:
        raise ValueError("Manual queue path is required.")
    if not queue_path.exists():
        raise FileNotFoundError(f"Manual queue does not exist: {queue_path}")

    lines = queue_path.read_text(encoding="utf-8").splitlines()

    repos_by_name: dict[str, TrendingRepo] = {}
    ordered_names: list[str] = []
    for line_number, raw_line in enumerate(lines, start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue

        parsed = _parse_manual_repo_url(stripped)
        if parsed is None:
            raise ValueError(
                f"Invalid GitHub repository URL on line {line_number} in {queue_path}: {stripped!r}"
            )

        full_name, url = parsed
        existing = repos_by_name.get(full_name)
        if existing is None:
            repos_by_name[full_name] = {
                "full_name": full_name,
                "url": url,
                "manual_queue_path": str(queue_path),
            }
            ordered_names.append(full_name)
    if not ordered_names:
        raise ValueError(f"Manual queue is empty: {queue_path}")

    return [repos_by_name[full_name] for full_name in ordered_names]


def _format_script_command(package_manager: str, script: str) -> str:
    if package_manager == "npm":
        if script == "test":
            return "npm test"
        if script == "start":
            return "npm start"
        return f"npm run {script}"
    return f"{package_manager} {script}"


def _detect_node_package_manager(repo_dir: Path, package_json: dict[str, Any]) -> str:
    package_manager = package_json.get("packageManager")
    if isinstance(package_manager, str):
        for known in ("pnpm", "yarn", "bun", "npm"):
            if package_manager.startswith(f"{known}@"):
                return known

    if (repo_dir / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (repo_dir / "yarn.lock").exists():
        return "yarn"
    if (repo_dir / "bun.lockb").exists() or (repo_dir / "bun.lock").exists():
        return "bun"
    return "npm"


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

    return {
        "status": status,
        "path": str(target),
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "sync_strategy": {
            "clone_if_missing": "git clone --depth 1 <repo> <target>",
            "refresh_if_present": ["git fetch --all --prune", "git pull --ff-only"],
        },
    }


def inspect_repo(repo_dir: Path) -> dict[str, Any]:
    ecosystems: list[str] = []
    package_managers: list[str] = []
    build_commands: list[str] = []
    test_commands: list[str] = []
    startup_commands: list[str] = []

    package_json_path = repo_dir / "package.json"
    pyproject_path = repo_dir / "pyproject.toml"
    cargo_toml_path = repo_dir / "Cargo.toml"
    go_mod_path = repo_dir / "go.mod"
    makefile_path = repo_dir / "Makefile"

    package_json: dict[str, Any] | None = None
    if package_json_path.exists():
        ecosystems.append("node")
        package_json = json.loads(package_json_path.read_text(encoding="utf-8"))
        package_manager = _detect_node_package_manager(repo_dir, package_json)
        package_managers.append(package_manager)
        scripts = package_json.get("scripts", {})
        if isinstance(scripts, dict):
            for script in ("build", "compile", "check"):
                if script in scripts:
                    build_commands.append(_format_script_command(package_manager, script))
                    break
            for script in ("test", "test:ci"):
                if script in scripts:
                    test_commands.append(_format_script_command(package_manager, script))
                    break
            for script in ("dev", "start", "serve"):
                if script in scripts:
                    startup_commands.append(_format_script_command(package_manager, script))
                    break

    pyproject_text = _read_text_if_exists(pyproject_path)
    if pyproject_text is not None:
        ecosystems.append("python")
        if "[tool.poetry]" in pyproject_text:
            package_managers.append("poetry")
        elif "[tool.uv]" in pyproject_text or (repo_dir / "uv.lock").exists():
            package_managers.append("uv")
        else:
            package_managers.append("pip")
        build_commands.append("python -m build")
        test_commands.append("pytest")
        if (repo_dir / "manage.py").exists():
            startup_commands.append("python manage.py runserver")
        elif (repo_dir / "main.py").exists():
            startup_commands.append("python main.py")
        elif (repo_dir / "app.py").exists():
            startup_commands.append("python app.py")
        elif (repo_dir / "src" / "main.py").exists():
            startup_commands.append("python src/main.py")

    if cargo_toml_path.exists():
        ecosystems.append("rust")
        package_managers.append("cargo")
        build_commands.append("cargo build")
        test_commands.append("cargo test")
        startup_commands.append("cargo run")

    if go_mod_path.exists():
        ecosystems.append("go")
        package_managers.append("go")
        build_commands.append("go build ./...")
        test_commands.append("go test ./...")
        startup_commands.append("go run .")

    makefile_text = _read_text_if_exists(makefile_path)
    if makefile_text:
        if re.search(r"(?m)^build:\s*", makefile_text):
            build_commands.append("make build")
        if re.search(r"(?m)^test:\s*", makefile_text):
            test_commands.append("make test")
        if re.search(r"(?m)^run:\s*", makefile_text):
            startup_commands.append("make run")

    has_readme = any((repo_dir / name).exists() for name in ("README.md", "README.rst", "README"))
    has_ci = (repo_dir / ".github" / "workflows").is_dir() or any(
        (repo_dir / marker).exists() for marker in (".gitlab-ci.yml", ".circleci/config.yml")
    )
    docker_files = [name for name in DOCKER_CONTEXT_FILES if (repo_dir / name).exists()]

    repo_shape = "single-package"
    if any((repo_dir / marker).exists() for marker in MONOREPO_MARKERS):
        repo_shape = "monorepo"
    elif package_json and package_json.get("workspaces"):
        repo_shape = "monorepo"

    return {
        "ecosystems": _unique(ecosystems),
        "package_managers": _unique(package_managers),
        "build_commands": _unique(build_commands),
        "test_commands": _unique(test_commands),
        "startup_commands": _unique(startup_commands),
        "docker_files": docker_files,
        "has_readme": has_readme,
        "has_ci": has_ci,
        "repo_shape": repo_shape,
        "needs_external_services": any(name in EXTERNAL_SERVICE_MARKERS for name in docker_files),
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
            if paragraph in {"---", "+++"}:
                continue
            cleaned = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", paragraph)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            if re.fullmatch(r"[-=*_`~]{3,}", cleaned):
                continue
            if re.fullmatch(
                r"(english|中文|japanese|español|français|deutsch)"
                r"(\s*/\s*(english|中文|japanese|español|français|deutsch))+",
                cleaned,
                re.IGNORECASE,
            ):
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
    return _unique(filtered)[:8]


def _find_phrase_hits(text: str, phrases: tuple[str, ...]) -> list[str]:
    lowered = text.lower()
    return [phrase for phrase in phrases if phrase in lowered]


def derive_batch_keywords(repos: list[TrendingRepo]) -> list[str]:
    counts: dict[str, int] = {}
    for repo in repos:
        repo_keywords = repo.get("repo_keywords") or _tokenize_keywords(
            repo.get("full_name"),
            repo.get("analysis_summary"),
        )
        for token in set(repo_keywords):
            counts[token] = counts.get(token, 0) + 1
    ranked = sorted(
        (token for token, count in counts.items() if count >= 2),
        key=lambda token: (-counts[token], token),
    )
    return ranked[:12]


def collect_repo_signals(
    repo: TrendingRepo,
    *,
    profile: dict[str, Any],
    summary: str | None,
    repo_keywords: list[str],
    batch_keywords: list[str] | None = None,
) -> dict[str, Any]:
    name_keywords = _tokenize_keywords(repo.get("full_name"))
    summary_keywords = _tokenize_keywords(summary)
    keyword_set = set(repo_keywords) | set(name_keywords) | set(summary_keywords)
    matched_batch_keywords = [
        keyword for keyword in (batch_keywords or []) if keyword in keyword_set
    ]
    domain_keywords = sorted(keyword_set & CURRENT_SIGNAL_DOMAINS)
    transfer_keywords = sorted(keyword_set & TRANSFERABILITY_HINTS)
    design_keywords = sorted(keyword_set & DESIGN_HINTS)
    combined_text = " ".join(
        part
        for part in (
            repo.get("full_name"),
            summary,
        )
        if part
    )
    hype_hits = _find_phrase_hits(combined_text, HYPE_MARKERS)
    noise_hits = _find_phrase_hits(combined_text, NOISE_MARKERS)

    positive_score = (
        min(len(domain_keywords), 4) * 3
        + min(len(transfer_keywords), 3) * 2
        + min(len(design_keywords), 3)
        + (2 if profile["startup_commands"] else 0)
        + (1 if profile["build_commands"] else 0)
        + (1 if profile["test_commands"] else 0)
        + (1 if profile["has_ci"] else 0)
        + (1 if summary else 0)
    )
    negative_score = (
        len(hype_hits) * 2
        + len(noise_hits) * 3
        + (2 if profile["needs_external_services"] else 0)
        + (1 if profile["repo_shape"] == "monorepo" else 0)
        + (1 if len(profile["ecosystems"]) > 1 else 0)
        + (1 if not profile["has_ci"] else 0)
        + (1 if not profile["test_commands"] else 0)
    )
    composite_score = positive_score - negative_score

    if composite_score >= 10:
        signal_band = "high"
    elif composite_score >= 6:
        signal_band = "medium"
    else:
        signal_band = "low"

    return {
        "signal_band": signal_band,
        "positive_score": positive_score,
        "negative_score": negative_score,
        "composite_score": composite_score,
        "matched_batch_keywords": matched_batch_keywords,
        "name_keywords": name_keywords,
        "summary_keywords": summary_keywords,
        "domain_keywords": domain_keywords,
        "transfer_keywords": transfer_keywords,
        "design_keywords": design_keywords,
        "hype_hits": hype_hits,
        "noise_hits": noise_hits,
        "has_startup_path": bool(profile["startup_commands"]),
        "has_build_path": bool(profile["build_commands"]),
        "has_test_path": bool(profile["test_commands"]),
        "has_ci": bool(profile["has_ci"]),
        "has_readme": bool(profile["has_readme"]),
        "needs_external_services": bool(profile["needs_external_services"]),
        "is_monorepo": profile["repo_shape"] == "monorepo",
        "is_multi_ecosystem": len(profile["ecosystems"]) > 1,
        "summary_present": bool(summary),
    }


def decide_repo_action(
    *,
    signals: dict[str, Any],
    profile: dict[str, Any],
) -> tuple[str, list[str], list[str]]:
    reasons: list[str] = []
    red_flags: list[str] = []

    if signals["domain_keywords"]:
        reasons.append(f"Touches startup-relevant domains: {', '.join(signals['domain_keywords'])}")
    if signals["matched_batch_keywords"]:
        reasons.append(f"Matches current queue themes: {', '.join(signals['matched_batch_keywords'])}")
    if signals["transfer_keywords"]:
        reasons.append(f"Shows transferable surfaces: {', '.join(signals['transfer_keywords'])}")
    if signals["design_keywords"]:
        reasons.append(f"Shows design depth hints: {', '.join(signals['design_keywords'])}")
    if signals["signal_band"] != "low":
        reasons.append(f"Signal band is {signals['signal_band']}")
    if signals["has_startup_path"]:
        reasons.append(f"Has startup path: {profile['startup_commands'][0]}")
    if signals["has_test_path"]:
        reasons.append("Has test entrypoints")
    if signals["has_ci"]:
        reasons.append("Has CI signal")
    if profile["docker_files"]:
        reasons.append(
            "Docker context found but treated only as runtime context: "
            + ", ".join(profile["docker_files"])
        )

    if not signals["has_startup_path"]:
        red_flags.append("No clear startup path detected")
    if not signals["has_test_path"]:
        red_flags.append("No clear test entrypoint detected")
    if not signals["has_ci"]:
        red_flags.append("No CI signal detected")
    if signals["needs_external_services"]:
        red_flags.append("Needs external services for realistic verification")
    if signals["is_monorepo"]:
        red_flags.append("Monorepo extraction will require boundary discipline")
    if signals["hype_hits"]:
        red_flags.append(f"Hype-heavy wording detected: {', '.join(signals['hype_hits'])}")
    if signals["noise_hits"]:
        red_flags.append(f"Noise markers detected: {', '.join(signals['noise_hits'])}")

    has_problem_fit = bool(signals["domain_keywords"])
    has_batch_alignment = bool(signals["matched_batch_keywords"])
    has_migration_shape = bool(signals["transfer_keywords"] or signals["design_keywords"])
    has_real_entry = bool(signals["has_startup_path"] or signals["has_test_path"] or signals["has_ci"])
    has_high_signal = signals["signal_band"] == "high"
    has_medium_signal = signals["signal_band"] == "medium"
    is_hype_only = bool(signals["hype_hits"]) and not (has_problem_fit or has_migration_shape)
    is_noise_repo = bool(signals["noise_hits"]) and not has_problem_fit
    context = RepoActionContext(
        signals=signals,
        profile=profile,
        has_problem_fit=has_problem_fit,
        has_batch_alignment=has_batch_alignment,
        has_migration_shape=has_migration_shape,
        has_real_entry=has_real_entry,
        has_high_signal=has_high_signal,
        has_medium_signal=has_medium_signal,
        is_hype_only=is_hype_only,
        is_noise_repo=is_noise_repo,
    )

    decision = "skip"
    for rule in REPO_ACTION_RULES:
        if rule.predicate(context):
            decision = rule.decision
            break

    return decision, reasons, red_flags


def plan_verification_backlog(
    *,
    profile: dict[str, Any],
    signals: dict[str, Any],
) -> dict[str, Any]:
    runtime_tasks: list[str] = []
    if profile["startup_commands"]:
        runtime_tasks.append(
            f"Run `{profile['startup_commands'][0]}` and capture the smallest successful startup path."
        )
    elif profile["build_commands"]:
        runtime_tasks.append(
            f"Run `{profile['build_commands'][0]}` first, then identify the real startup path."
        )
    else:
        runtime_tasks.append("Read the repo entrypoints and locate a real startup path before extracting code.")

    assumption_tasks = [
        "Remove one required config or environment variable and confirm the failure appears at the correct boundary."
    ]
    if signals["needs_external_services"]:
        assumption_tasks.append(
            "Keep external dependencies unavailable and observe whether integration failures stay explicit."
        )
    if signals["has_startup_path"] and signals["domain_keywords"]:
        assumption_tasks.append(
            "Run the smallest invalid request or invalid input path and observe whether the error contract stays honest."
        )

    portability_tasks = [
        "Check whether extracted code still imports source-project-only modules, aliases, globals, or workspace magic."
    ]
    if signals["is_monorepo"]:
        portability_tasks.append("Prove the target package still works without root-level monorepo glue.")
    if signals["is_multi_ecosystem"]:
        portability_tasks.append("Separate transferable design from language-specific glue before distilling it.")

    return {
        "runtime_truth": {"status": "todo", "tasks": runtime_tasks},
        "assumption_break": {"status": "todo", "tasks": assumption_tasks},
        "portability": {"status": "todo", "tasks": portability_tasks},
        "notes": [
            "Pseudocode is acceptable when the idea matters more than the source language syntax.",
            "Startup-facing output should still keep one runnable minimal path.",
        ],
    }


def plan_contribution_hypothesis(
    *,
    profile: dict[str, Any],
    signals: dict[str, Any],
) -> dict[str, Any]:
    candidate_focus: list[str] = []
    if profile["has_readme"] and profile["startup_commands"]:
        candidate_focus.append("Quickstart or README mismatches discovered during the first real run")
    if signals["needs_external_services"]:
        candidate_focus.append("Missing-config or dependency-down failures with misleading error boundaries")
    if profile["test_commands"]:
        candidate_focus.append("Reproducible maintainer pain supported by existing verification paths")

    return {
        "status": "hold",
        "interest_level": "candidate" if candidate_focus else "none",
        "candidate_focus": candidate_focus,
        "why": [
            "This pipeline only produces hypotheses; it does not have runtime proof yet.",
            "OpenClaw should not open outbound PRs from static inspection alone.",
        ],
        "required_evidence": [
            "Reproduce a real problem on the smallest truthful path.",
            "Explain clear user or maintainer impact.",
            "Keep the change surface narrow enough for maintainers to reason about quickly.",
        ],
        "disallowed": [
            "Numeric edge-case-only PRs without real impact",
            "Docker-only changes framed as product value",
            "Cosmetic-only renames or formatting churn",
        ],
    }


def analyze_repo(
    repo: TrendingRepo,
    repo_dir: Path,
    *,
    batch_keywords: list[str] | None = None,
) -> dict[str, Any]:
    profile = inspect_repo(repo_dir)
    summary = extract_readme_summary(repo_dir)
    repo_keywords = _tokenize_keywords(
        repo.get("full_name"),
        summary,
    )
    signals = collect_repo_signals(
        repo,
        profile=profile,
        summary=summary,
        repo_keywords=repo_keywords,
        batch_keywords=batch_keywords,
    )
    decision, reasons, red_flags = decide_repo_action(signals=signals, profile=profile)

    return {
        "summary": summary,
        "repo_keywords": repo_keywords,
        "matched_batch_keywords": signals["matched_batch_keywords"],
        "signals": signals,
        "recommended_action": decision,
        "action_reasons": reasons,
        "red_flags": red_flags,
        "profile": profile,
        "verification_backlog": plan_verification_backlog(profile=profile, signals=signals),
        "contribution_plan": plan_contribution_hypothesis(profile=profile, signals=signals),
    }


def build_analysis_task(
    repo: TrendingRepo,
    *,
    local_path: str,
    analysis: dict[str, Any],
    batch_keywords: list[str],
) -> dict[str, Any]:
    operator_notes = [
        "Use the local checkout as the source of truth.",
        "Collect facts before opinions.",
        "Explain the repository in engineering terms, not hype terms.",
        "Pseudocode is acceptable for cross-language distillation, but startup-facing output must keep one runnable path.",
        "Numeric edge cases alone are not enough reason to propose an outbound PR.",
        "Treat Docker as runtime context, not as a bonus signal.",
        "Keep outbound PRs on hold until runtime truth exists.",
    ]

    return {
        "system_prompt_path": ".prompts/system/code-extractor.md",
        "project_url": repo["url"],
        "local_path": local_path,
        "summary_hint": analysis.get("summary"),
        "analysis_profile": analysis.get("profile"),
        "signals": analysis.get("signals"),
        "verification_backlog": analysis.get("verification_backlog"),
        "contribution_plan": analysis.get("contribution_plan"),
        "batch_keywords": batch_keywords,
        "repo_keywords": analysis.get("repo_keywords", []),
        "recommended_action": analysis.get("recommended_action"),
        "operator_notes": operator_notes,
    }


def summarize_batch_growth(repos: list[dict[str, Any]], *, batch_keywords: list[str]) -> dict[str, Any]:
    language_mix = Counter(
        (
            (repo.get("analysis_profile") or {}).get("ecosystems", ["unknown"])[0]
            if (repo.get("analysis_profile") or {}).get("ecosystems")
            else "unknown"
        ).lower()
        for repo in repos
    )
    research_queue = [repo["full_name"] for repo in repos if repo["recommended_action"] == "research"]
    extract_queue = [repo["full_name"] for repo in repos if repo["recommended_action"] == "extract-only"]
    contribution_holds = [
        repo["full_name"]
        for repo in repos
        if repo["contribution_plan"]["interest_level"] == "candidate"
    ]

    prioritized = sorted(
        (repo for repo in repos if repo["recommended_action"] != "skip"),
        key=lambda repo: (
            0 if repo["recommended_action"] == "research" else 1,
            {"high": 0, "medium": 1, "low": 2}[repo["signals"]["signal_band"]],
            -repo["signals"]["composite_score"],
            repo["full_name"],
        ),
    )

    verification_queue = []
    for repo in prioritized:
        if repo["recommended_action"] == "skip":
            continue
        runtime_tasks = repo["verification_backlog"]["runtime_truth"]["tasks"]
        verification_queue.append(
            {
                "full_name": repo["full_name"],
                "next_step": runtime_tasks[0],
            }
        )

    priority_candidates = [
        {
            "full_name": repo["full_name"],
            "recommended_action": repo["recommended_action"],
            "why": repo["action_reasons"][:3],
            "next_step": repo["verification_backlog"]["runtime_truth"]["tasks"][0],
        }
        for repo in prioritized
    ][:5]

    return {
        "batch_keywords": batch_keywords,
        "language_mix": dict(language_mix),
        "research_queue": research_queue,
        "extract_queue": extract_queue,
        "contribution_holds": contribution_holds,
        "verification_queue": verification_queue[:5],
        "priority_candidates": priority_candidates,
        "cognition_updates": [
            "A manual queue is only a discovery input, not proof of value.",
            "Evidence and actions should be separated; do not smuggle opinions in as fake precision.",
            "Docker files only describe runtime context, not repository quality.",
            "Outbound PRs stay on hold until runtime truth exists.",
        ],
    }


def build_runtime_context(
    *,
    clone_root: Path,
    manifest_path: Path,
    manual_queue_path: Path | None,
    repo_count: int,
) -> dict[str, Any]:
    return {
        "mode": "batch-checkpoint",
        "clone_root": str(clone_root),
        "manifest_path": str(manifest_path),
        "discovery_mode": "manual-only",
        "manual_queue": {
            "path": str(manual_queue_path) if manual_queue_path else None,
            "repo_count": repo_count,
        },
        "repo_sync": {
            "if_missing": "git clone --depth 1 <repo> <target>",
            "if_present": ["git fetch --all --prune", "git pull --ff-only"],
        },
        "self_update": {
            "timing": "between batches only",
            "command": "git pull --ff-only",
            "healthcheck": (
                "python -m py_compile "
                "scripts/openclaw_repo_queue_pipeline.py "
                "scripts/agentic_review_loop.py "
                "scripts/openclaw_long_run.py"
            ),
        },
        "long_run_notes": [
            "Checkpoint after each finite batch so a 24h runner can resume safely.",
            "Refresh repositories with fast-forward pulls instead of recloning blindly.",
            "Update prompts and code between batches, not mid-analysis.",
        ],
    }


def build_blocked_verification_backlog(sync_error: str) -> dict[str, Any]:
    return {
        "runtime_truth": {
            "status": "blocked",
            "tasks": [
                "Retry repository sync before claiming any runtime truth.",
            ],
        },
        "assumption_break": {
            "status": "blocked",
            "tasks": [
                "Do not design assumption-break checks until the repository can be cloned or updated.",
            ],
        },
        "portability": {
            "status": "blocked",
            "tasks": [
                "Portability review is blocked because the source tree is unavailable.",
            ],
        },
        "notes": [
            f"Sync failed: {sync_error}",
        ],
    }


def build_blocked_contribution_hypothesis(sync_error: str) -> dict[str, Any]:
    return {
        "status": "hold",
        "interest_level": "none",
        "candidate_focus": [],
        "why": [
            "Repository sync failed, so there is no evidence base for a contribution hypothesis.",
            f"Sync failure: {sync_error}",
        ],
        "required_evidence": [
            "Successfully clone or update the repository first.",
            "Only evaluate contribution value after runtime facts exist.",
        ],
        "disallowed": [
            "Do not guess PR opportunities from a broken or partial checkout.",
        ],
    }


def run_pipeline(
    *,
    clone_root: Path,
    manifest_path: Path,
    manual_queue_path: Path | None = None,
) -> dict[str, Any]:
    manual_repos = load_manual_repo_queue(manual_queue_path)
    repos = list(manual_repos)

    results: list[dict[str, Any]] = []
    seed_analyses: list[tuple[TrendingRepo, dict[str, Any], dict[str, Any]]] = []
    for repo in repos:
        try:
            checkout = clone_or_update_repo(repo, clone_root=clone_root)
            seed_analysis = analyze_repo(repo, Path(checkout["path"]))
            seed_analyses.append((repo, checkout, seed_analysis))
        except Exception as exc:
            sync_error = str(exc)
            blocked_keywords = _tokenize_keywords(
                repo.get("full_name"),
                sync_error,
            )
            results.append(
                {
                    **repo,
                    "clone_status": "failed",
                    "sync_strategy": {
                        "clone_if_missing": "git clone --depth 1 <repo> <target>",
                        "refresh_if_present": ["git fetch --all --prune", "git pull --ff-only"],
                    },
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                    "local_path": None,
                    "sync_error": sync_error,
                    "analysis_profile": None,
                    "analysis_summary": None,
                    "signals": {
                        "sync_ok": False,
                    },
                    "repo_keywords": blocked_keywords,
                    "matched_batch_keywords": [],
                    "recommended_action": "skip",
                    "action_reasons": [
                        "Repository sync failed before analysis, so this batch cannot produce evidence.",
                    ],
                    "analysis_red_flags": [f"Sync failed: {sync_error}"],
                    "verification_backlog": build_blocked_verification_backlog(sync_error),
                    "contribution_plan": build_blocked_contribution_hypothesis(sync_error),
                    "extractor_prompt": ".prompts/system/code-extractor.md",
                    "analysis_task": None,
                }
            )

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

    for repo, checkout, _seed_analysis in seed_analyses:
        analysis = analyze_repo(
            repo,
            Path(checkout["path"]),
            batch_keywords=batch_keywords,
        )
        results.append(
            {
                **repo,
                "clone_status": checkout["status"],
                "sync_strategy": checkout["sync_strategy"],
                "synced_at": checkout["synced_at"],
                "local_path": checkout["path"],
                "analysis_profile": analysis["profile"],
                "analysis_summary": analysis["summary"],
                "signals": analysis["signals"],
                "repo_keywords": analysis["repo_keywords"],
                "matched_batch_keywords": analysis["matched_batch_keywords"],
                "recommended_action": analysis["recommended_action"],
                "action_reasons": analysis["action_reasons"],
                "analysis_red_flags": analysis["red_flags"],
                "verification_backlog": analysis["verification_backlog"],
                "contribution_plan": analysis["contribution_plan"],
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
        "source": "manual-queue",
        "batch_keywords": batch_keywords,
        "manual_queue": {
            "path": str(manual_queue_path) if manual_queue_path else None,
            "repo_count": len(manual_repos),
        },
        "runtime_context": build_runtime_context(
            clone_root=clone_root,
            manifest_path=manifest_path,
            manual_queue_path=manual_queue_path,
            repo_count=len(manual_repos),
        ),
        "learning_backlog": summarize_batch_growth(results, batch_keywords=batch_keywords),
        "repos": results,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read the manual repo queue, sync repos locally, and write an evidence manifest."
    )
    parser.add_argument(
        "--clone-root",
        type=Path,
        default=REPO_ROOT / "runtime" / "openclaw" / "repos",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=REPO_ROOT / "runtime" / "openclaw" / "latest-manifest.json",
    )
    parser.add_argument(
        "--manual-queue",
        type=Path,
        default=REPO_ROOT / "MANUAL_REPO_QUEUE.md",
        help="Plain-text file with one GitHub repository URL per line.",
    )
    args = parser.parse_args()

    manifest = run_pipeline(
        clone_root=args.clone_root,
        manifest_path=args.manifest,
        manual_queue_path=args.manual_queue,
    )
    print(json.dumps({"manifest": str(args.manifest), "repos": len(manifest["repos"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
