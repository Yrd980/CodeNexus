#!/usr/bin/env python3
"""Execute runtime-truth checks for top OpenClaw candidates."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

READY_PATTERNS: dict[str, re.Pattern[str]] = {
    "ready": re.compile(r"\bready\b", re.IGNORECASE),
    "listening": re.compile(r"\blistening\b", re.IGNORECASE),
    "localhost": re.compile(r"https?://(?:127\.0\.0\.1|localhost)", re.IGNORECASE),
    "vite": re.compile(r"\bvite v\d", re.IGNORECASE),
    "local_url": re.compile(r"\blocal:\s+https?://", re.IGNORECASE),
    "started": re.compile(r"\bserver\b.*\bstarted\b|\bstarted\b.*\bserver\b", re.IGNORECASE),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _trim_text(value: str | bytes | None, *, limit: int = 4000) -> str:
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


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_iso8601(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _command_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("CI", "1")
    env.setdefault("NO_COLOR", "1")
    env.setdefault("FORCE_COLOR", "0")
    env.setdefault("BROWSER", "none")
    env.setdefault("npm_config_audit", "false")
    env.setdefault("npm_config_fund", "false")
    return env


def _run_finite_command(argv: list[str], *, cwd: Path, timeout_seconds: int) -> dict[str, Any]:
    started = time.monotonic()
    try:
        completed = subprocess.run(
            argv,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
            env=_command_env(),
        )
        return {
            "argv": argv,
            "cwd": str(cwd),
            "timeout_seconds": timeout_seconds,
            "ok": completed.returncode == 0,
            "timed_out": False,
            "returncode": completed.returncode,
            "duration_seconds": round(time.monotonic() - started, 1),
            "stdout_excerpt": _trim_text(completed.stdout),
            "stderr_excerpt": _trim_text(completed.stderr),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "argv": argv,
            "cwd": str(cwd),
            "timeout_seconds": timeout_seconds,
            "ok": False,
            "timed_out": True,
            "returncode": None,
            "duration_seconds": round(time.monotonic() - started, 1),
            "stdout_excerpt": _trim_text(exc.stdout),
            "stderr_excerpt": _trim_text(exc.stderr),
        }


def _terminate_process_tree(process: subprocess.Popen[str]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    deadline = time.time() + 10
    while time.time() < deadline:
        if process.poll() is not None:
            return
        time.sleep(0.5)

    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return


def _run_observed_command(argv: list[str], *, cwd: Path, observe_seconds: int) -> dict[str, Any]:
    started = time.monotonic()
    process = subprocess.Popen(
        argv,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
        env=_command_env(),
    )

    stdout = ""
    stderr = ""
    observed_alive = False
    timed_out = False
    returncode: int | None = None

    try:
        stdout, stderr = process.communicate(timeout=observe_seconds)
        returncode = process.returncode
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        observed_alive = process.poll() is None
        stdout = _trim_text(exc.stdout, limit=10000)
        stderr = _trim_text(exc.stderr, limit=10000)
        _terminate_process_tree(process)
        try:
            tail_stdout, tail_stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            tail_stdout = ""
            tail_stderr = ""
        tail_stdout_text = _trim_text(tail_stdout, limit=4000)
        tail_stderr_text = _trim_text(tail_stderr, limit=4000)
        if tail_stdout_text and tail_stdout_text not in stdout:
            stdout = "\n".join(part for part in [stdout, tail_stdout_text] if part).strip()
        if tail_stderr_text and tail_stderr_text not in stderr:
            stderr = "\n".join(part for part in [stderr, tail_stderr_text] if part).strip()

    combined = "\n".join(part for part in [stdout, stderr] if part)
    ready_hits = [label for label, pattern in READY_PATTERNS.items() if pattern.search(combined)]

    if observed_alive and ready_hits:
        status = "ready"
    elif observed_alive:
        status = "running"
    elif returncode == 0 and ready_hits:
        status = "ready"
    elif returncode == 0:
        status = "exited-cleanly"
    else:
        status = "failed"

    return {
        "argv": argv,
        "cwd": str(cwd),
        "timeout_seconds": observe_seconds,
        "ok": status in {"ready", "running"},
        "timed_out": timed_out,
        "returncode": returncode,
        "duration_seconds": round(time.monotonic() - started, 1),
        "observed_alive": observed_alive,
        "ready_signals": ready_hits,
        "status": status,
        "stdout_excerpt": _trim_text(stdout, limit=4000),
        "stderr_excerpt": _trim_text(stderr, limit=4000),
    }


def _git_head(repo_dir: Path) -> str | None:
    result = _run_finite_command(["git", "-C", str(repo_dir), "rev-parse", "HEAD"], cwd=repo_dir, timeout_seconds=20)
    if not result["ok"]:
        return None
    return result["stdout_excerpt"].strip()


def _git_status_lines(repo_dir: Path) -> list[str]:
    result = _run_finite_command(
        ["git", "-C", str(repo_dir), "status", "--short"],
        cwd=repo_dir,
        timeout_seconds=20,
    )
    if not result["ok"]:
        return []
    text = result["stdout_excerpt"]
    return [line for line in text.splitlines() if line.strip()]


def _install_command(profile: dict[str, Any], repo_dir: Path) -> list[str] | None:
    package_managers = profile.get("package_managers") or []
    if not package_managers:
        return None

    package_manager = package_managers[0]
    if package_manager == "npm":
        return ["npm", "install", "--no-audit", "--no-fund"]
    if package_manager == "pnpm":
        if (repo_dir / "pnpm-lock.yaml").exists():
            return ["pnpm", "install", "--frozen-lockfile"]
        return ["pnpm", "install"]
    if package_manager == "bun":
        return ["bun", "install"]
    if package_manager == "yarn":
        if (repo_dir / "yarn.lock").exists():
            return ["yarn", "install", "--immutable"]
        return ["yarn", "install"]
    return None


def _should_install(profile: dict[str, Any], repo_dir: Path) -> bool:
    ecosystems = profile.get("ecosystems") or []
    package_managers = profile.get("package_managers") or []
    if "node" not in ecosystems or not package_managers:
        return False
    return not (repo_dir / "node_modules").exists()


def _status_sort_key(repo: dict[str, Any]) -> tuple[int, int, int, str]:
    signal_band = (repo.get("signals") or {}).get("signal_band", "low")
    composite_score = int((repo.get("signals") or {}).get("composite_score", 0))
    return (
        0 if repo.get("recommended_action") == "research" else 1,
        {"high": 0, "medium": 1, "low": 2}.get(signal_band, 2),
        -composite_score,
        repo.get("full_name", ""),
    )


def _should_skip_recently(
    *,
    repo_head: str | None,
    memory_entry: dict[str, Any] | None,
    cooldown_hours: int,
) -> tuple[bool, str | None]:
    if not memory_entry:
        return False, None
    checked_at = _parse_iso8601(memory_entry.get("checked_at"))
    if checked_at is None:
        return False, None
    if memory_entry.get("head") != repo_head:
        return False, None
    age = datetime.now(timezone.utc) - checked_at
    if age > timedelta(hours=cooldown_hours):
        return False, None
    return True, (
        f"Runtime truth already checked {round(age.total_seconds() / 3600, 1)}h ago on the same commit."
    )


def _command_missing(argv: list[str]) -> str | None:
    if not argv:
        return "No command was selected."
    if shutil.which(argv[0]) is None:
        return f"Required executable is missing: {argv[0]}"
    return None


def _select_runtime_command(repo: dict[str, Any]) -> tuple[str | None, str]:
    profile = repo.get("analysis_profile") or {}
    startup_commands = profile.get("startup_commands") or []
    build_commands = profile.get("build_commands") or []

    if startup_commands:
        return startup_commands[0], "startup"
    if build_commands:
        return build_commands[0], "build"
    return None, "blocked"


def _build_assumption_break(repo: dict[str, Any], runtime_done: bool) -> dict[str, Any]:
    notes: list[str] = []
    if not runtime_done:
        notes.append("Runtime truth is still missing or blocked, so assumption-break checks stay downstream.")
    else:
        notes.append("Next run should break one required env/config assumption on the smallest live path.")
        if (repo.get("signals") or {}).get("needs_external_services"):
            notes.append("Keep external dependencies unavailable and confirm the error boundary stays explicit.")
        else:
            notes.append("Send one invalid input through the live path and confirm the failure contract stays honest.")
    return {
        "done": False,
        "status": "todo" if runtime_done else "blocked",
        "notes": notes,
    }


def _build_portability(repo: dict[str, Any], *, worktree_lines: list[str]) -> dict[str, Any]:
    notes: list[str] = []
    signals = repo.get("signals") or {}
    if signals.get("is_monorepo"):
        notes.append("Monorepo detected; extracted code must be checked without workspace-only glue.")
    if signals.get("is_multi_ecosystem"):
        notes.append("Separate language-agnostic design from repo-specific multi-ecosystem glue before extraction.")
    if worktree_lines:
        notes.append("Runtime path dirtied the worktree: " + "; ".join(worktree_lines[:5]))
    else:
        notes.append("Runtime path did not leave obvious tracked worktree changes.")
    notes.append("A real portability pass still needs extraction into a foreign context.")
    return {
        "done": False,
        "status": "todo",
        "notes": notes,
    }


def _evaluate_result(
    repo: dict[str, Any],
    *,
    repo_head: str | None,
    install_result: dict[str, Any] | None,
    runtime_result: dict[str, Any] | None,
    skip_reason: str | None = None,
    worktree_lines: list[str] | None = None,
) -> dict[str, Any]:
    worktree_lines = worktree_lines or []
    runtime_done = False
    gaps: list[str] = []
    immediate_actions: list[str] = []

    if skip_reason:
        runtime_truth = {
            "done": False,
            "status": "skipped-recently",
            "notes": [skip_reason],
            "head": repo_head,
        }
        overall_assessment = "partial"
        blocking_decision = "research-more"
        immediate_actions.append("Wait for a new commit or cooldown expiry before rerunning runtime truth.")
    elif runtime_result is None:
        runtime_truth = {
            "done": False,
            "status": "blocked",
            "notes": ["No runnable startup or build command was detected."],
            "head": repo_head,
        }
        overall_assessment = "weak"
        blocking_decision = "stop"
        gaps.append("No startup-facing runtime path was detected from repo facts.")
        immediate_actions.append(repo["verification_backlog"]["runtime_truth"]["tasks"][0])
    elif install_result and not install_result["ok"]:
        runtime_truth = {
            "done": False,
            "status": "blocked",
            "notes": [
                "Dependency installation failed before startup truth could be claimed.",
                install_result["stderr_excerpt"] or install_result["stdout_excerpt"] or "Install command failed.",
            ],
            "head": repo_head,
            "install": install_result,
        }
        overall_assessment = "weak"
        blocking_decision = "stop"
        gaps.append("Dependencies could not be prepared on the smallest honest path.")
        immediate_actions.append("Inspect install failure output and decide whether the repo or local toolchain is at fault.")
    else:
        runtime_done = runtime_result["status"] in {"ready", "running"}
        runtime_truth = {
            "done": runtime_done,
            "status": runtime_result["status"],
            "notes": [],
            "head": repo_head,
            "install": install_result,
            "command": runtime_result,
        }
        if runtime_result["status"] == "ready":
            runtime_truth["notes"].append("Startup produced ready signals within the observation window.")
        elif runtime_result["status"] == "running":
            runtime_truth["notes"].append("Startup stayed alive for the full observation window without crashing.")
        elif runtime_result["status"] == "exited-cleanly":
            runtime_truth["notes"].append("Command exited cleanly before proving a live startup boundary.")
            gaps.append("The startup candidate exited before a stable live boundary was observed.")
        else:
            runtime_truth["notes"].append("Command failed before a truthful startup path was established.")
            gaps.append("Runtime truth failed on the current smallest path.")

        if runtime_done:
            overall_assessment = "partial"
            blocking_decision = "research-more"
            immediate_actions.append("Run one assumption-break check against the live path.")
            immediate_actions.append("Check portability against a foreign context before extraction or PR work.")
        else:
            overall_assessment = "weak"
            blocking_decision = "stop"
            immediate_actions.append("Read the runtime failure and decide whether the repo should be demoted or retried.")

    assumption_break = _build_assumption_break(repo, runtime_done)
    portability = _build_portability(repo, worktree_lines=worktree_lines)

    if not gaps and not runtime_done:
        gaps.append("Runtime truth is still absent.")

    return {
        "full_name": repo.get("full_name"),
        "recommended_action": repo.get("recommended_action"),
        "local_path": repo.get("local_path"),
        "head": repo_head,
        "runtime_truth": runtime_truth,
        "assumption_break": assumption_break,
        "portability": portability,
        "overall_assessment": overall_assessment,
        "blocking_decision": blocking_decision,
        "gaps": gaps,
        "immediate_actions": immediate_actions,
    }


def verify_repo(
    repo: dict[str, Any],
    *,
    install_timeout_seconds: int,
    command_timeout_seconds: int,
) -> dict[str, Any]:
    repo_dir = Path(repo["local_path"])
    profile = repo.get("analysis_profile") or {}
    repo_head = _git_head(repo_dir)

    command_text, command_kind = _select_runtime_command(repo)
    if not command_text:
        return _evaluate_result(repo, repo_head=repo_head, install_result=None, runtime_result=None)

    argv = shlex.split(command_text)
    missing = _command_missing(argv)
    if missing:
        return {
            **_evaluate_result(repo, repo_head=repo_head, install_result=None, runtime_result=None),
            "runtime_truth": {
                "done": False,
                "status": "blocked",
                "notes": [missing],
                "head": repo_head,
            },
            "overall_assessment": "weak",
            "blocking_decision": "stop",
            "gaps": [missing],
            "immediate_actions": [f"Install `{argv[0]}` or demote this repo until the toolchain exists."],
        }

    install_result: dict[str, Any] | None = None
    install_argv = _install_command(profile, repo_dir)
    if _should_install(profile, repo_dir) and install_argv:
        missing_install = _command_missing(install_argv)
        if missing_install:
            return {
                **_evaluate_result(repo, repo_head=repo_head, install_result=None, runtime_result=None),
                "runtime_truth": {
                    "done": False,
                    "status": "blocked",
                    "notes": [missing_install],
                    "head": repo_head,
                },
                "overall_assessment": "weak",
                "blocking_decision": "stop",
                "gaps": [missing_install],
                "immediate_actions": [f"Install `{install_argv[0]}` before retrying this runtime path."],
            }
        install_result = _run_finite_command(install_argv, cwd=repo_dir, timeout_seconds=install_timeout_seconds)
        if not install_result["ok"]:
            return _evaluate_result(
                repo,
                repo_head=repo_head,
                install_result=install_result,
                runtime_result=None,
                worktree_lines=_git_status_lines(repo_dir),
            )

    runtime_result = _run_observed_command(argv, cwd=repo_dir, observe_seconds=command_timeout_seconds)
    runtime_result["kind"] = command_kind
    worktree_lines = _git_status_lines(repo_dir)
    return _evaluate_result(
        repo,
        repo_head=repo_head,
        install_result=install_result,
        runtime_result=runtime_result,
        worktree_lines=worktree_lines,
    )


def run_runtime_verifier(
    *,
    manifest_path: Path,
    runtime_root: Path,
    output_path: Path,
    repo_limit: int,
    cooldown_hours: int,
    install_timeout_seconds: int,
    command_timeout_seconds: int,
    force: bool,
) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    memory_path = runtime_root / "verification-memory.json"
    memory = _read_json(memory_path) or {"updated_at": None, "repos": {}}
    memory_repos = memory.setdefault("repos", {})

    candidates = sorted(
        [
            repo
            for repo in manifest.get("repos", [])
            if repo.get("recommended_action") != "skip" and repo.get("local_path")
        ],
        key=_status_sort_key,
    )[:repo_limit]

    results: list[dict[str, Any]] = []
    summary = {
        "attempted": 0,
        "ready": 0,
        "running": 0,
        "blocked": 0,
        "failed": 0,
        "skipped_recently": 0,
    }

    for repo in candidates:
        repo_dir = Path(repo["local_path"])
        repo_head = _git_head(repo_dir)
        memory_entry = memory_repos.get(repo["full_name"])
        if not force:
            should_skip, skip_reason = _should_skip_recently(
                repo_head=repo_head,
                memory_entry=memory_entry,
                cooldown_hours=cooldown_hours,
            )
            if should_skip:
                result = _evaluate_result(
                    repo,
                    repo_head=repo_head,
                    install_result=None,
                    runtime_result=None,
                    skip_reason=skip_reason,
                    worktree_lines=_git_status_lines(repo_dir),
                )
                summary["skipped_recently"] += 1
                results.append(result)
                continue

        summary["attempted"] += 1
        result = verify_repo(
            repo,
            install_timeout_seconds=install_timeout_seconds,
            command_timeout_seconds=command_timeout_seconds,
        )
        runtime_status = result["runtime_truth"]["status"]
        if runtime_status == "ready":
            summary["ready"] += 1
        elif runtime_status == "running":
            summary["running"] += 1
        elif runtime_status == "blocked":
            summary["blocked"] += 1
        else:
            summary["failed"] += 1

        memory_repos[repo["full_name"]] = {
            "checked_at": _utc_now(),
            "head": result.get("head"),
            "runtime_status": runtime_status,
            "overall_assessment": result["overall_assessment"],
            "blocking_decision": result["blocking_decision"],
        }
        results.append(result)

    memory["updated_at"] = _utc_now()
    _write_json(memory_path, memory)

    payload = {
        "generated_at": _utc_now(),
        "manifest_path": str(manifest_path),
        "runtime_root": str(runtime_root),
        "repo_limit": repo_limit,
        "cooldown_hours": cooldown_hours,
        "summary": summary,
        "results": results,
    }
    _write_json(output_path, payload)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Run runtime-truth checks for top OpenClaw candidates.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repo-limit", type=int, default=2)
    parser.add_argument("--cooldown-hours", type=int, default=12)
    parser.add_argument("--install-timeout-seconds", type=int, default=900)
    parser.add_argument("--command-timeout-seconds", type=int, default=45)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    payload = run_runtime_verifier(
        manifest_path=args.manifest.resolve(),
        runtime_root=args.runtime_root.resolve(),
        output_path=args.output.resolve(),
        repo_limit=args.repo_limit,
        cooldown_hours=args.cooldown_hours,
        install_timeout_seconds=args.install_timeout_seconds,
        command_timeout_seconds=args.command_timeout_seconds,
        force=args.force,
    )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "summary": payload["summary"],
                "results": len(payload["results"]),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
