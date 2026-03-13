/**
 * modules/notifications — Multi-channel notification system.
 *
 * Public API surface:
 *   - NotificationDispatcher  — send, digest, retry
 *   - PreferenceManager       — user preference CRUD & checks
 *   - DeliveryTracker         — delivery lifecycle & analytics
 *   - Template helpers        — render, validate, preview
 *   - Mock providers          — for testing without real services
 *   - All types               — full TypeScript definitions
 */

// Core orchestration
export { NotificationDispatcher, resetIdCounter } from "./dispatcher.js";
export type { DispatchResult } from "./dispatcher.js";

// Template engine
export {
  renderTemplate,
  extractVariables,
  validateTemplate,
  previewTemplate,
} from "./template.js";

// User preferences
export { PreferenceManager, InMemoryPreferenceStore } from "./preferences.js";
export type { PreferenceStore } from "./preferences.js";

// Delivery tracking
export { DeliveryTracker } from "./delivery.js";

// Mock providers (re-export for convenience)
export {
  MockProvider,
  createMockProviders,
  createMockEmailProvider,
  createMockSmsProvider,
  createMockPushProvider,
  createMockInAppProvider,
} from "./providers/mock.js";
export type { SentRecord } from "./providers/mock.js";

// Types
export type {
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
  SendResult,
  ChannelProvider,
  Notification,
  Template,
  QuietHours,
  ChannelPreference,
  UserPreferences,
  NotificationConfig,
  SendRequest,
  DeliveryEvent,
} from "./types.js";
