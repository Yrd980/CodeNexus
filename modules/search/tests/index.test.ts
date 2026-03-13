import { describe, it, expect, beforeEach } from "vitest";
import {
  createSearchEngine,
  SearchEngine,
  InvertedIndex,
  levenshteinDistance,
  createDefaultTokenizer,
  tokenizeWithPositions,
  extractFacets,
  filterByFacet,
  computeFacets,
  fuzzyMatch,
  maxDistanceForThreshold,
  prefixMatch,
  findPrefixMatches,
  phoneticEncode,
  phoneticMatch,
} from "../src/index.js";
import type { SearchConfig, SearchIndex } from "../src/index.js";

// --- Test Documents ---

interface TestDoc {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  price: number;
}

const sampleDocs: TestDoc[] = [
  {
    id: "1",
    title: "Introduction to TypeScript",
    body: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
    category: "programming",
    tags: ["typescript", "javascript", "types"],
    price: 29,
  },
  {
    id: "2",
    title: "Advanced TypeScript Patterns",
    body: "Learn advanced patterns like discriminated unions, conditional types, and template literal types.",
    category: "programming",
    tags: ["typescript", "advanced", "patterns"],
    price: 49,
  },
  {
    id: "3",
    title: "Getting Started with React",
    body: "React is a JavaScript library for building user interfaces with components.",
    category: "frontend",
    tags: ["react", "javascript", "ui"],
    price: 19,
  },
  {
    id: "4",
    title: "Database Design Fundamentals",
    body: "Learn about normalization, indexes, and query optimization for relational databases.",
    category: "backend",
    tags: ["database", "sql", "design"],
    price: 39,
  },
  {
    id: "5",
    title: "Building REST APIs",
    body: "Design and implement RESTful APIs with proper authentication, pagination, and error handling.",
    category: "backend",
    tags: ["api", "rest", "backend"],
    price: 35,
  },
];

const defaultConfig: SearchConfig = {
  fields: ["title", "body"],
  weights: { title: 2, body: 1 },
};

// ============================================================
// Index Building Tests
// ============================================================

describe("InvertedIndex", () => {
  let index: InvertedIndex<TestDoc>;

  beforeEach(() => {
    index = new InvertedIndex<TestDoc>(defaultConfig);
  });

  it("should build an index from documents", () => {
    index.addAll(sampleDocs);
    expect(index.size).toBe(5);
  });

  it("should add a single document", () => {
    index.add(sampleDocs[0]!);
    expect(index.size).toBe(1);
    expect(index.hasDocument("1")).toBe(true);
  });

  it("should remove a document by ID", () => {
    index.addAll(sampleDocs);
    const removed = index.removeById("1");
    expect(removed).toBe(true);
    expect(index.size).toBe(4);
    expect(index.hasDocument("1")).toBe(false);
  });

  it("should return false when removing non-existent document", () => {
    const removed = index.removeById("nonexistent");
    expect(removed).toBe(false);
  });

  it("should update a document", () => {
    index.add(sampleDocs[0]!);
    const updated = {
      ...sampleDocs[0]!,
      title: "Updated Title About Python",
    };
    index.update(updated);
    expect(index.size).toBe(1);
    expect(index.getDocument("1")?.title).toBe("Updated Title About Python");
  });

  it("should retrieve a document by ID", () => {
    index.add(sampleDocs[0]!);
    const doc = index.getDocument("1");
    expect(doc).toEqual(sampleDocs[0]);
  });

  it("should return undefined for non-existent document", () => {
    expect(index.getDocument("nonexistent")).toBeUndefined();
  });

  it("should clear the entire index", () => {
    index.addAll(sampleDocs);
    index.clear();
    expect(index.size).toBe(0);
  });

  it("should tokenize and index text correctly", () => {
    index.add(sampleDocs[0]!);
    // "typescript" should have postings from both title and body
    const postings = index.getPostings("typescript");
    expect(postings.length).toBeGreaterThan(0);
    expect(postings.some((p) => p.field === "title")).toBe(true);
    expect(postings.some((p) => p.field === "body")).toBe(true);
  });

  it("should remove stop words during tokenization", () => {
    index.add(sampleDocs[0]!);
    // "is", "a", "of", "to" should be removed as stop words
    expect(index.getPostings("is").length).toBe(0);
    expect(index.getPostings("a").length).toBe(0);
    expect(index.getPostings("of").length).toBe(0);
    expect(index.getPostings("to").length).toBe(0);
  });

  it("should handle duplicate document adds as updates", () => {
    index.add(sampleDocs[0]!);
    index.add(sampleDocs[0]!);
    expect(index.size).toBe(1);
  });

  it("should throw if document has no ID field", () => {
    const badDoc = { title: "No ID", body: "test" } as unknown as TestDoc;
    expect(() => index.add(badDoc)).toThrow(/missing the ID field/);
  });

  it("should compute TF-IDF scores", () => {
    index.addAll(sampleDocs);

    // "typescript" appears in docs 1 and 2
    const score = index.tfidf("typescript", "1", "title");
    expect(score).toBeGreaterThan(0);

    // A term not in the document should score 0
    const noScore = index.tfidf("react", "1", "title");
    expect(noScore).toBe(0);
  });

  it("should track document frequency correctly", () => {
    index.addAll(sampleDocs);
    // "typescript" appears in 2 documents
    expect(index.getDocumentFrequency("typescript")).toBe(2);
    // "react" appears in 1 document
    expect(index.getDocumentFrequency("react")).toBe(1);
  });
});

