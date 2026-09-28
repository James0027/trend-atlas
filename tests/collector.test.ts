import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, Source } from "../lib/types";
import type { Snapshot } from "../lib/feed";

const mocked = vi.hoisted(() => ({
  database: null as unknown,
  configuration: { configured: true, youtubeKey: undefined as string | undefined, uapiKey: undefined as string | undefined },
  collect: vi.fn(),
}));
vi.mock("../lib/database", () => ({
  serviceDatabase: () => mocked.database,
  serverConfiguration: () => mocked.configuration,
}));
vi.mock("../lib/adapters", () => ({ collect: mocked.collect }));

import { SOURCES } from "../lib/catalog";
import { mergeHistory, runCollection } from "../lib/collector";
import { getFeed } from "../lib/feed";
import { GET as feedGET } from "../app/api/feed/route";
import { GET as cronGET, POST as cronPOST } from "../app/api/cron/route";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const DAY = 86_400_000;
type Row = { source_id: string; payload: Snapshot; next_attempt: number };

function item(source: Source, at = NOW, overrides: Partial<Item> = {}): Item {
  return { id: `${source.id}:sample`, sourceId: source.id, platform: source.platform,
    title: "真实来源测试记录", url: source.homepage, description: "", region: source.region,
    topics: [source.defaultTopic ?? "technology"], rank: 3, fetchedAt: at, firstSeen: at,
    score: 70, history: [{ at, rank: 3 }], channel: "official", ...overrides };
}
function snapshot(source: Source, items: Item[] = [], nextRefreshAt = NOW - 1): Snapshot {
  return { items, status: { id: source.id, state: "ok", count: items.length,
    fetchedAt: items[0]?.fetchedAt ?? NOW, checkedAt: NOW - 1,
    nextRefreshAt, message: "采集成功", channel: "official" } };
}
function rowsWithDue(ids: string[]): Row[] {
  return SOURCES.map(source => {
    const next_attempt = ids.includes(source.id) ? NOW - 1 : NOW + DAY;
    return { source_id: source.id, payload: snapshot(source, [], next_attempt), next_attempt };
  });
}

