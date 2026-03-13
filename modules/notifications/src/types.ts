/**
 * Notification system type definitions.
 *
 * Defines the core abstractions: channels, providers, templates,
 * user preferences, and notification lifecycle states.
 */

// ---------------------------------------------------------------------------
// Channels & Status
// ---------------------------------------------------------------------------

/** Supported delivery channels. */
export type NotificationChannel = "email" | "sms" | "push" | "in_app";

/** Lifecycle status of a single notification delivery. */
export type NotificationStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "read";

/** Priority level — "urgent" bypasses quiet hours. */
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Result returned by a channel provider after attempting delivery. */
export interface SendResult {
  success: boolean;
  /** Provider-specific message ID (for delivery tracking). */
  messageId?: string;
  error?: string;
}

/**
 * A channel provider handles actual delivery for one channel type.
 * Swap implementations for different vendors (SendGrid, Twilio, etc.).
 */
export interface ChannelProvider {
  readonly channel: NotificationChannel;
  send(notification: Notification): Promise<SendResult>;
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/** A single notification to be delivered. */
export interface Notification {
  id: string;
  userId: string;
  channel: NotificationChannel;
  /** Template ID used to render the notification content. */
  templateId: string;
  /** Data to interpolate into the template. */
  data: Record<string, unknown>;
  /** Rendered subject (populated after template rendering). */
  subject?: string;
  /** Rendered body (populated after template rendering). */
  body?: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  /** Number of delivery attempts so far. */
  attempts: number;
  /** Optional grouping key for batch/digest mode. */
  groupKey?: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** A notification template with channel-specific content. */
export interface Template {
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which channel this template targets. */
  channel: NotificationChannel;
  /** Subject line (primarily for email, also used for push title). */
  subject: string;
  /**
   * Body with Mustache-like placeholders:
   *   {{variable}}           — interpolation
   *   {{#if flag}}...{{/if}} — conditional
   *   {{#each items}}...{{/each}} — loop (current item as {{.}})
   */
  body: string;
}

// ---------------------------------------------------------------------------
// User Preferences
// ---------------------------------------------------------------------------

/** Quiet-hours window (e.g., 22:00 – 08:00). */
export interface QuietHours {
  /** Start hour in 24-h format (0–23). */
  startHour: number;
  /** End hour in 24-h format (0–23). */
  endHour: number;
  /** Timezone string, e.g. "America/New_York". */
  timezone: string;
}

/** Per-notification-type, per-channel toggle. */
export interface ChannelPreference {
  enabled: boolean;
}

/** User notification preferences. */
export interface UserPreferences {
  userId: string;
  /**
   * Map of notification type → channel → enabled.
   * Example: { "order_update": { "email": { enabled: true }, "sms": { enabled: false } } }
   */
  channels: Record<string, Record<NotificationChannel, ChannelPreference>>;
  /** Global quiet hours (overridden by urgent priority). */
  quietHours?: QuietHours;
  /** Max notifications per hour (0 = unlimited). */
  frequencyCap: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Top-level configuration for the notification system. */
export interface NotificationConfig {
  /** Registered channel providers keyed by channel. */
  providers: Partial<Record<NotificationChannel, ChannelProvider>>;
  /** Default sender identity (e.g., email address or app name). */
  defaultFrom: string;
  /** Available templates keyed by template ID. */
  templates: Record<string, Template>;
  /** Global rate limit: max sends per user per hour (0 = unlimited). */
  defaultRateLimitPerHour: number;
  /** How long (ms) before retrying a failed delivery. */
  retryDelayMs: number;
  /** Maximum retry attempts for failed deliveries. */
  maxRetries: number;
}

// ---------------------------------------------------------------------------
// Send Request (public API input)
// ---------------------------------------------------------------------------

/** Input to the dispatcher's `send` method. */
export interface SendRequest {
  userId: string;
  templateId: string;
  /** Data for template interpolation. */
  data: Record<string, unknown>;
  /** Override channels (defaults to all channels the template supports). */
  channels?: NotificationChannel[];
  priority?: NotificationPriority;
  /** Grouping key for batch/digest mode. */
  groupKey?: string;
}

// ---------------------------------------------------------------------------
// Delivery Record (for analytics)
// ---------------------------------------------------------------------------

/** Immutable record of a delivery event. */
export interface DeliveryEvent {
  notificationId: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  timestamp: Date;
  error?: string;
}
