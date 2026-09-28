import { describe, expect, it } from "vitest";
import { acknowledgeDraft, appendDraft, DRAFT_MAX_AGE, DRAFT_MAX_BYTES, DRAFT_MAX_OPERATIONS,
  draftKey, draftOperations, guestImportOperations, readGuestLibrary, readLibraryDraft, writeLibraryDraft } from "../lib/library-draft";
import type { DraftEntry } from "../lib/library-draft";
import { applyOperations, emptyLibrary } from "../lib/library";
import type { LibraryOperation } from "../lib/library";
import { DEFAULT_FILTERS } from "../lib/explore";
import type { Item } from "../lib/types";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.now();
class MemoryStorage {
  values = new Map<string, string>();
  reads: string[] = [];
  failWrite = false; failRead = false; failRemove = false;
  getItem(key: string) { this.reads.push(key); if (this.failRead) throw new Error("blocked"); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw new Error("quota"); this.values.set(key, value); }
  removeItem(key: string) { if (this.failRemove) throw new Error("blocked"); this.values.delete(key); }
}
function item(id: string): Item {
  return { id: `hackernews:${id}`, sourceId: "hackernews", platform: "Hacker News", title: id,
    description: "", region: "GLOBAL", topics: ["technology"], url: `https://news.ycombinator.com/item?id=${id}`,
    rank: 1, score: 100, fetchedAt: NOW, firstSeen: NOW, sampleSize: 10, history: [{ at: NOW, rank: 1 }] };
}
const add = (id: string): LibraryOperation => ({ section: "bookmarks", id: `hackernews:${id}`, value: item(id) });
const entry = (token: string, operation: LibraryOperation): DraftEntry => ({ token, operation });
function inject(storage: MemoryStorage, fields: Record<string, unknown>) {
  storage.values.set(draftKey(OWNER), JSON.stringify({ version: 1, owner: OWNER, updatedAt: NOW, entries: [], ...fields }));
}

