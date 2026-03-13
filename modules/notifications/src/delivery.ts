/**
 * Delivery tracking and retry management.
 *
 * Tracks the lifecycle of every notification: pending → sent → delivered → read.
 * Provides retry logic with exponential backoff and delivery analytics.
 */

import type {
  DeliveryEvent,
  Notification,
  NotificationChannel,
  NotificationStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Delivery Tracker
// ---------------------------------------------------------------------------

export class DeliveryTracker {
  /** All notifications indexed by ID. */
  private readonly notifications = new Map<string, Notification>();
  /** Append-only event log for analytics. */
  private readonly events: DeliveryEvent[] = [];
  /** Base delay for exponential backoff (ms). */
  private readonly baseRetryDelay: number;
  /** Maximum retry attempts. */
  private readonly maxRetries: number;

  constructor(options?: { baseRetryDelayMs?: number; maxRetries?: number }) {
    this.baseRetryDelay = options?.baseRetryDelayMs ?? 1000;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  // -----------------------------------------------------------------------
  // Track
  // -----------------------------------------------------------------------

  /** Register a notification for tracking. */
  track(notification: Notification): void {
    this.notifications.set(notification.id, { ...notification });
    this.recordEvent(notification.id, notification.channel, "pending");
  }

  /** Mark a notification as sent. */
  markSent(notificationId: string, messageId?: string): void {
    const n = this.getOrThrow(notificationId);
    n.status = "sent";
    n.sentAt = new Date();
    if (messageId) {
      // Store messageId in data for provider-level tracking
      n.data = { ...n.data, _messageId: messageId };
    }
    this.notifications.set(notificationId, n);
    this.recordEvent(notificationId, n.channel, "sent");
  }

  /** Mark a notification as delivered (confirmed receipt). */
  markDelivered(notificationId: string): void {
    const n = this.getOrThrow(notificationId);
    n.status = "delivered";
    n.deliveredAt = new Date();
    this.notifications.set(notificationId, n);
    this.recordEvent(notificationId, n.channel, "delivered");
  }

  /** Mark a notification as read. */
  markRead(notificationId: string): void {
    const n = this.getOrThrow(notificationId);
    n.status = "read";
    n.readAt = new Date();
    this.notifications.set(notificationId, n);
    this.recordEvent(notificationId, n.channel, "read");
  }

  /** Mark a notification as failed. */
  markFailed(notificationId: string, error: string): void {
    const n = this.getOrThrow(notificationId);
    n.status = "failed";
    n.attempts += 1;
    this.notifications.set(notificationId, n);
    this.recordEvent(notificationId, n.channel, "failed", error);
  }

  // -----------------------------------------------------------------------
  // Retry
  // -----------------------------------------------------------------------

  /**
   * Should this notification be retried?
   * Returns true if it has failed and hasn't exceeded max retries.
   */
  shouldRetry(notificationId: string): boolean {
    const n = this.notifications.get(notificationId);
    if (!n) return false;
    return n.status === "failed" && n.attempts < this.maxRetries;
  }

  /**
   * Calculate the delay before the next retry (exponential backoff).
   * Returns milliseconds.
   */
  getRetryDelay(notificationId: string): number {
    const n = this.notifications.get(notificationId);
    if (!n) return this.baseRetryDelay;
    // Exponential backoff: base * 2^(attempts-1)
    return this.baseRetryDelay * Math.pow(2, Math.max(0, n.attempts - 1));
  }

  /**
   * Get all notifications that should be retried.
   * Returns notification copies (won't mutate internal state).
   */
  getPendingRetries(): Notification[] {
    const retries: Notification[] = [];
    for (const n of this.notifications.values()) {
      if (n.status === "failed" && n.attempts < this.maxRetries) {
        retries.push({ ...n, status: "pending" });
      }
    }
    return retries;
  }

  /**
   * Reset a failed notification back to pending for retry.
   */
  resetForRetry(notificationId: string): void {
    const n = this.getOrThrow(notificationId);
    n.status = "pending";
    this.notifications.set(notificationId, n);
    this.recordEvent(notificationId, n.channel, "pending");
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /** Get a notification by ID. */
  get(notificationId: string): Notification | undefined {
    const n = this.notifications.get(notificationId);
    return n ? { ...n } : undefined;
  }

  /** Get all notifications for a user. */
  getByUser(userId: string): Notification[] {
    const results: Notification[] = [];
    for (const n of this.notifications.values()) {
      if (n.userId === userId) results.push({ ...n });
    }
    return results;
  }

  /** Get the full event log. */
  getEvents(): DeliveryEvent[] {
    return [...this.events];
  }

  // -----------------------------------------------------------------------
  // Analytics
  // -----------------------------------------------------------------------

  /**
   * Compute delivery analytics, optionally filtered by channel.
   */
  getAnalytics(channel?: NotificationChannel): {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    read: number;
    deliveryRate: number;
    readRate: number;
  } {
    let total = 0;
    let sent = 0;
    let delivered = 0;
    let failed = 0;
    let read = 0;

    for (const n of this.notifications.values()) {
      if (channel && n.channel !== channel) continue;
      total++;
      switch (n.status) {
        case "sent":
          sent++;
          break;
        case "delivered":
          delivered++;
          break;
        case "failed":
          failed++;
          break;
        case "read":
          read++;
          break;
        // "pending" counted in total only
      }
    }

    // Delivery rate = (delivered + read) / total
    const successCount = delivered + read;
    const deliveryRate = total > 0 ? successCount / total : 0;
    // Read rate = read / (delivered + read)
    const readRate = successCount > 0 ? read / successCount : 0;

    return { total, sent, delivered, failed, read, deliveryRate, readRate };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private getOrThrow(notificationId: string): Notification {
    const n = this.notifications.get(notificationId);
    if (!n) {
      throw new Error(`Notification not found: ${notificationId}`);
    }
    return n;
  }

  private recordEvent(
    notificationId: string,
    channel: NotificationChannel,
    status: NotificationStatus,
    error?: string,
  ): void {
    this.events.push({
      notificationId,
      channel,
      status,
      timestamp: new Date(),
      error,
    });
  }
}
