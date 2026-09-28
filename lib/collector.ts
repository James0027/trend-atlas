import { randomUUID } from "node:crypto";
import { collect } from "./adapters";
import { SOURCES } from "./catalog";
import { serverConfiguration, serviceDatabase } from "./database";
import { HISTORY_WINDOW, SNAPSHOT_RETENTION, safeCollectionError, sourceInterval } from "./source-policy";
import { validSnapshot } from "./validate";
import type { Snapshot } from "./feed";
import type { Item, Source } from "./types";

const LEASE_TTL = 50_000;
const DISPATCH_WINDOW = 40_000;
const REQUEST_WINDOW = 45_000;
export const COLLECTION_REQUEST_BUDGET = 55_000;
const CLEANUP_RESERVE = 5_000;
const CLEANUP_WAIT = 3_000;
const DATABASE_WAIT = 8_000;
const FAILURE_INTERVAL = 30 * 60_000;
const CONFIG_INTERVAL = 24 * 60 * 60_000;
export type CollectionTrigger = "cron" | "manual" | "seed";
export type CollectionSummary = {
  state: "ok" | "degraded" | "busy";
  trigger: CollectionTrigger;
  attempted: number;
  succeeded: number;
  failed: number;
  restricted: number;
  saved: number;
  deferred: number;
};

/** Bound a whole operation; callers can forward the signal to cancel its I/O. */
export async function withinDeadline<T>(deadline: number, maximumWait: number, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const remaining = Math.min(maximumWait, deadline - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("本次任务剩余时间不足");
  const controller = new AbortController();
  const timeout = new Error("本次任务剩余时间不足");
  const timer = setTimeout(() => controller.abort(timeout), Math.ceil(remaining));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(timeout);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const work = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw timeout;
      return operation(controller.signal);
    });
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

export function mergeHistory(items: Item[], previous: Item[]): Item[] {
  const old = new Map(previous.map(item => [item.id, item]));
  return items.map(item => {
    const previousItem = old.get(item.id);
    if (!previousItem) return item;
    if (previousItem.channel !== item.channel) {
      // A provider switch preserves discovery time, but not incomparable rank.
      const current = { ...item };
      delete current.previousRank;
      return { ...current, firstSeen: previousItem.firstSeen, history: [{ at: item.fetchedAt, rank: item.rank }] };
    }
    return {
      ...item,
      firstSeen: previousItem.firstSeen,
      previousRank: previousItem.rank,
      history: [...previousItem.history.filter(entry => entry.at > item.fetchedAt - HISTORY_WINDOW
        && entry.at < item.fetchedAt), { at: item.fetchedAt, rank: item.rank }].slice(-24),
    };
  });
}

function failedSnapshot(source: Source, old: Snapshot | undefined, now: number, error: unknown, hasUapiKey: boolean, attemptedAnonymousUapi = false): Snapshot {
  const items = (old?.items ?? []).filter(item => now - item.fetchedAt <= SNAPSHOT_RETENTION);
  const message = safeCollectionError(error);
  const anonymousUapi = !hasUapiKey && (attemptedAnonymousUapi || source.adapter === "uapi" || old?.status.channel?.startsWith("UAPI"));
  const retryAfter = error && typeof error === "object" && "retryAfterMs" in error
    && typeof error.retryAfterMs === "number" && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
    ? Math.min(error.retryAfterMs, 30 * 24 * 60 * 60_000) : 0;
  const delay = Math.max(anonymousUapi ? 6 * 60 * 60_000 : FAILURE_INTERVAL, retryAfter);
  return {
    items,
    status: {
      id: source.id, state: items.length ? "cached" : "error", count: items.length,
      fetchedAt: old?.status.fetchedAt ?? null, checkedAt: now,
      nextRefreshAt: now + delay,
      message: items.length ? `${message}；保留上次成功数据` : message,
      ...(old?.status.upstreamUpdatedAt === undefined ? {} : { upstreamUpdatedAt: old.status.upstreamUpdatedAt }),
      ...(old?.status.channel === undefined ? {} : { channel: old.status.channel }),
    },
  };
}

