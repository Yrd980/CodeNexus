/**
 * Chrome Extension MV3 Starter — Public API
 *
 * Import from this entry point for all extension patterns:
 *
 * ```ts
 * import { createManifest, createMessenger, createTypedStorage } from "@codenexus/chrome-extension";
 * ```
 */

// Types
export type {
  Message,
  GetTabInfoMessage,
  GetStorageMessage,
  SetStorageMessage,
  ExecuteActionMessage,
  ContentReadyMessage,
  MessageResponseMap,
  MessageResponse,
  StorageSchema,
  UserPreferences,
  CacheEntry,
  TabInfo,
  ContentScriptContext,
  PopupState,
  OptionsState,
  PortMessage,
  PortInfo,
} from "./types.js";

export { STORAGE_DEFAULTS } from "./types.js";

// Manifest
export type {
  ManifestV3,
  Permission,
  ContentScriptConfig,
  ActionConfig,
  WebAccessibleResource,
  ManifestBuilderOptions,
} from "./manifest.js";

export { ManifestBuilder, createManifest } from "./manifest.js";

// Messaging
export type {
  ChromeRuntimeAPI,
  ChromeTabsAPI,
  ChromeSender,
  ChromePort,
  MessengerOptions,
  MessageHandler,
} from "./messaging.js";

export {
  createMessenger,
  createMessageRouter,
  connectToBackground,
  listenForConnections,
} from "./messaging.js";

// Storage
export type {
  StorageBackend,
  StorageChange,
  TypedStorageOptions,
  TypedStorage,
  SchemaMigration,
} from "./storage.js";

export {
  createInMemoryBackend,
  createTypedStorage,
} from "./storage.js";

// Background
export type {
  ChromeAlarmsAPI,
  AlarmCreateInfo,
  Alarm,
  ChromeContextMenusAPI,
  ContextMenuCreateProperties,
  ContextMenuClickInfo,
  ChromeActionAPI,
  ChromeTabsQueryAPI,
  InstallDetails,
  ServiceWorkerOptions,
  ServiceWorkerInstance,
} from "./background/service-worker.js";

export { createServiceWorker } from "./background/service-worker.js";

// Content Script
export type {
  DOMObserverOptions,
  DOMObserverInstance,
  PageData,
  InjectUIOptions,
  InjectedUI,
  ContentScriptOptions,
  ContentScriptInstance,
} from "./content/content-script.js";

export {
  createDOMObserver,
  extractPageData,
  injectUI,
  createContentScript,
} from "./content/content-script.js";

// Popup
export type {
  PopupOptions,
  PopupInstance,
  Theme,
} from "./popup/popup.js";

export {
  createPopup,
  detectTheme,
  onThemeChange,
} from "./popup/popup.js";

// Permissions
export type {
  ChromePermissionsAPI,
  PermissionManagerOptions,
  PermissionManager,
} from "./utils/permissions.js";

export { createPermissionManager } from "./utils/permissions.js";
