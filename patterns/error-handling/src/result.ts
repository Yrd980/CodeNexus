/**
 * Result<T, E> — functional error handling via discriminated unions.
 *
 * Instead of throwing exceptions (which are invisible to the type system),
 * functions return `Result<T, E>` so every call site knows *exactly*
 * what can go wrong and the compiler enforces handling.
 *
 * Design choice — discriminated unions over classes:
 * - No prototype chain → zero overhead, plain objects
 * - Better tree-shaking in bundlers
 * - Works naturally with `switch` exhaustiveness checks
 *
 * Inspired by: Rust `std::result`, neverthrow, Effect-TS
 */

import type { Err, Ok, Result } from "./types.js";

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/**
 * Create a successful Result.
 *
 * @example
 * ```ts
 * const r = ok(42); // Result<number, never>
 * ```
 */
export function ok<T>(value: T): Ok<T> {
  return { _tag: "Ok", value };
}

/**
 * Create a failed Result.
 *
 * @example
 * ```ts
 * const r = err("not found"); // Result<never, string>
 * ```
 */
export function err<E>(error: E): Err<E> {
  return { _tag: "Err", error };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Narrow a `Result` to its `Ok` variant. */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result._tag === "Ok";
}

/** Narrow a `Result` to its `Err` variant. */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result._tag === "Err";
}

// ---------------------------------------------------------------------------
// Transformations
// ---------------------------------------------------------------------------

/**
 * Apply `fn` to the value inside an `Ok`, passing `Err` through unchanged.
 *
 * @example
 * ```ts
 * const doubled = map(ok(21), (n) => n * 2); // Ok(42)
 * const failed  = map(err("oops"), (n) => n * 2); // Err("oops")
 * ```
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return isOk(result) ? ok(fn(result.value)) : result;
}

/**
 * Apply `fn` to the error inside an `Err`, passing `Ok` through unchanged.
 *
 * Useful for translating low-level errors into domain errors.
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F,
): Result<T, F> {
  return isErr(result) ? err(fn(result.error)) : result;
}

/**
 * Chain a computation that itself returns a `Result`.
 *
 * Also known as `andThen` / `bind` / `>>=`.
 *
 * @example
 * ```ts
 * const parse = (s: string): Result<number, string> => {
 *   const n = Number(s);
 *   return Number.isNaN(n) ? err("NaN") : ok(n);
 * };
 * const r = flatMap(ok("42"), parse); // Ok(42)
 * ```
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return isOk(result) ? fn(result.value) : result;
}

/** Alias for `flatMap` — reads more naturally in chained pipelines. */
export const andThen = flatMap;

// ---------------------------------------------------------------------------
// Unwrapping
// ---------------------------------------------------------------------------

/**
 * Extract the value from an `Ok` or throw if `Err`.
 *
 * **Use sparingly** — this defeats the purpose of typed errors.
 * Prefer `unwrapOr` / `unwrapOrElse` or explicit matching.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) return result.value;
  throw new Error(
    `Called unwrap on an Err: ${JSON.stringify((result as Err<E>).error)}`,
  );
}

/**
 * Extract the value from an `Ok`, or return `defaultValue` if `Err`.
 *
 * @example
 * ```ts
 * unwrapOr(ok(42), 0)   // 42
 * unwrapOr(err("x"), 0) // 0
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue;
}

/**
 * Extract the value from an `Ok`, or compute a fallback from the error.
 *
 * @example
 * ```ts
 * unwrapOrElse(err("x"), (e) => e.length) // 1
 * ```
 */
export function unwrapOrElse<T, E>(
  result: Result<T, E>,
  fn: (error: E) => T,
): T {
  return isOk(result) ? result.value : fn(result.error);
}

// ---------------------------------------------------------------------------
// Async / throwable interop
// ---------------------------------------------------------------------------

/**
 * Wrap a `Promise<T>` into a `Result<T, E>`.
 *
 * @param promise  The promise to wrap.
 * @param mapError Optional mapper that converts the caught value into `E`.
 *                 Defaults to identity (the raw caught value is used).
 *
 * @example
 * ```ts
 * const result = await fromPromise(
 *   fetch("/api/data").then(r => r.json()),
 *   (e) => ({ code: "EXTERNAL_SERVICE_ERROR", message: String(e) }),
 * );
 * ```
 */
export async function fromPromise<T, E = unknown>(
  promise: Promise<T>,
  mapError?: (error: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (caught) {
    return err((mapError ? mapError(caught) : caught) as E);
  }
}

/**
 * Wrap a synchronous function that may throw into one that returns `Result`.
 *
 * @param fn       The potentially-throwing function.
 * @param mapError Optional mapper for the caught value.
 *
 * @example
 * ```ts
 * const safeJsonParse = fromThrowable(
 *   JSON.parse,
 *   (e) => `Invalid JSON: ${e}`,
 * );
 * const r = safeJsonParse('{"a":1}'); // Ok({ a: 1 })
 * ```
 */
export function fromThrowable<A extends readonly unknown[], T, E = unknown>(
  fn: (...args: A) => T,
  mapError?: (error: unknown) => E,
): (...args: A) => Result<T, E> {
  return (...args: A): Result<T, E> => {
    try {
      return ok(fn(...args));
    } catch (caught) {
      return err((mapError ? mapError(caught) : caught) as E);
    }
  };
}

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/**
 * Combine an array of `Result`s into a single `Result` containing an array
 * of all success values.
 *
 * Returns the **first** `Err` encountered (short-circuit semantics).
 *
 * @example
 * ```ts
 * combine([ok(1), ok(2), ok(3)])       // Ok([1, 2, 3])
 * combine([ok(1), err("x"), ok(3)])    // Err("x")
 * ```
 */
export function combine<T, E>(
  results: readonly Result<T, E>[],
): Result<readonly T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (isErr(r)) return r;
    values.push(r.value);
  }
  return ok(values);
}
