import type { ApiEventName, ApiEvents, ChannelSyncTrigger } from "../../../lib/api/contract";
import { CHANNEL_SYNC_INTERVAL_MINUTES } from "../../../lib/domain/short-stay";
import type { Core } from "../context";
import type { ChannelSecretStore, ChannelSyncControl, FeedFetcher } from "../integrations/channels";
import { activeConnectionIds } from "./connections";
import { safeSyncDiagnostic } from "./diagnostics";
import { syncConnection, type SyncOutcome } from "./sync";

/**
 * Reads every active calendar feed shortly after launch and then every
 * CHANNEL_SYNC_INTERVAL_MINUTES while HavenOS is open.
 *
 *  - Only the landlord's own records ("main" workspace) are ever synced.
 *  - At most MAX_CONCURRENT feeds are read at once, and one connection is
 *    never read twice at the same time (a second request joins the first).
 *  - After HTTP 429 or a 5xx, timer syncs of that feed back off
 *    exponentially (capped), with jitter, so a struggling or rate-limiting
 *    channel isn't hammered; the 20-minute cadence is otherwise kept.
 *  - A failure never stops the timer. Logs carry the connection id and the
 *    error code and sanitized diagnostic — never the feed link.
 */

export const MAX_CONCURRENT = 3;
const LAUNCH_DELAY_MS = 5_000;
const TICK_JITTER_MS = 60_000;
const MAX_BACKOFF_MS = 3 * 60 * 60_000;

export interface SchedulerWorkspaces {
  readonly current: Core;
  readonly workspace: string;
}

export interface ChannelSchedulerOptions {
  workspaces: SchedulerWorkspaces;
  secrets: ChannelSecretStore;
  fetcher: FeedFetcher;
  emit: <E extends ApiEventName>(event: E, payload: ApiEvents[E]) => void;
  now?: () => Date;
  /** Overrides for tests. */
  intervalMs?: number;
  launchDelayMs?: number;
  jitterMs?: number;
  random?: () => number;
  log?: (line: string) => void;
}

interface Backoff {
  failures: number;
  until: number;
}

function isBackoffError(o: SyncOutcome): boolean {
  if (o.errorCode === "rate_limited") return true;
  return o.errorCode === "http_error" && /^5\d\d$/.test(o.errorDetail);
}