function fakeDatabase(rows: Row[] = []) {
  const state = {
    rows, acquire: true, save: true, readError: null as unknown,
    dayBudget: true, monthBudget: true,
    delays: {} as Record<string, number>, failures: {} as Record<string, Error>,
    signals: [] as { operation: string; signal: AbortSignal; at: number }[],
    aborted: [] as string[], completed: [] as string[],
    saves: [] as { source: string; payload: Snapshot; owner: string }[],
    events: [] as string[],
    updates: [] as Record<string, unknown>[],
    inserts: [] as Record<string, unknown>[], updateIds: [] as string[],
    rpc: vi.fn(), from: vi.fn(),
  };
  function resultQuery(operation: string, result: () => unknown) {
    let signal: AbortSignal | undefined;
    let running: Promise<unknown> | undefined;
    const query = {
      abortSignal: vi.fn((value: AbortSignal) => {
        signal = value;
        state.signals.push({ operation, signal: value, at: Date.now() });
        return query;
      }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        running ??= new Promise((finish, fail) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const cleanup = () => { if (timer) clearTimeout(timer); signal?.removeEventListener("abort", abort); };
          const abort = () => { cleanup(); state.aborted.push(operation); fail(signal?.reason); };
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
          const complete = () => {
            cleanup();
            if (state.failures[operation]) { fail(state.failures[operation]); return; }
            state.completed.push(operation);
            finish(result());
          };
          if (state.delays[operation]) timer = setTimeout(complete, state.delays[operation]);
          else void Promise.resolve().then(complete);
        });
        return running.then(resolve, reject);
      },
    };
    return query;
  }
  state.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    state.events.push(name);
    if (name === "save_source_snapshot") state.saves.push({ source: args.p_source_id as string, payload: args.p_payload as Snapshot, owner: args.p_owner as string });
    return resultQuery(name, () => {
      if (name === "acquire_collection_lease") return { data: state.acquire, error: null };
      if (name === "save_source_snapshot") return { data: state.save, error: null };
      if (name === "consume_api_budget") return { data: String(args.p_bucket).startsWith("uapi-day-") ? state.dayBudget : state.monthBudget, error: null };
      return { data: true, error: null };
    });
  });
  state.from.mockImplementation((table: string) => {
    let mutation: Record<string, unknown> | undefined;
    let operation = "read_snapshots";
    let execute: ReturnType<typeof resultQuery> | undefined;
    const query = {
      select: vi.fn(() => query),
      abortSignal: vi.fn((signal: AbortSignal) => {
        execute = resultQuery(operation, () => ({ data: operation === "insert_run" ? { id: mutation?.id ?? "run-id" } : table === "source_snapshots" ? state.rows : mutation ?? [], error: state.readError }));
        execute.abortSignal(signal);
        return query;
      }),
      insert: vi.fn((value: Record<string, unknown>) => { mutation = value; operation = "insert_run"; state.events.push(operation); state.inserts.push(value); return query; }),
      update: vi.fn((value: Record<string, unknown>) => { mutation = value; operation = "update_run"; state.updates.push(value); return query; }),
      upsert: vi.fn((value: Record<string, unknown>) => {
        mutation = value; operation = "update_run"; state.updates.push(value); state.updateIds.push(String(value.id)); return query;
      }),
      single: vi.fn(() => query),
      eq: vi.fn((_column: string, id: string) => { state.updateIds.push(id); return query; }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (!execute) throw new Error("Expected bounded query AbortSignal");
        return execute.then(resolve, reject);
      },
    };
    return query;
  });
  mocked.database = state;
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocked.configuration.configured = true;
  mocked.configuration.youtubeKey = undefined;
  mocked.configuration.uapiKey = undefined;
  mocked.database = null;
  mocked.collect.mockImplementation(async (source: Source, at: number) => ({ items: [item(source, at)], channel: "official" }));
  process.env.CRON_SECRET = "test-only-scheduler-secret";
  delete process.env.UAPI_KEY;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
});

describe("rank history", () => {
  it("preserves discovery, trims one-day history to 24 samples, and compares the prior rank", () => {
    const source = SOURCES[0];
    const previous = item(source, NOW - 60_000, { firstSeen: NOW - 2 * DAY, rank: 9,
      history: [{ at: NOW - DAY - 1, rank: 50 }, ...Array.from({ length: 30 }, (_, index) => ({ at: NOW - (30 - index) * 60_000, rank: index + 1 }))] });
    const merged = mergeHistory([item(source)], [previous])[0];
    expect(merged.firstSeen).toBe(NOW - 2 * DAY);
    expect(merged.previousRank).toBe(9);
    expect(merged.history).toHaveLength(24);
    expect(merged.history.every(entry => entry.at > NOW - DAY)).toBe(true);
    expect(merged.history.at(-1)).toEqual({ at: NOW, rank: 3 });
  });
  it("drops incomparable ranks on a provider switch", () => {
    const source = SOURCES[0];
    const merged = mergeHistory([item(source, NOW, { channel: "UAPI", previousRank: 1 })], [item(source, NOW - DAY, { rank: 9 })])[0];
    expect(merged.firstSeen).toBe(NOW - DAY);
    expect(merged.previousRank).toBeUndefined();
    expect(merged.history).toEqual([{ at: NOW, rank: 3 }]);
  });
});

