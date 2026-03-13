import { beforeEach, describe, expect, it } from "vitest";
import { DeliveryTracker } from "../src/delivery.js";
import type { Notification } from "../src/types.js";

function makeNotification(
  overrides: Partial<Notification> = {},
): Notification {
  return {
    id: overrides.id ?? "n1",
    userId: "user1",
    channel: "email",
    templateId: "welcome",
    data: {},
    status: "pending",
    priority: "normal",
    attempts: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("DeliveryTracker", () => {
  let tracker: DeliveryTracker;

  beforeEach(() => {
    tracker = new DeliveryTracker({
      baseRetryDelayMs: 100,
      maxRetries: 3,
    });
  });

  // -----------------------------------------------------------------------
  // Status tracking
  // -----------------------------------------------------------------------

  describe("status tracking", () => {
    it("tracks a notification as pending", () => {
      const n = makeNotification();
      tracker.track(n);
      const tracked = tracker.get("n1");
      expect(tracked?.status).toBe("pending");
    });

    it("marks sent with messageId", () => {
      tracker.track(makeNotification());
      tracker.markSent("n1", "msg-abc");
      const n = tracker.get("n1");
      expect(n?.status).toBe("sent");
      expect(n?.sentAt).toBeDefined();
      expect(n?.data._messageId).toBe("msg-abc");
    });

    it("marks delivered", () => {
      tracker.track(makeNotification());
      tracker.markSent("n1");
      tracker.markDelivered("n1");
      const n = tracker.get("n1");
      expect(n?.status).toBe("delivered");
      expect(n?.deliveredAt).toBeDefined();
    });

    it("marks read", () => {
      tracker.track(makeNotification());
      tracker.markSent("n1");
      tracker.markDelivered("n1");
      tracker.markRead("n1");
      const n = tracker.get("n1");
      expect(n?.status).toBe("read");
      expect(n?.readAt).toBeDefined();
    });

    it("marks failed and increments attempts", () => {
      tracker.track(makeNotification());
      tracker.markFailed("n1", "timeout");
      const n = tracker.get("n1");
      expect(n?.status).toBe("failed");
      expect(n?.attempts).toBe(1);
    });

    it("throws for unknown notification ID", () => {
      expect(() => tracker.markSent("nonexistent")).toThrow(
        "Notification not found",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Retry
  // -----------------------------------------------------------------------

  describe("retry logic", () => {
    it("shouldRetry returns true for failed within limit", () => {
      const n = makeNotification();
      tracker.track(n);
      tracker.markFailed("n1", "error");
      expect(tracker.shouldRetry("n1")).toBe(true);
    });

    it("shouldRetry returns false when max retries exceeded", () => {
      const n = makeNotification();
      tracker.track(n);
      tracker.markFailed("n1", "error");
      tracker.markFailed("n1", "error");
      tracker.markFailed("n1", "error");
      // 3 attempts = maxRetries
      expect(tracker.shouldRetry("n1")).toBe(false);
    });

    it("shouldRetry returns false for non-failed notifications", () => {
      tracker.track(makeNotification());
      tracker.markSent("n1");
      expect(tracker.shouldRetry("n1")).toBe(false);
    });

    it("calculates exponential backoff delay", () => {
      tracker.track(makeNotification());
      // First failure → attempt 1 → delay = 100 * 2^0 = 100
      tracker.markFailed("n1", "err");
      expect(tracker.getRetryDelay("n1")).toBe(100);

      // Second failure → attempt 2 → delay = 100 * 2^1 = 200
      tracker.markFailed("n1", "err");
      expect(tracker.getRetryDelay("n1")).toBe(200);
    });

    it("getPendingRetries returns failed notifications under limit", () => {
      tracker.track(makeNotification({ id: "n1" }));
      tracker.track(makeNotification({ id: "n2" }));
      tracker.markFailed("n1", "err");
      tracker.markSent("n2");

      const retries = tracker.getPendingRetries();
      expect(retries).toHaveLength(1);
      expect(retries[0].id).toBe("n1");
      expect(retries[0].status).toBe("pending"); // reset to pending
    });

    it("resetForRetry sets status back to pending", () => {
      tracker.track(makeNotification());
      tracker.markFailed("n1", "err");
      tracker.resetForRetry("n1");
      expect(tracker.get("n1")?.status).toBe("pending");
    });
  });

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  describe("queries", () => {
    it("getByUser returns all notifications for a user", () => {
      tracker.track(makeNotification({ id: "n1", userId: "u1" }));
      tracker.track(makeNotification({ id: "n2", userId: "u1" }));
      tracker.track(makeNotification({ id: "n3", userId: "u2" }));

      const results = tracker.getByUser("u1");
      expect(results).toHaveLength(2);
    });

    it("getEvents returns all recorded events", () => {
      tracker.track(makeNotification());
      tracker.markSent("n1");
      tracker.markDelivered("n1");

      const events = tracker.getEvents();
      expect(events).toHaveLength(3); // pending, sent, delivered
      expect(events[0].status).toBe("pending");
      expect(events[1].status).toBe("sent");
      expect(events[2].status).toBe("delivered");
    });
  });

  // -----------------------------------------------------------------------
  // Analytics
  // -----------------------------------------------------------------------

  describe("analytics", () => {
    it("computes delivery and read rates", () => {
      // 4 notifications: 1 delivered, 1 read, 1 failed, 1 sent
      tracker.track(makeNotification({ id: "n1" }));
      tracker.track(makeNotification({ id: "n2" }));
      tracker.track(makeNotification({ id: "n3" }));
      tracker.track(makeNotification({ id: "n4" }));

      tracker.markSent("n1");
      tracker.markDelivered("n1");

      tracker.markSent("n2");
      tracker.markDelivered("n2");
      tracker.markRead("n2");

      tracker.markFailed("n3", "err");

      tracker.markSent("n4");

      const stats = tracker.getAnalytics();
      expect(stats.total).toBe(4);
      expect(stats.delivered).toBe(1);
      expect(stats.read).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.sent).toBe(1);
      // deliveryRate = (delivered + read) / total = 2/4 = 0.5
      expect(stats.deliveryRate).toBe(0.5);
      // readRate = read / (delivered + read) = 1/2 = 0.5
      expect(stats.readRate).toBe(0.5);
    });

    it("filters analytics by channel", () => {
      tracker.track(makeNotification({ id: "n1", channel: "email" }));
      tracker.track(makeNotification({ id: "n2", channel: "sms" }));
      tracker.markSent("n1");
      tracker.markSent("n2");

      const emailStats = tracker.getAnalytics("email");
      expect(emailStats.total).toBe(1);

      const smsStats = tracker.getAnalytics("sms");
      expect(smsStats.total).toBe(1);
    });

    it("returns zero rates when no notifications", () => {
      const stats = tracker.getAnalytics();
      expect(stats.total).toBe(0);
      expect(stats.deliveryRate).toBe(0);
      expect(stats.readRate).toBe(0);
    });
  });
});
