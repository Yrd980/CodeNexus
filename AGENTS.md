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
- reusable pattern registry entries
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

When adding a new repository-formation document:

- keep it clearly labeled by artifact kind, such as study note, pattern registry, heuristic, or proposal
- place it under `docs/`
- connect it from `README.md` when it changes the active repository baseline
- update `docs/claude-code-study-map.md` when it changes how the current `claude-code` corpus should be navigated or interpreted

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

For reusable pattern artifacts, prefer this structure when it fits:

1. Summary
2. Why this pattern matters
3. Mechanism
4. Current evidence sources
5. Portable value for CodeNexus
6. What not to copy blindly
7. Possible future landing

## Artifact Progression

The current repository progression is:

1. Study Note
2. Reusable Pattern Registry
3. Skill Candidate or Schema Proposal

Unless the user asks for a new direction explicitly, prefer extending that progression rather than inventing a parallel documentation layer.

When writing in this repository:

- do not flatten reusable patterns back into generic study prose
- do not present a schema proposal as if it were already an implemented runtime contract
- do not invent skill candidates prematurely if the reusable pattern layer is still missing

## Current Baseline

The current repository baseline is centered on studying the `claude-code` snapshot and already includes:

- subsystem study notes
- a linked study map
- an artifact model proposal
- a reusable pattern registry

Future work should usually extend that structure rather than replace it.
