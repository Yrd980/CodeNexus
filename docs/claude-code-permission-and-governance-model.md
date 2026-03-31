# Claude Code Permission And Governance Model

## Summary

This document studies the permission system in the cloned `claude-code` snapshot at:

- `/home/yrd/documents/git_clone_code/etc/claude-code`

The goal is not to list configuration toggles. The goal is to understand the deeper governance model that makes the runtime controllable.

The key conclusion is:

> `claude-code` treats permissions as a runtime governance pipeline, not as a static access list. Modes, rules, tool-specific checks, safety checks, and path-aware policy are all first-class parts of execution.

## 1. Why This Subsystem Matters

Many agent systems describe permissions in simple terms:

- allowed
- denied
- ask every time

This repository goes much further.

From `src/utils/permissions/*`, `src/Tool.ts`, and tool-specific `checkPermissions(...)` implementations, the project models permissions as a layered decision system.

That makes this subsystem one of the most reusable design references in the whole codebase.

## 2. The Core Runtime Object

The root data structure is `ToolPermissionContext` in `src/Tool.ts`.

It includes:

- `mode`
- `additionalWorkingDirectories`
- `alwaysAllowRules`
- `alwaysDenyRules`
- `alwaysAskRules`
- mode availability flags
- prompt-avoidance flags
- plan-mode restoration state

This already tells us something important:

- permissions are session state
- permissions are not only config files
- execution mode and policy state are tightly coupled

## 3. Permissions Are Built From Multiple Sources

`permissionSetup.ts` shows that the runtime composes permission state from several origins.

At minimum, policy can be shaped by:

- CLI arguments
- settings on disk
- managed or policy settings
- session-scoped updates
- command-scoped updates
- additional working directories

The system does not rely on one source of truth file. It uses a merged policy model.

### Why this matters

This lets the runtime distinguish between:

- durable baseline policy
- session-local overrides
- one-command temporary approvals
- environment-derived constraints

That is a much stronger design than a single flat allowlist.

## 4. Permission Mode Is A Behavioral Switch, Not A Label

`src/utils/permissions/PermissionMode.ts` shows that permission mode is treated as a typed runtime behavior profile.

Modes include things like:

- `default`
- `plan`
- `acceptEdits`
- `bypassPermissions`
- `dontAsk`
- `auto` in some builds

These are not cosmetic names. They control how the runtime behaves when a tool is requested.

### Why this matters

A system that only has rules but no mode model cannot express higher-level interaction contracts such as:

- planning without execution
- auto-accepting certain edit paths
- disabling prompts in headless contexts
- allowing stronger automation in tightly controlled circumstances

This repo shows that permission governance needs both:

- rule granularity
- mode semantics

## 5. Rule Shape Is More Expressive Than Tool-Level Allow And Deny

`PermissionRule.ts` and `permissions.ts` show that a rule is not just a tool name.

A rule has:

- a behavior: `allow`, `deny`, or `ask`
- a source
- a structured rule value with `toolName` and optional `ruleContent`

That optional `ruleContent` is important because it enables content-sensitive rules.

This means the system can represent distinctions like:

- deny this whole tool
- ask for this specific shell subcommand shape
- allow this narrow command family but not the entire shell tool

### Why this matters

This is the difference between:

- policy on capabilities
- policy on actions

The second is much closer to what agent runtimes actually need.

## 6. The Decision Pipeline Has Layers

`permissions.ts` makes it clear that the runtime does not jump straight from request to allow or deny.

The decision pipeline includes at least these layers:

1. blanket deny checks
2. blanket ask checks
3. tool-specific permission checks
4. content-specific ask or deny results
5. safety checks
6. mode-based transformations
7. hooks and classifier-related logic in some builds

This is one of the most important findings in the whole project.

### Why this matters

It means governance is intentionally staged. Different layers catch different classes of risk:

- global policy
- action shape
- filesystem or namespace sensitivity
- runtime mode constraints
- build-specific safety automation

