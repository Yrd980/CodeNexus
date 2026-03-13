import { describe, expect, it } from "vitest";
import {
  string,
  number,
  boolean,
  object,
  array,
  enumType,
  optional,
  withRule,
  validate,
} from "../src/validator.js";

describe("validator", () => {
  // -----------------------------------------------------------------------
  // String validation
  // -----------------------------------------------------------------------
  describe("string", () => {
    it("accepts a valid string", () => {
      const result = validate("hello", string());
      expect(result).toEqual({ success: true, data: "hello" });
    });

    it("rejects non-string", () => {
      const result = validate(42, string());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toBe("Expected string");
      }
    });

    it("enforces minLength", () => {
      const result = validate("ab", string({ minLength: 3 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toContain("Minimum length");
      }
    });

    it("enforces maxLength", () => {
      const result = validate("abcdef", string({ maxLength: 3 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toContain("Maximum length");
      }
    });

    it("enforces pattern", () => {
      const result = validate("abc", string({ pattern: /^\d+$/ }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toContain("pattern");
      }
    });

    it("accepts string matching pattern", () => {
      const result = validate("123", string({ pattern: /^\d+$/ }));
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Number validation
  // -----------------------------------------------------------------------
  describe("number", () => {
    it("accepts a valid number", () => {
      const result = validate(42, number());
      expect(result).toEqual({ success: true, data: 42 });
    });

    it("rejects non-number", () => {
      const result = validate("hello", number());
      expect(result.success).toBe(false);
    });

    it("rejects NaN", () => {
      const result = validate(NaN, number());
      expect(result.success).toBe(false);
    });

    it("enforces min", () => {
      const result = validate(3, number({ min: 5 }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toContain("Minimum value");
      }
    });

    it("enforces max", () => {
      const result = validate(10, number({ max: 5 }));
      expect(result.success).toBe(false);
    });

    it("enforces integer", () => {
      const result = validate(3.14, number({ integer: true }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toContain("integer");
      }
    });

    it("accepts integer when required", () => {
      const result = validate(3, number({ integer: true }));
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Boolean validation
  // -----------------------------------------------------------------------
  describe("boolean", () => {
    it("accepts true", () => {
      const result = validate(true, boolean());
      expect(result).toEqual({ success: true, data: true });
    });

    it("accepts false", () => {
      const result = validate(false, boolean());
      expect(result).toEqual({ success: true, data: false });
    });

    it("rejects non-boolean", () => {
      const result = validate("true", boolean());
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Object validation
  // -----------------------------------------------------------------------
  describe("object", () => {
    it("validates a simple object", () => {
      const schema = object({
        name: string(),
        age: number(),
      });
      const result = validate({ name: "Alice", age: 30 }, schema);
      expect(result).toEqual({ success: true, data: { name: "Alice", age: 30 } });
    });

    it("collects multiple errors", () => {
      const schema = object({
        name: string(),
        age: number(),
      });
      const result = validate({ name: 123, age: "old" }, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(2);
      }
    });

    it("requires missing fields", () => {
      const schema = object({ name: string() });
      const result = validate({}, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].path).toBe("name");
        expect(result.errors[0].message).toBe("Required");
      }
    });

    it("rejects non-object values", () => {
      const schema = object({ name: string() });
      const result = validate("not an object", schema);
      expect(result.success).toBe(false);
    });

    it("rejects arrays as objects", () => {
      const schema = object({ name: string() });
      const result = validate([1, 2], schema);
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Array validation
  // -----------------------------------------------------------------------
  describe("array", () => {
    it("validates an array of strings", () => {
      const schema = array(string());
      const result = validate(["a", "b", "c"], schema);
      expect(result).toEqual({ success: true, data: ["a", "b", "c"] });
    });

    it("rejects non-array", () => {
      const result = validate("nope", array(string()));
      expect(result.success).toBe(false);
    });

    it("validates items individually", () => {
      const result = validate(["a", 2, "c"], array(string()));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].path).toBe("[1]");
      }
    });

    it("enforces minItems", () => {
      const result = validate([], array(string(), { minItems: 1 }));
      expect(result.success).toBe(false);
    });

    it("enforces maxItems", () => {
      const result = validate([1, 2, 3], array(number(), { maxItems: 2 }));
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Enum validation
  // -----------------------------------------------------------------------
  describe("enum", () => {
    it("accepts valid enum value", () => {
      const schema = enumType(["active", "inactive"] as const);
      const result = validate("active", schema);
      expect(result.success).toBe(true);
    });

    it("rejects invalid enum value", () => {
      const schema = enumType(["active", "inactive"] as const);
      const result = validate("deleted", schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toContain("Must be one of");
      }
    });

    it("works with numeric enums", () => {
      const schema = enumType([1, 2, 3] as const);
      expect(validate(2, schema).success).toBe(true);
      expect(validate(4, schema).success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Optional
  // -----------------------------------------------------------------------
  describe("optional", () => {
    it("allows undefined for optional fields", () => {
      const schema = object({
        name: string(),
        nickname: optional(string()),
      });
      const result = validate({ name: "Alice" }, schema);
      expect(result.success).toBe(true);
    });

    it("still validates when value is present", () => {
      const schema = object({
        name: string(),
        age: optional(number()),
      });
      const result = validate({ name: "Alice", age: "not-a-number" }, schema);
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Coercion
  // -----------------------------------------------------------------------
  describe("coercion", () => {
    it("coerces string to number", () => {
      const result = validate("42", number(), { coerce: true });
      expect(result).toEqual({ success: true, data: 42 });
    });

    it("coerces 'true' to boolean", () => {
      const result = validate("true", boolean(), { coerce: true });
      expect(result).toEqual({ success: true, data: true });
    });

    it("coerces 'false' to boolean", () => {
      const result = validate("false", boolean(), { coerce: true });
      expect(result).toEqual({ success: true, data: false });
    });

    it("coerces '1' to true", () => {
      const result = validate("1", boolean(), { coerce: true });
      expect(result).toEqual({ success: true, data: true });
    });

    it("coerces '0' to false", () => {
      const result = validate("0", boolean(), { coerce: true });
      expect(result).toEqual({ success: true, data: false });
    });

    it("does not coerce when option is off", () => {
      const result = validate("42", number());
      expect(result.success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Custom rules
  // -----------------------------------------------------------------------
  describe("custom rules", () => {
    it("applies a custom validation rule", () => {
      const email = withRule(string(), {
        name: "email",
        validate: (v) => typeof v === "string" && v.includes("@"),
        message: "Must be a valid email",
      });
      expect(validate("user@example.com", email).success).toBe(true);
      const result = validate("not-email", email);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].message).toBe("Must be a valid email");
      }
    });

    it("stacks multiple custom rules", () => {
      let schema = withRule(string(), {
        name: "has-at",
        validate: (v) => typeof v === "string" && v.includes("@"),
        message: "Must contain @",
      });
      schema = withRule(schema, {
        name: "has-dot",
        validate: (v) => typeof v === "string" && v.includes("."),
        message: "Must contain .",
      });
      const result = validate("nope", schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toHaveLength(2);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Nested object
  // -----------------------------------------------------------------------
  describe("nested", () => {
    it("validates nested objects with correct paths", () => {
      const schema = object({
        user: object({
          name: string(),
          address: object({
            city: string(),
          }),
        }),
      });
      const result = validate({ user: { name: "Alice", address: { city: 123 } } }, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0].path).toBe("user.address.city");
      }
    });
  });
});