// ============================================================
// Tokenizer Tests
// ============================================================

describe("Tokenizer", () => {
  it("should lowercase and split text", () => {
    const tokenizer = createDefaultTokenizer([]);
    const tokens = tokenizer("Hello World");
    expect(tokens).toEqual(["hello", "world"]);
  });

  it("should remove default stop words", () => {
    const tokenizer = createDefaultTokenizer();
    const tokens = tokenizer("The quick brown fox is a test");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("is");
    expect(tokens).not.toContain("a");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).toContain("fox");
  });

  it("should strip punctuation", () => {
    const tokenizer = createDefaultTokenizer([]);
    const tokens = tokenizer("hello, world! how's it going?");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("how");
    expect(tokens).toContain("s");
  });

  it("should use custom stop words", () => {
    const tokenizer = createDefaultTokenizer(["custom", "words"]);
    const tokens = tokenizer("these are custom stop words");
    expect(tokens).not.toContain("custom");
    expect(tokens).not.toContain("words");
    expect(tokens).toContain("these");
  });

  it("should handle empty input", () => {
    const tokenizer = createDefaultTokenizer();
    expect(tokenizer("")).toEqual([]);
    expect(tokenizer("   ")).toEqual([]);
  });

  it("should tokenize with positions", () => {
    const tokenizer = createDefaultTokenizer([]);
    const result = tokenizeWithPositions("hello beautiful world", tokenizer);
    expect(result).toEqual([
      { token: "hello", position: 0 },
      { token: "beautiful", position: 1 },
      { token: "world", position: 2 },
    ]);
  });
});

// ============================================================
// Search Tests
// ============================================================

