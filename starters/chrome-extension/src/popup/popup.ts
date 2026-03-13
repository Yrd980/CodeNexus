/**
 * Chrome Extension MV3 — Popup Patterns
 *
 * The popup is a short-lived HTML page opened by clicking the extension icon.
 * Key patterns:
 * 1. Load state from storage on open (popup is destroyed on close)
 * 2. Communicate with background for actions
 * 3. Save state changes to storage immediately
 * 4. Detect system theme (dark/light mode)
 */

import type { PopupState, UserPreferences, TabInfo } from "../types.js";
import type { TypedStorage } from "../storage.js";
import type { ChromeRuntimeAPI } from "../messaging.js";
import { createMessenger } from "../messaging.js";

// ---------------------------------------------------------------------------
// Popup state management
// ---------------------------------------------------------------------------

export interface PopupOptions {
  runtime: ChromeRuntimeAPI;
  storage: TypedStorage;
  /** Called when popup state changes */
  onStateChange?: (state: PopupState) => void;
}

export interface PopupInstance {
  /** Current state (readonly snapshot) */
  getState: () => PopupState;
  /** Initialize — load state from storage */
  init: () => Promise<void>;
  /** Toggle enabled/disabled */
  toggleEnabled: () => Promise<void>;
  /** Update a preference */
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => Promise<void>;
  /** Get current tab info from background */
  refreshTab: () => Promise<void>;
}

/**
 * Create popup state manager.
 *
 * @example
 * ```ts
 * const popup = createPopup({
 *   runtime: chrome.runtime,
 *   storage,
 *   onStateChange: (state) => renderUI(state),
 * });
 *
 * await popup.init();
 * ```
 */
export function createPopup(options: PopupOptions): PopupInstance {
  const { runtime, storage, onStateChange } = options;
  const messenger = createMessenger({ runtime });

  let state: PopupState = {
    enabled: true,
    preferences: {
      theme: "system",
      notifications: true,
      language: "en",
    },
    currentTab: null,
    loading: true,
    error: null,
  };

  function setState(partial: Partial<PopupState>): void {
    state = { ...state, ...partial };
    onStateChange?.(state);
  }

  return {
    getState(): PopupState {
      return { ...state };
    },

    async init(): Promise<void> {
      setState({ loading: true, error: null });
      try {
        const [enabled, preferences] = await Promise.all([
          storage.get("enabled"),
          storage.get("preferences"),
        ]);

        // Get current tab info from background
        let currentTab: TabInfo | null = null;
        try {
          const tabInfo = await messenger.sendToBackground({
            type: "GET_TAB_INFO",
          });
          currentTab = tabInfo as TabInfo;
        } catch {
          // Background may not have a handler yet — not critical
        }

        setState({
          enabled,
          preferences,
          currentTab,
          loading: false,
        });
      } catch (err) {
        setState({
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load state",
        });
      }
    },

    async toggleEnabled(): Promise<void> {
      const newEnabled = !state.enabled;
      await storage.set("enabled", newEnabled);
      setState({ enabled: newEnabled });
    },

    async updatePreference<K extends keyof UserPreferences>(
      key: K,
      value: UserPreferences[K],
    ): Promise<void> {
      const newPrefs = { ...state.preferences, [key]: value };
      await storage.set("preferences", newPrefs);
      setState({ preferences: newPrefs });
    },

    async refreshTab(): Promise<void> {
      try {
        const tabInfo = await messenger.sendToBackground({
          type: "GET_TAB_INFO",
        });
        setState({ currentTab: tabInfo as TabInfo });
      } catch {
        setState({ currentTab: null });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Theme detection
// ---------------------------------------------------------------------------

export type Theme = "light" | "dark";

/**
 * Detect the current system theme (dark/light mode).
 *
 * @param win — Window object (injectable for testing)
 */
export function detectTheme(win?: { matchMedia?: (query: string) => { matches: boolean } }): Theme {
  const w = win ?? (typeof window !== "undefined" ? window : undefined);
  if (!w?.matchMedia) return "light";
  return w.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Listen for theme changes.
 * Returns an unsubscribe function.
 */
export function onThemeChange(
  callback: (theme: Theme) => void,
  win?: {
    matchMedia?: (query: string) => {
      matches: boolean;
      addEventListener?: (event: string, handler: (e: { matches: boolean }) => void) => void;
      removeEventListener?: (event: string, handler: (e: { matches: boolean }) => void) => void;
    };
  },
): () => void {
  const w = win ?? (typeof window !== "undefined" ? window : undefined);
  if (!w?.matchMedia) return () => {};

  const mq = w.matchMedia("(prefers-color-scheme: dark)");

  const handler = (e: { matches: boolean }) => {
    callback(e.matches ? "dark" : "light");
  };

  mq.addEventListener?.("change", handler);

  return () => {
    mq.removeEventListener?.("change", handler);
  };
}
