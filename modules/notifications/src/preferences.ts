/**
 * User preference management for notifications.
 *
 * Handles:
 *  - Per-user, per-notification-type, per-channel enable/disable
 *  - Quiet hours (suppresses non-urgent notifications)
 *  - Frequency caps (max N notifications per user per hour)
 *
 * Uses an in-memory store by default. Swap `PreferenceStore` for a DB-backed
 * implementation in production.
 */

import type {
  ChannelPreference,
  NotificationChannel,
  NotificationPriority,
  QuietHours,
  UserPreferences,
} from "./types.js";

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

/** Abstract store — implement against your database in production. */
export interface PreferenceStore {
  get(userId: string): UserPreferences | undefined;
  set(userId: string, prefs: UserPreferences): void;
}

// ---------------------------------------------------------------------------
// In-memory store (default)
// ---------------------------------------------------------------------------

export class InMemoryPreferenceStore implements PreferenceStore {
  private readonly store = new Map<string, UserPreferences>();

  get(userId: string): UserPreferences | undefined {
    return this.store.get(userId);
  }

  set(userId: string, prefs: UserPreferences): void {
    this.store.set(userId, prefs);
  }
}

// ---------------------------------------------------------------------------
// Preference Manager
// ---------------------------------------------------------------------------

/** Default preferences applied when a user has no explicit settings. */
function defaultPreferences(userId: string): UserPreferences {
  return {
    userId,
    channels: {},
    frequencyCap: 0, // unlimited
  };
}

export class PreferenceManager {
  private readonly store: PreferenceStore;
  /** Sliding-window counters: userId → sorted list of send timestamps. */
  private readonly sendLog = new Map<string, number[]>();

  constructor(store?: PreferenceStore) {
    this.store = store ?? new InMemoryPreferenceStore();
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /** Get preferences for a user, creating defaults if none exist. */
  getPreferences(userId: string): UserPreferences {
    return this.store.get(userId) ?? defaultPreferences(userId);
  }

  /** Replace preferences wholesale. */
  setPreferences(prefs: UserPreferences): void {
    this.store.set(prefs.userId, prefs);
  }

  /**
   * Set a single channel preference for a notification type.
   * Creates the user record if it doesn't exist.
   */
  setChannelPreference(
    userId: string,
    notificationType: string,
    channel: NotificationChannel,
    pref: ChannelPreference,
  ): void {
    const prefs = this.getPreferences(userId);
    if (!prefs.channels[notificationType]) {
      prefs.channels[notificationType] = {} as Record<
        NotificationChannel,
        ChannelPreference
      >;
    }
    prefs.channels[notificationType][channel] = pref;
    this.store.set(userId, prefs);
  }

  /** Set quiet hours for a user. */
  setQuietHours(userId: string, quietHours: QuietHours): void {
    const prefs = this.getPreferences(userId);
    prefs.quietHours = quietHours;
    this.store.set(userId, prefs);
  }

  /** Set frequency cap for a user. */
  setFrequencyCap(userId: string, maxPerHour: number): void {
    const prefs = this.getPreferences(userId);
    prefs.frequencyCap = maxPerHour;
    this.store.set(userId, prefs);
  }

  // -----------------------------------------------------------------------
  // Checks
  // -----------------------------------------------------------------------

  /**
   * Is a specific channel enabled for a notification type?
   * Defaults to **enabled** when no explicit preference is set.
   */
  isChannelEnabled(
    userId: string,
    notificationType: string,
    channel: NotificationChannel,
  ): boolean {
    const prefs = this.getPreferences(userId);
    const typePref = prefs.channels[notificationType];
    if (!typePref) return true; // default enabled
    const chanPref = typePref[channel];
    if (!chanPref) return true; // default enabled
    return chanPref.enabled;
  }

  /**
   * Is the user currently in quiet hours?
   * Accepts an optional `now` for testing.
   */
  isInQuietHours(userId: string, now?: Date): boolean {
    const prefs = this.getPreferences(userId);
    if (!prefs.quietHours) return false;
    return isWithinQuietHours(prefs.quietHours, now ?? new Date());
  }

  /**
   * Should a notification be suppressed?
   * Combines channel preference, quiet hours, and frequency cap.
   *
   * "urgent" priority bypasses quiet hours and frequency caps.
   */
  shouldSuppress(
    userId: string,
    notificationType: string,
    channel: NotificationChannel,
    priority: NotificationPriority = "normal",
    now?: Date,
  ): { suppressed: boolean; reason?: string } {
    // Channel disabled?
    if (!this.isChannelEnabled(userId, notificationType, channel)) {
      return { suppressed: true, reason: "channel_disabled" };
    }

    // Urgent bypasses quiet hours and frequency caps
    if (priority === "urgent") {
      return { suppressed: false };
    }

    // Quiet hours?
    if (this.isInQuietHours(userId, now)) {
      return { suppressed: true, reason: "quiet_hours" };
    }

    // Frequency cap?
    if (this.isOverFrequencyCap(userId, now)) {
      return { suppressed: true, reason: "frequency_cap" };
    }

    return { suppressed: false };
  }

  // -----------------------------------------------------------------------
  // Frequency tracking
  // -----------------------------------------------------------------------

  /**
   * Record that a notification was sent to this user.
   * Call this after successful delivery to enforce frequency caps.
   */
  recordSend(userId: string, now?: Date): void {
    const timestamp = (now ?? new Date()).getTime();
    const log = this.sendLog.get(userId) ?? [];
    log.push(timestamp);
    this.sendLog.set(userId, log);
  }

  /**
   * Has the user exceeded their frequency cap in the last hour?
   */
  isOverFrequencyCap(userId: string, now?: Date): boolean {
    const prefs = this.getPreferences(userId);
    if (prefs.frequencyCap <= 0) return false; // unlimited

    const currentTime = (now ?? new Date()).getTime();
    const oneHourAgo = currentTime - 60 * 60 * 1000;

    const log = this.sendLog.get(userId) ?? [];
    // Prune old entries
    const recent = log.filter((ts) => ts > oneHourAgo);
    this.sendLog.set(userId, recent);

    return recent.length >= prefs.frequencyCap;
  }
}

// ---------------------------------------------------------------------------
// Quiet-hours helper
// ---------------------------------------------------------------------------

/**
 * Check if `now` falls within the quiet-hours window.
 * Handles windows that span midnight (e.g., 22:00 – 08:00).
 *
 * Note: for simplicity, we compare against UTC hours offset by a
 * fixed timezone string. In production, use a proper timezone library.
 * Here we treat the hours as if they are in the same zone as `now`.
 */
function isWithinQuietHours(qh: QuietHours, now: Date): boolean {
  const currentHour = now.getHours();

  if (qh.startHour <= qh.endHour) {
    // Same-day window, e.g. 02:00 – 06:00
    return currentHour >= qh.startHour && currentHour < qh.endHour;
  }
  // Spans midnight, e.g. 22:00 – 08:00
  return currentHour >= qh.startHour || currentHour < qh.endHour;
}