A simpler system collapses all of those into one boolean and loses control.

## 7. Tool-Specific Permission Logic Is First-Class

The base permission framework is not expected to know everything.

Instead, each tool can implement `checkPermissions(...)`.

For example:

- `BashTool` delegates to a shell-aware permission function
- `AskUserQuestionTool` always returns an `ask` behavior
- `SkillTool` performs skill-name-specific rule matching

### Why this matters

This is a strong extensibility pattern:

- the framework handles generic governance
- the tool handles domain-specific semantics

That keeps the central system consistent without flattening away important distinctions.

## 8. Shell Permissions Are Treated As A Special Governance Problem

The shell path is where the design gets especially interesting.

`permissionSetup.ts`, `permissions.ts`, and `BashTool.tsx` together show that shell permissions are treated as especially dangerous and deserve their own checks.

Examples include:

- detection of overly broad shell permissions
- detection of dangerous permissions in auto mode
- command-shape-sensitive permission handling
- sandbox-aware ask and allow behavior

### Why this matters

This reflects a mature understanding of agent risk.

The shell is not just another tool. It is a capability amplifier.

A reusable lesson for `CodeNexus` is that command execution should usually get special governance treatment rather than inheriting generic tool policy.

## 9. Path And Workspace Semantics Are Part Of Permissions

The permission model is not just about which tool may run. It also cares about where operations happen.

Evidence from `permissionSetup.ts` and the filesystem permission utilities shows support for:

- additional working directories
- workspace validation
- symlink-aware path handling
- path-sensitive safety checks

### Why this matters

This is a major design strength.

Many systems say:

- editing is allowed

but the real question is:

- editing where

This repository treats workspace scope as part of governance, which is exactly right for coding agents.

## 10. Ask Is Not Failure

A subtle but important point in the design is that `ask` is a first-class, meaningful outcome.

It is not equivalent to:

- deny
- passthrough
- unknown

The system builds detailed permission request messages that preserve why approval is needed, including cases like:

- a rule requires approval
- a hook blocked the action
- a classifier requires approval
- current mode requires approval
- a safety check triggered

### Why this matters

This turns the governance layer into an explainable interface instead of a silent gate.

That improves trust, debugging, and operator control.

## 11. Permissions Are Bound To UX, Not Separate From It

The permission model clearly interacts with UX surfaces.

Examples include:

- mode titles and symbols
- permission request messaging
- headless prompt-avoidance flags
- session or UI behavior differences for tools that require interaction

### Why this matters

Governance is not only a backend concern here. It is a user-facing runtime contract.

That is important for any future design work: permission systems that ignore operator experience usually become confusing and brittle.

## 12. The Best Reusable Lessons For CodeNexus

This subsystem suggests several design principles worth carrying forward.

### 12.1 Model permissions as a pipeline

Do not reduce governance to one allowlist.

### 12.2 Separate policy sources from runtime state

Keep durable settings, session overrides, and command-scoped approvals distinct.

### 12.3 Keep tool-specific policy hooks

The shared framework should not erase domain-specific risk differences.

### 12.4 Treat shell execution as a special case

Command execution deserves deeper controls than ordinary read-only tools.

### 12.5 Make ask outcomes explainable

Approval prompts should preserve why the runtime paused.

### 12.6 Make workspace scope part of governance

Path, directory, and boundary semantics should be explicit.

## 13. What Not To Copy Blindly

Some parts of this permission system are likely too tied to the host product to copy directly:

- Anthropic-specific build flags and classifier gates
- product-specific mode availability logic
- vendor-specific telemetry around approval events
- implementation details tied to this exact CLI and UI stack

The reusable value is the shape of the governance model, not every branch and feature flag.

## 14. Final Takeaway

The permission subsystem in `claude-code` is worth serious study because it solves a hard problem cleanly:

> how to let an agent stay powerful without letting governance collapse into a blunt yes or no toggle

That is exactly the kind of design maturity `CodeNexus` should preserve when extracting patterns from strong upstream projects.