describe("public feed", () => {
  it("reads durable snapshots without collection, budget RPCs, or writes", async () => {
    const source = SOURCES[0];
    const db = fakeDatabase([{ source_id: source.id, payload: snapshot(source, [item(source)]), next_attempt: NOW - 1 }]);
    const response = await feedGET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect((await response.json()).storage).toBe("durable");
    expect(mocked.collect).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledExactlyOnceWith("source_snapshots");
  });
  it("returns 503 when storage is absent, without transient fabricated fallback", async () => {
    const response = await feedGET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("items");
    expect(mocked.collect).not.toHaveBeenCalled();
  });
  it("uses daily collection freshness and filters expired or invalid records", async () => {
    const wiki = SOURCES.find(source => source.adapter === "wikimedia")!;
    const board = SOURCES[0];
    const wikiSnapshot = snapshot(wiki, [item(wiki, NOW - 12 * 60 * 60_000)]);
    wikiSnapshot.status.upstreamUpdatedAt = NOW - 36 * 60 * 60_000;
    const bad = snapshot(board, [item(board)]);
    bad.status.count = 2;
    fakeDatabase([
      { source_id: wiki.id, payload: wikiSnapshot, next_attempt: NOW + DAY },
      { source_id: board.id, payload: bad, next_attempt: NOW },
    ]);
    const feed = await getFeed();
    expect(feed.items).toHaveLength(1);
    expect(feed.sources.find(source => source.id === wiki.id)?.state).toBe("ok");
    expect(feed.items[0].stale).toBe(false);
    expect(feed.warnings).toHaveLength(1);

    const old = snapshot(board, [item(board, NOW - 73 * 60 * 60_000)]);
    fakeDatabase([{ source_id: board.id, payload: old, next_attempt: NOW }]);
    const expired = await getFeed();
    expect(expired.items).toHaveLength(0);
    expect(expired.sources.find(source => source.id === board.id)?.state).toBe("error");
  });
  it("does not serve historical rows after a platform is classified as restricted", async () => {
    const source = SOURCES.find(source => source.adapter === "restricted")!;
    fakeDatabase([{ source_id: source.id, payload: snapshot(source, [item(source)]), next_attempt: NOW }]);
    const feed = await getFeed();
    expect(feed.items).toHaveLength(0);
    expect(feed.sources.find(status => status.id === source.id)).toMatchObject({ state: "restricted", count: 0 });
  });
});

