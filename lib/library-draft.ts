import { emptyLibrary, parseLibrary } from "./library";
import type { LibraryData, LibraryOperation } from "./library";

export const DRAFT_MAX_BYTES = 500_000;
export const DRAFT_MAX_OPERATIONS = 2_000;
export const DRAFT_MAX_AGE = 7 * 24 * 60 * 60_000;
export type DraftEntry = { token: string; operation: LibraryOperation };
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoredDraft = { version: 1; owner: string; updatedAt: number; entries: DraftEntry[] };
const uidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeId = (value: unknown): value is string => typeof value === "string"
  && /^[a-zA-Z0-9:_-]{1,199}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const ownKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value
  && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

export function draftKey(owner: string): string {
  if (!uidPattern.test(owner)) throw new Error("草稿账号标识无效");
  return `ta-library-draft:v1:${owner}`;
}

/** Validate each operation independently; drafts never contain a synced library. */
function parseOperation(value: unknown): LibraryOperation {
  if (ownKeys(value, ["section"]) && value.section === "clear") return { section: "clear" };
  if (!ownKeys(value, ["section", "id", "value"]) || !safeId(value.id)) throw new Error("草稿操作格式无效");
  const id = value.id;
  if (typeof value.section !== "string" || !["bookmarks", "views", "overrides"].includes(value.section)) throw new Error("草稿操作格式无效");
  if (value.value === null) return { section: value.section, id, value: null } as LibraryOperation;
  if (value.section === "bookmarks") {
    const parsed = parseLibrary({ ...emptyLibrary(), bookmarks: [value.value] }).bookmarks[0];
    if (parsed.id !== id) throw new Error("草稿记录标识不一致");
    return { section: "bookmarks", id, value: parsed };
  }
  if (value.section === "views") {
    if (!ownKeys(value.value, ["id", "name", "filters"]) || !ownKeys(value.value.filters,
      ["query", "region", "topics", "platforms", "sort", "time", "dedupe"])) throw new Error("草稿视图格式无效");
    const filters = value.value.filters;
    const parsed = parseLibrary({ ...emptyLibrary(), views: [value.value] }).views[0];
    if (parsed.id !== id || Object.entries(parsed.filters).some(([key, entry]) => JSON.stringify(entry) !== JSON.stringify(filters[key]))) throw new Error("草稿视图格式无效");
    return { section: "views", id, value: parsed };
  }
  const parsed = parseLibrary({ ...emptyLibrary(), overrides: { [id]: value.value } }).overrides[id];
  return { section: "overrides", id, value: parsed };
}

function compact(entries: DraftEntry[]): DraftEntry[] {
  const result = new Map<string, DraftEntry>();
  for (const entry of entries) {
    const op = entry.operation;
    if (op.section === "clear") result.clear();
    const key = op.section === "clear" ? "clear" : `${op.section}:${op.id}`;
    // Retain the last operation's position as well as its value.
    result.delete(key); result.set(key, entry);
  }
  return [...result.values()];
}

export function appendDraft(entries: DraftEntry[], operations: LibraryOperation[]): DraftEntry[] {
  const next = compact([...entries, ...operations.map(operation => ({ token: crypto.randomUUID(), operation: parseOperation(operation) }))]);
  if (next.length > DRAFT_MAX_OPERATIONS) throw new Error("未同步改动过多，请先重试同步或放弃草稿");
  return next;
}
export function draftOperations(entries: DraftEntry[]): LibraryOperation[] { return entries.map(entry => entry.operation); }

/** Bookmark operations prepend; reverse them to retain the guest's visible order. */
export function guestImportOperations(guest: LibraryData): LibraryOperation[] {
  return [
    ...[...guest.bookmarks].reverse().map(item => ({ section: "bookmarks" as const, id: item.id, value: item })),
    ...guest.views.map(view => ({ section: "views" as const, id: view.id, value: view })),
    ...Object.entries(guest.overrides).map(([id, value]) => ({ section: "overrides" as const, id, value })),
  ];
}

