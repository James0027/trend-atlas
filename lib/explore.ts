import { SOURCES } from "./catalog";
import type { Filters, Item } from "./types";
export const DEFAULT_FILTERS:Filters={query:"",region:"all",topics:[],platforms:[],sort:"signal",time:"all",dedupe:true};
export type Group={item:Item;others:Item[]};
export function filterItems(items:Item[],f:Filters,now=Date.now()):Group[] {
  const tokens=f.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const hours=f.time==="all"?Infinity:Number(f.time);
  let matches=items.filter(i=>{
    const s=SOURCES.find(s=>s.id===i.sourceId);
    const time=s?.kind==="news"?i.publishedAt||i.fetchedAt:i.fetchedAt;
    return (f.region==="all"||i.region===f.region)&&(!f.topics.length||i.topics.some(t=>f.topics.includes(t)))&&(!f.platforms.length||f.platforms.includes(i.platform))&&now-time<=hours*3600000&&tokens.every(t=>(i.title+" "+i.description+" "+i.platform).toLocaleLowerCase().includes(t))&&(f.sort!=="rising"||i.previousRank!==undefined&&i.previousRank>i.rank);
  });
  if(f.sort==="rising")matches=matches.filter(i=>!i.stale);
  matches=matches.sort((a,b)=>f.sort==="latest"?(b.publishedAt||b.fetchedAt)-(a.publishedAt||a.fetchedAt)||a.id.localeCompare(b.id):f.sort==="rising"?(b.previousRank!-b.rank)-(a.previousRank!-a.rank)||b.score-a.score||a.id.localeCompare(b.id):Number(!!a.stale)-Number(!!b.stale)||b.score-a.score||b.fetchedAt-a.fetchedAt||a.id.localeCompare(b.id));
  const groups:Group[]=[];const keys=new Map<string,Group>();
  for(const item of matches) {
    // Conservative: merge exact normalized titles only; retain every source record.
    const key=item.title.toLocaleLowerCase().replace(/[\s\p{P}]/gu,"");
    const found=f.dedupe?keys.get(key):undefined;
    if(found)found.others.push(item);else{const group={item,others:[]};groups.push(group);keys.set(key,group);}
  }
  return groups;
}
export function csvCell(v:string):string { const safe=/^[=+\-@\t\r]/.test(v)?"'"+v:v;return '"'+safe.replace(/"/g,'""')+'"'; }
export function exportCSV(groups:Group[]):string {
  return "\uFEFF"+[["标题","平台","地区","来源名次","样本位置分","源指标","主题","原始链接","发布时间","采集时间"],...groups.flatMap(g=>[g.item,...g.others].map(i=>[i.title,i.platform,i.region,String(i.rank),String(i.score),i.metric||"",i.topics.join(" / "),i.url,i.publishedAt?new Date(i.publishedAt).toISOString():"",new Date(i.fetchedAt).toISOString()]))].map(r=>r.map(csvCell).join(",")).join("\r\n");
}
