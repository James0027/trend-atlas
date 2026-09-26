import { PLATFORMS, REGIONS, SOURCES, TOPICS } from "./catalog";
import { DEFAULT_FILTERS } from "./explore";
import { safeUrl } from "./classify";
import type { Filters, Item, SourceStatus } from "./types";
function finite(v:unknown):v is number{return typeof v==="number"&&Number.isFinite(v);}
function rank(v:unknown):v is number{return finite(v)&&Number.isInteger(v)&&v>=1&&v<=100000;}
function time(v:unknown):v is number{return finite(v)&&v>946684800000&&v<=Date.now()+300000;}
export function validItem(v:unknown):v is Item {
  if(!v||typeof v!=="object")return false;const i=v as Item,s=SOURCES.find(s=>s.id===i.sourceId);
  return !!s&&typeof i.id==="string"&&i.id.length<200&&typeof i.title==="string"&&i.title.length>0&&i.title.length<=500&&typeof i.description==="string"&&i.description.length<=650&&!!safeUrl(i.url)&&i.platform===s.platform&&i.region===s.region&&rank(i.rank)&&finite(i.score)&&i.score>=0&&i.score<=100&&time(i.fetchedAt)&&time(i.firstSeen)&&Array.isArray(i.topics)&&i.topics.length<=12&&i.topics.every(t=>TOPICS.some(x=>x.id===t))&&Array.isArray(i.history)&&i.history.length<=24&&i.history.every(h=>h&&time(h.at)&&rank(h.rank))&&(i.previousRank===undefined||rank(i.previousRank))&&(i.sampleSize===undefined||rank(i.sampleSize))&&(i.publishedAt===undefined||time(i.publishedAt));
}
export function validSnapshot(v:unknown,id:string):v is {items:Item[];status:SourceStatus} {
  if(!v||typeof v!=="object")return false;const s=v as {items:Item[];status:SourceStatus};
  return Array.isArray(s.items)&&s.items.length<=60&&s.items.every(i=>validItem(i)&&i.sourceId===id)&&!!s.status&&s.status.id===id&&["ok","cached","error","restricted"].includes(s.status.state)&&finite(s.status.count)&&finite(s.status.checkedAt)&&finite(s.status.nextRefreshAt)&&(s.status.fetchedAt===null||time(s.status.fetchedAt))&&typeof s.status.message==="string";
}
export function sanitizeFilters(value:unknown):Filters {
  const f=value&&typeof value==="object"?value as Record<string,unknown>:{};
  return {...DEFAULT_FILTERS,query:typeof f.query==="string"?f.query.slice(0,200):"",region:REGIONS.some(r=>r.id===f.region)?f.region as string:"all",topics:Array.isArray(f.topics)?f.topics.filter(t=>typeof t==="string"&&TOPICS.some(x=>x.id===t)).slice(0,12):[],platforms:Array.isArray(f.platforms)?f.platforms.filter(p=>typeof p==="string"&&PLATFORMS.includes(p)).slice(0,30):[],sort:["signal","latest","rising"].includes(f.sort as string)?f.sort as Filters["sort"]:"signal",time:["1","6","24","all"].includes(f.time as string)?f.time as string:"all",dedupe:typeof f.dedupe==="boolean"?f.dedupe:true};
}
