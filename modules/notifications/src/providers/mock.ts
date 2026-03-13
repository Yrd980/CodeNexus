/**
 * Mock channel providers for testing.
 *
 * Each provider records sent notifications in memory so tests can assert
 * on delivery behavior without hitting real APIs.
 */

import type {
  ChannelProvider,
  Notification,
  NotificationChannel,
  SendResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Sent record (for test assertions)
// ---------------------------------------------------------------------------

export interface SentRecord {
  notification: Notification;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Base mock provider
// ---------------------------------------------------------------------------

export class MockProvider implements ChannelProvider {
  readonly channel: NotificationChannel;
  /** All notifications this provider has attempted to send. */
  readonly sent: SentRecord[] = [];
  /** If set, the provider will simulate failure with this message. */
  failWith: string | null = null;
  /** Artificial latency in ms (default 0). */
  latencyMs = 0;

  private idCounter = 0;

  constructor(channel: NotificationChannel) {
    this.channel = channel;
  }

  async send(notification: Notification): Promise<SendResult> {
    if (this.latencyMs > 0) {
      await delay(this.latencyMs);
    }

    if (this.failWith) {
      this.sent.push({ notification, timestamp: new Date() });
      return { success: false, error: this.failWith };
    }

    this.idCounter++;
    const messageId = `${this.channel}-msg-${this.idCounter}`;
    this.sent.push({ notification, timestamp: new Date() });
    return { success: true, messageId };
  }

  /** Clear sent history. */
  reset(): void {
    this.sent.length = 0;
    this.failWith = null;
    this.latencyMs = 0;
    this.idCounter = 0;
  }
}

// ---------------------------------------------------------------------------
// Convenience factories
// ---------------------------------------------------------------------------

export function createMockEmailProvider(): MockProvider {
  return new MockProvider("email");
}

export function createMockSmsProvider(): MockProvider {
  return new MockProvider("sms");
}

export function createMockPushProvider(): MockProvider {
  return new MockProvider("push");
}

export function createMockInAppProvider(): MockProvider {
  return new MockProvider("in_app");
}

/**
 * Create a full set of mock providers for all channels.
 * Returns a record keyed by channel name.
 */
export function createMockProviders(): Record<NotificationChannel, MockProvider> {
  return {
    email: createMockEmailProvider(),
    sms: createMockSmsProvider(),
    push: createMockPushProvider(),
    in_app: createMockInAppProvider(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
