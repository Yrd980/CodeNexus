import { describe, expect, it } from "vitest";

import { generateCompose, generateDockerfile } from "../src/docker.js";

describe("generateDockerfile", () => {
  describe("Node.js", () => {
    it("generates a multi-stage Dockerfile by default", () => {
      const result = generateDockerfile({ language: "node" });
      expect(result).toContain("FROM node:20-slim AS builder");
      expect(result).toContain("FROM node:20-slim AS runner");
    });

    it("uses non-root user", () => {
      const result = generateDockerfile({ language: "node" });
      expect(result).toContain("USER appuser");
      expect(result).toContain("groupadd --gid 1001 appuser");
    });

    it("includes dumb-init", () => {
      const result = generateDockerfile({ language: "node" });
      expect(result).toContain("dumb-init");
      expect(result).toContain('ENTRYPOINT ["dumb-init", "--"]');
    });

    it("respects custom port and entrypoint", () => {
      const result = generateDockerfile({
        language: "node",
        port: 8080,
        entrypoint: "build/server.js",
      });
      expect(result).toContain("EXPOSE 8080");
      expect(result).toContain('"build/server.js"');
    });

    it("respects custom node version", () => {
      const result = generateDockerfile({
        language: "node",
        nodeVersion: "22",
      });
      expect(result).toContain("FROM node:22-slim");
    });

    it("generates single-stage when multiStage is false", () => {
      const result = generateDockerfile({
        language: "node",
        multiStage: false,
      });
      expect(result).not.toContain("AS builder");
      expect(result).not.toContain("AS runner");
      expect(result).toContain("FROM node:20-slim");
    });

    it("includes system packages when specified", () => {
      const result = generateDockerfile({
        language: "node",
        systemPackages: ["curl", "openssl"],
      });
      expect(result).toContain("curl");
      expect(result).toContain("openssl");
    });

    it("copies node_modules and dist from builder in multi-stage", () => {
      const result = generateDockerfile({ language: "node" });
      expect(result).toContain("COPY --from=builder");
      expect(result).toContain("node_modules");
    });

    it("includes npm ci in single-stage build", () => {
      const result = generateDockerfile({
        language: "node",
        multiStage: false,
      });
      expect(result).toContain("npm ci --ignore-scripts");
    });
  });

  describe("Python", () => {
    it("generates a multi-stage Dockerfile by default", () => {
      const result = generateDockerfile({ language: "python" });
      expect(result).toContain("FROM python:3.12-slim AS builder");
      expect(result).toContain("FROM python:3.12-slim AS runner");
    });

    it("uses non-root user", () => {
      const result = generateDockerfile({ language: "python" });
      expect(result).toContain("USER appuser");
    });

    it("sets PYTHONDONTWRITEBYTECODE and PYTHONUNBUFFERED", () => {
      const result = generateDockerfile({ language: "python" });
      expect(result).toContain("PYTHONDONTWRITEBYTECODE=1");
      expect(result).toContain("PYTHONUNBUFFERED=1");
    });

    it("uses virtual env for clean multi-stage copy", () => {
      const result = generateDockerfile({ language: "python" });
      expect(result).toContain("python -m venv /opt/venv");
      expect(result).toContain("COPY --from=builder");
      expect(result).toContain("/opt/venv");
    });

    it("respects custom python version", () => {
      const result = generateDockerfile({
        language: "python",
        pythonVersion: "3.11",
      });
      expect(result).toContain("FROM python:3.11-slim");
    });

    it("defaults to port 8000 and app/main.py", () => {
      const result = generateDockerfile({ language: "python" });
      expect(result).toContain("EXPOSE 8000");
      expect(result).toContain("app/main.py");
    });
  });

  it("throws for unsupported language", () => {
    expect(() =>
      generateDockerfile({ language: "rust" as "node" }),
    ).toThrow("Unsupported language");
  });
});

describe("generateCompose", () => {
  it("generates valid compose YAML", () => {
    const result = generateCompose([
      {
        name: "api",
        image: "myapp:latest",
        ports: [{ host: 3000, container: 3000 }],
        environment: { NODE_ENV: "production" },
      },
    ]);
    expect(result).toContain("services:");
    expect(result).toContain("  api:");
    expect(result).toContain('    image: myapp:latest');
    expect(result).toContain('"3000:3000"');
    expect(result).toContain('NODE_ENV: "production"');
  });

  it("includes depends_on with service_healthy condition", () => {
    const result = generateCompose([
      {
        name: "db",
        image: "postgres:16",
        healthcheck: { command: "pg_isready" },
      },
      {
        name: "api",
        image: "myapp:latest",
        dependencies: ["db"],
      },
    ]);
    expect(result).toContain("depends_on:");
    expect(result).toContain("condition: service_healthy");
  });

  it("includes healthcheck configuration", () => {
    const result = generateCompose([
      {
        name: "db",
        image: "postgres:16",
        healthcheck: {
          command: "pg_isready",
          interval: "10s",
          timeout: "5s",
          retries: 3,
          startPeriod: "30s",
        },
      },
    ]);
    expect(result).toContain("healthcheck:");
    expect(result).toContain("pg_isready");
    expect(result).toContain("interval: 10s");
    expect(result).toContain("retries: 3");
  });

  it("includes volumes", () => {
    const result = generateCompose([
      {
        name: "db",
        image: "postgres:16",
        volumes: ["pgdata:/var/lib/postgresql/data"],
      },
    ]);
    expect(result).toContain("volumes:");
    expect(result).toContain("pgdata:/var/lib/postgresql/data");
  });
});
