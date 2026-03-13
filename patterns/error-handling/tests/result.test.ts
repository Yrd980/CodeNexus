import { describe, expect, it } from "vitest";
import {
  ok,
  err,
  isOk,
  isErr,
  map,
  mapErr,
  flatMap,
  andThen,
  unwrap,
  unwrapOr,
  unwrapOrElse,
  fromPromise,
  fromThrowable,
  combine,
} from "../src/result.js";
import type { Result } from "../src/types.js";

// ---------------------------------------------------------------------------
// Constructors & type guards
// ---------------------------------------------------------------------------

describe("ok / err constructors", () => {
  it("ok creates an Ok variant", () => {
    const r = ok(42);
    expect(r._tag).toBe("Ok");
    expect(r.value).toBe(42);
  });

  it("err creates an Err variant", () => {
    const r = err("boom");
    expect(r._tag).toBe("Err");
    expect(r.error).toBe("boom");
  });
});

describe("isOk / isErr type guards", () => {
  it("isOk returns true for Ok and false for Err", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isOk(err("x"))).toBe(false);
  });

  it("isErr returns true for Err and false for Ok", () => {
    expect(isErr(err("x"))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
  });

  it("narrows types correctly", () => {
    const r: Result<number, string> = ok(10);
    if (isOk(r)) {
      // TypeScript should know r.value exists here
      const _v: number = r.value;
      expect(_v).toBe(10);
    }
    const r2: Result<number, string> = err("fail");
    if (isErr(r2)) {
      const _e: string = r2.error;
      expect(_e).toBe("fail");
    }
  });
});

// ---------------------------------------------------------------------------
// Transformations
// ---------------------------------------------------------------------------

describe("map", () => {
  it("transforms the value inside Ok", () => {
    const r = map(ok(21), (n) => n * 2);
    expect(r).toEqual(ok(42));
  });

  it("passes Err through unchanged", () => {
    const r = map(err("oops") as Result<number, string>, (n) => n * 2);
    expect(r).toEqual(err("oops"));
  });
});

describe("mapErr", () => {
  it("transforms the error inside Err", () => {
    const r = mapErr(err("oops"), (e) => e.toUpperCase());
    expect(r).toEqual(err("OOPS"));
  });

  it("passes Ok through unchanged", () => {
    const r = mapErr(ok(42) as Result<number, string>, (e) => e.toUpperCase());
    expect(r).toEqual(ok(42));
  });
});

describe("flatMap / andThen", () => {
  const parse = (s: string): Result<number, string> => {
    const n = Number(s);
    return Number.isNaN(n) ? err("NaN") : ok(n);
  };

  it("chains successful computations", () => {
    const r = flatMap(ok("42"), parse);
    expect(r).toEqual(ok(42));
  });

  it("short-circuits on Err", () => {
    const r = flatMap(err("earlier") as Result<string, string>, parse);
    expect(r).toEqual(err("earlier"));
  });

  it("returns Err from the chained function", () => {
    const r = flatMap(ok("abc"), parse);
    expect(r).toEqual(err("NaN"));
  });

  it("andThen is an alias for flatMap", () => {
    expect(andThen).toBe(flatMap);
  });
});

// ---------------------------------------------------------------------------
// Unwrapping
// ---------------------------------------------------------------------------

describe("unwrap", () => {
  it("returns the value for Ok", () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it("throws for Err", () => {
    expect(() => unwrap(err("oops"))).toThrow("Called unwrap on an Err");
  });
});

describe("unwrapOr", () => {
  it("returns the value for Ok", () => {
    expect(unwrapOr(ok(42), 0)).toBe(42);
  });

  it("returns the default for Err", () => {
    expect(unwrapOr(err("oops") as Result<number, string>, 0)).toBe(0);
  });
});

describe("unwrapOrElse", () => {
  it("returns the value for Ok", () => {
    expect(unwrapOrElse(ok(42), () => 0)).toBe(42);
  });

  it("computes fallback from error for Err", () => {
    expect(
      unwrapOrElse(err("oops") as Result<number, string>, (e) => e.length),
    ).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Async / throwable interop
// ---------------------------------------------------------------------------

describe("fromPromise", () => {
  it("wraps a resolved promise into Ok", async () => {
    const r = await fromPromise(Promise.resolve(42));
    expect(r).toEqual(ok(42));
  });

  it("wraps a rejected promise into Err", async () => {
    const r = await fromPromise(Promise.reject(new Error("fail")));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error).toBeInstanceOf(Error);
    }
  });

  it("applies mapError to rejections", async () => {
    const r = await fromPromise(
      Promise.reject(new Error("fail")),
      (e) => `mapped: ${(e as Error).message}`,
    );
    expect(r).toEqual(err("mapped: fail"));
  });
});

describe("fromThrowable", () => {
  it("wraps a successful call into Ok", () => {
    const safeJsonParse = fromThrowable(JSON.parse as (s: string) => unknown);
    const r = safeJsonParse('{"a":1}');
    expect(r).toEqual(ok({ a: 1 }));
  });

  it("wraps a throwing call into Err", () => {
    const safeJsonParse = fromThrowable(JSON.parse as (s: string) => unknown);
    const r = safeJsonParse("not json");
    expect(isErr(r)).toBe(true);
  });

  it("applies mapError to thrown values", () => {
    const safeParse = fromThrowable(
      JSON.parse as (s: string) => unknown,
      () => "bad json",
    );
    const r = safeParse("{invalid}");
    expect(r).toEqual(err("bad json"));
  });
});

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

describe("combine", () => {
  it("combines all Ok results into Ok of array", () => {
    const r = combine([ok(1), ok(2), ok(3)]);
    expect(r).toEqual(ok([1, 2, 3]));
  });

  it("returns the first Err encountered", () => {
    const r = combine([ok(1), err("first"), ok(3), err("second")]);
    expect(r).toEqual(err("first"));
  });

  it("returns Ok of empty array for empty input", () => {
    const r = combine([]);
    expect(r).toEqual(ok([]));
  });
});
