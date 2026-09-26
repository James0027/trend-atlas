import { classify, safeUrl, scoreRank, textOnly, validTime } from "./classify";
import type { Item, Source } from "./types";
export type SourceResult = {items:Item[];upstreamUpdatedAt?:number;channel?:string};
type Raw = {id?:unknown; title?:unknown; url?:unknown; description?:unknown; metric?:unknown; publishedAt?:unknown; publisher?:unknown; rank?:unknown};
export async function fetchText(url:string,signal?:AbortSignal,headers?:Record<string,string>):Promise<string> {
  const r=await fetch(url,{headers:{"User-Agent":"TrendAtlas/1.0 (personal trend reader)",Accept:"application/json, application/rss+xml, text/xml;q=0.9",...headers},signal:signal??AbortSignal.timeout(6500),redirect:"follow"});
  if(!r.ok) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
  const len=Number(r.headers.get("content-length")||0);
  if(len>3_000_000) { await r.body?.cancel(); throw new Error("响应超出大小限制"); }
  const reader=r.body?.getReader(); if(!reader) throw new Error("来源没有响应内容");
  const chunks:Uint8Array[]=[]; let size=0;
  for(;;) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>3_000_000) {await reader.cancel();throw new Error("响应超出大小限制");} chunks.push(value); }
  const merged=new Uint8Array(size); let offset=0; for(const c of chunks) {merged.set(c,offset);offset+=c.byteLength;}
  return new TextDecoder().decode(merged);
}
async function json(url:string,signal?:AbortSignal,headers?:Record<string,string>) { return JSON.parse(await fetchText(url,signal,headers)); }
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
    const description=textOnly(r.description).slice(0,650);
    return {id:source.id+":"+hash(url+"|"+title),sourceId:source.id,platform:source.platform,title,url,description,region:source.region,topics:classify(title,description,source.defaultTopic),rank,sampleSize:total,metric:typeof r.metric==="number"?r.metric.toLocaleString("en-US"):textOnly(r.metric)||undefined,publishedAt:validTime(r.publishedAt),fetchedAt:at,firstSeen:at,score:scoreRank(rank,total),history:[{at,rank}],publisher:textOnly(r.publisher)||undefined};
  });
}
function xmlTag(block:string,name:string):string { return (block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i"))||[])[1]||""; }
export function parseRSS(xml:string):Raw[] {
  const blocks=xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)||[];
  return blocks.slice(0,50).map(b=>({title:xmlTag(b,"title"),url:textOnly(xmlTag(b,"link")),description:xmlTag(b,"description"),publishedAt:textOnly(xmlTag(b,"pubDate")),publisher:xmlTag(b,"source")}));
}
let nextUapi=0;
async function uapi(source:Source,key:string|undefined,permit:()=>Promise<boolean>) {
  if(!await permit())throw new Error("来源访客请求预算已达上限，稍后重试或配置授权。");
  const wait=Math.max(0,nextUapi-Date.now());nextUapi=Date.now()+wait+300;
  if(wait)await new Promise(r=>setTimeout(r,wait));
  return json(`https://uapis.cn/api/v1/misc/hotboard?type=${source.id}`,undefined,key?{Authorization:`Bearer ${key}`}:undefined);
}
export async function collect(source:Source,at:number,key?:string,uapiKey?:string,permit:()=>Promise<boolean>=async()=>true,reserveFallback:()=>boolean=()=>true):Promise<SourceResult> {
  let raw:Raw[]=[]; let upstreamUpdatedAt:number|undefined;let sampleSize:number|undefined;
  let channel=source.provider;
  if(source.adapter==="youtube") {
    if(!key) throw new Error("需要配置 YouTube API Key");
    const d=await json(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=US&maxResults=30&key=${encodeURIComponent(key)}`);
    raw=(d.items||[]).map((v:any)=>({title:v.snippet?.title,url:`https://www.youtube.com/watch?v=${v.id}`,description:v.snippet?.description,publishedAt:v.snippet?.publishedAt,publisher:v.snippet?.channelTitle,metric:v.statistics?.viewCount?`${Number(v.statistics.viewCount).toLocaleString()} 次播放`:undefined}));
  } else if(source.adapter==="hn") {
    const ids=await json(source.endpoint!);
    if(!Array.isArray(ids))throw new Error("来源数据格式变化");
    // 16 requests plus the other feeds stay below a 50-subrequest Worker budget.
    const stories=await Promise.allSettled(ids.slice(0,16).map(id=>json(`https://hacker-news.firebaseio.com/v0/item/${Number(id)}.json`)));
    sampleSize=Math.min(16,ids.length);
    raw=stories.flatMap((r,index)=>r.status==="fulfilled"&&r.value&&!r.value.deleted&&!r.value.dead?[{title:r.value.title,url:r.value.url||`https://news.ycombinator.com/item?id=${r.value.id}`,description:r.value.text,rank:index+1,metric:`${r.value.score||0} points · ${r.value.descendants||0} 评论`,publishedAt:r.value.time,publisher:r.value.by}]:[]);
  } else if(source.adapter==="rss") {
    raw=parseRSS(await fetchText(source.endpoint!));
  } else if(source.adapter==="sixty") {
    try {
      const d=await json(source.endpoint!);if(d.code!==200||!Array.isArray(d.data))throw new Error("来源数据格式变化");
      raw=d.data.map((v:any)=>({title:v.title,url:v.link||v.url,rank:v.rank,description:v.detail||v.desc,metric:v.hot_value_desc||v.score_desc||(v.hot_value?`${v.hot_value} · 源热度`:v.score?`${v.score} · 源热度`:undefined),publishedAt:source.id==="zhihu"?v.created_at:undefined}));
      channel="60s · zellon 社区实例";
    }catch(e){
      if(!reserveFallback())throw e;
      const d=await uapi(source,uapiKey,permit);if(!Array.isArray(d.list))throw new Error("来源数据格式变化");
      upstreamUpdatedAt=validTime(d.update_time);channel="UAPI · 备用聚合";
      raw=d.list.map((v:any)=>({title:v.title,url:v.url||v.link,rank:v.index,description:v.extra?.desc||v.extra?.description||v.description,metric:v.hot_value?`${v.hot_value} · 源热度`:undefined}));
    }
  } else if(source.adapter==="uapi") {
    const d=await uapi(source,uapiKey,permit);
    if(!Array.isArray(d.list))throw new Error("来源数据格式变化");
    upstreamUpdatedAt=validTime(d.update_time);
    raw=d.list.map((v:any)=>({title:v.title,url:v.url||v.link,rank:v.index,description:v.extra?.desc||v.extra?.description||v.description,metric:v.hot_value?`${v.hot_value} · 源热度`:undefined,publisher:v.extra?.author}));
  } else if(source.adapter==="dailyhot") {
    const d=await json(source.endpoint!); if(d.code!==200||!Array.isArray(d.data))throw new Error("来源暂不可用");
    upstreamUpdatedAt=validTime(d.updateTime||d.update_time);
    raw=d.data.map((v:any)=>({title:v.title,url:v.url||v.mobileUrl,description:v.desc,metric:v.hot?`${v.hot} · 源热度`:undefined}));
  } else if(source.adapter==="newsnow") {
    const d=await json(source.endpoint!); if(!Array.isArray(d.items))throw new Error("来源暂不可用");
    upstreamUpdatedAt=validTime(d.updatedTime);
    raw=d.items.map((v:any)=>({title:v.title,url:v.url,description:v.extra?.desc,metric:v.extra?.info}));
  } else if(source.adapter==="devto") {
    const d=await json(source.endpoint!); if(!Array.isArray(d))throw new Error("来源数据格式变化");
    raw=d.map((v:any)=>({title:v.title,url:v.url,description:v.description,metric:`${v.positive_reactions_count||0} 反应 · ${v.comments_count||0} 评论`,publishedAt:v.published_at,publisher:v.user?.name}));
  } else if(source.adapter==="reddit") {
    const d=await json(source.endpoint!);
    raw=(d.data?.children||[]).filter((v:any)=>!v.data.over_18&&!v.data.stickied).map((v:any)=>({title:v.data.title,url:`https://www.reddit.com${v.data.permalink}`,description:v.data.selftext,metric:`${v.data.score||0} votes · ${v.data.num_comments||0} 评论`,publishedAt:v.data.created_utc,publisher:v.data.subreddit_name_prefixed}));
  }
  const items=normalize(source,raw,at,sampleSize).map(i=>({...i,channel}));
  if(!items.length)throw new Error("来源未返回有效条目");
  return {items,upstreamUpdatedAt,channel};
}
