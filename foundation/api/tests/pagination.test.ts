import { describe, expect, it } from "vitest";
import {
  encodeCursor,
  decodeCursor,
  cursorPage,
  offsetPageInfo,
  clampLimit,
} from "../src/pagination.js";

describe("cursor encoding/decoding", () => {
  it("round-trips a string cursor", () => {
    const encoded = encodeCursor("abc-123");
    expect(typeof encoded).toBe("string");
    const decoded = decodeCursor(encoded);
    expect(decoded).toBe("abc-123");
  });

  it("round-trips a numeric cursor", () => {
    const encoded = encodeCursor(42);
    const decoded = decodeCursor(encoded);
    expect(decoded).toBe("42");
  });

  it("returns null for invalid cursor", () => {
    expect(decodeCursor("not-valid-base64!!!")).toBe(null);
  });

  it("returns null for tampered cursor (wrong prefix)", () => {
    const tampered = btoa("wrong:123");
    expect(decodeCursor(tampered)).toBe(null);
  });
});

describe("cursorPage", () => {
  it("detects next page when extra item exists", () => {
    const items = [
      { id: 1 },
      { id: 2 },
      { id: 3 }, // extra
    ];
    const { data, pageInfo } = cursorPage({
      items,
      limit: 2,
      getCursor: (item) => item.id,
    });
    expect(data).toHaveLength(2);
    expect(pageInfo.hasNextPage).toBe(true);
    expect(pageInfo.hasPreviousPage).toBe(false);
  });

  it("no next page when items <= limit", () => {
    const { data, pageInfo } = cursorPage({
      items: [{ id: 1 }, { id: 2 }],
      limit: 2,
      getCursor: (item) => item.id,
    });
    expect(data).toHaveLength(2);
    expect(pageInfo.hasNextPage).toBe(false);
  });

  it("sets hasPreviousPage when provided", () => {
    const { pageInfo } = cursorPage({
      items: [{ id: 3 }, { id: 4 }],
      limit: 2,
      getCursor: (item) => item.id,
      hasPreviousPage: true,
    });
    expect(pageInfo.hasPreviousPage).toBe(true);
  });

  it("returns null cursors for empty data", () => {
    const { data, pageInfo } = cursorPage({
      items: [],
      limit: 10,
      getCursor: (item: { id: number }) => item.id,
    });
    expect(data).toHaveLength(0);
    expect(pageInfo.startCursor).toBeNull();
    expect(pageInfo.endCursor).toBeNull();
  });

  it("includes totalCount when provided", () => {
    const { pageInfo } = cursorPage({
      items: [{ id: 1 }],
      limit: 10,
      getCursor: (item) => item.id,
      totalCount: 42,
    });
    expect(pageInfo.totalCount).toBe(42);
  });

  it("omits totalCount when not provided", () => {
    const { pageInfo } = cursorPage({
      items: [{ id: 1 }],
      limit: 10,
      getCursor: (item) => item.id,
    });
    expect(pageInfo.totalCount).toBeUndefined();
  });

  it("produces valid cursors that can be decoded", () => {
    const { pageInfo } = cursorPage({
      items: [{ id: "abc" }, { id: "def" }],
      limit: 10,
      getCursor: (item) => item.id,
    });
    expect(decodeCursor(pageInfo.startCursor!)).toBe("abc");
    expect(decodeCursor(pageInfo.endCursor!)).toBe("def");
  });
});

describe("offsetPageInfo", () => {
  it("has next page when more items remain", () => {
    const info = offsetPageInfo({ totalCount: 100, offset: 0, limit: 20 });
    expect(info.hasNextPage).toBe(true);
    expect(info.hasPreviousPage).toBe(false);
  });

  it("has previous page when offset > 0", () => {
    const info = offsetPageInfo({ totalCount: 100, offset: 20, limit: 20 });
    expect(info.hasPreviousPage).toBe(true);
    expect(info.hasNextPage).toBe(true);
  });

  it("no next page on last page", () => {
    const info = offsetPageInfo({ totalCount: 100, offset: 80, limit: 20 });
    expect(info.hasNextPage).toBe(false);
    expect(info.hasPreviousPage).toBe(true);
  });

  it("includes totalCount", () => {
    const info = offsetPageInfo({ totalCount: 50, offset: 0, limit: 10 });
    expect(info.totalCount).toBe(50);
  });
});

describe("clampLimit", () => {
  it("uses default when no limit provided", () => {
    expect(clampLimit(undefined)).toBe(20);
  });

  it("clamps to max", () => {
    expect(clampLimit(500)).toBe(100);
  });

  it("clamps to minimum of 1", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it("respects custom defaults", () => {
    expect(clampLimit(undefined, { defaultLimit: 50, maxLimit: 200 })).toBe(50);
    expect(clampLimit(300, { defaultLimit: 50, maxLimit: 200 })).toBe(200);
  });
});
