import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SOURCES } from "../lib/catalog";
import { classify, safeUrl, scoreRank, validTime } from "../lib/classify";
import { normalize, parseRSS } from "../lib/adapters";
import { DEFAULT_FILTERS, exportCSV, filterItems } from "../lib/explore";
import { getFeed } from "../lib/feed";
import { sanitizeFilters, validItem } from "../lib/validate";
const checks:string[]=[];
function test(name:string,run:()=>void){run();checks.push(name);console.log("PASS",name);}
const source=SOURCES.find(s=>s.id==="weibo")!;
let now=Date.now();const realNow=Date.now;Date.now=()=>now;
const records=normalize(source,[{title:"AI workflow 自动化",url:"https://example.com/1"},{title:"<b>stock market</b>",url:"https://example.com/2"}],now);
test("URL protocol and credentials rejection",()=>{assert.equal(safeUrl("javascript:alert(1)"),null);assert.equal(safeUrl("data:text/html,hi"),null);assert.equal(safeUrl("https://user:pass@example.com/"),null);assert.equal(safeUrl("https://example.com/"),"https://example.com/");});
test("multilabel classification",()=>assert.deepEqual(classify("AI workflow 自动化",""),["ai","automation"]));
test("future and invalid timestamps",()=>{assert.equal(validTime(now+3600000),undefined);assert.equal(validTime("not a date"),undefined);assert.equal(validTime(Math.floor(now/1000)),Math.floor(now/1000)*1000);});
test("rank percentile boundaries",()=>{assert.equal(scoreRank(1,3),100);assert.equal(scoreRank(2,3),50);assert.equal(scoreRank(3,3),0);assert.equal(scoreRank(1,1),0);});
test("source HTML and dangerous URLs",()=>{const n=normalize(source,[{title:"<img src=x onerror=alert(1)>Safe",url:"https://example.com"},{title:"unsafe",url:"javascript:alert(1)"},{title:"duplicate",url:"https://example.com/duplicate"},{title:"duplicate",url:"https://example.com/duplicate"}],now);assert.equal(n.length,2);assert.equal(n[0].title,"Safe");});
test("RSS parsing retains attribution and original time",()=>{const rss=parseRSS('<rss><channel><item><title><![CDATA[AI &amp; science]]></title><link>https://example.com/a</link><description><![CDATA[<b>Excerpt</b>]]></description><source url="https://example.com">Publisher</source><pubDate>Sat, 26 Sep 2026 15:00:00 GMT</pubDate></item></channel></rss>');const n=normalize(source,rss,now);assert.equal(n[0].title,"AI & science");assert.equal(n[0].description,"Excerpt");assert.equal(n[0].publisher,"Publisher");assert(n[0].publishedAt);});
test("combined filters and whitespace search",()=>{assert.equal(filterItems(records,{...DEFAULT_FILTERS,query:"  AI   workflow ",region:"CN",topics:["automation"],platforms:["微博"]},now).length,1);assert.equal(filterItems(records,{...DEFAULT_FILTERS,region:"US"},now).length,0);assert.equal(filterItems(records,{...DEFAULT_FILTERS,query:" "},now).length,2);});
test("conservative deduplication retains all records",()=>{const n=filterItems([records[0],{...records[0],id:"other",sourceId:"zhihu",platform:"知乎"},{...records[0],id:"another-event",title:"AI workflow 发布新版本"}],DEFAULT_FILTERS,now);assert.equal(n.length,2);assert.equal(n.find(g=>g.item.title===records[0].title)!.others.length,1);assert.equal(filterItems([records[0],{...records[0],id:"other"}],{...DEFAULT_FILTERS,dedupe:false},now).length,2);});
test("invalid entries do not renumber source ranks",()=>{const n=normalize(source,[{title:"bad URL",url:"javascript:alert(1)"},{title:"Original number 2",url:"https://example.com/two"}],now);assert.equal(n[0].rank,2);assert.equal(n[0].sampleSize,2);assert.equal(n[0].score,0);});
test("stale sources do not lead current rankings",()=>{const n=filterItems([{...records[0],stale:true},{...records[1],score:10}],DEFAULT_FILTERS,now);assert.equal(n[0].item.id,records[1].id);assert.equal(filterItems([{...records[0],stale:true,previousRank:3}],{...DEFAULT_FILTERS,sort:"rising"},now).length,0);});
test("CSV escapes spreadsheet formulas and quotes",()=>{const csv=exportCSV([{item:{...records[0],title:'=HYPERLINK("bad")'},others:[]}]);assert(csv.includes('"\'=HYPERLINK(""bad"")"'));assert(csv.startsWith("\uFEFF"));});
test("corrupt stored records and filters are handled",()=>{assert(!validItem({...records[0],topics:null}));assert(!validItem({...records[0],history:null}));assert.deepEqual(sanitizeFilters({query:42,topics:null,platforms:[42],time:"bad"}),DEFAULT_FILTERS);});

