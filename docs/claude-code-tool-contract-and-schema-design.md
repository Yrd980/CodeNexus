# Claude Code Tool Contract And Schema Design

## Summary

This document studies how the cloned `claude-code` snapshot turns tools into typed contracts that can be safely exposed to the model, filtered at query time, and implemented by many different runtime surfaces.

Primary source snapshot:

- `/home/yrd/documents/git_clone_code/etc/claude-code`

The key conclusion is:

> `claude-code` does not treat a tool as a callable function plus a schema. It treats a tool as a multi-layer contract that separates runtime implementation, model-visible interface, policy hooks, UI semantics, and API transport shaping.

## 1. Why This Subsystem Matters

Many agent systems describe tools as if they only need three fields:

- a name
- an input schema
- a function body

This repository is much more explicit.

From `src/Tool.ts`, `src/utils/api.ts`, `src/services/api/claude.ts`, and representative tool implementations, the project models a tool as a governed boundary with several responsibilities:

- validate and normalize input
- express permission and safety semantics
- expose a model-facing schema
- control what becomes visible in the API request
- describe execution and UI behavior
- map runtime results back into transcript-safe tool results

That makes the tool layer one of the clearest examples of `claude-code` being a typed agent runtime rather than only a prompt wrapper.

## 2. The Core Model Or Mechanism

### 2.1 The base artifact is a full Tool contract, not a bare callback

`src/Tool.ts` defines a large `Tool` interface and a lighter `ToolDef` authoring shape. The interface includes not only `call(...)` and `inputSchema`, but also:

- `description(...)`
- `outputSchema`
- `isReadOnly(...)`
- `isConcurrencySafe(...)`
- `checkPermissions(...)`
- `validateInput(...)`
- `prompt(...)`
- `mapToolResultToToolResultBlockParam(...)`
- multiple UI rendering and transcript extraction hooks
- deferral and loading controls such as `shouldDefer` and `alwaysLoad`

This matters because the repository does not leave tool semantics to convention.

Instead, the contract itself carries:

- execution meaning
- governance entry points
- model-visible interface
- user-visible rendering behavior

That is a stronger separation than a plain function registry.

### 2.2 buildTool centralizes safe defaults

`buildTool(...)` in `src/Tool.ts` fills in default behavior for commonly omitted methods.

The defaults are intentionally conservative:

- `isConcurrencySafe` defaults to `false`
- `isReadOnly` defaults to `false`
- `isDestructive` defaults to `false`
- `checkPermissions` defaults to allow-through behavior that still returns normalized input
- `userFacingName` defaults to the tool name
- `toAutoClassifierInput` defaults to an empty value

The important reusable lesson is not the specific defaults. The lesson is that tool authors do not define every semantic knob ad hoc. A central constructor fills in the common safety and UI surface so the runtime always receives a complete tool object.

### 2.3 Model-facing schema is split from internal runtime shape

The tool contract separates several layers that many systems would collapse:

- `inputSchema`: the internal runtime input contract, usually Zod-based
- `inputJSONSchema`: an optional direct JSON Schema path for tools that cannot or should not derive it from Zod
- `outputSchema`: the runtime output shape
- `mapToolResultToToolResultBlockParam(...)`: the model-facing serialization boundary for tool results

This is a meaningful design choice.

The runtime does not assume that:

- internal input types are identical to API schema bytes
- runtime outputs can be handed to the model without translation
- tool result UI and tool result API serialization are the same concern

That split appears repeatedly in the codebase and is one of the strongest signs that the tool system is designed for transport stability rather than only local developer convenience.

### 2.4 API schema exposure is a separate projection step

`src/utils/api.ts` contains `toolToAPISchema(...)`, which converts a runtime `Tool` into the actual API schema sent to Anthropic.

That function adds another explicit layer between the tool registry and the model request:

- choose `inputJSONSchema` when available, otherwise convert Zod with `zodToJsonSchema(...)`
- filter swarm-only fields out of schemas when the feature is off
- cache session-stable tool schema components
- add `strict` only when both the tool and the selected model support it
- add `defer_loading` per request rather than baking it into the base tool definition
- strip unsupported experimental fields behind a kill switch for incompatible providers

So the model never sees the raw in-memory tool object.

It sees a transport-safe projection that depends on:

- feature gates
- provider capability
- model capability
- per-request deferral state

### 2.5 Query-time tool exposure is not equal to registry membership

`src/tools.ts` assembles the exhaustive tool set for the current environment, but `src/services/api/claude.ts` decides which of those tools the model actually sees for a given query.

That query-time layer does several important things:

- enable or disable ToolSearch
- precompute deferred tool names
- keep non-deferred tools always visible
- keep `ToolSearchTool` visible when deferred discovery is active
- expose deferred tools only after discovery through prior tool-reference flow
- mark certain tools with `defer_loading` when the request is built

This means the project distinguishes between:

- tools the runtime knows how to execute
- tools the current request is allowed to advertise
- tools whose full schema should be visible immediately
- tools that should be discovered lazily

That is much richer than a single global “available tools” list.

