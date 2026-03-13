/**
 * Chrome Extension MV3 — Type-safe Manifest Builder
 *
 * Generates a valid manifest.json for Manifest V3 extensions.
 * Enforces minimal permissions principle — only request what you need.
 */

// ---------------------------------------------------------------------------
// Manifest types (subset of chrome.runtime.ManifestV3)
// ---------------------------------------------------------------------------

export interface ManifestV3 {
  manifest_version: 3;
  name: string;
  version: string;
  description?: string;
  permissions?: Permission[];
  optional_permissions?: Permission[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  background?: {
    service_worker: string;
    type?: "module";
  };
  content_scripts?: ContentScriptConfig[];
  action?: ActionConfig;
  options_page?: string;
  options_ui?: {
    page: string;
    open_in_tab?: boolean;
  };
  icons?: Partial<Record<IconSize, string>>;
  web_accessible_resources?: WebAccessibleResource[];
  content_security_policy?: {
    extension_pages?: string;
  };
  minimum_chrome_version?: string;
}

/** Permissions available in Manifest V3 */
export type Permission =
  | "activeTab"
  | "alarms"
  | "bookmarks"
  | "clipboardRead"
  | "clipboardWrite"
  | "contextMenus"
  | "cookies"
  | "declarativeNetRequest"
  | "downloads"
  | "history"
  | "identity"
  | "notifications"
  | "offscreen"
  | "scripting"
  | "sidePanel"
  | "storage"
  | "tabGroups"
  | "tabs"
  | "webNavigation"
  | "webRequest";

export interface ContentScriptConfig {
  matches: string[];
  js?: string[];
  css?: string[];
  run_at?: "document_start" | "document_idle" | "document_end";
  all_frames?: boolean;
  match_about_blank?: boolean;
}

export interface ActionConfig {
  default_popup?: string;
  default_icon?: Partial<Record<IconSize, string>>;
  default_title?: string;
}

type IconSize = "16" | "32" | "48" | "128";

export interface WebAccessibleResource {
  resources: string[];
  matches: string[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ManifestBuilderOptions {
  name: string;
  version: string;
  description?: string;
}

export class ManifestBuilder {
  private manifest: ManifestV3;

  constructor(options: ManifestBuilderOptions) {
    this.manifest = {
      manifest_version: 3,
      name: options.name,
      version: options.version,
      ...(options.description ? { description: options.description } : {}),
    };
  }

  /**
   * Add required permissions (shown to user at install time).
   * Follow the minimal permissions principle — only request what you need.
   */
  addPermissions(...permissions: Permission[]): this {
    if (!this.manifest.permissions) {
      this.manifest.permissions = [];
    }
    for (const p of permissions) {
      if (!this.manifest.permissions.includes(p)) {
        this.manifest.permissions.push(p);
      }
    }
    return this;
  }

  /**
   * Add optional permissions (requested at runtime via chrome.permissions.request).
   * Prefer optional permissions over required permissions when possible.
   */
  addOptionalPermissions(...permissions: Permission[]): this {
    if (!this.manifest.optional_permissions) {
      this.manifest.optional_permissions = [];
    }
    for (const p of permissions) {
      if (!this.manifest.optional_permissions.includes(p)) {
        this.manifest.optional_permissions.push(p);
      }
    }
    return this;
  }

  /** Add host permissions (e.g. "https://api.example.com/*") */
  addHostPermissions(...hosts: string[]): this {
    if (!this.manifest.host_permissions) {
      this.manifest.host_permissions = [];
    }
    for (const h of hosts) {
      if (!this.manifest.host_permissions.includes(h)) {
        this.manifest.host_permissions.push(h);
      }
    }
    return this;
  }

  /** Register background service worker */
  setServiceWorker(path: string, options?: { type?: "module" }): this {
    this.manifest.background = {
      service_worker: path,
      ...(options?.type ? { type: options.type } : {}),
    };
    return this;
  }

  /** Add a content script configuration */
  addContentScript(config: ContentScriptConfig): this {
    if (!this.manifest.content_scripts) {
      this.manifest.content_scripts = [];
    }
    this.manifest.content_scripts.push(config);
    return this;
  }

  /** Configure the browser action (popup) */
  setAction(config: ActionConfig): this {
    this.manifest.action = config;
    return this;
  }

  /** Set extension icons */
  setIcons(icons: Partial<Record<IconSize, string>>): this {
    this.manifest.icons = icons;
    return this;
  }

  /** Set options page */
  setOptionsPage(page: string, options?: { openInTab?: boolean }): this {
    if (options?.openInTab === false) {
      this.manifest.options_ui = { page, open_in_tab: false };
    } else {
      this.manifest.options_page = page;
    }
    return this;
  }

  /** Add web-accessible resources */
  addWebAccessibleResources(resources: string[], matches: string[]): this {
    if (!this.manifest.web_accessible_resources) {
      this.manifest.web_accessible_resources = [];
    }
    this.manifest.web_accessible_resources.push({ resources, matches });
    return this;
  }

  /** Set minimum Chrome version */
  setMinimumChromeVersion(version: string): this {
    this.manifest.minimum_chrome_version = version;
    return this;
  }

  /** Build and return the manifest object */
  build(): ManifestV3 {
    return structuredClone(this.manifest);
  }

  /** Build and return JSON string */
  toJSON(pretty = true): string {
    return JSON.stringify(this.manifest, null, pretty ? 2 : undefined);
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create a typical extension manifest with sensible defaults.
 *
 * @example
 * ```ts
 * const manifest = createManifest({
 *   name: "My Extension",
 *   version: "1.0.0",
 *   description: "Does cool things",
 * });
 * ```
 */
export function createManifest(options: ManifestBuilderOptions): ManifestBuilder {
  return new ManifestBuilder(options);
}
