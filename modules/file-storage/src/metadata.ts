/**
 * File metadata utilities.
 *
 * MIME type detection, file size formatting, and extension mapping.
 */

// ---------------------------------------------------------------------------
// MIME type <-> extension mapping
// ---------------------------------------------------------------------------

const EXTENSION_TO_MIME: ReadonlyMap<string, string> = new Map([
  // Images
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".avif", "image/avif"],

  // Documents
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".csv", "text/csv"],

  // Text
  [".txt", "text/plain"],
  [".html", "text/html"],
  [".css", "text/css"],
  [".js", "application/javascript"],
  [".json", "application/json"],
  [".xml", "application/xml"],
  [".md", "text/markdown"],
  [".yaml", "application/x-yaml"],
  [".yml", "application/x-yaml"],

  // Archives
  [".zip", "application/zip"],
  [".tar", "application/x-tar"],
  [".gz", "application/gzip"],

  // Audio
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".ogg", "audio/ogg"],

  // Video
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
  [".avi", "video/x-msvideo"],

  // Fonts
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".otf", "font/otf"],

  // Binary
  [".wasm", "application/wasm"],
]);

const MIME_TO_EXTENSION: ReadonlyMap<string, string> = new Map(
  [...EXTENSION_TO_MIME.entries()].map(([ext, mime]) => [mime, ext]),
);

/**
 * Detect MIME type from a filename's extension.
 * Returns `"application/octet-stream"` for unknown extensions.
 */
export function detectMimeType(filename: string): string {
  const ext = getExtension(filename);
  if (!ext) return "application/octet-stream";
  return EXTENSION_TO_MIME.get(ext) ?? "application/octet-stream";
}

/**
 * Get file extension from a MIME type.
 * Returns `undefined` if the MIME type is unknown.
 */
export function getExtensionForMime(mimeType: string): string | undefined {
  return MIME_TO_EXTENSION.get(mimeType);
}

/**
 * Extract the lowercase extension (including the dot) from a filename.
 * Returns `undefined` if there is no extension.
 */
export function getExtension(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) return undefined;
  return filename.slice(lastDot).toLowerCase();
}

// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------

const SIZE_UNITS: readonly string[] = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * Format a byte count into a human-readable string.
 *
 * @example
 * formatFileSize(1024)       // "1.00 KB"
 * formatFileSize(1536)       // "1.50 KB"
 * formatFileSize(0)          // "0 B"
 * formatFileSize(1073741824) // "1.00 GB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 0) return `-${formatFileSize(-bytes)}`;

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  const unit = SIZE_UNITS[exponent];

  if (exponent === 0) return `${bytes} B`;
  return `${value.toFixed(2)} ${unit}`;
}

/**
 * Parse a human-readable file size string into bytes.
 * Supports: "10MB", "1.5 GB", "512 KB", "100 B", "1024".
 *
 * Returns `undefined` for unparseable input.
 */
export function parseFileSize(input: string): number | undefined {
  const trimmed = input.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)?$/i.exec(trimmed);
  if (!match) return undefined;

  const value = parseFloat(match[1] as string);
  const unit = (match[2] ?? "B").toUpperCase();
  const index = SIZE_UNITS.indexOf(unit);
  if (index === -1) return undefined;

  return Math.round(value * Math.pow(1024, index));
}

// ---------------------------------------------------------------------------
// Filename sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename for safe storage.
 * Removes path traversal, special characters, and normalizes whitespace.
 */
export function sanitizeFilename(filename: string): string {
  return (
    filename
      // Remove path separators and traversal
      .replace(/[/\\]/g, "")
      .replace(/\.\./g, "")
      // Replace spaces and special chars with hyphens
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      // Collapse multiple hyphens
      .replace(/-{2,}/g, "-")
      // Trim leading/trailing hyphens and dots
      .replace(/^[-.]|[-.]$/g, "")
  );
}
