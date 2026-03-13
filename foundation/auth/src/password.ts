/**
 * @module foundation/auth - Password Utilities
 *
 * Secure password hashing and verification using Node.js built-in crypto.scrypt.
 *
 * Design decisions:
 * - scrypt over bcrypt: scrypt is built into Node.js (zero native dependencies).
 *   bcrypt requires node-gyp and native compilation, which breaks on some platforms
 *   and adds CI complexity. scrypt is also memory-hard, making GPU attacks expensive.
 * - scrypt over argon2: argon2 is theoretically superior but requires a native addon.
 *   For a startup module that prioritizes zero-dep portability, scrypt is the right trade-off.
 * - Random salt per password: prevents rainbow table attacks.
 * - Output format: "salt:hash" in hex — simple, parseable, no binary encoding issues.
 *
 * OWASP recommendations followed:
 * - Key length: 64 bytes (512 bits)
 * - Salt: 16 bytes (128 bits), cryptographically random
 * - Cost parameter (N): 16384 (2^14), balances security and speed
 */

import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

// ─── Configuration ──────────────────────────────────────────────────────────

const SCRYPT_PARAMS = {
  /** Key length in bytes */
  keyLength: 64,
  /** Salt length in bytes */
  saltLength: 16,
  /** CPU/memory cost parameter (N). Must be power of 2. */
  cost: 16384,
  /** Block size parameter (r) */
  blockSize: 8,
  /** Parallelization parameter (p) */
  parallelization: 1,
} as const;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Hash a password using scrypt with a random salt.
 *
 * @returns A string in the format "salt:hash" (both hex-encoded)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_PARAMS.saltLength);

  const hash = await scryptAsync(password, salt);

  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param password - The plaintext password to verify
 * @param storedHash - The "salt:hash" string from hashPassword()
 * @returns true if the password matches
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const separatorIndex = storedHash.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }

  const saltHex = storedHash.substring(0, separatorIndex);
  const hashHex = storedHash.substring(separatorIndex + 1);

  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");

  if (salt.length !== SCRYPT_PARAMS.saltLength || expectedHash.length !== SCRYPT_PARAMS.keyLength) {
    return false;
  }

  const actualHash = await scryptAsync(password, salt);

  return timingSafeEqual(expectedHash, actualHash);
}

// ─── Password Strength Validation ───────────────────────────────────────────

export interface PasswordStrengthResult {
  /** Whether the password meets minimum requirements */
  valid: boolean;
  /** List of issues found */
  issues: string[];
  /** Estimated strength: weak, fair, strong */
  strength: "weak" | "fair" | "strong";
}

/**
 * Validate password strength.
 *
 * This is intentionally simple and rule-based. For production, consider
 * adding zxcvbn or similar entropy-based checking. But basic rules catch
 * the worst passwords and are better than nothing.
 *
 * Rules:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 */
export function validatePasswordStrength(password: string): PasswordStrengthResult {
  const issues: string[] = [];

  if (password.length < 8) {
    issues.push("Password must be at least 8 characters long");
  }

  if (!/[A-Z]/.test(password)) {
    issues.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    issues.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    issues.push("Password must contain at least one digit");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    issues.push("Password must contain at least one special character");
  }

  const valid = issues.length === 0;

  let strength: PasswordStrengthResult["strength"];
  if (issues.length >= 3 || password.length < 8) {
    strength = "weak";
  } else if (issues.length >= 1) {
    strength = "fair";
  } else if (password.length >= 12) {
    strength = "strong";
  } else {
    strength = "fair";
  }

  return { valid, issues, strength };
}

// ─── Internal ───────────────────────────────────────────────────────────────

/** Promisified scrypt with our standard parameters */
function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_PARAMS.keyLength,
      {
        N: SCRYPT_PARAMS.cost,
        r: SCRYPT_PARAMS.blockSize,
        p: SCRYPT_PARAMS.parallelization,
      },
      (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      },
    );
  });
}
