# File Storage

## 解决什么问题

File uploads are deceptively complex. Size limits, type validation, unique naming, signed URLs for security — every startup builds this from scratch. You start with `fs.writeFile` in a prototype, then need S3 for production, then maybe switch to R2 for cost. Without a provider abstraction, every migration means rewriting upload logic, signed URL generation, and metadata handling across your entire codebase.

This module gives you a clean `StorageProvider` interface with in-memory and filesystem implementations out of the box, plus all the upload handling utilities (validation, key generation, chunking, progress tracking) and HMAC-based signed URL patterns you need for production file storage.

## 为什么这样设计

**Provider abstraction** — The `StorageProvider` interface decouples your application code from the storage backend. Start with `MemoryStorageProvider` in tests, `LocalStorageProvider` in dev, and implement S3/R2/GCS when you're ready. One interface, zero rewrites.

**Signed URLs over proxy** — Direct-to-storage upload via presigned URLs is the scalable pattern. Your server never touches the file bytes for large uploads — it just signs a URL and the client uploads directly. This module includes HMAC-based signing that demonstrates the pattern; in production, use your cloud provider's native presigned URL mechanism.

**File validation first** — Accepting any file is a security vulnerability. The validation layer checks file size, MIME type whitelist, and blocks dangerous extensions (.exe, .bat, etc.) before any storage operation happens.

**Zero runtime dependencies** — The entire module uses Node.js built-ins and Web Crypto API. No AWS SDK, no multer, no third-party packages. When you need S3, implement the `StorageProvider` interface using the AWS SDK — the pattern is already in place.

**Memory provider for testing** — File storage code is notoriously hard to test. The `MemoryStorageProvider` lets you write fast, deterministic tests without touching the filesystem or mocking S3.

### 权衡

- **No actual S3 implementation** — Intentional. This is the pattern, not a wrapper. The S3 SDK changes, R2 has quirks, GCS is different. The abstraction is what matters; implementing the interface is a few dozen lines with any SDK.
- **HMAC signing vs. cloud-native signing** — Our signed URLs use HMAC-SHA256 via Web Crypto. In production with S3, you'd use `getSignedUrl` from the AWS SDK. The pattern (string-to-sign, expiration, signature verification) is identical.
- **No streaming** — We use `Uint8Array` for simplicity. For multi-GB files, you'd want `ReadableStream` in the provider interface. This covers 95% of startup file upload use cases (images, documents, CSVs).

## 快速使用

### Basic upload/download

```typescript
import {
  createStorageProvider,
  validateFile,
} from "@codenexus/file-storage";

// Create a provider (memory for dev, local for staging, s3 for prod)
const storage = createStorageProvider({
  provider: "memory",
  bucket: "my-app-uploads",
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  allowedMimeTypes: ["image/*", "application/pdf"],
  signingSecret: process.env.STORAGE_SIGNING_SECRET,
});

// Validate before upload
const fileData = new Uint8Array(/* file bytes */);
const validation = validateFile(fileData, "photo.jpg", {
  maxFileSize: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/*"],
});

if (!validation.valid) {
  console.error("Validation failed:", validation.errors);
} else {
  // Upload
  const result = await storage.upload(fileData, {
    key: "users/123/avatar.jpg",
    contentType: "image/jpeg",
    metadata: { userId: "123", purpose: "avatar" },
    acl: "public",
  });
  console.log(`Uploaded: ${result.key} (${result.size} bytes)`);
}

// Download
const { data, metadata } = await storage.download("users/123/avatar.jpg");
console.log(`Downloaded: ${metadata.mimeType}, ${metadata.size} bytes`);
```

### Signed URLs for direct upload

```typescript
import { generateSignedUrl, verifySignedUrl } from "@codenexus/file-storage";

// Server: generate a signed PUT URL for the client
const signed = await storage.getSignedUrl("uploads/new-file.jpg", {
  method: "PUT",
  contentType: "image/jpeg",
  expiresIn: 300, // 5 minutes
});
// Send signed.url to the client

// Server: verify a signed URL on incoming request
const result = await verifySignedUrl({
  url: incomingUrl,
  secret: process.env.STORAGE_SIGNING_SECRET!,
});
if (!result.valid) {
  return { error: result.error };
}
```

### Chunked upload with progress

```typescript
import { splitIntoChunks, createProgressTracker } from "@codenexus/file-storage";

const chunks = splitIntoChunks(largeFileData, 5 * 1024 * 1024); // 5 MB chunks
const tracker = createProgressTracker(largeFileData.byteLength, chunks.length);

for (const chunk of chunks) {
  await uploadChunk(chunk); // your upload function
  const progress = tracker.update(chunk.length);
  console.log(`Upload: ${progress.percentage}% (${progress.completedChunks}/${progress.totalChunks})`);
}
```

### Utility functions

```typescript
import {
  detectMimeType,
  formatFileSize,
  parseFileSize,
  sanitizeFilename,
  generateFileKey,
} from "@codenexus/file-storage";

detectMimeType("photo.jpg");           // "image/jpeg"
formatFileSize(1536);                   // "1.50 KB"
parseFileSize("10 MB");                 // 10485760
sanitizeFilename("../etc/passwd");      // "etcpasswd"
generateFileKey("photo.jpg", "avatars"); // "avatars/1710388800000-a1b2c3d4-photo.jpg"
```

## 配置项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `provider` | `"memory" \| "local" \| "s3"` | - | Storage backend type |
| `bucket` | `string` | - | Bucket or root directory name |
| `region` | `string` | - | Cloud region (S3) |
| `credentials` | `{ accessKeyId, secretAccessKey }` | - | Cloud credentials (S3) |
| `maxFileSize` | `number` | `10485760` (10 MB) | Maximum upload size in bytes |
| `allowedMimeTypes` | `string[]` | `[]` (allow all) | MIME type whitelist, supports `"image/*"` wildcards |
| `basePath` | `string` | `./storage/{bucket}` | Base directory for local provider |
| `signingSecret` | `string` | `"dev-secret"` | HMAC secret for signed URL generation |

## 实现自己的 S3 Provider

```typescript
import type { StorageProvider } from "@codenexus/file-storage";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;

  constructor(config: StorageConfig) {
    this.client = new S3Client({ region: config.region, credentials: config.credentials });
    this.bucket = config.bucket;
  }

  async upload(data: Uint8Array, options: UploadOptions): Promise<UploadResult> {
    // Use PutObjectCommand with the S3 client
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<SignedUrl> {
    // Use @aws-sdk/s3-request-presigner
  }

  // ... implement remaining methods
}
```

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-14 | 初始版本：provider 抽象、upload 处理、signed URLs、metadata 工具 | 每个 Startup 都需要文件上传，但大多数实现都是紧耦合到特定云服务的。提供可替换的 provider 抽象让测试和迁移变得简单。 |
