/**
 * Pagination utilities.
 *
 * Cursor-based pagination is the default recommendation because:
 * - It is stable when data is inserted/deleted between pages.
 * - It scales to large datasets (no OFFSET scan).
 *
 * Offset-based pagination is included for backwards compatibility and simpler
 * use-cases (admin dashboards, etc.).
 */

import type { PageInfo, PaginationDefaults } from "./types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PAGINATION: PaginationDefaults = {
  defaultLimit: 20,
  maxLimit: 100,
};

// ---------------------------------------------------------------------------
// Cursor encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encode an opaque cursor.  We base64-encode so callers cannot rely on the
 * internal format (which may change).
 */
export function encodeCursor(value: string | number): string {
  const raw = `cursor:${value}`;
  // Use btoa for universal compatibility (Node 16+, browsers, edge runtimes)
  return btoa(raw);
}

/**
 * Decode a cursor previously created with `encodeCursor`.
 * Returns `null` for invalid cursors instead of throwing.
 */
export function decodeCursor(cursor: string): string | null {
  try {
    const raw = atob(cursor);
    if (!raw.startsWith("cursor:")) return null;
    return raw.slice("cursor:".length);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cursor-based pagination helper
// ---------------------------------------------------------------------------

export interface CursorPageInput<T> {
  /** The full fetched slice — should contain `limit + 1` items if there is a next page. */
  items: T[];
  limit: number;
  /** Extract the cursor value from an item (usually an ID or timestamp). */
  getCursor: (item: T) => string | number;
  /** Whether we are paging backward. */
  backward?: boolean;
  /** Total count, if known. Optional because COUNT(*) can be expensive. */
  totalCount?: number;
  /** Whether there is a previous page (caller knows from the presence of a cursor). */
  hasPreviousPage?: boolean;
}

/**
 * Given a raw fetched slice (with one extra item), compute `PageInfo` and
 * trim the data array to the requested limit.
 */
export function cursorPage<T>(input: CursorPageInput<T>): {
  data: T[];
  pageInfo: PageInfo;
} {
  const { items, limit, getCursor, backward, totalCount } = input;

  const hasExtra = items.length > limit;
  const trimmed = hasExtra ? items.slice(0, limit) : [...items];

  // When paging backward we fetched in reverse, so flip back
  if (backward) trimmed.reverse();

  const hasNextPage = backward ? (input.hasPreviousPage ?? false) : hasExtra;
  const hasPreviousPage = backward ? hasExtra : (input.hasPreviousPage ?? false);

  const firstItem = trimmed[0];
  const lastItem = trimmed[trimmed.length - 1];
  const startCursor = firstItem !== undefined ? encodeCursor(getCursor(firstItem)) : null;
  const endCursor = lastItem !== undefined ? encodeCursor(getCursor(lastItem)) : null;

  return {
    data: trimmed,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor,
      endCursor,
      ...(totalCount !== undefined ? { totalCount } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Offset-based pagination helper
// ---------------------------------------------------------------------------

export interface OffsetPageInput {
  totalCount: number;
  offset: number;
  limit: number;
}

export function offsetPageInfo(input: OffsetPageInput): PageInfo {
  const { totalCount, offset, limit } = input;
  const hasNextPage = offset + limit < totalCount;
  const hasPreviousPage = offset > 0;

  return {
    hasNextPage,
    hasPreviousPage,
    startCursor: null,
    endCursor: null,
    totalCount,
  };
}

// ---------------------------------------------------------------------------
// Limit clamping
// ---------------------------------------------------------------------------

/** Clamp a user-supplied limit to the configured range. */
export function clampLimit(
  requested: number | undefined,
  defaults: PaginationDefaults = DEFAULT_PAGINATION,
): number {
  const raw = requested ?? defaults.defaultLimit;
  return Math.max(1, Math.min(raw, defaults.maxLimit));
}