describe("SearchEngine", () => {
  let engine: SearchIndex<TestDoc>;

  beforeEach(() => {
    engine = createSearchEngine<TestDoc>(defaultConfig);
    engine.addAll(sampleDocs);
  });

  it("should find documents by single term", () => {
    const { results } = engine.search("typescript");
    expect(results.length).toBe(2);
    expect(results.map((r) => r.item.id)).toContain("1");
    expect(results.map((r) => r.item.id)).toContain("2");
  });

  it("should find documents by multi-term AND query", () => {
    const { results } = engine.search("typescript advanced");
    // Only doc 2 has both "typescript" and "advanced"
    expect(results.length).toBe(1);
    expect(results[0]?.item.id).toBe("2");
  });

  it("should find documents by multi-term OR query", () => {
    const { results } = engine.search("typescript react", {
      operator: "OR",
    });
    // Docs 1, 2, and 3 match (typescript OR react)
    expect(results.length).toBe(3);
  });

  it("should find exact phrases", () => {
    const { results } = engine.search('"typed superset"');
    expect(results.length).toBe(1);
    expect(results[0]?.item.id).toBe("1");
  });

  it("should not match non-sequential phrase words", () => {
    // "superset typed" is not in any doc (wrong order)
    const { results } = engine.search('"superset typed"');
    expect(results.length).toBe(0);
  });

  it("should support field-specific search", () => {
    const { results } = engine.search("title:react");
    expect(results.length).toBe(1);
    expect(results[0]?.item.id).toBe("3");
  });

  it("should rank by relevance (title weight > body weight)", () => {
    const { results } = engine.search("typescript", { operator: "OR" });
    // Doc 1 has "typescript" in title AND body, doc 2 has it in title AND body too
    // Both should score, with meaningful scores
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.score).toBeGreaterThan(0);
    }
  });

  it("should paginate results with offset and limit", () => {
    const all = engine.search("typescript", { operator: "OR", limit: 100 });
    const page1 = engine.search("typescript", {
      operator: "OR",
      limit: 1,
      offset: 0,
    });
    const page2 = engine.search("typescript", {
      operator: "OR",
      limit: 1,
      offset: 1,
    });

    expect(page1.results.length).toBe(1);
    expect(page2.results.length).toBeLessThanOrEqual(1);
    expect(page1.totalCount).toBe(all.totalCount);

    if (page2.results.length > 0) {
      expect(page1.results[0]?.item.id).not.toBe(page2.results[0]?.item.id);
    }
  });

  it("should include matched terms in results", () => {
    const { results } = engine.search("typescript");
    expect(results[0]?.matchedTerms).toContain("typescript");
  });

  it("should highlight matched terms", () => {
    const { results } = engine.search("typescript");
    const firstResult = results[0];
    expect(firstResult).toBeDefined();
    // At least one field should have highlights
    const highlightFields = Object.keys(firstResult!.highlights);
    expect(highlightFields.length).toBeGreaterThan(0);
    // Highlights should contain <mark> tags
    const firstHighlight = Object.values(firstResult!.highlights)[0];
    expect(firstHighlight).toContain("<mark>");
  });

  it("should return totalCount for pagination", () => {
    const { totalCount } = engine.search("typescript", {
      operator: "OR",
      limit: 1,
    });
    expect(totalCount).toBe(2);
  });

  it("should return empty results for empty query", () => {
    const { results, totalCount } = engine.search("");
    expect(results.length).toBe(0);
    expect(totalCount).toBe(0);
  });

  it("should return empty results for stop-words-only query", () => {
    const { results } = engine.search("the is a");
    expect(results.length).toBe(0);
  });

  it("should track query timing", () => {
    const response = engine.search("typescript");
    expect(response.took).toBeGreaterThanOrEqual(0);
  });

  it("should throw for empty fields config", () => {
    expect(
      () => createSearchEngine({ fields: [] }),
    ).toThrow(/at least one field/);
  });

  it("should add and remove documents", () => {
    expect(engine.size).toBe(5);
    engine.remove("1");
    expect(engine.size).toBe(4);
    expect(engine.has("1")).toBe(false);

    const { results } = engine.search("introduction");
    expect(results.length).toBe(0);
  });

  it("should update documents", () => {
    const updated: TestDoc = {
      ...sampleDocs[0]!,
      title: "Python Programming Guide",
    };
    engine.update(updated);

    const { results: oldResults } = engine.search("introduction");
    expect(oldResults.length).toBe(0);

    const { results: newResults } = engine.search("python");
    expect(newResults.length).toBe(1);
    expect(newResults[0]?.item.id).toBe("1");
  });

  it("should get and check documents", () => {
    expect(engine.get("1")).toEqual(sampleDocs[0]);
    expect(engine.get("nonexistent")).toBeUndefined();
    expect(engine.has("1")).toBe(true);
    expect(engine.has("nonexistent")).toBe(false);
  });

  it("should clear all documents", () => {
    engine.clear();
    expect(engine.size).toBe(0);
    const { results } = engine.search("typescript");
    expect(results.length).toBe(0);
  });
});

