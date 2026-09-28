'use client';

import { Suspense, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, LogIn, LoaderCircle, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { useLibrary } from '@/components/library-provider';

type Mode = 'signin' | 'signup' | 'reset' | 'recovery';

function AccountContent() {
  const auth = useAuth();
  const library = useLibrary();
  const query = useSearchParams();
  const [mode, setMode] = useState<Mode>(query.get('mode') === 'recovery' ? 'recovery' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState(query.get('error') === 'oauth' ? '登录授权未完成，请重新尝试。' : '');
  const [notice, setNotice] = useState('');
  const recovery = mode !== 'reset' && (auth.recoveryAuthorized || mode === 'recovery');
  const showAccount = Boolean(auth.user && !recovery && mode !== 'reset');

  function changeMode(next: Mode) {
    if (next !== 'recovery' && (auth.recoveryAuthorized || mode === 'recovery')) {
      auth.dismissRecovery();
      window.history.replaceState(window.history.state, '', '/account');
    }
    setMode(next); setPassword(''); setConfirmation(''); setError(''); setNotice('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError(''); setNotice('');
    if ((mode === 'signup' || recovery) && (password.length < 8 || password !== confirmation)) {
      setError(password.length < 8 ? '密码至少需要 8 个字符。' : '两次输入的密码不一致。'); return;
    }
    if (recovery && !auth.recoveryAuthorized) { setError('重置链接已失效，请重新申请邮件。'); return; }
    busy.current = true; setPending(true);
    try {
      if (recovery) {
        await auth.updatePassword(password); setMode('signin'); window.history.replaceState(window.history.state, '', '/account'); setNotice('密码已更新。');
      } else if (mode === 'signup') {
        const result = await auth.signUp(email, password);
        setNotice(result.needsConfirmation ? '若此邮箱可接收邮件，请查看收件箱完成验证。' : '注册成功，已登录。');
      } else if (mode === 'reset') {
        await auth.resetPassword(email); setNotice('若此邮箱可接收邮件，请查看收件箱中的重置链接。');
      } else { await auth.signIn(email, password); }
      setPassword(''); setConfirmation('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，请稍后重试。'); }
    finally { busy.current = false; setPending(false); }
  }
  async function oauth() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await auth.signInWithGithub(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '授权失败，请重试。'); busy.current = false; setPending(false); }
  }
  async function logout(discard = false) {
    if (busy.current || (library.hasPending && !discard)) return;
    if (discard && !library.discardPending()) return;
    busy.current = true; setPending(true); setError('');
    try { await auth.signOut(); setNotice('已退出登录。'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '退出失败，请重试。'); }
    finally { busy.current = false; setPending(false); }
  }
  const button = 'button primary w-full justify-center min-h-11';
  const field = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100';
  const title = !auth.configured ? '账号服务正在配置中' : showAccount ? '我的账户' : recovery ? '设置新密码' : mode === 'signup' ? '创建账户' : mode === 'reset' ? '找回密码' : '登录 Trend Atlas';

  return <main className="min-h-screen bg-[#f7f9f8] px-5 py-8 sm:py-14 text-slate-800">
    <div className="mx-auto max-w-md">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-teal-700"><ArrowLeft size={16}/>返回趋势大盘</Link>
      <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><UserRound size={23}/></div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{showAccount ? auth.user?.email || '已登录' : '收藏值得再看的内容，跨设备保存筛选视图与分类偏好。公开趋势无需登录。'}</p>
        {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}
        {notice && <p role="status" className="mt-5 rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-800">{notice}</p>}
        {!auth.configured ? <><p className="mt-5 text-sm leading-6 text-slate-500">账户连接尚未完成。可以先使用游客收藏与公开浏览。</p><Link href="/" className={`${button} mt-6`}>返回首页浏览</Link></>
          : !auth.ready ? <p role="status" className="mt-7 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={17} className="spinning"/>正在检查账户状态…</p>
          : showAccount ? <>
            <div className="mt-6 rounded-xl border border-teal-100 bg-teal-50/50 p-4">
              <h2 className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={17} className="text-teal-700"/>云端收藏与视图</h2>
              <p role="status" className="mt-3 text-sm leading-6 text-slate-600">{library.message || ({loading:'正在读取云端数据…', syncing:'正在同步改动…', synced:'云端数据已同步。', error:'暂时无法连接云端。', guest:'正在切换收藏模式…'}[library.state])}</p>
              {library.state === 'error' && <button type="button" className="mt-3 text-sm text-teal-700 underline" onClick={library.retry}>重试同步</button>}
              <p className="mt-3 text-xs leading-5 text-slate-500">游客收藏继续保留在此浏览器，只有主动导入后才会保存到当前账号。</p>
            </div>
            <Link className={`${button} mt-6`} href="/">返回趋势大盘</Link>
            <Link href="/admin" className="mt-4 block text-center text-sm text-slate-500 underline">查看采集运行台</Link>
            <button type="button" className="button secondary mt-6 w-full justify-center min-h-11" disabled={pending || library.hasPending} onClick={()=>void logout()}><LogOut size={16}/>{pending ? '正在退出…' : '退出当前登录'}</button>
            {library.hasPending && <p className="mt-3 text-xs leading-5 text-amber-800">改动尚未同步，请重试后退出。{library.state === 'error' && <button type="button" disabled={pending} className="mt-2 block underline" onClick={()=>void logout(true)}>放弃未同步改动并退出</button>}</p>}
          </> : <>
            {auth.githubEnabled && !recovery && <button type="button" className="button secondary mt-6 w-full justify-center min-h-11" onClick={()=>void oauth()} disabled={pending}><LogIn size={18}/>{pending ? '正在连接…' : '使用 GitHub 继续'}</button>}
            {auth.emailEnabled || recovery ? <>
              {auth.githubEnabled && !recovery && <p className="my-5 text-center text-xs text-slate-400">或使用邮箱</p>}
              {!recovery && mode !== 'reset' && <div className="mt-5 flex border-b text-sm"><button type="button" disabled={pending} aria-pressed={mode==='signin'} className={`flex-1 py-3 ${mode==='signin'?'border-b-2 border-teal-700 text-teal-700':'text-slate-500'}`} onClick={()=>changeMode('signin')}>账号登录</button><button type="button" disabled={pending} aria-pressed={mode==='signup'} className={`flex-1 py-3 ${mode==='signup'?'border-b-2 border-teal-700 text-teal-700':'text-slate-500'}`} onClick={()=>changeMode('signup')}>注册账户</button></div>}
              <form onSubmit={submit} className="mt-6 space-y-5">
                {!recovery && <label className="block text-sm font-medium" htmlFor="account-email">邮箱<input id="account-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className={field} disabled={pending}/></label>}
                {mode !== 'reset' && <label className="block text-sm font-medium" htmlFor="account-password">{recovery?'新密码':'密码'}<input id="account-password" type="password" autoComplete={mode==='signup'||recovery?'new-password':'current-password'} minLength={mode==='signup'||recovery?8:undefined} required value={password} onChange={e=>setPassword(e.target.value)} className={field} disabled={pending}/></label>}
                {(mode==='signup'||recovery) && <label className="block text-sm font-medium" htmlFor="account-confirmation">确认密码<input id="account-confirmation" type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={e=>setConfirmation(e.target.value)} className={field} disabled={pending}/><span className="mt-2 block text-xs font-normal text-slate-500">至少 8 个字符。</span></label>}
                {recovery && !auth.recoveryAuthorized && <p role="alert" className="text-sm leading-6 text-amber-800">重置链接未验证或已失效，请重新申请邮件。</p>}
                <button className={button} type="submit" disabled={pending || (recovery && !auth.recoveryAuthorized)}>{pending?<><LoaderCircle size={16} className="spinning"/>正在处理…</>:recovery?'更新密码':mode==='signup'?'创建账户':mode==='reset'?'发送重置邮件':'登录'}</button>
              </form>
              {!recovery && <button type="button" className="mt-5 w-full text-sm text-slate-500 underline" disabled={pending} onClick={()=>changeMode(mode==='reset'?'signin':'reset')}>{mode==='reset'?'返回登录':'忘记密码？'}</button>}
              {recovery && <button type="button" className="mt-5 w-full text-sm text-slate-500 underline" disabled={pending} onClick={()=>changeMode('reset')}>重新申请重置邮件</button>}
            </> : <p className="mt-5 text-sm leading-6 text-slate-500">{auth.githubEnabled ? '首次授权后即可建立账户，无需设置新密码。' : '公开登录正在配置中，请先使用游客收藏。'}</p>}
          </>}
      </section>
      <p className="mt-6 text-center text-xs leading-5 text-slate-400">个人收藏仅当前账号可见。趋势条目仍属于原发布平台。</p>
    </div>
  </main>;
}
export default function AccountPage() {
  return <Suspense fallback={<main className="p-8 text-sm text-slate-500">正在加载账户…</main>}><AccountContent/></Suspense>;
}
