import { describe, expect, it } from "vitest";

import {
  createManifest,
  getDependencyGraph,
  getStartOrder,
  getTransitiveDependencies,
} from "../src/service-manifest.js";

describe("createManifest", () => {
  it("creates a valid manifest", () => {
    const manifest = createManifest("myapp", [
      { name: "db", image: "postgres:16" },
      { name: "api", image: "myapp:latest", dependencies: ["db"] },
    ]);
    expect(manifest.project).toBe("myapp");
    expect(manifest.services).toHaveLength(2);
  });

  it("throws on duplicate service names", () => {
    expect(() =>
      createManifest("myapp", [
        { name: "api", image: "a:1" },
        { name: "api", image: "b:2" },
      ]),
    ).toThrow("Duplicate service name");
  });

  it("throws on undefined dependency", () => {
    expect(() =>
      createManifest("myapp", [
        { name: "api", image: "a:1", dependencies: ["db"] },
      ]),
    ).toThrow('depends on "db", which is not defined');
  });

  it("throws on host port conflict", () => {
    expect(() =>
      createManifest("myapp", [
        {
          name: "api",
          image: "a:1",
          ports: [{ host: 3000, container: 3000 }],
        },
        {
          name: "web",
          image: "b:2",
          ports: [{ host: 3000, container: 8080 }],
        },
      ]),
    ).toThrow("Port conflict");
  });
});

describe("getDependencyGraph", () => {
  it("returns a map of dependencies", () => {
    const manifest = createManifest("myapp", [
      { name: "db", image: "postgres:16" },
      { name: "cache", image: "redis:7" },
      { name: "api", image: "myapp:latest", dependencies: ["db", "cache"] },
    ]);
    const graph = getDependencyGraph(manifest);
    expect(graph.get("db")).toEqual([]);
    expect(graph.get("cache")).toEqual([]);
    expect(graph.get("api")).toEqual(["db", "cache"]);
  });
});

describe("getStartOrder", () => {
  it("returns correct order for linear chain", () => {
    const manifest = createManifest("myapp", [
      { name: "api", image: "a:1", dependencies: ["db"] },
      { name: "db", image: "postgres:16" },
    ]);
    const order = getStartOrder(manifest);
    expect(order).toEqual(["db", "api"]);
  });

  it("returns correct order for diamond dependency", () => {
    const manifest = createManifest("myapp", [
      { name: "web", image: "w:1", dependencies: ["api"] },
      { name: "api", image: "a:1", dependencies: ["db", "cache"] },
      { name: "db", image: "postgres:16" },
      { name: "cache", image: "redis:7" },
    ]);
    const order = getStartOrder(manifest);
    // db and cache should come before api, api before web
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("api")).toBeLessThan(order.indexOf("web"));
  });

  it("handles services with no dependencies", () => {
    const manifest = createManifest("myapp", [
      { name: "a", image: "a:1" },
      { name: "b", image: "b:1" },
      { name: "c", image: "c:1" },
    ]);
    const order = getStartOrder(manifest);
    expect(order).toHaveLength(3);
    // Alphabetical since no deps
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("detects circular dependencies", () => {
    // We need to bypass createManifest validation for this test
    const manifest = {
      project: "myapp",
      services: [
        { name: "a", image: "a:1", dependencies: ["b"] },
        { name: "b", image: "b:1", dependencies: ["c"] },
        { name: "c", image: "c:1", dependencies: ["a"] },
      ],
    };
    expect(() => getStartOrder(manifest)).toThrow("Circular dependency");
  });

  it("handles complex dependency graph", () => {
    const manifest = createManifest("myapp", [
      { name: "frontend", image: "fe:1", dependencies: ["api"] },
      { name: "api", image: "api:1", dependencies: ["db", "cache", "queue"] },
      { name: "worker", image: "wk:1", dependencies: ["db", "queue"] },
      { name: "db", image: "pg:16" },
      { name: "cache", image: "redis:7" },
      { name: "queue", image: "rabbit:3" },
    ]);
    const order = getStartOrder(manifest);

    // All base services before their dependents
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("cache")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("queue")).toBeLessThan(order.indexOf("api"));
    expect(order.indexOf("api")).toBeLessThan(order.indexOf("frontend"));
    expect(order.indexOf("db")).toBeLessThan(order.indexOf("worker"));
    expect(order.indexOf("queue")).toBeLessThan(order.indexOf("worker"));
  });
});

describe("getTransitiveDependencies", () => {
  it("returns direct dependencies", () => {
    const manifest = createManifest("myapp", [
      { name: "db", image: "postgres:16" },
      { name: "api", image: "a:1", dependencies: ["db"] },
    ]);
    const deps = getTransitiveDependencies(manifest, "api");
    expect(deps).toEqual(new Set(["db"]));
  });

  it("returns transitive dependencies", () => {
    const manifest = createManifest("myapp", [
      { name: "db", image: "postgres:16" },
      { name: "api", image: "a:1", dependencies: ["db"] },
      { name: "web", image: "w:1", dependencies: ["api"] },
    ]);
    const deps = getTransitiveDependencies(manifest, "web");
    expect(deps).toEqual(new Set(["api", "db"]));
  });

  it("returns empty set for service with no dependencies", () => {
    const manifest = createManifest("myapp", [
      { name: "db", image: "postgres:16" },
    ]);
    const deps = getTransitiveDependencies(manifest, "db");
    expect(deps).toEqual(new Set());
  });
});
