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
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from script_support import DEFAULT_JSON_STORE, DEFAULT_PROCESS_GROUP_CONTROLLER, RuntimePaths, utc_now

REPO_ROOT = Path(__file__).resolve().parent.parent
LONG_RUN_SCRIPT = REPO_ROOT / "scripts" / "openclaw_long_run.py"
CHECK_INTERVAL_SECONDS = 30
STALE_SECONDS = 180

_JSON_STORE = DEFAULT_JSON_STORE
_PROCESS_GROUPS = DEFAULT_PROCESS_GROUP_CONTROLLER


def _utc_now() -> str:
    return utc_now()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    _JSON_STORE.write(path, payload)


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    _JSON_STORE.append_jsonl(path, payload)


def _read_json(path: Path) -> dict[str, Any] | None:
    return _JSON_STORE.read(path)


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


@dataclass(frozen=True)
class WorkerSnapshot:
    pid: int | None
    started_at: str | None
    heartbeat: dict[str, Any]
    state: dict[str, Any]
    heartbeat_age_seconds: float | None


@dataclass(frozen=True)
class RestartDecision:
    should_restart: bool
    reason: str | None = None


def _build_worker_snapshot(runtime_root: Path) -> WorkerSnapshot:
    runtime_paths = RuntimePaths(runtime_root)
    worker_pid_info = _read_json(runtime_paths.worker_pid_json) or {}
    heartbeat = _read_json(runtime_paths.heartbeat_json) or {}
    state = _read_json(runtime_paths.state_json) or {}
    heartbeat_at = _parse_iso8601(heartbeat.get("updated_at"))
    heartbeat_age = None if heartbeat_at is None else max(time.time() - heartbeat_at, 0)
    return WorkerSnapshot(
        pid=worker_pid_info.get("pid"),
        started_at=worker_pid_info.get("started_at"),
        heartbeat=heartbeat,
        state=state,
        heartbeat_age_seconds=heartbeat_age,
    )


def _decide_restart(snapshot: WorkerSnapshot, *, stale_seconds: int) -> RestartDecision:
    if not _process_alive(snapshot.pid):
        return RestartDecision(True, "worker process missing")
    if snapshot.heartbeat_age_seconds is None:
        return RestartDecision(True, "missing heartbeat")
    if snapshot.heartbeat_age_seconds > stale_seconds:
        return RestartDecision(True, f"heartbeat stale for {int(snapshot.heartbeat_age_seconds)}s")
    return RestartDecision(False, None)


def _launch_worker(
    *,
    runtime_root: Path,
    sleep_seconds: int,
    manual_queue_path: Path | None,
) -> dict[str, Any]:
    runtime_paths = RuntimePaths(runtime_root)
    log_path = runtime_paths.worker_log
    with log_path.open("ab") as log_handle:
        argv = [
            sys.executable,
            str(LONG_RUN_SCRIPT),
            "--runtime-root",
            str(runtime_root),
            "--forever",
            "--sleep-seconds",
            str(sleep_seconds),
        ]
        if manual_queue_path is not None:
            argv.extend(["--manual-queue", str(manual_queue_path)])

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
    event["status"] = _PROCESS_GROUPS.terminate_pid_group(
        pid,
        is_alive=_process_alive,
        grace_seconds=15,
        poll_interval_seconds=1,
    )
    event["completed_at"] = _utc_now()
    return event


def _acquire_lock(runtime_root: Path):
    lock_path = RuntimePaths(runtime_root).watchdog_lock
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("w", encoding="utf-8")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def main() -> int:
    parser = argparse.ArgumentParser(description="Monitor and restart OpenClaw long-run worker.")
    parser.add_argument("--runtime-root", type=Path, default=REPO_ROOT / "runtime" / "openclaw-live")
    parser.add_argument("--manual-queue", type=Path, default=REPO_ROOT / "MANUAL_REPO_QUEUE.md")
    parser.add_argument("--sleep-seconds", type=int, default=600)
    parser.add_argument("--check-interval-seconds", type=int, default=CHECK_INTERVAL_SECONDS)
    parser.add_argument("--stale-seconds", type=int, default=STALE_SECONDS)
    args = parser.parse_args()

    runtime_root = args.runtime_root.resolve()
    manual_queue_path = args.manual_queue.resolve() if args.manual_queue else None
    runtime_paths = RuntimePaths(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)
    lock_handle = _acquire_lock(runtime_root)
    _ = lock_handle

    watchdog_state_path = runtime_paths.watchdog_json
    watchdog_events_path = runtime_paths.watchdog_events_jsonl

    while True:
        snapshot = _build_worker_snapshot(runtime_paths.root)
        worker_pid = snapshot.pid
        decision = _decide_restart(snapshot, stale_seconds=args.stale_seconds)

        last_event: dict[str, Any] | None = None
        if decision.should_restart:
            if _process_alive(worker_pid):
                last_event = _terminate_worker(worker_pid, reason=decision.reason or "restart requested")
                _append_jsonl(watchdog_events_path, last_event)
            last_event = _launch_worker(
                runtime_root=runtime_root,
                sleep_seconds=args.sleep_seconds,
                manual_queue_path=manual_queue_path,
            )
            last_event["reason"] = decision.reason
            _append_jsonl(watchdog_events_path, last_event)
            worker_pid = last_event.get("pid")

        payload = {
            "updated_at": _utc_now(),
            "watchdog_pid": os.getpid(),
            "runtime_root": str(runtime_root),
            "check_interval_seconds": args.check_interval_seconds,
            "stale_seconds": args.stale_seconds,
            "worker_pid": worker_pid,
            "worker_started_at": (last_event or {}).get("started_at", snapshot.started_at),
            "worker_alive": _process_alive(worker_pid),
            "heartbeat": snapshot.heartbeat,
            "heartbeat_age_seconds": None
            if snapshot.heartbeat_age_seconds is None
            else int(snapshot.heartbeat_age_seconds),
            "last_state_update": snapshot.state.get("updated_at"),
            "completed_batches": snapshot.state.get("completed_batches"),
            "failed_batches": snapshot.state.get("failed_batches"),
            "last_event": last_event,
            "restart_decision": {
                "should_restart": decision.should_restart,
                "reason": decision.reason,
            },
        }
        _write_json(watchdog_state_path, payload)
        time.sleep(args.check_interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
