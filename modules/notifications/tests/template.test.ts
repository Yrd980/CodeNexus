import { describe, expect, it } from "vitest";
import {
  extractVariables,
  previewTemplate,
  renderTemplate,
  validateTemplate,
} from "../src/template.js";
import type { Template } from "../src/types.js";

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe("renderTemplate", () => {
  it("interpolates simple variables", () => {
    const result = renderTemplate("Hello {{name}}", { name: "Alice" });
    expect(result).toBe("Hello Alice");
  });

  it("interpolates nested dot-path variables", () => {
    const result = renderTemplate("Hi {{user.name}}", {
      user: { name: "Bob" },
    });
    expect(result).toBe("Hi Bob");
  });

  it("replaces missing variables with empty string", () => {
    const result = renderTemplate("Hello {{name}}", {});
    expect(result).toBe("Hello ");
  });

  it("HTML-escapes values for email channel", () => {
    const result = renderTemplate(
      "Hello {{name}}",
      { name: "<script>alert(1)</script>" },
      "email",
    );
    expect(result).toBe("Hello &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does NOT HTML-escape for sms channel", () => {
    const result = renderTemplate(
      "Code: {{code}}",
      { code: "A&B" },
      "sms",
    );
    expect(result).toBe("Code: A&B");
  });

  it("renders conditional blocks when truthy", () => {
    const result = renderTemplate(
      "{{#if premium}}VIP access{{/if}}",
      { premium: true },
    );
    expect(result).toBe("VIP access");
  });

  it("hides conditional blocks when falsy", () => {
    const result = renderTemplate(
      "Hello{{#if premium}} VIP{{/if}}!",
      { premium: false },
    );
    expect(result).toBe("Hello!");
  });

  it("treats empty arrays as falsy in conditionals", () => {
    const result = renderTemplate(
      "{{#if items}}has items{{/if}}",
      { items: [] },
    );
    expect(result).toBe("");
  });

  it("renders loops with primitive items", () => {
    const result = renderTemplate(
      "{{#each fruits}}{{.}} {{/each}}",
      { fruits: ["apple", "banana"] },
      "sms",
    );
    expect(result).toBe("apple banana ");
  });

  it("renders loops with object items using dot notation", () => {
    const result = renderTemplate(
      "{{#each users}}{{.name}}: {{.role}} | {{/each}}",
      {
        users: [
          { name: "Alice", role: "admin" },
          { name: "Bob", role: "user" },
        ],
      },
      "sms",
    );
    expect(result).toBe("Alice: admin | Bob: user | ");
  });

  it("renders empty string for non-array loop variable", () => {
    const result = renderTemplate(
      "{{#each missing}}{{.}}{{/each}}",
      {},
    );
    expect(result).toBe("");
  });

  it("handles multiple constructs in one template", () => {
    const tpl =
      "Hi {{name}}! {{#if vip}}[VIP]{{/if}} Items: {{#each items}}{{.}},{{/each}}";
    const result = renderTemplate(
      tpl,
      { name: "Alice", vip: true, items: ["a", "b"] },
      "sms",
    );
    expect(result).toBe("Hi Alice! [VIP] Items: a,b,");
  });
});

// ---------------------------------------------------------------------------
// extractVariables
// ---------------------------------------------------------------------------

describe("extractVariables", () => {
  it("extracts simple variables", () => {
    const vars = extractVariables("{{name}} and {{email}}");
    expect(vars).toContain("name");
    expect(vars).toContain("email");
  });

  it("extracts variables from conditionals", () => {
    const vars = extractVariables("{{#if premium}}yes{{/if}}");
    expect(vars).toContain("premium");
  });

  it("extracts variables from loops", () => {
    const vars = extractVariables("{{#each items}}{{.}}{{/each}}");
    expect(vars).toContain("items");
  });

  it("deduplicates repeated variables", () => {
    const vars = extractVariables("{{name}} and {{name}}");
    expect(vars.filter((v) => v === "name")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validateTemplate
// ---------------------------------------------------------------------------

describe("validateTemplate", () => {
  const template: Template = {
    id: "welcome",
    name: "Welcome",
    channel: "email",
    subject: "Welcome {{name}}",
    body: "Hello {{name}}, your plan is {{plan}}.",
  };

  it("returns empty array when all variables present", () => {
    const missing = validateTemplate(template, {
      name: "Alice",
      plan: "pro",
    });
    expect(missing).toEqual([]);
  });

  it("returns missing variable names", () => {
    const missing = validateTemplate(template, { name: "Alice" });
    expect(missing).toEqual(["plan"]);
  });

  it("returns all missing variables", () => {
    const missing = validateTemplate(template, {});
    expect(missing).toContain("name");
    expect(missing).toContain("plan");
  });
});

// ---------------------------------------------------------------------------
// previewTemplate
// ---------------------------------------------------------------------------

describe("previewTemplate", () => {
  it("renders both subject and body with sample data", () => {
    const template: Template = {
      id: "order",
      name: "Order Confirmation",
      channel: "email",
      subject: "Order #{{orderId}}",
      body: "Thank you {{name}}, your order #{{orderId}} is confirmed.",
    };

    const preview = previewTemplate(template, {
      orderId: "123",
      name: "Alice",
    });

    expect(preview.subject).toBe("Order #123");
    expect(preview.body).toBe(
      "Thank you Alice, your order #123 is confirmed.",
    );
  });
});