// Real SQLite executes the same prepared statements used for D1. Synthetic
// responses below are only test fixtures and never used by the running app.
const sqlite=new DatabaseSync(":memory:");
sqlite.exec("CREATE TABLE source_snapshots(source_id TEXT PRIMARY KEY,payload TEXT NOT NULL,next_attempt INTEGER NOT NULL); CREATE TABLE refresh_locks(key TEXT PRIMARY KEY,owner TEXT NOT NULL,until INTEGER NOT NULL); CREATE TABLE api_budgets(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL)");
function prepare(sql:string){let args:any[]=[];const s=sqlite.prepare(sql);return {bind(...a:any[]){args=a;return this;},async all(){return {results:s.all(...args)};},async first(){return s.get(...args)||null;},async run(){s.run(...args);return {success:true};}};}
(globalThis as any).__testEnv.DB={prepare,async batch(statements:any[]){const out=[];for(const s of statements)out.push(await s.run());return out;}};
let broken=false,calls=0,reversed=false,expireDuringFetch=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input:any)=>{
  if(expireDuringFetch){expireDuringFetch=false;now+=60_000;}
  calls++;if(broken)return new Response("unavailable",{status:503});
  const url=String(input);
  if(url.includes("/topstories.json"))return Response.json([1,2]);
  if(url.includes("/item/"))return Response.json({title:"AI research "+url.match(/item\/(\d+)/)?.[1],url:"https://example.com/hn/"+url.match(/item\/(\d+)/)?.[1],score:42,time:Math.floor(now/1000)});
  if(url.includes("/v2/"))return Response.json({code:200,data:reversed?[{title:"Second topic",link:"https://example.com/second"},{title:"First topic",link:"https://example.com/first"}]:[{title:"First topic",link:"https://example.com/first"},{title:"Second topic",link:"https://example.com/second"}]});
  if(url.includes("uapis.cn"))return Response.json({list:[{title:"UAPI topic",url:"https://example.com/uapi",hot_value:"1000"}],update_time:new Date(now).toISOString()});
  if(url.includes("news.google.com"))return new Response(`<rss><channel><item><title>Daily science</title><link>https://example.com/news</link><pubDate>${new Date(now).toUTCString()}</pubDate><source>News publisher</source></item></channel></rss>`);
  if(url.includes("newsnow"))return Response.json({items:[{title:"Repo",url:"https://github.com/example/repo"}],updatedTime:now});
  if(url.includes("dev.to"))return Response.json([{title:"Development",url:"https://dev.to/example",published_at:new Date(now).toISOString()}]);
  return Response.json({data:{children:[{data:{title:"Community",permalink:"/r/test/1",created_utc:Math.floor(now/1000)}}]}});
};
try {
  const p1=getFeed(),p2=getFeed();assert.equal(p1,p2);const first=await p1;assert.equal(first.storage,"durable");assert(first.items.length>20);checks.push("refresh coalesces and persists in SQLite");console.log("PASS",checks.at(-1));
  const before=calls;await getFeed();assert.equal(calls,before);checks.push("fresh shared cache makes no upstream requests");console.log("PASS",checks.at(-1));
  sqlite.prepare("UPDATE source_snapshots SET payload='null' WHERE source_id='weibo'").run();const repaired=await getFeed();assert(repaired.items.some(i=>i.sourceId==="weibo"));assert(repaired.warnings.some(w=>w.includes("缓存已损坏")));checks.push("valid JSON with corrupt shape is repaired");console.log("PASS",checks.at(-1));
  now+=11*60000;reversed=true;const second=await getFeed();const topic=second.items.find(i=>i.sourceId==="weibo"&&i.title==="Second topic")!;assert.equal(topic.previousRank,2);assert.equal(topic.rank,1);assert.equal(topic.history.length,2);checks.push("actual snapshots build rank history");console.log("PASS",checks.at(-1));
  now+=11*60000;broken=true;const failed=await getFeed();const status=failed.sources.find(s=>s.id==="weibo")!;assert.equal(status.state,"cached");assert.equal(status.fetchedAt,second.sources.find(s=>s.id==="weibo")!.fetchedAt);assert(failed.items.some(i=>i.sourceId==="weibo"));checks.push("upstream failure retains data and successful timestamp");console.log("PASS",checks.at(-1));
  const restricted=failed.sources.find(s=>s.id==="youtube")!;assert.equal(restricted.state,"restricted");assert.equal(restricted.count,0);checks.push("unconfigured authorization source has no fabricated content");console.log("PASS",checks.at(-1));
  now+=25*3600000;const expired=await getFeed();assert(!expired.items.some(i=>i.sourceId==="weibo"));checks.push("expired 24-hour data is removed after failed refresh");console.log("PASS",checks.at(-1));
  const rows=sqlite.prepare("SELECT COUNT(*) n FROM source_snapshots").get() as {n:number};assert(rows.n>=25);assert.equal((sqlite.prepare("SELECT COUNT(*) n FROM refresh_locks").get() as {n:number}).n,0);checks.push("durable snapshots saved and refresh lock released");console.log("PASS",checks.at(-1));
  now+=31*60000;broken=false;expireDuringFetch=true;const savedBefore=sqlite.prepare("SELECT payload FROM source_snapshots WHERE source_id='weibo'").get() as {payload:string};const fenced=await getFeed();assert(fenced.warnings.some(w=>w.includes("刷新锁有效期")));assert.equal((sqlite.prepare("SELECT payload FROM source_snapshots WHERE source_id='weibo'").get() as {payload:string}).payload,savedBefore.payload);checks.push("expired refresh owner cannot overwrite durable snapshots");console.log("PASS",checks.at(-1));
  console.log(JSON.stringify({passed:checks.length,checks}));
}finally{Date.now=realNow;globalThis.fetch=originalFetch;sqlite.close();}
