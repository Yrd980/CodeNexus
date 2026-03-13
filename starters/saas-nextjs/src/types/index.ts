/**
 * Shared type definitions for a SaaS application.
 *
 * These types form the backbone of your SaaS data model.
 * Adapt them to your specific domain — the structure here reflects
 * the most common patterns across B2B SaaS products.
 */

// ─── User & Team ────────────────────────────────────────────

export type UserRole = "owner" | "admin" | "member" | "viewer";

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  teamId: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  planId: string;
  subscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Billing ────────────────────────────────────────────────

export type BillingInterval = "month" | "year";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export interface PlanFeature {
  name: string;
  included: boolean;
  limit?: number;
  description?: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  features: PlanFeature[];
  limits: PlanLimits;
  isPopular?: boolean;
}

export interface PlanLimits {
  maxMembers: number;
  maxProjects: number;
  maxStorageMb: number;
  maxApiRequestsPerDay: number;
}

export interface Subscription {
  id: string;
  teamId: string;
  planId: string;
  status: SubscriptionStatus;
  interval: BillingInterval;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
}

export interface UsageRecord {
  teamId: string;
  metric: string;
  value: number;
  limit: number;
  period: string; // YYYY-MM format
}

// ─── API ────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Auth / Session ─────────────────────────────────────────

export interface Session {
  user: User;
  team: Team;
  accessToken: string;
  expiresAt: Date;
}

// ─── Webhook Events ─────────────────────────────────────────

export type WebhookEventType =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.payment_succeeded"
  | "invoice.payment_failed";

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  data: Record<string, unknown>;
  createdAt: Date;
}

// ─── Component Props ────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  badge?: string;
  children?: NavItem[];
}

export interface DashboardLayoutProps {
  navigation: NavItem[];
  userMenu: {
    user: Pick<User, "name" | "email" | "avatarUrl">;
    items: NavItem[];
  };
  children: unknown; // React.ReactNode in actual usage
}

export interface AuthGuardProps {
  requiredRole?: UserRole;
  redirectTo?: string;
  fallback?: unknown; // React.ReactNode in actual usage
  children: unknown; // React.ReactNode in actual usage
}
