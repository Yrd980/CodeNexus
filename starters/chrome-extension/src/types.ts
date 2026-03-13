/**
 * Chrome Extension MV3 — Shared Type Definitions
 *
 * Discriminated union pattern for type-safe message passing.
 * Every message has a `type` field that narrows both the payload and response.
 */

// ---------------------------------------------------------------------------
// Message types — discriminated union
// ---------------------------------------------------------------------------

/** Messages sent from popup / content script → background service worker */
export type Message =
  | GetTabInfoMessage
  | GetStorageMessage
  | SetStorageMessage
  | ExecuteActionMessage
  | ContentReadyMessage;

export interface GetTabInfoMessage {
  readonly type: "GET_TAB_INFO";
}

export interface GetStorageMessage {
  readonly type: "GET_STORAGE";
  readonly key: keyof StorageSchema;
}

export interface SetStorageMessage {
  readonly type: "SET_STORAGE";
  readonly key: keyof StorageSchema;
  readonly value: StorageSchema[keyof StorageSchema];
}

export interface ExecuteActionMessage {
  readonly type: "EXECUTE_ACTION";
  readonly action: string;
  readonly payload?: Record<string, unknown>;
}

export interface ContentReadyMessage {
  readonly type: "CONTENT_READY";
  readonly url: string;
  readonly title: string;
}

// ---------------------------------------------------------------------------
// Response type mapping — each message type maps to a specific response
// ---------------------------------------------------------------------------

export type MessageResponseMap = {
  GET_TAB_INFO: TabInfo;
  GET_STORAGE: StorageSchema[keyof StorageSchema] | undefined;
  SET_STORAGE: { success: boolean };
  EXECUTE_ACTION: { result: unknown };
  CONTENT_READY: { acknowledged: boolean };
};

export type MessageResponse<T extends Message["type"]> = MessageResponseMap[T];

// ---------------------------------------------------------------------------
// Storage schema — typed keys for chrome.storage
// ---------------------------------------------------------------------------

export interface StorageSchema {
  /** Extension enabled state */
  enabled: boolean;
  /** User preferences */
  preferences: UserPreferences;
  /** Cached data with TTL */
  cache: CacheEntry[];
  /** Storage schema version for migrations */
  schemaVersion: number;
}

export interface UserPreferences {
  theme: "light" | "dark" | "system";
  notifications: boolean;
  language: string;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  expiresAt: number;
}

/** Default values for every storage key */
export const STORAGE_DEFAULTS: StorageSchema = {
  enabled: true,
  preferences: {
    theme: "system",
    notifications: true,
    language: "en",
  },
  cache: [],
  schemaVersion: 1,
};

// ---------------------------------------------------------------------------
// Tab / context types
// ---------------------------------------------------------------------------

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
  active: boolean;
}

export interface ContentScriptContext {
  tabId: number;
  frameId: number;
  url: string;
  origin: string;
}

// ---------------------------------------------------------------------------
// UI state types
// ---------------------------------------------------------------------------

export interface PopupState {
  enabled: boolean;
  preferences: UserPreferences;
  currentTab: TabInfo | null;
  loading: boolean;
  error: string | null;
}

export interface OptionsState {
  preferences: UserPreferences;
  saving: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Long-lived connection (port) types
// ---------------------------------------------------------------------------

export type PortMessage =
  | { type: "STREAM_START"; channel: string }
  | { type: "STREAM_DATA"; channel: string; data: unknown }
  | { type: "STREAM_END"; channel: string }
  | { type: "PING" }
  | { type: "PONG" };

export interface PortInfo {
  name: string;
  tabId?: number;
}
