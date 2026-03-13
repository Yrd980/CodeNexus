/**
 * Lightweight template engine with Mustache-like syntax.
 *
 * Supported constructs:
 *   {{variable}}                 — interpolation (HTML-escaped for email)
 *   {{#if variable}}...{{/if}}  — conditional block
 *   {{#each items}}...{{/each}} — loop ({{.}} = current item,
 *                                        {{.property}} for object items)
 *
 * Designed for notification bodies — intentionally minimal.
 * For complex email layouts, render upstream and pass HTML via a variable.
 */

import type { NotificationChannel, Template } from "./types.js";

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path like "user.name" against a data object.
 * Returns `undefined` when the path does not exist.
 */
function resolvePath(
  data: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Render a template string against the supplied data.
 *
 * Processing order:
 *   1. {{#each ...}} loops
 *   2. {{#if ...}} conditionals
 *   3. {{variable}} interpolation
 */
export function renderTemplate(
  template: string,
  data: Record<string, unknown>,
  channel: NotificationChannel = "email",
): string {
  let result = template;

  // 1. {{#each items}}...{{/each}}
  result = result.replace(
    /\{\{#each\s+(\w[\w.]*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key: string, inner: string) => {
      const list = resolvePath(data, key);
      if (!Array.isArray(list)) return "";
      return list
        .map((item: unknown) => {
          if (typeof item === "object" && item !== null) {
            // Replace {{.property}} with item.property
            let rendered = inner.replace(
              /\{\{\.([\w.]+)\}\}/g,
              (_m: string, prop: string) => {
                const val = resolvePath(
                  item as Record<string, unknown>,
                  prop,
                );
                return escapeValue(val, channel);
              },
            );
            // Replace {{.}} with string representation
            rendered = rendered.replace(/\{\{\.\}\}/g, String(item));
            return rendered;
          }
          // Primitive items — replace {{.}} with value
          return inner.replace(/\{\{\.\}\}/g, escapeValue(item, channel));
        })
        .join("");
    },
  );

  // 2. {{#if variable}}...{{/if}}
  result = result.replace(
    /\{\{#if\s+(\w[\w.]*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, key: string, inner: string) => {
      const value = resolvePath(data, key);
      return isTruthy(value) ? inner : "";
    },
  );

  // 3. {{variable}} interpolation
  result = result.replace(
    /\{\{(\w[\w.]*)\}\}/g,
    (_match, key: string) => {
      const value = resolvePath(data, key);
      return escapeValue(value, channel);
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/** HTML-escape a value (only for email channel). */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeValue(value: unknown, channel: NotificationChannel): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return channel === "email" ? escapeHtml(str) : str;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Variables referenced in a template string. */
export function extractVariables(template: string): string[] {
  const vars = new Set<string>();

  // Simple interpolation: {{variable}}
  const simpleRe = /\{\{(\w[\w.]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = simpleRe.exec(template)) !== null) {
    const captured = m[1];
    if (captured !== undefined) vars.add(captured);
  }

  // Conditionals: {{#if variable}}
  const ifRe = /\{\{#if\s+(\w[\w.]*)\}\}/g;
  while ((m = ifRe.exec(template)) !== null) {
    const captured = m[1];
    if (captured !== undefined) vars.add(captured);
  }

  // Loops: {{#each variable}}
  const eachRe = /\{\{#each\s+(\w[\w.]*)\}\}/g;
  while ((m = eachRe.exec(template)) !== null) {
    const captured = m[1];
    if (captured !== undefined) vars.add(captured);
  }

  return [...vars];
}

/**
 * Validate that `data` contains all variables referenced by the template.
 * Returns an array of missing variable names (empty = valid).
 */
export function validateTemplate(
  template: Template,
  data: Record<string, unknown>,
): string[] {
  const allText = `${template.subject} ${template.body}`;
  const required = extractVariables(allText);
  return required.filter((v) => resolvePath(data, v) === undefined);
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** Render a template with sample data for preview purposes. */
export function previewTemplate(
  template: Template,
  sampleData: Record<string, unknown>,
): { subject: string; body: string } {
  return {
    subject: renderTemplate(template.subject, sampleData, template.channel),
    body: renderTemplate(template.body, sampleData, template.channel),
  };
}
