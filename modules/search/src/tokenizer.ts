/**
 * Default tokenizer and text processing utilities.
 *
 * Design: The tokenizer pipeline is intentionally simple — split, lowercase,
 * strip punctuation, remove stop words. This covers 80% of use cases.
 * For CJK or other complex tokenization needs, users inject a custom tokenizer.
 */

import type { TokenizerFn } from "./types.js";

/** Common English stop words that add noise to search results */
const DEFAULT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "if",
  "in",
  "into",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "such",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "will",
  "with",
]);

/**
 * Create the default tokenizer with optional custom stop words.
 *
 * Pipeline:
 * 1. Lowercase
 * 2. Replace punctuation with spaces
 * 3. Split on whitespace
 * 4. Filter empty tokens
 * 5. Remove stop words
 */
export function createDefaultTokenizer(
  stopWords?: string[],
): TokenizerFn {
  const stops =
    stopWords !== undefined
      ? new Set(stopWords)
      : DEFAULT_STOP_WORDS;

  return (text: string): string[] => {
    return (
      text
        .toLowerCase()
        // Replace punctuation and special chars with spaces
        .replace(/[^\p{L}\p{N}]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length > 0 && !stops.has(token))
    );
  };
}

/**
 * Tokenize text preserving positions for phrase matching.
 * Returns array of { token, position } where position is the
 * original word index (before stop word removal).
 */
export function tokenizeWithPositions(
  text: string,
  tokenizer: TokenizerFn,
): { token: string; position: number }[] {
  // First, split to get raw positions
  const rawTokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // Then apply the tokenizer to get the filtered set
  const filteredSet = new Set(tokenizer(text));

  const result: { token: string; position: number }[] = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    if (token !== undefined && filteredSet.has(token)) {
      result.push({ token, position: i });
    }
  }

  return result;
}
