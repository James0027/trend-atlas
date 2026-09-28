'use client';

import React from 'react';
import Link from 'next/link';
import { LogIn, UserRound } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';

function getShortenedEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return email.length > 12 ? `${email.slice(0, 10)}…` : email;
  }
  const name = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const shortName = name.length > 7 ? `${name.slice(0, 6)}…` : name;
  return `${shortName}${domain}`;
}

export default function AccountMenu() {
  const { user, ready } = useAuth();

  if (!ready) {
    return (
      <div
        className="ghost-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 dark:text-slate-500 rounded-md select-none pointer-events-none"
        aria-hidden="true"
      >
        <span className="w-3.5 h-3.5 rounded-full bg-slate-200 dark:bg-slate-700 animate-pulse" />
        <span className="w-12 h-3 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
      </div>
    );
  }

  if (user) {
    const displayEmail = user.email ? getShortenedEmail(user.email) : '我的账户';
    return (
      <Link
        href="/account"
        className="ghost-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-200 dark:hover:text-white dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        title={user.email || '账户中心'}
        aria-label={`已登录：${user.email || '我的账户'}`}
      >
        <UserRound className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
        <span className="max-w-[140px] truncate">{displayEmail}</span>
      </Link>
    );
  }

  return (
    <Link
      href="/account"
      className="ghost-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-200 dark:hover:text-white dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      aria-label="登录或同步账户数据"
    >
      <LogIn className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
      <span>登录 / 同步</span>
    </Link>
  );
}
