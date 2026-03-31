# CodeNexus Artifact Model Proposal

## Summary

This document proposes the first explicit artifact model for `CodeNexus`.

It is derived from the current `claude-code` study track and is meant to answer a practical question:

> after we study a strong upstream project, what concrete artifact types should we keep in this repository so the learning can accumulate into a reusable system?

The key conclusion is:

> `CodeNexus` should not store everything as generic notes. It should distinguish study artifacts, reusable pattern artifacts, and extraction-target artifacts so that the repository can evolve from research into a portable skill architecture library.

## 1. Why This Proposal Is Needed

Right now the repository already has strong study notes, but without an explicit artifact model there is still a risk of flattening all output into one category:

- architecture notes
- pattern observations
- extraction plans
- future skill definitions

If everything is just a document, later design work will have to rediscover structure by rereading prose.

This proposal exists to prevent that.

## 2. Design Goal

The artifact model should let `CodeNexus` support this workflow:

1. inspect a real upstream project
2. write evidence-backed subsystem notes
3. extract reusable design patterns
4. identify what is portable and worth operationalizing
5. turn the result into a future skill or runtime artifact definition

That means the repository needs artifact types that preserve progress across those phases.

## 3. Proposed Artifact Families

### 3.1 Study Note

A study note records what an upstream project actually does.

Purpose:

- capture real behavior
- anchor claims to subsystems and files
- reduce rescanning of the upstream project

Typical examples:

- skills system analysis
- permission model analysis
- execution topology analysis

Expected properties:

- evidence-backed
- upstream-specific
- descriptive before prescriptive

### 3.2 Reusable Design Pattern

A reusable design pattern extracts a portable idea from one or more study notes.

Purpose:

- isolate what is transferable
- separate portable mechanism from host-specific glue
- create inputs for future system design

Typical examples:

- permission pipeline
- task family plus shared lifecycle framework
- converged command graph with filtered views

Expected properties:

- explicitly names portability
- includes what not to copy blindly
- no longer tied to a single upstream file tree

### 3.3 Extraction Heuristic

An extraction heuristic defines how to decide whether something studied upstream should become a future `CodeNexus` primitive.

Purpose:

- create repeatable selection rules
- prevent copying too much host-specific machinery
- improve consistency across future study tracks

Typical examples:

- how to classify upstream findings into portable primitives vs host glue
- how to decide whether something belongs in a skill, tool contract, or runtime policy model

Expected properties:

- decision-oriented
- cross-project
- optimized for repeated use

### 3.4 Skill Candidate

A skill candidate describes a reusable workflow or capability that may later become a portable skill artifact.

Purpose:

- bridge study and implementation
- capture candidate inputs, outputs, permissions, and execution mode
- avoid losing concrete reusable workflows inside higher-level theory

Typical examples:

- verification workflow candidate
- stuck-recovery workflow candidate
- config-update workflow candidate

Expected properties:

- narrower than a design pattern
- closer to executable workflow form
- still not assumed to be final

### 3.5 Artifact Schema Proposal

An artifact schema proposal defines a future formal structure that `CodeNexus` may adopt for storage, generation, or execution.

Purpose:

- make the repository design explicit
- let future tooling or skill generation rely on known shapes
- connect study notes to actual system design

Typical examples:

- skill artifact schema
- study-note metadata schema
- pattern registry schema

Expected properties:

- design-oriented
- normative rather than descriptive
- likely to change less often than study notes

## 4. Proposed Minimal Relationships

These artifact families should relate to each other in a clear progression.

### Relationship A

Study Note -> Reusable Design Pattern

Observed upstream behavior becomes a portable pattern candidate.

### Relationship B

Reusable Design Pattern -> Extraction Heuristic

Patterns help define repeatable decisions for future study work.

### Relationship C

Reusable Design Pattern -> Skill Candidate

Some patterns imply workflow-level reusable capabilities.

### Relationship D

Skill Candidate -> Artifact Schema Proposal

Once a candidate becomes stable enough, it can inform a formal portable schema.

## 5. What This Means For The Current Repository

Based on the current `claude-code` work:

- the existing documents are mostly Study Notes
- `claude-code-reusable-design-types.md` partially behaves like a Reusable Design Pattern note
- `claude-code-study-map.md` behaves like a navigation artifact, not a core domain artifact
- the repository does not yet have formal Skill Candidate documents
- the repository does not yet have a stable Artifact Schema Proposal beyond this proposal

That is a healthy current state, but it means the next phase should start creating artifact types above raw study notes.

## 6. The First Practical Schema We Should Adopt

If we keep the model minimal for now, the first explicit schema layer in `CodeNexus` should probably distinguish only these three top-level kinds:

- Study Note
- Reusable Pattern
- Schema Proposal

This is enough to avoid flattening the repository too early while still giving future work real structure.

Why this smaller set first:

- it matches what the repository already contains
- it avoids premature taxonomy sprawl
- it still creates a clean bridge toward future skill artifacts

## 7. Suggested Naming Direction

Until a more formal metadata system exists, document titles and placement should communicate artifact kind clearly.

Suggested direction:

- upstream-specific analyses stay as subsystem-focused docs
- cross-project portability docs should explicitly use words like pattern, heuristic, or model
- formal future-facing docs should explicitly use words like proposal or schema

This helps preserve artifact identity even before introducing frontmatter or indexing.

## 8. What Not To Do

To keep the repository clean, avoid these failure modes:

- turning every observation into a new artifact type
- mixing upstream description and CodeNexus prescription without labeling the shift
- writing abstract frameworks with no evidence trail
- assuming every good upstream pattern must become a future portable skill

This proposal is about preserving structure, not inflating taxonomy.

## 9. Immediate Next Step Enabled By This Proposal

With this model in place, the next useful artifact would be one of:

- a Reusable Pattern registry document summarizing cross-note portable patterns
- a Skill Candidate template for future extracted workflows
- a formal Skill Artifact Schema Proposal for `CodeNexus`

Those would move the repository from study accumulation into system formation.

## 10. Final Takeaway

The right next evolution for `CodeNexus` is not to stop studying upstream systems.

It is to start storing the results in a more explicit artifact model.

> the repository should preserve not only what we learned, but what kind of thing each learning output is supposed to become