## 3. Representative Tool Evidence

### 3.1 BashTool shows contract hardening around a dangerous capability

`src/tools/BashTool/BashTool.tsx` is a good example of a powerful tool being narrowed by contract design rather than by prompt wording alone.

Observed behaviors include:

- a strict object input schema
- omission of internal-only fields from the model-facing schema
- tool-specific permission checks
- separate validation helpers for paths, sed edits, read-only mode, and background behavior
- `strict: true` for stronger schema adherence when the model supports it

The notable lesson is that dangerous tools are not made safe by one policy hook.
They are made safer by a stack of contract layers.

### 3.2 FileReadTool shows the same contract serving a read-only tool family

`src/tools/FileReadTool/FileReadTool.ts` uses the same base contract but expresses a different semantic profile:

- `isConcurrencySafe() => true`
- `isReadOnly() => true`
- `maxResultSizeChars: Infinity` because read output should not be persisted into a circular readback flow
- a discriminated output schema covering text, image, notebook, PDF, and unchanged-file cases
- explicit result mapping for transcript-safe output

This is useful evidence because it shows the tool contract is not specialized for shell execution.
It generalizes across very different tool families while preserving family-specific semantics.

### 3.3 AgentTool shows schema gating and execution-shape variability

`src/tools/AgentTool/AgentTool.tsx` shows how the same contract supports tools whose visible schema changes with runtime capability.

Important details include:

- feature-gated omission of fields such as `cwd` or `run_in_background`
- output schema as a union rather than a single fixed success shape
- prompt construction that filters eligible agents based on MCP availability and permission state
- runtime separation between public output schema and internal-only output cases

This is a strong example of `claude-code` preferring one stable tool artifact with controlled projections rather than spawning unrelated tool variants per feature mode.

### 3.4 ToolSearchTool shows deferred discovery as part of the tool layer

`src/tools/ToolSearchTool/ToolSearchTool.ts` is especially revealing because it exists only to make deferred tools usable without forcing every schema into the initial prompt.

Its behavior includes:

- searching deferred tools by keyword or direct selection
- caching prompt-derived descriptions for discovery quality
- invalidating caches when the deferred tool set changes
- returning only enough information to let the model surface the next contract

This confirms that deferred loading is not just an API optimization.
It is a first-class part of how the tool layer manages scale.

## 4. Evidence-Backed Reusable Lessons

### 4.1 Treat tool definition, tool transport, and tool execution as separate layers

The strongest reusable lesson is architectural separation.

`claude-code` does not assume that one object shape should directly satisfy:

- local implementation
- model-visible schema
- provider transport rules
- transcript/result rendering

That separation reduces drift when:

- providers differ in supported tool fields
- feature gates hide or reveal capabilities
- the same logical tool needs different visibility at different times

### 4.2 Centralize semantic defaults so the runtime sees complete contracts

`buildTool(...)` is portable as a design move.

If a system wants tools to carry safety and observability semantics, authors should not repeatedly hand-roll defaults. The constructor or registry layer should guarantee a complete object with known fallback behavior.

### 4.3 Deferred loading works best when registry and exposure are decoupled

The project keeps one runtime registry but does not dump the whole registry into every prompt.

That matters for future systems facing:

- large tool counts
- per-user dynamic MCP tools
- model limits on schema volume
- expensive prompt churn from environment-specific tool sets

The portable idea is not “copy ToolSearch exactly.” The portable idea is to separate:

- existence in the runtime
- discoverability in the conversation
- full schema visibility in the current request

### 4.4 Tool contracts become more durable when result mapping is explicit

The presence of `mapToolResultToToolResultBlockParam(...)` across tools is a subtle but important design choice.

It keeps runtime output and model-facing output from collapsing into one format too early. That reduces hidden coupling between:

- internal execution payloads
- transcript formatting
- API tool-result serialization

For a portable system, this is a strong reminder that output translation deserves its own boundary.

## 5. What Not To Copy Blindly

- Do not copy the entire `Tool` interface as-is. Much of it is specific to Ink UI, Anthropic API transport, and this repository's transcript model.
- Do not assume every future system needs deferred loading. The value appears when tool count, dynamic registration, or provider constraints make eager exposure expensive.
- Do not treat `strict`, `defer_loading`, and beta-header logic as universal tool concepts. Some of that is provider-specific adaptation rather than portable design truth.
- Do not flatten the lesson back into “tools need schemas.” The more durable lesson is that tools need layered contracts with explicit projection boundaries.

## 6. Final Takeaway

`claude-code` is a strong reference here because it treats a tool as an architecture boundary, not just an invocation primitive.

Observed behavior:

- tools are typed runtime artifacts with safety, UI, and transport semantics

Inferred design intent:

- keep implementation, governance, and model exposure from collapsing into one unstable object

Recommended reuse for `CodeNexus`:

- preserve the pattern of layered tool contracts
- separate registry membership from prompt exposure
- keep output/result translation explicit
- avoid copying host-specific API flags or UI hooks unless a future runtime genuinely needs them
