import { describe, it, expect, beforeEach } from "vitest";
import { PromptTemplate, MessageBuilder, PromptRegistry } from "../src/prompt.js";

describe("PromptTemplate", () => {
  it("extracts variable names from template", () => {
    const t = new PromptTemplate("Hello {{name}}, you are {{role}}");
    expect(t.variables).toEqual(["name", "role"]);
  });

  it("deduplicates repeated variables", () => {
    const t = new PromptTemplate("{{x}} and {{x}} again");
    expect(t.variables).toEqual(["x"]);
  });

  it("formats template with variables", () => {
    const t = new PromptTemplate("Summarise: {{text}}");
    expect(t.format({ text: "Hello world" })).toBe("Summarise: Hello world");
  });

  it("replaces all occurrences of the same variable", () => {
    const t = new PromptTemplate("{{name}} said hello to {{name}}");
    expect(t.format({ name: "Alice" })).toBe("Alice said hello to Alice");
  });

  it("throws on missing variable", () => {
    const t = new PromptTemplate("Hello {{name}}");
    expect(() => t.format({})).toThrow('missing variable "{{name}}"');
  });

  it("preserves version", () => {
    const t = new PromptTemplate("test", "2.1.0");
    expect(t.version).toBe("2.1.0");
  });

  it("defaults to version 1.0.0", () => {
    const t = new PromptTemplate("test");
    expect(t.version).toBe("1.0.0");
  });

  it("estimates tokens for formatted output", () => {
    const t = new PromptTemplate("Hello {{name}}");
    const tokens = t.estimateTokens({ name: "World" });
    // "Hello World" = 11 chars → ceil(11/4) = 3
    expect(tokens).toBe(3);
  });

  it("handles template with no variables", () => {
    const t = new PromptTemplate("Static prompt with no vars");
    expect(t.variables).toEqual([]);
    expect(t.format({})).toBe("Static prompt with no vars");
  });
});

describe("MessageBuilder", () => {
  it("builds system + user messages", () => {
    const msgs = new MessageBuilder()
      .system("You are a helpful assistant")
      .user("Hello")
      .build();

    expect(msgs).toEqual([
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "Hello" },
    ]);
  });

  it("supports assistant messages", () => {
    const msgs = new MessageBuilder()
      .user("1+1?")
      .assistant("2")
      .user("2+2?")
      .build();

    expect(msgs).toHaveLength(3);
    expect(msgs[1].role).toBe("assistant");
  });

  it("injects few-shot examples", () => {
    const msgs = new MessageBuilder()
      .system("Translate English to French")
      .fewShot([
        { input: "Hello", output: "Bonjour" },
        { input: "Goodbye", output: "Au revoir" },
      ])
      .user("Thank you")
      .build();

    expect(msgs).toHaveLength(6); // system + 2 pairs + user
    expect(msgs[1]).toEqual({ role: "user", content: "Hello" });
    expect(msgs[2]).toEqual({ role: "assistant", content: "Bonjour" });
  });

  it("supports generic add()", () => {
    const msgs = new MessageBuilder()
      .add("system", "sys")
      .add("user", "usr")
      .build();

    expect(msgs).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("estimates tokens across all messages", () => {
    const builder = new MessageBuilder()
      .system("You are helpful") // 15 chars
      .user("Hi");              // 2 chars
    // Total: 17 chars → ceil(17/4) = 5
    expect(builder.estimateTokens()).toBe(5);
  });

  it("returns a copy from build() (not the internal array)", () => {
    const builder = new MessageBuilder().user("test");
    const msgs1 = builder.build();
    const msgs2 = builder.build();
    expect(msgs1).not.toBe(msgs2);
    expect(msgs1).toEqual(msgs2);
  });
});

describe("PromptRegistry", () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
  });

  it("registers and retrieves templates", () => {
    const t = new PromptTemplate("Hello {{name}}", "1.0.0");
    registry.register("greeting", t);
    expect(registry.get("greeting")).toBe(t);
  });

  it("checks existence", () => {
    expect(registry.has("nope")).toBe(false);
    registry.register("exists", new PromptTemplate("test"));
    expect(registry.has("exists")).toBe(true);
  });

  it("lists all template names", () => {
    registry.register("a", new PromptTemplate("a"));
    registry.register("b", new PromptTemplate("b"));
    expect(registry.list()).toEqual(["a", "b"]);
  });

  it("formats a template and returns metadata", () => {
    registry.register("summarise", new PromptTemplate("Summarise: {{text}}", "2.0.0"));
    const { text, meta } = registry.format("summarise", { text: "Hello" });

    expect(text).toBe("Summarise: Hello");
    expect(meta.templateName).toBe("summarise");
    expect(meta.version).toBe("2.0.0");
    expect(meta.variables).toEqual({ text: "Hello" });
    expect(meta.estimatedTokens).toBeGreaterThan(0);
  });

  it("throws when formatting unknown template", () => {
    expect(() => registry.format("unknown", {})).toThrow('template "unknown" not found');
  });
});
