import { describe, expect, it } from "vitest";
import {
  validateFile,
  isMimeAllowed,
  generateFileKey,
  resolveUploadOptions,
  splitIntoChunks,
  createProgressTracker,
} from "../src/upload.js";

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------
describe("validateFile", () => {
  const textData = new TextEncoder().encode("Hello, world!");

  it("accepts a valid file", () => {
    const result = validateFile(textData, "hello.txt", {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects files exceeding max size", () => {
    const result = validateFile(textData, "hello.txt", { maxFileSize: 5 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum");
  });

  it("rejects empty files", () => {
    const empty = new Uint8Array(0);
    const result = validateFile(empty, "empty.txt", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("empty");
  });

  it("rejects files with disallowed MIME types", () => {
    const result = validateFile(textData, "hello.txt", {
      allowedMimeTypes: ["image/png", "image/jpeg"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not allowed");
  });

  it("accepts files with matching MIME types", () => {
    const result = validateFile(textData, "photo.png", {
      allowedMimeTypes: ["image/png", "image/jpeg"],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects dangerous file extensions", () => {
    const result = validateFile(textData, "malware.exe", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("not allowed for security");
  });

  it("rejects .bat files", () => {
    const result = validateFile(textData, "script.bat", {});
    expect(result.valid).toBe(false);
  });

  it("collects multiple errors", () => {
    const empty = new Uint8Array(0);
    const result = validateFile(empty, "malware.exe", {
      allowedMimeTypes: ["image/png"],
    });
    // Should have: empty + mime type not allowed + dangerous extension
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("uses 10MB default max size", () => {
    const bigData = new Uint8Array(10 * 1024 * 1024 + 1);
    const result = validateFile(bigData, "big.txt", {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum");
  });
});

// ---------------------------------------------------------------------------
// MIME type matching
// ---------------------------------------------------------------------------
describe("isMimeAllowed", () => {
  it("matches exact MIME types", () => {
    expect(isMimeAllowed("image/png", ["image/png", "image/jpeg"])).toBe(true);
    expect(isMimeAllowed("text/plain", ["image/png"])).toBe(false);
  });

  it("supports wildcard type matching", () => {
    expect(isMimeAllowed("image/png", ["image/*"])).toBe(true);
    expect(isMimeAllowed("image/jpeg", ["image/*"])).toBe(true);
    expect(isMimeAllowed("text/plain", ["image/*"])).toBe(false);
  });

  it("supports full wildcard", () => {
    expect(isMimeAllowed("anything/here", ["*"])).toBe(true);
    expect(isMimeAllowed("anything/here", ["*/*"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------
describe("generateFileKey", () => {
  it("generates a key with timestamp and random component", () => {
    const key = generateFileKey("photo.jpg");
    expect(key).toMatch(/^\d+-[a-f0-9]{8}-photo\.jpg$/);
  });

  it("includes prefix when provided", () => {
    const key = generateFileKey("photo.jpg", "avatars");
    expect(key).toMatch(/^avatars\/\d+-[a-f0-9]{8}-photo\.jpg$/);
  });

  it("sanitizes the filename", () => {
    const key = generateFileKey("my photo (1).jpg");
    expect(key).not.toContain(" ");
    expect(key).not.toContain("(");
  });

  it("generates unique keys on consecutive calls", () => {
    const key1 = generateFileKey("photo.jpg");
    const key2 = generateFileKey("photo.jpg");
    expect(key1).not.toBe(key2);
  });
});

// ---------------------------------------------------------------------------
// Upload options resolution
// ---------------------------------------------------------------------------
describe("resolveUploadOptions", () => {
  it("generates key and detects content type when not provided", () => {
    const result = resolveUploadOptions("photo.jpg");
    expect(result.key).toMatch(/\d+-[a-f0-9]{8}-photo\.jpg/);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.acl).toBe("private");
  });

  it("uses provided key and content type", () => {
    const result = resolveUploadOptions("photo.jpg", {
      key: "custom/key.jpg",
      contentType: "image/webp",
      acl: "public",
    });
    expect(result.key).toBe("custom/key.jpg");
    expect(result.contentType).toBe("image/webp");
    expect(result.acl).toBe("public");
  });

  it("preserves metadata", () => {
    const result = resolveUploadOptions("photo.jpg", {
      metadata: { userId: "123" },
    });
    expect(result.metadata).toEqual({ userId: "123" });
  });
});

// ---------------------------------------------------------------------------
// Chunked upload
// ---------------------------------------------------------------------------
describe("splitIntoChunks", () => {
  it("splits data into chunks of the specified size", () => {
    const data = new Uint8Array(100);
    const chunks = splitIntoChunks(data, 30);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]!.length).toBe(30);
    expect(chunks[1]!.length).toBe(30);
    expect(chunks[2]!.length).toBe(30);
    expect(chunks[3]!.length).toBe(10);
  });

  it("returns a single chunk if data is smaller than chunk size", () => {
    const data = new Uint8Array(10);
    const chunks = splitIntoChunks(data, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBe(10);
  });

  it("returns empty array for empty data", () => {
    const data = new Uint8Array(0);
    const chunks = splitIntoChunks(data);
    expect(chunks).toHaveLength(0);
  });

  it("preserves data integrity", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const chunks = splitIntoChunks(data, 3);
    expect(chunks[0]!.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(chunks[1]!.data).toEqual(new Uint8Array([4, 5, 6]));
    expect(chunks[2]!.data).toEqual(new Uint8Array([7, 8, 9]));
    expect(chunks[3]!.data).toEqual(new Uint8Array([10]));
  });

  it("tracks correct offsets", () => {
    const data = new Uint8Array(100);
    const chunks = splitIntoChunks(data, 40);
    expect(chunks[0]!.offset).toBe(0);
    expect(chunks[1]!.offset).toBe(40);
    expect(chunks[2]!.offset).toBe(80);
  });

  it("throws on non-positive chunk size", () => {
    expect(() => splitIntoChunks(new Uint8Array(10), 0)).toThrow();
    expect(() => splitIntoChunks(new Uint8Array(10), -1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Progress tracker
// ---------------------------------------------------------------------------
describe("createProgressTracker", () => {
  it("starts at 0%", () => {
    const tracker = createProgressTracker(1000, 4);
    const progress = tracker.current();
    expect(progress.percentage).toBe(0);
    expect(progress.uploadedBytes).toBe(0);
    expect(progress.completedChunks).toBe(0);
  });

  it("updates progress correctly", () => {
    const tracker = createProgressTracker(1000, 4);
    const p1 = tracker.update(250);
    expect(p1.percentage).toBe(25);
    expect(p1.uploadedBytes).toBe(250);
    expect(p1.completedChunks).toBe(1);

    const p2 = tracker.update(250);
    expect(p2.percentage).toBe(50);
    expect(p2.completedChunks).toBe(2);
  });

  it("reaches 100% after all chunks", () => {
    const tracker = createProgressTracker(100, 2);
    tracker.update(50);
    const final = tracker.update(50);
    expect(final.percentage).toBe(100);
    expect(final.completedChunks).toBe(2);
  });

  it("handles zero-byte uploads", () => {
    const tracker = createProgressTracker(0, 0);
    expect(tracker.current().percentage).toBe(100);
  });
});
