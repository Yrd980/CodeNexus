/**
 * Inverted index builder and manager.
 *
 * Design: Classic inverted index — for each term, store the list of documents
 * and fields where it appears, along with term frequency and positions.
 * This is the same fundamental structure Elasticsearch/Lucene uses,
 * just in-memory and simplified.
 *
 * TF-IDF scoring: term frequency * inverse document frequency.
 * A term that appears often in one doc but rarely across all docs gets a
 * high score. This is the simplest scoring that actually works well.
 */

import type { Posting, SearchConfig, TokenizerFn } from "./types.js";
import { createDefaultTokenizer, tokenizeWithPositions } from "./tokenizer.js";

/** Internal document entry stored alongside the inverted index */
interface StoredDocument<T> {
  doc: T;
  fieldLengths: Record<string, number>;
}

/**
 * InvertedIndex manages the core data structures for full-text search.
 *
 * The index is a Map<term, Posting[]> — for each unique term across all
 * documents, we store where it appears (which doc, which field, how often,
 * at what positions).
 */
export class InvertedIndex<T extends Record<string, unknown>> {
  /** term -> list of postings */
  private readonly index = new Map<string, Posting[]>();

  /** docId -> stored document with metadata */
  private readonly documents = new Map<string, StoredDocument<T>>();

  /** Number of documents containing each term (for IDF) */
  private readonly documentFrequency = new Map<string, number>();

  /** Average field lengths (for BM25, but useful for normalization) */
  private readonly avgFieldLengths = new Map<string, number>();

  private readonly fields: string[];
  private readonly weights: Record<string, number>;
  private readonly tokenizer: TokenizerFn;
  private readonly idField: string;

  constructor(config: SearchConfig) {
    this.fields = config.fields;
    this.weights = config.weights ?? {};
    this.tokenizer =
      config.tokenizer ?? createDefaultTokenizer(config.stopWords);
    this.idField = config.idField ?? "id";
  }

  /** Get the tokenizer function used by this index */
  getTokenizer(): TokenizerFn {
    return this.tokenizer;
  }

  /** Add a single document to the index */
  add(doc: T): void {
    const id = this.getDocId(doc);

    if (this.documents.has(id)) {
      // If doc already exists, remove it first (update semantics)
      this.removeById(id);
    }

    const fieldLengths: Record<string, number> = {};

    // Track which terms we've seen across all fields for this document (for doc frequency).
    // Must be outside the field loop so a term in both "title" and "body" is counted once.
    const seenTermsForDoc = new Set<string>();

    for (const field of this.fields) {
      const value = this.getFieldValue(doc, field);
      if (value === undefined) continue;

      const text = String(value);
      const tokensWithPos = tokenizeWithPositions(text, this.tokenizer);
      fieldLengths[field] = tokensWithPos.length;

      // Count term frequencies in this field
      const termFreqs = new Map<string, { count: number; positions: number[] }>();
      for (const { token, position } of tokensWithPos) {
        const existing = termFreqs.get(token);
        if (existing) {
          existing.count++;
          existing.positions.push(position);
        } else {
          termFreqs.set(token, { count: 1, positions: [position] });
        }
      }

      // Add postings to the inverted index
      for (const [term, { count, positions }] of termFreqs) {
        const posting: Posting = {
          docId: id,
          field,
          tf: count,
          positions,
        };

        const existingPostings = this.index.get(term);
        if (existingPostings) {
          existingPostings.push(posting);
        } else {
          this.index.set(term, [posting]);
        }

        // Update document frequency (count each term once per document)
        if (!seenTermsForDoc.has(term)) {
          seenTermsForDoc.add(term);
          this.documentFrequency.set(
            term,
            (this.documentFrequency.get(term) ?? 0) + 1,
          );
        }
      }
    }

    this.documents.set(id, { doc, fieldLengths });
    this.updateAvgFieldLengths();
  }

  /** Add multiple documents at once */
  addAll(docs: T[]): void {
    for (const doc of docs) {
      this.add(doc);
    }
  }

  /** Remove a document by its ID. Returns true if found and removed. */
  removeById(id: string): boolean {
    const stored = this.documents.get(id);
    if (!stored) return false;

    // Remove all postings for this document
    const termsToClean: string[] = [];

    for (const [term, postings] of this.index) {
      const before = postings.length;
      const filtered = postings.filter((p) => p.docId !== id);

      if (filtered.length === 0) {
        termsToClean.push(term);
      } else if (filtered.length < before) {
        this.index.set(term, filtered);
      }

      // Update document frequency
      if (filtered.length < before) {
        const df = this.documentFrequency.get(term);
        if (df !== undefined) {
          if (df <= 1) {
            this.documentFrequency.delete(term);
          } else {
            this.documentFrequency.set(term, df - 1);
          }
        }
      }
    }

    // Remove terms with no postings
    for (const term of termsToClean) {
      this.index.delete(term);
      this.documentFrequency.delete(term);
    }

    this.documents.delete(id);
    this.updateAvgFieldLengths();
    return true;
  }

  /** Remove a document (pass the doc object, extracts ID automatically) */
  remove(doc: T): boolean {
    return this.removeById(this.getDocId(doc));
  }

  /** Update a document — remove old version and add new one */
  update(doc: T): void {
    const id = this.getDocId(doc);
    this.removeById(id);
    this.add(doc);
  }