export class ChannelScheduler implements ChannelSyncControl {
  readonly secrets: ChannelSecretStore;
  private readonly inFlight = new Map<string, Promise<SyncOutcome>>();
  private readonly backoff = new Map<string, Backoff>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt: number | null = null;
  private stopped = false;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private readonly launchDelayMs: number;
  private readonly jitterMs: number;
  private readonly random: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly opts: ChannelSchedulerOptions) {
    this.secrets = opts.secrets;
    this.now = opts.now ?? (() => new Date());
    this.intervalMs = opts.intervalMs ?? CHANNEL_SYNC_INTERVAL_MINUTES * 60_000;
    this.launchDelayMs = opts.launchDelayMs ?? LAUNCH_DELAY_MS;
    this.jitterMs = opts.jitterMs ?? TICK_JITTER_MS;
    this.random = opts.random ?? Math.random;
    this.log = opts.log ?? ((line) => console.warn(line));
  }

  start() {
    this.stopped = false;
    this.schedule(this.launchDelayMs, "launch");
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAt = null;
    for (const wake of this.waiting.splice(0)) wake();
  }

  nextSyncAt(): string | null {
    return this.nextAt === null ? null : new Date(this.nextAt).toISOString();
  }

  running(): string[] {
    return [...this.inFlight.keys()];
  }

  private schedule(delayMs: number, trigger: ChannelSyncTrigger) {
    if (this.stopped) return;
    this.nextAt = this.now().getTime() + delayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick(trigger);
    }, delayMs);
  }

  private async tick(trigger: ChannelSyncTrigger) {
    try {
      await this.syncAll(trigger, true);
    } catch {
      this.log("[havenos] channel sync: timer run failed");
    } finally {
      this.schedule(this.intervalMs + Math.floor(this.random() * this.jitterMs), "timer");
    }
  }

  private getCore(): Core | null {
    if (this.stopped || this.opts.workspaces.workspace !== "main") return null;
    return this.opts.workspaces.current;
  }

  async syncNow(opts: { connectionId: string | null; trigger: ChannelSyncTrigger; acceptShrink: boolean }): Promise<void> {
    if (opts.connectionId === null) {
      await this.syncAll(opts.trigger, false, opts.acceptShrink);
      return;
    }
    await this.syncOne(opts.connectionId, opts.trigger, opts.acceptShrink, false);
  }

  private async syncAll(trigger: ChannelSyncTrigger, respectBackoff: boolean, acceptShrink = false) {
    const core = this.getCore();
    if (!core) return;
    const ids = activeConnectionIds(core);
    await Promise.all(ids.map((id) => this.syncOne(id, trigger, acceptShrink, respectBackoff)));
  }

  /** Start (or join) a sync of one connection. Resolves when it has finished. */
  syncOne(id: string, trigger: ChannelSyncTrigger, acceptShrink: boolean, respectBackoff: boolean): Promise<SyncOutcome | null> {
    const existing = this.inFlight.get(id);
    if (existing) {
      // A landlord confirming a shrunken feed needs a fresh read that accepts it.
      return acceptShrink ? existing.then(() => this.syncOne(id, trigger, acceptShrink, respectBackoff)) : existing;
    }
    if (!this.getCore()) return Promise.resolve(null);
    const b = this.backoff.get(id);
    if (respectBackoff && b && b.until > this.now().getTime()) return Promise.resolve(null);

    const promise = this.runLimited(id, trigger, acceptShrink).finally(() => {
      this.inFlight.delete(id);
      this.emitRunning();
    });
    this.inFlight.set(id, promise);
    this.emitRunning();
    return promise;
  }

  private emitRunning() {
    try {
      this.opts.emit("channel-sync", { running: this.running() });
    } catch {
      /* the window may be gone */
    }
  }

  private async acquire() {
    while (this.active >= MAX_CONCURRENT && !this.stopped) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
  }

  private release() {
    this.active--;
    this.waiting.shift()?.();
  }

  private async runLimited(id: string, trigger: ChannelSyncTrigger, acceptShrink: boolean): Promise<SyncOutcome> {
    await this.acquire();
    let outcome: SyncOutcome;
    try {
      outcome = await syncConnection({
        getCore: () => this.getCore(),
        secrets: this.secrets,
        fetcher: this.opts.fetcher,
        connectionId: id,
        trigger,
        acceptShrink,
      });
    } catch (err) {
      outcome = { runId: null, outcome: "failed", errorCode: "internal", errorDetail: "", diagnostic: safeSyncDiagnostic(err), changed: false };
    } finally {
      this.release();
    }
    if (outcome.outcome === "failed" || outcome.outcome === "rejected") this.log(`[havenos] channel sync ${id}: ${outcome.errorCode ?? "internal"}${outcome.diagnostic ? ` — ${outcome.diagnostic}` : ""}`);
    this.noteBackoff(id, outcome);
    if (outcome.changed) {
      try {
        this.opts.emit("data-changed", { reason: "channel-sync" });
      } catch {
        /* ignore */
      }
    }
    return outcome;
  }

  private noteBackoff(id: string, outcome: SyncOutcome) {
    if (outcome.outcome === "ok") {
      this.backoff.delete(id);
      return;
    }
    if (!isBackoffError(outcome)) return;
    const failures = (this.backoff.get(id)?.failures ?? 0) + 1;
    const base = Math.min(this.intervalMs * 2 ** failures, MAX_BACKOFF_MS);
    const until = this.now().getTime() + base * (0.9 + this.random() * 0.2);
    this.backoff.set(id, { failures, until });
  }
}
