# Claude Code Study Map

## Summary

This file is the top-level map for the `claude-code` study track inside `CodeNexus`.

It organizes the current write-ups into a coherent learning path so future extraction work can start from a stable structure instead of rescanning the whole upstream snapshot.

Studied upstream snapshot:

- `/home/yrd/documents/git_clone_code/etc/claude-code`

## Completed Notes

### 1. Skills System

- [Claude Code Skills System Analysis](./claude-code-skills-system-analysis.md)
- focus: what a skill is, how it is loaded, how `SkillTool` executes it

### 2. Reusable Design Families

- [Claude Code Reusable Design Types](./claude-code-reusable-design-types.md)
- focus: artifact model, permission model, task model, session model, extension model

### 3. Permission And Governance

- [Claude Code Permission And Governance Model](./claude-code-permission-and-governance-model.md)
- focus: permission modes, rule pipeline, tool-specific checks, shell governance, workspace-aware policy

### 4. Task And Execution Topology

- [Claude Code Task And Execution Topology](./claude-code-task-and-execution-topology.md)
- focus: task families, local vs remote execution, teammates, forked contexts, lifecycle framework

### 5. Context Continuity

- [Claude Code Context Continuity And Compaction](./claude-code-context-continuity-and-compaction.md)
- focus: compaction prompts, API-round grouping, stripping, restoration, long-session continuity

### 6. Command Skill Plugin Convergence

- [Claude Code Command Skill Plugin Convergence](./claude-code-command-skill-plugin-convergence.md)
- focus: shared command graph, filtered skill views, plugin normalization, provenance without semantic drift

## Recommended Reading Order

1. Skills system
2. Reusable design types
3. Permission and governance
4. Task and execution topology
5. Context continuity and compaction
6. Command skill plugin convergence

This order moves from local mechanism to larger runtime architecture.

## What This Study Track Already Suggests

Across these notes, `claude-code` now looks less like a bag of features and more like a composed runtime with several durable design themes:

- typed capability artifacts
- converged content registries
- explicit governance
- execution placement models
- continuity under context pressure
- packaging without runtime fragmentation

## Likely Next Study Targets

If we continue deepening this track, the highest-value next topics are likely:

- tool contract and schema design in more detail
- memory extraction and session memory pipeline
- bridge and remote IDE integration model
- MCP integration boundaries
- state and UI coordination model

## CodeNexus Formation Layer

Study notes are no longer the only important outputs in this repository.

The first explicit repository-level schema proposal now lives here:

- [CodeNexus Artifact Model Proposal](./codenexus-artifact-model-proposal.md)
- [CodeNexus Reusable Pattern Registry](./codenexus-reusable-pattern-registry.md)

The proposal defines the artifact families.
The registry is the first concrete reusable-pattern artifact built on top of the current study corpus.

Together, they mark the transition from pure upstream study into CodeNexus's own artifact design.

## Final Takeaway

This map exists so `CodeNexus` can grow by structured accumulation.

> the goal is not to keep re-reading one strong project; it is to turn that project into a reusable architecture reference library
