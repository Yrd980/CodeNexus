import { beforeEach, describe, expect, it } from "vitest";
import { PreferenceManager } from "../src/preferences.js";

describe("PreferenceManager", () => {
  let mgr: PreferenceManager;

  beforeEach(() => {
    mgr = new PreferenceManager();
  });

  // -----------------------------------------------------------------------
  // Channel preferences
  // -----------------------------------------------------------------------

  describe("channel preferences", () => {
    it("defaults to enabled when no preference set", () => {
      expect(mgr.isChannelEnabled("user1", "order_update", "email")).toBe(
        true,
      );
    });

    it("respects explicit disable", () => {
      mgr.setChannelPreference("user1", "order_update", "sms", {
        enabled: false,
      });
      expect(mgr.isChannelEnabled("user1", "order_update", "sms")).toBe(
        false,
      );
      // Other channels still enabled
      expect(mgr.isChannelEnabled("user1", "order_update", "email")).toBe(
        true,
      );
    });

    it("can re-enable a disabled channel", () => {
      mgr.setChannelPreference("user1", "marketing", "email", {
        enabled: false,
      });
      mgr.setChannelPreference("user1", "marketing", "email", {
        enabled: true,
      });
      expect(mgr.isChannelEnabled("user1", "marketing", "email")).toBe(
        true,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Quiet hours
  // -----------------------------------------------------------------------

  describe("quiet hours", () => {
    it("returns false when no quiet hours set", () => {
      expect(mgr.isInQuietHours("user1")).toBe(false);
    });

    it("detects quiet hours spanning midnight (22:00-08:00)", () => {
      mgr.setQuietHours("user1", {
        startHour: 22,
        endHour: 8,
        timezone: "UTC",
      });

      // 23:00 → in quiet hours
      const lateNight = new Date();
      lateNight.setHours(23, 0, 0, 0);
      expect(mgr.isInQuietHours("user1", lateNight)).toBe(true);

      // 03:00 → in quiet hours
      const earlyMorning = new Date();
      earlyMorning.setHours(3, 0, 0, 0);
      expect(mgr.isInQuietHours("user1", earlyMorning)).toBe(true);

      // 12:00 → NOT in quiet hours
      const noon = new Date();
      noon.setHours(12, 0, 0, 0);
      expect(mgr.isInQuietHours("user1", noon)).toBe(false);
    });

    it("detects same-day quiet hours (02:00-06:00)", () => {
      mgr.setQuietHours("user1", {
        startHour: 2,
        endHour: 6,
        timezone: "UTC",
      });

      const inQuiet = new Date();
      inQuiet.setHours(4, 0, 0, 0);
      expect(mgr.isInQuietHours("user1", inQuiet)).toBe(true);

      const outOfQuiet = new Date();
      outOfQuiet.setHours(8, 0, 0, 0);
      expect(mgr.isInQuietHours("user1", outOfQuiet)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Frequency caps
  // -----------------------------------------------------------------------

  describe("frequency caps", () => {
    it("returns false when cap is unlimited (0)", () => {
      mgr.setFrequencyCap("user1", 0);
      mgr.recordSend("user1");
      mgr.recordSend("user1");
      expect(mgr.isOverFrequencyCap("user1")).toBe(false);
    });

    it("enforces max sends per hour", () => {
      mgr.setFrequencyCap("user1", 2);

      const now = new Date();
      mgr.recordSend("user1", now);
      expect(mgr.isOverFrequencyCap("user1", now)).toBe(false);

      mgr.recordSend("user1", now);
      expect(mgr.isOverFrequencyCap("user1", now)).toBe(true);
    });

    it("resets after the hour window passes", () => {
      mgr.setFrequencyCap("user1", 1);

      const oneHourAgo = new Date(Date.now() - 61 * 60 * 1000);
      mgr.recordSend("user1", oneHourAgo);

      expect(mgr.isOverFrequencyCap("user1")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // shouldSuppress
  // -----------------------------------------------------------------------

  describe("shouldSuppress", () => {
    it("suppresses when channel is disabled", () => {
      mgr.setChannelPreference("user1", "promo", "email", {
        enabled: false,
      });
      const result = mgr.shouldSuppress("user1", "promo", "email");
      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("channel_disabled");
    });

    it("suppresses during quiet hours for normal priority", () => {
      mgr.setQuietHours("user1", {
        startHour: 22,
        endHour: 8,
        timezone: "UTC",
      });
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const result = mgr.shouldSuppress(
        "user1",
        "update",
        "push",
        "normal",
        midnight,
      );
      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("quiet_hours");
    });

    it("does NOT suppress urgent priority during quiet hours", () => {
      mgr.setQuietHours("user1", {
        startHour: 22,
        endHour: 8,
        timezone: "UTC",
      });
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const result = mgr.shouldSuppress(
        "user1",
        "alert",
        "push",
        "urgent",
        midnight,
      );
      expect(result.suppressed).toBe(false);
    });

    it("suppresses when over frequency cap", () => {
      mgr.setFrequencyCap("user1", 1);
      const now = new Date();
      mgr.recordSend("user1", now);
      const result = mgr.shouldSuppress(
        "user1",
        "update",
        "email",
        "normal",
        now,
      );
      expect(result.suppressed).toBe(true);
      expect(result.reason).toBe("frequency_cap");
    });

    it("allows when no suppression rules match", () => {
      const result = mgr.shouldSuppress("user1", "update", "email");
      expect(result.suppressed).toBe(false);
    });
  });
});