describe("scheduled collector", () => {
  it("requires durable storage and skips when another instance owns the lease", async () => {
    await expect(runCollection()).rejects.toThrow("尚未配置");
    const db = fakeDatabase();
    db.acquire = false;
    const summary = await runCollection();
    expect(summary.state).toBe("busy");
    expect(db.from).not.toHaveBeenCalled();
    expect(mocked.collect).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["acquire_collection_lease"]);
    db.failures.acquire_collection_lease = new Error("https://backend.test?key=private-value");
    await expect(runCollection()).rejects.toThrow("云端采集锁暂不可用");
  });
  it("processes at most 12 due sources with four workers, fenced saves, and matching owner release", async () => {
    const due = SOURCES.filter(source => source.adapter !== "restricted" && source.adapter !== "youtube").slice(0, 15);
    const db = fakeDatabase(rowsWithDue(due.map(source => source.id)));
    let active = 0;
    let maximum = 0;
    mocked.collect.mockImplementation(async (source: Source, at: number) => {
      active += 1; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      return { items: [item(source, at)], channel: "official" };
    });
    const pending = runCollection("manual");
    await vi.runAllTimersAsync();
    const summary = await pending;
    expect(summary).toMatchObject({ state: "ok", attempted: 12, saved: 12, succeeded: 12 });
    expect(maximum).toBe(4);
    expect(mocked.collect.mock.calls.every(call => call[6] === NOW + 45_000)).toBe(true);
    const acquire = db.rpc.mock.calls.find(([name]) => name === "acquire_collection_lease")![1];
    expect(db.saves.every(save => save.owner === acquire.p_owner)).toBe(true);
    expect(db.rpc.mock.calls.at(-1)).toEqual(["release_collection_lease", { p_key: "feed", p_owner: acquire.p_owner }]);
    expect(db.updates[0]).toMatchObject({ status: "succeeded" });
  });
  it("retains only 72-hour records on source failures and sanitizes upstream errors", async () => {
    const source = SOURCES[0];
    const rows = rowsWithDue([source.id]);
    const old = snapshot(source, [item(source, NOW - 2 * DAY), item(source, NOW - 4 * DAY, { id: `${source.id}:expired` })]);
    rows.find(row => row.source_id === source.id)!.payload = old;
    const db = fakeDatabase(rows);
    mocked.collect.mockRejectedValue(new Error("https://provider.test?key=private-value Bearer SECRET"));
    const summary = await runCollection();
    expect(summary).toMatchObject({ state: "degraded", failed: 1, saved: 1 });
    const saved = db.saves[0].payload;
    expect(saved.items).toHaveLength(1);
    expect(saved.status.state).toBe("cached");
    expect(saved.status.message).not.toMatch(/private-value|SECRET|https/);
    expect(saved.status.nextRefreshAt).toBeGreaterThanOrEqual(NOW + 30 * 60_000);
  });
  it("persists restricted platform statuses and checks missing YouTube authorization daily", async () => {
    const restricted = SOURCES.find(source => source.adapter === "restricted")!;
    const youtube = SOURCES.find(source => source.adapter === "youtube")!;
    const db = fakeDatabase(rowsWithDue([restricted.id, youtube.id]));
    const summary = await runCollection();
    expect(summary).toMatchObject({ restricted: 2, saved: 2 });
    expect(mocked.collect).not.toHaveBeenCalled();
    expect(db.saves.every(save => save.payload.status.state === "restricted" && save.payload.status.nextRefreshAt === NOW + DAY)).toBe(true);
  });
  it("charges shared day and month budgets before anonymous UAPI and applies six-hour failure backoff", async () => {
    const source = SOURCES.find(source => source.adapter === "uapi")!;
    const db = fakeDatabase(rowsWithDue([source.id]));
    db.monthBudget = false;
    let permitted = true;
    mocked.collect.mockImplementation(async (_source, _at, _key, _uapi, permit) => {
      permitted = await permit();
      throw new Error("来源访客请求预算已达上限");
    });
    await runCollection();
    expect(permitted).toBe(false);
    const charges = db.rpc.mock.calls.filter(([name]) => name === "consume_api_budget").map(([, args]) => args);
    expect(charges).toEqual([
      { p_bucket: "uapi-day-2026-09-27", p_limit: 40, p_expires: Date.parse("2026-09-28T00:00:00Z") },
      { p_bucket: "uapi-month-2026-09", p_limit: 1200, p_expires: Date.parse("2026-10-01T00:00:00Z") },
    ]);
    expect(db.saves[0].payload.status.nextRefreshAt).toBe(NOW + 6 * 60 * 60_000);
  });
  it("limits fallback attempts and stops scheduling after 40 seconds", async () => {
    const due = SOURCES.filter(source => source.adapter === "sixty" || source.adapter === "uapi");
    fakeDatabase(rowsWithDue(due.map(source => source.id)));
    let accepted = 0;
    mocked.collect.mockImplementation(async (source: Source, at: number, _key, _uapi, _permit, reserve) => {
      if (reserve()) accepted += 1;
      if (reserve()) accepted += 1;
      await new Promise(resolve => setTimeout(resolve, 41_000));
      return { items: [item(source, at)], channel: "official" };
    });
    const pending = runCollection();
    await vi.runAllTimersAsync();
    const summary = await pending;
    expect(accepted).toBe(4);
    expect(summary.attempted).toBe(4);
    expect(summary.deferred).toBeGreaterThan(0);
    expect(summary.state).toBe("degraded");
  });
  it("backs off a failed anonymous UAPI fallback and respects a longer Retry-After", async () => {
    const source = SOURCES.find(source => source.adapter === "sixty")!;
    const db = fakeDatabase(rowsWithDue([source.id]));
    db.dayBudget = false;
    mocked.collect.mockImplementation(async (_source, _at, _key, _uapi, permit) => {
      expect(await permit()).toBe(false);
      throw new Error("来源访客请求预算已达上限");
    });
    await runCollection();
    expect(db.saves[0].payload.status.nextRefreshAt).toBe(NOW + 6 * 60 * 60_000);
    const dbRetry = fakeDatabase(rowsWithDue([source.id]));
    const error = Object.assign(new Error("HTTP 429"), { retryAfterMs: 2 * DAY });
    mocked.collect.mockRejectedValue(error);
    await runCollection();
    expect(dbRetry.saves[0].payload.status.message).toBe("HTTP 429");
    expect(dbRetry.saves[0].payload.status.nextRefreshAt).toBe(NOW + 2 * DAY);
  });
  it("waits for in-flight work before releasing a lost lease and rejects later writes", async () => {
    const due = SOURCES.filter(source => source.adapter !== "restricted" && source.adapter !== "youtube").slice(0, 4);
    const db = fakeDatabase(rowsWithDue(due.map(source => source.id)));
    db.save = false;
    let finished = 0;
    mocked.collect.mockImplementation(async (source: Source, at: number) => {
      await new Promise(resolve => setTimeout(resolve, source.id === due[0].id ? 1 : 100));
      finished += 1;
      return { items: [item(source, at)], channel: "official" };
    });
    const pending = runCollection();
    await vi.advanceTimersByTimeAsync(10);
    expect(db.events).not.toContain("release_collection_lease");
    await vi.runAllTimersAsync();
    const summary = await pending;
    expect(finished).toBe(4);
    expect(db.saves).toHaveLength(1);
    expect(summary).toMatchObject({ state: "degraded", saved: 0 });
    expect(db.events.at(-1)).toBe("release_collection_lease");
  });
  it("does not attempt snapshot writes after its 50-second lease expires", async () => {
    const source = SOURCES[0];
    const db = fakeDatabase(rowsWithDue([source.id]));
    mocked.collect.mockImplementation(async () => { vi.setSystemTime(NOW + 50_001); return { items: [item(source)], channel: "official" }; });
    const summary = await runCollection();
    expect(db.saves).toHaveLength(0);
    expect(summary).toMatchObject({ state: "degraded", saved: 0 });
  });
});

