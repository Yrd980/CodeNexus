# Claude Code Skills System Analysis

## Summary

This document explains how `claude-code` implements its skills system based on the cloned source snapshot at:

- `/home/yrd/documents/git_clone_code/etc/claude-code`

The goal is not to describe the whole product. The goal is to isolate the real mechanics behind:

- how a skill is represented
- how skills are loaded
- how skills are executed
- how permissions and execution context are enforced
- which parts are transferable into a separate repository like `CodeNexus`

The main conclusion is:

> In `claude-code`, a skill is fundamentally a prompt command object with extra metadata and a dedicated execution tool. The durable design value is in the loading contract, metadata model, and execution boundary. The rest of the surrounding system is host-runtime infrastructure.

## 1. Core Model

### 1.1 A skill is not a magical primitive

The skills system is built on top of a shared `Command` shape. The decisive constructor is `createSkillCommand(...)` in `src/skills/loadSkillsDir.ts`.

That function returns an object with:

- `type: 'prompt'`
- `name`, `description`, `whenToUse`
- `allowedTools`
- `context` (`inline` or `fork`)
- `agent` / `effort` / `model`
- `skillRoot`
- `getPromptForCommand(...)`

So the skill is not stored as executable code first. It is stored as:

- metadata
- prompt body
- execution hints

This matters because it means the portable unit is a declarative workflow prompt, not a closed plugin binary.

### 1.2 The prompt body is assembled late

`getPromptForCommand(...)` does the final assembly at invocation time:

- prefixes `Base directory for this skill: <dir>` when the skill has a directory
- substitutes declared arguments
- replaces `${CLAUDE_SKILL_DIR}` and `${CLAUDE_SESSION_ID}`
- optionally executes shell snippets embedded in the prompt for non-MCP skills

This is an important design choice:

- skill definitions stay cheap to index
- expensive prompt expansion waits until execution
- the same skill metadata can support multiple loading sources

## 2. Skill Sources

`claude-code` does not have a single skill source. It merges several sources into one command universe.

### 2.1 Disk-backed skills

The canonical disk format is:

```text
skills/<skill-name>/SKILL.md
```

`loadSkillsFromSkillsDir(...)` only accepts directory entries and then looks for `SKILL.md` inside each one. Single loose markdown files inside `/skills` are intentionally ignored.

Frontmatter is parsed and turned into runtime fields by `parseSkillFrontmatterFields(...)`.

Key frontmatter-driven behavior includes:

- `description`
- `allowed-tools`
- `when_to_use`
- `arguments` and `argument-hint`
- `context`
- `agent`
- `model`
- `effort`
- `hooks`
- `paths`
- `user-invocable`

### 2.2 Bundled skills

Bundled skills live in `src/skills/bundled/` and are registered programmatically through `registerBundledSkill(...)` in `src/skills/bundledSkills.ts`.

They still become the same kind of runtime object:

- prompt command
- metadata-bearing
- invocable by the skill execution path

The difference is source and packaging:

- disk skills are user/project content
- bundled skills ship inside the CLI

Bundled skills can also extract reference files lazily to a deterministic runtime directory, then prepend that extracted base directory to the prompt. That gives bundled skills a near-equivalent "skill directory" contract without requiring the files to live on disk ahead of time.

### 2.3 Other command-like sources mixed into the same graph

`getCommands(...)` aggregates:

- bundled skills
- built-in plugin skills
- disk-backed skills
- workflow commands
- plugin commands
- plugin skills
- built-in commands

This is why the system can feel broader than "skills" alone. The host merges multiple prompt-capable sources into one registry, then later filters them for different surfaces.

## 3. Registration And Discovery

### 3.1 Bundled skills are registered early at startup

`src/main.tsx` calls `initBundledSkills()` before the command-loading promise kicks off.

That ordering is intentional. The inline comment explains the reason clearly:

- bundled skills are synchronous in-memory registrations
- command loading may start in parallel
- if bundled registration happens too late, the memoized command list can miss them

So skill registration is not just a content concern. It is part of startup correctness.

### 3.2 Skill surfaces are filtered views, not separate systems

Two especially important filtered views exist in `src/commands.ts`:

- `getSkillToolCommands(...)`
- `getSlashCommandToolSkills(...)`

The first one returns the prompt-based commands the model can invoke through the dedicated skill tool.

The second one is closer to the user-facing "skills" view and includes non-builtin prompt commands that qualify as skills by origin or metadata.

This shows a useful architectural principle:

- keep one merged command graph
- derive multiple product surfaces from filters

That is cleaner than building separate registries for "skills", "commands", and "plugins" too early.

## 4. Execution Path

### 4.1 The dedicated execution boundary is `SkillTool`

The central runtime boundary is `src/tools/SkillTool/SkillTool.ts`.

`SkillTool` does four important things:

1. validates that the requested name maps to a prompt command
2. rejects commands with `disableModelInvocation`
3. enforces permission rules on skill execution
4. runs the skill either inline or in a forked agent context

This means the skill system is not "markdown files directly executed by the model." It is "prompt commands mediated by a dedicated runtime tool."

### 4.2 Validation rules define the real boundary

During `validateInput(...)`, the tool checks that:

- the name is non-empty
- the command exists
- it is a prompt-based command
- model invocation is allowed

That boundary is subtle but important:

- not every slash command is a skill
- not every prompt command is user-facing
- not every prompt command may be model-invoked

### 4.3 Skills can run inline or forked

Execution context is a first-class part of the skill contract.

- `inline` means the skill expands into the current conversation flow
- `fork` means the skill runs in a sub-agent with its own context and budget

The forked path is implemented by `executeForkedSkill(...)`, which:

- prepares a derived command context
- spawns an agent id
- applies model/effort overrides
- streams sub-agent messages back as progress