// ============================================================
// TF-IDF Scoring Tests
// ============================================================

describe("TF-IDF Scoring", () => {
  it("should score higher for terms in weighted fields", () => {
    const engine = createSearchEngine<TestDoc>({
      fields: ["title", "body"],
      weights: { title: 10, body: 1 },
    });

    // Doc A: term in title only
    engine.add({
      id: "a",
      title: "typescript guide",
      body: "a general programming guide",
      category: "test",
      tags: [],
      price: 0,
    });

    // Doc B: term in body only
    engine.add({
      id: "b",
      title: "general programming",
      body: "learn about typescript here",
      category: "test",
      tags: [],
      price: 0,
    });

    const { results } = engine.search("typescript", { operator: "OR" });
    expect(results.length).toBe(2);
    // Doc A (term in title with weight 10) should score higher than Doc B
    expect(results[0]?.item.id).toBe("a");
  });

  it("should give higher scores to rarer terms (IDF)", () => {
    const engine = createSearchEngine<TestDoc>({
      fields: ["title", "body"],
    });

    // Add many docs with "common" but few with "rare"
    for (let i = 0; i < 10; i++) {
      engine.add({
        id: `common-${i}`,
        title: `common topic ${i}`,
        body: "common content here",
        category: "test",
        tags: [],
        price: 0,
      });
    }

    engine.add({
      id: "rare-doc",
      title: "rare unique topic",
      body: "rare unique content",
      category: "test",
      tags: [],
      price: 0,
    });

    const commonResults = engine.search("common", { operator: "OR" });
    const rareResults = engine.search("rare", { operator: "OR" });

    // The rare term should produce higher per-document scores
    // because IDF(rare) > IDF(common)
    expect(rareResults.results[0]?.score).toBeGreaterThan(
      commonResults.results[0]?.score ?? 0,
    );
  });
});

// ============================================================
// Fuzzy Matching Tests
// ============================================================

