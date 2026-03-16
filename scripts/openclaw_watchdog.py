#!/usr/bin/env python3
"""Keep the OpenClaw long-run worker alive for unattended operation."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
LONG_RUN_SCRIPT = REPO_ROOT / "scripts" / "openclaw_long_run.py"
CHECK_INTERVAL_SECONDS = 30
STALE_SECONDS = 180


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_iso8601(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return None


def _process_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    proc_stat = Path(f"/proc/{pid}/stat")
    if proc_stat.exists():
        try:
            stat_fields = proc_stat.read_text(encoding="utf-8").split()
        except OSError:
            return False
        if len(stat_fields) >= 3 and stat_fields[2] == "Z":
            return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _launch_worker(
    *,
    runtime_root: Path,
    limit: int,
    sleep_seconds: int,
    language: str | None,
    cadence_order: list[str],
) -> dict[str, Any]:
    log_path = runtime_root / "worker.log"
    with log_path.open("ab") as log_handle:
        argv = [
            sys.executable,
            str(LONG_RUN_SCRIPT),
            "--runtime-root",
            str(runtime_root),
            "--forever",
            "--sleep-seconds",
            str(sleep_seconds),
            "--limit",
            str(limit),
            "--cadence-order",
            *cadence_order,
        ]
        if language:
            argv.extend(["--language", language])

        process = subprocess.Popen(
            argv,
            cwd=str(REPO_ROOT),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    return {
        "status": "started",
        "pid": process.pid,
        "started_at": _utc_now(),
        "argv": argv,
        "log_path": str(log_path),
    }


def _terminate_worker(pid: int, *, reason: str) -> dict[str, Any]:
    event = {
        "status": "terminate-requested",
        "pid": pid,
        "reason": reason,
        "requested_at": _utc_now(),
    }
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        event["status"] = "already-dead"
        return event

    deadline = time.time() + 15
    while time.time() < deadline:
        if not _process_alive(pid):
            event["status"] = "terminated"
            event["completed_at"] = _utc_now()
            return event
        time.sleep(1)

    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        event["status"] = "terminated"
    else:
        event["status"] = "killed"
    event["completed_at"] = _utc_now()
    return event


def _acquire_lock(runtime_root: Path):
    lock_path = runtime_root / "watchdog.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("w", encoding="utf-8")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def main() -> int:
    parser = argparse.ArgumentParser(description="Monitor and restart OpenClaw long-run worker.")
    parser.add_argument("--runtime-root", type=Path, default=REPO_ROOT / "runtime" / "openclaw-live")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--sleep-seconds", type=int, default=600)
    parser.add_argument("--language", default=None)
    parser.add_argument(
        "--cadence-order",
        nargs="+",
        default=["daily", "weekly", "monthly"],
        choices=["daily", "weekly", "monthly"],
    )
    parser.add_argument("--check-interval-seconds", type=int, default=CHECK_INTERVAL_SECONDS)
    parser.add_argument("--stale-seconds", type=int, default=STALE_SECONDS)
    args = parser.parse_args()

    runtime_root = args.runtime_root.resolve()
    runtime_root.mkdir(parents=True, exist_ok=True)
    lock_handle = _acquire_lock(runtime_root)
    _ = lock_handle

    watchdog_state_path = runtime_root / "watchdog.json"
    watchdog_events_path = runtime_root / "watchdog-events.jsonl"

    while True:
        worker_pid_info = _read_json(runtime_root / "worker.pid.json") or {}
        heartbeat = _read_json(runtime_root / "heartbeat.json") or {}
        state = _read_json(runtime_root / "state.json") or {}
        worker_pid = worker_pid_info.get("pid")
        heartbeat_at = _parse_iso8601(heartbeat.get("updated_at"))
        heartbeat_age = None if heartbeat_at is None else max(time.time() - heartbeat_at, 0)

        should_restart = False
        restart_reason = None

        if not _process_alive(worker_pid):
            should_restart = True
            restart_reason = "worker process missing"
        elif heartbeat_age is None:
            should_restart = True
            restart_reason = "missing heartbeat"
        elif heartbeat_age > args.stale_seconds:
            should_restart = True
            restart_reason = f"heartbeat stale for {int(heartbeat_age)}s"

        last_event: dict[str, Any] | None = None
        if should_restart:
            if _process_alive(worker_pid):
                last_event = _terminate_worker(worker_pid, reason=restart_reason or "restart requested")
                _append_jsonl(watchdog_events_path, last_event)
            last_event = _launch_worker(
                runtime_root=runtime_root,
                limit=args.limit,
                sleep_seconds=args.sleep_seconds,
                language=args.language,
                cadence_order=args.cadence_order,
            )
            last_event["reason"] = restart_reason
            _append_jsonl(watchdog_events_path, last_event)

        payload = {
            "updated_at": _utc_now(),
            "watchdog_pid": os.getpid(),
            "runtime_root": str(runtime_root),
            "check_interval_seconds": args.check_interval_seconds,
            "stale_seconds": args.stale_seconds,
            "worker_pid": worker_pid_info.get("pid"),
            "worker_started_at": worker_pid_info.get("started_at"),
            "worker_alive": _process_alive(worker_pid_info.get("pid")),
            "heartbeat": heartbeat,
            "heartbeat_age_seconds": None if heartbeat_age is None else int(heartbeat_age),
            "last_state_update": state.get("updated_at"),
            "completed_batches": state.get("completed_batches"),
            "failed_batches": state.get("failed_batches"),
            "last_event": last_event,
        }
        _write_json(watchdog_state_path, payload)
        time.sleep(args.check_interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
