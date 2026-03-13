/**
 * Core type definitions for the search engine.
 *
 * Design: Generic over document type T, constrained to Record<string, unknown>
 * so we can index arbitrary fields. Every configuration has sensible defaults
 * so you can get started with zero config.
 */

/** Function that splits text into indexable tokens */
export type TokenizerFn = (text: string) => string[];

/** Strategy for scoring search results */
export type ScoringStrategy = "tfidf" | "bm25";

/** Configuration for building and querying a search index */
export interface SearchConfig {
  /** Fields to index for full-text search */
  fields: string[];

  /**
   * Per-field weight multipliers for relevance scoring.
   * Higher weight = more influence on final score.
   * Fields not listed default to weight 1.
   */
  weights?: Record<string, number>;

  /**
   * Threshold for fuzzy matching (0-1).
   * 0 = exact match only, 1 = match anything.
   * Represents the maximum normalized edit distance allowed.
   * Default: 0 (exact matching)
   */
  fuzzyThreshold?: number;

  /** Custom tokenizer function. Default: whitespace split + lowercase + strip punctuation */
  tokenizer?: TokenizerFn;

  /** Scoring algorithm to use. Default: "tfidf" */
  scoringStrategy?: ScoringStrategy;

  /** Stop words to remove during tokenization. Set to empty array to disable. */
  stopWords?: string[];

  /** Unique identifier field on documents. Default: "id" */
  idField?: string;
}

/** A single search result with score and metadata */
export interface SearchResult<T> {
  /** The original document */
  item: T;

  /** Relevance score (higher = more relevant) */
  score: number;

  /**
   * Map of field name -> text with matched terms wrapped in <mark> tags.
   * Only populated for fields that had matches.
   */
  highlights: Record<string, string>;

  /** The query terms that matched this document */
  matchedTerms: string[];
}

/** Options for a search query */
export interface SearchOptions {
  /** Maximum number of results to return. Default: 10 */
  limit?: number;

  /** Number of results to skip (for pagination). Default: 0 */
  offset?: number;

  /** Enable fuzzy matching for this query. Overrides config-level setting. */
  fuzzy?: boolean;

  /** Maximum edit distance for fuzzy matching. Default: 2 */
  maxFuzzyDistance?: number;

  /** Boolean operator for multi-term queries. Default: "AND" */
  operator?: "AND" | "OR";

  /** Facet configurations to compute alongside results */
  facets?: FacetConfig[];

  /** Active facet filters to narrow results */
  facetFilters?: Record<string, string | string[]>;
}

/** Full search response including results, facets, and pagination info */
export interface SearchResponse<T> {
  results: SearchResult<T>[];
  totalCount: number;
  facets: Record<string, FacetResult>;
  query: string;
  took: number; // milliseconds
}

/** Configuration for a single facet */
export interface FacetConfig {
  /** The document field to facet on */
  field: string;

  /** Maximum number of facet values to return. Default: 10 */
  limit?: number;

  /** For numeric fields: define range buckets */
  ranges?: FacetRange[];
}

/** A range bucket for numeric facets */
export interface FacetRange {
  label: string;
  min?: number;
  max?: number;
}

/** Result of facet computation */
export interface FacetResult {
  field: string;
  values: FacetValue[];
}

/** A single facet value with its count */
export interface FacetValue {
  value: string;
  count: number;
}

/**
 * The search index interface — the core data structure.
 * Implementations store the inverted index and document store.
 */
export interface SearchIndex<T> {
  /** Add a document to the index */
  add(doc: T): void;

  /** Add multiple documents to the index */
  addAll(docs: T[]): void;

  /** Remove a document by its ID */
  remove(id: string): boolean;

  /** Update a document (remove + re-add) */
  update(doc: T): void;

  /** Search the index */
  search(query: string, options?: SearchOptions): SearchResponse<T>;

  /** Get the number of indexed documents */
  readonly size: number;

  /** Clear the entire index */
  clear(): void;

  /** Get a document by ID, or undefined if not found */
  get(id: string): T | undefined;

  /** Check if a document exists in the index */
  has(id: string): boolean;
}

/**
 * Internal representation of a posting in the inverted index.
 * Maps a term to where it appears.
 */
export interface Posting {
  /** Document ID */
  docId: string;

  /** Field where the term was found */
  field: string;

  /** Term frequency in this field of this document */
  tf: number;

  /** Positions of the term in the tokenized field (for phrase matching) */
  positions: number[];
}
