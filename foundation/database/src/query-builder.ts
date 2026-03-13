/**
 * @module foundation/database/query-builder
 *
 * Lightweight, type-safe query builder.
 *
 * Design goals:
 * 1. **Prevent SQL injection by construction** — every value goes through
 *    parameterized placeholders ($1, $2, …).  There is zero string
 *    concatenation of user-supplied data.
 * 2. **Readable, not magical** — the builder mirrors SQL closely so you
 *    always know what query you're building.
 * 3. **Not a full ORM** — we don't manage schemas or relations.  This is
 *    just enough to be safe and ergonomic for 90% of queries.
 */

import type { ParameterizedQuery } from "./types.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Operators supported in WHERE clauses. */
export type WhereOperator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE"
  | "ILIKE"
  | "IN"
  | "NOT IN"
  | "IS NULL"
  | "IS NOT NULL";

/** A single condition in a WHERE clause. */
export interface WhereCondition {
  column: string;
  operator: WhereOperator;
  /** Value is ignored for IS NULL / IS NOT NULL. */
  value?: unknown;
}

/** JOIN types. */
export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL";

/** A JOIN clause. */
export interface JoinClause {
  type: JoinType;
  table: string;
  on: string; // e.g. "users.id = orders.user_id"
}

/** ORDER BY direction. */
export type OrderDirection = "ASC" | "DESC";

/** An ORDER BY clause. */
export interface OrderByClause {
  column: string;
  direction: OrderDirection;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Escapes an identifier (table/column name) by double-quoting it. */
function ident(name: string): string {
  // Prevent injection via identifier names: strip existing quotes, wrap.
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Build a WHERE fragment from conditions.
 *
 * Returns `{ text, values, nextIndex }` so the caller can continue
 * appending placeholders after the WHERE clause.
 */
function buildWhere(
  conditions: WhereCondition[],
  startIndex: number,
): { text: string; values: unknown[]; nextIndex: number } {
  if (conditions.length === 0) {
    return { text: "", values: [], nextIndex: startIndex };
  }

  const parts: string[] = [];
  const values: unknown[] = [];
  let idx = startIndex;

  for (const cond of conditions) {
    const col = ident(cond.column);

    if (cond.operator === "IS NULL") {
      parts.push(`${col} IS NULL`);
    } else if (cond.operator === "IS NOT NULL") {
      parts.push(`${col} IS NOT NULL`);
    } else if (cond.operator === "IN" || cond.operator === "NOT IN") {
      const arr = cond.value as unknown[];
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error(
          `${cond.operator} requires a non-empty array value`,
        );
      }
      const placeholders = arr.map(() => `$${idx++}`).join(", ");
      parts.push(`${col} ${cond.operator} (${placeholders})`);
      values.push(...arr);
    } else {
      parts.push(`${col} ${cond.operator} $${idx++}`);
      values.push(cond.value);
    }
  }

  return {
    text: ` WHERE ${parts.join(" AND ")}`,
    values,
    nextIndex: idx,
  };
}

// ---------------------------------------------------------------------------
// SELECT builder
// ---------------------------------------------------------------------------

export class SelectBuilder {
  private _table = "";
  private _columns: string[] = ["*"];
  private _conditions: WhereCondition[] = [];
  private _joins: JoinClause[] = [];
  private _orderBy: OrderByClause[] = [];
  private _limit: number | null = null;
  private _offset: number | null = null;
  private _groupBy: string[] = [];

  /** Table to select from. */
  from(table: string): this {
    this._table = table;
    return this;
  }

  /** Columns to select (defaults to *). */
  columns(...cols: string[]): this {
    this._columns = cols;
    return this;
  }

  /** Add a WHERE condition (all conditions are ANDed). */
  where(column: string, operator: WhereOperator, value?: unknown): this {
    this._conditions.push({ column, operator, value });
    return this;
  }

  /** Add a JOIN clause. */
  join(type: JoinType, table: string, on: string): this {
    this._joins.push({ type, table, on });
    return this;
  }

  /** Shorthand for INNER JOIN. */
  innerJoin(table: string, on: string): this {
    return this.join("INNER", table, on);
  }

  /** Shorthand for LEFT JOIN. */
  leftJoin(table: string, on: string): this {
    return this.join("LEFT", table, on);
  }

  /** Add ORDER BY. */
  orderBy(column: string, direction: OrderDirection = "ASC"): this {
    this._orderBy.push({ column, direction });
    return this;
  }

  /** Add GROUP BY. */
  groupBy(...cols: string[]): this {
    this._groupBy = cols;
    return this;
  }

  /** Set LIMIT. */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /** Set OFFSET. */
  offset(n: number): this {
    this._offset = n;
    return this;
  }

  /** Build the parameterized query. */
  build(): ParameterizedQuery {
    if (!this._table) throw new Error("SELECT requires a table (.from())");

    const cols = this._columns.map((c) => (c === "*" ? "*" : ident(c))).join(", ");
    let text = `SELECT ${cols} FROM ${ident(this._table)}`;

    // JOINs
    for (const j of this._joins) {
      text += ` ${j.type} JOIN ${ident(j.table)} ON ${j.on}`;
    }

    // WHERE
    const where = buildWhere(this._conditions, 1);
    text += where.text;
    const values = [...where.values];
    let idx = where.nextIndex;

    // GROUP BY
    if (this._groupBy.length > 0) {
      text += ` GROUP BY ${this._groupBy.map(ident).join(", ")}`;
    }

    // ORDER BY
    if (this._orderBy.length > 0) {
      const parts = this._orderBy.map(
        (o) => `${ident(o.column)} ${o.direction}`,
      );
      text += ` ORDER BY ${parts.join(", ")}`;
    }

    // LIMIT / OFFSET
    if (this._limit !== null) {
      text += ` LIMIT $${idx++}`;
      values.push(this._limit);
    }
    if (this._offset !== null) {
      text += ` OFFSET $${idx++}`;
      values.push(this._offset);
    }

    return { text, values };
  }
}

// ---------------------------------------------------------------------------
// INSERT builder
// ---------------------------------------------------------------------------

export class InsertBuilder {
  private _table = "";
  private _rows: Record<string, unknown>[] = [];
  private _returning: string[] = [];

