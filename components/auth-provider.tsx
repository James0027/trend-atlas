'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { browserClient } from '@/lib/supabase/browser';
import { clearRecovery, hasRecovery, rememberRecovery } from '@/lib/recovery';

export interface AuthContextType {
  user: User | null;
  ready: boolean;
  configured: boolean;
  emailEnabled: boolean;
  githubEnabled: boolean;
  recoveryAuthorized: boolean;
  dismissRecovery: () => void;
  signInWithGithub: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const emailEnabled = process.env.NEXT_PUBLIC_AUTH_EMAIL_ENABLED !== 'false';
  const githubEnabled = process.env.NEXT_PUBLIC_AUTH_GITHUB_ENABLED === 'true';
  const [ready, setReady] = useState(!configured);
  const [recoveryAuthorized, setRecoveryAuthorized] = useState(false);

  const dismissRecovery = useCallback(() => {
    setRecoveryAuthorized(false);
    try { clearRecovery(sessionStorage); } catch { /* No stored marker. */ }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let hasReceivedAuthEvent = false;

    const client = browserClient();
    if (!client) return;

    client.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!isMounted) return;
        if (!hasReceivedAuthEvent) {
          setUser(session?.user ?? null);
          try { setRecoveryAuthorized(hasRecovery(sessionStorage, session?.user.id)); } catch { setRecoveryAuthorized(false); }
          setReady(true);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        if (!hasReceivedAuthEvent) {
          setUser(null);
          setReady(true);
        }
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        try { rememberRecovery(sessionStorage, session.user.id); } catch { /* Session memory still permits this immediate recovery. */ }
        setRecoveryAuthorized(true);
      } else {
        try {
          if (event === 'SIGNED_OUT') clearRecovery(sessionStorage);
          setRecoveryAuthorized(hasRecovery(sessionStorage, session?.user.id));
        } catch { setRecoveryAuthorized(false); }
      }
      hasReceivedAuthEvent = true;
      setUser(session?.user ?? null);
      setReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGithub = useCallback(async (): Promise<void> => {
    const client = browserClient();
    if (!client || !githubEnabled) throw new Error('GitHub 登录暂未开放');
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch {
      throw new Error('无法连接 GitHub 登录，请稍后重试');
    }
  }, [githubEnabled]);

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    const client = browserClient();
    if (!client) {
      throw new Error('身份认证服务未配置');
    }
    const cleanEmail = email.trim();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      throw new Error('请输入有效的邮箱地址');
    }
    if (!password) {
      throw new Error('请输入密码');
    }

    try {
      const { error } = await client.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error) {
        throw new Error('登录失败，请检查邮箱与密码是否正确');
      }
    } catch (err) {
      if (err instanceof Error && err.message === '登录失败，请检查邮箱与密码是否正确') {
        throw err;
      }
      throw new Error('登录失败，请检查邮箱与密码是否正确');
    }
  }, []);

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ needsConfirmation: boolean }> => {
      const client = browserClient();
      if (!client) {
        throw new Error('身份认证服务未配置');
      }
      const cleanEmail = email.trim();
      if (!cleanEmail || !isValidEmail(cleanEmail)) {
        throw new Error('请输入有效的邮箱地址');
      }
      if (!password || password.length < 8) {
        throw new Error('密码长度至少需要 8 个字符');
      }

      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/account` : undefined;

      try {
        const { data, error } = await client.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: redirectTo,
          },
        });

        if (error) {
          throw new Error('注册失败，请稍后重试或检查该邮箱是否已被注册');
        }

        const needsConfirmation = !data.session;
        return { needsConfirmation };
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('注册失败')) {
          throw err;
        }
        throw new Error('注册失败，请检查网络或稍后重试');
      }
    },
    []
  );

  const signOut = useCallback(async (): Promise<void> => {
    const client = browserClient();
    if (!client) {
      throw new Error('身份认证服务未配置');
    }

    try {
      const { error } = await client.auth.signOut();
      if (error) {
        throw new Error('退出登录失败，请重试');
      }
    } catch (err) {
      if (err instanceof Error && err.message === '退出登录失败，请重试') {
        throw err;
      }
      throw new Error('退出登录失败，请重试');
    }
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<void> => {
    const client = browserClient();
    if (!client) {
      throw new Error('身份认证服务未配置');
    }
    const cleanEmail = email.trim();
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      throw new Error('请输入有效的邮箱地址');
    }

    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/account?mode=recovery`
        : undefined;

    try {
      const { error } = await client.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });
      if (error) {
        throw new Error('发送重置密码邮件失败，请稍后重试');
      }
    } catch (err) {
      if (err instanceof Error && err.message === '发送重置密码邮件失败，请稍后重试') {
        throw err;
      }
      throw new Error('发送重置密码邮件失败，请稍后重试');
    }
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<void> => {
    const client = browserClient();
    if (!client) {
      throw new Error('身份认证服务未配置');
    }
    if (!password || password.length < 8) {
      throw new Error('新密码长度至少需要 8 个字符');
    }

    try {
      // The persisted marker only restores the form. The backend session and
      // current account must still be verified before changing a password.
      const { data: verified, error: verifyError } = await client.auth.getUser();
      if (verifyError || !verified.user || verified.user.id !== user?.id || !recoveryAuthorized) {
        throw new Error('重置会话已失效，请重新申请邮件');
      }
      const { error } = await client.auth.updateUser({
        password,
      });
      if (error) {
        throw new Error('更新密码失败，请稍后重试');
      }
      setRecoveryAuthorized(false);
      try { clearRecovery(sessionStorage); } catch { /* No stored marker. */ }
    } catch (err) {
      if (err instanceof Error && ['更新密码失败，请稍后重试', '重置会话已失效，请重新申请邮件'].includes(err.message)) {
        throw err;
      }
      throw new Error('更新密码失败，请稍后重试');
    }
  }, [user, recoveryAuthorized]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      ready,
      configured,
      emailEnabled,
      githubEnabled,
      recoveryAuthorized,
      dismissRecovery,
      signInWithGithub,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
    }),
    [user, ready, configured, emailEnabled, githubEnabled, recoveryAuthorized, dismissRecovery, signInWithGithub, signIn, signUp, signOut, resetPassword, updatePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用');
  }
  return context;
}
