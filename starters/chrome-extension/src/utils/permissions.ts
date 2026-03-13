/**
 * Chrome Extension MV3 — Permissions Utilities
 *
 * Manifest V3 encourages optional permissions — request only when needed,
 * not at install time. This module wraps the chrome.permissions API with
 * type safety and convenience patterns.
 */

import type { Permission } from "../manifest.js";

// ---------------------------------------------------------------------------
// Chrome permissions API abstraction
// ---------------------------------------------------------------------------

export interface ChromePermissionsAPI {
  request: (
    permissions: { permissions?: string[]; origins?: string[] },
    callback: (granted: boolean) => void,
  ) => void;
  contains: (
    permissions: { permissions?: string[]; origins?: string[] },
    callback: (result: boolean) => void,
  ) => void;
  remove: (
    permissions: { permissions?: string[]; origins?: string[] },
    callback: (removed: boolean) => void,
  ) => void;
  getAll: (
    callback: (permissions: { permissions: string[]; origins: string[] }) => void,
  ) => void;
}

// ---------------------------------------------------------------------------
// Typed permission helpers
// ---------------------------------------------------------------------------

export interface PermissionManagerOptions {
  permissions: ChromePermissionsAPI;
}

export interface PermissionManager {
  /** Request optional permissions from the user */
  request: (permissions: Permission[], origins?: string[]) => Promise<boolean>;
  /** Check if specific permissions are granted */
  has: (permissions: Permission[], origins?: string[]) => Promise<boolean>;
  /** Remove permissions that are no longer needed */
  release: (permissions: Permission[], origins?: string[]) => Promise<boolean>;
  /** Get all currently granted permissions */
  getAll: () => Promise<{ permissions: string[]; origins: string[] }>;
  /**
   * Run a function only if the required permissions are granted.
   * Requests them first if not already granted.
   */
  withPermission: <T>(
    permissions: Permission[],
    fn: () => T | Promise<T>,
    origins?: string[],
  ) => Promise<T | null>;
}

/**
 * Create a typed permission manager.
 *
 * @example
 * ```ts
 * const pm = createPermissionManager({ permissions: chrome.permissions });
 *
 * // Request permission before using the feature
 * const result = await pm.withPermission(["tabs"], async () => {
 *   return chrome.tabs.query({ active: true });
 * });
 *
 * if (!result) {
 *   console.log("User denied permission");
 * }
 * ```
 */
export function createPermissionManager(
  options: PermissionManagerOptions,
): PermissionManager {
  const { permissions: api } = options;

  return {
    request(permissions: Permission[], origins?: string[]): Promise<boolean> {
      return new Promise((resolve) => {
        api.request(
          {
            permissions: permissions.length > 0 ? permissions : undefined,
            origins: origins && origins.length > 0 ? origins : undefined,
          },
          resolve,
        );
      });
    },

    has(permissions: Permission[], origins?: string[]): Promise<boolean> {
      return new Promise((resolve) => {
        api.contains(
          {
            permissions: permissions.length > 0 ? permissions : undefined,
            origins: origins && origins.length > 0 ? origins : undefined,
          },
          resolve,
        );
      });
    },

    release(permissions: Permission[], origins?: string[]): Promise<boolean> {
      return new Promise((resolve) => {
        api.remove(
          {
            permissions: permissions.length > 0 ? permissions : undefined,
            origins: origins && origins.length > 0 ? origins : undefined,
          },
          resolve,
        );
      });
    },

    getAll(): Promise<{ permissions: string[]; origins: string[] }> {
      return new Promise((resolve) => {
        api.getAll(resolve);
      });
    },

    async withPermission<T>(
      permissions: Permission[],
      fn: () => T | Promise<T>,
      origins?: string[],
    ): Promise<T | null> {
      const hasPerms = await this.has(permissions, origins);
      if (!hasPerms) {
        const granted = await this.request(permissions, origins);
        if (!granted) return null;
      }
      return fn();
    },
  };
}
