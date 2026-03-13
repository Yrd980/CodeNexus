/**
 * Search engine — the main query interface.
 *
 * Design: The engine ties together the inverted index, fuzzy matching, and
 * faceted search into a single cohesive API. Query parsing handles:
 * - Multi-term queries with AND/OR operators
 * - Exact phrase matching with quotes ("exact phrase")
 * - Field-specific search (field:term)
 * - Fuzzy matching when enabled
 *
 * Results are scored using TF-IDF with field weights, sorted by relevance,
 * and paginated.
 */

import { InvertedIndex } from "./index-builder.js";
import { computeFacets, filterByFacet } from "./facets.js";
import { maxDistanceForThreshold } from "./fuzzy.js";
import type {
  SearchConfig,
  SearchIndex,
  SearchOptions,
  SearchResponse,
  SearchResult,
  TokenizerFn,
} from "./types.js";

/** Parsed representation of a search query */
interface ParsedQuery {
  /** Individual terms to search for */
  terms: string[];

  /** Exact phrases (wrapped in quotes in the original query) */
  phrases: string[];

  /** Field-specific terms: field -> terms */
  fieldTerms: Map<string, string[]>;
}

/**
 * Full-text search engine with inverted index, fuzzy matching, and faceted search.
 *
 * Usage:
 * ```ts
 * const engine = new SearchEngine({
 *   fields: ["title", "body"],
 *   weights: { title: 2, body: 1 },
 * });
 *
 * engine.addAll(documents);
 * const results = engine.search("typescript generics");
 * ```
 */
