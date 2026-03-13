import { describe, expect, it } from "vitest";
import {
  success,
  ok,
  created,
  noContent,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError,
  error,
  paginated,
} from "../src/response.js";
import type { PageInfo } from "../src/types.js";

describe("response", () => {
  describe("success", () => {
    it("wraps data in ok envelope", () => {
      const res = success({ id: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: { id: 1 } });
    });

    it("includes meta when provided", () => {
      const res = success("data", { requestId: "abc" });
      expect(res.body).toEqual({
        ok: true,
        data: "data",
        meta: { requestId: "abc" },
      });
    });
  });

  describe("ok", () => {
    it("is an alias for success", () => {
      const res = ok([1, 2, 3]);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: [1, 2, 3] });
    });
  });

  describe("created", () => {
    it("returns 201", () => {
      const res = created({ id: 42 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, data: { id: 42 } });
    });
  });

  describe("noContent", () => {
    it("returns 204 with null data", () => {
      const res = noContent();
      expect(res.status).toBe(204);
      expect(res.body).toEqual({ ok: true, data: null });
    });
  });

  describe("error helpers", () => {
    it("badRequest returns 400", () => {
      const res = badRequest("Invalid input", { field: "email" });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "Invalid input",
          details: { field: "email" },
        },
      });
    });

    it("badRequest uses default message", () => {
      const res = badRequest();
      expect(res.body).toEqual({
        ok: false,
        error: { code: "BAD_REQUEST", message: "Bad request" },
      });
    });

    it("unauthorized returns 401", () => {
      const res = unauthorized();
      expect(res.status).toBe(401);
      if (!res.body.ok) {
        expect(res.body.error.code).toBe("UNAUTHORIZED");
      }
    });

    it("forbidden returns 403", () => {
      const res = forbidden();
      expect(res.status).toBe(403);
      if (!res.body.ok) {
        expect(res.body.error.code).toBe("FORBIDDEN");
      }
    });

    it("notFound returns 404", () => {
      const res = notFound();
      expect(res.status).toBe(404);
      if (!res.body.ok) {
        expect(res.body.error.code).toBe("NOT_FOUND");
      }
    });

    it("conflict returns 409", () => {
      const res = conflict("Duplicate entry");
      expect(res.status).toBe(409);
      if (!res.body.ok) {
        expect(res.body.error.code).toBe("CONFLICT");
        expect(res.body.error.message).toBe("Duplicate entry");
      }
    });

    it("internalError returns 500", () => {
      const res = internalError();
      expect(res.status).toBe(500);
      if (!res.body.ok) {
        expect(res.body.error.code).toBe("INTERNAL_ERROR");
      }
    });
  });

  describe("generic error", () => {
    it("builds custom error responses", () => {
      const res = error(429, "RATE_LIMITED", "Too many requests", { retryAfter: 60 });
      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
          details: { retryAfter: 60 },
        },
      });
    });
  });

  describe("paginated", () => {
    it("builds paginated success response", () => {
      const pageInfo: PageInfo = {
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: "abc",
        endCursor: "xyz",
        totalCount: 100,
      };
      const res = paginated([{ id: 1 }, { id: 2 }], pageInfo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        data: [{ id: 1 }, { id: 2 }],
        meta: { pagination: pageInfo },
      });
    });
  });
});
