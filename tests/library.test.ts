import { describe, expect, it } from "vitest";
import { applyOperations, emptyLibrary, libraryDiff, parseLibrary } from "../lib/library";
import type { Item } from "../lib/types";
import { DEFAULT_FILTERS } from "../lib/explore";
function item(id: string): Item {
  const at = Date.now();
  return { id: "hackernews:" + id, sourceId: "hackernews", platform: "Hacker News", title: id,
    description: "", region: "GLOBAL", topics: ["technology"], url: "https://news.ycombinator.com/item?id=" + id,
    rank: 1, score: 100, fetchedAt: at, firstSeen: at, sampleSize: 10, history: [{ at, rank: 1 }] };
}
describe("private library merging and validation", () => {
  it("preserves another device's additions when replaying local additions", () => {
    const local = libraryDiff("bookmarks", [], [item("a")]);
    const merged = applyOperations({ ...emptyLibrary(), bookmarks: [item("b")] }, local);
    expect(merged.bookmarks.map(bookmark => bookmark.id)).toEqual(["hackernews:a", "hackernews:b"]);
  });
  it("replays explicit removals without resurrecting unrelated bookmarks", () => {
    const original = [item("a"), item("b")];
    const local = libraryDiff("bookmarks", original, [original[1]]);
    const merged = applyOperations({ ...emptyLibrary(), bookmarks: [...original, item("c")] }, local);
    expect(merged.bookmarks.map(bookmark => bookmark.id)).toEqual(["hackernews:b", "hackernews:c"]);
  });
  it("updates views by id and retains remote views", () => {
    const view = { id: "view-a", name: "AI", filters: DEFAULT_FILTERS };
    const next = applyOperations({ ...emptyLibrary(), views: [{ ...view, id: "view-b" }] }, [{ section: "views", id: view.id, value: view }]);
    expect(next.views).toHaveLength(2);
  });
  it("keeps separate topic corrections and permits explicit clear", () => {
    const merged = applyOperations({ ...emptyLibrary(), overrides: { a: ["ai"] } }, [{ section: "overrides", id: "b", value: ["beauty"] }]);
    expect(merged.overrides).toEqual({ a: ["ai"], b: ["beauty"] });
    expect(applyOperations(merged, [{ section: "clear" }])).toEqual(emptyLibrary());
  });
  it("rejects unsafe links, duplicate bookmarks and unsupported correction topics", () => {
    expect(() => parseLibrary({ ...emptyLibrary(), bookmarks: [{ ...item("a"), url: "javascript:alert(1)" }] })).toThrow();
    expect(() => parseLibrary({ ...emptyLibrary(), bookmarks: [item("a"), item("a")] })).toThrow();
    expect(() => parseLibrary({ ...emptyLibrary(), overrides: { a: ["wrong"] } })).toThrow();
  });
  it("rejects prototype keys and strips unapproved item properties", () => {
    expect(() => parseLibrary({ ...emptyLibrary(), overrides: JSON.parse('{"__proto__":["ai"]}') })).toThrow();
    const parsed = parseLibrary({ ...emptyLibrary(), bookmarks: [{ ...item("a"), secret: "unapproved" }] });
    expect(parsed.bookmarks[0]).not.toHaveProperty("secret");
  });
});
