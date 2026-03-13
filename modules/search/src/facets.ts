/**
 * Faceted search implementation.
 *
 * Design: Facets are the "filter sidebar" of search UIs — showing counts
 * for each category/attribute value. We compute them from the search result
 * set, not the full index, so facet counts reflect the current query.
 *
 * Range facets handle numeric fields (price ranges, date ranges, etc).
 */

import type {
  FacetConfig,
  FacetRange,
  FacetResult,
  FacetValue,
} from "./types.js";

/**
 * Extract facet values and counts from a set of documents.
 *
 * @param docs - The documents to extract facets from (typically search results)
 * @param config - Facet configuration
 * @returns FacetResult with value counts
 */
export function extractFacets<T extends Record<string, unknown>>(
  docs: T[],
  config: FacetConfig,
): FacetResult {
  const limit = config.limit ?? 10;

  // If range facets are configured, use range bucketing
  if (config.ranges && config.ranges.length > 0) {
    return extractRangeFacets(docs, config.field, config.ranges, limit);
  }

  // Standard value faceting
  const counts = new Map<string, number>();

  for (const doc of docs) {
    const value = getNestedField(doc, config.field);
    if (value === undefined || value === null) continue;

    // Handle array values (e.g., tags: ["a", "b"])
    if (Array.isArray(value)) {
      for (const v of value) {
        const strVal = String(v);
        counts.set(strVal, (counts.get(strVal) ?? 0) + 1);
      }
    } else {
      const strVal = String(value);
      counts.set(strVal, (counts.get(strVal) ?? 0) + 1);
    }
  }

  // Sort by count (descending), then alphabetically
  const values: FacetValue[] = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);

  return { field: config.field, values };
}

/**
 * Extract range-based facets for numeric fields.
 */
function extractRangeFacets<T extends Record<string, unknown>>(
  docs: T[],
  field: string,
  ranges: FacetRange[],
  limit: number,
): FacetResult {
  const counts = new Map<string, number>();

  // Initialize all range labels with 0
  for (const range of ranges) {
    counts.set(range.label, 0);
  }

  for (const doc of docs) {
    const value = getNestedField(doc, field);
    if (value === undefined || value === null) continue;

    const num = Number(value);
    if (Number.isNaN(num)) continue;

    // A document can fall into multiple ranges (if ranges overlap)
    for (const range of ranges) {
      const aboveMin = range.min === undefined || num >= range.min;
      const belowMax = range.max === undefined || num < range.max;

      if (aboveMin && belowMax) {
        counts.set(range.label, (counts.get(range.label) ?? 0) + 1);
      }
    }
  }

  const values: FacetValue[] = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .slice(0, limit);

  return { field, values };
}

/**
 * Filter documents by facet value.
 *
 * @param docs - Documents to filter
 * @param field - Field to filter on
 * @param filterValues - Values to match (OR logic — match any)
 * @returns Filtered documents
 */
export function filterByFacet<T extends Record<string, unknown>>(
  docs: T[],
  field: string,
  filterValues: string | string[],
): T[] {
  const values = Array.isArray(filterValues) ? filterValues : [filterValues];
  const valueSet = new Set(values);

  return docs.filter((doc) => {
    const fieldValue = getNestedField(doc, field);
    if (fieldValue === undefined || fieldValue === null) return false;

    if (Array.isArray(fieldValue)) {
      return fieldValue.some((v) => valueSet.has(String(v)));
    }

    return valueSet.has(String(fieldValue));
  });
}

/**
 * Compute multiple facets at once from a document set.
 */
export function computeFacets<T extends Record<string, unknown>>(
  docs: T[],
  configs: FacetConfig[],
): Record<string, FacetResult> {
  const results: Record<string, FacetResult> = {};

  for (const config of configs) {
    results[config.field] = extractFacets(docs, config);
  }

  return results;
}

/**
 * Get a nested field value using dot notation.
 * e.g., getNestedField(doc, "author.name") returns doc.author.name
 */
function getNestedField(
  obj: Record<string, unknown>,
  field: string,
): unknown {
  const parts = field.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
