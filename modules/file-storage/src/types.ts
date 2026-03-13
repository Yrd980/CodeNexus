/**
 * Core type definitions for the file-storage module.
 *
 * Provider-agnostic types that model file storage operations,
 * upload handling, signed URLs, and file metadata.
 */

// ---------------------------------------------------------------------------
// File metadata
// ---------------------------------------------------------------------------

export interface FileMetadata {
  /** Storage key (path) for the file. */
  key: string;
  /** File size in bytes. */
  size: number;
  /** MIME type of the file. */
  mimeType: string;
  /** Entity tag for cache validation. */
  etag: string;
  /** Last modification timestamp. */
  lastModified: Date;
  /** Arbitrary key-value metadata attached to the file. */
  customMetadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Upload / download options
// ---------------------------------------------------------------------------

export type AccessControl = "public" | "private";

export interface UploadOptions {
  /** Storage key (path) for the file. If omitted, one is generated. */
  key?: string;
  /** MIME content type. Detected from extension if omitted. */
  contentType?: string;
  /** Custom metadata to attach. */
  metadata?: Record<string, string>;
  /** Access control level. Defaults to "private". */
  acl?: AccessControl;
}

export interface UploadResult {
  /** Final storage key. */
  key: string;
  /** File size in bytes. */
  size: number;
  /** MIME type stored. */
  mimeType: string;
  /** Entity tag. */
  etag: string;
}

// ---------------------------------------------------------------------------
// Signed URL options
// ---------------------------------------------------------------------------

export type SignedUrlMethod = "GET" | "PUT";

export interface SignedUrlOptions {
  /** Seconds until the URL expires. Defaults to 3600 (1 hour). */
  expiresIn?: number;
  /** HTTP method the URL is valid for. Defaults to "GET". */
  method?: SignedUrlMethod;
  /** Content type (required for PUT signed URLs). */
  contentType?: string;
}

export interface SignedUrl {
  /** The signed URL string. */
  url: string;
  /** Expiration timestamp. */
  expiresAt: Date;
  /** HTTP method this URL is valid for. */
  method: SignedUrlMethod;
}

// ---------------------------------------------------------------------------
// List options
// ---------------------------------------------------------------------------

export interface ListOptions {
  /** Only return files whose keys start with this prefix. */
  prefix?: string;
  /** Maximum number of files to return. */
  limit?: number;
  /** Continuation token for pagination. */
  cursor?: string;
}

export interface ListResult {
  /** The file metadata entries. */
  files: FileMetadata[];
  /** Token to pass for the next page, or null if no more. */
  cursor: string | null;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface StorageProvider {
  /** Upload a file (buffer) to storage. */
  upload(data: Uint8Array, options: UploadOptions): Promise<UploadResult>;

  /** Download a file and return its content. */
  download(key: string): Promise<{ data: Uint8Array; metadata: FileMetadata }>;

  /** Delete a file. Returns true if deleted, false if not found. */
  delete(key: string): Promise<boolean>;

  /** Check whether a file exists at the given key. */
  exists(key: string): Promise<boolean>;

  /** Get metadata for a file without downloading content. */
  getMetadata(key: string): Promise<FileMetadata>;

  /** Generate a signed URL for the given key. */
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<SignedUrl>;

  /** List files, optionally filtered by prefix. */
  list(options?: ListOptions): Promise<ListResult>;
}

// ---------------------------------------------------------------------------
// Storage configuration
// ---------------------------------------------------------------------------

export type ProviderType = "memory" | "local" | "s3";

export interface StorageConfig {
  /** Which provider to use. */
  provider: ProviderType;
  /** Bucket / root directory name. */
  bucket: string;
  /** Cloud region (used by S3 provider). */
  region?: string;
  /** Credentials (used by S3 provider). */
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  /** Maximum file size in bytes. Defaults to 10 MB. */
  maxFileSize?: number;
  /** Allowed MIME types. Empty array means allow all. */
  allowedMimeTypes?: string[];
  /** Base path for local provider. */
  basePath?: string;
  /** Secret key for HMAC URL signing (required for signed URLs). */
  signingSecret?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StorageError extends Error {
  public readonly code: StorageErrorCode;
  public readonly key?: string;

  constructor(code: StorageErrorCode, message: string, key?: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.key = key;
  }
}

export type StorageErrorCode =
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "INVALID_MIME_TYPE"
  | "INVALID_EXTENSION"
  | "UPLOAD_FAILED"
  | "DOWNLOAD_FAILED"
  | "DELETE_FAILED"
  | "SIGNED_URL_EXPIRED"
  | "SIGNED_URL_INVALID"
  | "PROVIDER_ERROR";
