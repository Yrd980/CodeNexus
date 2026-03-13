/**
 * modules/file-storage — Storage provider abstraction, upload handling, and signed URLs.
 *
 * @module modules/file-storage
 */

// Types -----------------------------------------------------------------------
export type {
  AccessControl,
  FileMetadata,
  FileValidationResult,
  ListOptions,
  ListResult,
  ProviderType,
  SignedUrl,
  SignedUrlMethod,
  SignedUrlOptions,
  StorageConfig,
  StorageErrorCode,
  StorageProvider,
  UploadOptions,
  UploadResult,
} from "./types.js";

// Re-export the class (not just the type)
export { StorageError } from "./types.js";

// Provider --------------------------------------------------------------------
export {
  MemoryStorageProvider,
  LocalStorageProvider,
  createStorageProvider,
} from "./provider.js";

// Upload ----------------------------------------------------------------------
export {
  validateFile,
  isMimeAllowed,
  generateFileKey,
  resolveUploadOptions,
  splitIntoChunks,
  createProgressTracker,
} from "./upload.js";
export type { ChunkInfo, UploadProgress } from "./upload.js";

// Signed URLs -----------------------------------------------------------------
export { generateSignedUrl, verifySignedUrl } from "./signed-urls.js";
export type {
  SignUrlParams,
  VerifySignedUrlParams,
  VerifyResult,
} from "./signed-urls.js";

// Metadata utilities ----------------------------------------------------------
export {
  detectMimeType,
  getExtensionForMime,
  getExtension,
  formatFileSize,
  parseFileSize,
  sanitizeFilename,
} from "./metadata.js";
