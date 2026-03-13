/**
 * foundation/infra — Dockerfile generator
 *
 * Generates production-quality Dockerfiles and Compose configurations.
 *
 * Design decisions:
 * - Multi-stage by default: smaller images, no build tools in production.
 * - Non-root user by default: running as root in containers is a security risk
 *   that most Dockerfiles ignore.
 * - dumb-init for Node.js: proper signal handling (SIGTERM) in containers.
 *   Without it, `npm start` swallows signals and your container takes 10s to stop.
 * - Slim base images: no reason to ship a full OS in a container.
 */

import type {
  DockerfileOptions,
  HealthCheckConfig,
  ServiceDefinition,
} from "./types.js";

// ── Dockerfile generation ───────────────────────────────────────────

function generateNodeDockerfile(options: DockerfileOptions): string {
  const version = options.nodeVersion ?? "20";
  const port = options.port ?? 3000;
  const entrypoint = options.entrypoint ?? "dist/index.js";
  const multiStage = options.multiStage !== false;
  const sysPackages = options.systemPackages ?? [];

  const lines: string[] = [];

  if (multiStage) {
    // ── Builder stage
    lines.push(
      `# ── Builder ──────────────────────────────────────`,
      `FROM node:${version}-slim AS builder`,
      ``,
      `WORKDIR /app`,
      ``,
      `# Install dependencies first (layer caching)`,
      `COPY package.json package-lock.json* ./`,
      `RUN npm ci --ignore-scripts`,
      ``,
      `# Copy source and build`,
      `COPY . .`,
      `RUN npm run build`,
      ``,
      `# Prune dev dependencies`,
      `RUN npm prune --production`,
      ``,
      `# ── Runner ───────────────────────────────────────`,
      `FROM node:${version}-slim AS runner`,
      ``,
    );
  } else {
    lines.push(`FROM node:${version}-slim`, ``);
  }

  // System packages (always include dumb-init)
  const packages = ["dumb-init", ...sysPackages];
  lines.push(
    `# Install runtime dependencies`,
    `RUN apt-get update && apt-get install -y --no-install-recommends \\`,
    `    ${packages.join(" \\\n    ")} \\`,
    `    && rm -rf /var/lib/apt/lists/*`,
    ``,
  );

  // Non-root user
  lines.push(
    `# Run as non-root user`,
    `RUN groupadd --gid 1001 appuser && \\`,
    `    useradd --uid 1001 --gid appuser --shell /bin/sh --create-home appuser`,
    ``,
    `WORKDIR /app`,
    ``,
  );

  if (multiStage) {
    lines.push(
      `# Copy built artifacts from builder`,
      `COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules`,
      `COPY --from=builder --chown=appuser:appuser /app/${entrypoint.split("/")[0]} ./${entrypoint.split("/")[0]}`,
      `COPY --from=builder --chown=appuser:appuser /app/package.json ./package.json`,
      ``,
    );
  } else {
    lines.push(
      `COPY --chown=appuser:appuser . .`,
      `RUN npm ci --ignore-scripts`,
      ``,
    );
  }

  lines.push(
    `USER appuser`,
    ``,
    `EXPOSE ${port}`,
    ``,
    `# dumb-init ensures proper signal handling (SIGTERM)`,
    `ENTRYPOINT ["dumb-init", "--"]`,
    `CMD ["node", "${entrypoint}"]`,
  );

  return lines.join("\n");
}