  /** Get postings for a term (exact match) */
  getPostings(term: string): Posting[] {
    return this.index.get(term) ?? [];
  }

  /**
   * Get postings for a term with fuzzy matching.
   * Returns postings for all terms within the given edit distance.
   */
  getFuzzyPostings(
    term: string,
    maxDistance: number,
  ): { term: string; postings: Posting[]; distance: number }[] {
    const results: { term: string; postings: Posting[]; distance: number }[] =
      [];

    for (const [indexedTerm, postings] of this.index) {
      // Quick length-based pruning: edit distance can't be less than length difference
      if (Math.abs(indexedTerm.length - term.length) > maxDistance) continue;

      const distance = levenshteinDistance(term, indexedTerm);
      if (distance <= maxDistance) {
        results.push({ term: indexedTerm, postings, distance });
      }
    }

    // Sort by distance (prefer closer matches)
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /**
   * Get postings for terms starting with the given prefix.
   * Useful for autocomplete / search-as-you-type.
   */
  getPrefixPostings(prefix: string): { term: string; postings: Posting[] }[] {
    const results: { term: string; postings: Posting[] }[] = [];

    for (const [term, postings] of this.index) {
      if (term.startsWith(prefix)) {
        results.push({ term, postings });
      }
    }

    return results;
  }

  /** Calculate TF-IDF score for a term in a specific document field */
  tfidf(term: string, docId: string, field: string): number {
    const postings = this.getPostings(term);
    const posting = postings.find(
      (p) => p.docId === docId && p.field === field,
    );
    if (!posting) return 0;

    const tf = posting.tf;
    const df = this.documentFrequency.get(term) ?? 0;
    const n = this.documents.size;

    if (df === 0 || n === 0) return 0;

    // TF: 1 + log(tf) — sublinear TF scaling
    const tfScore = 1 + Math.log(tf);

    // IDF: log(1 + N / df) — smoothed IDF so single-document corpora still score > 0
    const idfScore = Math.log(1 + n / df);

    // Apply field weight
    const weight = this.weights[field] ?? 1;

    return tfScore * idfScore * weight;
  }

  /** Get a stored document by ID */
  getDocument(id: string): T | undefined {
    return this.documents.get(id)?.doc;
  }

  /** Check if a document exists */
  hasDocument(id: string): boolean {
    return this.documents.has(id);
  }

  /** Get total number of documents */
  get size(): number {
    return this.documents.size;
  }

  /** Get all document IDs */
  getDocumentIds(): string[] {
    return Array.from(this.documents.keys());
  }

  /** Get all indexed terms (useful for debugging) */
  getTerms(): string[] {
    return Array.from(this.index.keys());
  }

  /** Clear the entire index */
  clear(): void {
    this.index.clear();
    this.documents.clear();
    this.documentFrequency.clear();
    this.avgFieldLengths.clear();
  }

  /** Get the number of documents containing a specific term */
  getDocumentFrequency(term: string): number {
    return this.documentFrequency.get(term) ?? 0;
  }

  /** Get all unique field values for a specific field (for faceting) */
  getFieldValues(field: string): Map<string, string[]> {
    const valueToDocIds = new Map<string, string[]>();

    for (const [id, stored] of this.documents) {
      const value = this.getFieldValue(stored.doc, field);
      if (value === undefined || value === null) continue;

      const strValue = String(value);
      const existing = valueToDocIds.get(strValue);
      if (existing) {
        existing.push(id);
      } else {
        valueToDocIds.set(strValue, [id]);
      }
    }

    return valueToDocIds;
  }

  /** Get the numeric value of a field for a document */
  getNumericFieldValue(docId: string, field: string): number | undefined {
    const stored = this.documents.get(docId);
    if (!stored) return undefined;

    const value = this.getFieldValue(stored.doc, field);
    if (value === undefined || value === null) return undefined;

    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
  }

  // --- Private helpers ---

  private getDocId(doc: T): string {
    const id = doc[this.idField];
    if (id === undefined || id === null) {
      throw new Error(
        `Document is missing the ID field "${this.idField}". ` +
          `Set idField in SearchConfig if your documents use a different key.`,
      );
    }
    return String(id);
  }

  /** Get a field value from a document, supporting nested fields with dot notation */
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

  private updateAvgFieldLengths(): void {
    if (this.documents.size === 0) {
      this.avgFieldLengths.clear();
      return;
    }

    for (const field of this.fields) {
      let total = 0;
      for (const stored of this.documents.values()) {
        total += stored.fieldLengths[field] ?? 0;
      }
      this.avgFieldLengths.set(field, total / this.documents.size);
    }
  }
}

/**
 * Calculate Levenshtein (edit) distance between two strings.
 *
 * Uses the standard dynamic programming approach with O(min(m,n)) space
 * optimization. This is the foundation of fuzzy matching.
 */
export function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  // Single-row DP: we only need the previous row
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);

  // Initialize first row
  for (let j = 0; j <= m; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= n; i++) {
    curr[0] = i;

    for (let j = 1; j <= m; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1, // insertion
        (prev[j] ?? 0) + 1, // deletion
        (prev[j - 1] ?? 0) + cost, // substitution
      );
    }

    // Swap rows
    [prev, curr] = [curr, prev];
  }

  return prev[m] ?? 0;
}
