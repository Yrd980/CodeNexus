# CodeNexus Agent Guide

This `AGENTS.md` applies to the repository root and all files under it.

## Repository Purpose

`CodeNexus` is a learning-first repository.

The main goal is to study strong agentic or coding-assistant projects and distill their reusable patterns into portable skills, artifacts, and architecture notes.

Default assumption for work in this repository:

- we are learning from upstream projects
- we are extracting reusable mechanisms
- we are separating host-specific implementation from portable design value
- we are writing implementation-grade notes, not casual summaries

This repository is currently not:

- a production runtime
- a direct clone of an upstream project
- a generic dumping ground for unstructured notes

## Default Work Style

When working in this repository:

- inspect upstream code and real repository structure before abstracting
- prefer evidence-backed conclusions over general opinions
- preserve the distinction between "what this upstream project does" and "what CodeNexus should adopt"
- avoid inventing abstractions too early; derive them from studied evidence
- favor structured, cumulative write-ups over one-off chat-only conclusions

If a task is ambiguous, default to strengthening the study corpus rather than starting implementation-heavy product code.

## Output Expectations

Preferred outputs in this repository are:

- architecture dissections
- subsystem analyses
- reusable design-type notes
- extraction heuristics
- study maps
- artifact-model proposals
- skill-system proposals derived from studied evidence

When writing documentation here:

- write as if the note will later be used to design a portable system
- keep claims concrete and tied to specific upstream files or subsystems
- distinguish clearly between:
  - observed behavior
  - inferred design intent
  - recommended reuse for CodeNexus

## Documentation Rules

Use the root `README.md` as the primary entry point.

When adding a meaningful new study document:

- place it under `docs/`
- link it from `README.md` when it is part of the main study baseline
- prefer adding to the structured study map when the document changes the learning path

Prefer a small number of substantial documents over many tiny fragmented notes.

## Scope Discipline

Do not edit the upstream study target inside this repository unless the task explicitly says to do so.

For study tasks:

- treat upstream projects as reference material
- keep extracted conclusions in CodeNexus documents
- do not drift into rebuilding the upstream project inside this repo unless explicitly requested

## Recommended Writing Pattern

For subsystem studies, prefer this structure when it fits:

1. Summary
2. Why the subsystem matters
3. Core model or mechanism
4. Evidence-backed reusable lessons
5. What not to copy blindly
6. Final takeaway

## Current Baseline

The current repository baseline is centered on studying the `claude-code` snapshot and already includes linked documents in `README.md` and `docs/claude-code-study-map.md`.

Future work should usually extend that structure rather than replace it.

