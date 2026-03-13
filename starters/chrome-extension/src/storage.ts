/**
 * Chrome Extension MV3 — Type-safe Storage Wrapper
 *
 * Why wrap chrome.storage?
 * 1. The raw API is callback-based and completely untyped
 * 2. No default values — you always get `undefined` on first run
 * 3. Schema migrations are a manual nightmare
 * 4. onChange events give you raw `Record<string, StorageChange>` with no narrowing
 *
 * This wrapper provides:
 * - Typed get/set/remove keyed to StorageSchema
 * - Default values on first access
 * - Version-based schema migration
 * - Type-narrowed onChange listener
 *
 * NOTE: Uses an injectable storage backend so you can test without chrome.storage.
 */

import type { StorageSchema } from "./types.js";
import { STORAGE_DEFAULTS } from "./types.js";

// ---------------------------------------------------------------------------
// Storage backend abstraction (injectable for testing)
// ---------------------------------------------------------------------------

export interface StorageChange<T = unknown> {
  oldValue?: T;
  newValue?: T;
}

export interface StorageBackend {
  get: (
    keys: string | string[] | Record<string, unknown> | null,
    callback: (items: Record<string, unknown>) => void,
  ) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
  remove: (keys: string | string[], callback?: () => void) => void;
  onChanged: {
    addListener: (
      callback: (changes: Record<string, StorageChange>) => void,
    ) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
}

// ---------------------------------------------------------------------------
// In-memory backend for testing
// ---------------------------------------------------------------------------

export function createInMemoryBackend(
  initial: Record<string, unknown> = {},
): StorageBackend & { _data: Record<string, unknown>; _listeners: Array<(changes: Record<string, StorageChange>) => void> } {
  const data: Record<string, unknown> = { ...initial };
  const listeners: Array<(changes: Record<string, StorageChange>) => void> = [];

  return {
    _data: data,
    _listeners: listeners,

    get(keys, callback) {
      const result: Record<string, unknown> = {};
      if (keys === null) {
        Object.assign(result, data);
      } else if (typeof keys === "string") {
        if (keys in data) result[keys] = data[keys];
      } else if (Array.isArray(keys)) {
        for (const k of keys) {
          if (k in data) result[k] = data[k];
        }
      } else {
        // Record<string, unknown> — keys with defaults
        for (const [k, v] of Object.entries(keys)) {
          result[k] = k in data ? data[k] : v;
        }
      }
      callback(result);
    },

    set(items, callback) {
      const changes: Record<string, StorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      // Notify listeners
      for (const listener of listeners) {
        listener(changes);
      }
      callback?.();
    },

    remove(keys, callback) {
      const toRemove = typeof keys === "string" ? [keys] : keys;
      const changes: Record<string, StorageChange> = {};
      for (const k of toRemove) {
        if (k in data) {
          changes[k] = { oldValue: data[k], newValue: undefined };
          delete data[k];
        }
      }
      for (const listener of listeners) {
        listener(changes);
      }
      callback?.();
    },

    onChanged: {
      addListener(callback) {
        listeners.push(callback);
      },
      removeListener(callback) {
        const idx = listeners.indexOf(callback as (changes: Record<string, StorageChange>) => void);
        if (idx !== -1) listeners.splice(idx, 1);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Typed storage API
// ---------------------------------------------------------------------------

export interface TypedStorageOptions {
  backend: StorageBackend;
  defaults?: Partial<StorageSchema>;
}

export interface TypedStorage {
  /** Get a value by key, returns the default if not set */
  get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]>;

  /** Set a value by key */
  set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void>;

  /** Remove a key from storage */
  remove<K extends keyof StorageSchema>(key: K): Promise<void>;

  /** Get all storage data */
  getAll(): Promise<StorageSchema>;

  /**
   * Listen for changes to a specific key.
   * Returns a function to unsubscribe.
   */
  onChange<K extends keyof StorageSchema>(
    key: K,
    callback: (newValue: StorageSchema[K], oldValue: StorageSchema[K] | undefined) => void,
  ): () => void;

  /** Run pending migrations */
  migrate(migrations: SchemaMigration[]): Promise<void>;
}

/**
 * Create a type-safe storage wrapper.
 *
 * @example
 * ```ts
 * const storage = createTypedStorage({
 *   backend: chrome.storage.local,  // or createInMemoryBackend() for tests
 * });
 *
 * const prefs = await storage.get("preferences");
 * //    ^? UserPreferences
 *
 * await storage.set("enabled", false);
 * ```
 */
export function createTypedStorage(options: TypedStorageOptions): TypedStorage {
  const { backend } = options;
  const defaults = { ...STORAGE_DEFAULTS, ...options.defaults };

  return {
    get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
      return new Promise((resolve) => {
        backend.get(
          { [key]: defaults[key] },
          (items) => {
            resolve(items[key as string] as StorageSchema[K]);
          },
        );
      });
    },

    set<K extends keyof StorageSchema>(
      key: K,
      value: StorageSchema[K],
    ): Promise<void> {
      return new Promise((resolve) => {
        backend.set({ [key as string]: value }, () => resolve());
      });
    },

    remove<K extends keyof StorageSchema>(key: K): Promise<void> {
      return new Promise((resolve) => {
        backend.remove(key as string, () => resolve());
      });
    },

    getAll(): Promise<StorageSchema> {
      return new Promise((resolve) => {
        backend.get(defaults as unknown as Record<string, unknown>, (items) => {
          resolve(items as unknown as StorageSchema);
        });
      });
    },

    onChange<K extends keyof StorageSchema>(
      key: K,
      callback: (
        newValue: StorageSchema[K],
        oldValue: StorageSchema[K] | undefined,
      ) => void,
    ): () => void {
      const listener = (changes: Record<string, StorageChange>) => {
        if (key in changes) {
          const change = changes[key as string] as StorageChange<StorageSchema[K]>;
          callback(
            change.newValue as StorageSchema[K],
            change.oldValue as StorageSchema[K] | undefined,
          );
        }
      };
      backend.onChanged.addListener(listener);
      return () => backend.onChanged.removeListener(listener as (...args: unknown[]) => void);
    },

    async migrate(migrations: SchemaMigration[]): Promise<void> {
      const currentVersion = await this.get("schemaVersion");

      // Sort migrations by version
      const pending = migrations
        .filter((m) => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);

      for (const migration of pending) {
        await migration.up(this);
        await this.set("schemaVersion", migration.version);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

export interface SchemaMigration {
  /** Target schema version */
  version: number;
  /** Human-readable description */
  description: string;
  /** Migration function */
  up: (storage: TypedStorage) => Promise<void>;
}

/**
 * Example migration:
 *
 * ```ts
 * const migrations: SchemaMigration[] = [
 *   {
 *     version: 2,
 *     description: "Add language preference",
 *     async up(storage) {
 *       const prefs = await storage.get("preferences");
 *       if (!prefs.language) {
 *         await storage.set("preferences", { ...prefs, language: "en" });
 *       }
 *     },
 *   },
 * ];
 *
 * await storage.migrate(migrations);
 * ```
 */
