import { TOPICS } from "./catalog";
import { sanitizeFilters, validItem } from "./validate";
import type { Item, SavedView, Topic } from "./types";

export type LibraryData = { bookmarks: Item[]; views: SavedView[]; overrides: Record<string, Topic[]> };
export type LibraryRecord = { data: LibraryData; revision: number };
export type LibraryOperation =
  | { section: "bookmarks"; id: string; value: Item | null }
  | { section: "views"; id: string; value: SavedView | null }
  | { section: "overrides"; id: string; value: Topic[] | null }
  | { section: "clear" };
export function emptyLibrary(): LibraryData { return { bookmarks: [], views: [], overrides: {} }; }
const safeId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9:_-]{1,200}$/.test(id)
  && !["__proto__", "constructor", "prototype"].includes(id);
export function parseLibrary(value: unknown): LibraryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("收藏数据格式不正确");
  const data = value as LibraryData;
  if (!Array.isArray(data.bookmarks) || data.bookmarks.length > 500 || !data.bookmarks.every(validItem)
    || !Array.isArray(data.views) || data.views.length > 20 || !data.overrides || typeof data.overrides !== "object"
    || Array.isArray(data.overrides) || Object.keys(data.overrides).length > 1000) throw new Error("收藏数据超出范围或格式不正确");
  const ids = new Set<string>();
  const bookmarks = data.bookmarks.map(item => {
    if (!safeId(item.id) || ids.has(item.id)) throw new Error("收藏记录重复或无效");
    ids.add(item.id);
    const result: Item = { id: item.id, sourceId: item.sourceId, platform: item.platform, title: item.title,
      url: item.url, description: item.description, region: item.region, topics: item.topics, rank: item.rank,
      fetchedAt: item.fetchedAt, firstSeen: item.firstSeen, score: item.score, history: item.history };
    if (item.metric !== undefined) result.metric = String(item.metric).slice(0, 150);
    if (item.publisher !== undefined) result.publisher = String(item.publisher).slice(0, 150);
    if (item.channel !== undefined) result.channel = String(item.channel).slice(0, 150);
    if (item.publishedAt !== undefined) result.publishedAt = item.publishedAt;
    if (item.sampleSize !== undefined) result.sampleSize = item.sampleSize;
    if (item.previousRank !== undefined) result.previousRank = item.previousRank;
    return result;
  });
  const viewIds = new Set<string>();
  const views = data.views.map(view => {
    if (!view || !safeId(view.id) || viewIds.has(view.id) || typeof view.name !== "string" || !view.name.trim() || view.name.length > 40)
      throw new Error("保存视图格式不正确");
    viewIds.add(view.id);
    return { id: view.id, name: view.name.trim(), filters: sanitizeFilters(view.filters) };
  });
  const overrides = Object.fromEntries(Object.entries(data.overrides).map(([id, topics]) => {
    if (!safeId(id) || !Array.isArray(topics) || topics.length > 12 || !topics.every(topic => TOPICS.some(entry => entry.id === topic)))
      throw new Error("主题校正格式不正确");
    return [id, [...new Set(topics)]];
  }));
  return { bookmarks, views, overrides };
}
export function applyOperations(base: LibraryData, operations: LibraryOperation[]): LibraryData {
  let next: LibraryData = { bookmarks: [...base.bookmarks], views: [...base.views], overrides: { ...base.overrides } };
  for (const op of operations) {
    if (op.section === "clear") { next = emptyLibrary(); continue; }
    if (op.section === "bookmarks") {
      next.bookmarks = next.bookmarks.filter(item => item.id !== op.id);
      if (op.value) next.bookmarks.unshift(op.value);
      next.bookmarks = next.bookmarks.slice(0, 500);
    } else if (op.section === "views") {
      next.views = next.views.filter(view => view.id !== op.id);
      if (op.value) next.views.push(op.value);
      next.views = next.views.slice(-20);
    } else if (op.value) next.overrides[op.id] = op.value;
    else delete next.overrides[op.id];
  }
  return next;
}
export function libraryDiff<K extends keyof LibraryData>(section: K, before: LibraryData[K], after: LibraryData[K]): LibraryOperation[] {
  const old = section === "overrides" ? new Map(Object.entries(before)) : new Map((before as (Item | SavedView)[]).map(item => [item.id, item]));
  const next = section === "overrides" ? new Map(Object.entries(after)) : new Map((after as (Item | SavedView)[]).map(item => [item.id, item]));
  const operations: LibraryOperation[] = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id))) operations.push({ section, id, value: next.get(id) || null } as LibraryOperation);
  }
  return operations;
}
