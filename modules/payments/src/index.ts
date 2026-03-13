// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  PaymentStatus,
  SubscriptionStatus,
  PlanInterval,
  Plan,
  Charge,
  Refund,
  Subscription,
  WebhookEventType,
  WebhookEvent,
  PaymentConfig,
  CreateChargeParams,
  CreateSubscriptionParams,
  UpdateSubscriptionParams,
  RefundChargeParams,
  PaymentProvider,
} from "./types.js";

// ─── Provider ────────────────────────────────────────────────────────────────
export {
  MockPaymentProvider,
  PaymentError,
  ChargeNotFoundError,
  SubscriptionNotFoundError,
  createPaymentProvider,
} from "./provider.js";

// ─── Webhooks ────────────────────────────────────────────────────────────────
export type {
  WebhookHandlerOptions,
  WebhookHandlerFn,
  WebhookProcessor,
} from "./webhook.js";
export {
  createWebhookProcessor,
  computeWebhookSignature,
  verifyWebhookSignature,
  WebhookVerificationError,
  WebhookDuplicateError,
} from "./webhook.js";

// ─── Subscriptions ──────────────────────────────────────────────────────────
export type {
  CreateSubscriptionOptions,
  ProrationResult,
} from "./subscription.js";
export {
  createSubscriptionRecord,
  calculateProration,
  cancelSubscription,
  reactivateSubscription,
  transitionSubscription,
  applyGracePeriod,
  changePlan,
  isValidTransition,
  assertValidTransition,
  InvalidTransitionError,
} from "./subscription.js";

// ─── Idempotency ────────────────────────────────────────────────────────────
export type { IdempotencyStoreOptions } from "./idempotency.js";
export {
  IdempotencyStore,
  generateIdempotencyKey,
  idempotent,
} from "./idempotency.js";
