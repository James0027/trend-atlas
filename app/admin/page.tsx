'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { browserClient } from '@/lib/supabase/browser';

type Run = {id:string;started_at:string;ended_at:string|null;status:string;summary:Record<string,unknown>};
type State = {runs:Run[];snapshots:{source_id:string;next_attempt:number;updated_at:string}[];at:number};

function AdminPanel({ owner }: { owner: string }) {
  const [data,setData]=useState<State|null>(null);
  const [error,setError]=useState('');
  const [pending,setPending]=useState(true);
  const [result,setResult]=useState('');
  const lifecycle=useRef<AbortController|null>(null);
  const request=useCallback(async(method:'GET'|'POST', signal:AbortSignal)=>{
    const session=await browserClient()?.auth.getSession();
    const token=session?.data.session?.access_token;
    if(!token || session?.data.session?.user.id!==owner)throw new Error('登录已失效，请重新登录。');
    signal.throwIfAborted();
    const response=await fetch('/api/admin',{method,headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(method==='POST'?65_000:15_000)])});
    const value=await response.json();
    if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'暂时无法读取管理状态。');
    return value;
  },[owner]);
  const load=useCallback(async(signal:AbortSignal)=>{
    setPending(true);setError('');
    try {const value=await request('GET',signal);if(!signal.aborted)setData(value);}
    catch(failure){if(!signal.aborted)setError(failure instanceof Error?failure.message:'连接失败，请重试。');}
    finally{if(!signal.aborted)setPending(false);}
  },[request]);
  useEffect(()=>{
    const controller=new AbortController();lifecycle.current=controller;
    void request('GET',controller.signal)
      .then(value=>{if(!controller.signal.aborted)setData(value);})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'连接失败，请重试。');})
      .finally(()=>{if(!controller.signal.aborted)setPending(false);});
    return()=>controller.abort();
  },[request]);
  async function collect(){
    const signal=lifecycle.current?.signal;
    if(pending||!signal||signal.aborted)return;
    setPending(true);setError('');setResult('');
    try {
      const value=await request('POST',signal);
      if(signal.aborted)return;
      setResult(value.state==='busy'?'已有任务正在采集，稍后查看记录。':'本次后台采集已结束，结果见运行记录。');
      const latest=await request('GET',signal);
      if(!signal.aborted)setData(latest);
    }catch(failure){if(!signal.aborted)setError(failure instanceof Error?failure.message:'采集失败，请重试。');}
    finally{if(!signal.aborted)setPending(false);}
  }
  return <>
    <div className="my-8 flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">采集运行台</h1><p className="mt-2 text-sm text-slate-500">检查后台任务、来源更新与采集结果。</p></div>{data&&<div className="flex gap-2"><button className="button secondary" disabled={pending} onClick={()=>{const signal=lifecycle.current?.signal;if(signal)void load(signal);}}><RefreshCw size={15}/>检查状态</button><button className="button primary" disabled={pending} onClick={()=>void collect()}>{pending?<LoaderCircle size={15} className="spinning"/>:<Activity size={15}/>}采集到期来源</button></div>}</div>
    {pending&&!data&&<p role="status" className="mb-5 text-sm text-slate-500">正在检查管理权限与采集状态…</p>}
    {error&&<div role="alert" className="notice error"><span>{error}</span><button disabled={pending} onClick={()=>{const signal=lifecycle.current?.signal;if(signal)void load(signal);}}>重试</button></div>}
    {result&&<p role="status" className="notice">{result}</p>}
    {data&&<><p className="mb-5 text-sm text-slate-500">手动采集同样遵守来源更新周期、配额与刷新锁。</p>
      <section className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><caption className="p-4 text-left font-semibold">最近 20 次任务</caption><thead className="border-y bg-slate-50"><tr><th className="p-3">开始时间</th><th className="p-3">状态</th><th className="p-3">采集结果</th></tr></thead><tbody>{data.runs.map(run=><tr className="border-b" key={run.id}><td className="p-3 whitespace-nowrap">{new Date(run.started_at).toLocaleString('zh-CN')}</td><td className="p-3">{{running:'运行中',succeeded:'完成',partial:'部分完成',failed:'失败',skipped:'跳过'}[run.status]||run.status}</td><td className="p-3 text-slate-500">成功 {Number(run.summary.succeeded)||0} · 失败 {Number(run.summary.failed)||0} · 等待下轮 {Number(run.summary.deferred)||0}</td></tr>)}{!data.runs.length&&<tr><td colSpan={3} className="p-5 text-slate-500">尚无运行记录，部署定时任务后会在此显示。</td></tr>}</tbody></table></section>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.snapshots.map(source=><article key={source.source_id} className="rounded-xl border bg-white p-4"><h2 className="font-medium">{source.source_id}</h2><p className="mt-2 text-xs text-slate-500">最近写入：{new Date(source.updated_at).toLocaleString('zh-CN')}</p><p className="mt-1 text-xs text-slate-500">到期时间：{new Date(source.next_attempt).toLocaleString('zh-CN')}</p></article>)}</section></>}
  </>;
}
export default function AdminPage(){
  const {user,ready}=useAuth();
  return <main className="min-h-screen bg-[#f7f9f8] p-5 sm:p-10"><div className="mx-auto max-w-5xl"><Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft size={16}/>返回趋势大盘</Link>
    {!ready?<p className="mt-8">正在检查登录…</p>:!user?<><h1 className="mt-8 text-2xl font-semibold">采集运行台</h1><p className="mt-5">请先<Link className="ml-1 underline" href="/account">登录管理员账号</Link>。</p></>:<AdminPanel key={user.id} owner={user.id}/>}
  </div></main>;
}