/** A scheduled round uses one persistent cross-instance lease and fenced writes. */
export async function runCollection(trigger: CollectionTrigger = "cron", deadline = Date.now() + COLLECTION_REQUEST_BUDGET): Promise<CollectionSummary> {
  const db = serviceDatabase();
  if (!db) throw new Error("云端采集数据库尚未配置");
  const configuration = serverConfiguration();
  const started = Date.now();
  if (!Number.isFinite(deadline)) throw new Error("本次任务剩余时间不足");
  const overallDeadline = Math.min(deadline, started + COLLECTION_REQUEST_BUDGET);
  const workDeadline = Math.min(started + LEASE_TTL, overallDeadline - CLEANUP_RESERVE);
  const upstreamDeadline = Math.min(started + REQUEST_WINDOW, workDeadline - 5_000);
  const dispatchDeadline = Math.min(started + DISPATCH_WINDOW, upstreamDeadline - 6_500);
  const leaseTtl = Math.min(LEASE_TTL, workDeadline - started);
  if (leaseTtl < 1_000) throw new Error("本次任务剩余时间不足");
  const owner = randomUUID();
  const summary: CollectionSummary = { state: "ok", trigger, attempted: 0, succeeded: 0, failed: 0, restricted: 0, saved: 0, deferred: 0 };
  let acquired;
  try {
    acquired = await withinDeadline(workDeadline, DATABASE_WAIT, signal => db.rpc("acquire_collection_lease", {
      p_key: "feed", p_owner: owner, p_now: started, p_ttl: leaseTtl,
    }).abortSignal(signal));
  } catch {
    // A timed-out response can hide a successful acquisition. Only this UUID
    // may be released; a subsequent owner's lease is never touched.
    try { await withinDeadline(overallDeadline, CLEANUP_WAIT, signal => db.rpc("release_collection_lease", { p_key: "feed", p_owner: owner }).abortSignal(signal)); }
    catch { /* The owner-scoped lease also expires without client cleanup. */ }
    throw new Error("云端采集锁暂不可用");
  }
  if (acquired.error) throw new Error("云端采集锁暂不可用");
  if (acquired.data !== true) return { ...summary, state: "busy" };

  let runId: string | undefined;
  let lostLease = false;
  let fatal = false;
  try {
    // Know the row ID before sending: even a lost INSERT response can then be
    // followed by a bounded terminal-status update for that exact run.
    runId = randomUUID();
    const run = await withinDeadline(workDeadline, DATABASE_WAIT, signal => db.from("collection_runs")
      .insert({ id: runId, started_at: new Date(started).toISOString(), status: "running", summary: { trigger } })
      .select("id").abortSignal(signal).single());
    if (run.error || run.data?.id !== runId) throw new Error("采集运行记录暂不可用");
    const cacheResult = await withinDeadline(workDeadline, DATABASE_WAIT, signal => db.from("source_snapshots")
      .select("source_id,payload,next_attempt").abortSignal(signal));
    if (cacheResult.error) throw new Error("采集快照暂不可读取");
    const cache = new Map<string, { snapshot: Snapshot; nextAttempt: number }>();
    for (const row of cacheResult.data ?? []) {
      if (validSnapshot(row.payload, row.source_id) && row.payload.status.count === row.payload.items.length) {
        cache.set(row.source_id, { snapshot: row.payload, nextAttempt: Number.isFinite(row.next_attempt) ? row.next_attempt : row.payload.status.nextRefreshAt });
      }
    }
    const due = SOURCES.filter(source => (cache.get(source.id)?.nextAttempt ?? 0) <= started)
      .sort((a, b) => (cache.get(a.id)?.nextAttempt ?? 0) - (cache.get(b.id)?.nextAttempt ?? 0))
      .slice(0, 12);
    let next = 0;
    let fallbacks = 0;
    const reserveFallback = () => {
      if (fallbacks >= 4 || lostLease || Date.now() >= dispatchDeadline) return false;
      fallbacks += 1;
      return true;
    };
    const permitUapi = async (): Promise<boolean> => {
      if (lostLease || Date.now() >= dispatchDeadline) return false;
      if (configuration.uapiKey) return true;
      const now = Date.now();
      const date = new Date(now);
      const dayExpires = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
      const monthExpires = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
      // Conservative charging: a rejected monthly reservation may still consume
      // the daily slot. No request is made unless both persistent budgets allow it.
      const day = await withinDeadline(dispatchDeadline, DATABASE_WAIT, signal => db.rpc("consume_api_budget", {
        p_bucket: `uapi-day-${date.toISOString().slice(0, 10)}`, p_limit: 40, p_expires: dayExpires,
      }).abortSignal(signal));
      if (day.error || day.data !== true) return false;
      const month = await withinDeadline(dispatchDeadline, DATABASE_WAIT, signal => db.rpc("consume_api_budget", {
        p_bucket: `uapi-month-${date.toISOString().slice(0, 7)}`, p_limit: 1200, p_expires: monthExpires,
      }).abortSignal(signal));
      return !month.error && month.data === true;
    };

    const worker = async () => {
      for (;;) {
        if (lostLease || Date.now() >= dispatchDeadline) return;
        const source = due[next++];
        if (!source) return;
        summary.attempted += 1;
        const now = Date.now();
        const old = cache.get(source.id)?.snapshot;
        let snapshot: Snapshot;
        if (source.adapter === "restricted" || (source.adapter === "youtube" && !configuration.youtubeKey)) {
          snapshot = { items: [], status: { id: source.id, state: "restricted", count: 0, fetchedAt: null,
            checkedAt: now, nextRefreshAt: now + CONFIG_INTERVAL,
            message: source.adapter === "youtube" ? "尚未配置 YouTube 官方 API 授权，前往原平台查看。" : source.note } };
          summary.restricted += 1;
        } else {
          let attemptedAnonymousUapi = false;
          try {
            // The adapters bound their requests, but an adapter can also wait
            // on a queue or stall before making a request. Bound that whole
            // operation so workers can release the lease on time.
            const result = await withinDeadline(upstreamDeadline, REQUEST_WINDOW, signal => collect(
              source, now, configuration.youtubeKey, configuration.uapiKey,
              async () => {
                if (signal.aborted) return false;
                if (!configuration.uapiKey) attemptedAnonymousUapi = true;
                const permitted = await permitUapi();
                return !signal.aborted && permitted;
              },
              () => !signal.aborted && reserveFallback(), upstreamDeadline,
            ));
            const items = mergeHistory(result.items, old?.items ?? []);
            const interval = sourceInterval(source, result.channel);
            snapshot = { items, status: { id: source.id, state: "ok", count: items.length, fetchedAt: now,
              checkedAt: now, nextRefreshAt: now + interval,
              message: interval >= 6 * 60 * 60_000 ? "采集成功，按来源更新周期定时检查。" : "采集成功",
              ...(result.upstreamUpdatedAt === undefined ? {} : { upstreamUpdatedAt: result.upstreamUpdatedAt }),
              ...(result.channel === undefined ? {} : { channel: result.channel }) } };
            summary.succeeded += 1;
          } catch (error) {
            snapshot = failedSnapshot(source, old, Date.now(), error, !!configuration.uapiKey, attemptedAnonymousUapi);
            summary.failed += 1;
          }
        }
        if (lostLease || Date.now() >= workDeadline) { lostLease = true; return; }
        const saved = await withinDeadline(workDeadline, DATABASE_WAIT, signal => db.rpc("save_source_snapshot", {
          p_source_id: source.id, p_payload: snapshot, p_next_attempt: snapshot.status.nextRefreshAt,
          p_owner: owner, p_now: Date.now(),
        }).abortSignal(signal));
        if (saved.error) { fatal = true; lostLease = true; return; }
        if (saved.data !== true) { lostLease = true; return; }
        summary.saved += 1;
      }
    };
    // Catch unexpected worker failures individually and stop new dispatch. Wait
    // for every already-running worker before releasing the shared lease.
    const workers = Array.from({ length: Math.min(4, due.length) }, () => worker().catch(() => {
      fatal = true;
      lostLease = true;
    }));
    await Promise.allSettled(workers);
    summary.deferred = due.length - summary.saved;
    if (summary.failed || lostLease || fatal || summary.deferred) summary.state = "degraded";
  } catch {
    fatal = true;
    summary.state = "degraded";
  } finally {
    const endedAt = new Date(Math.max(started, Date.now())).toISOString();
    const status = fatal && summary.saved === 0 ? "failed" : summary.state === "ok" ? "succeeded" : "partial";
    // Expired budgets and seven-day run retention are pruned in the acquire RPC.
    // These two short requests run only after every worker has settled; sharing
    // the absolute route deadline prevents serial ten-second cleanup overruns.
    const cleanup = [withinDeadline(overallDeadline, CLEANUP_WAIT, signal => db.rpc("release_collection_lease", {
      p_key: "feed", p_owner: owner,
    }).abortSignal(signal))];
    if (runId) cleanup.push(withinDeadline(overallDeadline, CLEANUP_WAIT, signal => db.from("collection_runs")
      // Conflict handling also waits for an INSERT with a lost response, rather
      // than an UPDATE missing the not-yet-visible row from that transaction.
      .upsert({ id: runId, started_at: new Date(started).toISOString(), ended_at: endedAt, status, summary: { ...summary } }, { onConflict: "id" })
      .abortSignal(signal)));
    const cleaned = await Promise.allSettled(cleanup);
    if (cleaned.some(result => result.status === "rejected" || result.value.error)) summary.state = "degraded";
  }
  return summary;
}
