import { describe, expect, it } from "vitest";
import { Router } from "../src/router.js";
import type { ApiRequest, ApiResponse, Middleware } from "../src/types.js";
import { ok } from "../src/response.js";

function makeRequest(
  overrides: Partial<ApiRequest> = {},
): ApiRequest {
  return {
    method: "GET",
    path: "/",
    headers: {},
    query: {},
    params: {},
    body: null,
    ...overrides,
  };
}

describe("Router", () => {
  describe("route matching", () => {
    it("matches a simple GET route", async () => {
      const router = new Router();
      router.get("/hello", () => ok("world"));

      const res = await router.handle(makeRequest({ path: "/hello" }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: "world" });
    });

    it("returns 404 for unmatched route", async () => {
      const router = new Router();
      router.get("/hello", () => ok("world"));

      const res = await router.handle(makeRequest({ path: "/bye" }));
      expect(res.status).toBe(404);
    });

    it("matches by HTTP method", async () => {
      const router = new Router();
      router.get("/items", () => ok("list"));
      router.post("/items", () => ok("created"));

      const getRes = await router.handle(makeRequest({ method: "GET", path: "/items" }));
      expect(getRes.body).toEqual({ ok: true, data: "list" });

      const postRes = await router.handle(makeRequest({ method: "POST", path: "/items" }));
      expect(postRes.body).toEqual({ ok: true, data: "created" });
    });

    it("does not match wrong method", async () => {
      const router = new Router();
      router.post("/items", () => ok("created"));

      const res = await router.handle(makeRequest({ method: "GET", path: "/items" }));
      expect(res.status).toBe(404);
    });
  });

  describe("path parameters", () => {
    it("extracts a single path param", async () => {
      const router = new Router();
      router.get("/users/:id", (req) => ok({ id: req.params["id"] }));

      const res = await router.handle(makeRequest({ path: "/users/42" }));
      expect(res.body).toEqual({ ok: true, data: { id: "42" } });
    });

    it("extracts multiple path params", async () => {
      const router = new Router();
      router.get("/users/:userId/posts/:postId", (req) =>
        ok({ userId: req.params["userId"], postId: req.params["postId"] }),
      );

      const res = await router.handle(
        makeRequest({ path: "/users/1/posts/99" }),
      );
      expect(res.body).toEqual({
        ok: true,
        data: { userId: "1", postId: "99" },
      });
    });

    it("does not match partial paths", async () => {
      const router = new Router();
      router.get("/users/:id", () => ok("user"));

      const res = await router.handle(makeRequest({ path: "/users/1/extra" }));
      expect(res.status).toBe(404);
    });
  });

  describe("middleware chain", () => {
    it("runs middleware before handler", async () => {
      const log: string[] = [];

      const mw: Middleware = async (req, next) => {
        log.push("before");
        const res = await next();
        log.push("after");
        return res;
      };

      const router = new Router();
      router.get("/test", () => {
        log.push("handler");
        return ok("done");
      }, { middleware: [mw] });

      await router.handle(makeRequest({ path: "/test" }));
      expect(log).toEqual(["before", "handler", "after"]);
    });

    it("can short-circuit the chain", async () => {
      const authMiddleware: Middleware = async (_req, _next) => {
        return {
          status: 401,
          headers: {},
          body: { ok: false as const, error: { code: "UNAUTHORIZED", message: "No token" } },
        };
      };

      const router = new Router();
      router.get("/secret", () => ok("treasure"), {
        middleware: [authMiddleware],
      });

      const res = await router.handle(makeRequest({ path: "/secret" }));
      expect(res.status).toBe(401);
    });

    it("runs multiple middleware in order", async () => {
      const order: number[] = [];

      const mw1: Middleware = async (_req, next) => {
        order.push(1);
        return next();
      };
      const mw2: Middleware = async (_req, next) => {
        order.push(2);
        return next();
      };

      const router = new Router();
      router.get("/test", () => {
        order.push(3);
        return ok("done");
      }, { middleware: [mw1, mw2] });

      await router.handle(makeRequest({ path: "/test" }));
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("route grouping", () => {
    it("prefixes routes", async () => {
      const router = new Router();
      router.group({
        prefix: "/api/v1",
        routes: [
          { method: "GET", path: "/users", handler: () => ok("users") },
          { method: "GET", path: "/posts", handler: () => ok("posts") },
        ],
      });

      const usersRes = await router.handle(
        makeRequest({ path: "/api/v1/users" }),
      );
      expect(usersRes.body).toEqual({ ok: true, data: "users" });

      const postsRes = await router.handle(
        makeRequest({ path: "/api/v1/posts" }),
      );
      expect(postsRes.body).toEqual({ ok: true, data: "posts" });
    });

    it("applies group middleware to all routes in group", async () => {
      const log: string[] = [];
      const groupMw: Middleware = async (_req, next) => {
        log.push("group");
        return next();
      };

      const router = new Router();
      router.group({
        prefix: "/api",
        middleware: [groupMw],
        routes: [
          { method: "GET", path: "/a", handler: () => ok("a") },
          { method: "GET", path: "/b", handler: () => ok("b") },
        ],
      });

      await router.handle(makeRequest({ path: "/api/a" }));
      expect(log).toEqual(["group"]);

      log.length = 0;
      await router.handle(makeRequest({ path: "/api/b" }));
      expect(log).toEqual(["group"]);
    });

    it("runs group middleware before route middleware", async () => {
      const order: string[] = [];
      const groupMw: Middleware = async (_req, next) => {
        order.push("group");
        return next();
      };
      const routeMw: Middleware = async (_req, next) => {
        order.push("route");
        return next();
      };

      const router = new Router();
      router.group({
        prefix: "/api",
        middleware: [groupMw],
        routes: [
          {
            method: "GET",
            path: "/test",
            handler: () => ok("done"),
            middleware: [routeMw],
          },
        ],
      });

      await router.handle(makeRequest({ path: "/api/test" }));
      expect(order).toEqual(["group", "route"]);
    });
  });

  describe("getRoutes", () => {
    it("returns all registered routes", () => {
      const router = new Router();
      const handler = () => ok("ok");
      router.get("/a", handler);
      router.post("/b", handler);

      const routes = router.getRoutes();
      expect(routes).toHaveLength(2);
      expect(routes[0].method).toBe("GET");
      expect(routes[0].path).toBe("/a");
      expect(routes[1].method).toBe("POST");
      expect(routes[1].path).toBe("/b");
    });
  });

  describe("convenience methods", () => {
    it("supports all HTTP methods", async () => {
      const router = new Router();
      const handler = (req: ApiRequest) => ok(req.method);

      router.get("/r", handler);
      router.post("/r", handler);
      router.put("/r", handler);
      router.patch("/r", handler);
      router.delete("/r", handler);

      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
        const res = await router.handle(makeRequest({ method, path: "/r" }));
        expect(res.body).toEqual({ ok: true, data: method });
      }
    });
  });
});
