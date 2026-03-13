/**
 * Queue Worker — Type Definitions
 *
 * Core types for the job queue system. Every job flows through:
 * waiting -> active -> completed | failed | delayed
 */

// ─── Job Status ─────────────────────────────────────────────

export type JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

// ─── Job ────────────────────────────────────────────────────

export interface Job<T = unknown> {
  /** Unique job identifier */
  readonly id: string;
  /** Job name — used to match with handlers */
  readonly name: string;
  /** Arbitrary payload */
  readonly data: T;
  /** Higher number = higher priority (default: 0) */
  priority: number;
  /** How many times this job has been attempted */
  attempts: number;
  /** Maximum retry attempts before permanent failure */
  maxRetries: number;
  /** Delay in ms before the job becomes processable */
  delay: number;
  /** Timeout in ms — job is failed if handler exceeds this */
  timeout: number;
  /** Optional deduplication key */
  deduplicationKey?: string;
  /** When the job was created */
  readonly createdAt: number;
  /** When the job should become processable (createdAt + delay) */
  processAfter: number;
  /** Current status */
  status: JobStatus;
  /** Error message from the last failed attempt */
  lastError?: string;
  /** Result of a completed job */
  result?: unknown;
  /** Progress value (0-100) reported by the handler */
  progress: number;
}

// ─── Job Options (user-facing) ──────────────────────────────

export interface JobOptions {
  /** Higher number = higher priority (default: 0) */
  priority?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay in ms before the job becomes processable (default: 0) */
  delay?: number;
  /** Timeout in ms for job execution (default: 30000) */
  timeout?: number;
  /** Deduplication key — if a waiting/active job exists with the same key, skip */
  deduplicationKey?: string;
}

// ─── Job Handler ────────────────────────────────────────────

export interface JobContext<T = unknown> {
  /** The job being processed */
  readonly job: Readonly<Job<T>>;
  /** Report progress (0-100) */
  reportProgress: (value: number) => void;
  /** AbortSignal that fires on timeout or shutdown */
  readonly signal: AbortSignal;
}

export type JobHandler<T = unknown, R = unknown> = (
  ctx: JobContext<T>,
) => Promise<R>;

// ─── Job Result ─────────────────────────────────────────────

export interface JobResult<R = unknown> {
  readonly jobId: string;
  readonly result: R;
  /** How long the handler took in ms */
  readonly duration: number;
  /** How many attempts it took */
  readonly attempts: number;
}

// ─── Backoff Strategy ───────────────────────────────────────

export type BackoffStrategy = "fixed" | "exponential" | "linear";

export interface BackoffConfig {
  /** Strategy type */
  strategy: BackoffStrategy;
  /** Base delay in ms (default: 1000) */
  baseDelay: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay: number;
}

// ─── Worker Config ──────────────────────────────────────────

export interface WorkerConfig {
  /** Number of jobs to process in parallel (default: 1) */
  concurrency: number;
  /** How often to poll for new jobs in ms (default: 100) */
  pollInterval: number;
  /** Default max retries for jobs that don't specify their own (default: 3) */
  maxRetries: number;
  /** Backoff configuration */
  backoff: BackoffConfig;
}

// ─── Queue Config ───────────────────────────────────────────

export interface QueueConfig {
  /** Maximum number of jobs in the queue (0 = unlimited, default: 0) */
  maxSize: number;
  /** Default priority for jobs (default: 0) */
  defaultPriority: number;
  /** Default max retries for jobs (default: 3) */
  defaultRetries: number;
  /** Default timeout in ms (default: 30000) */
  defaultTimeout: number;
}

// ─── Events ─────────────────────────────────────────────────

export interface QueueEventMap {
  "job:added": { job: Job };
  "job:active": { job: Job };
  "job:completed": { job: Job; result: unknown; duration: number };
  "job:failed": { job: Job; error: Error; willRetry: boolean };
  "job:progress": { job: Job; progress: number };
  "job:retrying": { job: Job; attempt: number; delay: number };
  "queue:drained": undefined;
  "queue:error": { error: Error };
  "worker:idle": undefined;
}

export type QueueEventName = keyof QueueEventMap;

export type QueueEventListener<E extends QueueEventName> = (
  data: QueueEventMap[E],
) => void;

// ─── Job Store Interface ────────────────────────────────────

export interface JobStore {
  /** Add a job to the store */
  add(job: Job): void;
  /** Get a job by ID */
  get(id: string): Job | undefined;
  /** Update a job in place */
  update(id: string, updates: Partial<Job>): void;
  /** Remove a job */
  remove(id: string): void;
  /** Get the next processable job (waiting, not delayed, highest priority) */
  getNext(): Job | undefined;
  /** Check if a deduplication key already exists in waiting/active jobs */
  hasDuplicateKey(key: string): boolean;
  /** Query jobs by status */
  getByStatus(status: JobStatus): Job[];
  /** Count jobs by status */
  countByStatus(status: JobStatus): number;
  /** Get all jobs */
  getAll(): Job[];
  /** Clear all jobs */
  clear(): void;
}

// ─── Scheduler Types ────────────────────────────────────────

export interface ScheduleOptions {
  /** Job name */
  name: string;
  /** Job data factory — called each time to produce fresh data */
  dataFactory: () => unknown;
  /** Interval in ms between executions */
  every: number;
  /** Maximum number of executions (0 = unlimited, default: 0) */
  maxExecutions?: number;
  /** Job options applied to each scheduled job */
  jobOptions?: JobOptions;
}

export interface ScheduledTask {
  /** Unique schedule ID */
  readonly id: string;
  /** The schedule configuration */
  readonly options: ScheduleOptions;
  /** How many times this schedule has fired */
  executionCount: number;
  /** Whether the schedule is active */
  active: boolean;
  /** Cancel this scheduled task */
  cancel: () => void;
}
