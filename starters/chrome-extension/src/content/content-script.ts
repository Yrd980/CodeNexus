/**
 * Chrome Extension MV3 — Content Script Patterns
 *
 * Content scripts run in the context of web pages. Key challenges:
 * 1. Must communicate with background via messaging (no direct access)
 * 2. DOM can change at any time — need MutationObserver
 * 3. Must clean up when navigating away (SPA or full reload)
 * 4. Run in an isolated world — share DOM but not JS variables
 *
 * This module provides composable patterns for common content script tasks.
 */

import type { Message, ContentScriptContext } from "../types.js";
import type { ChromeRuntimeAPI } from "../messaging.js";
import { createMessenger } from "../messaging.js";

// ---------------------------------------------------------------------------
// DOM Observation
// ---------------------------------------------------------------------------

export interface DOMObserverOptions {
  /** CSS selector to watch for */
  selector: string;
  /** Called when matching elements are added to the DOM */
  onAdded?: (elements: Element[]) => void;
  /** Called when matching elements are removed from the DOM */
  onRemoved?: (elements: Element[]) => void;
  /** Root element to observe (defaults to document.body) */
  root?: Element;
  /** MutationObserver options */
  observerOptions?: MutationObserverInit;
}

export interface DOMObserverInstance {
  /** Start observing */
  start: () => void;
  /** Stop observing and clean up */
  stop: () => void;
  /** Get all currently matching elements */
  getMatching: () => Element[];
}

/**
 * Observe DOM changes and react to elements matching a selector.
 *
 * @example
 * ```ts
 * const observer = createDOMObserver({
 *   selector: ".tweet",
 *   onAdded: (tweets) => tweets.forEach(annotateTweet),
 *   onRemoved: (tweets) => tweets.forEach(cleanupTweet),
 * });
 *
 * observer.start();
 * // later...
 * observer.stop();
 * ```
 */
export function createDOMObserver(options: DOMObserverOptions): DOMObserverInstance {
  const {
    selector,
    onAdded,
    onRemoved,
    observerOptions = { childList: true, subtree: true },
  } = options;
  let root = options.root;
  let observer: MutationObserver | null = null;

  const mutationCallback: MutationCallback = (mutations) => {
    const addedElements: Element[] = [];
    const removedElements: Element[] = [];

    for (const mutation of mutations) {
      // Check added nodes
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        if (el.matches(selector)) {
          addedElements.push(el);
        }
        // Also check children of added nodes
        const children = el.querySelectorAll(selector);
        for (const child of Array.from(children)) {
          addedElements.push(child);
        }
      }

      // Check removed nodes
      for (const node of Array.from(mutation.removedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as Element;
        if (el.matches(selector)) {
          removedElements.push(el);
        }
        const children = el.querySelectorAll(selector);
        for (const child of Array.from(children)) {
          removedElements.push(child);
        }
      }
    }

    if (addedElements.length > 0 && onAdded) {
      onAdded(addedElements);
    }
    if (removedElements.length > 0 && onRemoved) {
      onRemoved(removedElements);
    }
  };

  return {
    start() {
      if (observer) return;
      if (!root) {
        root = typeof document !== "undefined" ? document.body : undefined;
      }
      if (!root) throw new Error("No root element available for observation");
      observer = new MutationObserver(mutationCallback);
      observer.observe(root, observerOptions);
    },

    stop() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },

    getMatching(): Element[] {
      if (!root) return [];
      return Array.from(root.querySelectorAll(selector));
    },
  };
}

// ---------------------------------------------------------------------------
// Page data extraction
// ---------------------------------------------------------------------------

export interface PageData {
  title: string;
  url: string;
  description: string;
  canonicalUrl: string | null;
  ogImage: string | null;
}

/** Extract structured data from the current page (must be called from content script) */
export function extractPageData(doc: Document): PageData {
  const getMeta = (name: string): string => {
    const el =
      doc.querySelector(`meta[name="${name}"]`) ??
      doc.querySelector(`meta[property="${name}"]`);
    return el?.getAttribute("content") ?? "";
  };

  const canonicalLink = doc.querySelector('link[rel="canonical"]');

  return {
    title: doc.title,
    url: doc.location?.href ?? "",
    description: getMeta("description") || getMeta("og:description"),
    canonicalUrl: canonicalLink?.getAttribute("href") ?? null,
    ogImage: getMeta("og:image") || null,
  };
}

// ---------------------------------------------------------------------------
// UI injection
// ---------------------------------------------------------------------------

export interface InjectUIOptions {
  /**
   * HTML content or factory function for the injected element.
   *
   * SECURITY NOTE: This content is set via textContent by default.
   * If you need rich HTML, pass `trustContent: true` and ensure the HTML is
   * controlled by your extension (never from user input or page content).
   * For untrusted content, sanitize with DOMPurify or similar before passing.
   */
  content: string;
  /** Set to true to interpret `content` as HTML. Only use with extension-controlled content. */
  trustContent?: boolean;
  /** CSS selector for the container to inject into */
  container: string;
  /** Where to inject relative to the container */
  position?: InsertPosition;
  /** Unique ID for the injected element (prevents duplicates) */
  id: string;
  /** Optional styles to apply to the wrapper element */
  styles?: Partial<CSSStyleDeclaration>;
}

