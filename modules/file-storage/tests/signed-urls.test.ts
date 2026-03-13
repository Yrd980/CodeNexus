import { describe, expect, it, vi, afterEach } from "vitest";
import { generateSignedUrl, verifySignedUrl } from "../src/signed-urls.js";

const TEST_SECRET = "test-signing-secret-12345";
const TEST_BASE_URL = "https://storage.example.com";

// ---------------------------------------------------------------------------
// Signed URL generation
// ---------------------------------------------------------------------------
describe("generateSignedUrl", () => {
  it("generates a signed GET URL", async () => {
    const result = await generateSignedUrl({
      key: "uploads/photo.jpg",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
    });

    expect(result.url).toContain("https://storage.example.com/uploads/photo.jpg");
    expect(result.url).toContain("expires=");
    expect(result.url).toContain("method=GET");
    expect(result.url).toContain("sig=");
    expect(result.method).toBe("GET");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("generates a signed PUT URL", async () => {
    const result = await generateSignedUrl({
      key: "uploads/new-file.txt",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
      options: { method: "PUT", contentType: "text/plain" },
    });

    expect(result.url).toContain("method=PUT");
    expect(result.url).toContain("contentType=text%2Fplain");
    expect(result.method).toBe("PUT");
  });

  it("respects custom expiration", async () => {
    const before = Date.now();
    const result = await generateSignedUrl({
      key: "file.txt",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
      options: { expiresIn: 60 },
    });

    const expectedMin = before + 60 * 1000;
    const expectedMax = before + 61 * 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("defaults to 1 hour expiration", async () => {
    const before = Date.now();
    const result = await generateSignedUrl({
      key: "file.txt",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
    });

    const expectedMin = before + 3600 * 1000 - 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
  });

  it("URL-encodes the file key", async () => {
    const result = await generateSignedUrl({
      key: "uploads/my file (1).jpg",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
    });

    expect(result.url).toContain("my%20file%20(1).jpg");
  });

  it("handles trailing slash on base URL", async () => {
    const result = await generateSignedUrl({
      key: "file.txt",
      baseUrl: "https://storage.example.com/",
      secret: TEST_SECRET,
    });

    expect(result.url).toContain("https://storage.example.com/file.txt");
    expect(result.url).not.toContain("//file.txt");
  });
});

// ---------------------------------------------------------------------------
// Signed URL verification
// ---------------------------------------------------------------------------
describe("verifySignedUrl", () => {
  it("verifies a valid signed URL", async () => {
    const signed = await generateSignedUrl({
      key: "uploads/photo.jpg",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
      options: { expiresIn: 3600 },
    });

    const result = await verifySignedUrl({ url: signed.url, secret: TEST_SECRET });
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
    expect(result.key).toBe("uploads/photo.jpg");
    expect(result.method).toBe("GET");
  });

  it("verifies a signed PUT URL with content type", async () => {
    const signed = await generateSignedUrl({
      key: "uploads/data.json",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
      options: { method: "PUT", contentType: "application/json" },
    });

    const result = await verifySignedUrl({ url: signed.url, secret: TEST_SECRET });
    expect(result.valid).toBe(true);
    expect(result.method).toBe("PUT");
  });

  it("rejects URLs with wrong secret", async () => {
    const signed = await generateSignedUrl({
      key: "file.txt",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
    });

    const result = await verifySignedUrl({ url: signed.url, secret: "wrong-secret" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid signature");
  });

  it("rejects expired URLs", async () => {
    // Generate a URL that has already expired
    const signed = await generateSignedUrl({
      key: "file.txt",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
      options: { expiresIn: 1 },
    });

    // Advance time past expiration
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 5000);

    const result = await verifySignedUrl({ url: signed.url, secret: TEST_SECRET });
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.error).toContain("expired");

    vi.useRealTimers();
  });

  it("rejects URLs with tampered parameters", async () => {
    const signed = await generateSignedUrl({
      key: "file.txt",
      baseUrl: TEST_BASE_URL,
      secret: TEST_SECRET,
    });

    // Tamper with the key in the URL
    const tamperedUrl = signed.url.replace("file.txt", "other-file.txt");
    const result = await verifySignedUrl({ url: tamperedUrl, secret: TEST_SECRET });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid signature");
  });

  it("rejects invalid URLs", async () => {
    const result = await verifySignedUrl({ url: "not-a-url", secret: TEST_SECRET });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  it("rejects URLs missing required parameters", async () => {
    const result = await verifySignedUrl({
      url: "https://storage.example.com/file.txt",
      secret: TEST_SECRET,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing required");
  });
});

afterEach(() => {
  vi.useRealTimers();
});