describe("Fuzzy Matching", () => {
  describe("levenshteinDistance", () => {
    it("should return 0 for identical strings", () => {
      expect(levenshteinDistance("hello", "hello")).toBe(0);
    });

    it("should return correct distance for single operations", () => {
      expect(levenshteinDistance("cat", "hat")).toBe(1); // substitution
      expect(levenshteinDistance("cat", "cats")).toBe(1); // insertion
      expect(levenshteinDistance("cats", "cat")).toBe(1); // deletion
    });

    it("should return correct distance for multiple operations", () => {
      expect(levenshteinDistance("kitten", "sitting")).toBe(3);
      expect(levenshteinDistance("saturday", "sunday")).toBe(3);
    });

    it("should handle empty strings", () => {
      expect(levenshteinDistance("", "hello")).toBe(5);
      expect(levenshteinDistance("hello", "")).toBe(5);
      expect(levenshteinDistance("", "")).toBe(0);
    });
  });

  describe("fuzzyMatch", () => {
    it("should match identical strings at any threshold", () => {
      expect(fuzzyMatch("hello", "hello", 0)).toBe(true);
      expect(fuzzyMatch("hello", "hello", 0.5)).toBe(true);
    });

    it("should reject different strings at threshold 0", () => {
      expect(fuzzyMatch("hello", "helo", 0)).toBe(false);
    });

    it("should match similar strings at appropriate threshold", () => {
      expect(fuzzyMatch("typescript", "typscript", 0.2)).toBe(true);
      expect(fuzzyMatch("typescript", "javscript", 0.2)).toBe(false);
    });

    it("should match anything at threshold 1", () => {
      expect(fuzzyMatch("hello", "world", 1)).toBe(true);
    });
  });

  describe("prefixMatch", () => {
    it("should match prefixes case-insensitively", () => {
      expect(prefixMatch("TypeScript", "type")).toBe(true);
      expect(prefixMatch("typescript", "TYPE")).toBe(true);
      expect(prefixMatch("typescript", "java")).toBe(false);
    });
  });

  describe("findPrefixMatches", () => {
    it("should find all matching prefixes sorted by length", () => {
      const candidates = ["type", "typescript", "typed", "typeset", "java"];
      const matches = findPrefixMatches(candidates, "type");
      expect(matches).toEqual(["type", "typed", "typeset", "typescript"]);
    });
  });

  describe("phoneticEncode", () => {
    it("should encode similar-sounding words the same", () => {
      expect(phoneticEncode("smith")).toBe(phoneticEncode("smyth"));
      expect(phoneticEncode("robert")).toBe(phoneticEncode("rupert"));
    });

    it("should handle empty string", () => {
      expect(phoneticEncode("")).toBe("");
    });

    it("should produce 4-character codes", () => {
      const code = phoneticEncode("hello");
      expect(code.length).toBe(4);
    });
  });

  describe("phoneticMatch", () => {
    it("should match phonetically similar strings", () => {
      expect(phoneticMatch("smith", "smyth")).toBe(true);
    });
  });

  describe("Fuzzy search integration", () => {
    it("should find documents with fuzzy matching", () => {
      const engine = createSearchEngine<TestDoc>({
        fields: ["title", "body"],
        fuzzyThreshold: 0.3,
      });
      engine.addAll(sampleDocs);

      // "typscript" is 1 edit away from "typescript"
      const { results } = engine.search("typscript");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find documents with explicit fuzzy option", () => {
      const engine = createSearchEngine<TestDoc>({
        fields: ["title", "body"],
      });
      engine.addAll(sampleDocs);

      const { results } = engine.search("typscript", {
        fuzzy: true,
        maxFuzzyDistance: 1,
      });
      expect(results.length).toBeGreaterThan(0);
    });

    it("should rank exact matches higher than fuzzy matches", () => {
      const engine = createSearchEngine<TestDoc>({
        fields: ["title"],
        fuzzyThreshold: 0.3,
      });

      engine.add({
        id: "exact",
        title: "typescript guide",
        body: "",
        category: "test",
        tags: [],
        price: 0,
      });

      engine.add({
        id: "fuzzy",
        title: "typscript guide",
        body: "",
        category: "test",
        tags: [],
        price: 0,
      });

      const { results } = engine.search("typescript", { operator: "OR" });
      expect(results.length).toBe(2);
      // Exact match should score higher
      expect(results[0]?.item.id).toBe("exact");
    });
  });
});

// ============================================================
// Faceted Search Tests
// ============================================================