  /** Target table. */
  into(table: string): this {
    this._table = table;
    return this;
  }

  /** Add a row to insert. */
  values(row: Record<string, unknown>): this {
    this._rows.push(row);
    return this;
  }

  /** Add a RETURNING clause. */
  returning(...cols: string[]): this {
    this._returning = cols;
    return this;
  }

  /** Build the parameterized query. */
  build(): ParameterizedQuery {
    if (!this._table) throw new Error("INSERT requires a table (.into())");
    if (this._rows.length === 0) throw new Error("INSERT requires at least one row (.values())");

    // Use column names from the first row; all rows must have the same shape.
    const columns = Object.keys(this._rows[0]!);
    const colList = columns.map(ident).join(", ");

    const allValues: unknown[] = [];
    const rowPlaceholders: string[] = [];
    let idx = 1;

    for (const row of this._rows) {
      const placeholders: string[] = [];
      for (const col of columns) {
        placeholders.push(`$${idx++}`);
        allValues.push(row[col]);
      }
      rowPlaceholders.push(`(${placeholders.join(", ")})`);
    }

    let text = `INSERT INTO ${ident(this._table)} (${colList}) VALUES ${rowPlaceholders.join(", ")}`;

    if (this._returning.length > 0) {
      text += ` RETURNING ${this._returning.map(ident).join(", ")}`;
    }

    return { text, values: allValues };
  }
}

// ---------------------------------------------------------------------------
// UPDATE builder
// ---------------------------------------------------------------------------

export class UpdateBuilder {
  private _table = "";
  private _sets: Record<string, unknown> = {};
  private _conditions: WhereCondition[] = [];
  private _returning: string[] = [];

  /** Target table. */
  table(table: string): this {
    this._table = table;
    return this;
  }

  /** Set column values. */
  set(data: Record<string, unknown>): this {
    Object.assign(this._sets, data);
    return this;
  }

  /** Add a WHERE condition. */
  where(column: string, operator: WhereOperator, value?: unknown): this {
    this._conditions.push({ column, operator, value });
    return this;
  }

  /** Add a RETURNING clause. */
  returning(...cols: string[]): this {
    this._returning = cols;
    return this;
  }

  /** Build the parameterized query. */
  build(): ParameterizedQuery {
    if (!this._table) throw new Error("UPDATE requires a table (.table())");
    const entries = Object.entries(this._sets);
    if (entries.length === 0) throw new Error("UPDATE requires at least one column (.set())");

    const values: unknown[] = [];
    let idx = 1;

    const setParts = entries.map(([col, val]) => {
      values.push(val);
      return `${ident(col)} = $${idx++}`;
    });

    let text = `UPDATE ${ident(this._table)} SET ${setParts.join(", ")}`;

    const where = buildWhere(this._conditions, idx);
    text += where.text;
    values.push(...where.values);

    if (this._returning.length > 0) {
      text += ` RETURNING ${this._returning.map(ident).join(", ")}`;
    }

    return { text, values };
  }
}

// ---------------------------------------------------------------------------
// DELETE builder
// ---------------------------------------------------------------------------

export class DeleteBuilder {
  private _table = "";
  private _conditions: WhereCondition[] = [];
  private _returning: string[] = [];

  /** Target table. */
  from(table: string): this {
    this._table = table;
    return this;
  }

  /** Add a WHERE condition. */
  where(column: string, operator: WhereOperator, value?: unknown): this {
    this._conditions.push({ column, operator, value });
    return this;
  }

  /** Add a RETURNING clause. */
  returning(...cols: string[]): this {
    this._returning = cols;
    return this;
  }

  /** Build the parameterized query. */
  build(): ParameterizedQuery {
    if (!this._table) throw new Error("DELETE requires a table (.from())");

    let text = `DELETE FROM ${ident(this._table)}`;

    const where = buildWhere(this._conditions, 1);
    text += where.text;
    const values = [...where.values];

    if (this._returning.length > 0) {
      text += ` RETURNING ${this._returning.map(ident).join(", ")}`;
    }

    return { text, values };
  }
}

// ---------------------------------------------------------------------------
// Raw query helper
// ---------------------------------------------------------------------------

/**
 * Escape hatch: build a parameterized query from a raw SQL template.
 *
 * Use sparingly — prefer the builders for everyday CRUD.
 *
 * @example
 * ```ts
 * const q = raw("SELECT * FROM users WHERE email = $1 AND active = $2", [email, true]);
 * const result = await client.query(q.text, q.values);
 * ```
 */
export function raw(text: string, values: unknown[] = []): ParameterizedQuery {
  return { text, values };
}

// ---------------------------------------------------------------------------
// Convenience factory functions
// ---------------------------------------------------------------------------

export function select(): SelectBuilder {
  return new SelectBuilder();
}

export function insert(): InsertBuilder {
  return new InsertBuilder();
}

export function update(): UpdateBuilder {
  return new UpdateBuilder();
}

export function del(): DeleteBuilder {
  return new DeleteBuilder();
}
