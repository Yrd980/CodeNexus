/**
 * Notification Dispatcher — the central orchestration layer.
 *
 * Responsibilities:
 *  1. Resolve template → render subject + body
 *  2. Check user preferences (channel enabled, quiet hours, frequency cap)
 *  3. Route to the correct channel provider
 *  4. Track delivery status
 *  5. Support multi-channel delivery and batch/digest mode
 */

import { DeliveryTracker } from "./delivery.js";
import { PreferenceManager } from "./preferences.js";
import { renderTemplate, validateTemplate } from "./template.js";
import type {
  Notification,
  NotificationChannel,
  NotificationConfig,
  NotificationPriority,
  SendRequest,
  SendResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let idSeq = 0;

function generateId(): string {
  idSeq++;
  return `notif-${Date.now()}-${idSeq}`;
}

/** Reset ID counter (for deterministic tests). */
export function resetIdCounter(): void {
  idSeq = 0;
}

// ---------------------------------------------------------------------------
// Send result per channel
// ---------------------------------------------------------------------------

export interface DispatchResult {
  notificationId: string;
  channel: NotificationChannel;
  result: SendResult;
}

// ---------------------------------------------------------------------------
// Batch / digest accumulator
// ---------------------------------------------------------------------------

interface PendingDigest {
  userId: string;
  templateId: string;
  channel: NotificationChannel;
  items: Record<string, unknown>[];
  priority: NotificationPriority;
  groupKey: string;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export class NotificationDispatcher {
  private readonly config: NotificationConfig;
  readonly tracker: DeliveryTracker;
  readonly preferences: PreferenceManager;

  /**
   * Pending digest batches, keyed by `${userId}:${groupKey}:${channel}`.
   */
  private readonly digestBatches = new Map<string, PendingDigest>();

  constructor(
    config: NotificationConfig,
    tracker?: DeliveryTracker,
    preferences?: PreferenceManager,
  ) {
    this.config = config;
    this.tracker = tracker ?? new DeliveryTracker({
      baseRetryDelayMs: config.retryDelayMs,
      maxRetries: config.maxRetries,
    });
    this.preferences = preferences ?? new PreferenceManager();
  }

  // -----------------------------------------------------------------------
  // Send
  // -----------------------------------------------------------------------

  /**
   * Send a notification to a user.
   *
   * Steps:
   *  1. Resolve template
   *  2. Determine target channels
   *  3. For each channel: check preferences → render → deliver → track
   *
   * Returns one `DispatchResult` per channel attempted.
   */
  async send(request: SendRequest): Promise<DispatchResult[]> {
    const template = this.config.templates[request.templateId];
    if (!template) {
      throw new Error(`Template not found: ${request.templateId}`);
    }

    // Validate template data
    const missing = validateTemplate(template, request.data);
    if (missing.length > 0) {
      throw new Error(
        `Missing template variables: ${missing.join(", ")}`,
      );
    }

    const priority = request.priority ?? "normal";
    const channels = request.channels ?? [template.channel];

    const results: DispatchResult[] = [];

    for (const channel of channels) {
      const result = await this.sendToChannel(
        request,
        channel,
        priority,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Add a notification to a digest batch instead of sending immediately.
   * Call `flushDigest` to send the aggregated batch.
   */
  addToDigest(request: SendRequest): void {
    const priority = request.priority ?? "normal";
    const groupKey = request.groupKey ?? "default";
    const template = this.config.templates[request.templateId];
    if (!template) {
      throw new Error(`Template not found: ${request.templateId}`);
    }

    const channels = request.channels ?? [template.channel];

    for (const channel of channels) {
      const key = `${request.userId}:${groupKey}:${channel}`;
      const existing = this.digestBatches.get(key);

      if (existing) {
        existing.items.push(request.data);
        // Escalate priority if any item is higher
        if (priorityValue(priority) > priorityValue(existing.priority)) {
          existing.priority = priority;
        }
      } else {
        this.digestBatches.set(key, {
          userId: request.userId,
          templateId: request.templateId,
          channel,
          items: [request.data],
          priority,
          groupKey,
        });
      }
    }
  }

  /**
   * Flush all pending digest batches.
   *
   * The digest template receives `{ items: [...], count: N }` as data,
   * where each item is the original `data` from `addToDigest`.
   */
  async flushDigest(
    digestTemplateId: string,
  ): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];

    for (const [key, batch] of this.digestBatches) {
      const digestData: Record<string, unknown> = {
        items: batch.items,
        count: batch.items.length,
      };

      const result = await this.sendToChannel(
        {
          userId: batch.userId,
          templateId: digestTemplateId,
          data: digestData,
          channels: [batch.channel],
          priority: batch.priority,
          groupKey: batch.groupKey,
        },
        batch.channel,
        batch.priority,
      );

      results.push(result);
      this.digestBatches.delete(key);
    }

    return results;
  }

  /**
   * Retry all failed notifications that haven't exceeded max retries.
   */
  async retryFailed(): Promise<DispatchResult[]> {
    const pending = this.tracker.getPendingRetries();
    const results: DispatchResult[] = [];

    for (const notification of pending) {
      this.tracker.resetForRetry(notification.id);

      const provider = this.config.providers[notification.channel];
      if (!provider) continue;

      const sendResult = await provider.send(notification);

      if (sendResult.success) {
        this.tracker.markSent(notification.id, sendResult.messageId);
      } else {
        this.tracker.markFailed(
          notification.id,
          sendResult.error ?? "Unknown error",
        );
      }

      results.push({
        notificationId: notification.id,
        channel: notification.channel,
        result: sendResult,
      });
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async sendToChannel(
    request: SendRequest,
    channel: NotificationChannel,
    priority: NotificationPriority,
  ): Promise<DispatchResult> {
    const notificationId = generateId();

    // Check user preferences
    const suppression = this.preferences.shouldSuppress(
      request.userId,
      request.templateId,
      channel,
      priority,
    );

    if (suppression.suppressed) {
      const notification = this.buildNotification(
        notificationId,
        request,
        channel,
        priority,
      );
      this.tracker.track(notification);
      this.tracker.markFailed(notificationId, `Suppressed: ${suppression.reason}`);
      return {
        notificationId,
        channel,
        result: {
          success: false,
          error: `Suppressed: ${suppression.reason}`,
        },
      };
    }

    // Check provider exists
    const provider = this.config.providers[channel];
    if (!provider) {
      const notification = this.buildNotification(
        notificationId,
        request,
        channel,
        priority,
      );
      this.tracker.track(notification);
      this.tracker.markFailed(notificationId, `No provider for channel: ${channel}`);
      return {
        notificationId,
        channel,
        result: {
          success: false,
          error: `No provider for channel: ${channel}`,
        },
      };
    }

    // Render template (already validated in send(), safe to assert)
    const template = this.config.templates[request.templateId]!;
    const subject = renderTemplate(
      template.subject,
      request.data,
      channel,
    );
    const body = renderTemplate(template.body, request.data, channel);

    const notification = this.buildNotification(
      notificationId,
      request,
      channel,
      priority,
      subject,
      body,
    );

    // Track and send
    this.tracker.track(notification);

    const sendResult = await provider.send(notification);

    if (sendResult.success) {
      this.tracker.markSent(notificationId, sendResult.messageId);
      this.preferences.recordSend(request.userId);
    } else {
      this.tracker.markFailed(
        notificationId,
        sendResult.error ?? "Unknown error",
      );
    }

    return { notificationId, channel, result: sendResult };
  }

  private buildNotification(
    id: string,
    request: SendRequest,
    channel: NotificationChannel,
    priority: NotificationPriority,
    subject?: string,
    body?: string,
  ): Notification {
    return {
      id,
      userId: request.userId,
      channel,
      templateId: request.templateId,
      data: request.data,
      subject,
      body,
      status: "pending",
      priority,
      attempts: 0,
      groupKey: request.groupKey,
      createdAt: new Date(),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function priorityValue(p: NotificationPriority): number {
  const map: Record<NotificationPriority, number> = {
    low: 0,
    normal: 1,
    high: 2,
    urgent: 3,
  };
  return map[p];
}
