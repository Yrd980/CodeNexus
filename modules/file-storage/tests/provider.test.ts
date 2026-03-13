import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryStorageProvider,
  LocalStorageProvider,
  createStorageProvider,
} from "../src/provider.js";
import { StorageError } from "../src/types.js";
import type { StorageConfig } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function makeData(content: string): Uint8Array {
  return textEncoder.encode(content);
}

function readData(data: Uint8Array): string {
  return textDecoder.decode(data);
}

// ---------------------------------------------------------------------------
// MemoryStorageProvider
// ---------------------------------------------------------------------------
describe("MemoryStorageProvider", () => {
  let provider: MemoryStorageProvider;

  beforeEach(() => {
    provider = new MemoryStorageProvider({
      provider: "memory",
      bucket: "test-bucket",
      signingSecret: "test-secret",
    });
  });

  describe("upload", () => {
    it("uploads a file and returns metadata", async () => {
      const data = makeData("Hello, World!");
      const result = await provider.upload(data, {
        key: "test/hello.txt",
        contentType: "text/plain",
      });

      expect(result.key).toBe("test/hello.txt");
      expect(result.size).toBe(data.byteLength);
      expect(result.mimeType).toBe("text/plain");
      expect(result.etag).toBeTruthy();
    });

    it("detects content type from filename when not specified", async () => {
      const result = await provider.upload(makeData("png data"), {
        key: "photos/image.png",
      });
      expect(result.mimeType).toBe("image/png");
    });

    it("stores custom metadata", async () => {
      await provider.upload(makeData("data"), {
        key: "file.txt",
        metadata: { userId: "u123", category: "docs" },
      });

      const meta = await provider.getMetadata("file.txt");
      expect(meta.customMetadata).toEqual({ userId: "u123", category: "docs" });
    });
  });

  describe("download", () => {
    it("downloads uploaded file content", async () => {
      const content = "Hello, storage!";
      await provider.upload(makeData(content), { key: "greet.txt" });

      const { data, metadata } = await provider.download("greet.txt");
      expect(readData(data)).toBe(content);
      expect(metadata.key).toBe("greet.txt");
    });

    it("returns a copy (not a reference)", async () => {
      await provider.upload(makeData("original"), { key: "file.txt" });
      const { data } = await provider.download("file.txt");
      data[0] = 0; // mutate the downloaded copy

      const { data: data2 } = await provider.download("file.txt");
      expect(readData(data2)).toBe("original");
    });

    it("throws StorageError for non-existent file", async () => {
      await expect(provider.download("missing.txt")).rejects.toThrow(StorageError);
      try {
        await provider.download("missing.txt");
      } catch (err) {
        expect(err).toBeInstanceOf(StorageError);
        expect((err as StorageError).code).toBe("FILE_NOT_FOUND");
      }
    });
  });

  describe("delete", () => {
    it("deletes an existing file", async () => {
      await provider.upload(makeData("data"), { key: "file.txt" });
      const deleted = await provider.delete("file.txt");
      expect(deleted).toBe(true);
      expect(await provider.exists("file.txt")).toBe(false);
    });

    it("returns false for non-existent file", async () => {
      const deleted = await provider.delete("missing.txt");
      expect(deleted).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await provider.upload(makeData("data"), { key: "file.txt" });
      expect(await provider.exists("file.txt")).toBe(true);
    });

    it("returns false for non-existent file", async () => {
      expect(await provider.exists("missing.txt")).toBe(false);
    });
  });

  describe("getMetadata", () => {
    it("returns file metadata", async () => {
      await provider.upload(makeData("content"), {
        key: "doc.pdf",
        contentType: "application/pdf",
        metadata: { author: "test" },
      });

      const meta = await provider.getMetadata("doc.pdf");
      expect(meta.key).toBe("doc.pdf");
      expect(meta.size).toBe(7); // "content" = 7 bytes
      expect(meta.mimeType).toBe("application/pdf");
      expect(meta.lastModified).toBeInstanceOf(Date);
      expect(meta.customMetadata.author).toBe("test");
    });

    it("throws for non-existent file", async () => {
      await expect(provider.getMetadata("missing.txt")).rejects.toThrow(StorageError);
    });
  });

  describe("getSignedUrl", () => {
    it("generates a signed URL for existing file", async () => {
      await provider.upload(makeData("data"), { key: "file.txt" });
      const signed = await provider.getSignedUrl("file.txt");

      expect(signed.url).toContain("file.txt");
      expect(signed.url).toContain("sig=");
      expect(signed.method).toBe("GET");
      expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("supports PUT method", async () => {
      await provider.upload(makeData("data"), { key: "file.txt" });
      const signed = await provider.getSignedUrl("file.txt", {
        method: "PUT",
        contentType: "text/plain",
      });
      expect(signed.method).toBe("PUT");
    });

    it("throws for non-existent file", async () => {
      await expect(provider.getSignedUrl("missing.txt")).rejects.toThrow(StorageError);
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      await provider.upload(makeData("1"), { key: "docs/a.txt" });
      await provider.upload(makeData("2"), { key: "docs/b.txt" });
      await provider.upload(makeData("3"), { key: "images/c.png" });
      await provider.upload(makeData("4"), { key: "images/d.png" });
      await provider.upload(makeData("5"), { key: "readme.md" });
    });

    it("lists all files", async () => {
      const result = await provider.list();
      expect(result.files).toHaveLength(5);
    });

    it("filters by prefix", async () => {
      const result = await provider.list({ prefix: "docs/" });
      expect(result.files).toHaveLength(2);
      expect(result.files.map((f) => f.key)).toEqual(["docs/a.txt", "docs/b.txt"]);
    });

    it("limits results", async () => {
      const result = await provider.list({ limit: 2 });
      expect(result.files).toHaveLength(2);
      expect(result.cursor).toBe("2");
    });

    it("paginates with cursor", async () => {
      const page1 = await provider.list({ limit: 2 });
      expect(page1.files).toHaveLength(2);
      expect(page1.cursor).not.toBeNull();

      const page2 = await provider.list({ limit: 2, cursor: page1.cursor! });
      expect(page2.files).toHaveLength(2);

      const page3 = await provider.list({ limit: 2, cursor: page2.cursor! });
      expect(page3.files).toHaveLength(1);
      expect(page3.cursor).toBeNull();
    });
  });

  describe("clear/size", () => {
    it("clears all files", async () => {
      await provider.upload(makeData("a"), { key: "a.txt" });
      await provider.upload(makeData("b"), { key: "b.txt" });
      expect(provider.size).toBe(2);

      provider.clear();
      expect(provider.size).toBe(0);
      expect(await provider.exists("a.txt")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// LocalStorageProvider
// ---------------------------------------------------------------------------
describe("LocalStorageProvider", () => {
  let provider: LocalStorageProvider;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `codenexus-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });

    provider = new LocalStorageProvider({
      provider: "local",
      bucket: "test",
      basePath: tempDir,
      signingSecret: "test-local-secret",
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uploads and downloads a file", async () => {
    const content = "Local storage test content";
    await provider.upload(makeData(content), {
      key: "test/hello.txt",
      contentType: "text/plain",
    });

    const { data, metadata } = await provider.download("test/hello.txt");
    expect(readData(data)).toBe(content);
    expect(metadata.key).toBe("test/hello.txt");
    expect(metadata.mimeType).toBe("text/plain");
  });

  it("creates directories as needed", async () => {
    await provider.upload(makeData("deep"), {
      key: "a/b/c/d/deep.txt",
    });
    expect(await provider.exists("a/b/c/d/deep.txt")).toBe(true);
  });

  it("deletes a file", async () => {
    await provider.upload(makeData("data"), { key: "del.txt" });
    const deleted = await provider.delete("del.txt");
    expect(deleted).toBe(true);
    expect(await provider.exists("del.txt")).toBe(false);
  });

  it("returns false when deleting non-existent file", async () => {
    const deleted = await provider.delete("nope.txt");
    expect(deleted).toBe(false);
  });

  it("checks file existence", async () => {
    expect(await provider.exists("nope.txt")).toBe(false);
    await provider.upload(makeData("data"), { key: "yes.txt" });
    expect(await provider.exists("yes.txt")).toBe(true);
  });

  it("throws on download of non-existent file", async () => {
    await expect(provider.download("missing.txt")).rejects.toThrow(StorageError);
  });

  it("stores and retrieves custom metadata", async () => {
    await provider.upload(makeData("data"), {
      key: "meta.txt",
      metadata: { userId: "456" },
    });

    const meta = await provider.getMetadata("meta.txt");
    expect(meta.customMetadata.userId).toBe("456");
  });

  it("generates signed URLs", async () => {
    await provider.upload(makeData("data"), { key: "signed.txt" });
    const signed = await provider.getSignedUrl("signed.txt");
    expect(signed.url).toContain("signed.txt");
    expect(signed.url).toContain("sig=");
  });

  it("lists files with prefix filter", async () => {
    await provider.upload(makeData("1"), { key: "docs/a.txt" });
    await provider.upload(makeData("2"), { key: "docs/b.txt" });
    await provider.upload(makeData("3"), { key: "images/c.png" });

    const result = await provider.list({ prefix: "docs/" });
    expect(result.files).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------
describe("createStorageProvider", () => {
  it("creates a MemoryStorageProvider", () => {
    const provider = createStorageProvider({ provider: "memory", bucket: "test" });
    expect(provider).toBeInstanceOf(MemoryStorageProvider);
  });

  it("creates a LocalStorageProvider", () => {
    const provider = createStorageProvider({
      provider: "local",
      bucket: "test",
      basePath: tmpdir(),
    });
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });

  it("throws for S3 provider (not implemented)", () => {
    expect(() =>
      createStorageProvider({ provider: "s3", bucket: "test" }),
    ).toThrow(StorageError);
  });
});
