from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def trim_text(value: str | bytes | None, *, limit: int = 4000) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        text = value.decode("utf-8", errors="ignore")
    else:
        text = value
    text = text.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit]}...[truncated]"


class JsonFileStore:
    """Repository-style JSON persistence for runtime artifacts."""

    def read(self, path: Path) -> dict[str, Any] | None:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def write(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def append_jsonl(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


DEFAULT_JSON_STORE = JsonFileStore()


@dataclass(frozen=True)
class RuntimePaths:
    """Value object for the long-run/watchdog/verifier runtime contract."""

    root: Path

    @property
    def state_json(self) -> Path:
        return self.root / "state.json"

    @property
    def heartbeat_json(self) -> Path:
        return self.root / "heartbeat.json"

    @property
    def worker_pid_json(self) -> Path:
        return self.root / "worker.pid.json"

    @property
    def latest_manifest_json(self) -> Path:
        return self.root / "latest-manifest.json"

    @property
    def latest_review_json(self) -> Path:
        return self.root / "latest-review.json"

    @property
    def latest_runtime_verification_json(self) -> Path:
        return self.root / "latest-runtime-verification.json"

    @property
    def latest_checkpoint_json(self) -> Path:
        return self.root / "latest-checkpoint.json"

    @property
    def checkpoints_jsonl(self) -> Path:
        return self.root / "checkpoints.jsonl"

    @property
    def verification_memory_json(self) -> Path:
        return self.root / "verification-memory.json"

    @property
    def watchdog_json(self) -> Path:
        return self.root / "watchdog.json"

    @property
    def watchdog_events_jsonl(self) -> Path:
        return self.root / "watchdog-events.jsonl"

    @property
    def watchdog_lock(self) -> Path:
        return self.root / "watchdog.lock"

    @property
    def worker_log(self) -> Path:
        return self.root / "worker.log"

    @property
    def batches_dir(self) -> Path:
        return self.root / "batches"

    def batch_dir(self, batch_name: str) -> Path:
        return self.batches_dir / batch_name


class ProcessGroupController:
    """Facade for process-group lifecycle so scripts share one kill strategy."""

    def terminate_pid_group(
        self,
        pid: int,
        *,
        is_alive: Callable[[int], bool],
        grace_seconds: float = 10,
        poll_interval_seconds: float = 0.5,
    ) -> str:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            return "already-dead"

        deadline = time.time() + grace_seconds
        while time.time() < deadline:
            if not is_alive(pid):
                return "terminated"
            time.sleep(poll_interval_seconds)

        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            return "terminated"
        return "killed"

    def terminate_process(
        self,
        process: subprocess.Popen[str],
        *,
        grace_seconds: float = 10,
        poll_interval_seconds: float = 0.5,
    ) -> None:
        status = self.terminate_pid_group(
            process.pid,
            is_alive=lambda pid: process.poll() is None,
            grace_seconds=grace_seconds,
            poll_interval_seconds=poll_interval_seconds,
        )
        if status == "already-dead":
            return


DEFAULT_PROCESS_GROUP_CONTROLLER = ProcessGroupController()
