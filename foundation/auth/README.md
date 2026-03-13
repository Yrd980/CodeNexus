# Auth — JWT Authentication with Refresh Token Rotation

## 解决什么问题

Every startup needs authentication on day 1, but rolling your own JWT auth is error-prone. Common mistakes: storing secrets in code, no token rotation, no reuse detection, bcrypt compilation failures in CI, framework lock-in.

This module gives you a secure, minimal, framework-agnostic auth foundation that you can drop into any Node.js/Edge project. One runtime dependency (`jose`), zero native bindings.

## 为什么这样设计

### JWT Access + Rotating Refresh Tokens

Stateless JWT access tokens are fast (no DB lookup per request), but they can't be revoked once issued. Pure stateless auth is dangerous — if a token leaks, you can't invalidate it.

Our hybrid approach:
- **Access tokens**: Short-lived JWTs (15 min default). Stateless, fast to verify.
- **Refresh tokens**: Long-lived opaque strings stored server-side. Revocable.
- **Token rotation**: Each refresh token is single-use. Using it produces a new one. If a used token is presented again, the entire token family is invalidated (reuse detection per OWASP guidelines).

This gives you the speed of stateless auth with the security of revocable sessions.

### jose over jsonwebtoken

`jsonwebtoken` uses Node.js `crypto` module and doesn't work on edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy). `jose` uses the Web Crypto API, making it portable across all JavaScript runtimes.

### scrypt over bcrypt/argon2

`bcrypt` requires native compilation via `node-gyp`, which fails in Docker Alpine, breaks in CI, and adds complexity. `argon2` also needs a native addon. `scrypt` is built into Node.js — zero native dependencies, memory-hard (GPU-resistant), and recommended by OWASP.

### Pluggable Token Store

Production needs Redis or a database. Development needs in-memory. The `TokenStore` interface lets you swap storage without changing any auth logic.

### Framework-agnostic

Express, Fastify, Hono, Koa — every framework has different middleware signatures. Instead of coupling to one, we provide pure functions. You write a 3-line adapter for your framework.

## 快速使用

### Installation

```bash
cd foundation/auth
npm install
```

### Basic Setup

```typescript
import {
  createAuthConfig,
  createSession,
  refreshSession,
  authenticate,
  hashPassword,
  verifyPassword,
  MemoryTokenStore,
} from "@codenexus/auth";

// 1. Configure (all secrets from environment)
const config = createAuthConfig({
  issuer: "myapp",
  secret: process.env.AUTH_SECRET!, // min 32 chars
});

// 2. Create a token store (use Redis in production)
const store = new MemoryTokenStore();
```

### Register a User

```typescript
const passwordHash = await hashPassword(userInput.password);
// Save passwordHash to your database
```

### Login

```typescript
// Verify password
const isValid = await verifyPassword(userInput.password, storedHash);
if (!isValid) throw new Error("Invalid credentials");

// Create session
const session = await createSession(
  { id: user.id, roles: user.roles },
  config,
  store,
);

// Send to client:
// - session.accessToken.token (in response body or httpOnly cookie)
// - session.refreshToken.token (in httpOnly cookie, secure, sameSite: strict)
```

### Authenticate Requests

```typescript
const result = await authenticate(
  { authorizationHeader: req.headers.authorization },
  config,
);
// result.user.id, result.user.roles
```

### Refresh Tokens

```typescript
const newSession = await refreshSession(
  refreshTokenFromCookie,
  user.roles, // Re-fetch from DB for freshness
  config,
  store,
);
```

### Framework Adapters

**Express:**
```typescript
import { authenticate, AuthError } from "@codenexus/auth";

function authMiddleware(config) {
  return async (req, res, next) => {
    try {
      const result = await authenticate(
        { authorizationHeader: req.headers.authorization },
        config,
      );
      req.user = result.user;
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.code === "TOKEN_EXPIRED" ? 401 : 403).json({ error: err.code });
      } else {
        next(err);
      }
    }
  };
}
```

**Hono:**
```typescript
import { authenticate, AuthError } from "@codenexus/auth";

const authMiddleware = (config) => async (c, next) => {
  try {
    const result = await authenticate(
      { authorizationHeader: c.req.header("Authorization") },
      config,
    );
    c.set("user", result.user);
    await next();
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.code }, 401);
    }
    throw err;
  }
};
```

## 配置项

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `issuer` | `string` | *required* | JWT issuer claim (e.g., your app name or URL) |
| `secret` | `string` | *required* | HMAC signing key (minimum 32 characters) |
| `audience` | `string` | `"default"` | JWT audience claim |
| `accessTokenTTL` | `number` | `900` (15 min) | Access token lifetime in seconds |
| `refreshTokenTTL` | `number` | `2592000` (30 days) | Refresh token lifetime in seconds |
| `algorithm` | `string` | `"HS256"` | JWT signing algorithm (HS256/HS384/HS512) |
| `clockTolerance` | `number` | `5` | Clock skew tolerance in seconds |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Client App  │────▶│  Middleware   │────▶│  Your API   │
│              │◀────│  (stateless) │◀────│             │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    verify access token
                    (no DB hit)
                           │
┌─────────────┐     ┌──────┴───────┐     ┌─────────────┐
│   Client    │────▶│   Session    │────▶│ Token Store  │
│  (refresh)  │◀────│  (stateful)  │◀────│ (Redis/DB)   │
└─────────────┘     └──────────────┘     └─────────────┘
```

## 来源 & 致谢

- [lucia-auth](https://lucia-auth.com/) — Session-based design with pluggable storage
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html) — Refresh token rotation and reuse detection
- [jose](https://github.com/panva/jose) — Edge-compatible JWT library

## 认知变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-03-13 | Initial module creation | Every startup needs auth day 1. Synthesized best practices from lucia-auth, OWASP, and real-world production deployments into a minimal, runnable module. |