describe("whole-request collection budget", () => {
  it("uses the caller's absolute deadline after permission time has elapsed", async () => {
    const source = SOURCES[0];
    const db = fakeDatabase(rowsWithDue([source.id]));
    vi.setSystemTime(NOW + 20_000);
    const summary = await runCollection("manual", NOW + 55_000);
    expect(summary).toMatchObject({ state: "ok", saved: 1 });
    expect(mocked.collect.mock.calls[0][6]).toBe(NOW + 45_000);
    expect(db.rpc.mock.calls[0][1].p_ttl).toBe(30_000);
    expect(db.signals.map(entry => entry.operation)).toContain("save_source_snapshot");
    expect(db.signals.map(entry => entry.operation)).toContain("update_run");
    expect(db.signals.map(entry => entry.operation)).toContain("release_collection_lease");
  });
  it("does not acquire a lease when only the reserved cleanup budget remains", async () => {
    const db = fakeDatabase();
    await expect(runCollection("manual", NOW + 5_000)).rejects.toThrow("剩余时间不足");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("ends a stalled adapter before the lease expires and skips late fallback work", async () => {
    const source = SOURCES[0];
    const db = fakeDatabase(rowsWithDue([source.id]));
    let tryFallback: (() => boolean) | undefined;
    mocked.collect.mockImplementation((_source, _at, _key, _uapi, _permit, reserve) => {
      tryFallback = reserve;
      return new Promise(() => {});
    });
    const pending = runCollection();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ state: "degraded", attempted: 1, failed: 1, saved: 1 });
    expect(Date.now()).toBe(NOW + 45_000);
    expect(tryFallback?.()).toBe(false);
    expect(db.saves[0].payload.status.state).toBe("error");
    expect(db.events.at(-1)).toBe("release_collection_lease");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a slow acquire and attempts only an owner-scoped release", async () => {
    const db = fakeDatabase();
    db.delays.acquire_collection_lease = 60_000;
    const pending = expect(runCollection()).rejects.toThrow("云端采集锁暂不可用");
    await vi.runAllTimersAsync();
    await pending;
    expect(Date.now()).toBe(NOW + 8_000);
    expect(db.aborted).toContain("acquire_collection_lease");
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls[1]).toEqual(["release_collection_lease", { p_key: "feed", p_owner: db.rpc.mock.calls[0][1].p_owner }]);
  });
  it("bounds slow snapshot reads and runs both cleanup operations concurrently", async () => {
    const db = fakeDatabase();
    db.delays.read_snapshots = 60_000;
    db.delays.update_run = 60_000;
    db.delays.release_collection_lease = 60_000;
    const pending = runCollection();
    await vi.runAllTimersAsync();
    expect((await pending).state).toBe("degraded");
    expect(Date.now()).toBe(NOW + 11_000);
    expect(db.aborted).toEqual(expect.arrayContaining(["read_snapshots", "update_run", "release_collection_lease"]));
    const cleanup = db.signals.filter(entry => entry.operation === "update_run" || entry.operation === "release_collection_lease");
    expect(cleanup.every(entry => entry.at === NOW + 8_000)).toBe(true);
    expect(mocked.collect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("can terminate the known run ID when an insert response times out", async () => {
    const db = fakeDatabase();
    db.delays.insert_run = 60_000;
    const pending = runCollection();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ state: "degraded", attempted: 0 });
    expect(db.aborted).toContain("insert_run");
    expect(db.inserts[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.updateIds).toEqual([db.inserts[0].id]);
    expect(db.updates[0]).toMatchObject({ status: "failed" });
    expect(Date.now()).toBe(NOW + 8_000);
  });
  it("uses remaining write time and finishes bounded cleanup before the route deadline", async () => {
    const source = SOURCES[0];
    const db = fakeDatabase(rowsWithDue([source.id]));
    db.delays.save_source_snapshot = 60_000;
    db.delays.update_run = 60_000;
    db.delays.release_collection_lease = 60_000;
    vi.setSystemTime(NOW + 30_000);
    mocked.collect.mockImplementation(async (collected: Source, at: number) => {
      await new Promise(resolve => setTimeout(resolve, 14_000));
      return { items: [item(collected, at)], channel: "official" };
    });
    const pending = runCollection("manual", NOW + 55_000);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ state: "degraded", saved: 0 });
    expect(Date.now()).toBe(NOW + 53_000);
    expect(db.aborted).toContain("save_source_snapshot");
    expect(db.signals.find(entry => entry.operation === "save_source_snapshot")?.at).toBe(NOW + 44_000);
    expect(db.signals.filter(entry => entry.operation === "update_run" || entry.operation === "release_collection_lease").every(entry => entry.at === NOW + 50_000)).toBe(true);
    expect(db.completed).not.toContain("save_source_snapshot");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts slow shared budget reservations before attempting upstream UAPI", async () => {
    const source = SOURCES.find(source => source.adapter === "uapi")!;
    const db = fakeDatabase(rowsWithDue([source.id]));
    db.delays.consume_api_budget = 60_000;
    let permitted = false;
    mocked.collect.mockImplementation(async (_source, _at, _key, _uapi, permit) => {
      permitted = await permit();
      throw new Error("来源访客请求预算已达上限");
    });
    const pending = runCollection();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ state: "degraded", failed: 1, saved: 1 });
    expect(permitted).toBe(false);
    expect(db.aborted).toContain("consume_api_budget");
    expect(db.rpc.mock.calls.filter(([name]) => name === "consume_api_budget")).toHaveLength(1);
    expect(db.saves[0].payload.status.nextRefreshAt).toBe(NOW + 8_000 + 6 * 60 * 60_000);
  });
});

describe("cron endpoint", () => {
  it("requires Bearer authorization on GET and POST and ignores query secrets", async () => {
    const db = fakeDatabase(rowsWithDue([]));
    const query = new Request("https://atlas.test/api/cron?secret=test-only-scheduler-secret");
    expect((await cronGET(query)).status).toBe(401);
    expect((await cronPOST(query)).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
    const authorized = new Request("https://atlas.test/api/cron", { headers: { authorization: "Bearer test-only-scheduler-secret" } });
    expect((await cronPOST(authorized)).status).toBe(200);
  });
  it("returns configuration 503 before any job when scheduler credentials are missing", async () => {
    const db = fakeDatabase();
    delete process.env.CRON_SECRET;
    expect((await cronGET(new Request("https://atlas.test/api/cron"))).status).toBe(503);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
