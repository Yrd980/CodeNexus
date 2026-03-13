/**
 * Auth configuration pattern for a SaaS application.
 *
 * Why centralize auth config?
 * - Auth touches middleware, API routes, and components — one source of truth prevents drift
 * - Protected routes are defined declaratively, not scattered across middleware checks
 * - Session config is separate from the auth provider, making it easy to swap providers
 */

// ─── Types ──────────────────────────────────────────────────

export interface SessionConfig {
  /** How long until the session expires (in seconds) */
  maxAge: number;
  /** How often to refresh the session (in seconds) */
  updateAge: number;
  /** Cookie name for the session token */
  cookieName: string;
  /** Whether the cookie requires HTTPS */
  secure: boolean;
}

export interface OAuthProviderConfig {
  id: string;
  name: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  scopes: string[];
}

export interface AuthConfig {
  session: SessionConfig;
  providers: OAuthProviderConfig[];
  protectedRoutes: string[];
  publicRoutes: string[];
  loginPath: string;
  afterLoginPath: string;
  afterLogoutPath: string;
}

// ─── Default Config ─────────────────────────────────────────

/**
 * Session defaults: 30-day sessions, refreshed every 24h.
 *
 * Why 30 days? SaaS users expect to stay logged in.
 * Why refresh every 24h? Balance between security and UX.
 */
const defaultSessionConfig: SessionConfig = {
  maxAge: 30 * 24 * 60 * 60, // 30 days
  updateAge: 24 * 60 * 60, // 24 hours
  cookieName: "session-token",
  secure: true,
};

/**
 * OAuth provider definitions.
 *
 * Pattern: Reference env vars by name, don't read them here.
 * This keeps config pure and testable.
 */
const defaultProviders: OAuthProviderConfig[] = [
  {
    id: "google",
    name: "Google",
    clientIdEnvVar: "GOOGLE_CLIENT_ID",
    clientSecretEnvVar: "GOOGLE_CLIENT_SECRET",
    scopes: ["openid", "email", "profile"],
  },
  {
    id: "github",
    name: "GitHub",
    clientIdEnvVar: "GITHUB_CLIENT_ID",
    clientSecretEnvVar: "GITHUB_CLIENT_SECRET",
    scopes: ["read:user", "user:email"],
  },
];

/**
 * Protected routes: any path starting with these prefixes requires auth.
 *
 * Why prefix matching instead of exact paths?
 * - SaaS dashboards have many nested routes — listing them all is fragile
 * - New pages under /dashboard/* are protected automatically
 * - Public routes take precedence for exceptions (e.g., /api/webhooks)
 */
const defaultProtectedRoutes = [
  "/dashboard",
  "/settings",
  "/api/v1",
  "/billing",
];

/**
 * Public routes: these paths are accessible without auth,
 * even if they fall under a protected prefix.
 *
 * Common examples: webhook endpoints, health checks, public APIs.
 */
const defaultPublicRoutes = [
  "/",
  "/login",
  "/signup",
  "/api/webhooks",
  "/api/health",
  "/pricing",
  "/docs",
];

// ─── Config Builder ─────────────────────────────────────────

const defaultAuthConfig: AuthConfig = {
  session: defaultSessionConfig,
  providers: defaultProviders,
  protectedRoutes: defaultProtectedRoutes,
  publicRoutes: defaultPublicRoutes,
  loginPath: "/login",
  afterLoginPath: "/dashboard",
  afterLogoutPath: "/",
};

/**
 * Build the auth config with optional overrides.
 * Merge pattern: spread defaults, then overrides.
 */
export function getAuthConfig(
  overrides?: Partial<AuthConfig>
): AuthConfig {
  if (!overrides) return defaultAuthConfig;

  return {
    ...defaultAuthConfig,
    ...overrides,
    session: {
      ...defaultAuthConfig.session,
      ...(overrides.session ?? {}),
    },
  };
}

/**
 * Check if a given path is protected.
 *
 * Logic: A path is protected if it matches any protected prefix
 * AND does not match any public route prefix.
 * Public routes always win — this prevents accidentally locking
 * out webhook endpoints that live under /api.
 */
export function isProtectedRoute(
  path: string,
  config?: AuthConfig
): boolean {
  const { protectedRoutes, publicRoutes } = config ?? defaultAuthConfig;

  // Public routes take precedence
  const isPublic = publicRoutes.some(
    (route) => path === route || path.startsWith(route + "/")
  );
  if (isPublic) return false;

  return protectedRoutes.some(
    (route) => path === route || path.startsWith(route + "/")
  );
}

/**
 * Get the OAuth provider config by ID.
 */
export function getProviderConfig(
  providerId: string,
  config?: AuthConfig
): OAuthProviderConfig | undefined {
  const { providers } = config ?? defaultAuthConfig;
  return providers.find((p) => p.id === providerId);
}
