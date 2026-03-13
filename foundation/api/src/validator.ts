/**
 * Lightweight request validation with a schema DSL.
 *
 * Why not Zod?  Validation is too fundamental to depend on a 13 kB library.
 * This module provides the 80 % of validation that every API needs with zero
 * runtime dependencies, while keeping the door open for Zod interop later.
 */

import type {
  ArraySchema,
  BooleanSchema,
  CustomRule,
  EnumSchema,
  NumberSchema,
  ObjectSchema,
  SchemaNode,
  StringSchema,
  ValidationError,
  ValidationResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Schema builder DSL
// ---------------------------------------------------------------------------

export function string(
  opts: Omit<StringSchema, "kind"> = {},
): StringSchema {
  return { kind: "string", ...opts };
}

export function number(
  opts: Omit<NumberSchema, "kind"> = {},
): NumberSchema {
  return { kind: "number", ...opts };
}

export function boolean(
  opts: Omit<BooleanSchema, "kind"> = {},
): BooleanSchema {
  return { kind: "boolean", ...opts };
}

export function object(
  properties: Record<string, SchemaNode>,
  opts: Omit<ObjectSchema, "kind" | "properties"> = {},
): ObjectSchema {
  return { kind: "object", properties, ...opts };
}

export function array(
  items: SchemaNode,
  opts: Omit<ArraySchema, "kind" | "items"> = {},
): ArraySchema {
  return { kind: "array", items, ...opts };
}

export function enumType(
  values: readonly (string | number)[],
  opts: Omit<EnumSchema, "kind" | "values"> = {},
): EnumSchema {
  return { kind: "enum", values, ...opts };
}

/** Mark any schema node as optional. Returns a shallow copy. */
export function optional<T extends SchemaNode>(schema: T): T {
  return { ...schema, optional: true };
}

/** Attach a custom validation rule to any schema node. */
export function withRule<T extends SchemaNode>(schema: T, rule: CustomRule): T {
  const existing = schema.customRules ?? [];
  return { ...schema, customRules: [...existing, rule] };
}

// ---------------------------------------------------------------------------
// Coercion helpers (query/path params arrive as strings)
// ---------------------------------------------------------------------------

function coerce(value: unknown, schema: SchemaNode): unknown {
  if (typeof value !== "string") return value;

  switch (schema.kind) {
    case "number": {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
      return value; // leave as-is; validation will catch it
    }
    case "boolean": {
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      return value;
    }
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// Core validate function
// ---------------------------------------------------------------------------

function validateNode(
  value: unknown,
  schema: SchemaNode,
  path: string,
  errors: ValidationError[],
  shouldCoerce: boolean,
): unknown {
  // Handle undefined / null for optional fields
  if (value === undefined || value === null) {
    if (schema.optional) return value;
    errors.push({ path, message: "Required" });
    return value;
  }

  const coerced = shouldCoerce ? coerce(value, schema) : value;

  switch (schema.kind) {
    case "string":
      return validateString(coerced, schema, path, errors);
    case "number":
      return validateNumber(coerced, schema, path, errors);
    case "boolean":
      return validateBoolean(coerced, schema, path, errors);
    case "object":
      return validateObject(coerced, schema, path, errors, shouldCoerce);
    case "array":
      return validateArray(coerced, schema, path, errors, shouldCoerce);
    case "enum":
      return validateEnum(coerced, schema, path, errors);
  }
}

function validateString(
  value: unknown,
  schema: StringSchema,
  path: string,
  errors: ValidationError[],
): unknown {
  if (typeof value !== "string") {
    errors.push({ path, message: "Expected string" });
    return value;
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({ path, message: `Minimum length is ${schema.minLength}` });
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({ path, message: `Maximum length is ${schema.maxLength}` });
  }
  if (schema.pattern && !schema.pattern.test(value)) {
    errors.push({ path, message: `Does not match pattern ${schema.pattern}` });
  }
  runCustomRules(value, schema, path, errors);
  return value;
}

function validateNumber(
  value: unknown,
  schema: NumberSchema,
  path: string,
  errors: ValidationError[],
): unknown {
  if (typeof value !== "number" || Number.isNaN(value)) {
    errors.push({ path, message: "Expected number" });
    return value;
  }
  if (schema.integer && !Number.isInteger(value)) {
    errors.push({ path, message: "Expected integer" });
  }
  if (schema.min !== undefined && value < schema.min) {
    errors.push({ path, message: `Minimum value is ${schema.min}` });
  }
  if (schema.max !== undefined && value > schema.max) {
    errors.push({ path, message: `Maximum value is ${schema.max}` });
  }
  runCustomRules(value, schema, path, errors);
  return value;
}

function validateBoolean(
  value: unknown,
  schema: BooleanSchema,
  path: string,
  errors: ValidationError[],
): unknown {
  if (typeof value !== "boolean") {
    errors.push({ path, message: "Expected boolean" });
    return value;
  }
  runCustomRules(value, schema, path, errors);
  return value;
}

function validateObject(
  value: unknown,
  schema: ObjectSchema,
  path: string,
  errors: ValidationError[],
  shouldCoerce: boolean,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push({ path, message: "Expected object" });
    return value;
  }
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const fieldPath = path ? `${path}.${key}` : key;
    result[key] = validateNode(obj[key], propSchema, fieldPath, errors, shouldCoerce);
  }

  runCustomRules(value, schema, path, errors);
  return result;
}

function validateArray(
  value: unknown,
  schema: ArraySchema,
  path: string,
  errors: ValidationError[],
  shouldCoerce: boolean,
): unknown {
  if (!Array.isArray(value)) {
    errors.push({ path, message: "Expected array" });
    return value;
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({ path, message: `Minimum items is ${schema.minItems}` });
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({ path, message: `Maximum items is ${schema.maxItems}` });
  }
  const result = value.map((item, i) =>
    validateNode(item, schema.items, `${path}[${i}]`, errors, shouldCoerce),
  );
  runCustomRules(value, schema, path, errors);
  return result;
}

function validateEnum(
  value: unknown,
  schema: EnumSchema,
  path: string,
  errors: ValidationError[],
): unknown {
  if (!(schema.values as readonly unknown[]).includes(value)) {
    errors.push({
      path,
      message: `Must be one of: ${schema.values.join(", ")}`,
    });
  }
  runCustomRules(value, schema, path, errors);
  return value;
}

function runCustomRules(
  value: unknown,
  schema: SchemaNode,
  path: string,
  errors: ValidationError[],
): void {
  if (!schema.customRules) return;
  for (const rule of schema.customRules) {
    if (!rule.validate(value)) {
      errors.push({ path, message: rule.message });
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Enable coercion of string values (useful for query/path params). Default: false */
  coerce?: boolean;
}

/**
 * Validate an unknown value against a schema.
 *
 * @returns A discriminated union: `{ success: true, data }` or `{ success: false, errors }`.
 */
export function validate<T = unknown>(
  value: unknown,
  schema: SchemaNode,
  options: ValidateOptions = {},
): ValidationResult<T> {
  const errors: ValidationError[] = [];
  const data = validateNode(value, schema, "", errors, options.coerce ?? false);

  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, data: data as T };
}
