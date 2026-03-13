/**
 * Lightweight type-safe router.
 *
 * This is NOT a framework replacement.  It is a routing *pattern* that you can
 * map to any framework (Express, Fastify, Hono, Bun.serve, Cloudflare Workers).
 * The goal is to centralise route definitions, middleware chains, and path
 * parameter extraction in a framework-agnostic way.
 */

import type {
  ApiRequest,
  ApiResponse,
  Handler,
  HttpMethod,
  Middleware,
  RouteDefinition,
  RouteGroup,
} from "./types.js";
import { error } from "./response.js";

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

interface MatchResult {
  matched: boolean;
  params: Record<string, string>;
}

/**
 * Convert a route pattern like `/users/:id/posts/:postId` into a regex and
 * extract named parameter positions.
 */
function compilePath(pattern: string): {
  regex: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  const regexStr = pattern
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      // Escape special regex characters in literal segments
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function matchPath(pattern: string, path: string): MatchResult {
  const { regex, paramNames } = compilePath(pattern);
  const match = regex.exec(path);
  if (!match) return { matched: false, params: {} };

  const params: Record<string, string> = {};
  for (let i = 0; i < paramNames.length; i++) {
    const name = paramNames[i];
    const value = match[i + 1];
    if (name !== undefined && value !== undefined) {
      params[name] = value;
    }
  }
  return { matched: true, params };
}

// ---------------------------------------------------------------------------
// Middleware chain builder
// ---------------------------------------------------------------------------

function buildChain(
  middlewares: Middleware[],
  handler: Handler,
): (req: ApiRequest) => Promise<ApiResponse<unknown>> {
  return async (req: ApiRequest): Promise<ApiResponse<unknown>> => {
    let index = 0;

    const next = async (): Promise<ApiResponse<unknown>> => {
      const mw = middlewares[index++];
      if (mw !== undefined) {
        return mw(req, next);
      }
      return handler(req);
    };

    return next();
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface ResolvedRoute {
  route: RouteDefinition;
  params: Record<string, string>;
}

export class Router {
  private routes: RouteDefinition[] = [];

  /** Register a single route. */
  add(route: RouteDefinition): this {
    this.routes.push(route);
    return this;
  }

  /** Convenience: register a GET route. */
  get(
    path: string,
    handler: Handler,
    opts?: Partial<Omit<RouteDefinition, "method" | "path" | "handler">>,
  ): this {
    return this.add({ method: "GET", path, handler, ...opts });
  }

  /** Convenience: register a POST route. */
  post(
    path: string,
    handler: Handler,
    opts?: Partial<Omit<RouteDefinition, "method" | "path" | "handler">>,
  ): this {
    return this.add({ method: "POST", path, handler, ...opts });
  }

  /** Convenience: register a PUT route. */
  put(
    path: string,
    handler: Handler,
    opts?: Partial<Omit<RouteDefinition, "method" | "path" | "handler">>,
  ): this {
    return this.add({ method: "PUT", path, handler, ...opts });
  }

  /** Convenience: register a PATCH route. */
  patch(
    path: string,
    handler: Handler,
    opts?: Partial<Omit<RouteDefinition, "method" | "path" | "handler">>,
  ): this {
    return this.add({ method: "PATCH", path, handler, ...opts });
  }

  /** Convenience: register a DELETE route. */
  delete(
    path: string,
    handler: Handler,
    opts?: Partial<Omit<RouteDefinition, "method" | "path" | "handler">>,
  ): this {
    return this.add({ method: "DELETE", path, handler, ...opts });
  }

  /**
   * Register a group of routes that share a prefix and/or middleware.
   *
   * Group middleware runs *before* per-route middleware.
   */
  group(group: RouteGroup): this {
    for (const route of group.routes) {
      const combinedMiddleware = [
        ...(group.middleware ?? []),
        ...(route.middleware ?? []),
      ];
      this.add({
        ...route,
        path: `${group.prefix}${route.path}`,
        middleware: combinedMiddleware.length > 0 ? combinedMiddleware : undefined,
      });
    }
    return this;
  }

  /** Find the first matching route for the given method + path. */
  resolve(method: HttpMethod, path: string): ResolvedRoute | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const result = matchPath(route.path, path);
      if (result.matched) {
        return { route, params: result.params };
      }
    }
    return null;
  }

  /** Handle an incoming request through the full middleware + handler chain. */
  async handle(req: ApiRequest): Promise<ApiResponse<unknown>> {
    const resolved = this.resolve(req.method, req.path);
    if (!resolved) {
      return error(404, "NOT_FOUND", `No route matches ${req.method} ${req.path}`);
    }

    // Inject matched path params into the request
    const enrichedReq: ApiRequest = {
      ...req,
      params: { ...req.params, ...resolved.params },
    };

    const middlewares = resolved.route.middleware ?? [];
    const chain = buildChain(middlewares, resolved.route.handler);

    return chain(enrichedReq);
  }

  /** Return all registered routes (useful for generating API docs). */
  getRoutes(): ReadonlyArray<RouteDefinition> {
    return [...this.routes];
  }
}