export class SearchEngine<T extends Record<string, unknown>>
  implements SearchIndex<T>
{
  private readonly invertedIndex: InvertedIndex<T>;
  private readonly config: Required<
    Pick<SearchConfig, "fields" | "fuzzyThreshold" | "idField">
  > &
    SearchConfig;
  private readonly tokenizer: TokenizerFn;

  constructor(config: SearchConfig) {
    if (config.fields.length === 0) {
      throw new Error("SearchConfig.fields must contain at least one field");
    }

    this.config = {
      ...config,
      fuzzyThreshold: config.fuzzyThreshold ?? 0,
      idField: config.idField ?? "id",
    };

    this.invertedIndex = new InvertedIndex(config);
    this.tokenizer = this.invertedIndex.getTokenizer();
  }

  /** Add a document to the index */
  add(doc: T): void {
    this.invertedIndex.add(doc);
  }

  /** Add multiple documents to the index */
  addAll(docs: T[]): void {
    this.invertedIndex.addAll(docs);
  }

  /** Remove a document by its ID */
  remove(id: string): boolean {
    return this.invertedIndex.removeById(id);
  }

  /** Update a document (remove + re-add) */
  update(doc: T): void {
    this.invertedIndex.update(doc);
  }

  /** Get document count */
  get size(): number {
    return this.invertedIndex.size;
  }

  /** Clear the entire index */
  clear(): void {
    this.invertedIndex.clear();
  }

  /** Get a document by ID */
  get(id: string): T | undefined {
    return this.invertedIndex.getDocument(id);
  }

  /** Check if a document exists */
  has(id: string): boolean {
    return this.invertedIndex.hasDocument(id);
  }

  /**
   * Search the index with a query string.
   *
   * Supports:
   * - Simple terms: `typescript generics`
   * - Exact phrases: `"type safety"`
   * - Field-specific: `title:introduction`
   * - Boolean: `typescript OR javascript` (default is AND)
   * - Fuzzy: enabled via options or config
   */
  search(query: string, options?: SearchOptions): SearchResponse<T> {
    const startTime = Date.now();

    const opts: Required<SearchOptions> = {
      limit: options?.limit ?? 10,
      offset: options?.offset ?? 0,
      fuzzy: options?.fuzzy ?? this.config.fuzzyThreshold > 0,
      maxFuzzyDistance: options?.maxFuzzyDistance ?? 2,
      operator: options?.operator ?? "AND",
      facets: options?.facets ?? [],
      facetFilters: options?.facetFilters ?? {},
    };

    // Parse the query into terms, phrases, and field-specific terms
    const parsed = this.parseQuery(query);

    // If empty query, return empty results
    if (
      parsed.terms.length === 0 &&
      parsed.phrases.length === 0 &&
      parsed.fieldTerms.size === 0
    ) {
      return {
        results: [],
        totalCount: 0,
        facets: {},
        query,
        took: Date.now() - startTime,
      };
    }

    // Score all documents
    const scores = this.scoreDocuments(parsed, opts);

    // Get scored document IDs
    let scoredDocs = Array.from(scores.entries())
      .filter(([, score]) => score.totalScore > 0)
      .map(([docId, score]) => ({ docId, ...score }));

    // Apply facet filters before sorting
    if (Object.keys(opts.facetFilters).length > 0) {
      scoredDocs = this.applyFacetFilters(scoredDocs, opts.facetFilters);
    }

    // Sort by score descending
    scoredDocs.sort((a, b) => b.totalScore - a.totalScore);

    const totalCount = scoredDocs.length;

    // Compute facets from the full result set (before pagination)
    const allResultDocs = scoredDocs
      .map((s) => this.invertedIndex.getDocument(s.docId))
      .filter((doc): doc is T => doc !== undefined);

    const facets =
      opts.facets.length > 0
        ? computeFacets(allResultDocs, opts.facets)
        : {};

    // Apply pagination
    const paginated = scoredDocs.slice(opts.offset, opts.offset + opts.limit);

    // Build search results with highlights
    const results: SearchResult<T>[] = paginated
      .map((scored) => {
        const doc = this.invertedIndex.getDocument(scored.docId);
        if (!doc) return undefined;

        return {
          item: doc,
          score: scored.totalScore,
          highlights: this.buildHighlights(doc, scored.matchedTerms),
          matchedTerms: scored.matchedTerms,
        };
      })
      .filter((r): r is SearchResult<T> => r !== undefined);

    return {
      results,
      totalCount,
      facets,
      query,
      took: Date.now() - startTime,
    };
  }

  // --- Query Parsing ---

  private parseQuery(query: string): ParsedQuery {
    const terms: string[] = [];
    const phrases: string[] = [];
    const fieldTerms = new Map<string, string[]>();

    // Extract exact phrases (quoted strings)
    const phraseRegex = /"([^"]+)"/g;
    let remaining = query;
    let match: RegExpExecArray | null;

    while ((match = phraseRegex.exec(query)) !== null) {
      const phrase = match[1];
      if (phrase !== undefined) {
        phrases.push(phrase.toLowerCase());
      }
    }
    remaining = remaining.replace(phraseRegex, " ");

    // Extract field-specific terms (field:term)
    const fieldRegex = /(\w+):(\S+)/g;
    while ((match = fieldRegex.exec(remaining)) !== null) {
      const field = match[1];
      const term = match[2];
      if (field !== undefined && term !== undefined) {
        const existing = fieldTerms.get(field);
        if (existing) {
          existing.push(term.toLowerCase());
        } else {
          fieldTerms.set(field, [term.toLowerCase()]);
        }
      }
    }
    remaining = remaining.replace(fieldRegex, " ");

    // Remove OR operator from remaining text (we handle it in scoring)
    remaining = remaining.replace(/\bOR\b/g, " ");

    // Tokenize remaining terms
    const tokenized = this.tokenizer(remaining);
    terms.push(...tokenized);

    return { terms, phrases, fieldTerms };
  }

  // --- Scoring ---

  private scoreDocuments(
    parsed: ParsedQuery,
    opts: Required<SearchOptions>,
  ): Map<
    string,
    { totalScore: number; matchedTerms: string[] }
  > {
    const docScores = new Map<
      string,
      { totalScore: number; matchedTerms: string[]; termMatches: Set<string> }
    >();

    const initDoc = (docId: string) => {
      if (!docScores.has(docId)) {
        docScores.set(docId, {
          totalScore: 0,
          matchedTerms: [],
          termMatches: new Set(),
        });
      }
      // We know the entry exists because we just set it if it didn't
      return docScores.get(docId) as {
        totalScore: number;
        matchedTerms: string[];
        termMatches: Set<string>;
      };
    };

    // Score regular terms
    for (const term of parsed.terms) {
      const postingGroups = this.getPostingsForTerm(term, opts);

      for (const { postings, matchedTerm } of postingGroups) {
        // Group postings by document
        const docPostings = new Map<string, typeof postings>();
        for (const posting of postings) {
          const existing = docPostings.get(posting.docId);
          if (existing) {
            existing.push(posting);
          } else {
            docPostings.set(posting.docId, [posting]);
          }
        }

        for (const [docId, docPostingList] of docPostings) {
          const entry = initDoc(docId);

          // Sum TF-IDF scores across all fields for this term
          let termScore = 0;
          for (const posting of docPostingList) {
            termScore += this.invertedIndex.tfidf(
              matchedTerm,
              docId,
              posting.field,
            );
          }

          entry.totalScore += termScore;
          entry.termMatches.add(term);

          if (!entry.matchedTerms.includes(term)) {
            entry.matchedTerms.push(term);
          }
        }
      }
    }

    // Score field-specific terms
    for (const [field, fieldSearchTerms] of parsed.fieldTerms) {
      for (const term of fieldSearchTerms) {
        const postingGroups = this.getPostingsForTerm(term, opts);

        for (const { postings, matchedTerm } of postingGroups) {
          // Only consider postings in the specified field
          const fieldPostings = postings.filter((p) => p.field === field);

          for (const posting of fieldPostings) {
            const entry = initDoc(posting.docId);
            const termScore = this.invertedIndex.tfidf(
              matchedTerm,
              posting.docId,
              field,
            );
            entry.totalScore += termScore;
            entry.termMatches.add(term);

            if (!entry.matchedTerms.includes(term)) {
              entry.matchedTerms.push(term);
            }
          }
        }
      }
    }

    // Score exact phrases
    for (const phrase of parsed.phrases) {
      this.scorePhraseMatch(phrase, docScores, initDoc);
    }

    // Apply AND/OR filtering for regular terms
    if (opts.operator === "AND" && parsed.terms.length > 1) {
      // In AND mode, only keep documents that matched ALL terms
      for (const [docId, entry] of docScores) {
        if (entry.termMatches.size < parsed.terms.length) {
          docScores.delete(docId);
        }
      }
    }

    // Strip internal tracking before returning
    const result = new Map<
      string,
      { totalScore: number; matchedTerms: string[] }
    >();
    for (const [docId, entry] of docScores) {
      result.set(docId, {
        totalScore: entry.totalScore,
        matchedTerms: entry.matchedTerms,
      });
    }

    return result;
  }

  /**
   * Get postings for a term, including fuzzy matches if enabled.
   * Returns an array of { postings, matchedTerm } groups.
   */
  private getPostingsForTerm(
    term: string,
    opts: Required<SearchOptions>,
  ): { postings: ReturnType<InvertedIndex<T>["getPostings"]>; matchedTerm: string }[] {
    const exactPostings = this.invertedIndex.getPostings(term);
    const results: {
      postings: ReturnType<InvertedIndex<T>["getPostings"]>;
      matchedTerm: string;
    }[] = [];

    if (exactPostings.length > 0) {
      results.push({ postings: exactPostings, matchedTerm: term });
    }

    // If fuzzy matching is enabled and we didn't get exact results (or always for fuzzy)
    if (opts.fuzzy) {
      const maxDist =
        this.config.fuzzyThreshold > 0
          ? maxDistanceForThreshold(term.length, this.config.fuzzyThreshold)
          : opts.maxFuzzyDistance;

      const effectiveDist = Math.max(1, Math.min(maxDist, opts.maxFuzzyDistance));
      const fuzzyResults = this.invertedIndex.getFuzzyPostings(
        term,
        effectiveDist,
      );

      for (const fuzzyResult of fuzzyResults) {
        // Skip exact match (already added)
        if (fuzzyResult.term === term) continue;

        // Fuzzy matches get a penalty based on edit distance
        const penalty = 1 / (1 + fuzzyResult.distance);
        const penalizedPostings = fuzzyResult.postings.map((p) => ({
          ...p,
          tf: p.tf * penalty,
        }));

        results.push({
          postings: penalizedPostings,
          matchedTerm: fuzzyResult.term,
        });
      }
    }

    return results;
  }

  /**
   * Score phrase matches by checking if consecutive terms appear in order.
   */
  private scorePhraseMatch(
    phrase: string,
    _docScores: Map<
      string,
      { totalScore: number; matchedTerms: string[]; termMatches: Set<string> }
    >,
    initDoc: (
      docId: string,
    ) => {
      totalScore: number;
      matchedTerms: string[];
      termMatches: Set<string>;
    },
  ): void {
    const phraseTokens = this.tokenizer(phrase);
    if (phraseTokens.length === 0) return;

    const firstToken = phraseTokens[0];
    if (firstToken === undefined) return;

    const firstPostings = this.invertedIndex.getPostings(firstToken);

    for (const posting of firstPostings) {
      // For each starting position of the first token
      for (const startPos of posting.positions) {
        let matched = true;

        // Check if subsequent tokens appear at consecutive positions
        for (let i = 1; i < phraseTokens.length; i++) {
          const nextToken = phraseTokens[i];
          if (nextToken === undefined) {
            matched = false;
            break;
          }

          const nextPostings = this.invertedIndex.getPostings(nextToken);
          const hasNextAtPos = nextPostings.some(
            (p) =>
              p.docId === posting.docId &&
              p.field === posting.field &&
              p.positions.includes(startPos + i),
          );

          if (!hasNextAtPos) {
            matched = false;
            break;
          }
        }

        if (matched) {
          const entry = initDoc(posting.docId);
          // Phrase matches get a bonus (they're more specific)
          entry.totalScore += 2.0 * phraseTokens.length;
          entry.termMatches.add(phrase);

          if (!entry.matchedTerms.includes(phrase)) {
            entry.matchedTerms.push(phrase);
          }
        }
      }
    }
  }

  // --- Facet Filtering ---

  private applyFacetFilters(
    scoredDocs: { docId: string; totalScore: number; matchedTerms: string[] }[],
    facetFilters: Record<string, string | string[]>,
  ): typeof scoredDocs {
    let filtered = scoredDocs;

    for (const [field, values] of Object.entries(facetFilters)) {
      const docs = filtered
        .map((s) => this.invertedIndex.getDocument(s.docId))
        .filter((doc): doc is T => doc !== undefined);

      const matchingDocs = filterByFacet(docs, field, values);
      const matchingIds = new Set(
        matchingDocs.map((doc) => String(doc[this.config.idField])),
      );

      filtered = filtered.filter((s) => matchingIds.has(s.docId));
    }

    return filtered;
  }

  // --- Highlighting ---

  /**
   * Build highlight snippets for matched terms in a document.
   * Wraps matched terms in <mark> tags.
   */
  private buildHighlights(
    doc: T,
    matchedTerms: string[],
  ): Record<string, string> {
    const highlights: Record<string, string> = {};

    for (const field of this.config.fields) {
      const value = this.getFieldValue(doc, field);
      if (value === undefined) continue;

      const text = String(value);
      let highlighted = text;

      // Sort terms by length (longest first) to avoid partial replacement issues
      const sortedTerms = [...matchedTerms].sort(
        (a, b) => b.length - a.length,
      );

      for (const term of sortedTerms) {
        // Case-insensitive replacement
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(${escaped})`, "gi");
        highlighted = highlighted.replace(regex, "<mark>$1</mark>");
      }

      // Only include fields that actually have highlights
      if (highlighted !== text) {
        highlights[field] = highlighted;
      }
    }

    return highlights;
  }

  /** Get a field value, supporting dot notation */
  private getFieldValue(doc: T, field: string): unknown {
    const parts = field.split(".");
    let current: unknown = doc;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