describe("account-scoped tab drafts", () => {
  it("stores only pending operations and restores them for the same uid", () => {
    const storage = new MemoryStorage();
    const pending = appendDraft([], [add("a")]);
    writeLibraryDraft(storage, OWNER, pending, NOW);
    expect(readLibraryDraft(storage, OWNER, NOW).entries).toEqual(pending);
    const stored = JSON.parse(storage.values.get(draftKey(OWNER))!);
    expect(Object.keys(stored).sort()).toEqual(["entries", "owner", "updatedAt", "version"]);
    expect(stored).not.toHaveProperty("data"); expect(stored).not.toHaveProperty("revision");
  });
  it("never reads or restores another uid's draft and does not accept a guest key", () => {
    const storage = new MemoryStorage();
    writeLibraryDraft(storage, OWNER, appendDraft([], [add("private")]), NOW);
    expect(readLibraryDraft(storage, OTHER, NOW).entries).toEqual([]);
    expect(storage.reads).toEqual([draftKey(OTHER)]);
    expect(storage.values.has(draftKey(OWNER))).toBe(true);
    expect(() => draftKey("guest")).toThrow("账号标识");
  });
  it("replays a restored draft onto the latest baseline rather than a cached library", () => {
    const storage = new MemoryStorage();
    const pending = appendDraft([], [add("local"), { section: "bookmarks", id: "hackernews:removed", value: null }]);
    writeLibraryDraft(storage, OWNER, pending, NOW);
    const baseline = { ...emptyLibrary(), bookmarks: [item("remote"), item("removed")], overrides: { remote: ["ai" as const] } };
    const merged = applyOperations(baseline, draftOperations(readLibraryDraft(storage, OWNER, NOW).entries));
    expect(merged.bookmarks.map(value => value.id)).toEqual(["hackernews:local", "hackernews:remote"]);
    expect(merged.overrides).toEqual(baseline.overrides);
  });
  it("imports guest bookmarks in visible order and is idempotent on repeated import", () => {
    const guest = { ...emptyLibrary(), bookmarks: [item("newest"), item("older")],
      overrides: { "hackernews:newest": ["ai" as const] } };
    const baseline = { ...emptyLibrary(), bookmarks: [item("remote")] };
    const operations = guestImportOperations(guest);
    const imported = applyOperations(baseline, operations);
    expect(imported.bookmarks.map(value => value.id)).toEqual([
      "hackernews:newest", "hackernews:older", "hackernews:remote",
    ]);
    expect(applyOperations(imported, operations)).toEqual(imported);
  });
  it("keeps intact guest sections when one browser-storage value is damaged", () => {
    const storage = new MemoryStorage();
    storage.values.set("ta-bookmarks", JSON.stringify([item("saved")]));
    storage.values.set("ta-views", "{broken");
    storage.values.set("ta-overrides", JSON.stringify({ "hackernews:saved": ["ai"] }));
    const guest = readGuestLibrary(storage);
    expect(guest.bookmarks.map(value => value.id)).toEqual(["hackernews:saved"]);
    expect(guest.views).toEqual([]);
    expect(guest.overrides).toEqual({ "hackernews:saved": ["ai"] });
  });
  it("deduplicates repeated section/id changes and retains last-operation order", () => {
    const all = [add("a"), add("b"), add("a")];
    const compacted = appendDraft([], all);
    expect(compacted).toHaveLength(2);
    expect(applyOperations(emptyLibrary(), draftOperations(compacted))).toEqual(applyOperations(emptyLibrary(), all));
    let changes: DraftEntry[] = [];
    for (let n = 0; n < 1_000; n++) changes = appendDraft(changes, [{ section: "overrides", id: "topic", value: n % 2 ? ["ai"] : null }]);
    expect(changes).toHaveLength(1);
  });
  it("clear discards earlier changes while preserving subsequent intent", () => {
    const operations: LibraryOperation[] = [add("discarded"), { section: "clear" }, add("a"),
      { section: "clear" }, add("b"), { section: "overrides", id: "b", value: ["beauty"] }];
    const pending = appendDraft([], operations);
    expect(pending.map(value => value.operation.section)).toEqual(["clear", "bookmarks", "overrides"]);
    const baseline = { ...emptyLibrary(), bookmarks: [item("remote")] };
    expect(applyOperations(baseline, draftOperations(pending))).toEqual(applyOperations(baseline, operations));
  });
  it("confirmation removes only exact tokens, keeping edits made during a request", () => {
    const batch = appendDraft([], [add("a")]);
    const pending = appendDraft(batch, [{ section: "bookmarks", id: "hackernews:a", value: null }, add("b")]);
    const remaining = acknowledgeDraft(pending, batch);
    expect(remaining).toEqual(pending); expect(remaining).toHaveLength(2);
  });
  it("confirmation cannot remove a newer clear or later operations", () => {
    const batch = appendDraft([], [add("a"), add("b")]);
    const pending = appendDraft(batch, [{ section: "clear" }, add("c")]);
    expect(acknowledgeDraft(pending, batch)).toEqual(pending);
  });
  it("updates durable pending entries after confirmation and removes an empty draft", () => {
    const storage = new MemoryStorage();
    const batch = appendDraft([], [add("a")]);
    const pending = appendDraft(batch, [add("b")]);
    writeLibraryDraft(storage, OWNER, pending, NOW);
    const remaining = acknowledgeDraft(pending, batch);
    writeLibraryDraft(storage, OWNER, remaining, NOW + 1);
    expect(readLibraryDraft(storage, OWNER, NOW + 1).entries).toEqual(remaining);
    writeLibraryDraft(storage, OWNER, [], NOW + 2);
    expect(storage.values.has(draftKey(OWNER))).toBe(false);
  });
  it("discarding an account draft leaves another account untouched", () => {
    const storage = new MemoryStorage();
    writeLibraryDraft(storage, OWNER, appendDraft([], [add("a")]), NOW);
    writeLibraryDraft(storage, OTHER, appendDraft([], [add("b")]), NOW);
    writeLibraryDraft(storage, OWNER, [], NOW);
    expect(readLibraryDraft(storage, OTHER, NOW).entries).toHaveLength(1);
  });
  it("expires drafts after seven days with an explicit warning", () => {
    const storage = new MemoryStorage();
    writeLibraryDraft(storage, OWNER, appendDraft([], [add("a")]), NOW);
    const restored = readLibraryDraft(storage, OWNER, NOW + DRAFT_MAX_AGE);
    expect(restored.entries).toEqual([]); expect(restored.warning).toContain("7 天");
    expect(storage.values.has(draftKey(OWNER))).toBe(false);
  });
  it.each([{ version: 2 }, { owner: OTHER }, { updatedAt: NOW + 300_001 }, { updatedAt: Infinity },
    { entries: {} }, { data: emptyLibrary() }])("rejects invalid envelope %j", fields => {
    const storage = new MemoryStorage(); inject(storage, fields);
    expect(readLibraryDraft(storage, OWNER, NOW)).toMatchObject({ entries: [], warning: expect.any(String) });
    expect(storage.values.has(draftKey(OWNER))).toBe(false);
  });
  it.each([{ section: "clear", id: "extra" }, { section: "unknown", id: "a", value: null },
    { section: "overrides", id: "__proto__", value: ["ai"] }, { section: "overrides", id: "a", value: ["invalid"] },
    { section: "bookmarks", id: "different", value: item("a") }, { section: "bookmarks", id: "hackernews:a", value: { ...item("a"), url: "javascript:alert(1)" } }])("rejects malformed operation %j", operation => {
    const storage = new MemoryStorage(); inject(storage, { entries: [{ token: "safe", operation }] });
    expect(readLibraryDraft(storage, OWNER, NOW).entries).toEqual([]);
    expect(storage.values.has(draftKey(OWNER))).toBe(false);
  });
  it("rejects duplicate confirmation tokens and malformed saved filters", () => {
    const storage = new MemoryStorage();
    inject(storage, { entries: [entry("same", add("a")), entry("same", add("b"))] });
    expect(readLibraryDraft(storage, OWNER, NOW).warning).toBeTruthy();
    inject(storage, { entries: [{ token: "view", operation: { section: "views", id: "view", value: { id: "view", name: "AI", filters: { ...DEFAULT_FILTERS, query: 2 } } } }] });
    expect(readLibraryDraft(storage, OWNER, NOW).warning).toBeTruthy();
  });
  it("validates views independent of JSON field order", () => {
    const filters = { dedupe: true, time: "all", sort: "signal" as const, platforms: [], topics: [], region: "all", query: "" };
    const pending = appendDraft([], [{ section: "views", id: "view", value: { id: "view", name: "AI", filters } }]);
    expect(pending).toHaveLength(1);
  });
  it("bounds both operation count and UTF-8 bytes", () => {
    const storage = new MemoryStorage();
    const huge = Array.from({ length: DRAFT_MAX_OPERATIONS + 1 }, (_, n) => entry(`token-${n}`, { section: "overrides", id: `id-${n}`, value: null }));
    expect(() => writeLibraryDraft(storage, OWNER, huge, NOW)).toThrow("容量");
    inject(storage, { entries: huge }); expect(readLibraryDraft(storage, OWNER, NOW).warning).toBeTruthy();
    const large = Array.from({ length: 150 }, (_, n) => entry(`token-${n}`, { section: "bookmarks", id: `hackernews:${n}`,
      value: { ...item(String(n)), title: "界".repeat(500), description: "界".repeat(650) } }));
    expect(() => writeLibraryDraft(storage, OWNER, large, NOW)).toThrow("容量");
    storage.values.set(draftKey(OWNER), "界".repeat(Math.ceil(DRAFT_MAX_BYTES / 3) + 1));
    expect(readLibraryDraft(storage, OWNER, NOW).warning).toBeTruthy();
  });
  it("rejects excessive distinct operations after compaction", () => {
    const operations: LibraryOperation[] = Array.from({ length: DRAFT_MAX_OPERATIONS + 1 }, (_, n) => ({ section: "overrides", id: `id-${n}`, value: null }));
    expect(() => appendDraft([], operations)).toThrow("改动过多");
  });
  it("reports storage failures and does not replace the previous durable draft", () => {
    const storage = new MemoryStorage();
    const original = appendDraft([], [add("a")]); writeLibraryDraft(storage, OWNER, original, NOW);
    storage.failWrite = true;
    expect(() => writeLibraryDraft(storage, OWNER, appendDraft(original, [add("b")]), NOW)).toThrow("本次改动未接受");
    expect(readLibraryDraft(storage, OWNER, NOW).entries).toEqual(original);
    storage.failRemove = true; expect(() => writeLibraryDraft(storage, OWNER, [], NOW)).toThrow("无法清除");
    storage.failRead = true; expect(readLibraryDraft(storage, OWNER, NOW)).toMatchObject({ entries: [], warning: expect.stringContaining("无法读取") });
  });
});