export interface InjectedUI {
  /** The injected wrapper element */
  element: Element | null;
  /** Remove the injected UI */
  remove: () => void;
  /** Update the text content */
  update: (text: string) => void;
}

/**
 * Inject UI elements into the host page.
 *
 * Uses a wrapper element with a unique ID to prevent duplicates
 * and enable clean removal. By default uses textContent for safety.
 *
 * @example
 * ```ts
 * const ui = injectUI(document, {
 *   id: "my-extension-widget",
 *   content: "Hello from extension!",
 *   container: "body",
 *   position: "beforeend",
 * });
 *
 * // later...
 * ui.remove();
 * ```
 */
export function injectUI(doc: Document, options: InjectUIOptions): InjectedUI {
  const { container, position = "beforeend", id, styles, trustContent } = options;

  // Remove existing instance (prevent duplicates)
  const existing = doc.getElementById(id);
  if (existing) existing.remove();

  const containerEl = doc.querySelector(container);
  if (!containerEl) {
    return { element: null, remove: () => {}, update: () => {} };
  }

  const wrapper = doc.createElement("div");
  wrapper.id = id;

  // Use textContent by default for XSS safety.
  // Only use DOM parsing when explicitly opted in with trustContent.
  if (trustContent) {
    const template = doc.createElement("template");
    template.textContent = options.content;
    // Parse as DOM rather than raw innerHTML for slightly safer handling
    const parsed = new DOMParser().parseFromString(options.content, "text/html");
    while (parsed.body.firstChild) {
      wrapper.appendChild(doc.adoptNode(parsed.body.firstChild));
    }
  } else {
    wrapper.textContent = options.content;
  }

  if (styles) {
    for (const [key, value] of Object.entries(styles)) {
      (wrapper.style as unknown as Record<string, unknown>)[key] = value;
    }
  }

  containerEl.insertAdjacentElement(position, wrapper);

  return {
    element: wrapper,
    remove() {
      wrapper.remove();
    },
    update(text: string) {
      wrapper.textContent = text;
    },
  };
}

// ---------------------------------------------------------------------------
// Content script lifecycle
// ---------------------------------------------------------------------------

export interface ContentScriptOptions {
  runtime: ChromeRuntimeAPI;
  /** Called when the content script initializes */
  onInit?: (context: ContentScriptContext) => void | Promise<void>;
  /** Called when the page is about to unload (cleanup) */
  onCleanup?: () => void;
}

export interface ContentScriptInstance {
  /** The messenger for communicating with background */
  messenger: ReturnType<typeof createMessenger>;
  /** Send a message to the background service worker */
  sendMessage: <T extends Message>(message: T) => Promise<unknown>;
  /** Register cleanup handlers */
  addCleanup: (fn: () => void) => void;
  /** Run all cleanup handlers */
  cleanup: () => void;
}

/**
 * Initialize a content script with messaging and lifecycle management.
 *
 * @example
 * ```ts
 * const cs = createContentScript({
 *   runtime: chrome.runtime,
 *   onInit: async (ctx) => {
 *     console.log("Content script running on", ctx.url);
 *     await cs.sendMessage({ type: "CONTENT_READY", url: ctx.url, title: document.title });
 *   },
 *   onCleanup: () => console.log("Cleaning up..."),
 * });
 * ```
 */
export function createContentScript(
  options: ContentScriptOptions,
): ContentScriptInstance {
  const { runtime, onInit, onCleanup } = options;
  const cleanupFns: Array<() => void> = [];

  const messenger = createMessenger({ runtime });

  if (onCleanup) {
    cleanupFns.push(onCleanup);
  }

  const instance: ContentScriptInstance = {
    messenger,

    sendMessage<T extends Message>(message: T): Promise<unknown> {
      return messenger.sendToBackground(message);
    },

    addCleanup(fn: () => void) {
      cleanupFns.push(fn);
    },

    cleanup() {
      for (const fn of cleanupFns) {
        try {
          fn();
        } catch {
          // Best-effort cleanup — don't let one failure stop others
        }
      }
      cleanupFns.length = 0;
    },
  };

  // Initialize
  if (onInit) {
    const context: ContentScriptContext = {
      tabId: 0, // Will be set by background via sender.tab.id
      frameId: 0,
      url: typeof location !== "undefined" ? location.href : "",
      origin: typeof location !== "undefined" ? location.origin : "",
    };
    // Fire and forget — content scripts don't block on init
    Promise.resolve(onInit(context)).catch(() => {
      // Silently handle init errors
    });
  }

  // Register beforeunload cleanup
  if (typeof addEventListener !== "undefined") {
    addEventListener("beforeunload", () => instance.cleanup());
  }

  return instance;
}
