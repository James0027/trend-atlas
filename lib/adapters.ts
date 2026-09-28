import { classify, safeUrl, scoreRank, textOnly, validTime } from "./classify";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Item, Source } from "./types";
export type SourceResult = {items:Item[];upstreamUpdatedAt?:number;channel?:string};
type Raw = {id?:unknown; title?:unknown; url?:unknown; description?:unknown; metric?:unknown; publishedAt?:unknown; publisher?:unknown; rank?:unknown};
export class SourceHTTPError extends Error {
  readonly status:number;
  readonly retryAfterMs?:number;
  constructor(status:number,retryAfterMs?:number) {super(`HTTP ${status}`);this.name="SourceHTTPError";this.status=status;this.retryAfterMs=retryAfterMs;}
}
function retryDelay(header:string|null):number|undefined {
  if(!header)return undefined;
  const value=header.trim(),delay=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
  return Number.isFinite(delay)&&delay>=0?Math.min(Math.ceil(delay),30*86400000):undefined;
}
function ensureRequestWindow(deadline?:number):void {
  if(deadline!==undefined&&(!Number.isFinite(deadline)||Date.now()>=deadline-6500))throw new Error("本轮采集时间已用完，等待下次更新");
}
export async function fetchText(url:string,signal?:AbortSignal,headers?:Record<string,string>,deadline?:number):Promise<string> {
  if(deadline!==undefined&&(!Number.isFinite(deadline)||Date.now()>=deadline))throw new Error("本轮采集时间已用完，等待下次更新");
  const timeout=signal??AbortSignal.timeout(6500);
  const requestSignal=deadline===undefined?timeout:AbortSignal.any([timeout,AbortSignal.timeout(Math.max(1,Math.ceil(deadline-Date.now())))]);
  const r=await fetch(url,{headers:{"User-Agent":"TrendAtlas/2.0 (+https://github.com/James0027)",Accept:"application/json, application/atom+xml, application/rss+xml, text/xml;q=0.9",...headers},signal:requestSignal,redirect:"follow"});
  if(!r.ok) { const delay=retryDelay(r.headers.get("retry-after"));await r.body?.cancel();throw new SourceHTTPError(r.status,delay); }
  const len=Number(r.headers.get("content-length")||0);
  if(len>3_000_000) { await r.body?.cancel(); throw new Error("响应超出大小限制"); }
  const reader=r.body?.getReader(); if(!reader) throw new Error("来源没有响应内容");
  const chunks:Uint8Array[]=[]; let size=0;
  for(;;) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>3_000_000) {await reader.cancel();throw new Error("响应超出大小限制");} chunks.push(value); }
  const merged=new Uint8Array(size); let offset=0; for(const c of chunks) {merged.set(c,offset);offset+=c.byteLength;}
  return new TextDecoder().decode(merged);
}
async function json(url:string,signal?:AbortSignal,headers?:Record<string,string>,deadline?:number):Promise<unknown> { return JSON.parse(await fetchText(url,signal,headers,deadline)); }
function hash(text:string):string { let h=2166136261; for(let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619); return (h>>>0).toString(36); }
export function normalize(source:Source,raw:Raw[],at:number,sampleSize?:number):Item[] {
  const seen=new Set<string>();
  const cleaned=raw.flatMap((r,index)=>{
    const title=textOnly(r.title).slice(0,500),url=safeUrl(r.url,source.homepage);
    if(!title||!url) return [];
    const key=url+"|"+title; if(seen.has(key))return [];seen.add(key);
    const rank=Number(r.rank);
    return [{r,title,url,rank:Number.isInteger(rank)&&rank>=1&&rank<=100000?rank:index+1}];
  }).slice(0,60);
  const total=Math.max(sampleSize||raw.length,...cleaned.map(i=>i.rank));
  return cleaned.map(({r,title,url,rank})=>{
    const description=textOnly(r.description).slice(0,280);
    return {id:source.id+":"+hash(url+"|"+title),sourceId:source.id,platform:source.platform,title,url,description,region:source.region,topics:classify(title,description,source.defaultTopic),rank,sampleSize:total,metric:typeof r.metric==="number"?r.metric.toLocaleString("en-US"):textOnly(r.metric)||undefined,publishedAt:validTime(r.publishedAt),fetchedAt:at,firstSeen:at,score:scoreRank(rank,total),history:[{at,rank}],publisher:textOnly(r.publisher)||undefined};
  });
}
const feedParser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@",removeNSPrefix:true,parseTagValue:false,trimValues:true,processEntities:false});
type DataRecord = Record<string,unknown>;
function record(value:unknown):DataRecord { return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as DataRecord:{}; }
function jsonArray(value:unknown):unknown[] { return Array.isArray(value)?value:[]; }
function asArray(value:unknown):unknown[] { return value==null?[]:Array.isArray(value)?value:[value]; }
function scalar(value:unknown):string { return typeof value==="string"?value:typeof value==="number"&&Number.isFinite(value)?String(value):""; }
function numeric(value:unknown):number|undefined {
  if(typeof value!=="number"&&(typeof value!=="string"||!value.trim()))return undefined;
  const number=Number(value);return Number.isFinite(number)?number:undefined;
}
function hotMetric(value:unknown):string|undefined { return value&&scalar(value)?`${scalar(value)} · 源热度`:undefined; }
function xmlText(value:unknown):string { const text=record(value)["#text"];return typeof value==="string"?value:typeof text==="string"?text:""; }
function parseFeed(xml:string):DataRecord {
  if(xml.length>3_000_000||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new Error("来源 XML 声明不受支持");
  if(XMLValidator.validate(xml)!==true)throw new Error("来源 XML 格式不正确");
  return record(feedParser.parse(xml));
}
function feedEntries(document:DataRecord):Raw[] {
  const atom=record(document.feed);
  if(document.feed) return asArray(atom.entry).slice(0,50).map((value,index)=>{
    const entry=record(value),links=asArray(entry.link).map(record);
    const link=links.find(v=>v["@rel"]==="alternate"&&(!v["@type"]||v["@type"]==="text/html"))||links.find(v=>!v["@rel"]);
    return {title:xmlText(entry.title),url:textOnly(link?.["@href"]||xmlText(entry.id)),description:xmlText(entry.summary),publishedAt:xmlText(entry.published),publisher:asArray(entry.author).map(v=>xmlText(record(v).name)).filter(Boolean).join(", "),rank:index+1};
  });
  const channel=record(record(document.rss).channel||document.RDF);
  return asArray(channel.item).slice(0,50).map((value,index)=>{
    const entry=record(value);
    const guid=xmlText(entry.guid);
    return {title:xmlText(entry.title),url:textOnly(xmlText(entry.link)||(/^https?:\/\//i.test(guid)?guid:"")),description:xmlText(entry.description),publishedAt:xmlText(entry.pubDate)||xmlText(entry.date),publisher:xmlText(entry.source)||xmlText(entry.creator),rank:index+1};
  });
}
export function parseRSS(xml:string):Raw[] { return feedEntries(parseFeed(xml)); }

// Wikimedia asks clients to wait for the previous request to finish. arXiv requires
// a single connection and at least three seconds between requests, across a whole
// deployment; the persistent collection lease provides the cross-instance guard.
let wikimediaQueue:Promise<unknown>=Promise.resolve();
let arxivQueue:Promise<unknown>=Promise.resolve();
function serialWikimedia<T>(work:()=>Promise<T>):Promise<T> {
  const run=wikimediaQueue.then(work,work);wikimediaQueue=run.catch(()=>undefined);return run;
}
function fetchArxiv(url:string,deadline?:number):Promise<string> {
  let started=false;
  const work=()=>{ensureRequestWindow(deadline);started=true;return fetchText(url,AbortSignal.timeout(12000),undefined,deadline);};
  const run=arxivQueue.then(work,work);
  const cooldown=async()=>{if(started)await new Promise<void>(resolve=>setTimeout(resolve,3100));};
  // Keep the next request spaced out, but do not hold this result for the
  // trailing cooldown: each source still needs time to persist its snapshot.
  arxivQueue=run.then(cooldown,cooldown);
  return run;
}
const wikiMainPages=new Set(["Main_Page","メインページ","首页","首頁","मुखपृष्ठ","대문","Accueil_principal"]);
const wikiAdministrative=/^(?:Special|Wikipedia|Wikipédia|Portal|Category|Template|File|Help|User|Talk|MediaWiki|维基百科|維基百科|特殊|分类|分類|模板|帮助|幫助|用户|用戶|讨论|討論|特別|ウィキペディア|カテゴリ|ファイル|利用者|위키백과|특수|분류|파일|틀|도움말|사용자|विकिपीडिया|विशेष|श्रेणी|साँचा|चित्र|सहायता):/i;
async function mostViewed(source:Source,at:number,deadline?:number):Promise<{raw:Raw[];sampleSize:number;upstreamUpdatedAt:number;channel:string}> {
  return serialWikimedia(async()=>{
    for(let offset=1;offset<=3;offset++) {
      ensureRequestWindow(deadline);
      const date=new Date(at-offset*86400000).toISOString().slice(0,10);
      let data:unknown;
      try {data=await json(`${source.endpoint}/${date.replaceAll("-","/")}`,undefined,undefined,deadline);}catch(error){
        if(error instanceof Error&&error.message==="HTTP 404"&&offset<3)continue;
        throw error;
      }
      const report=record(jsonArray(record(data).items)[0]),articles=report.articles;
      if(!Array.isArray(articles)||`${report.year}-${report.month}-${report.day}`!==date)throw new Error("来源日榜数据格式变化");
      const raw=articles.flatMap(value=>{
        const entry=record(value);
        const article=typeof entry.article==="string"?entry.article:"",rank=Number(entry.rank),views=Number(entry.views);
        if(!article||wikiMainPages.has(article)||wikiAdministrative.test(article)||!Number.isInteger(rank)||rank<1||!Number.isFinite(views)||views<0)return [];
        return [{title:article.replaceAll("_"," "),url:new URL(`wiki/${encodeURIComponent(article)}`,source.homepage).href,rank,metric:`${views.toLocaleString("en-US")} 次阅读 · ${date} UTC`,description:`${date} UTC 日阅读榜；语言版全部访问方式统计，保留官方原始名次。统计数据：Wikimedia Analytics（CC0）。`,publisher:"Wikimedia Analytics"}];
      });
      return {raw,sampleSize:articles.length,upstreamUpdatedAt:Date.parse(`${date}T00:00:00Z`)+86400000,channel:`${source.provider} · ${date} UTC`};
    }
    throw new Error("最近三天的官方日榜尚未发布");
  });
}
function crossrefDate(value:unknown):number|undefined {
  const parts=jsonArray(record(value)["date-parts"])[0];
  if(!Array.isArray(parts)||parts.length!==3||!parts.every((part):part is number=>typeof part==="number"&&Number.isInteger(part)))return undefined;
  const [year,month,day]=parts;const stamp=Date.UTC(year,month-1,day),date=new Date(stamp);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?validTime(stamp):undefined;
}
let nextUapi=0;
async function uapi(source:Source,key:string|undefined,permit:()=>Promise<boolean>,deadline?:number) {
  ensureRequestWindow(deadline);
  if(!await permit())throw new Error("来源访客请求预算已达上限，稍后重试或配置授权。");
  const wait=Math.max(0,nextUapi-Date.now());nextUapi=Date.now()+wait+300;
  if(wait)await new Promise(r=>setTimeout(r,wait));
  ensureRequestWindow(deadline);
  return record(await json(`https://uapis.cn/api/v1/misc/hotboard?type=${source.id}`,undefined,key?{Authorization:`Bearer ${key}`}:undefined,deadline));
}
export async function collect(source:Source,at:number,key?:string,uapiKey?:string,permit:()=>Promise<boolean>=async()=>true,reserveFallback:()=>boolean=()=>true,deadline?:number):Promise<SourceResult> {
  ensureRequestWindow(deadline);
  const readJson=(url:string,signal?:AbortSignal,headers?:Record<string,string>)=>json(url,signal,headers,deadline);
  let raw:Raw[]=[]; let upstreamUpdatedAt:number|undefined;let sampleSize:number|undefined;
  let channel=source.provider;
  if(source.adapter==="wikimedia") {
    const report=await mostViewed(source,at,deadline);raw=report.raw;sampleSize=report.sampleSize;upstreamUpdatedAt=report.upstreamUpdatedAt;channel=report.channel;
  } else if(source.adapter==="arxiv") {
    const document=parseFeed(await fetchArxiv(source.endpoint!,deadline));
    const entries=feedEntries(document);
    if(entries.some(entry=>typeof entry.url==="string"&&entry.url.includes("/api/errors")))throw new Error("arXiv 查询返回错误");
    raw=entries.filter(entry=>{
      try {const url=new URL(String(entry.url));return /^(?:www\.)?arxiv\.org$/i.test(url.hostname)&&url.pathname.startsWith("/abs/");}catch{return false;}
    }).map(entry=>({...entry,url:String(entry.url).replace(/^http:/,"https:")}));
    upstreamUpdatedAt=validTime(xmlText(record(document.feed).updated));
    channel=`${source.provider} · 按提交时间排列`;
  } else if(source.adapter==="crossref") {
    const until=new Date(at).toISOString().slice(0,10),from=new Date(at-90*86400000).toISOString().slice(0,10);
    const params=new URLSearchParams({filter:`from-pub-date:${from},until-pub-date:${until}`,sort:"published",order:"desc",rows:"30",select:"DOI,title,published,publisher,container-title"});
    const d=record(await readJson(`${source.endpoint}?${params}`,AbortSignal.timeout(12000))),entries=record(d.message).items;
    if(!Array.isArray(entries))throw new Error("来源书目数据格式变化");
    raw=entries.map((value,index)=>{
      const entry=record(value);
      return {title:jsonArray(entry.title)[0],url:typeof entry.DOI==="string"?`https://doi.org/${encodeURIComponent(entry.DOI)}`:undefined,publishedAt:crossrefDate(entry.published),publisher:entry.publisher,description:[jsonArray(entry["container-title"])[0],entry.publisher].filter((value):value is string=>typeof value==="string").join(" · "),rank:index+1};
    });
    channel=`${source.provider} · 按出版日期排列`;
  } else if(source.adapter==="youtube") {
    if(!key) throw new Error("需要配置 YouTube API Key");
    const endpoint=new URL(source.endpoint||"https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=US&maxResults=30");
    endpoint.searchParams.set("key",key);
    const d=record(await readJson(endpoint.href));
    raw=jsonArray(d.items).map(value=>{
      const video=record(value),snippet=record(video.snippet),views=numeric(record(video.statistics).viewCount);
      return {title:snippet.title,url:typeof video.id==="string"?`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`:undefined,description:snippet.description,publishedAt:snippet.publishedAt,publisher:snippet.channelTitle,metric:views===undefined?undefined:`${views.toLocaleString()} 次播放`};
    });
  } else if(source.adapter==="hn") {
    const ids=await readJson(source.endpoint!);
    if(!Array.isArray(ids))throw new Error("来源数据格式变化");
    // Bound fan-out; rejected or deleted stories keep gaps in official ranks.
    const stories=await Promise.allSettled(ids.slice(0,16).map(id=>{
      const number=numeric(id);
      if(number===undefined||!Number.isInteger(number)||number<=0)return Promise.reject(new Error("来源条目 ID 不合法"));
      return readJson(`https://hacker-news.firebaseio.com/v0/item/${number}.json`);
    }));
    sampleSize=Math.min(16,ids.length);
    raw=stories.flatMap((result,index)=>{
      if(result.status!=="fulfilled"||!result.value)return [];
      const story=record(result.value),id=numeric(story.id);
      if(story.deleted||story.dead)return [];
      return [{title:story.title,url:story.url||(id===undefined?undefined:`https://news.ycombinator.com/item?id=${id}`),description:story.text,rank:index+1,metric:`${numeric(story.score)||0} points · ${numeric(story.descendants)||0} 评论`,publishedAt:story.time,publisher:story.by}];
    });
  } else if(source.adapter==="rss") {
    raw=parseRSS(await fetchText(source.endpoint!,undefined,undefined,deadline));
  } else if(source.adapter==="sixty") {
    try {
      const d=record(await readJson(source.endpoint!));if(d.code!==200||!Array.isArray(d.data))throw new Error("来源数据格式变化");
      raw=d.data.map(value=>{
        const entry=record(value);
        return {title:entry.title,url:entry.link||entry.url,rank:entry.rank,description:entry.detail||entry.desc,metric:entry.hot_value_desc||entry.score_desc||hotMetric(entry.hot_value)||hotMetric(entry.score),publishedAt:source.id==="zhihu"?entry.created_at:undefined};
      });
      channel="60s · zellon 社区实例";
    }catch(e){
      if(!reserveFallback())throw e;
      const d=await uapi(source,uapiKey,permit,deadline);if(!Array.isArray(d.list))throw new Error("来源数据格式变化");
      upstreamUpdatedAt=validTime(d.update_time);channel="UAPI · 备用聚合";
      raw=d.list.map(value=>{
        const entry=record(value),extra=record(entry.extra);
        return {title:entry.title,url:entry.url||entry.link,rank:entry.index,description:extra.desc||extra.description||entry.description,metric:hotMetric(entry.hot_value)};
      });
    }
  } else if(source.adapter==="uapi") {
    const d=await uapi(source,uapiKey,permit,deadline);
    if(!Array.isArray(d.list))throw new Error("来源数据格式变化");
    upstreamUpdatedAt=validTime(d.update_time);
    raw=d.list.map(value=>{
      const entry=record(value),extra=record(entry.extra);
      return {title:entry.title,url:entry.url||entry.link,rank:entry.index,description:extra.desc||extra.description||entry.description,metric:hotMetric(entry.hot_value),publisher:extra.author};
    });
  } else if(source.adapter==="dailyhot") {
    const d=record(await readJson(source.endpoint!)); if(d.code!==200||!Array.isArray(d.data))throw new Error("来源暂不可用");
    upstreamUpdatedAt=validTime(d.updateTime||d.update_time);
    raw=d.data.map(value=>{const entry=record(value);return {title:entry.title,url:entry.url||entry.mobileUrl,description:entry.desc,metric:hotMetric(entry.hot)};});
  } else if(source.adapter==="newsnow") {
    const d=record(await readJson(source.endpoint!)); if(!Array.isArray(d.items))throw new Error("来源暂不可用");
    upstreamUpdatedAt=validTime(d.updatedTime);
    raw=d.items.map(value=>{const entry=record(value),extra=record(entry.extra);return {title:entry.title,url:entry.url,description:extra.desc,metric:extra.info};});
  } else if(source.adapter==="devto") {
    const d=await readJson(source.endpoint!); if(!Array.isArray(d))throw new Error("来源数据格式变化");
    raw=d.map(value=>{const entry=record(value);return {title:entry.title,url:entry.url,description:entry.description,metric:`${numeric(entry.positive_reactions_count)||0} 反应 · ${numeric(entry.comments_count)||0} 评论`,publishedAt:entry.published_at,publisher:record(entry.user).name};});
  } else if(source.adapter==="reddit") {
    const d=record(await readJson(source.endpoint!));
    raw=jsonArray(record(d.data).children).map(value=>record(record(value).data)).filter(entry=>!entry.over_18&&!entry.stickied).map(entry=>({title:entry.title,url:typeof entry.permalink==="string"?`https://www.reddit.com${entry.permalink}`:undefined,description:entry.selftext,metric:`${numeric(entry.score)||0} votes · ${numeric(entry.num_comments)||0} 评论`,publishedAt:entry.created_utc,publisher:entry.subreddit_name_prefixed}));
  }
  const items=normalize(source,raw,at,sampleSize).map(i=>({...i,channel}));
  if(!items.length)throw new Error("来源未返回有效条目");
  return {items,upstreamUpdatedAt,channel};
}
