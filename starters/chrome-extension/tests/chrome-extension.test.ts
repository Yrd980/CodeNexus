/**
 * Chrome Extension MV3 Starter — Test Suite
 *
 * Tests all patterns with mock Chrome APIs.
 * No real browser required — everything is injectable.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  ManifestBuilder,
  createManifest,
  type ManifestV3,
  type Permission,
} from "../src/manifest.js";

import {
  createMessenger,
  createMessageRouter,
  connectToBackground,
  listenForConnections,
  type ChromeRuntimeAPI,
  type ChromeTabsAPI,
  type ChromePort,
  type ChromeSender,
} from "../src/messaging.js";

import type { Message, PortMessage } from "../src/types.js";

import {
  createInMemoryBackend,
  createTypedStorage,
  type TypedStorage,
  type SchemaMigration,
} from "../src/storage.js";

import { createServiceWorker } from "../src/background/service-worker.js";
import type { Alarm, ContextMenuClickInfo } from "../src/background/service-worker.js";

import { extractPageData, injectUI, createContentScript } from "../src/content/content-script.js";

import { createPopup, detectTheme, onThemeChange } from "../src/popup/popup.js";

import { createPermissionManager } from "../src/utils/permissions.js";

// ===========================================================================
// Test helpers — mock Chrome APIs
// ===========================================================================

function createMockRuntime(overrides: Partial<ChromeRuntimeAPI> = {}): ChromeRuntimeAPI {
  const messageListeners: Array<
    (message: Message, sender: ChromeSender, sendResponse: (r: unknown) => void) => boolean | void
  > = [];
  const connectListeners: Array<(port: ChromePort) => void> = [];

  return {
    lastError: null,
    sendMessage: vi.fn((message: Message, callback: (response: unknown) => void) => {
      // Simulate routing through registered listeners
      for (const listener of messageListeners) {
        const result = listener(message, { tab: { id: 1 } }, callback);
        if (result === true) return; // async handler
      }
      // No handler matched — invoke callback with undefined
      callback(undefined);
    }),
    onMessage: {
      addListener: vi.fn((cb) => messageListeners.push(cb)),
      removeListener: vi.fn((cb) => {
        const idx = messageListeners.indexOf(cb as typeof messageListeners[number]);
        if (idx !== -1) messageListeners.splice(idx, 1);
      }),
    },
    connect: vi.fn((_info?: { name?: string }) => createMockPort(_info?.name ?? "")),
    onConnect: {
      addListener: vi.fn((cb) => connectListeners.push(cb)),
      removeListener: vi.fn((cb) => {
        const idx = connectListeners.indexOf(cb as typeof connectListeners[number]);
        if (idx !== -1) connectListeners.splice(idx, 1);
      }),
    },
    ...overrides,
  };
}

function createMockPort(name = "test"): ChromePort {
  const messageListeners: Array<(msg: PortMessage) => void> = [];
  const disconnectListeners: Array<() => void> = [];

  return {
    name,
    sender: { tab: { id: 1 } },
    onMessage: {
      addListener: vi.fn((cb) => messageListeners.push(cb)),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((cb) => disconnectListeners.push(cb)),
      removeListener: vi.fn(),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(() => {
      for (const cb of disconnectListeners) cb();
    }),
  };
}

// ===========================================================================
// 1. Manifest Builder
// ===========================================================================

describe("ManifestBuilder", () => {
  it("creates a valid MV3 manifest with required fields", () => {
    const manifest = new ManifestBuilder({
      name: "Test Extension",
      version: "1.0.0",
      description: "A test extension",
    }).build();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Test Extension");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toBe("A test extension");
  });

  it("adds permissions without duplicates", () => {
    const manifest = new ManifestBuilder({ name: "T", version: "1.0.0" })
      .addPermissions("storage", "tabs")
      .addPermissions("storage") // duplicate
      .build();

    expect(manifest.permissions).toEqual(["storage", "tabs"]);
  });

  it("separates required and optional permissions", () => {
    const manifest = new ManifestBuilder({ name: "T", version: "1.0.0" })
      .addPermissions("storage")
      .addOptionalPermissions("tabs", "bookmarks")
      .build();

    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.optional_permissions).toEqual(["tabs", "bookmarks"]);
  });

  it("configures service worker", () => {
    const manifest = new ManifestBuilder({ name: "T", version: "1.0.0" })
      .setServiceWorker("background.js", { type: "module" })
      .build();

    expect(manifest.background).toEqual({
      service_worker: "background.js",
      type: "module",
    });
  });

  it("adds content scripts", () => {
    const manifest = new ManifestBuilder({ name: "T", version: "1.0.0" })
      .addContentScript({
        matches: ["https://*.example.com/*"],
        js: ["content.js"],
        run_at: "document_idle",
      })
      .build();

    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts![0]!.matches).toEqual(["https://*.example.com/*"]);
  });

  it("generates valid JSON", () => {
    const json = new ManifestBuilder({ name: "T", version: "1.0.0" })
      .addPermissions("storage")
      .toJSON();

    const parsed = JSON.parse(json) as ManifestV3;
    expect(parsed.manifest_version).toBe(3);
    expect(parsed.permissions).toEqual(["storage"]);
  });

  it("createManifest factory returns builder", () => {
    const builder = createManifest({ name: "T", version: "1.0.0" });
    expect(builder).toBeInstanceOf(ManifestBuilder);
  });
});

// ===========================================================================
// 2. Messaging
// ===========================================================================

describe("Messaging", () => {
  let runtime: ChromeRuntimeAPI;

  beforeEach(() => {
    runtime = createMockRuntime();
  });

  describe("createMessenger", () => {
    it("sends message to background and receives typed response", async () => {
      const mockResponse = { id: 1, url: "https://example.com", title: "Test", active: true };
      runtime.sendMessage = vi.fn((_msg: Message, cb: (r: unknown) => void) => {
        cb(mockResponse);
      });

      const messenger = createMessenger({ runtime });
      const result = await messenger.sendToBackground({ type: "GET_TAB_INFO" });

      expect(result).toEqual(mockResponse);
      expect(runtime.sendMessage).toHaveBeenCalledWith(
        { type: "GET_TAB_INFO" },
        expect.any(Function),
      );
    });

    it("rejects when runtime.lastError is set", async () => {
      const errorRuntime = createMockRuntime({
        lastError: { message: "Extension context invalidated" },
        sendMessage: vi.fn((_msg: Message, cb: (r: unknown) => void) => {
          cb(undefined);
        }),
      });

      const messenger = createMessenger({ runtime: errorRuntime });
      await expect(
        messenger.sendToBackground({ type: "GET_TAB_INFO" }),
      ).rejects.toThrow("Extension context invalidated");
    });

    it("sends message to specific tab", async () => {
      const tabs: ChromeTabsAPI = {
        sendMessage: vi.fn((_tabId: number, _msg: Message, cb: (r: unknown) => void) => {
          cb({ success: true });
        }),
      };

      const messenger = createMessenger({ runtime, tabs });
      const result = await messenger.sendToTab(42, {
        type: "SET_STORAGE",
        key: "enabled",
        value: true,
      });

      expect(result).toEqual({ success: true });
      expect(tabs.sendMessage).toHaveBeenCalledWith(42, expect.any(Object), expect.any(Function));
    });

    it("rejects sendToTab when tabs API not provided", async () => {
      const messenger = createMessenger({ runtime });
      await expect(
        messenger.sendToTab(1, { type: "GET_TAB_INFO" }),
      ).rejects.toThrow("Tabs API not provided");
    });
  });

  describe("createMessageRouter", () => {
    it("routes messages to correct handler", () => {
      const router = createMessageRouter(runtime);
      const handler = vi.fn(() => ({
        id: 1,
        url: "https://example.com",
        title: "Test",
        active: true,
      }));

      router.on("GET_TAB_INFO", handler);
      router.start();

      // Simulate incoming message by calling the registered listener
      const listener = (runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (
        message: Message,
        sender: ChromeSender,
        sendResponse: (r: unknown) => void,
      ) => boolean | void;

      const sendResponse = vi.fn();
      listener({ type: "GET_TAB_INFO" }, { tab: { id: 1 } }, sendResponse);

      expect(handler).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        id: 1,
        url: "https://example.com",
        title: "Test",
        active: true,
      });
    });

    it("handles async handlers (returns true to keep channel open)", async () => {
      const router = createMessageRouter(runtime);
      router.on("GET_TAB_INFO", async () => ({
        id: 1,
        url: "",
        title: "",
        active: true,
      }));
      router.start();

      const listener = (runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (
        message: Message,
        sender: ChromeSender,
        sendResponse: (r: unknown) => void,
      ) => boolean | void;

      const sendResponse = vi.fn();
      const result = listener({ type: "GET_TAB_INFO" }, {}, sendResponse);

      expect(result).toBe(true); // async — keep channel open

      // Wait for async handler to complete
      await new Promise((r) => setTimeout(r, 10));
      expect(sendResponse).toHaveBeenCalled();
    });

    it("ignores messages without registered handlers", () => {
      const router = createMessageRouter(runtime);
      router.start();

      const listener = (runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0] as (
        message: Message,
        sender: ChromeSender,
        sendResponse: (r: unknown) => void,
      ) => boolean | void;

      const sendResponse = vi.fn();
      const result = listener({ type: "GET_TAB_INFO" }, {}, sendResponse);

      expect(result).toBeUndefined(); // no handler → don't keep channel open
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it("stop removes the listener", () => {
      const router = createMessageRouter(runtime);
      router.start();
      router.stop();

      expect(runtime.onMessage.removeListener).toHaveBeenCalled();
    });
  });

  describe("Long-lived connections", () => {
    it("connectToBackground creates a port and sends messages", () => {
      const mockPort = createMockPort("test-channel");
      runtime.connect = vi.fn(() => mockPort);

      const conn = connectToBackground(runtime, { name: "test-channel" });

      expect(runtime.connect).toHaveBeenCalledWith({ name: "test-channel" });
      expect(conn.info.name).toBe("test-channel");

      conn.send({ type: "PING" });
      expect(mockPort.postMessage).toHaveBeenCalledWith({ type: "PING" });
    });

    it("throws when sending on disconnected port", () => {
      const mockPort = createMockPort();
      runtime.connect = vi.fn(() => mockPort);

      const conn = connectToBackground(runtime);

      // Simulate disconnect
      conn.disconnect();

      expect(() => conn.send({ type: "PING" })).toThrow("Port is disconnected");
    });

    it("calls onDisconnect when port disconnects", () => {
      const mockPort = createMockPort();
      runtime.connect = vi.fn(() => mockPort);
      const onDisconnect = vi.fn();

      connectToBackground(runtime, { onDisconnect });

      // Trigger the disconnect callback registered on the port
      const disconnectCb = (mockPort.onDisconnect.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0] as () => void;
      disconnectCb();

      expect(onDisconnect).toHaveBeenCalled();
    });

    it("listenForConnections registers handler and can stop", () => {
      const handler = vi.fn();
      const listener = listenForConnections(runtime, handler);

      expect(runtime.onConnect.addListener).toHaveBeenCalled();

      listener.stop();
      expect(runtime.onConnect.removeListener).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// 3. Storage
// ===========================================================================

describe("Storage", () => {
  let storage: TypedStorage;

  beforeEach(() => {
    const backend = createInMemoryBackend();
    storage = createTypedStorage({ backend });
  });

  it("returns default value when key is not set", async () => {
    const enabled = await storage.get("enabled");
    expect(enabled).toBe(true); // default from STORAGE_DEFAULTS
  });

  it("sets and gets a value", async () => {
    await storage.set("enabled", false);
    const enabled = await storage.get("enabled");
    expect(enabled).toBe(false);
  });

  it("sets and gets complex objects", async () => {
    const prefs = { theme: "dark" as const, notifications: false, language: "zh" };
    await storage.set("preferences", prefs);
    const result = await storage.get("preferences");
    expect(result).toEqual(prefs);
  });

  it("removes a key (falls back to default)", async () => {
    await storage.set("enabled", false);
    await storage.remove("enabled");
    // After removal, get should return the default
    const enabled = await storage.get("enabled");
    expect(enabled).toBe(true); // default
  });

  it("getAll returns all values with defaults", async () => {
    await storage.set("enabled", false);
    const all = await storage.getAll();

    expect(all.enabled).toBe(false);
    expect(all.preferences).toBeDefined();
    expect(all.schemaVersion).toBe(1);
  });

  it("onChange fires when a specific key changes", async () => {
    // Set initial value so oldValue is tracked in the backend
    await storage.set("enabled", true);

    const callback = vi.fn();
    const unsubscribe = storage.onChange("enabled", callback);

    await storage.set("enabled", false);

    expect(callback).toHaveBeenCalledWith(false, true); // newValue, oldValue

    unsubscribe();
    await storage.set("enabled", true);

    // Should not fire after unsubscribe
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("onChange does not fire for unrelated keys", async () => {
    const callback = vi.fn();
    storage.onChange("enabled", callback);

    await storage.set("preferences", {
      theme: "dark",
      notifications: true,
      language: "en",
    });

    expect(callback).not.toHaveBeenCalled();
  });

  describe("Schema migration", () => {
    it("runs pending migrations in order", async () => {
      const order: number[] = [];
      const migrations: SchemaMigration[] = [
        {
          version: 3,
          description: "Third migration",
          up: async () => { order.push(3); },
        },
        {
          version: 2,
          description: "Second migration",
          up: async () => { order.push(2); },
        },
      ];

      // Current schema version is 1 (default)
      await storage.migrate(migrations);

      expect(order).toEqual([2, 3]); // sorted by version
      expect(await storage.get("schemaVersion")).toBe(3);
    });

    it("skips already-applied migrations", async () => {
      await storage.set("schemaVersion", 5);

      const handler = vi.fn();
      const migrations: SchemaMigration[] = [
        { version: 3, description: "Old", up: handler },
        { version: 5, description: "Current", up: handler },
        { version: 7, description: "New", up: async () => { handler(); } },
      ];

      await storage.migrate(migrations);

      expect(handler).toHaveBeenCalledTimes(1); // only version 7
    });
  });
});

// ===========================================================================
// 4. Service Worker
// ===========================================================================

describe("ServiceWorker", () => {
  it("handles messages via the router", async () => {
    const runtime = createMockRuntime();
    const sw = createServiceWorker({ runtime });

    sw.onMessage("GET_TAB_INFO", async () => ({
      id: 1,
      url: "https://example.com",
      title: "Example",
      active: true,
    }));

    sw.start();

    // Verify the message listener was registered
    expect(runtime.onMessage.addListener).toHaveBeenCalled();
  });

  it("schedules and handles alarms", () => {
    const runtime = createMockRuntime();
    const alarmListeners: Array<(alarm: Alarm) => void> = [];
    const alarms = {
      create: vi.fn(),
      onAlarm: {
        addListener: vi.fn((cb: (alarm: Alarm) => void) => alarmListeners.push(cb)),
        removeListener: vi.fn(),
      },
      clear: vi.fn(),
      getAll: vi.fn(),
    };

    const sw = createServiceWorker({ runtime, alarms });
    const handler = vi.fn();

    sw.scheduleAlarm("cleanup", 60);
    sw.onAlarm("cleanup", handler);
    sw.start();

    expect(alarms.create).toHaveBeenCalledWith("cleanup", { periodInMinutes: 60 });

    // Simulate alarm firing
    for (const listener of alarmListeners) {
      listener({ name: "cleanup", scheduledTime: Date.now() });
    }
    expect(handler).toHaveBeenCalled();
  });

  it("creates context menus and handles clicks", () => {
    const runtime = createMockRuntime();
    const clickListeners: Array<(info: ContextMenuClickInfo, tab?: { id?: number }) => void> = [];
    const contextMenus = {
      create: vi.fn(),
      onClicked: {
        addListener: vi.fn((cb: (info: ContextMenuClickInfo, tab?: { id?: number }) => void) =>
          clickListeners.push(cb),
        ),
        removeListener: vi.fn(),
      },
      removeAll: vi.fn(),
    };

    const sw = createServiceWorker({ runtime, contextMenus });
    const handler = vi.fn();

    sw.addContextMenu({ id: "search", title: "Search", contexts: ["selection"] });
    sw.onContextMenuClick("search", handler);
    sw.start();

    expect(contextMenus.create).toHaveBeenCalled();

    // Simulate click
    for (const listener of clickListeners) {
      listener({ menuItemId: "search", selectionText: "hello" });
    }
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ menuItemId: "search", selectionText: "hello" }),
    );
  });

  it("sets badge text and color", () => {
    const runtime = createMockRuntime();
    const action = {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    };

    const sw = createServiceWorker({ runtime, action });
    sw.setBadge("42", "#FF0000");

    expect(action.setBadgeText).toHaveBeenCalledWith({ text: "42" });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#FF0000" });
  });

  it("gets active tab info", async () => {
    const runtime = createMockRuntime();
    const tabs = {
      query: vi.fn((_q: unknown, cb: (t: Array<{ id?: number; url?: string; title?: string; active?: boolean }>) => void) => {
        cb([{ id: 5, url: "https://example.com", title: "Example", active: true }]);
      }),
    };

    const sw = createServiceWorker({ runtime, tabs });
    const tab = await sw.getActiveTab();

    expect(tab).toEqual({
      id: 5,
      url: "https://example.com",
      title: "Example",
      active: true,
      favIconUrl: undefined,
    });
  });

  it("returns null when no active tab", async () => {
    const runtime = createMockRuntime();
    const tabs = {
      query: vi.fn((_q: unknown, cb: (t: Array<{ id?: number }>) => void) => cb([])),
    };

    const sw = createServiceWorker({ runtime, tabs });
    const tab = await sw.getActiveTab();
    expect(tab).toBeNull();
  });
});

// ===========================================================================
// 5. Content Script
// ===========================================================================

describe("Content Script", () => {
  describe("extractPageData", () => {
    it("extracts structured page data from document", () => {
      // Create a minimal mock document
      const doc = {
        title: "Test Page",
        location: { href: "https://example.com/page" },
        querySelector: vi.fn((selector: string) => {
          const mocks: Record<string, { getAttribute: (attr: string) => string | null }> = {
            'meta[name="description"]': {
              getAttribute: () => "A test page",
            },
            'link[rel="canonical"]': {
              getAttribute: () => "https://example.com/canonical",
            },
          };
          return mocks[selector] ?? null;
        }),
      } as unknown as Document;

      const data = extractPageData(doc);

      expect(data.title).toBe("Test Page");
      expect(data.url).toBe("https://example.com/page");
      expect(data.description).toBe("A test page");
      expect(data.canonicalUrl).toBe("https://example.com/canonical");
    });
  });

  describe("injectUI", () => {
    it("injects an element with the given id", () => {
      const container = {
        insertAdjacentElement: vi.fn(),
      };
      const wrapper = {
        id: "",
        textContent: "",
        style: {} as Record<string, unknown>,
        remove: vi.fn(),
      };

      const doc = {
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => container),
        createElement: vi.fn(() => wrapper),
      } as unknown as Document;

      const ui = injectUI(doc, {
        id: "test-widget",
        content: "Hello world",
        container: "body",
      });

      expect(wrapper.id).toBe("test-widget");
      expect(wrapper.textContent).toBe("Hello world");
      expect(container.insertAdjacentElement).toHaveBeenCalledWith("beforeend", wrapper);
      expect(ui.element).toBe(wrapper);
    });

    it("removes existing element with same id before injecting", () => {
      const existingEl = { remove: vi.fn() };
      const container = { insertAdjacentElement: vi.fn() };
      const wrapper = {
        id: "",
        textContent: "",
        style: {} as Record<string, unknown>,
        remove: vi.fn(),
      };

      const doc = {
        getElementById: vi.fn(() => existingEl),
        querySelector: vi.fn(() => container),
        createElement: vi.fn(() => wrapper),
      } as unknown as Document;

      injectUI(doc, {
        id: "test-widget",
        content: "Updated",
        container: "body",
      });

      expect(existingEl.remove).toHaveBeenCalled();
    });

    it("returns no-op when container not found", () => {
      const doc = {
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => null),
      } as unknown as Document;

      const ui = injectUI(doc, {
        id: "test",
        content: "text",
        container: ".nonexistent",
      });

      expect(ui.element).toBeNull();
      // remove/update should not throw
      ui.remove();
      ui.update("new text");
    });
  });

  describe("createContentScript", () => {
    it("creates a content script with messenger", () => {
      const runtime = createMockRuntime();
      const cs = createContentScript({ runtime });

      expect(cs.messenger).toBeDefined();
      expect(cs.sendMessage).toBeInstanceOf(Function);
      expect(cs.cleanup).toBeInstanceOf(Function);
    });

    it("runs cleanup handlers and clears them", () => {
      const runtime = createMockRuntime();
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();
      const cs = createContentScript({ runtime });

      cs.addCleanup(cleanup1);
      cs.addCleanup(cleanup2);
      cs.cleanup();

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();

      // Second cleanup should not fire again
      cleanup1.mockClear();
      cs.cleanup();
      expect(cleanup1).not.toHaveBeenCalled();
    });

    it("runs onCleanup callback on cleanup", () => {
      const runtime = createMockRuntime();
      const onCleanup = vi.fn();
      const cs = createContentScript({ runtime, onCleanup });

      cs.cleanup();
      expect(onCleanup).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// 6. Popup
// ===========================================================================

describe("Popup", () => {
  let runtime: ChromeRuntimeAPI;
  let storage: TypedStorage;

  beforeEach(() => {
    runtime = createMockRuntime();
    const backend = createInMemoryBackend();
    storage = createTypedStorage({ backend });
  });

  it("initializes with storage values", async () => {
    await storage.set("enabled", false);
    await storage.set("preferences", { theme: "dark", notifications: false, language: "zh" });

    const stateUpdates: unknown[] = [];
    const popup = createPopup({
      runtime,
      storage,
      onStateChange: (s) => stateUpdates.push({ ...s }),
    });

    await popup.init();

    const state = popup.getState();
    expect(state.enabled).toBe(false);
    expect(state.preferences.theme).toBe("dark");
    expect(state.loading).toBe(false);
  });

  it("toggleEnabled toggles and persists", async () => {
    const popup = createPopup({ runtime, storage });
    await popup.init();

    expect(popup.getState().enabled).toBe(true);

    await popup.toggleEnabled();
    expect(popup.getState().enabled).toBe(false);

    // Verify persisted
    const stored = await storage.get("enabled");
    expect(stored).toBe(false);
  });

  it("updatePreference updates and persists", async () => {
    const popup = createPopup({ runtime, storage });
    await popup.init();

    await popup.updatePreference("theme", "dark");

    expect(popup.getState().preferences.theme).toBe("dark");

    const stored = await storage.get("preferences");
    expect(stored.theme).toBe("dark");
  });

  describe("Theme detection", () => {
    it("detectTheme returns dark when prefers-color-scheme matches", () => {
      const win = {
        matchMedia: vi.fn(() => ({ matches: true })),
      };
      expect(detectTheme(win)).toBe("dark");
    });

    it("detectTheme returns light when no match", () => {
      const win = {
        matchMedia: vi.fn(() => ({ matches: false })),
      };
      expect(detectTheme(win)).toBe("light");
    });

    it("detectTheme returns light when matchMedia not available", () => {
      expect(detectTheme({})).toBe("light");
    });

    it("onThemeChange calls callback on change", () => {
      let handler: ((e: { matches: boolean }) => void) | null = null;
      const win = {
        matchMedia: vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => {
            handler = cb;
          }),
          removeEventListener: vi.fn(),
        })),
      };

      const callback = vi.fn();
      onThemeChange(callback, win);

      // Simulate theme change
      handler?.({ matches: true });
      expect(callback).toHaveBeenCalledWith("dark");
    });
  });
});

// ===========================================================================
// 7. Permissions
// ===========================================================================

describe("Permissions", () => {
  it("requests permissions and returns result", async () => {
    const api = {
      request: vi.fn((_perms: unknown, cb: (granted: boolean) => void) => cb(true)),
      contains: vi.fn(),
      remove: vi.fn(),
      getAll: vi.fn(),
    };

    const pm = createPermissionManager({ permissions: api });
    const granted = await pm.request(["tabs", "bookmarks"]);

    expect(granted).toBe(true);
    expect(api.request).toHaveBeenCalledWith(
      { permissions: ["tabs", "bookmarks"], origins: undefined },
      expect.any(Function),
    );
  });

  it("checks permission status", async () => {
    const api = {
      request: vi.fn(),
      contains: vi.fn((_perms: unknown, cb: (result: boolean) => void) => cb(true)),
      remove: vi.fn(),
      getAll: vi.fn(),
    };

    const pm = createPermissionManager({ permissions: api });
    const has = await pm.has(["storage"]);
    expect(has).toBe(true);
  });

  it("releases permissions", async () => {
    const api = {
      request: vi.fn(),
      contains: vi.fn(),
      remove: vi.fn((_perms: unknown, cb: (removed: boolean) => void) => cb(true)),
      getAll: vi.fn(),
    };

    const pm = createPermissionManager({ permissions: api });
    const removed = await pm.release(["tabs"]);
    expect(removed).toBe(true);
  });

  it("withPermission runs function when permission granted", async () => {
    const api = {
      request: vi.fn((_p: unknown, cb: (g: boolean) => void) => cb(true)),
      contains: vi.fn((_p: unknown, cb: (r: boolean) => void) => cb(false)), // not yet granted
      remove: vi.fn(),
      getAll: vi.fn(),
    };

    const pm = createPermissionManager({ permissions: api });
    const result = await pm.withPermission(["tabs"], () => "hello");

    expect(result).toBe("hello");
    expect(api.request).toHaveBeenCalled();
  });

  it("withPermission returns null when permission denied", async () => {
    const api = {
      request: vi.fn((_p: unknown, cb: (g: boolean) => void) => cb(false)),
      contains: vi.fn((_p: unknown, cb: (r: boolean) => void) => cb(false)),
      remove: vi.fn(),
      getAll: vi.fn(),
    };

    const pm = createPermissionManager({ permissions: api });
    const result = await pm.withPermission(["tabs"], () => "hello");

    expect(result).toBeNull();
  });

  it("withPermission skips request when already granted", async () => {
    const api = {
      request: vi.fn(),
      contains: vi.fn((_p: unknown, cb: (r: boolean) => void) => cb(true)), // already granted
      remove: vi.fn(),
      getAll: vi.fn(),
    };

    const pm = createPermissionManager({ permissions: api });
    const result = await pm.withPermission(["tabs"], () => 42);

    expect(result).toBe(42);
    expect(api.request).not.toHaveBeenCalled(); // did not need to request
  });
});
