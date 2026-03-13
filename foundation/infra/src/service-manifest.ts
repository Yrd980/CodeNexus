/**
 * foundation/infra — Service manifest & dependency graph
 *
 * Define services and their dependencies, then compute the correct start order.
 *
 * Design decisions:
 * - Topological sort for start order: the only correct way to handle dependency
 *   ordering. Manual ordering breaks the moment you add a 3rd or 4th service.
 * - Circular dependency detection: fail fast with a clear error instead of an
 *   infinite loop or mysterious timeout.
 * - Port allocation tracking: two services on the same port is a common mistake
 *   that only surfaces at runtime. We catch it at definition time.
 */

import type { ServiceDefinition, ServiceManifest } from "./types.js";

/**
 * Create a service manifest and validate it.
 *
 * @param project - Project name
 * @param services - Array of service definitions
 * @returns Validated service manifest
 * @throws Error if port conflicts or undefined dependencies are found
 */
export function createManifest(
  project: string,
  services: ServiceDefinition[],
): ServiceManifest {
  // Validate: no duplicate service names
  const names = new Set<string>();
  for (const svc of services) {
    if (names.has(svc.name)) {
      throw new Error(`Duplicate service name: "${svc.name}"`);
    }
    names.add(svc.name);
  }

  // Validate: all dependencies reference existing services
  for (const svc of services) {
    for (const dep of svc.dependencies ?? []) {
      if (!names.has(dep)) {
        throw new Error(
          `Service "${svc.name}" depends on "${dep}", which is not defined`,
        );
      }
    }
  }

  // Validate: no host port conflicts
  const hostPorts = new Map<number, string>();
  for (const svc of services) {
    for (const p of svc.ports ?? []) {
      const existing = hostPorts.get(p.host);
      if (existing) {
        throw new Error(
          `Port conflict: host port ${p.host} is used by both "${existing}" and "${svc.name}"`,
        );
      }
      hostPorts.set(p.host, svc.name);
    }
  }

  return { project, services };
}

/**
 * Build a dependency graph from a service manifest.
 *
 * @returns Map of service name to its direct dependencies
 */
export function getDependencyGraph(
  manifest: ServiceManifest,
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const svc of manifest.services) {
    graph.set(svc.name, [...(svc.dependencies ?? [])]);
  }
  return graph;
}

/**
 * Compute the start order of services using topological sort (Kahn's algorithm).
 * Services with no dependencies come first.
 *
 * @param manifest - The service manifest
 * @returns Array of service names in correct start order
 * @throws Error if a circular dependency is detected
 */
export function getStartOrder(manifest: ServiceManifest): string[] {
  // Build adjacency list and in-degree count
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const svc of manifest.services) {
    inDegree.set(svc.name, 0);
    dependents.set(svc.name, []);
  }

  for (const svc of manifest.services) {
    for (const dep of svc.dependencies ?? []) {
      inDegree.set(svc.name, (inDegree.get(svc.name) ?? 0) + 1);
      dependents.get(dep)!.push(svc.name);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  // Sort queue for deterministic output
  queue.sort();

  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const dependent of dependents.get(current) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        // Insert sorted for deterministic order
        const insertIdx = queue.findIndex((q) => q > dependent);
        if (insertIdx === -1) {
          queue.push(dependent);
        } else {
          queue.splice(insertIdx, 0, dependent);
        }
      }
    }
  }

  if (order.length !== manifest.services.length) {
    const remaining = manifest.services
      .filter((s) => !order.includes(s.name))
      .map((s) => s.name);
    throw new Error(
      `Circular dependency detected among services: ${remaining.join(", ")}`,
    );
  }

  return order;
}

/**
 * Get all services that a given service transitively depends on.
 *
 * @param manifest - The service manifest
 * @param serviceName - The service to find dependencies for
 * @returns Set of all transitive dependency names (not including the service itself)
 */
export function getTransitiveDependencies(
  manifest: ServiceManifest,
  serviceName: string,
): Set<string> {
  const graph = getDependencyGraph(manifest);
  const visited = new Set<string>();
  const stack = [...(graph.get(serviceName) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of graph.get(current) ?? []) {
      stack.push(dep);
    }
  }

  return visited;
}
