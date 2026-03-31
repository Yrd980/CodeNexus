# CodeNexus

`CodeNexus` is a learning-first repository for studying strong agentic/code-assistant projects and distilling their repeatable patterns into reusable skills.

Current focus:

- analyze real-world projects instead of inventing abstractions in the air
- separate host-runtime capabilities from true skill logic
- preserve implementation-grade notes that can later drive skill extraction

## Research Baseline

The first baseline analysis in this repository studies Anthropic's leaked `claude-code` source snapshot as a skills-system reference:

- [Claude Code Skills System Analysis](./docs/claude-code-skills-system-analysis.md)
- [Claude Code Reusable Design Types](./docs/claude-code-reusable-design-types.md)
- [Claude Code Permission And Governance Model](./docs/claude-code-permission-and-governance-model.md)
- [Claude Code Task And Execution Topology](./docs/claude-code-task-and-execution-topology.md)
- [Claude Code Context Continuity And Compaction](./docs/claude-code-context-continuity-and-compaction.md)
- [Claude Code Command Skill Plugin Convergence](./docs/claude-code-command-skill-plugin-convergence.md)
- [Claude Code Study Map](./docs/claude-code-study-map.md)
- [CodeNexus Artifact Model Proposal](./docs/codenexus-artifact-model-proposal.md)
- [CodeNexus Reusable Pattern Registry](./docs/codenexus-reusable-pattern-registry.md)

## Working Principle

This repository is for:

- architecture dissection
- skill extraction notes
- reusable workflow/system patterns

This repository is not yet:

- a production runtime
- a direct clone of another tool
- a generic note dump

The goal is to build a clean path from:

1. study a strong project
2. identify the reusable mechanism
3. strip away host-specific assumptions
4. turn the residue into portable skills
