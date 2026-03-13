import { beforeEach, describe, expect, it } from "vitest";
import {
  NotificationDispatcher,
  resetIdCounter,
} from "../src/dispatcher.js";
import { createMockProviders } from "../src/providers/mock.js";
import type { MockProvider } from "../src/providers/mock.js";
import type {
  NotificationChannel,
  NotificationConfig,
  Template,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTemplate(
  overrides: Partial<Template> = {},
): Template {
  return {
    id: "welcome",
    name: "Welcome",
    channel: "email",
    subject: "Welcome {{name}}",
    body: "Hello {{name}}, welcome to {{app}}!",
    ...overrides,
  };
}

function makeConfig(
  providers: Record<NotificationChannel, MockProvider>,
  templates: Template[] = [makeTemplate()],
): NotificationConfig {
  const templateMap: Record<string, Template> = {};
  for (const t of templates) {
    templateMap[t.id] = t;
  }
  return {
    providers,
    defaultFrom: "test@example.com",
    templates: templateMap,
    defaultRateLimitPerHour: 0,
    retryDelayMs: 100,
    maxRetries: 3,
  };
}

describe("NotificationDispatcher", () => {
  let providers: Record<NotificationChannel, MockProvider>;
  let dispatcher: NotificationDispatcher;

  beforeEach(() => {
    resetIdCounter();
    providers = createMockProviders();
    dispatcher = new NotificationDispatcher(
      makeConfig(providers),
    );
  });

  // -----------------------------------------------------------------------
  // Basic sending
  // -----------------------------------------------------------------------

  describe("send", () => {
    it("sends to the template's default channel", async () => {
      const results = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });

      expect(results).toHaveLength(1);
      expect(results[0].result.success).toBe(true);
      expect(results[0].channel).toBe("email");
      expect(providers.email.sent).toHaveLength(1);
      expect(providers.email.sent[0].notification.body).toBe(
        "Hello Alice, welcome to MyApp!",
      );
    });

    it("throws for unknown template", async () => {
      await expect(
        dispatcher.send({
          userId: "u1",
          templateId: "nonexistent",
          data: {},
        }),
      ).rejects.toThrow("Template not found");
    });

    it("throws for missing template variables", async () => {
      await expect(
        dispatcher.send({
          userId: "u1",
          templateId: "welcome",
          data: { name: "Alice" }, // missing 'app'
        }),
      ).rejects.toThrow("Missing template variables: app");
    });
  });

  // -----------------------------------------------------------------------
  // Multi-channel
  // -----------------------------------------------------------------------

  describe("multi-channel", () => {
    it("sends to multiple channels when specified", async () => {
      const results = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
        channels: ["email", "push"],
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.result.success)).toBe(true);
      expect(providers.email.sent).toHaveLength(1);
      expect(providers.push.sent).toHaveLength(1);
    });

    it("fails gracefully when provider is missing for a channel", async () => {
      const limitedProviders = createMockProviders();
      const config = makeConfig(limitedProviders);
      // Remove SMS provider
      delete config.providers.sms;
      const d = new NotificationDispatcher(config);

      const results = await d.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
        channels: ["email", "sms"],
      });

      expect(results).toHaveLength(2);
      expect(results[0].result.success).toBe(true); // email
      expect(results[1].result.success).toBe(false); // sms
      expect(results[1].result.error).toContain("No provider");
    });
  });

  // -----------------------------------------------------------------------
  // Priority & preferences
  // -----------------------------------------------------------------------

  describe("priority and preferences", () => {
    it("suppresses notifications when channel is disabled", async () => {
      dispatcher.preferences.setChannelPreference(
        "u1",
        "welcome",
        "email",
        { enabled: false },
      );

      const results = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });

      expect(results[0].result.success).toBe(false);
      expect(results[0].result.error).toContain("channel_disabled");
      expect(providers.email.sent).toHaveLength(0);
    });

    it("suppresses during quiet hours for normal priority", async () => {
      dispatcher.preferences.setQuietHours("u1", {
        startHour: 0,
        endHour: 23, // basically all day
        timezone: "UTC",
      });

      const results = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
        priority: "normal",
      });

      expect(results[0].result.success).toBe(false);
      expect(results[0].result.error).toContain("quiet_hours");
    });

    it("delivers urgent notifications even during quiet hours", async () => {
      dispatcher.preferences.setQuietHours("u1", {
        startHour: 0,
        endHour: 23,
        timezone: "UTC",
      });

      const results = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
        priority: "urgent",
      });

      expect(results[0].result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiting
  // -----------------------------------------------------------------------

  describe("rate limiting", () => {
    it("suppresses when frequency cap exceeded", async () => {
      dispatcher.preferences.setFrequencyCap("u1", 1);

      // First send — succeeds
      const first = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });
      expect(first[0].result.success).toBe(true);

      // Second send — suppressed
      const second = await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });
      expect(second[0].result.success).toBe(false);
      expect(second[0].result.error).toContain("frequency_cap");
    });
  });

  // -----------------------------------------------------------------------
  // Delivery tracking
  // -----------------------------------------------------------------------

  describe("delivery tracking", () => {
    it("tracks sent notifications in the tracker", async () => {
      await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });

      const stats = dispatcher.tracker.getAnalytics();
      expect(stats.total).toBe(1);
      expect(stats.sent).toBe(1);
    });

    it("tracks failures from provider errors", async () => {
      providers.email.failWith = "SMTP error";

      await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });

      const stats = dispatcher.tracker.getAnalytics();
      expect(stats.failed).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Batch / digest
  // -----------------------------------------------------------------------

  describe("batch digest", () => {
    it("aggregates and sends digest", async () => {
      const digestTemplate = makeTemplate({
        id: "digest",
        name: "Digest",
        subject: "You have {{count}} updates",
        body: "Updates: {{count}}",
      });

      const config = makeConfig(providers, [
        makeTemplate(),
        digestTemplate,
      ]);
      const d = new NotificationDispatcher(config);

      // Accumulate
      d.addToDigest({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
        groupKey: "daily",
      });
      d.addToDigest({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Bob", app: "MyApp" },
        groupKey: "daily",
      });

      // Flush
      const results = await d.flushDigest("digest");

      expect(results).toHaveLength(1);
      expect(results[0].result.success).toBe(true);
      // The digest template receives count
      const sent = providers.email.sent[0];
      expect(sent.notification.body).toContain("2");
    });
  });

  // -----------------------------------------------------------------------
  // Retry
  // -----------------------------------------------------------------------

  describe("retry", () => {
    it("retries failed notifications", async () => {
      providers.email.failWith = "timeout";

      // Initial send fails
      await dispatcher.send({
        userId: "u1",
        templateId: "welcome",
        data: { name: "Alice", app: "MyApp" },
      });

      // Fix provider
      providers.email.failWith = null;

      // Retry
      const retryResults = await dispatcher.retryFailed();
      expect(retryResults).toHaveLength(1);
      expect(retryResults[0].result.success).toBe(true);
    });
  });
});
