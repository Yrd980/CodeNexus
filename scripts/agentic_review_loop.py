#!/usr/bin/env python3
"""Generate an agentic review queue for CodeNexus and selected artifacts."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_GLOBS = (
    "README.md",
    "PHILOSOPHY.md",
    "CHANGELOG.md",
    ".prompts/**/*.md",
    "scripts/*.py",
    "scripts/*.sh",
)

SCANNED_SUFFIXES = {".md", ".py", ".sh", ".yml", ".yaml", ".json", ".toml"}

PASSIVE_PATTERNS = {
    "checklist": r"\bchecklist\b",
    "checkboxes": r"\[[ xX]\]",
    "manual": r"\bmanual\b",
    "copy_paste": r"\bcopy-paste\b",
    "pass_fail": r"\bpass(?:ed|es)? all checks\b|\bpass/fail\b|\bquality gate\b",
    "todo": r"\bTODO\b",
}

LEGACY_WORLDVIEW_PATTERNS = {
    "legacy_dirs": r"\bfoundation/|\bmodules/|\bpatterns/|\bstarters/",
    "legacy_module_terms": r"\brunnable-module\b|\bmodule_path\b",
    "package_gallery": r"\bpackages/\b|\bmodule superstore\b|\bpackage warehouse\b",
    "test_gate_fields": r"\bhas_tests\b|\btests/\s+exists\b|\bquality_checklist\b",
}

TEST_THEATER_PATTERNS = {
    "happy_path": r"\bhappy path\b",
    "tests_dir": r"\btests/",
    "test_entrypoint": r"\btest_entrypoints\b",
    "test_required": r"\bmust be testable\b|\bhas_tests\b",
}

AGENTIC_PATTERNS = {
    "review_queue": r"\breview queue\b",
    "backlog": r"\bbacklog\b",
    "next_action": r"\bnext action\b|\bnext_action\b",
    "proactive": r"\bproactive\b",
    "agentic": r"\bagentic\b",
    "rewrite_archive_delete": r"\brewrite\b|\barchive\b|\bdelete\b",
    "blockers": r"\bblockers\b",
    "review_actions": r"\breview_actions\b|\bimmediate_actions\b",
    "decision_fields": r"\bblocking_decision\b|\bproof_of_value\b",
    "evidence": r"\bevidence\b",
    "runtime_truth": r"\bruntime truth\b|\bruntime_truth\b",
    "assumption_break": r"\bassumption break\b|\bassumption_break\b",
    "portability": r"\bportability\b",
    "hold": r"\bhold\b",
    "checkpoint": r"\bcheckpoint\b",
}

VERIFICATION_PATTERNS = {
    "runtime_truth": r"\bruntime truth\b|\bruntime_truth\b",
    "assumption_break": r"\bassumption break\b|\bassumption_break\b",
    "portability": r"\bportability\b",
}

STARTUP_PATTERNS = {
    "startup": r"\bstartup\b",
    "quick_start": r"\bquick start\b|\b快速使用\b|\b快速开始\b",
    "run_command": r"\b(python|python3|uv|npm|pnpm|bun|cargo|go)\s+[^\n]*\b(run|start|dev|serve|main)\b",
    "compose_up": r"\bdocker compose up\b|\bdocker-compose up\b",
}


@dataclass
class ReviewItem:
    path: str
    kind: str
    severity: str
    decision: str
    why: list[str]
    next_action: str
    signals: dict[str, Any]


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def _relpath(root: Path, path: Path) -> str:
    try:
        return str(path.resolve().relative_to(root.resolve()))
    except ValueError:
        return str(path.resolve())


def _kind_for(path: Path) -> str:
    if path.name in {"README.md", "PHILOSOPHY.md", "CHANGELOG.md"}:
        return "protocol"
    if path.suffix in {".py", ".sh"}:
        return "script"
    if path.name == "_TEMPLATE.md":
        return "template"
    if path.suffix == ".md":
        if ".prompts" in path.parts:
            return "prompt"
        return "artifact-doc"
    if path.suffix in {".yml", ".yaml", ".json", ".toml"}:
        return "metadata"
    return "artifact"


def _matched_labels(text: str, patterns: dict[str, str]) -> list[str]:
    return [label for label, pattern in patterns.items() if re.search(pattern, text, re.IGNORECASE)]


def _review_from_signals(
    *,
    rel_path: str,
    kind: str,
    passive_hits: list[str],
    legacy_hits: list[str],
    test_hits: list[str],
    agentic_hits: list[str],
    verification_hits: list[str],
    startup_hits: list[str],
) -> ReviewItem:
    why: list[str] = []
    decision = "keep"
    severity = "low"
    next_action = "Keep it in the active loop and revisit after the next protocol shift."

    if legacy_hits and test_hits and not verification_hits:
        decision = "rewrite"
        severity = "high"
        why.append("It still leaks the deleted package-gallery worldview and leans on test theater.")
        next_action = "Rewrite it around startup truth, assumption break, and portability evidence."
    elif test_hits and not verification_hits and not agentic_hits:
        decision = "rewrite"
        severity = "high"
        why.append("It treats tests as legitimacy while first-principles verification is missing.")
        next_action = "Replace test-centric gating with runtime truth and assumption-break review."
    elif passive_hits and len(passive_hits) >= 2 and not agentic_hits:
        decision = "rewrite"
        severity = "high"
        why.append("It still reads like a static checklist instead of an action-producing reviewer.")
        next_action = "Turn it into a reviewer that emits blockers, next actions, and delete/archive calls."
    elif legacy_hits and not agentic_hits:
        decision = "rewrite"
        severity = "medium"
        why.append("It still carries old directory or module assumptions that should stay deleted.")
        next_action = "Retarget it around artifacts, protocols, and active review queues."
    elif kind in {"prompt", "script", "protocol"} and not agentic_hits:
        decision = "archive"
        severity = "medium"
        why.append("It does not yet participate in proactive review flow.")
        next_action = "Archive it unless it can be connected to the agentic loop."
    else:
        why.append("It already speaks in terms of evidence, backlog, or next actions.")
        if startup_hits and verification_hits:
            why.append("It preserves a startup path without confusing tests for truth.")

    return ReviewItem(
        path=rel_path,
        kind=kind,
        severity=severity,
        decision=decision,
        why=why,
        next_action=next_action,
        signals={
            "passive_hits": passive_hits,
            "legacy_hits": legacy_hits,
            "test_theater_hits": test_hits,
            "agentic_hits": agentic_hits,
            "verification_hits": verification_hits,
            "startup_hits": startup_hits,
        },
    )


def review_file(root: Path, path: Path) -> ReviewItem:
    text = _read_text(path)
    return _review_from_signals(
        rel_path=_relpath(root, path),
        kind=_kind_for(path),
        passive_hits=_matched_labels(text, PASSIVE_PATTERNS),
        legacy_hits=_matched_labels(text, LEGACY_WORLDVIEW_PATTERNS),
        test_hits=_matched_labels(text, TEST_THEATER_PATTERNS),
        agentic_hits=_matched_labels(text, AGENTIC_PATTERNS),
        verification_hits=_matched_labels(text, VERIFICATION_PATTERNS),
        startup_hits=_matched_labels(text, STARTUP_PATTERNS),
    )


def review_directory(root: Path, directory: Path) -> ReviewItem | None:
    files = sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and path.suffix.lower() in SCANNED_SUFFIXES
    )
    if not files:
        return ReviewItem(
            path=_relpath(root, directory),
            kind="artifact",
            severity="high",
            decision="delete",
            why=["The target directory is empty, so it cannot justify attention."],
            next_action="Delete it or refill it with an actual artifact review target.",
            signals={"files": 0},
        )

    readme_path = directory / "README.md"
    readme_text = _read_text(readme_path) if readme_path.is_file() else ""
    metadata_path = next((path for path in files if path.name in {".meta.yml", ".meta.yaml"}), None)
    metadata_text = _read_text(metadata_path) if metadata_path else ""
    combined = "\n".join((readme_text, metadata_text))

    tests_dir = directory / "tests"
    startup_hits = _matched_labels(combined, STARTUP_PATTERNS)
    verification_hits = _matched_labels(combined, VERIFICATION_PATTERNS)

    why: list[str] = []
    decision = "keep"
    severity = "low"
    next_action = "Keep reviewing it as part of the next batch."

    if not readme_path.is_file():
        decision = "rewrite"
        severity = "high"
        why.append("The artifact has no README, so its value and startup path are not inspectable.")
        next_action = "Add a README that states problem, startup path, and verification boundary."
    elif not startup_hits:
        decision = "rewrite"
        severity = "high"
        why.append("The artifact does not leave a minimal runnable startup path.")
        next_action = "Document one startup command or integration path that can be executed in reality."
    elif tests_dir.exists() and not verification_hits:
        decision = "rewrite"
        severity = "high"
        why.append("There is a tests directory, but it still lacks first-principles verification notes.")
        next_action = "Do not let tests stand in for startup truth or portability evidence."
    elif not verification_hits:
        decision = "rewrite"
        severity = "high"
        why.append("The artifact does not record runtime truth, assumption break, and portability review.")
        next_action = "Add first-principles verification notes before treating it as stable."
    else:
        why.append("The artifact exposes a runnable path and verification language instead of static ceremony.")

    return ReviewItem(
        path=_relpath(root, directory),
        kind="artifact",
        severity=severity,
        decision=decision,
        why=why,
        next_action=next_action,
        signals={
            "files": len(files),
            "has_readme": readme_path.is_file(),
            "has_tests_dir": tests_dir.exists(),
            "startup_hits": startup_hits,
            "verification_hits": verification_hits,
        },
    )


def _expand_explicit_targets(root: Path, raw_targets: list[str]) -> tuple[list[Path], list[Path]]:
    file_targets: dict[str, Path] = {}
    dir_targets: dict[str, Path] = {}

    for raw_target in raw_targets:
        path = Path(raw_target)
        if not path.is_absolute():
            path = root / path
        path = path.resolve()
        if not path.exists():
            raise FileNotFoundError(f"Target does not exist: {raw_target}")
        if path.is_dir():
            dir_targets[str(path)] = path
            for child in path.rglob("*"):
                if child.is_file() and child.suffix.lower() in SCANNED_SUFFIXES:
                    file_targets[str(child.resolve())] = child.resolve()
        elif path.suffix.lower() in SCANNED_SUFFIXES:
            file_targets[str(path)] = path

    return sorted(file_targets.values()), sorted(dir_targets.values())


def _collect_default_files(root: Path) -> list[Path]:
    collected: dict[str, Path] = {}
    for pattern in DEFAULT_GLOBS:
        for path in root.glob(pattern):
            if path.is_file():
                collected[str(path.resolve())] = path.resolve()
    return sorted(collected.values())


def build_review_queue(root: Path, raw_targets: list[str]) -> dict[str, Any]:
    if raw_targets:
        file_targets, dir_targets = _expand_explicit_targets(root, raw_targets)
    else:
        file_targets = _collect_default_files(root)
        dir_targets = []

    review_items: list[ReviewItem] = []
    review_items.extend(review_directory(root, directory) for directory in dir_targets)
    review_items = [item for item in review_items if item is not None]
    review_items.extend(review_file(root, target) for target in file_targets)

    ordered = sorted(
        review_items,
        key=lambda item: (
            {"high": 0, "medium": 1, "low": 2}[item.severity],
            {"rewrite": 0, "archive": 1, "delete": 2, "keep": 3}[item.decision],
            item.path,
        ),
    )

    summary = {
        "rewrite_now": sum(1 for item in ordered if item.decision == "rewrite"),
        "archive_now": sum(1 for item in ordered if item.decision == "archive"),
        "delete_now": sum(1 for item in ordered if item.decision == "delete"),
        "keep_watching": sum(1 for item in ordered if item.decision == "keep"),
    }

    next_wave = [
        {
            "path": item.path,
            "decision": item.decision,
            "severity": item.severity,
            "next_action": item.next_action,
        }
        for item in ordered
        if item.decision != "keep"
    ][:10]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "review_prompt": ".prompts/system/agentic-reviewer.md",
        "summary": summary,
        "next_wave": next_wave,
        "findings": [
            {
                "path": item.path,
                "kind": item.kind,
                "severity": item.severity,
                "decision": item.decision,
                "why": item.why,
                "next_action": item.next_action,
                "signals": item.signals,
            }
            for item in ordered
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate an agentic review queue for CodeNexus.")
    parser.add_argument("targets", nargs="*", help="Optional file or directory targets to review.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--output", type=Path, default=Path("agentic-review-queue.json"))
    args = parser.parse_args()

    root = args.root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output
    queue = build_review_queue(root, args.targets)
    output.write_text(json.dumps(queue, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(output),
                "summary": queue["summary"],
                "reviewed_items": len(queue["findings"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
