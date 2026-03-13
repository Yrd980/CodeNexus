/**
 * Storage provider implementations.
 *
 * MemoryStorageProvider: in-memory store for dev/testing.
 * LocalStorageProvider:  filesystem-based store.
 * createStorageProvider: factory function.
 *
 * NOTE: There is no S3 provider here — this module is the PATTERN.
 * Implementing the S3 provider follows the same StorageProvider interface
 * using the AWS SDK. This keeps the module zero-dependency.
 */

import { readFile, writeFile, unlink, stat, readdir, mkdir } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { existsSync } from "node:fs";
import type {
  FileMetadata,
  ListOptions,
  ListResult,
  SignedUrl,
  SignedUrlOptions,
  StorageConfig,
  StorageProvider,
  UploadOptions,
  UploadResult,
} from "./types.js";
import { StorageError } from "./types.js";
import { resolveUploadOptions } from "./upload.js";
import { generateSignedUrl } from "./signed-urls.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a simple hex-based ETag from file content.
 */
function computeEtag(data: Uint8Array): string {
  // Simple hash: sum all bytes mod a large prime, then hex-encode.
  // In production you'd use crypto.subtle.digest("SHA-256", data).
  let hash = 0;
  for (let i = 0; i < data.byteLength; i++) {
    hash = (hash * 31 + (data[i] as number)) | 0;
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `"${hex}"`;
}

// ---------------------------------------------------------------------------
// MemoryStorageProvider
// ---------------------------------------------------------------------------

interface MemoryFile {
  data: Uint8Array;
  metadata: FileMetadata;
}

/**
 * In-memory storage provider for development and testing.
 *
 * All data lives in a Map and is lost when the process exits.
 * Supports all StorageProvider operations including signed URLs
 * (via HMAC signing with a configurable secret).
 */
export class MemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, MemoryFile>();
  private readonly config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
  }

  async upload(data: Uint8Array, options: UploadOptions): Promise<UploadResult> {
    const resolved = resolveUploadOptions(options.key ?? "unnamed", options);
    const etag = computeEtag(data);

    const metadata: FileMetadata = {
      key: resolved.key,
      size: data.byteLength,
      mimeType: resolved.contentType,
      etag,
      lastModified: new Date(),
      customMetadata: resolved.metadata ?? {},
    };

    this.files.set(resolved.key, { data: new Uint8Array(data), metadata });

    return {
      key: resolved.key,
      size: data.byteLength,
      mimeType: resolved.contentType,
      etag,
    };
  }

  async download(key: string): Promise<{ data: Uint8Array; metadata: FileMetadata }> {
    const file = this.files.get(key);
    if (!file) {
      throw new StorageError("FILE_NOT_FOUND", `File not found: ${key}`, key);
    }
    return { data: new Uint8Array(file.data), metadata: { ...file.metadata } };
  }

  async delete(key: string): Promise<boolean> {
    return this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const file = this.files.get(key);
    if (!file) {
      throw new StorageError("FILE_NOT_FOUND", `File not found: ${key}`, key);
    }
    return { ...file.metadata };
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<SignedUrl> {
    if (!this.files.has(key)) {
      throw new StorageError("FILE_NOT_FOUND", `File not found: ${key}`, key);
    }
    const secret = this.config.signingSecret ?? "dev-secret";
    return generateSignedUrl({
      key,
      baseUrl: `memory://${this.config.bucket}`,
      secret,
      options,
    });
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;
    const cursorOffset = options?.cursor ? parseInt(options.cursor, 10) : 0;

    const allKeys = [...this.files.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();

    const page = allKeys.slice(cursorOffset, cursorOffset + limit);
    const files = page.map((k) => ({ ...this.files.get(k)!.metadata }));
    const nextOffset = cursorOffset + limit;
    const cursor = nextOffset < allKeys.length ? nextOffset.toString() : null;

    return { files, cursor };
  }

  /** Clear all files (useful in tests). */
  clear(): void {
    this.files.clear();
  }

  /** Get the number of stored files. */
  get size(): number {
    return this.files.size;
  }
}

// ---------------------------------------------------------------------------
// LocalStorageProvider
// ---------------------------------------------------------------------------

/**
 * Filesystem-based storage provider.
 *
 * Stores files under a configurable base path. Useful for development
 * or single-server deployments. In production, prefer a cloud provider.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string;
  private readonly config: StorageConfig;

  constructor(config: StorageConfig) {
    this.config = config;
    this.basePath = config.basePath ?? join(process.cwd(), "storage", config.bucket);
  }

  private resolvePath(key: string): string {
    // Prevent path traversal
    const resolved = join(this.basePath, key);
    if (!resolved.startsWith(this.basePath)) {
      throw new StorageError("PROVIDER_ERROR", `Invalid key: path traversal detected`, key);
    }
    return resolved;
  }

  async upload(data: Uint8Array, options: UploadOptions): Promise<UploadResult> {
    const resolved = resolveUploadOptions(options.key ?? "unnamed", options);
    const filePath = this.resolvePath(resolved.key);

    // Ensure directory exists
    await mkdir(dirname(filePath), { recursive: true });

    // Write file content
    await writeFile(filePath, data);

    // Write metadata sidecar
    const etag = computeEtag(data);
    const metadata: FileMetadata = {
      key: resolved.key,
      size: data.byteLength,
      mimeType: resolved.contentType,
      etag,
      lastModified: new Date(),
      customMetadata: resolved.metadata ?? {},
    };
    await writeFile(`${filePath}.meta.json`, JSON.stringify(metadata));

    return {
      key: resolved.key,
      size: data.byteLength,
      mimeType: resolved.contentType,
      etag,
    };
  }

  async download(key: string): Promise<{ data: Uint8Array; metadata: FileMetadata }> {
    const filePath = this.resolvePath(key);
    try {
      const data = await readFile(filePath);
      const metadata = await this.getMetadata(key);
      return { data: new Uint8Array(data), metadata };
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        throw new StorageError("FILE_NOT_FOUND", `File not found: ${key}`, key);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await unlink(filePath);
      // Also remove metadata sidecar if it exists
      try {
        await unlink(`${filePath}.meta.json`);
      } catch {
        // Sidecar may not exist
      }
      return true;
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    return existsSync(filePath);
  }

  async getMetadata(key: string): Promise<FileMetadata> {
    const filePath = this.resolvePath(key);
    const metaPath = `${filePath}.meta.json`;

    try {
      const raw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw) as FileMetadata;
      // Restore Date object
      meta.lastModified = new Date(meta.lastModified);
      return meta;
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") {
        // If no sidecar, build metadata from file stats
        try {
          const fileStat = await stat(filePath);
          return {
            key,
            size: fileStat.size,
            mimeType: "application/octet-stream",
            etag: `"${fileStat.mtimeMs.toString(16)}"`,
            lastModified: fileStat.mtime,
            customMetadata: {},
          };
        } catch {
          throw new StorageError("FILE_NOT_FOUND", `File not found: ${key}`, key);
        }
      }
      throw err;
    }
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<SignedUrl> {
    if (!(await this.exists(key))) {
      throw new StorageError("FILE_NOT_FOUND", `File not found: ${key}`, key);
    }
    const secret = this.config.signingSecret ?? "dev-secret";
    return generateSignedUrl({
      key,
      baseUrl: `file://${this.basePath}`,
      secret,
      options,
    });
  }

  async list(options?: ListOptions): Promise<ListResult> {
    const prefix = options?.prefix ?? "";
    const limit = options?.limit ?? 1000;

    const allFiles = await walkDir(this.basePath);
    const relativeFiles = allFiles
      .map((f) => relative(this.basePath, f))
      .filter((f) => !f.endsWith(".meta.json"))
      .filter((f) => f.startsWith(prefix))
      .sort();

    const cursorOffset = options?.cursor ? parseInt(options.cursor, 10) : 0;
    const page = relativeFiles.slice(cursorOffset, cursorOffset + limit);

    const files: FileMetadata[] = [];
    for (const key of page) {
      try {
        const meta = await this.getMetadata(key);
        files.push(meta);
      } catch {
        // Skip files we can't read metadata for
      }
    }

    const nextOffset = cursorOffset + limit;
    const cursor = nextOffset < relativeFiles.length ? nextOffset.toString() : null;

    return { files, cursor };
  }

  /** Get the base path of this provider. */
  getBasePath(): string {
    return this.basePath;
  }
}

/**
 * Recursively walk a directory and return all file paths.
 */
async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walkDir(fullPath)));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return results;
}

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/**
 * Create a storage provider from configuration.
 *
 * @example
 * ```ts
 * const storage = createStorageProvider({
 *   provider: "memory",
 *   bucket: "my-app-uploads",
 * });
 * ```
 */
export function createStorageProvider(config: StorageConfig): StorageProvider {
  switch (config.provider) {
    case "memory":
      return new MemoryStorageProvider(config);
    case "local":
      return new LocalStorageProvider(config);
    case "s3":
      throw new StorageError(
        "PROVIDER_ERROR",
        'S3 provider is not included in this module. Implement the StorageProvider interface using the AWS SDK. See README for guidance.',
      );
    default: {
      const _exhaustive: never = config.provider;
      throw new StorageError("PROVIDER_ERROR", `Unknown provider: ${_exhaustive}`);
    }
  }
}
