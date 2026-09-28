import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, csvCell, exportCSV, filterItems } from "../lib/explore";
import { safeUrl, textOnly } from "../lib/classify";
import { normalize } from "../lib/adapters";
import { SOURCES } from "../lib/catalog";
import type { Item } from "../lib/types";
const at = Date.now();
const item = (extra: Partial<Item> = {}): Item => ({ id: "douyin:test", sourceId: "douyin", title: "AI 自动化", description: "robotics",
  platform: "抖音", region: "CN", topics: ["ai", "automation"], rank: 2, score: 90,
  url: "https://www.douyin.com/hot", fetchedAt: at, firstSeen: at, history: [{at,rank:2}], ...extra });
describe("trend exploration safeguards", () => {
  it("combines region/platform/topic/search and keeps topics as OR", () => {
    const records = [item(), item({ id: "hackernews:other", sourceId: "hackernews", region: "GLOBAL", platform: "Hacker News" })];
    expect(filterItems(records, { ...DEFAULT_FILTERS, region: "CN", platforms: ["抖音"], topics: ["beauty", "automation"], query: "ai robotics" }, at)).toHaveLength(1);
  });
  it("exact normalized title merge retains original metrics and every source", () => {
    const a = item({metric:"100 searches"}), b = item({id:"hackernews:other",sourceId:"hackernews",platform:"Hacker News",region:"GLOBAL",metric:"20 votes"});
    const merged = filterItems([a,b],DEFAULT_FILTERS,at);
    expect(merged).toHaveLength(1);expect(merged[0].others).toEqual([b]);
    expect(exportCSV(merged)).toContain("100 searches");expect(exportCSV(merged)).toContain("20 votes");
  });
  it("does not invent rising entries and excludes stale rank movements", () => {
    expect(filterItems([item(),item({id:"douyin:stale",previousRank:8,stale:true})],{...DEFAULT_FILTERS,sort:"rising"},at)).toHaveLength(0);
    expect(filterItems([item({previousRank:4})],{...DEFAULT_FILTERS,sort:"rising"},at)).toHaveLength(1);
  });
  it("uses publication time for research but collection time for native boards", () => {
    const research=SOURCES.find(source=>source.adapter==="arxiv")!;
    const old=at-2*3600000;
    const data=[item({publishedAt:old}),item({id:research.id+":test",sourceId:research.id,platform:research.platform,region:research.region,publishedAt:old})];
    expect(filterItems(data,{...DEFAULT_FILTERS,time:"1",dedupe:false},at).map(group=>group.item.sourceId)).toEqual(["douyin"]);
  });
  it("protects CSV cells and rejects executable or credential-bearing links", () => {
    for(const prefix of ["=","+","-","@","\t","\r"])expect(csvCell(prefix+"test")).toBe('"\''+prefix+'test"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(safeUrl("javascript:alert(1)")).toBeNull();expect(safeUrl("https://user:password@example.com")).toBeNull();
    expect(textOnly("<b>hello</b> &amp; world")).toBe("hello & world");
  });
  it("preserves source ranks when rejecting an unsafe record", () => {
    const source=SOURCES.find(source=>source.id==="douyin")!;
    const result=normalize(source,[{title:"bad",url:"javascript:bad",rank:1},{title:"good",url:source.homepage,rank:2}],at,10);
    expect(result[0].rank).toBe(2);expect(result[0].sampleSize).toBe(10);expect(result[0].score).toBe(89);
  });
});
