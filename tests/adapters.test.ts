import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCES } from "../lib/catalog";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const DAY = 86_400_000;
const wiki = SOURCES.find(source => source.adapter === "wikimedia")!;
const arxiv = SOURCES.find(source => source.adapter === "arxiv")!;
const crossref = SOURCES.find(source => source.adapter === "crossref")!;
const youtube = SOURCES.find(source => source.adapter === "youtube")!;
let adapters: typeof import("../lib/adapters");
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers });
}
function wikiReport(date = "2026-09-26") {
  const [year, month, day] = date.split("-");
  return { items: [{ year, month, day, articles: [
    { article: "Main_Page", rank: 1, views: 900 },
    { article: "Special:Search", rank: 2, views: 800 },
    { article: "Example_Article", rank: 3, views: 700 },
    { article: "Second_Article", rank: 4, views: 600 },
  ] }] };
}
function atomFeed(id = "http://arxiv.org/abs/2609.12345v1") {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <updated>2026-09-27T11:00:00Z</updated><entry><id>${id}</id>
    <title>Workflow &amp; agents</title><summary>Brief metadata summary</summary>
    <published>2026-09-26T10:00:00Z</published>
    <link rel="related" type="application/pdf" href="http://arxiv.org/pdf/2609.12345v1" />
    <link rel="alternate" type="text/html" href="${id}" />
    <author><name>A</name></author><author><name>B</name></author></entry></feed>`;
}

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("Network is disabled in adapter tests"));
  vi.stubGlobal("fetch", fetchMock);
  adapters = await import("../lib/adapters");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("public source parsing", () => {
  it("parses RSS CDATA, escaped URLs, namespaces, summaries, and attribution", () => {
    const xml = `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item>
      <title><![CDATA[Safety &amp; Science]]></title>
      <link>https://example.com/story?a=1&amp;b=2</link>
      <description><![CDATA[<b>Short</b> description]]></description>
      <pubDate>Sat, 26 Sep 2026 10:00:00 GMT</pubDate><dc:creator>Author</dc:creator>
      </item></channel></rss>`;
    const parsed = adapters.normalize(SOURCES[0], adapters.parseRSS(xml), NOW);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ title: "Safety & Science", url: "https://example.com/story?a=1&b=2",
      description: "Short description", publisher: "Author", publishedAt: Date.parse("2026-09-26T10:00:00Z") });
  });

  it.each([
    '<!DOCTYPE rss SYSTEM "file:///secret.txt"><rss><channel/></rss>',
    '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "https://private.test">]><rss><channel/></rss>',
    '<!ENTITY xxe "secret"><rss><channel/></rss>',
    '<rss><channel><item></channel></rss>',
  ])("rejects unsafe XML declarations and malformed XML", xml => {
    expect(() => adapters.parseRSS(xml)).toThrow(/来源 XML/);
  });

  it("drops unsafe URLs and duplicates while preserving original rank gaps and summary limits", () => {
    const items = adapters.normalize(SOURCES[0], [
      { title: "Unsafe", url: "javascript:alert(1)", rank: 1 },
      { title: "B", url: "https://example.com/b", rank: 7, description: "x".repeat(500) },
      { title: "B", url: "https://example.com/b", rank: 8 },
      { title: "C", url: "https://example.com/c", rank: 12 },
      { title: "Credential URL", url: "https://name:password@example.com/", rank: 13 },
      { title: "Data URL", url: "data:text/plain,secret", rank: 14 },
    ], NOW, 20);
    expect(items.map(item => item.rank)).toEqual([7, 12]);
    expect(items.map(item => item.sampleSize)).toEqual([20, 20]);
    expect(items[0].description).toHaveLength(280);
    expect(items[0].score).toBe(Math.round(100 * (20 - 7) / 19));
  });

  it("falls back only on unpublished Wikimedia dates and preserves statistical time and ranks", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(wikiReport("2026-09-25")));
    const result = await adapters.collect(wiki, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/2026\/09\/26$/);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/2026\/09\/25$/);
    expect(result.items.map(item => item.rank)).toEqual([3, 4]);
    expect(result.items.every(item => item.sampleSize === 4 && item.publishedAt === undefined)).toBe(true);
    expect(result.upstreamUpdatedAt).toBe(Date.parse("2026-09-26T00:00:00Z"));
    expect(result.items[0].metric).toContain("2026-09-25 UTC");
    expect(result.items[0].url).toContain("Example_Article");
  });

  it("does not change Wikimedia dates after a rate limit response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429, { "Retry-After": "120" }));
    await expect(adapters.collect(wiki, NOW)).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("selects arXiv abstract links and author lists, retaining submitted timestamps", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(new Response(atomFeed()));
    const pending = adapters.collect(arxiv, NOW);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.items[0]).toMatchObject({ url: "https://arxiv.org/abs/2609.12345v1", publisher: "A, B",
      publishedAt: Date.parse("2026-09-26T10:00:00Z"), title: "Workflow & agents" });
    expect(result.upstreamUpdatedAt).toBe(Date.parse("2026-09-27T11:00:00Z"));
  });

  it("rejects an arXiv API error entry instead of presenting it as a paper", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(new Response(atomFeed("http://arxiv.org/api/errors#incorrect_id_format")));
    const assertion = expect(adapters.collect(arxiv, NOW)).rejects.toThrow("arXiv 查询返回错误");
    await vi.runAllTimersAsync();
    await assertion;
  });

  it("uses Crossref bibliography metadata without abstracts or invented date precision", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { items: [
      { DOI: "10.1234/example", title: ["Cosmetics research"], published: { "date-parts": [[2026, 9, 26]] },
        publisher: "Publisher", "container-title": ["Cosmetics"], abstract: "Do not copy copyrighted abstracts" },
      { DOI: "10.1234/partial", title: ["Partial publication date"], published: { "date-parts": [[2026, 9]] }, publisher: "Publisher" },
    ] } }));
    const result = await adapters.collect(crossref, NOW);
    const endpoint = new URL(String(fetchMock.mock.calls[0][0]));
    expect(endpoint.searchParams.get("select")).not.toContain("abstract");
    expect(result.items[0]).toMatchObject({ description: "Cosmetics · Publisher", publishedAt: Date.parse("2026-09-26T00:00:00Z") });
    expect(result.items[1].publishedAt).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("copyrighted abstracts");
  });

  it("requires YouTube authorization before making requests", async () => {
    await expect(adapters.collect(youtube, NOW)).rejects.toThrow("需要配置 YouTube API Key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("safely handles malformed nested API entries while retaining valid source records", async () => {
    const source = SOURCES.find(source => source.adapter === "devto")!;
    fetchMock.mockResolvedValue(jsonResponse([null, "bad entry", { title: "Valid article", url: "https://dev.to/example",
      positive_reactions_count: 5, comments_count: 2, user: null }]));
    const result = await adapters.collect(source, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ title: "Valid article", rank: 3, metric: "5 反应 · 2 评论" });
    expect(result.items[0].publisher).toBeUndefined();
  });

  it("retains Hacker News rank gaps when a story is deleted or malformed", async () => {
    const source = SOURCES.find(source => source.adapter === "hn")!;
    fetchMock.mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith("topstories.json")) return jsonResponse([1, 2, "invalid", 4]);
      if (url.endsWith("/1.json")) return jsonResponse({ id: 1, deleted: true });
      if (url.endsWith("/2.json")) return jsonResponse({ id: 2, title: "Valid HN story", url: "https://example.com/hn", score: 7, descendants: 3, time: (NOW - 60_000) / 1000 });
      return jsonResponse(null);
    });
    const result = await adapters.collect(source, NOW);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ rank: 2, sampleSize: 4, metric: "7 points · 3 评论" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("HTTP safety and shared deadlines", () => {
  it.each([
    ["120", 120_000],
    [new Date(NOW + 180_000).toUTCString(), 180_000],
    ["invalid", undefined],
    ["-1", undefined],
    ["Infinity", undefined],
    [new Date(NOW - DAY).toUTCString(), undefined],
    ["999999999", 30 * DAY],
  ])("interprets Retry-After %s without exposing response bodies", async (header, expected) => {
    fetchMock.mockResolvedValue(new Response("raw provider response with private data", { status: 429, headers: { "Retry-After": header } }));
    await expect(adapters.fetchText("https://example.com/source")).rejects.toMatchObject({ message: "HTTP 429", status: 429, retryAfterMs: expected });
  });

  it("refuses expired or invalid deadlines without starting requests", async () => {
    await expect(adapters.collect(wiki, NOW, undefined, undefined, undefined, undefined, NOW - 1)).rejects.toThrow("本轮采集时间已用完");
    await expect(adapters.fetchText("https://example.com/source", undefined, undefined, NOW - 1)).rejects.toThrow("本轮采集时间已用完");
    await expect(adapters.fetchText("https://example.com/source", undefined, undefined, Number.NaN)).rejects.toThrow("本轮采集时间已用完");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a shared deadline AbortSignal that cancels in-flight requests", async () => {
    let aborted = false;
    fetchMock.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) { reject(new Error("Expected cancellation signal")); return; }
      signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
    }));
    await expect(adapters.fetchText("https://example.com/source", undefined, undefined, NOW + 30)).rejects.toThrow();
    expect(aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defers a queued Wikimedia request if its remaining window is too short", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    fetchMock.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
      return jsonResponse(wikiReport());
    });
    const first = adapters.collect(wiki, NOW, undefined, undefined, undefined, undefined, NOW + 8_000);
    const second = adapters.collect(wiki, NOW, undefined, undefined, undefined, undefined, NOW + 6_600);
    const secondAssertion = expect(second).rejects.toThrow("本轮采集时间已用完");
    await vi.runAllTimersAsync();
    expect((await first).items).toHaveLength(2);
    await secondAssertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps arXiv cooldown inside settlement and refuses overdue queued requests", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    fetchMock.mockResolvedValue(new Response(atomFeed()));
    const first = adapters.collect(arxiv, NOW, undefined, undefined, undefined, undefined, NOW + 10_000);
    const second = adapters.collect(arxiv, NOW, undefined, undefined, undefined, undefined, NOW + 9_000);
    let settled = false;
    void first.then(() => { settled = true; });
    const secondAssertion = expect(second).rejects.toThrow("本轮采集时间已用完");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect((await first).items).toHaveLength(1);
    await secondAssertion;
    expect(settled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized announced and streamed responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { headers: { "Content-Length": "3000001" } }));
    await expect(adapters.fetchText("https://example.com/source")).rejects.toThrow("响应超出大小限制");
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(3_000_001)); }, cancel: cancelled });
    fetchMock.mockResolvedValueOnce(new Response(stream));
    await expect(adapters.fetchText("https://example.com/source")).rejects.toThrow("响应超出大小限制");
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
