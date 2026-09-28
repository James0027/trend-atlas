import { SOURCES } from "./catalog";
import { serviceDatabase } from "./database";
import { SNAPSHOT_RETENTION, sourceInterval } from "./source-policy";
import { validSnapshot } from "./validate";
import type { Feed, Item, Source, SourceStatus } from "./types";

export type Snapshot = { items: Item[]; status: SourceStatus };

function missingStatus(source: Source, now: number): SourceStatus {
  const restricted = source.adapter === "restricted";
  return {
    id: source.id,
    state: restricted ? "restricted" : "error",
    count: 0,
    fetchedAt: null,
    checkedAt: now,
    nextRefreshAt: now + 60_000,
    message: restricted ? source.note : "等待云端定时任务首次采集。",
  };
}

/** Public reads only consume the shared snapshots. They never invoke adapters. */
export async function getFeed(): Promise<Feed> {
  const db = serviceDatabase();
  if (!db) throw new Error("趋势数据库尚未配置");
  const { data, error } = await db.from("source_snapshots")
    .select("source_id,payload")
    .abortSignal(AbortSignal.timeout(8_000));
  if (error) throw new Error("趋势数据库暂不可用");

  const now = Date.now();
  const snapshots = new Map<string, Snapshot>();
  const warnings: string[] = [];
  for (const row of data ?? []) {
    if (validSnapshot(row.payload, row.source_id)
      && row.payload.status.count === row.payload.items.length) {
      snapshots.set(row.source_id, row.payload);
    } else {
      warnings.push("一份来源快照未通过校验，已等待云端重新采集。");
    }
  }

  const items: Item[] = [];
  const sources = SOURCES.map((source): SourceStatus => {
    const snapshot = snapshots.get(source.id);
    if (!snapshot) return missingStatus(source, now);
    if (source.adapter === "restricted") {
      return { id: source.id, state: "restricted", count: 0, fetchedAt: null,
        checkedAt: snapshot.status.checkedAt, nextRefreshAt: snapshot.status.nextRefreshAt,
        message: source.note };
    }
    const stored = snapshot.status;
    const retained = snapshot.items.filter(item => now - item.fetchedAt <= SNAPSHOT_RETENTION);
    // Freshness measures successful collection time. A daily Wikimedia report
    // or a research publication date is not a 15-minute live-board timestamp.
    const aged = stored.fetchedAt !== null
      && now - stored.fetchedAt > sourceInterval(source, stored.channel) * 1.5;
    const state = stored.state === "restricted" ? "restricted"
      : retained.length === 0 && snapshot.items.length > 0 ? "error"
      : aged && retained.length > 0 ? "cached" : stored.state;
    const status: SourceStatus = {
      id: source.id,
      state,
      count: retained.length,
      fetchedAt: stored.fetchedAt,
      checkedAt: stored.checkedAt,
      nextRefreshAt: stored.nextRefreshAt,
      message: retained.length === 0 && snapshot.items.length > 0
        ? "上次成功数据已超过保留期限，等待定时重试。"
        : aged && stored.state === "ok" ? "最近采集已超过来源更新周期，正在显示上次成功数据。"
          : stored.message,
      ...(stored.channel === undefined ? {} : { channel: stored.channel }),
      ...(stored.upstreamUpdatedAt === undefined ? {} : { upstreamUpdatedAt: stored.upstreamUpdatedAt }),
    };
    for (const item of retained) {
      // Enumerate public fields: an unexpected property cannot escape a row.
      items.push({
        id: item.id, sourceId: item.sourceId, platform: item.platform,
        title: item.title, url: item.url, description: item.description,
        region: item.region, topics: item.topics, rank: item.rank,
        fetchedAt: item.fetchedAt, firstSeen: item.firstSeen, score: item.score,
        history: item.history.map(entry => ({ at: entry.at, rank: entry.rank })),
        ...(item.metric === undefined ? {} : { metric: item.metric }),
        ...(item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
        ...(item.previousRank === undefined ? {} : { previousRank: item.previousRank }),
        ...(item.publisher === undefined ? {} : { publisher: item.publisher }),
        ...(item.sampleSize === undefined ? {} : { sampleSize: item.sampleSize }),
        ...(item.channel === undefined ? {} : { channel: item.channel }),
        stale: state === "cached",
      });
    }
    return status;
  });
  return { items, sources, generatedAt: now, refreshAfter: 60_000, storage: "durable", warnings: [...new Set(warnings)] };
}