This is one of the strongest ideas in the system because it lets "skill" express not only content, but execution topology.

## 5. Permission And Safety Model

### 5.1 Skill execution has its own permission layer

`SkillTool.checkPermissions(...)` evaluates allow/deny rules specifically for skill invocation.

That means there are two distinct permission ideas:

- permission to invoke the skill itself
- permissions granted to the tool calls that the skill may later trigger

This is stronger than treating a skill as a raw alias.

### 5.2 `allowedTools` is a runtime expansion hint

When a skill runs, `SkillTool` can extend the effective always-allow command list with the skill's `allowedTools`.

So `allowedTools` is not just documentation. It becomes a runtime context modifier.

This is a transferable pattern:

- keep permissions close to the workflow artifact
- let the workflow declare the minimal tool envelope it needs

### 5.3 MCP skills are deliberately constrained

The loader/execution path explicitly treats MCP skills as remote and untrusted:

- they are filtered separately
- shell execution embedded in prompt bodies is disabled for MCP-loaded skills

That distinction is important for any future `CodeNexus` design:

- local skill content can support stronger affordances
- remote skill content needs stricter trust boundaries

## 6. What Is Actually A "Skill" Here

If we strip away UI and product naming, a `claude-code` skill is really:

- a prompt-oriented workflow unit
- with metadata-rich frontmatter
- loaded from one of several sources
- materialized as a `Command`
- executed by `SkillTool`
- optionally isolated in a forked agent
- permission-aware

That gives us a more precise definition than "a markdown playbook."

## 7. Boundaries With Neighboring Systems

### 7.1 Skill vs slash command

User-facing slash syntax is only one invocation surface. The deeper runtime unit is still the prompt command object.

So a skill is not defined by the slash prefix. The slash prefix is just one exposure path.

### 7.2 Skill vs tool

Tools do imperative work like:

- bash execution
- file editing
- web fetch
- sub-agent control

Skills do not replace tools. Skills orchestrate model behavior around tools.

The dedicated `SkillTool` is therefore a wrapper/orchestrator boundary, not the workhorse itself.

### 7.3 Skill vs plugin

Plugins can contribute skills, but plugin is a packaging/extension source, not the core execution model.

This distinction matters because a future `CodeNexus` should avoid coupling "skill" too early to one plugin system.

### 7.4 Skill vs host-only infrastructure

The following are important in `claude-code` but are not the portable essence of a skill:

- analytics and telemetry events
- marketplace/discovery experiments
- startup parallelization details
- Anthropic-specific auth/provider availability checks
- REPL/TUI rendering details
- enterprise policy overlays

These are host-runtime concerns, not the minimal conceptual kernel.

## 8. Transferable Patterns Worth Keeping

These are the strongest reusable patterns for `CodeNexus`.

### 8.1 Declarative workflow artifact

Store a skill as:

- metadata
- prompt body
- execution hints

This is easier to inspect, diff, review, and port than opaque code-first extensions.

### 8.2 One merged registry, multiple filtered surfaces

Maintain one command/skill graph, then derive:

- model-invocable skills
- user-invocable skills
- bundled skills
- plugin-provided skills

This reduces duplication and keeps boundary logic explicit.

### 8.3 First-class execution context

Let skills declare whether they should:

- stay inline
- fork into a worker/sub-agent

That is more powerful than treating every skill as a plain template expansion.

### 8.4 Skill-local permission envelope

Attach minimal permissions to the skill definition, and let runtime apply them deliberately.

### 8.5 Late prompt materialization

Keep indexing/discovery cheap by storing metadata separately from full expansion behavior.

## 9. Patterns To Treat As Host-Specific

These are useful references but should not be copied blindly into `CodeNexus`:

- Anthropic-specific `Command` / product taxonomy
- marketplace and remote skill discovery experiments
- telemetry-heavy skill lifecycle instrumentation
- bundled-skill file extraction details tied to CLI packaging
- policy/auth/provider filters bound to one vendor runtime
- shell execution inside prompt markdown without a narrower trust model

The learning value is the design intent, not the exact implementation.

## 10. Practical Extraction Heuristic For CodeNexus

When studying another project, separate findings into three buckets:

### Bucket A: Portable skill-system primitives

- artifact format
- metadata contract
- execution modes
- permission attachment
- registry/filtering strategy

### Bucket B: Reusable workflow content

- debugging playbooks
- verification flows
- configuration update procedures
- recovery and "stuck" guidance

### Bucket C: Host-runtime glue

- product-specific UI
- analytics
- auth/account gating
- marketplace/discovery plumbing
- vendor-specific integrations

Only Buckets A and B should directly feed a future `CodeNexus` skills library.

## 11. Evidence Map

Primary source files used for this analysis:

- `src/main.tsx`: bundled skill initialization timing
- `src/commands.ts`: merged command loading and skill-facing filtered views
- `src/skills/loadSkillsDir.ts`: disk skill loading and frontmatter-to-command transformation
- `src/skills/bundledSkills.ts`: bundled skill registration and extracted base-directory contract
- `src/skills/bundled/skillify.ts`: how the project itself thinks about authoring a reusable skill
- `src/tools/SkillTool/SkillTool.ts`: validation, permission checks, and inline/fork execution

## 12. Final Takeaway

The most important insight is not "Claude Code has many skills."

It is this:

> The system works because skills are treated as typed, metadata-rich workflow commands with a dedicated runtime boundary.

That is the part worth carrying forward into `CodeNexus`.

If we later build our own repository around this insight, the likely next step is not to copy `claude-code` directly. The right next step is to design a smaller, cleaner skill artifact model that preserves:

- declarative skill content
- execution-mode choice
- permission attachment
- source-agnostic registration
- clear separation between portable skills and host-specific machinery
