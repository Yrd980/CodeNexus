import { describe, expect, it } from "vitest";
import {
  detectMimeType,
  getExtensionForMime,
  getExtension,
  formatFileSize,
  parseFileSize,
  sanitizeFilename,
} from "../src/metadata.js";

// ---------------------------------------------------------------------------
// MIME type detection
// ---------------------------------------------------------------------------
describe("detectMimeType", () => {
  it("detects common image types", () => {
    expect(detectMimeType("photo.jpg")).toBe("image/jpeg");
    expect(detectMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(detectMimeType("logo.png")).toBe("image/png");
    expect(detectMimeType("animation.gif")).toBe("image/gif");
    expect(detectMimeType("image.webp")).toBe("image/webp");
    expect(detectMimeType("icon.svg")).toBe("image/svg+xml");
  });

  it("detects document types", () => {
    expect(detectMimeType("report.pdf")).toBe("application/pdf");
    expect(detectMimeType("data.csv")).toBe("text/csv");
    expect(detectMimeType("config.json")).toBe("application/json");
  });

  it("detects video/audio types", () => {
    expect(detectMimeType("video.mp4")).toBe("video/mp4");
    expect(detectMimeType("song.mp3")).toBe("audio/mpeg");
  });

  it("returns octet-stream for unknown extensions", () => {
    expect(detectMimeType("file.xyz")).toBe("application/octet-stream");
    expect(detectMimeType("file.unknown")).toBe("application/octet-stream");
  });

  it("returns octet-stream when no extension present", () => {
    expect(detectMimeType("README")).toBe("application/octet-stream");
    expect(detectMimeType("Makefile")).toBe("application/octet-stream");
  });

  it("is case-insensitive on extension", () => {
    expect(detectMimeType("Photo.JPG")).toBe("image/jpeg");
    expect(detectMimeType("File.PDF")).toBe("application/pdf");
  });
});

// ---------------------------------------------------------------------------
// Extension lookup
// ---------------------------------------------------------------------------
describe("getExtensionForMime", () => {
  it("returns the extension for a known MIME type", () => {
    expect(getExtensionForMime("image/png")).toBe(".png");
    expect(getExtensionForMime("application/pdf")).toBe(".pdf");
  });

  it("returns undefined for an unknown MIME type", () => {
    expect(getExtensionForMime("application/x-custom")).toBeUndefined();
  });
});

describe("getExtension", () => {
  it("extracts the extension from a filename", () => {
    expect(getExtension("photo.jpg")).toBe(".jpg");
    expect(getExtension("archive.tar.gz")).toBe(".gz");
  });

  it("lowercases the extension", () => {
    expect(getExtension("Photo.PNG")).toBe(".png");
  });

  it("returns undefined when no extension", () => {
    expect(getExtension("README")).toBeUndefined();
  });

  it("returns undefined when trailing dot", () => {
    expect(getExtension("file.")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// File size formatting
// ---------------------------------------------------------------------------
describe("formatFileSize", () => {
  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.00 KB");
    expect(formatFileSize(1536)).toBe("1.50 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1048576)).toBe("1.00 MB");
    expect(formatFileSize(10485760)).toBe("10.00 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(1073741824)).toBe("1.00 GB");
  });

  it("handles negative values", () => {
    expect(formatFileSize(-1024)).toBe("-1.00 KB");
  });
});

describe("parseFileSize", () => {
  it("parses bytes", () => {
    expect(parseFileSize("100 B")).toBe(100);
    expect(parseFileSize("100")).toBe(100);
  });

  it("parses kilobytes", () => {
    expect(parseFileSize("1 KB")).toBe(1024);
    expect(parseFileSize("1.5KB")).toBe(1536);
  });

  it("parses megabytes", () => {
    expect(parseFileSize("10 MB")).toBe(10485760);
  });

  it("parses gigabytes", () => {
    expect(parseFileSize("1 GB")).toBe(1073741824);
  });

  it("is case insensitive", () => {
    expect(parseFileSize("10mb")).toBe(10485760);
    expect(parseFileSize("1 kb")).toBe(1024);
  });

  it("returns undefined for invalid input", () => {
    expect(parseFileSize("abc")).toBeUndefined();
    expect(parseFileSize("")).toBeUndefined();
    expect(parseFileSize("10 XB")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Filename sanitization
// ---------------------------------------------------------------------------
describe("sanitizeFilename", () => {
  it("keeps safe filenames unchanged", () => {
    expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
    expect(sanitizeFilename("my-file_2024.pdf")).toBe("my-file_2024.pdf");
  });

  it("removes path traversal", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeFilename("..\\..\\windows\\system32")).toBe("windowssystem32");
  });

  it("replaces spaces and special characters", () => {
    expect(sanitizeFilename("my file (1).jpg")).toBe("my-file-1-.jpg");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeFilename("a---b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens/dots", () => {
    expect(sanitizeFilename("-file-")).toBe("file");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
  });
});
