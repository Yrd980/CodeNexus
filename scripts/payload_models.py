from __future__ import annotations

from typing import Any, NotRequired, TypedDict


class CommandSummary(TypedDict):
    argv: list[str]
    ok: bool
    returncode: int | None
    stdout: str
    stderr: str


class ReviewQueueSummary(TypedDict):
    rewrite_now: int
    archive_now: int
    delete_now: int
    keep_watching: int


class ReviewQueueNextWaveItem(TypedDict):
    path: str
    decision: str
    severity: str
    next_action: str


class ReviewQueueFinding(TypedDict):
    path: str
    kind: str
    severity: str
    decision: str
    why: list[str]
    next_action: str
    signals: dict[str, Any]


class ReviewQueuePayload(TypedDict):
    generated_at: str
    root: str
    review_prompt: str
    summary: ReviewQueueSummary
    next_wave: list[ReviewQueueNextWaveItem]
    findings: list[ReviewQueueFinding]


class RuntimeVerificationSummary(TypedDict):
    attempted: int
    ready: int
    running: int
    blocked: int
    failed: int
    skipped_recently: int


class RuntimeVerificationTopResult(TypedDict):
    full_name: str
    runtime_status: str
    overall_assessment: str
    blocking_decision: str


class RuntimeVerificationResult(TypedDict, total=False):
    full_name: str
    recommended_action: str | None
    local_path: str | None
    head: str | None
    runtime_truth: dict[str, Any]
    assumption_break: dict[str, Any]
    portability: dict[str, Any]
    overall_assessment: str
    blocking_decision: str
    gaps: list[str]
    immediate_actions: list[str]


class RuntimeVerificationPayload(TypedDict):
    generated_at: str
    manifest_path: str
    runtime_root: str
    repo_limit: int
    cooldown_hours: int
    summary: RuntimeVerificationSummary
    results: list[RuntimeVerificationResult]


class CheckpointBatchSummary(TypedDict):
    repo_count: int
    research_queue: list[str]
    extract_queue: list[str]
    contribution_holds: list[str]
    verification_queue: list[dict[str, Any]]
    priority_candidates: list[dict[str, Any]]
    batch_keywords: list[str]
    language_mix: dict[str, Any]


class CheckpointSelfReview(TypedDict):
    summary: ReviewQueueSummary | None
    next_wave: list[ReviewQueueNextWaveItem] | None


class CheckpointRuntimeVerification(TypedDict):
    summary: RuntimeVerificationSummary | None
    top_results: list[RuntimeVerificationTopResult]


class CheckpointCommands(TypedDict):
    repo_queue_pipeline: CommandSummary | None
    agentic_review: CommandSummary | None
    runtime_verifier: CommandSummary | None


class CheckpointPayload(TypedDict):
    generated_at: str
    batch_index: int
    success: bool
    error: str | None
    runtime_root: str
    batch_dir: str
    manifest_path: str | None
    review_path: str | None
    runtime_verification_path: str | None
    batch_summary: CheckpointBatchSummary
    self_review: CheckpointSelfReview
    runtime_verification: CheckpointRuntimeVerification
    cognition_updates: list[str]
    runtime_notes: list[str]
    commands: CheckpointCommands
    next_actions: list[str]
    checkpoint_path: NotRequired[str]
    post_batch_self_update: NotRequired[dict[str, Any]]
