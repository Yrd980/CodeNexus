/**
 * @codenexus/search — Full-text search engine
 *
 * A lightweight, in-process search engine with inverted index, TF-IDF scoring,
 * fuzzy matching, and faceted search. Zero dependencies.
 *
 * @example
 * ```ts
 * import { createSearchEngine } from "@codenexus/search";
 *
 * const engine = createSearchEngine({
 *   fields: ["title", "body"],
 *   weights: { title: 2, body: 1 },
 * });
 *
 * engine.addAll([
 *   { id: "1", title: "Getting Started", body: "..." },
 *   { id: "2", title: "Advanced Guide", body: "..." },
 * ]);
 *
 * const { results } = engine.search("getting started");
 * ```
 */

export { SearchEngine } from "./search-engine.js";
export { InvertedIndex, levenshteinDistance } from "./index-builder.js";
export { createDefaultTokenizer, tokenizeWithPositions } from "./tokenizer.js";
export {
  extractFacets,
  filterByFacet,
  computeFacets,
} from "./facets.js";
export {
  fuzzyMatch,
  maxDistanceForThreshold,
  prefixMatch,
  findPrefixMatches,
  phoneticEncode,
  phoneticMatch,
} from "./fuzzy.js";

export type {
  SearchConfig,
  SearchResult,
  SearchResponse,
  SearchOptions,
  SearchIndex,
  FacetConfig,
  FacetResult,
  FacetValue,
  FacetRange,
  TokenizerFn,
  ScoringStrategy,
  Posting,
} from "./types.js";

import type { SearchConfig, SearchIndex } from "./types.js";
import { SearchEngine } from "./search-engine.js";

/**
 * Create a new search engine instance.
 *
 * This is the recommended entry point. Pass configuration with the fields
 * you want to search, optional weights, and other settings.
 *
 * @param config - Search configuration
 * @returns A configured SearchIndex instance
 *
 * @example
 * ```ts
 * const search = createSearchEngine({
 *   fields: ["title", "description", "tags"],
 *   weights: { title: 3, description: 1, tags: 2 },
 *   fuzzyThreshold: 0.3,
 * });
 * ```
 */
export function createSearchEngine<T extends Record<string, unknown>>(
  config: SearchConfig,
): SearchIndex<T> {
  return new SearchEngine<T>(config);
}
