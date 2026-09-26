import { SOURCES } from "./catalog";
import { collect } from "./adapters";
import { bindings, database } from "./database";
import { validSnapshot } from "./validate";
import type { Feed, Item, SourceStatus } from "./types";
const TTL=10*60_000, FAILURE_TTL=30*60_000, RETAIN=24*60*60_000;
type Snapshot={items:Item[];status:SourceStatus};
const memory=new Map<string,Snapshot>();
const temporaryBudget=new Map<string,number>();
let inflight:Promise<Feed>|null=null;
async function batchMap<T,R>(list:T[],limit:number,fn:(v:T)=>Promise<R>):Promise<R[]> {
  const output:R[]=new Array(list.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,list.length)},async()=>{for(;;){const i=next++;if(i>=list.length)return;output[i]=await fn(list[i]);}}));
  return output;
}
export function mergeHistory(items:Item[],previous:Item[]):Item[] {
  const old=new Map(previous.map(i=>[i.id,i]));
  return items.map(i=>{const p=old.get(i.id);if(!p)return i;if(p.channel!==i.channel)return {...i,firstSeen:p.firstSeen};return {...i,firstSeen:p.firstSeen,previousRank:p.rank,history:[...p.history.filter(h=>h.at>i.fetchedAt-RETAIN),{at:i.fetchedAt,rank:i.rank}].slice(-24)};});
}
async function buildFeed():Promise<Feed> {
  const now=Date.now(),warnings:string[]=[];let db=database();
  const cache=new Map(memory);
  if(db) try {
    const {results}=await db.prepare("SELECT source_id, payload FROM source_snapshots").all<{source_id:string;payload:string}>();
    for(const row of results){try{const value=JSON.parse(row.payload);if(!validSnapshot(value,row.source_id))throw new Error("shape");cache.set(row.source_id,value);}catch{cache.delete(row.source_id);warnings.push("一份来源缓存已损坏，将重新采集。");}}
  }catch {db=undefined;warnings.push("持久缓存暂不可用，当前使用临时缓存。");}
  let locked=false;const owner=crypto.randomUUID();
  const needsRefresh=SOURCES.some(s=>s.adapter!=="restricted"&&(cache.get(s.id)?.status.nextRefreshAt||0)<=now);
  if(db&&needsRefresh) try {
    const row=await db.prepare("INSERT INTO refresh_locks (key,owner,until) VALUES ('feed',?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,until=excluded.until WHERE refresh_locks.until < ? RETURNING key").bind(owner,now+55_000,now).first();
    locked=!!row;if(!locked)warnings.push("数据正在另一请求中刷新，稍后自动重试。");
  }catch{warnings.push("刷新锁暂不可用，本轮保留缓存。");}
  const mayRefresh=!db||locked||!needsRefresh;
  let fallbacks=0;
  async function permitUapi():Promise<boolean> {
    if(bindings().UAPI_KEY)return true;
    const month="uapi-month-"+new Date(now).toISOString().slice(0,7),day="uapi-day-"+new Date(now).toISOString().slice(0,10);
    if(db) {
      try {
        const consume=async(bucket:string,limit:number)=>!!await db!.prepare("INSERT INTO api_budgets (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count").bind(bucket,limit).first();
        if(!await consume(day,40))return false;
        return await consume(month,1200);
      }catch{return false;}
    }
    // A temporary isolate cannot enforce a cross-request monthly budget reliably.
    const n=temporaryBudget.get(day)||0;if(n>=10)return false;temporaryBudget.set(day,n+1);return true;
  }
  let updated=await batchMap(SOURCES,4,async(source):Promise<Snapshot>=>{
    const old=cache.get(source.id);
    if(source.adapter==="restricted"||(source.adapter==="youtube"&&!bindings().YOUTUBE_API_KEY))return {items:[],status:{id:source.id,state:"restricted",count:0,fetchedAt:null,checkedAt:now,nextRefreshAt:now+TTL,message:source.note}};
    if(old&&old.status.nextRefreshAt>now)return old;
    if(!mayRefresh)return old||{items:[],status:{id:source.id,state:"error",count:0,fetchedAt:null,checkedAt:now,nextRefreshAt:now+5000,message:"来源正在刷新，请稍后重试。"}};
    try {
      const result=await collect(source,now,bindings().YOUTUBE_API_KEY,bindings().UAPI_KEY,permitUapi,()=>fallbacks++<5);
      const items=mergeHistory(result.items,old?.items||[]);
      const stale=!!result.upstreamUpdatedAt&&now-result.upstreamUpdatedAt>TTL*3;
      const interval=(source.adapter==="uapi"||result.channel?.startsWith("UAPI"))&&!bindings().UAPI_KEY?6*60*60_000:TTL;
      return {items,status:{id:source.id,state:stale?"cached":"ok",count:items.length,fetchedAt:now,upstreamUpdatedAt:result.upstreamUpdatedAt,channel:result.channel,checkedAt:now,nextRefreshAt:now+interval,message:stale?"上游榜单更新时间较早，请查看原平台。":interval>TTL?"采集成功；访客配额模式，每 6 小时更新":"采集成功"}};
    }catch(e){
      const items=(old?.items||[]).filter(i=>now-i.fetchedAt<RETAIN);
      const msg=e instanceof Error?e.message:"来源请求失败";
      // Never echo URLs, keys, upstream HTML, or detailed network errors.
      const safe=/^HTTP \d+$/.test(msg)?msg:msg.startsWith("来源")||msg.startsWith("响应")?msg:"连接超时或来源暂不可访问";
      return {items,status:{id:source.id,state:items.length?"cached":"error",count:items.length,fetchedAt:old?.status.fetchedAt||null,upstreamUpdatedAt:old?.status.upstreamUpdatedAt,channel:old?.status.channel,checkedAt:now,nextRefreshAt:now+(source.adapter==="uapi"&&!bindings().UAPI_KEY?6*60*60_000:FAILURE_TTL),message:items.length?`${safe}；保留上次成功数据`:safe}};
    }
  });
  if(db&&locked) {
    const owns=await db.prepare("SELECT key FROM refresh_locks WHERE key='feed' AND owner=? AND until > ?").bind(owner,Date.now()).first().catch(()=>null);
    if(!owns){warnings.push("本轮采集超出刷新锁有效期，保留原缓存并稍后检查。");updated=updated.map(s=>cache.get(s.status.id)||{items:[],status:{...s.status,state:"error",count:0,fetchedAt:null,nextRefreshAt:Date.now()+15000,message:"等待下一次安全刷新"}});}
  }
  for(const s of updated)memory.set(s.status.id,s);
  if(db&&locked)try {
    const changed=updated.filter(s=>cache.get(s.status.id)!==s);
    if(changed.length)await db.batch(changed.map(s=>db!.prepare("INSERT INTO source_snapshots (source_id,payload,next_attempt) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM refresh_locks WHERE key='feed' AND owner=? AND until > ?) ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload,next_attempt=excluded.next_attempt").bind(s.status.id,JSON.stringify(s),s.status.nextRefreshAt,owner,Date.now())));
  }catch{warnings.push("本輪更新未能保存到持久缓存。");}finally{await db.prepare("DELETE FROM refresh_locks WHERE key='feed' AND owner=?").bind(owner).run().catch(()=>{});}
  const sources=updated.map(s=>s.status.count && now-(s.status.upstreamUpdatedAt||s.status.fetchedAt||now)>TTL*3?{...s.status,state:"cached" as const,message:s.status.state==="cached"?s.status.message:"采集时间较早，正在显示缓存记录"}:s.status);
  const stateMap=new Map(sources.map(s=>[s.id,s.state]));
  return {items:updated.flatMap(s=>s.items.map(i=>({...i,stale:stateMap.get(i.sourceId)==="cached"}))),sources,generatedAt:Date.now(),refreshAfter:Math.max(10_000,Math.min(...sources.filter(s=>s.state!=="restricted").map(s=>s.nextRefreshAt))-Date.now()),storage:db?"durable":"temporary",warnings};
}
export function getFeed():Promise<Feed> {
  if(!inflight)inflight=buildFeed().finally(()=>{inflight=null;});
  return inflight;
}