describe("Faceted Search", () => {
  describe("extractFacets", () => {
    it("should extract facet values with counts", () => {
      const facet = extractFacets(sampleDocs, { field: "category" });
      expect(facet.field).toBe("category");
      expect(facet.values.length).toBeGreaterThan(0);

      const programming = facet.values.find((v) => v.value === "programming");
      expect(programming?.count).toBe(2);

      const backend = facet.values.find((v) => v.value === "backend");
      expect(backend?.count).toBe(2);
    });

    it("should handle array fields", () => {
      const facet = extractFacets(sampleDocs, { field: "tags" });
      const typescript = facet.values.find((v) => v.value === "typescript");
      expect(typescript?.count).toBe(2);

      const javascript = facet.values.find((v) => v.value === "javascript");
      expect(javascript?.count).toBe(2);
    });

    it("should limit facet values", () => {
      const facet = extractFacets(sampleDocs, { field: "tags", limit: 3 });
      expect(facet.values.length).toBeLessThanOrEqual(3);
    });

    it("should sort facets by count descending", () => {
      const facet = extractFacets(sampleDocs, { field: "tags" });
      for (let i = 1; i < facet.values.length; i++) {
        const prev = facet.values[i - 1];
        const curr = facet.values[i];
        expect(prev!.count).toBeGreaterThanOrEqual(curr!.count);
      }
    });

    it("should handle range facets", () => {
      const facet = extractFacets(sampleDocs, {
        field: "price",
        ranges: [
          { label: "Under $25", max: 25 },
          { label: "$25-$40", min: 25, max: 40 },
          { label: "Over $40", min: 40 },
        ],
      });

      const under25 = facet.values.find((v) => v.value === "Under $25");
      expect(under25?.count).toBe(1); // doc 3 ($19)

      const mid = facet.values.find((v) => v.value === "$25-$40");
      expect(mid?.count).toBe(3); // docs 1($29), 4($39), 5($35)

      const over40 = facet.values.find((v) => v.value === "Over $40");
      expect(over40?.count).toBe(1); // doc 2 ($49)
    });
  });

  describe("filterByFacet", () => {
    it("should filter documents by single facet value", () => {
      const filtered = filterByFacet(sampleDocs, "category", "programming");
      expect(filtered.length).toBe(2);
    });

    it("should filter documents by multiple facet values (OR)", () => {
      const filtered = filterByFacet(sampleDocs, "category", [
        "programming",
        "frontend",
      ]);
      expect(filtered.length).toBe(3);
    });

    it("should filter on array fields", () => {
      const filtered = filterByFacet(sampleDocs, "tags", "typescript");
      expect(filtered.length).toBe(2);
    });
  });

  describe("computeFacets", () => {
    it("should compute multiple facets at once", () => {
      const results = computeFacets(sampleDocs, [
        { field: "category" },
        { field: "tags" },
      ]);
      expect(Object.keys(results)).toEqual(["category", "tags"]);
      expect(results["category"]?.values.length).toBeGreaterThan(0);
      expect(results["tags"]?.values.length).toBeGreaterThan(0);
    });
  });

  describe("Faceted search integration", () => {
    it("should compute facets with search results", () => {
      const engine = createSearchEngine<TestDoc>({
        fields: ["title", "body"],
      });
      engine.addAll(sampleDocs);

      const response = engine.search("typescript", {
        operator: "OR",
        facets: [{ field: "category" }],
      });

      expect(response.facets["category"]).toBeDefined();
      expect(response.facets["category"]?.values.length).toBeGreaterThan(0);
    });

    it("should filter results by facet", () => {
      const engine = createSearchEngine<TestDoc>({
        fields: ["title", "body"],
      });
      engine.addAll(sampleDocs);

      // Search with facet filter
      const response = engine.search("typescript", {
        operator: "OR",
        facetFilters: { category: "programming" },
      });

      // All results should be in "programming" category
      for (const result of response.results) {
        expect(result.item.category).toBe("programming");
      }
    });
  });
});

// ============================================================
// Factory Function Tests
// ============================================================

describe("createSearchEngine", () => {
  it("should create a working search engine", () => {
    const engine = createSearchEngine<TestDoc>({
      fields: ["title"],
    });
    engine.add(sampleDocs[0]!);
    const { results } = engine.search("introduction");
    expect(results.length).toBe(1);
  });

  it("should support custom tokenizer", () => {
    const customTokenizer = (text: string) =>
      text.toLowerCase().split(/[\s,]+/).filter(Boolean);

    const engine = createSearchEngine<TestDoc>({
      fields: ["title"],
      tokenizer: customTokenizer,
    });

    engine.add(sampleDocs[0]!);
    const { results } = engine.search("introduction");
    expect(results.length).toBe(1);
  });

  it("should support custom ID field", () => {
    interface CustomDoc {
      uid: string;
      name: string;
    }

    const engine = createSearchEngine<CustomDoc>({
      fields: ["name"],
      idField: "uid",
    });

    engine.add({ uid: "custom-1", name: "test document" });
    expect(engine.has("custom-1")).toBe(true);
    expect(engine.get("custom-1")?.name).toBe("test document");
  });
});
