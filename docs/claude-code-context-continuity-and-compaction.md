# Claude Code Context Continuity And Compaction

## Summary

This document studies how the cloned `claude-code` snapshot preserves useful context across long-running sessions and shrinking context windows.

Primary source snapshot:

- `/home/yrd/documents/git_clone_code/etc/claude-code`

The key conclusion is:

> `claude-code` treats compaction as a continuity subsystem, not as a one-off summary feature. It manages what to summarize, what to strip, what to restore, and how to preserve enough operating context for work to continue safely.

## 1. Why This Subsystem Matters

Most agent systems work well only while the context window is large enough to hide design weakness.

Once a session gets long, several hard problems appear:

- token overflow
- stale tool state
- noisy attachments
- lost operating context
- degraded continuity after summarization

This repository clearly treats those as first-class runtime problems.

## 2. Compaction Is Prompted As A Deliberate Task

`src/services/compact/prompt.ts` shows that compaction is not a vague summarize the chat request.

The prompts explicitly require structured outputs such as:

- primary request and intent
- key technical concepts
- files and code sections
- errors and fixes
- pending tasks
- current work
- optional next step

There are also multiple prompt variants for different compaction situations.

### Why this matters

The runtime is not merely compressing text. It is preserving operational continuity for future work.

## 3. The System Distinguishes Full, Partial, And Up-To Compaction

The prompt layer already reveals an important design distinction:

- full conversation compaction
- partial compaction of recent messages only
- up-to compaction where a summarized prefix is followed by retained newer context

### Why this matters

This is a strong design choice because not every compaction event means the same thing.

A mature runtime needs to know whether it is:

- replacing everything with a summary
- summarizing only a prefix
- preserving a recent working tail intact

That distinction is essential for safe continuity.

## 4. Grouping Happens At API-Round Boundaries

`src/services/compact/grouping.ts` shows that compaction is organized around API-round groups, not just user turns.

The code groups messages by assistant response identity so that tool use and its corresponding flow stay together across boundaries.

### Why this matters

This is a very reusable insight.

For agent systems, the natural unit of continuity is often not the human turn. It is the API round or execution round that keeps tool-use structure coherent.

That makes later summarization safer and less lossy.

## 5. Context Continuity Means Selective Stripping, Not Blind Summarization

`src/services/compact/compact.ts` contains logic for stripping or reducing content before compaction.

Examples include:

- stripping image blocks
- stripping document-like media blocks
- removing reinjected attachment types that would be restored anyway
- handling prompt-too-long retries

### Why this matters

This is not just about shrinking tokens. It is about deciding which information is:

- useful to summarize
- better represented as a marker
- safe to drop because it will be reintroduced later

That is a much more sophisticated model than summarize everything equally.

## 6. Restoration Budgeting Is Part Of The Design

The compaction subsystem also explicitly budgets what should be restored after compaction.

The code includes concepts such as:

- post-compact max files to restore
- skill token budgets
- per-file and per-skill restoration caps

### Why this matters

This reveals a core principle:

- continuity is not only about summary quality
- continuity is also about curated rehydration

A summary alone is often not enough for coding work. The runtime needs a controlled way to bring back crucial context artifacts.

## 7. The System Preserves Operating Context, Not Just Narrative Context

The compaction prompts and supporting logic show that the goal is not merely to tell the story of the conversation.

The goal is to preserve things needed to keep working, such as:

- relevant files
- recent tasks
- unresolved errors
- exact current focus
- next-step alignment with recent user intent

### Why this matters

This is one of the strongest lessons in the repo.

A useful compaction system should preserve operating context, not just discussion history.

## 8. Prompt-Too-Long Recovery Is Treated As A Runtime Concern

`compact.ts` includes explicit fallback behavior for prompt-too-long scenarios, including dropping older grouped history when necessary.

### Why this matters

This is a production-minded design choice.

Instead of failing hard when the summarizer itself hits limits, the runtime attempts degraded but safe recovery.

That is exactly the kind of behavior long-lived agent systems need.

## 9. Compaction Is Deeply Connected To Other Subsystems

The compaction code interacts with several neighboring concerns:

- hooks
- session storage
- file attachments
- skill discovery or reinjection
- token accounting
- analytics and streaming query logic

### Why this matters

This shows that continuity is not an isolated feature.

In a serious agent runtime, compaction sits at the intersection of memory, execution, prompting, and observability.

## 10. The Best Reusable Lessons For CodeNexus

This subsystem suggests several strong design principles.

### 10.1 Treat compaction as continuity engineering

Do not reduce it to summary generation.

### 10.2 Preserve execution-safe boundaries

API-round grouping is often more faithful than user-turn grouping.

### 10.3 Separate summarize, strip, and restore phases

They are different operations and should not be collapsed into one step.

### 10.4 Budget restoration deliberately

Rehydration should be selective, not accidental.

### 10.5 Preserve operating context, not just prose history

A coding agent needs actionable continuity.

## 11. Final Takeaway

The compaction design in `claude-code` is worth studying because it treats long-session durability as a core systems problem.

> the runtime is not asking how to make old context smaller; it is asking how to keep work continuous after context must shrink

That is exactly the kind of design maturity `CodeNexus` should preserve when learning from strong agent runtimes.

