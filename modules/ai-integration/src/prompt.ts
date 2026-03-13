/**
 * AI Integration — Prompt Management
 *
 * Why prompt management matters:
 * - Inline prompt strings are untestable, unreviewable, and un-versionable.
 * - Template interpolation prevents injection bugs and enables A/B testing.
 * - Few-shot injection is a pattern you'll use in every LLM feature.
 * - Token estimation (even rough) prevents "context too long" surprises.
 *
 * This module is intentionally dependency-free.  We use a simple `{{var}}`
 * interpolation scheme rather than pulling in a template engine.
 */

import type { Message, MessageRole } from "./types.js";
import { estimateTokens } from "./provider.js";

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

/**
 * A reusable prompt template with `{{variable}}` interpolation.
 *
 * ```ts
 * const t = new PromptTemplate("Summarise this: {{text}}", "v1");
 * const msg = t.format({ text: "Hello world" });
 * // → "Summarise this: Hello world"
 * ```
 */
export class PromptTemplate {
  /** All `{{varName}}` placeholders found in the template. */
  readonly variables: string[];

  constructor(
    /** Raw template string with `{{var}}` placeholders. */
    public readonly template: string,
    /** Semantic version string for tracking which prompt produced a result. */
    public readonly version: string = "1.0.0",
  ) {
    // Extract variable names from template
    const matches = template.matchAll(/\{\{(\w+)\}\}/g);
    this.variables = [...new Set([...matches].map((m) => m[1]!))].filter(
      (v): v is string => v !== undefined,
    );
  }

  /**
   * Interpolate variables into the template.
   * Throws if a required variable is missing.
   */
  format(vars: Record<string, string>): string {
    let result = this.template;

    for (const name of this.variables) {
      if (!(name in vars)) {
        throw new Error(
          `PromptTemplate (${this.version}): missing variable "{{${name}}}". ` +
            `Required: [${this.variables.join(", ")}]`,
        );
      }
      // Replace all occurrences of {{name}}
      result = result.replaceAll(`{{${name}}}`, vars[name]!);
    }

    return result;
  }

  /** Estimate token count for a formatted prompt. */
  estimateTokens(vars: Record<string, string>): number {
    return estimateTokens(this.format(vars));
  }
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

/** Fluent builder for constructing message arrays. */
export class MessageBuilder {
  private readonly messages: Message[] = [];

  /** Add a system message. */
  system(content: string): this {
    this.messages.push({ role: "system", content });
    return this;
  }

  /** Add a user message. */
  user(content: string): this {
    this.messages.push({ role: "user", content });
    return this;
  }

  /** Add an assistant message. */
  assistant(content: string): this {
    this.messages.push({ role: "assistant", content });
    return this;
  }

  /** Add a message with an explicit role. */
  add(role: MessageRole, content: string): this {
    this.messages.push({ role, content });
    return this;
  }

  /**
   * Inject few-shot examples.
   * Each example is a [user, assistant] pair.
   */
  fewShot(examples: Array<{ input: string; output: string }>): this {
    for (const ex of examples) {
      this.messages.push({ role: "user", content: ex.input });
      this.messages.push({ role: "assistant", content: ex.output });
    }
    return this;
  }

  /** Return the built message array. */
  build(): Message[] {
    return [...this.messages];
  }

  /** Estimate total token count across all messages. */
  estimateTokens(): number {
    const text = this.messages.map((m) => m.content).join("");
    return estimateTokens(text);
  }
}

// ---------------------------------------------------------------------------
// Prompt versioning / registry
// ---------------------------------------------------------------------------

/** Metadata attached to a prompt result for traceability. */
export interface PromptMeta {
  templateName: string;
  version: string;
  variables: Record<string, string>;
  estimatedTokens: number;
}

/**
 * A simple in-memory prompt registry.
 *
 * Register named templates, then retrieve and format them with full
 * provenance metadata.  In production you'd back this with a database
 * or config file, but the interface stays the same.
 */
export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>();

  /** Register a named prompt template. */
  register(name: string, template: PromptTemplate): void {
    this.templates.set(name, template);
  }

  /** Get a template by name. */
  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /** Check if a template exists. */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /** List all registered template names. */
  list(): string[] {
    return [...this.templates.keys()];
  }

  /**
   * Format a named template and return both the rendered string
   * and provenance metadata.
   */
  format(
    name: string,
    vars: Record<string, string>,
  ): { text: string; meta: PromptMeta } {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`PromptRegistry: template "${name}" not found. ` +
        `Available: [${this.list().join(", ")}]`);
    }

    const text = template.format(vars);
    return {
      text,
      meta: {
        templateName: name,
        version: template.version,
        variables: { ...vars },
        estimatedTokens: estimateTokens(text),
      },
    };
  }
}
