#!/usr/bin/env python3
"""Run OpenClaw in finite batches or as a long-running agentic loop."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
TRENDING_SCRIPT = REPO_ROOT / "scripts" / "openclaw_trending_pipeline.py"
REVIEW_SCRIPT = REPO_ROOT / "scripts" / "agentic_review_loop.py"
LONG_RUN_SCRIPT = Path(__file__).resolve()
DEFAULT_CADENCE = ("daily", "weekly", "monthly")
DEFAULT_SLEEP_SECONDS = 900
HEARTBEAT_INTERVAL_SECONDS = 30


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _batch_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _trim_text(value: str, *, limit: int = 4000) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...[truncated]"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _unique_text(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def _write_pid_file(runtime_root: Path) -> None:
    payload = {
        "pid": os.getpid(),
        "started_at": _utc_now(),
        "argv": sys.argv,
    }
    _write_json(runtime_root / "worker.pid.json", payload)


def _write_heartbeat(
    runtime_root: Path,
    *,
    phase: str,
    batch_index: int | None = None,
    since: str | None = None,
    sleep_seconds: int | None = None,
    note: str | None = None,
) -> None:
    payload = {
        "pid": os.getpid(),
        "updated_at": _utc_now(),
        "phase": phase,
        "batch_index": batch_index,
        "since": since,
        "sleep_seconds": sleep_seconds,
        "note": note,
    }
    _write_json(runtime_root / "heartbeat.json", payload)


def _load_state(path: Path, cadence_order: tuple[str, ...]) -> dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "completed_batches": 0,
        "failed_batches": 0,
        "cadence_cursor": 0,
        "cadence_order": list(cadence_order),
        "last_since": None,
        "last_batch_dir": None,
        "last_checkpoint": None,
        "last_manifest": None,
        "last_review": None,
        "last_self_update": None,
        "last_error": None,
    }


def _parse_json_from_stdout(output: str) -> dict[str, Any]:
    for line in reversed([chunk.strip() for chunk in output.splitlines() if chunk.strip()]):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise ValueError(f"Could not find JSON payload in command output: {output!r}")


def _run_command(argv: list[str], *, cwd: Path) -> dict[str, Any]:
    completed = subprocess.run(
        argv,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "argv": argv,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "ok": completed.returncode == 0,
    }


def _summarize_command(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "argv": result["argv"],
        "ok": result["ok"],
        "returncode": result["returncode"],
        "stdout": _trim_text(result["stdout"]),
        "stderr": _trim_text(result["stderr"]),
    }


def _next_since(state: dict[str, Any], cadence_order: tuple[str, ...]) -> str:
    cursor = int(state.get("cadence_cursor", 0))
    return cadence_order[cursor % len(cadence_order)]


def _run_trending_batch(
    *,
    runtime_root: Path,
    clone_root: Path,
    batch_dir: Path,
    limit: int,
    since: str,
    language: str | None,
) -> tuple[dict[str, Any], dict[str, Any], Path]:
    manifest_path = batch_dir / "analysis-manifest.json"
    argv = [
        sys.executable,
        str(TRENDING_SCRIPT),
        "--limit",
        str(limit),
        "--since",
        since,
        "--clone-root",
        str(clone_root),
        "--manifest",
        str(manifest_path),
    ]
    if language:
        argv.extend(["--language", language])

    result = _run_command(argv, cwd=REPO_ROOT)
    if not result["ok"]:
        raise RuntimeError(
            "Trending pipeline failed: "
            + (_trim_text(result["stderr"]) or _trim_text(result["stdout"]) or "unknown error")
        )

    _parse_json_from_stdout(result["stdout"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    latest_manifest = runtime_root / "latest-manifest.json"
    _write_json(latest_manifest, manifest)
    return manifest, result, manifest_path


def _run_repo_review(*, runtime_root: Path, batch_dir: Path) -> tuple[dict[str, Any], dict[str, Any], Path]:
    review_path = batch_dir / "repo-review.json"
    argv = [
        sys.executable,
        str(REVIEW_SCRIPT),
        "--root",
        str(REPO_ROOT),
        "--output",
        str(review_path),
    ]
    result = _run_command(argv, cwd=REPO_ROOT)
    if not result["ok"]:
        raise RuntimeError(
            "Agentic review loop failed: "
            + (_trim_text(result["stderr"]) or _trim_text(result["stdout"]) or "unknown error")
        )

    _parse_json_from_stdout(result["stdout"])
    review = json.loads(review_path.read_text(encoding="utf-8"))
    latest_review = runtime_root / "latest-review.json"
    _write_json(latest_review, review)
    return review, result, review_path


def _healthcheck_scripts() -> dict[str, Any]:
    argv = [
        sys.executable,
        "-m",
        "py_compile",
        str(TRENDING_SCRIPT),
        str(REVIEW_SCRIPT),
        str(LONG_RUN_SCRIPT),
    ]
    result = _run_command(argv, cwd=REPO_ROOT)
    return {
        "ok": result["ok"],
        "command": _summarize_command(result),
    }


def _self_update_repo() -> dict[str, Any]:
    if not (REPO_ROOT / ".git").exists():
        return {
            "status": "skipped",
            "updated": False,
            "reason": "repo root is not a git checkout",
            "checked_at": _utc_now(),
        }

    before_result = _run_command(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT)
    if not before_result["ok"]:
        return {
            "status": "failed",
            "updated": False,
            "checked_at": _utc_now(),
            "before_head": None,
            "command": _summarize_command(before_result),
        }

    pull_result = _run_command(["git", "pull", "--ff-only"], cwd=REPO_ROOT)
    after_result = _run_command(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT)

    after_head = after_result["stdout"].strip() if after_result["ok"] else None
    before_head = before_result["stdout"].strip()
    updated = bool(after_head and after_head != before_head)

    status = "ok" if pull_result["ok"] else "failed"
    payload = {
        "status": status,
        "updated": updated,
        "checked_at": _utc_now(),
        "before_head": before_head,
        "after_head": after_head,
        "command": _summarize_command(pull_result),
    }

    if pull_result["ok"]:
        payload["healthcheck"] = _healthcheck_scripts()
    return payload


def _build_checkpoint(
    *,
    batch_index: int,
    since: str,
    runtime_root: Path,
    batch_dir: Path,
    manifest_path: Path | None,
    review_path: Path | None,
    manifest: dict[str, Any] | None,
    review: dict[str, Any] | None,
    trending_command: dict[str, Any] | None,
    review_command: dict[str, Any] | None,
    success: bool,
    error: str | None,
) -> dict[str, Any]:
    manifest = manifest or {}
    review = review or {}
    learning_backlog = manifest.get("learning_backlog", {})
    runtime_context = manifest.get("runtime_context", {})

    return {
        "generated_at": _utc_now(),
        "batch_index": batch_index,
        "success": success,
        "error": error,
        "since": since,
        "runtime_root": str(runtime_root),
        "batch_dir": str(batch_dir),
        "manifest_path": str(manifest_path) if manifest_path else None,
        "review_path": str(review_path) if review_path else None,
        "batch_summary": {
            "repo_count": len(manifest.get("repos", [])),
            "research_queue": learning_backlog.get("research_queue", []),
            "extract_queue": learning_backlog.get("extract_queue", []),
            "contribution_holds": learning_backlog.get("contribution_holds", []),
            "verification_queue": learning_backlog.get("verification_queue", []),
            "priority_candidates": learning_backlog.get("priority_candidates", []),
            "batch_keywords": manifest.get("batch_keywords", []),
            "language_mix": learning_backlog.get("language_mix", {}),
        },
        "self_review": {
            "summary": review.get("summary"),
            "next_wave": review.get("next_wave"),
        },
        "cognition_updates": learning_backlog.get("cognition_updates", []),
        "runtime_notes": runtime_context.get("long_run_notes", []),
        "commands": {
            "trending_pipeline": _summarize_command(trending_command) if trending_command else None,
            "agentic_review": _summarize_command(review_command) if review_command else None,
        },
        "next_actions": _unique_text(
            [
                item["next_step"]
                for item in learning_backlog.get("verification_queue", [])
            ][:3]
            + [
                item["next_step"]
                for item in learning_backlog.get("priority_candidates", [])
            ][:3]
            + [
                item["next_action"]
                for item in review.get("next_wave", [])
            ][:3]
        ),
    }


def _run_batch(
    *,
    batch_index: int,
    runtime_root: Path,
    clone_root: Path,
    limit: int,
    since: str,
    language: str | None,
) -> tuple[dict[str, Any], dict[str, Any] | None, dict[str, Any] | None]:
    batch_dir = runtime_root / "batches" / f"{_batch_stamp()}-{since}"
    batch_dir.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, Any] | None = None
    review: dict[str, Any] | None = None
    manifest_path: Path | None = None
    review_path: Path | None = None
    trending_command: dict[str, Any] | None = None
    review_command: dict[str, Any] | None = None

    try:
        manifest, trending_command, manifest_path = _run_trending_batch(
            runtime_root=runtime_root,
            clone_root=clone_root,
            batch_dir=batch_dir,
            limit=limit,
            since=since,
            language=language,
        )
        review, review_command, review_path = _run_repo_review(
            runtime_root=runtime_root,
            batch_dir=batch_dir,
        )
        checkpoint = _build_checkpoint(
            batch_index=batch_index,
            since=since,
            runtime_root=runtime_root,
            batch_dir=batch_dir,
            manifest_path=manifest_path,
            review_path=review_path,
            manifest=manifest,
            review=review,
            trending_command=trending_command,
            review_command=review_command,
            success=True,
            error=None,
        )
    except Exception as exc:
        checkpoint = _build_checkpoint(
            batch_index=batch_index,
            since=since,
            runtime_root=runtime_root,
            batch_dir=batch_dir,
            manifest_path=manifest_path,
            review_path=review_path,
            manifest=manifest,
            review=review,
            trending_command=trending_command,
            review_command=review_command,
            success=False,
            error=str(exc),
        )

    checkpoint_path = batch_dir / "checkpoint.json"
    _write_json(checkpoint_path, checkpoint)
    _write_json(runtime_root / "latest-checkpoint.json", checkpoint)
    checkpoint["checkpoint_path"] = str(checkpoint_path)
    return checkpoint, manifest, review


def _write_state(state_path: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = _utc_now()
    _write_json(state_path, state)


def _sleep_with_heartbeat(
    runtime_root: Path,
    *,
    total_seconds: int,
    batch_index: int,
    next_since: str,
) -> None:
    remaining = max(total_seconds, 0)
    while remaining > 0:
        step = min(HEARTBEAT_INTERVAL_SECONDS, remaining)
        _write_heartbeat(
            runtime_root,
            phase="sleeping",
            batch_index=batch_index,
            since=next_since,
            sleep_seconds=remaining,
            note="waiting for next batch",
        )
        time.sleep(step)
        remaining -= step


def _maybe_restart_after_update(update_result: dict[str, Any], *, should_continue: bool) -> None:
    if not should_continue:
        return
    if not update_result.get("updated"):
        return
    healthcheck = update_result.get("healthcheck") or {}
    if not healthcheck.get("ok"):
        return
    os.execv(sys.executable, [sys.executable, *sys.argv])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run OpenClaw in finite batches or as a long-running agentic loop."
    )
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--language", default=None)
    parser.add_argument("--runtime-root", type=Path, default=REPO_ROOT / "runtime" / "openclaw")
    parser.add_argument("--clone-root", type=Path, default=None)
    parser.add_argument("--sleep-seconds", type=int, default=DEFAULT_SLEEP_SECONDS)
    parser.add_argument("--max-batches", type=int, default=1)
    parser.add_argument("--forever", action="store_true")
    parser.add_argument(
        "--cadence-order",
        nargs="+",
        default=list(DEFAULT_CADENCE),
        choices=list(DEFAULT_CADENCE),
        help="Rotate trending windows in this order.",
    )
    parser.add_argument("--skip-self-update", action="store_true")
    args = parser.parse_args()

    runtime_root = args.runtime_root.resolve()
    clone_root = args.clone_root.resolve() if args.clone_root else runtime_root / "repos"
    cadence_order = tuple(args.cadence_order)

    runtime_root.mkdir(parents=True, exist_ok=True)
    clone_root.mkdir(parents=True, exist_ok=True)
    _write_pid_file(runtime_root)
    _write_heartbeat(runtime_root, phase="booting", note="starting long-run loop")

    state_path = runtime_root / "state.json"
    history_path = runtime_root / "checkpoints.jsonl"
    state = _load_state(state_path, cadence_order)
    state["cadence_order"] = list(cadence_order)

    batches_run = 0
    while args.forever or batches_run < args.max_batches:
        since = _next_since(state, cadence_order)
        batch_index = int(state.get("completed_batches", 0)) + int(state.get("failed_batches", 0)) + 1
        _write_heartbeat(
            runtime_root,
            phase="running-batch",
            batch_index=batch_index,
            since=since,
            note="running trending pipeline and repo review",
        )
        checkpoint, manifest, review = _run_batch(
            batch_index=batch_index,
            runtime_root=runtime_root,
            clone_root=clone_root,
            limit=args.limit,
            since=since,
            language=args.language,
        )

        state["last_since"] = since
        state["last_batch_dir"] = checkpoint["batch_dir"]
        state["last_checkpoint"] = checkpoint["checkpoint_path"]
        state["last_manifest"] = checkpoint["manifest_path"]
        state["last_review"] = checkpoint["review_path"]
        state["last_error"] = checkpoint["error"]

        if checkpoint["success"]:
            state["completed_batches"] = int(state.get("completed_batches", 0)) + 1
            state["cadence_cursor"] = int(state.get("cadence_cursor", 0)) + 1
        else:
            state["failed_batches"] = int(state.get("failed_batches", 0)) + 1

        update_result: dict[str, Any]
        if args.skip_self_update:
            update_result = {
                "status": "skipped",
                "updated": False,
                "checked_at": _utc_now(),
                "reason": "skip-self-update enabled",
            }
        else:
            update_result = _self_update_repo()

        checkpoint["post_batch_self_update"] = update_result
        state["last_self_update"] = update_result
        _write_json(Path(checkpoint["checkpoint_path"]), checkpoint)
        _write_json(runtime_root / "latest-checkpoint.json", checkpoint)
        _append_jsonl(history_path, checkpoint)
        _write_state(state_path, state)
        _write_heartbeat(
            runtime_root,
            phase="batch-complete",
            batch_index=batch_index,
            since=since,
            note="batch completed and checkpoint written",
        )

        print(
            json.dumps(
                {
                    "batch_index": batch_index,
                    "since": since,
                    "success": checkpoint["success"],
                    "checkpoint": checkpoint["checkpoint_path"],
                    "research_queue": checkpoint["batch_summary"]["research_queue"],
                    "extract_queue": checkpoint["batch_summary"]["extract_queue"],
                    "priority_candidates": checkpoint["batch_summary"]["priority_candidates"],
                    "self_review": (review or {}).get("summary"),
                    "self_update": update_result.get("status"),
                    "updated": update_result.get("updated", False),
                },
                ensure_ascii=False,
            )
        )

        batches_run += 1
        should_continue = args.forever or batches_run < args.max_batches

        if not checkpoint["success"] and not args.forever:
            _write_heartbeat(
                runtime_root,
                phase="stopped",
                batch_index=batch_index,
                since=since,
                note="exiting after failed finite batch",
            )
            return 1

        _maybe_restart_after_update(update_result, should_continue=should_continue)

        if should_continue and args.sleep_seconds > 0:
            next_since = _next_since(state, cadence_order)
            _sleep_with_heartbeat(
                runtime_root,
                total_seconds=args.sleep_seconds,
                batch_index=batch_index,
                next_since=next_since,
            )

    _write_heartbeat(runtime_root, phase="stopped", note="long-run loop exited cleanly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
