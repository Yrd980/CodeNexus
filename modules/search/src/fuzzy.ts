/**
 * Fuzzy matching utilities.
 *
 * Design: Levenshtein distance is the gold standard for edit-distance fuzzy
 * matching. We add prefix matching for autocomplete and a simple soundex-like
 * phonetic matcher for "sounds like" searches.
 *
 * The core levenshteinDistance lives in index-builder.ts (it's needed there too).
 * This module provides higher-level fuzzy matching operations.
 */

import { levenshteinDistance } from "./index-builder.js";

export { levenshteinDistance };

/**
 * Check if two strings are fuzzy-equal within a normalized threshold.
 *
 * @param a - First string
 * @param b - Second string
 * @param threshold - 0 to 1. 0 = exact match, 0.5 = up to 50% different.
 *                    Normalized by the longer string's length.
 */
export function fuzzyMatch(a: string, b: string, threshold: number): boolean {
  if (threshold <= 0) return a === b;
  if (threshold >= 1) return true;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;

  const normalized = distance / maxLen;
  return normalized <= threshold;
}

/**
 * Calculate the maximum edit distance allowed for a given term and threshold.
 * This converts a 0-1 threshold into an absolute edit distance.
 */
export function maxDistanceForThreshold(
  termLength: number,
  threshold: number,
): number {
  if (threshold <= 0) return 0;
  return Math.floor(termLength * threshold);
}

/**
 * Check if a string starts with a given prefix (case-insensitive).
 */
export function prefixMatch(text: string, prefix: string): boolean {
  return text.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Find all strings in a list that start with the given prefix.
 * Returns matches sorted by length (shorter = more relevant).
 */
export function findPrefixMatches(
  candidates: string[],
  prefix: string,
): string[] {
  const lowerPrefix = prefix.toLowerCase();
  return candidates
    .filter((c) => c.toLowerCase().startsWith(lowerPrefix))
    .sort((a, b) => a.length - b.length);
}

/**
 * Simple phonetic encoding inspired by Soundex.
 *
 * This is a simplified version — not a full Soundex implementation.
 * It maps characters to phonetic groups and collapses duplicates.
 * Good enough for catching common misspellings like "smith" vs "smyth".
 *
 * For production phonetic search, consider Double Metaphone.
 */
export function phoneticEncode(text: string): string {
  if (text.length === 0) return "";

  const input = text.toLowerCase();

  // Phonetic character groups
  const mapping: Record<string, string> = {
    b: "1",
    f: "1",
    p: "1",
    v: "1",
    c: "2",
    g: "2",
    j: "2",
    k: "2",
    q: "2",
    s: "2",
    x: "2",
    z: "2",
    d: "3",
    t: "3",
    l: "4",
    m: "5",
    n: "5",
    r: "6",
  };

  // Keep first letter, encode the rest
  const firstChar = input[0] ?? "";
  let result = firstChar.toUpperCase();
  let lastCode = mapping[firstChar] ?? "0";

  for (let i = 1; i < input.length && result.length < 4; i++) {
    const char = input[i];
    if (char === undefined) continue;

    const code = mapping[char];
    if (code !== undefined && code !== lastCode) {
      result += code;
      lastCode = code;
    } else if (code === undefined) {
      // Vowels and H/W reset the last code (so duplicates around them count)
      lastCode = "0";
    }
  }

  // Pad with zeros to length 4
  return result.padEnd(4, "0");
}

/**
 * Check if two strings sound similar using phonetic encoding.
 */
export function phoneticMatch(a: string, b: string): boolean {
  return phoneticEncode(a) === phoneticEncode(b);
}
