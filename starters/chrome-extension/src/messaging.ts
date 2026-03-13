/**
 * Chrome Extension MV3 — Type-safe Message Passing
 *
 * Why discriminated unions?
 * Message type mismatches are the #1 extension bug. By mapping each message
 * `type` to a specific payload + response, TypeScript catches errors at
 * compile time instead of at 2 AM in production.
 *
 * Patterns implemented:
 * - One-shot messages (chrome.runtime.sendMessage / chrome.tabs.sendMessage)
 * - Long-lived connections (chrome.runtime.connect)
 * - Error handling for disconnected ports
 */

import type {
  Message,
  MessageResponse,
  PortMessage,
  PortInfo,
} from "./types.js";

// ---------------------------------------------------------------------------
// Chrome API abstraction (allows dependency injection for testing)
// ---------------------------------------------------------------------------

export interface ChromeRuntimeAPI {
  sendMessage: (
    message: Message,
    callback: (response: unknown) => void,
  ) => void;
  onMessage: {
    addListener: (
      callback: (
        message: Message,
        sender: ChromeSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | void,
    ) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
  connect: (connectInfo?: { name?: string }) => ChromePort;
  onConnect: {
    addListener: (callback: (port: ChromePort) => void) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
  lastError?: { message: string } | null;
}

export interface ChromeTabsAPI {
  sendMessage: (
    tabId: number,
    message: Message,
    callback: (response: unknown) => void,
  ) => void;
}

export interface ChromeSender {
  tab?: { id?: number; url?: string };
  frameId?: number;
  id?: string;
  url?: string;
}

export interface ChromePort {
  name: string;
  sender?: ChromeSender;
  onMessage: {
    addListener: (callback: (message: PortMessage) => void) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
  onDisconnect: {
    addListener: (callback: () => void) => void;
    removeListener: (callback: (...args: unknown[]) => void) => void;
  };
  postMessage: (message: PortMessage) => void;
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// One-shot messaging
// ---------------------------------------------------------------------------

export interface MessengerOptions {
  runtime: ChromeRuntimeAPI;
  tabs?: ChromeTabsAPI;
}

/**
 * Type-safe one-shot messenger.
 *
 * @example
 * ```ts
 * const messenger = createMessenger({ runtime: chrome.runtime, tabs: chrome.tabs });
 *
 * // Send from popup → background (type-safe response!)
 * const tabInfo = await messenger.sendToBackground({ type: "GET_TAB_INFO" });
 * //    ^? TabInfo
 * ```
 */
export function createMessenger(options: MessengerOptions) {
  const { runtime, tabs } = options;

  return {
    /**
     * Send a message to the background service worker.
     * Returns a typed response based on the message type.
     */
    sendToBackground<T extends Message>(
      message: T,
    ): Promise<MessageResponse<T["type"]>> {
      return new Promise((resolve, reject) => {
        runtime.sendMessage(message, (response) => {
          if (runtime.lastError) {
            reject(new Error(runtime.lastError.message));
            return;
          }
          resolve(response as MessageResponse<T["type"]>);
        });
      });
    },

    /**
     * Send a message to a specific tab's content script.
     * Requires the `tabs` API.
     */
    sendToTab<T extends Message>(
      tabId: number,
      message: T,
    ): Promise<MessageResponse<T["type"]>> {
      if (!tabs) {
        return Promise.reject(
          new Error("Tabs API not provided to messenger"),
        );
      }
      return new Promise((resolve, reject) => {
        tabs.sendMessage(tabId, message, (response) => {
          if (runtime.lastError) {
            reject(new Error(runtime.lastError.message));
            return;
          }
          resolve(response as MessageResponse<T["type"]>);
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Message handler registration (background side)
// ---------------------------------------------------------------------------

export type MessageHandler<T extends Message["type"]> = (
  message: Extract<Message, { type: T }>,
  sender: ChromeSender,
) => Promise<MessageResponse<T>> | MessageResponse<T>;

type HandlerMap = {
  [K in Message["type"]]?: MessageHandler<K>;
};

/**
 * Register type-safe message handlers in the background service worker.
 *
 * @example
 * ```ts
 * const router = createMessageRouter(chrome.runtime);
 *
 * router.on("GET_TAB_INFO", async (_msg, sender) => {
 *   return { id: sender.tab?.id ?? 0, url: "", title: "", active: true };
 * });
 *
 * router.on("SET_STORAGE", async (msg) => {
 *   await storage.set(msg.key, msg.value);
 *   return { success: true };
 * });
 *
 * router.start();
 * ```
 */
export function createMessageRouter(runtime: ChromeRuntimeAPI) {
  const handlers: HandlerMap = {};
  let listenerRef: ((
    message: Message,
    sender: ChromeSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void) | null = null;

  return {
    /** Register a handler for a specific message type */
    on<T extends Message["type"]>(type: T, handler: MessageHandler<T>): void {
      (handlers as Record<string, unknown>)[type] = handler;
    },

    /** Start listening for messages */
    start(): void {
      if (listenerRef) return; // already started

      listenerRef = (
        message: Message,
        sender: ChromeSender,
        sendResponse: (response: unknown) => void,
      ): boolean | void => {
        const handler = (handlers as Record<string, MessageHandler<Message["type"]>>)[
          message.type
        ];
        if (!handler) return; // no handler registered

        // Return true to indicate async response
        const result = handler(
          message as never,
          sender,
        );

        if (result instanceof Promise) {
          result
            .then((response) => sendResponse(response))
            .catch((err: Error) =>
              sendResponse({ error: err.message }),
            );
          return true; // keep message channel open for async
        }

        sendResponse(result);
      };

      runtime.onMessage.addListener(listenerRef);
    },

    /** Stop listening for messages */
    stop(): void {
      if (listenerRef) {
        runtime.onMessage.removeListener(listenerRef as (...args: unknown[]) => void);
        listenerRef = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Long-lived connections (chrome.runtime.connect)
// ---------------------------------------------------------------------------

export interface PortConnectionOptions {
  /** Handler called when a message arrives on the port */
  onMessage?: (message: PortMessage, port: ChromePort) => void;
  /** Handler called when the port disconnects */
  onDisconnect?: (port: ChromePort) => void;
}

/**
 * Create a long-lived connection to the background service worker.
 * Useful for streaming data or maintaining state across multiple messages.
 *
 * @example
 * ```ts
 * const conn = connectToBackground(chrome.runtime, {
 *   name: "data-stream",
 *   onMessage: (msg) => {
 *     if (msg.type === "STREAM_DATA") handleData(msg.data);
 *   },
 * });
 *
 * conn.send({ type: "STREAM_START", channel: "updates" });
 * // later...
 * conn.disconnect();
 * ```
 */
export function connectToBackground(
  runtime: ChromeRuntimeAPI,
  options: PortConnectionOptions & { name?: string } = {},
): { port: ChromePort; send: (msg: PortMessage) => void; disconnect: () => void; info: PortInfo } {
  const port = runtime.connect({ name: options.name });
  let connected = true;

  if (options.onMessage) {
    port.onMessage.addListener(options.onMessage.bind(null) as (message: PortMessage) => void);
  }

  const handleDisconnect = () => {
    connected = false;
    options.onDisconnect?.(port);
  };
  port.onDisconnect.addListener(handleDisconnect);

  return {
    port,
    send(msg: PortMessage): void {
      if (!connected) {
        throw new Error("Port is disconnected");
      }
      port.postMessage(msg);
    },
    disconnect(): void {
      if (connected) {
        connected = false;
        port.disconnect();
      }
    },
    info: {
      name: options.name ?? "",
      tabId: port.sender?.tab?.id,
    },
  };
}

/**
 * Listen for incoming port connections in the background service worker.
 *
 * @example
 * ```ts
 * listenForConnections(chrome.runtime, (port) => {
 *   port.onMessage.addListener((msg) => {
 *     if (msg.type === "PING") port.postMessage({ type: "PONG" });
 *   });
 * });
 * ```
 */
export function listenForConnections(
  runtime: ChromeRuntimeAPI,
  handler: (port: ChromePort) => void,
): { stop: () => void } {
  const wrappedHandler = (port: ChromePort) => handler(port);
  runtime.onConnect.addListener(wrappedHandler);

  return {
    stop(): void {
      runtime.onConnect.removeListener(wrappedHandler as (...args: unknown[]) => void);
    },
  };
}
