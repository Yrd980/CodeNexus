/**
 * Upload handling utilities.
 *
 * File validation, unique key generation, and content-type detection.
 */

import type {
  FileValidationResult,
  StorageConfig,
  UploadOptions,
} from "./types.js";
import { detectMimeType, getExtension, sanitizeFilename } from "./metadata.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** 10 MB default max file size. */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

/**
 * Validate a file before upload.
 *
 * Checks:
 * - File size against `config.maxFileSize`
 * - MIME type against `config.allowedMimeTypes`
 * - Dangerous file extensions (.exe, .bat, etc.)
 */
export function validateFile(
  data: Uint8Array,
  filename: string,
  config: Pick<StorageConfig, "maxFileSize" | "allowedMimeTypes">,
): FileValidationResult {
  const errors: string[] = [];
  const maxSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  // Size check
  if (data.byteLength > maxSize) {
    errors.push(
      `File size ${data.byteLength} bytes exceeds maximum ${maxSize} bytes`,
    );
  }

  // Empty file check
  if (data.byteLength === 0) {
    errors.push("File is empty");
  }

  // MIME type check
  const mimeType = detectMimeType(filename);
  const allowed = config.allowedMimeTypes;
  if (allowed && allowed.length > 0 && !isMimeAllowed(mimeType, allowed)) {
    errors.push(
      `MIME type "${mimeType}" is not allowed. Allowed: ${allowed.join(", ")}`,
    );
  }

  // Dangerous extension check
  const ext = getExtension(filename);
  if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
    errors.push(`File extension "${ext}" is not allowed for security reasons`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a MIME type matches the allow list.
 * Supports wildcard patterns like "image/*".
 */
export function isMimeAllowed(
  mimeType: string,
  allowedTypes: string[],
): boolean {
  return allowedTypes.some((allowed) => {
    if (allowed === "*" || allowed === "*/*") return true;
    if (allowed.endsWith("/*")) {
      const prefix = allowed.slice(0, -1);
      return mimeType.startsWith(prefix);
    }
    return mimeType === allowed;
  });
}

/** Extensions commonly associated with executable/dangerous files. */
const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".pif",
  ".ps1",
  ".vbs",
  ".js", // server-side uploads of raw JS can be risky
  ".sh",
  ".bash",
]);

// ---------------------------------------------------------------------------
// Unique key generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique storage key for a file.
 *
 * Format: `{prefix}/{timestamp}-{random}-{sanitized-filename}`
 *
 * @param filename - Original filename
 * @param prefix - Optional folder prefix (e.g. "uploads", "avatars")
 */
export function generateFileKey(filename: string, prefix?: string): string {
  const sanitized = sanitizeFilename(filename);
  const timestamp = Date.now();
  const random = generateRandomId(8);
  const key = `${timestamp}-${random}-${sanitized}`;
  return prefix ? `${prefix}/${key}` : key;
}

/**
 * Generate a random hex string of the given length (in characters).
 */
function generateRandomId(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

// ---------------------------------------------------------------------------
// Upload options resolution
// ---------------------------------------------------------------------------

/**
 * Resolve upload options, filling in defaults where needed.
 * Generates a key if none is provided and detects content type.
 */
export function resolveUploadOptions(
  filename: string,
  options: UploadOptions = {},
): Required<Pick<UploadOptions, "key" | "contentType" | "acl">> &
  Pick<UploadOptions, "metadata"> {
  return {
    key: options.key ?? generateFileKey(filename),
    contentType: options.contentType ?? detectMimeType(filename),
    acl: options.acl ?? "private",
    metadata: options.metadata,
  };
}

// ---------------------------------------------------------------------------
// Chunked upload helpers
// ---------------------------------------------------------------------------

/** Default chunk size: 5 MB (S3 multipart minimum). */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

export interface ChunkInfo {
  /** Part index (0-based). */
  index: number;
  /** Byte offset in the original data. */
  offset: number;
  /** Length of this chunk in bytes. */
  length: number;
  /** The chunk data. */
  data: Uint8Array;
}

/**
 * Split data into chunks for multipart upload.
 *
 * @param data - Full file contents
 * @param chunkSize - Size of each chunk in bytes (defaults to 5 MB)
 */
export function splitIntoChunks(
  data: Uint8Array,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): ChunkInfo[] {
  if (chunkSize <= 0) {
    throw new Error("Chunk size must be positive");
  }

  const chunks: ChunkInfo[] = [];
  let offset = 0;
  let index = 0;

  while (offset < data.byteLength) {
    const end = Math.min(offset + chunkSize, data.byteLength);
    chunks.push({
      index,
      offset,
      length: end - offset,
      data: data.slice(offset, end),
    });
    offset = end;
    index++;
  }

  return chunks;
}

/**
 * Track upload progress for chunked uploads.
 */
export interface UploadProgress {
  /** Total bytes to upload. */
  totalBytes: number;
  /** Bytes uploaded so far. */
  uploadedBytes: number;
  /** Number of completed chunks. */
  completedChunks: number;
  /** Total number of chunks. */
  totalChunks: number;
  /** Progress as a percentage (0-100). */
  percentage: number;
}

/**
 * Create an upload progress tracker.
 */
export function createProgressTracker(
  totalBytes: number,
  totalChunks: number,
): {
  update: (chunkSize: number) => UploadProgress;
  current: () => UploadProgress;
} {
  let uploadedBytes = 0;
  let completedChunks = 0;

  const current = (): UploadProgress => ({
    totalBytes,
    uploadedBytes,
    completedChunks,
    totalChunks,
    percentage:
      totalBytes === 0 ? 100 : Math.round((uploadedBytes / totalBytes) * 100),
  });

  const update = (chunkSize: number): UploadProgress => {
    uploadedBytes += chunkSize;
    completedChunks++;
    return current();
  };

  return { update, current };
}
