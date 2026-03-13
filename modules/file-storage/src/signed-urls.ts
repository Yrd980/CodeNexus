/**
 * Signed URL generation and verification.
 *
 * Implements HMAC-based URL signing for secure, time-limited file access.
 * This is the PATTERN — not tied to any specific cloud provider.
 * In production, you'd use the provider's native signing (e.g. S3 presigned URLs).
 */

import type { SignedUrl, SignedUrlMethod, SignedUrlOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default URL expiration: 1 hour. */
const DEFAULT_EXPIRES_IN = 3600;

// ---------------------------------------------------------------------------
// HMAC signing (Web Crypto API — works in Node 18+, Deno, Bun, browsers)
// ---------------------------------------------------------------------------

/**
 * Create an HMAC-SHA256 signature for the given message using the secret.
 */
async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return bufferToHex(new Uint8Array(signature));
}

/**
 * Convert a Uint8Array to a hex string.
 */
function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// URL signing
// ---------------------------------------------------------------------------

export interface SignUrlParams {
  /** The file key to sign. */
  key: string;
  /** Base URL of the storage service (e.g. "https://storage.example.com"). */
  baseUrl: string;
  /** HMAC signing secret. */
  secret: string;
  /** Signing options. */
  options?: SignedUrlOptions;
}

/**
 * Generate a signed URL for accessing a stored file.
 *
 * The URL contains:
 * - The file key
 * - Expiration timestamp
 * - HTTP method
 * - HMAC signature of the above
 *
 * @example
 * ```ts
 * const signed = await generateSignedUrl({
 *   key: "uploads/photo.jpg",
 *   baseUrl: "https://storage.example.com",
 *   secret: "my-signing-secret",
 *   options: { expiresIn: 3600, method: "GET" },
 * });
 * // signed.url => "https://storage.example.com/uploads/photo.jpg?expires=...&method=GET&sig=..."
 * ```
 */
export async function generateSignedUrl(
  params: SignUrlParams,
): Promise<SignedUrl> {
  const { key, baseUrl, secret, options = {} } = params;
  const method: SignedUrlMethod = options.method ?? "GET";
  const expiresIn = options.expiresIn ?? DEFAULT_EXPIRES_IN;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const expiresTimestamp = Math.floor(expiresAt.getTime() / 1000);

  // Build the string to sign
  const stringToSign = buildStringToSign(key, method, expiresTimestamp, options.contentType);
  const signature = await hmacSign(secret, stringToSign);

  // Build the URL
  const encodedKey = key
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const queryParams = new URLSearchParams();
  queryParams.set("expires", expiresTimestamp.toString());
  queryParams.set("method", method);
  if (options.contentType) {
    queryParams.set("contentType", options.contentType);
  }
  queryParams.set("sig", signature);

  const normalizedBase = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const url = `${normalizedBase}/${encodedKey}?${queryParams.toString()}`;

  return { url, expiresAt, method };
}

/**
 * Build the canonical string to sign.
 */
function buildStringToSign(
  key: string,
  method: SignedUrlMethod,
  expiresTimestamp: number,
  contentType?: string,
): string {
  const parts = [method, key, expiresTimestamp.toString()];
  if (contentType) {
    parts.push(contentType);
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// URL verification
// ---------------------------------------------------------------------------

export interface VerifySignedUrlParams {
  /** The full signed URL to verify. */
  url: string;
  /** HMAC signing secret (must match the one used to generate). */
  secret: string;
}

export interface VerifyResult {
  valid: boolean;
  expired: boolean;
  key: string | null;
  method: SignedUrlMethod | null;
  error?: string;
}

/**
 * Verify a signed URL's authenticity and expiration.
 *
 * Checks:
 * 1. The URL contains all required parameters (expires, method, sig)
 * 2. The signature matches the HMAC of the canonical string
 * 3. The URL has not expired
 */
export async function verifySignedUrl(
  params: VerifySignedUrlParams,
): Promise<VerifyResult> {
  const { url, secret } = params;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, expired: false, key: null, method: null, error: "Invalid URL" };
  }

  const expiresStr = parsed.searchParams.get("expires");
  const method = parsed.searchParams.get("method") as SignedUrlMethod | null;
  const signature = parsed.searchParams.get("sig");
  const contentType = parsed.searchParams.get("contentType") ?? undefined;

  if (!expiresStr || !method || !signature) {
    return {
      valid: false,
      expired: false,
      key: null,
      method: null,
      error: "Missing required URL parameters",
    };
  }

  const expiresTimestamp = parseInt(expiresStr, 10);
  if (isNaN(expiresTimestamp)) {
    return {
      valid: false,
      expired: false,
      key: null,
      method: null,
      error: "Invalid expires parameter",
    };
  }

  // Extract the key from the URL path
  const key = decodeURIComponent(parsed.pathname.slice(1)); // Remove leading /

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  const expired = now > expiresTimestamp;

  // Verify signature
  const stringToSign = buildStringToSign(key, method, expiresTimestamp, contentType);
  const expectedSignature = await hmacSign(secret, stringToSign);

  if (signature !== expectedSignature) {
    return { valid: false, expired, key, method, error: "Invalid signature" };
  }

  if (expired) {
    return { valid: false, expired: true, key, method, error: "URL has expired" };
  }

  return { valid: true, expired: false, key, method };
}