/** Read legacy guest sections independently so one damaged key cannot hide the others. */
export function readGuestLibrary(storage: Pick<Storage, "getItem">): LibraryData {
  const empty = emptyLibrary();
  function section<K extends keyof LibraryData>(key: string, name: K): LibraryData[K] {
    try {
      const serialized = storage.getItem(key);
      return serialized ? parseLibrary({ ...empty, [name]: JSON.parse(serialized) })[name] : empty[name];
    } catch { return empty[name]; }
  }
  return {
    bookmarks: section("ta-bookmarks", "bookmarks"),
    views: section("ta-views", "views"),
    overrides: section("ta-overrides", "overrides"),
  };
}

export function acknowledgeDraft(entries: DraftEntry[], confirmed: DraftEntry[]): DraftEntry[] {
  const tokens = new Set(confirmed.map(entry => entry.token));
  return entries.filter(entry => !tokens.has(entry.token));
}

export function writeLibraryDraft(storage: DraftStorage, owner: string, entries: DraftEntry[], now = Date.now()): void {
  const key = draftKey(owner);
  if (!entries.length) {
    try { storage.removeItem(key); } catch { throw new Error("当前标签页草稿无法清除，请重试后再退出或关闭页面"); }
    return;
  }
  const draft: StoredDraft = { version: 1, owner, updatedAt: now, entries };
  const serialized = JSON.stringify(draft);
  if (entries.length > DRAFT_MAX_OPERATIONS || bytes(serialized) > DRAFT_MAX_BYTES) throw new Error("未同步草稿已达容量上限，请先重试同步或放弃草稿");
  try { storage.setItem(key, serialized); }
  catch { throw new Error("当前标签页无法保存草稿，本次改动未接受；请检查浏览器存储后重试"); }
}

export function readLibraryDraft(storage: DraftStorage, owner: string, now = Date.now()): { entries: DraftEntry[]; warning?: string } {
  const key = draftKey(owner);
  let serialized: string | null;
  try { serialized = storage.getItem(key); }
  catch { return { entries: [], warning: "当前标签页草稿无法读取，请检查浏览器存储后再修改收藏" }; }
  if (!serialized) return { entries: [] };
  let expired = false;
  try {
    if (serialized.length > DRAFT_MAX_BYTES || bytes(serialized) > DRAFT_MAX_BYTES) throw new Error("oversize");
    const draft: unknown = JSON.parse(serialized);
    if (!ownKeys(draft, ["version", "owner", "updatedAt", "entries"]) || draft.version !== 1 || draft.owner !== owner
      || typeof draft.updatedAt !== "number" || !Number.isSafeInteger(draft.updatedAt) || draft.updatedAt <= 0
      || draft.updatedAt > now + 300_000 || !Array.isArray(draft.entries)
      || draft.entries.length > DRAFT_MAX_OPERATIONS) throw new Error("invalid");
    expired = now - draft.updatedAt >= DRAFT_MAX_AGE;
    if (expired) throw new Error("expired");
    const tokens = new Set<string>();
    const entries = draft.entries.map(entry => {
      if (!ownKeys(entry, ["token", "operation"]) || typeof entry.token !== "string"
        || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.token) || tokens.has(entry.token)) throw new Error("invalid");
      tokens.add(entry.token);
      return { token: entry.token, operation: parseOperation(entry.operation) };
    });
    return { entries: compact(entries) };
  } catch {
    let removed = true;
    try { storage.removeItem(key); } catch { removed = false; }
    return { entries: [], warning: expired ? "未同步草稿已超过 7 天有效期，未恢复旧改动"
      : removed ? "未同步草稿未通过校验，已移除损坏记录" : "未同步草稿未通过校验且无法清除，未恢复旧改动" };
  }
}
