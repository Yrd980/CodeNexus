#!/usr/bin/env python3
"""Run OpenClaw in finite batches or as a long-running agentic loop."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from payload_models import (
    CheckpointBatchSummary,
    CheckpointCommands,
    CheckpointPayload,
    CheckpointRuntimeVerification,
    CheckpointSelfReview,
)

from script_support import DEFAULT_JSON_STORE, RuntimePaths, trim_text, utc_now

REPO_ROOT = Path(__file__).resolve().parent.parent
QUEUE_PIPELINE_SCRIPT = REPO_ROOT / "scripts" / "openclaw_repo_queue_pipeline.py"
REVIEW_SCRIPT = REPO_ROOT / "scripts" / "agentic_review_loop.py"
RUNTIME_VERIFIER_SCRIPT = REPO_ROOT / "scripts" / "openclaw_runtime_verifier.py"
LONG_RUN_SCRIPT = Path(__file__).resolve()
DEFAULT_SLEEP_SECONDS = 900
HEARTBEAT_INTERVAL_SECONDS = 30

_JSON_STORE = DEFAULT_JSON_STORE


def _utc_now() -> str:
    return utc_now()


def _batch_stamp() -> str:
    return datetime.fromisoformat(_utc_now()).strftime("%Y%m%dT%H%M%SZ")


def _trim_text(value: str, *, limit: int = 4000) -> str:
    return trim_text(value, limit=limit)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    _JSON_STORE.write(path, payload)


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    _JSON_STORE.append_jsonl(path, payload)


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
    runtime_paths = RuntimePaths(runtime_root)
    payload = {
        "pid": os.getpid(),
        "started_at": _utc_now(),
        "argv": sys.argv,
    }
    _write_json(runtime_paths.worker_pid_json, payload)


def _write_heartbeat(
    runtime_root: Path,
    *,
    phase: str,
    batch_index: int | None = None,
    sleep_seconds: int | None = None,
    note: str | None = None,
) -> None:
    runtime_paths = RuntimePaths(runtime_root)
    payload = {
        "pid": os.getpid(),
        "updated_at": _utc_now(),
        "phase": phase,
        "batch_index": batch_index,
        "sleep_seconds": sleep_seconds,
        "note": note,
    }
    _write_json(runtime_paths.heartbeat_json, payload)


@dataclass(frozen=True)
class HeartbeatSpec:
    runtime_root: Path
    phase: str
    batch_index: int | None = None
    sleep_seconds: int | None = None
    note: str | None = None

    def emit(self) -> None:
        _write_heartbeat(
            self.runtime_root,
            phase=self.phase,
            batch_index=self.batch_index,
            sleep_seconds=self.sleep_seconds,
            note=self.note,
        )


class CommandRunner:
    """Command pattern for shell steps with an optional heartbeat strategy."""

    def __init__(self, *, heartbeat_interval_seconds: int) -> None:
        self.heartbeat_interval_seconds = max(1, heartbeat_interval_seconds)

    def run(
        self,
        argv: list[str],
        *,
        cwd: Path,
        heartbeat: HeartbeatSpec | None = None,
    ) -> dict[str, Any]:
        if heartbeat is None:
            return self._run_once(argv, cwd=cwd)
        return self._run_with_heartbeat(argv, cwd=cwd, heartbeat=heartbeat)

    def _run_once(self, argv: list[str], *, cwd: Path) -> dict[str, Any]:
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

    def _run_with_heartbeat(
        self,
        argv: list[str],
        *,
        cwd: Path,
        heartbeat: HeartbeatSpec,
    ) -> dict[str, Any]:
        process = subprocess.Popen(
            argv,
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        while True:
            try:
                stdout, stderr = process.communicate(timeout=self.heartbeat_interval_seconds)
                break
            except subprocess.TimeoutExpired:
                heartbeat.emit()
        return {
            "argv": argv,
            "returncode": process.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "ok": process.returncode == 0,
        }


def _load_state(path: Path) -> dict[str, Any]:
    if path.exists():
        state = json.loads(path.read_text(encoding="utf-8"))
        state.pop("cadence_cursor", None)
        state.pop("cadence_order", None)
        state.pop("last_since", None)
        return state
    return {
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "completed_batches": 0,
        "failed_batches": 0,
        "last_batch_dir": None,
        "last_checkpoint": None,
        "last_manifest": None,
        "last_review": None,
        "last_runtime_verification": None,
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


def _run_command(
    argv: list[str],
    *,
    cwd: Path,
    heartbeat: HeartbeatSpec | None = None,
) -> dict[str, Any]:
    runner = CommandRunner(heartbeat_interval_seconds=HEARTBEAT_INTERVAL_SECONDS)
    return runner.run(argv, cwd=cwd, heartbeat=heartbeat)


@dataclass
class StageExecution:
    payload: dict[str, Any]
    command_result: dict[str, Any]
    output_path: Path


@dataclass
class BatchStageContext:
    batch_index: int
    runtime_root: Path
    runtime_paths: RuntimePaths
    clone_root: Path
    manual_queue_path: Path | None
    batch_dir: Path
    stage_results: dict[str, StageExecution]


@dataclass(frozen=True)
class BatchStage:
    name: str
    phase: str
    note: str
    output_filename: str
    failure_label: str
    build_argv: Callable[[BatchStageContext, Path], list[str]]
    latest_output_path: Callable[[RuntimePaths], Path]


def _summarize_command(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "argv": result["argv"],
        "ok": result["ok"],
        "returncode": result["returncode"],
        "stdout": _trim_text(result["stdout"]),
        "stderr": _trim_text(result["stderr"]),
    }


def _build_repo_queue_stage_argv(context: BatchStageContext, output_path: Path) -> list[str]:
    argv = [
        sys.executable,
        str(QUEUE_PIPELINE_SCRIPT),
        "--clone-root",
        str(context.clone_root),
        "--manifest",
        str(output_path),
    ]
    if context.manual_queue_path is not None:
        argv.extend(["--manual-queue", str(context.manual_queue_path)])
    return argv


def _build_review_stage_argv(context: BatchStageContext, output_path: Path) -> list[str]:
    return [
        sys.executable,
        str(REVIEW_SCRIPT),
        "--root",
        str(REPO_ROOT),
        "--output",
        str(output_path),
    ]


def _build_runtime_verifier_stage_argv(context: BatchStageContext, output_path: Path) -> list[str]:
    manifest_stage = context.stage_results["repo_queue"]
    return [
        sys.executable,
        str(RUNTIME_VERIFIER_SCRIPT),
        "--manifest",
        str(manifest_stage.output_path),
        "--runtime-root",
        str(context.runtime_root),
        "--output",
        str(output_path),
        "--repo-limit",
        "2",
        "--cooldown-hours",
        "12",
    ]


BATCH_STAGES = (
    BatchStage(
        name="repo_queue",
        phase="syncing-repo-queue",
        note="syncing repository queue and facts",
        output_filename="analysis-manifest.json",
        failure_label="Repository queue pipeline",
        build_argv=_build_repo_queue_stage_argv,
        latest_output_path=lambda paths: paths.latest_manifest_json,
    ),
    BatchStage(
        name="review",
        phase="reviewing-protocol",
        note="running agentic review on prompts and scripts",
        output_filename="repo-review.json",
        failure_label="Agentic review loop",
        build_argv=_build_review_stage_argv,
        latest_output_path=lambda paths: paths.latest_review_json,
    ),
    BatchStage(
        name="runtime_verification",
        phase="verifying-runtime-truth",
        note="executing top candidate startup paths",
        output_filename="runtime-verification.json",
        failure_label="Runtime verifier",
        build_argv=_build_runtime_verifier_stage_argv,
        latest_output_path=lambda paths: paths.latest_runtime_verification_json,
    ),
)


def _execute_batch_stage(stage: BatchStage, context: BatchStageContext) -> StageExecution:
    output_path = context.batch_dir / stage.output_filename
    result = _run_command(
        stage.build_argv(context, output_path),
        cwd=REPO_ROOT,
        heartbeat=HeartbeatSpec(
            runtime_root=context.runtime_root,
            phase=stage.phase,
            batch_index=context.batch_index,
            note=stage.note,
        ),
    )
    if not result["ok"]:
        raise RuntimeError(
            f"{stage.failure_label} failed: "
            + (_trim_text(result["stderr"]) or _trim_text(result["stdout"]) or "unknown error")
        )

    _parse_json_from_stdout(result["stdout"])
    payload = json.loads(output_path.read_text(encoding="utf-8"))
    _write_json(stage.latest_output_path(context.runtime_paths), payload)
    execution = StageExecution(payload=payload, command_result=result, output_path=output_path)
    context.stage_results[stage.name] = execution
    return execution


def _healthcheck_scripts(
    *,
    runtime_root: Path | None = None,
    batch_index: int | None = None,
) -> dict[str, Any]:
    argv = [
        sys.executable,
        "-m",
        "py_compile",
        str(QUEUE_PIPELINE_SCRIPT),
        str(REVIEW_SCRIPT),
        str(RUNTIME_VERIFIER_SCRIPT),
        str(LONG_RUN_SCRIPT),
    ]
    heartbeat = None
    if runtime_root is not None:
        heartbeat = HeartbeatSpec(
            runtime_root=runtime_root,
            phase="post-update-healthcheck",
            batch_index=batch_index,
            note="running syntax healthcheck after self-update",
        )
    result = _run_command(argv, cwd=REPO_ROOT, heartbeat=heartbeat)
    return {
        "ok": result["ok"],
        "command": _summarize_command(result),
    }


def _self_update_repo(
    *,
    runtime_root: Path | None = None,
    batch_index: int | None = None,
) -> dict[str, Any]:
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

    heartbeat = None
    if runtime_root is not None:
        heartbeat = HeartbeatSpec(
            runtime_root=runtime_root,
            phase="self-updating",
            batch_index=batch_index,
            note="pulling latest repo changes",
        )

    pull_result = _run_command(["git", "pull", "--ff-only"], cwd=REPO_ROOT, heartbeat=heartbeat)
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
        payload["healthcheck"] = _healthcheck_scripts(
            runtime_root=runtime_root,
            batch_index=batch_index,
        )
    return payload


def _build_checkpoint(
    *,
    batch_index: int,
    runtime_root: Path,
    batch_dir: Path,
    stage_results: dict[str, StageExecution],
    success: bool,
    error: str | None,
) -> CheckpointPayload:
    manifest_stage = stage_results.get("repo_queue")
    review_stage = stage_results.get("review")
    verification_stage = stage_results.get("runtime_verification")
    manifest = manifest_stage.payload if manifest_stage else {}
    review = review_stage.payload if review_stage else {}
    verification = verification_stage.payload if verification_stage else {}
    learning_backlog = manifest.get("learning_backlog", {})
    runtime_context = manifest.get("runtime_context", {})
    verification_results = verification.get("results", [])
    next_actions = _unique_text(
        [action for item in verification_results[:3] for action in item.get("immediate_actions", [])[:2]]
        + [item["next_step"] for item in learning_backlog.get("verification_queue", [])][:3]
        + [item["next_step"] for item in learning_backlog.get("priority_candidates", [])][:3]
        + [item["next_action"] for item in review.get("next_wave", [])][:3]
    )

    batch_summary: CheckpointBatchSummary = {
        "repo_count": len(manifest.get("repos", [])),
        "research_queue": learning_backlog.get("research_queue", []),
        "extract_queue": learning_backlog.get("extract_queue", []),
        "contribution_holds": learning_backlog.get("contribution_holds", []),
        "verification_queue": learning_backlog.get("verification_queue", []),
        "priority_candidates": learning_backlog.get("priority_candidates", []),
        "batch_keywords": manifest.get("batch_keywords", []),
        "language_mix": learning_backlog.get("language_mix", {}),
    }
    self_review: CheckpointSelfReview = {
        "summary": review.get("summary"),
        "next_wave": review.get("next_wave"),
    }
    runtime_verification: CheckpointRuntimeVerification = {
        "summary": verification.get("summary"),
        "top_results": [
            {
                "full_name": item["full_name"],
                "runtime_status": item["runtime_truth"]["status"],
                "overall_assessment": item["overall_assessment"],
                "blocking_decision": item["blocking_decision"],
            }
            for item in verification_results[:5]
        ],
    }
    commands: CheckpointCommands = {
        "repo_queue_pipeline": _summarize_command(manifest_stage.command_result) if manifest_stage else None,
        "agentic_review": _summarize_command(review_stage.command_result) if review_stage else None,
        "runtime_verifier": _summarize_command(verification_stage.command_result) if verification_stage else None,
    }

    return {
        "generated_at": _utc_now(),
        "batch_index": batch_index,
        "success": success,
        "error": error,
        "runtime_root": str(runtime_root),
        "batch_dir": str(batch_dir),
        "manifest_path": str(manifest_stage.output_path) if manifest_stage else None,
        "review_path": str(review_stage.output_path) if review_stage else None,
        "runtime_verification_path": str(verification_stage.output_path) if verification_stage else None,
        "batch_summary": batch_summary,
        "self_review": self_review,
        "runtime_verification": runtime_verification,
        "cognition_updates": learning_backlog.get("cognition_updates", []),
        "runtime_notes": runtime_context.get("long_run_notes", []),
        "commands": commands,
        "next_actions": next_actions,
    }


def _run_batch(
    *,
    batch_index: int,
    runtime_root: Path,
    clone_root: Path,
    manual_queue_path: Path | None,
) -> tuple[CheckpointPayload, dict[str, Any] | None, dict[str, Any] | None]:
    runtime_paths = RuntimePaths(runtime_root)
    batch_dir = runtime_paths.batch_dir(_batch_stamp())
    batch_dir.mkdir(parents=True, exist_ok=True)

    stage_context = BatchStageContext(
        batch_index=batch_index,
        runtime_root=runtime_root,
        runtime_paths=runtime_paths,
        clone_root=clone_root,
        manual_queue_path=manual_queue_path,
        batch_dir=batch_dir,
        stage_results={},
    )

    try:
        for stage in BATCH_STAGES:
            _write_heartbeat(
                runtime_root,
                phase=stage.phase,
                batch_index=batch_index,
                note=stage.note,
            )
            _execute_batch_stage(stage, stage_context)
        checkpoint = _build_checkpoint(
            batch_index=batch_index,
            runtime_root=runtime_root,
            batch_dir=batch_dir,
            stage_results=stage_context.stage_results,
            success=True,
            error=None,
        )
    except Exception as exc:
        checkpoint = _build_checkpoint(
            batch_index=batch_index,
            runtime_root=runtime_root,
            batch_dir=batch_dir,
            stage_results=stage_context.stage_results,
            success=False,
            error=str(exc),
        )

    checkpoint_path = batch_dir / "checkpoint.json"
    _write_json(checkpoint_path, checkpoint)
    _write_json(runtime_paths.latest_checkpoint_json, checkpoint)
    checkpoint["checkpoint_path"] = str(checkpoint_path)
    manifest = stage_context.stage_results.get("repo_queue")
    review = stage_context.stage_results.get("review")
    return checkpoint, (manifest.payload if manifest else None), (review.payload if review else None)


def _write_state(state_path: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = _utc_now()
    _write_json(state_path, state)


def _sleep_with_heartbeat(
    runtime_root: Path,
    *,
    total_seconds: int,
    batch_index: int,
) -> None:
    remaining = max(total_seconds, 0)
    while remaining > 0:
        step = min(HEARTBEAT_INTERVAL_SECONDS, remaining)
        _write_heartbeat(
            runtime_root,
            phase="sleeping",
            batch_index=batch_index,
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
    parser.add_argument("--runtime-root", type=Path, default=REPO_ROOT / "runtime" / "openclaw")
    parser.add_argument("--clone-root", type=Path, default=None)
    parser.add_argument("--manual-queue", type=Path, default=REPO_ROOT / "MANUAL_REPO_QUEUE.md")
    parser.add_argument("--sleep-seconds", type=int, default=DEFAULT_SLEEP_SECONDS)
    parser.add_argument("--max-batches", type=int, default=1)
    parser.add_argument("--forever", action="store_true")
    parser.add_argument("--skip-self-update", action="store_true")
    args = parser.parse_args()

    runtime_root = args.runtime_root.resolve()
    clone_root = args.clone_root.resolve() if args.clone_root else runtime_root / "repos"
    manual_queue_path = args.manual_queue.resolve() if args.manual_queue else None
    runtime_paths = RuntimePaths(runtime_root)

    runtime_root.mkdir(parents=True, exist_ok=True)
    clone_root.mkdir(parents=True, exist_ok=True)
    _write_pid_file(runtime_root)
    _write_heartbeat(runtime_root, phase="booting", note="starting long-run loop")

    state_path = runtime_paths.state_json
    history_path = runtime_paths.checkpoints_jsonl
    state = _load_state(state_path)

    batches_run = 0
    while args.forever or batches_run < args.max_batches:
        batch_index = int(state.get("completed_batches", 0)) + int(state.get("failed_batches", 0)) + 1
        _write_heartbeat(
            runtime_root,
            phase="running-batch",
            batch_index=batch_index,
            note="running repository queue, review, and runtime verification",
        )
        checkpoint, manifest, review = _run_batch(
            batch_index=batch_index,
            runtime_root=runtime_root,
            clone_root=clone_root,
            manual_queue_path=manual_queue_path,
        )

        state["last_batch_dir"] = checkpoint["batch_dir"]
        state["last_checkpoint"] = checkpoint["checkpoint_path"]
        state["last_manifest"] = checkpoint["manifest_path"]
        state["last_review"] = checkpoint["review_path"]
        state["last_runtime_verification"] = checkpoint["runtime_verification_path"]
        state["last_error"] = checkpoint["error"]

        if checkpoint["success"]:
            state["completed_batches"] = int(state.get("completed_batches", 0)) + 1
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
            update_result = _self_update_repo(
                runtime_root=runtime_root,
                batch_index=batch_index,
            )

        checkpoint["post_batch_self_update"] = update_result
        state["last_self_update"] = update_result
        _write_json(Path(checkpoint["checkpoint_path"]), checkpoint)
        _write_json(runtime_paths.latest_checkpoint_json, checkpoint)
        _append_jsonl(history_path, checkpoint)
        _write_state(state_path, state)
        _write_heartbeat(
            runtime_root,
            phase="batch-complete",
            batch_index=batch_index,
            note="batch completed and checkpoint written",
        )

        print(
            json.dumps(
                {
                    "batch_index": batch_index,
                    "success": checkpoint["success"],
                    "checkpoint": checkpoint["checkpoint_path"],
                    "research_queue": checkpoint["batch_summary"]["research_queue"],
                    "extract_queue": checkpoint["batch_summary"]["extract_queue"],
                    "priority_candidates": checkpoint["batch_summary"]["priority_candidates"],
                    "runtime_verification": checkpoint["runtime_verification"]["summary"],
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
                note="exiting after failed finite batch",
            )
            return 1

        _maybe_restart_after_update(update_result, should_continue=should_continue)

        if should_continue and args.sleep_seconds > 0:
            _sleep_with_heartbeat(
                runtime_root,
                total_seconds=args.sleep_seconds,
                batch_index=batch_index,
            )

    _write_heartbeat(runtime_root, phase="stopped", note="long-run loop exited cleanly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
