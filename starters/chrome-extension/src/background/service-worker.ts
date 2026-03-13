/**
 * Chrome Extension MV3 — Service Worker Patterns
 *
 * MV3 service workers are ephemeral — Chrome can terminate them at any time.
 * This means:
 * 1. No persistent state in global variables (use chrome.storage)
 * 2. Use chrome.alarms instead of setInterval (alarms survive termination)
 * 3. Register all listeners at the top level (not inside async callbacks)
 *
 * This module provides composable patterns for common service worker tasks.
 */

import type { Message, TabInfo } from "../types.js";
import type { ChromeRuntimeAPI, MessageHandler } from "../messaging.js";
import { createMessageRouter, listenForConnections, type ChromePort } from "../messaging.js";

// ---------------------------------------------------------------------------
// Chrome API abstractions for testing
// ---------------------------------------------------------------------------

export interface ChromeAlarmsAPI {
  create: (name: string, alarmInfo: AlarmCreateInfo) => void;
  onAlarm: {
    addListener: (callback: (alarm: Alarm) => void) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
  clear: (name: string, callback?: (wasCleared: boolean) => void) => void;
  getAll: (callback: (alarms: Alarm[]) => void) => void;
}

export interface AlarmCreateInfo {
  delayInMinutes?: number;
  periodInMinutes?: number;
  when?: number;
}

export interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export interface ChromeContextMenusAPI {
  create: (
    createProperties: ContextMenuCreateProperties,
    callback?: () => void,
  ) => void;
  onClicked: {
    addListener: (
      callback: (info: ContextMenuClickInfo, tab?: { id?: number }) => void,
    ) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
  removeAll: (callback?: () => void) => void;
}

export interface ContextMenuCreateProperties {
  id: string;
  title: string;
  contexts?: ContextType[];
  parentId?: string;
}

type ContextType = "page" | "selection" | "link" | "image" | "action" | "all";

export interface ContextMenuClickInfo {
  menuItemId: string;
  selectionText?: string;
  linkUrl?: string;
  pageUrl?: string;
}

export interface ChromeActionAPI {
  setBadgeText: (details: { text: string; tabId?: number }) => void;
  setBadgeBackgroundColor: (details: { color: string; tabId?: number }) => void;
}

export interface ChromeTabsQueryAPI {
  query: (
    queryInfo: { active?: boolean; currentWindow?: boolean },
    callback: (tabs: Array<{ id?: number; url?: string; title?: string; favIconUrl?: string; active?: boolean }>) => void,
  ) => void;
}

// ---------------------------------------------------------------------------
// Install / update event handling
// ---------------------------------------------------------------------------

export interface InstallDetails {
  reason: "install" | "update" | "chrome_update" | "shared_module_update";
  previousVersion?: string;
}

export interface ServiceWorkerOptions {
  runtime: ChromeRuntimeAPI;
  alarms?: ChromeAlarmsAPI;
  contextMenus?: ChromeContextMenusAPI;
  action?: ChromeActionAPI;
  tabs?: ChromeTabsQueryAPI;
}

export interface ServiceWorkerInstance {
  /** The message router for handling incoming messages */
  router: ReturnType<typeof createMessageRouter>;
  /** Register a handler for a specific message type */
  onMessage: <T extends Message["type"]>(type: T, handler: MessageHandler<T>) => void;
  /** Schedule a recurring alarm */
  scheduleAlarm: (name: string, periodInMinutes: number) => void;
  /** Register an alarm handler */
  onAlarm: (name: string, handler: () => void | Promise<void>) => void;
  /** Create a context menu item */
  addContextMenu: (props: ContextMenuCreateProperties) => void;
  /** Register a context menu click handler */
  onContextMenuClick: (id: string, handler: (info: ContextMenuClickInfo) => void | Promise<void>) => void;
  /** Set the badge text */
  setBadge: (text: string, color?: string) => void;
  /** Get the active tab info */
  getActiveTab: () => Promise<TabInfo | null>;
  /** Start all listeners */
  start: () => void;
}

/**
 * Create a service worker with common patterns pre-wired.
 *
 * @example
 * ```ts
 * const sw = createServiceWorker({
 *   runtime: chrome.runtime,
 *   alarms: chrome.alarms,
 *   contextMenus: chrome.contextMenus,
 *   action: chrome.action,
 *   tabs: chrome.tabs,
 * });
 *
 * sw.onMessage("GET_TAB_INFO", async () => {
 *   const tab = await sw.getActiveTab();
 *   return tab ?? { id: 0, url: "", title: "", active: false };
 * });
 *
 * sw.scheduleAlarm("cleanup", 60); // every 60 minutes
 * sw.onAlarm("cleanup", async () => { ... });
 *
 * sw.start();
 * ```
 */
export function createServiceWorker(
  options: ServiceWorkerOptions,
): ServiceWorkerInstance {
  const { runtime, alarms, contextMenus, action, tabs } = options;
  const router = createMessageRouter(runtime);

  const alarmHandlers = new Map<string, () => void | Promise<void>>();
  const contextMenuHandlers = new Map<
    string,
    (info: ContextMenuClickInfo) => void | Promise<void>
  >();

  // Port connection tracking (for keepalive / streaming)
  const activePorts = new Map<string, ChromePort>();

  return {
    router,

    onMessage<T extends Message["type"]>(type: T, handler: MessageHandler<T>): void {
      router.on(type, handler);
    },

    scheduleAlarm(name: string, periodInMinutes: number): void {
      if (!alarms) throw new Error("Alarms API not provided");
      alarms.create(name, { periodInMinutes });
    },

    onAlarm(name: string, handler: () => void | Promise<void>): void {
      alarmHandlers.set(name, handler);
    },

    addContextMenu(props: ContextMenuCreateProperties): void {
      if (!contextMenus) throw new Error("ContextMenus API not provided");
      contextMenus.create(props);
    },

    onContextMenuClick(
      id: string,
      handler: (info: ContextMenuClickInfo) => void | Promise<void>,
    ): void {
      contextMenuHandlers.set(id, handler);
    },

    setBadge(text: string, color = "#4688F1"): void {
      if (!action) throw new Error("Action API not provided");
      action.setBadgeText({ text });
      action.setBadgeBackgroundColor({ color });
    },

    getActiveTab(): Promise<TabInfo | null> {
      return new Promise((resolve) => {
        if (!tabs) {
          resolve(null);
          return;
        }
        tabs.query({ active: true, currentWindow: true }, (result) => {
          const first = result[0];
          if (result.length === 0 || !first || first.id === undefined) {
            resolve(null);
            return;
          }
          resolve({
            id: first.id,
            url: first.url ?? "",
            title: first.title ?? "",
            favIconUrl: first.favIconUrl,
            active: first.active ?? true,
          });
        });
      });
    },

    start(): void {
      // 1. Start the message router
      router.start();

      // 2. Listen for alarm events
      if (alarms && alarmHandlers.size > 0) {
        alarms.onAlarm.addListener((alarm: Alarm) => {
          const handler = alarmHandlers.get(alarm.name);
          if (handler) handler();
        });
      }

      // 3. Listen for context menu clicks
      if (contextMenus && contextMenuHandlers.size > 0) {
        contextMenus.onClicked.addListener((info: ContextMenuClickInfo) => {
          const handler = contextMenuHandlers.get(info.menuItemId);
          if (handler) handler(info);
        });
      }

      // 4. Listen for port connections (track active ports)
      listenForConnections(runtime, (port: ChromePort) => {
        activePorts.set(port.name, port);
        port.onDisconnect.addListener(() => {
          activePorts.delete(port.name);
        });
      });
    },
  };
}