function generatePythonDockerfile(options: DockerfileOptions): string {
  const version = options.pythonVersion ?? "3.12";
  const port = options.port ?? 8000;
  const entrypoint = options.entrypoint ?? "app/main.py";
  const multiStage = options.multiStage !== false;
  const sysPackages = options.systemPackages ?? [];

  const lines: string[] = [];

  if (multiStage) {
    // ── Builder stage
    lines.push(
      `# ── Builder ──────────────────────────────────────`,
      `FROM python:${version}-slim AS builder`,
      ``,
      `WORKDIR /app`,
      ``,
      `# Prevent Python from writing .pyc files and enable unbuffered output`,
      `ENV PYTHONDONTWRITEBYTECODE=1 \\`,
      `    PYTHONUNBUFFERED=1`,
      ``,
      `# Install dependencies into a virtual env for clean copy`,
      `RUN python -m venv /opt/venv`,
      `ENV PATH="/opt/venv/bin:$PATH"`,
      ``,
      `COPY requirements.txt .`,
      `RUN pip install --no-cache-dir -r requirements.txt`,
      ``,
      `# ── Runner ───────────────────────────────────────`,
      `FROM python:${version}-slim AS runner`,
      ``,
    );
  } else {
    lines.push(
      `FROM python:${version}-slim`,
      ``,
      `ENV PYTHONDONTWRITEBYTECODE=1 \\`,
      `    PYTHONUNBUFFERED=1`,
      ``,
    );
  }

  // System packages
  if (sysPackages.length > 0) {
    lines.push(
      `# Install runtime dependencies`,
      `RUN apt-get update && apt-get install -y --no-install-recommends \\`,
      `    ${sysPackages.join(" \\\n    ")} \\`,
      `    && rm -rf /var/lib/apt/lists/*`,
      ``,
    );
  }

  // Non-root user
  lines.push(
    `# Run as non-root user`,
    `RUN groupadd --gid 1001 appuser && \\`,
    `    useradd --uid 1001 --gid appuser --shell /bin/sh --create-home appuser`,
    ``,
    `WORKDIR /app`,
    ``,
  );

  if (multiStage) {
    lines.push(
      `# Copy virtual env from builder`,
      `COPY --from=builder --chown=appuser:appuser /opt/venv /opt/venv`,
      `ENV PATH="/opt/venv/bin:$PATH"`,
      ``,
    );
  }

  lines.push(
    `COPY --chown=appuser:appuser . .`,
    ``,
    `USER appuser`,
    ``,
    `EXPOSE ${port}`,
    ``,
    `CMD ["python", "${entrypoint}"]`,
  );

  return lines.join("\n");
}

/**
 * Generate a production-quality Dockerfile.
 *
 * @param options - Language, version, port, entrypoint, etc.
 * @returns Dockerfile content as a string
 */
export function generateDockerfile(options: DockerfileOptions): string {
  switch (options.language) {
    case "node":
      return generateNodeDockerfile(options);
    case "python":
      return generatePythonDockerfile(options);
    default:
      throw new Error(`Unsupported language: ${options.language as string}`);
  }
}

// ── Docker Compose generation ───────────────────────────────────────

function formatHealthCheck(hc: HealthCheckConfig): string {
  const lines: string[] = [];
  lines.push(`      test: ["CMD-SHELL", "${hc.command}"]`);
  if (hc.interval) lines.push(`      interval: ${hc.interval}`);
  if (hc.timeout) lines.push(`      timeout: ${hc.timeout}`);
  if (hc.retries !== undefined) lines.push(`      retries: ${hc.retries}`);
  if (hc.startPeriod) lines.push(`      start_period: ${hc.startPeriod}`);
  return lines.join("\n");
}

/**
 * Generate a Docker Compose YAML string from service definitions.
 *
 * @param services - Array of service definitions
 * @returns docker-compose.yml content
 */
export function generateCompose(services: ServiceDefinition[]): string {
  const lines: string[] = [];

  lines.push(`services:`);

  for (const svc of services) {
    lines.push(`  ${svc.name}:`);
    lines.push(`    image: ${svc.image}`);

    if (svc.ports && svc.ports.length > 0) {
      lines.push(`    ports:`);
      for (const p of svc.ports) {
        lines.push(`      - "${p.host}:${p.container}"`);
      }
    }

    if (svc.environment && Object.keys(svc.environment).length > 0) {
      lines.push(`    environment:`);
      for (const [key, val] of Object.entries(svc.environment)) {
        lines.push(`      ${key}: "${val}"`);
      }
    }

    if (svc.volumes && svc.volumes.length > 0) {
      lines.push(`    volumes:`);
      for (const v of svc.volumes) {
        lines.push(`      - ${v}`);
      }
    }

    if (svc.dependencies && svc.dependencies.length > 0) {
      lines.push(`    depends_on:`);
      for (const dep of svc.dependencies) {
        lines.push(`      ${dep}:`);
        lines.push(`        condition: service_healthy`);
      }
    }

    if (svc.healthcheck) {
      lines.push(`    healthcheck:`);
      lines.push(formatHealthCheck(svc.healthcheck));
    }

    lines.push(``);
  }

  return lines.join("\n");
}
