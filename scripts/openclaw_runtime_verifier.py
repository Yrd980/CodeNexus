#!/usr/bin/env python3
"""Execute runtime-truth checks for top OpenClaw candidates."""

from __future__ import annotations

import argparse
import copy
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
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

READY_PATTERNS: dict[str, re.Pattern[str]] = {
    "ready": re.compile(r"\bready\b", re.IGNORECASE),
    "listening": re.compile(r"\blistening\b", re.IGNORECASE),
    "localhost": re.compile(r"https?://(?:127\.0\.0\.1|localhost)", re.IGNORECASE),
    "vite": re.compile(r"\bvite v\d", re.IGNORECASE),
    "local_url": re.compile(r"\blocal:\s+https?://", re.IGNORECASE),
    "started": re.compile(r"\bserver\b.*\bstarted\b|\bstarted\b.*\bserver\b", re.IGNORECASE),
}
HTTP_URL_PATTERN = re.compile(r"https?://[^\s)]+", re.IGNORECASE)
NODE_SCRIPT_CALL_PATTERN = re.compile(
    r"^(?P<manager>npm|pnpm|yarn|bun)\s+(?:(?:run)\s+)?(?P<script>[A-Za-z0-9:_-]+)(?:\s|$)",
    re.IGNORECASE,
)
SIDE_EFFECT_PATTERNS: dict[str, re.Pattern[str]] = {
    "sync": re.compile(r"\bsync\b|rsync", re.IGNORECASE),
    "publish_release": re.compile(r"\bpublish\b|\brelease\b|\bnp\b", re.IGNORECASE),
    "deploy": re.compile(r"\bdeploy\b|\bvercel\b|\bnetlify\b|\bgcloud\b|\baws\b", re.IGNORECASE),
    "restart": re.compile(r"\brestart\b|\bworker:restart\b|\bsystemctl\b", re.IGNORECASE),
    "home_state": re.compile(r"~\/|/home/[^\s/]+/|\.claude/plugins|marketplaces/", re.IGNORECASE),
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


def _extract_urls(text: str) -> list[str]:
    urls: list[str] = []
    for raw in HTTP_URL_PATTERN.findall(text):
        url = raw.rstrip(".,);]")
        if url not in urls:
            urls.append(url)
    return urls


def _probe_http_boundary(base_url: str) -> dict[str, Any]:
    invalid_url = urljoin(base_url if base_url.endswith("/") else f"{base_url}/", "__openclaw_invalid__")
    request = Request(
        invalid_url,
        headers={
            "User-Agent": "OpenClaw-Runtime-Verifier/1.0",
            "Accept": "*/*",
        },
    )
    try:
        with urlopen(request, timeout=5) as response:
            status_code = response.getcode()
            body_excerpt = _trim_text(response.read(512), limit=400)
        return {
            "url": base_url,
            "invalid_url": invalid_url,
            "ok": False,
            "outcome": "unexpected-2xx" if 200 <= status_code < 300 else "unexpected-response",
            "status_code": status_code,
            "body_excerpt": body_excerpt,
        }
    except HTTPError as exc:
        body_excerpt = _trim_text(exc.read(512), limit=400)
        return {
            "url": base_url,
            "invalid_url": invalid_url,
            "ok": True,
            "outcome": "explicit-4xx" if 400 <= exc.code < 500 else "explicit-5xx",
            "status_code": exc.code,
            "body_excerpt": body_excerpt,
        }
    except URLError as exc:
        return {
            "url": base_url,
            "invalid_url": invalid_url,
            "ok": False,
            "outcome": "no-response",
            "status_code": None,
            "body_excerpt": str(exc.reason),
        }


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
    http_probe: dict[str, Any] | None = None

    try:
        stdout, stderr = process.communicate(timeout=observe_seconds)
        returncode = process.returncode
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        observed_alive = process.poll() is None
        stdout = _trim_text(exc.stdout, limit=10000)
        stderr = _trim_text(exc.stderr, limit=10000)
        urls = _extract_urls("\n".join(part for part in [stdout, stderr] if part))
        if observed_alive and urls:
            http_probe = _probe_http_boundary(urls[0])
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
        "http_probe": http_probe,
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


def _load_package_scripts(repo_dir: Path) -> dict[str, str]:
    package_json_path = repo_dir / "package.json"
    if not package_json_path.exists():
        return {}
    try:
        payload = json.loads(package_json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    scripts = payload.get("scripts")
    if not isinstance(scripts, dict):
        return {}
    return {key: value for key, value in scripts.items() if isinstance(value, str)}


def _resolve_node_script_chain(command_text: str, repo_dir: Path, *, max_depth: int = 4) -> list[dict[str, str]]:
    scripts = _load_package_scripts(repo_dir)
    chain: list[dict[str, str]] = []
    current = command_text.strip()
    seen: set[str] = set()
    for _ in range(max_depth):
        match = NODE_SCRIPT_CALL_PATTERN.match(current)
        if not match:
            break
        script_name = match.group("script")
        if script_name in seen:
            break
        body = scripts.get(script_name)
        if not body:
            break
        chain.append({"script": script_name, "body": body})
        seen.add(script_name)
        current = body.strip()
    return chain


def _detect_side_effect_risk(command_text: str, repo_dir: Path) -> dict[str, Any]:
    chain = _resolve_node_script_chain(command_text, repo_dir)
    texts = [command_text, *[item["body"] for item in chain]]
    hits = [
        label
        for label, pattern in SIDE_EFFECT_PATTERNS.items()
        if any(pattern.search(text) for text in texts)
    ]
    return {
        "risky": bool(hits),
        "hits": hits,
        "resolved_scripts": chain,
    }


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


def _build_assumption_break(
    repo: dict[str, Any],
    *,
    runtime_done: bool,
    runtime_result: dict[str, Any] | None,
) -> dict[str, Any]:
    notes: list[str] = []
    http_probe = (runtime_result or {}).get("http_probe") if runtime_result else None
    if runtime_done and http_probe and http_probe.get("ok"):
        status_code = http_probe.get("status_code")
        notes.append(
            f"Invalid-path probe returned an explicit boundary response at {http_probe['invalid_url']} "
            f"with status {status_code}."
        )
        return {
            "done": True,
            "status": "done",
            "notes": notes,
        }
    if runtime_done and http_probe and not http_probe.get("ok"):
        notes.append(
            f"Invalid-path probe did not get a clear boundary response: {http_probe.get('outcome')}."
        )
        notes.append("A human should inspect whether the live path hides routing or error-boundary problems.")
        return {
            "done": False,
            "status": "todo",
            "notes": notes,
        }
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


def _cached_result_from_memory(
    repo: dict[str, Any],
    *,
    repo_head: str | None,
    memory_entry: dict[str, Any],
    skip_reason: str,
) -> dict[str, Any] | None:
    snapshot = memory_entry.get("result_snapshot")
    if not isinstance(snapshot, dict):
        return None

    runtime_truth = copy.deepcopy(snapshot.get("runtime_truth") or {})
    assumption_break = copy.deepcopy(snapshot.get("assumption_break") or {})
    portability = copy.deepcopy(snapshot.get("portability") or {})
    gaps = list(snapshot.get("gaps") or [])
    immediate_actions = list(snapshot.get("immediate_actions") or [])
    cached_status = runtime_truth.get("status")

    runtime_truth["status"] = "skipped-recently"
    runtime_truth["cached_from_status"] = cached_status
    runtime_truth["head"] = repo_head
    runtime_truth["notes"] = [skip_reason, *list(runtime_truth.get("notes") or [])]

    return {
        "full_name": repo.get("full_name"),
        "recommended_action": repo.get("recommended_action"),
        "local_path": repo.get("local_path"),
        "head": repo_head,
        "runtime_truth": runtime_truth,
        "assumption_break": assumption_break,
        "portability": portability,
        "overall_assessment": snapshot.get("overall_assessment", memory_entry.get("overall_assessment", "partial")),
        "blocking_decision": snapshot.get(
            "blocking_decision",
            memory_entry.get("blocking_decision", "research-more"),
        ),
        "gaps": gaps,
        "immediate_actions": [
            "Wait for a new commit or cooldown expiry before rerunning runtime truth.",
            *[action for action in immediate_actions if action != "Wait for a new commit or cooldown expiry before rerunning runtime truth."],
        ],
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
    elif runtime_result and runtime_result["status"] == "blocked-side-effects":
        runtime_truth = {
            "done": False,
            "status": "blocked-side-effects",
            "notes": [
                "Startup candidate performs side effects, so OpenClaw refused to execute it as runtime truth.",
                "Risk markers: " + ", ".join(runtime_result.get("safety", {}).get("hits", [])),
            ],
            "head": repo_head,
            "install": install_result,
            "command": runtime_result,
        }
        if runtime_result.get("fallback_command"):
            fallback = runtime_result["fallback_command"]
            if fallback.get("ok"):
                runtime_truth["notes"].append("Safe build sanity succeeded, but startup truth is still unproven.")
            else:
                runtime_truth["notes"].append("Even the safe build fallback failed.")
        overall_assessment = "weak"
        blocking_decision = "stop"
        gaps.append("Startup path is side-effectful; no safe local runtime path is proven yet.")
        immediate_actions.append("Find a side-effect-free local startup path or explicit dry-run entrypoint.")
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
            if runtime_result.get("http_probe", {}).get("ok"):
                immediate_actions.append("Move to portability checks; the HTTP invalid-path boundary was explicit.")
            else:
                immediate_actions.append("Run one assumption-break check against the live path.")
            immediate_actions.append("Check portability against a foreign context before extraction or PR work.")
        else:
            overall_assessment = "weak"
            blocking_decision = "stop"
            immediate_actions.append("Read the runtime failure and decide whether the repo should be demoted or retried.")

    assumption_break = _build_assumption_break(
        repo,
        runtime_done=runtime_done,
        runtime_result=runtime_result,
    )
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

    safety = _detect_side_effect_risk(command_text, repo_dir)
    if safety["risky"]:
        fallback_result: dict[str, Any] | None = None
        build_commands = profile.get("build_commands") or []
        if build_commands and build_commands[0] != command_text:
            fallback_argv = shlex.split(build_commands[0])
            if _command_missing(fallback_argv) is None:
                fallback_result = _run_finite_command(
                    fallback_argv,
                    cwd=repo_dir,
                    timeout_seconds=install_timeout_seconds,
                )
        return _evaluate_result(
            repo,
            repo_head=repo_head,
            install_result=install_result,
            runtime_result={
                "status": "blocked-side-effects",
                "kind": command_kind,
                "argv": argv,
                "cwd": str(repo_dir),
                "safety": safety,
                "fallback_command": fallback_result,
            },
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
                result = _cached_result_from_memory(
                    repo,
                    repo_head=repo_head,
                    memory_entry=memory_entry or {},
                    skip_reason=skip_reason or "Runtime truth was recently checked.",
                )
                if result is None:
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
        elif runtime_status.startswith("blocked"):
            summary["blocked"] += 1
        else:
            summary["failed"] += 1

        memory_repos[repo["full_name"]] = {
            "checked_at": _utc_now(),
            "head": result.get("head"),
            "runtime_status": runtime_status,
            "overall_assessment": result["overall_assessment"],
            "blocking_decision": result["blocking_decision"],
            "result_snapshot": {
                "runtime_truth": result["runtime_truth"],
                "assumption_break": result["assumption_break"],
                "portability": result["portability"],
                "overall_assessment": result["overall_assessment"],
                "blocking_decision": result["blocking_decision"],
                "gaps": result["gaps"],
                "immediate_actions": result["immediate_actions"],
            },
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
