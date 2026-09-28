"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import { useAuth } from "@/components/auth-provider";
import { applyOperations, emptyLibrary, libraryDiff, parseLibrary } from "@/lib/library";
import type { LibraryData, LibraryOperation, LibraryRecord } from "@/lib/library";
import { acknowledgeDraft, appendDraft, draftOperations, guestImportOperations, readGuestLibrary, readLibraryDraft, writeLibraryDraft } from "@/lib/library-draft";
import type { DraftEntry } from "@/lib/library-draft";
import { browserClient } from "@/lib/supabase/browser";
import type { Item, SavedView, Topic } from "@/lib/types";

type SyncState = "guest" | "loading" | "syncing" | "synced" | "error";
function readGuest(): LibraryData {
  try { return readGuestLibrary(localStorage); }
  catch { return emptyLibrary(); }
}
function saveGuest(data: LibraryData) {
  localStorage.setItem("ta-bookmarks", JSON.stringify(data.bookmarks));
  localStorage.setItem("ta-views", JSON.stringify(data.views));
  localStorage.setItem("ta-overrides", JSON.stringify(data.overrides));
}
function persistDraft(account: string, entries: DraftEntry[]) {
  try { writeLibraryDraft(sessionStorage, account, entries); }
  catch (failure) { throw new Error(failure instanceof Error && /^(草稿|未同步|当前标签页)/.test(failure.message)
    ? failure.message : "当前标签页无法保存未同步草稿，请检查浏览器存储后重试"); }
}
async function cloudRequest(method: "GET" | "POST", body?: LibraryRecord, signal?: AbortSignal, expectedOwner?: string): Promise<LibraryRecord> {
  const client = browserClient();
  const session = await client?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token || !expectedOwner || session?.data.session?.user.id !== expectedOwner) throw new Error("登录已失效，请重新登录");
  const response = await fetch("/api/library", { method, signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]), cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (response.status === 409) throw new Error("conflict");
  if (!response.ok) throw new Error(response.status === 401 ? "登录已失效，请重新登录" : "云端同步暂不可用，改动尚未同步");
  const record = await response.json();
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error("云端收藏格式异常");
  return { data: parseLibrary(record.data), revision: record.revision };
}

export function useLibraryState() {
  const { user, ready } = useAuth();
  const userId = user?.id;
  const [data, setData] = useState<LibraryData>(emptyLibrary);
  const [state, setState] = useState<SyncState>("loading");
  const [message, setMessage] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const record = useRef<LibraryRecord>({ data: emptyLibrary(), revision: 0 });
  const pending = useRef<DraftEntry[]>([]);
  const draftNeedsWrite = useRef(false), draftNotice = useRef("");
  const generation = useRef(0), saving = useRef(false), loaded = useRef(false);
  const owner = useRef<string | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const loading = useRef(false);

  const flush = useCallback(async () => {
    if (saving.current || !owner.current || !loaded.current) return;
    saving.current = true;
    const epoch = generation.current;
    const account = owner.current;
    try {
      setState("syncing"); setMessage("");
      draftNeedsWrite.current = true; setHasPending(true);
      persistDraft(account, pending.current);
      draftNeedsWrite.current = false; setHasPending(pending.current.length > 0);
      let conflicts = 0;
      while (epoch === generation.current && pending.current.length) {
        const batch = pending.current.slice();
        const proposed = applyOperations(record.current.data, draftOperations(batch));
        try {
          const saved = await cloudRequest("POST", { data: proposed, revision: record.current.revision }, abort.current?.signal, account);
          if (epoch !== generation.current) return;
          pending.current = acknowledgeDraft(pending.current, batch); record.current = saved;
          setData(applyOperations(saved.data, draftOperations(pending.current))); conflicts = 0;
          draftNeedsWrite.current = true; setHasPending(true);
          try { persistDraft(account, pending.current); }
          catch { throw new Error("云端已确认本轮改动，但标签页草稿清理失败；请重试后再退出或关闭页面"); }
          draftNeedsWrite.current = false; setHasPending(pending.current.length > 0);
        } catch (failure) {
          if (epoch !== generation.current) return;
          if (failure instanceof Error && failure.message === "conflict" && conflicts++ < 3) {
            const latest = await cloudRequest("GET", undefined, abort.current?.signal, account);
            if (epoch !== generation.current) return;
            record.current = latest; setData(applyOperations(latest.data, draftOperations(pending.current))); continue;
          }
          throw failure;
        }
      }
      if (epoch === generation.current) setState("synced");
    } catch (failure) {
      if (epoch === generation.current) { setState("error"); setMessage(failure instanceof Error && failure.message !== "conflict" ? failure.message : "同步冲突，请重试合并"); }
    } finally { if (epoch === generation.current) saving.current = false; }
  }, []);

  const load = useCallback(async () => {
    if (!owner.current || saving.current || loading.current) return;
    if (loaded.current && (pending.current.length || draftNeedsWrite.current)) { void flush(); return; }
    const epoch = generation.current;
    const account = owner.current;
    loading.current = true; loaded.current = false; setCanEdit(false); setState("loading");
    try {
      const saved = await cloudRequest("GET", undefined, abort.current?.signal, account);
      if (epoch !== generation.current) return;
      record.current = saved; loaded.current = true; setCanEdit(true);
      setData(applyOperations(saved.data, draftOperations(pending.current)));
      setMessage(draftNotice.current); setState(pending.current.length ? "syncing" : "synced");
      if (pending.current.length) void flush();
    } catch { if (epoch === generation.current) { loaded.current = false; setState("error"); setMessage("无法读取云端收藏，请重试。游客数据仍保留在此浏览器。"); } }
    finally { if (epoch === generation.current) loading.current = false; }
  }, [flush]);

  useEffect(() => {
    if (!ready) return;
    const epoch = ++generation.current;
    const controller = new AbortController(); abort.current = controller;
    owner.current = userId || null;
    // Initialize from the external storage after mounting. AccountLibrary's key
    // prevents the previous user's records from rendering during this read.
    void Promise.resolve().then(() => {
      if (generation.current !== epoch) return;
      if (userId) {
        try {
          const restored = readLibraryDraft(sessionStorage, userId);
          pending.current = restored.entries; draftNotice.current = restored.warning || "";
        } catch { draftNotice.current = "当前标签页草稿无法读取，请检查浏览器存储后再修改收藏"; }
        setHasPending(pending.current.length > 0);
        // A draft cannot supply the cloud revision. Always load the baseline first.
        void load();
      }
      else { const guest = readGuest(); record.current.data = guest; loaded.current = true; setCanEdit(true); setData(guest); setState("guest"); }
    });
    return () => { generation.current += 1; controller.abort(); abort.current?.abort(); const scheduled = timer.current; if (scheduled) clearTimeout(scheduled); };
  }, [userId, ready, load]);

  useEffect(() => {
    const focus = () => { if (owner.current && document.visibilityState === "visible") void load(); };
    const leave = (event: BeforeUnloadEvent) => { if (pending.current.length || draftNeedsWrite.current) { event.preventDefault(); event.returnValue = ""; } };
    document.addEventListener("visibilitychange", focus); window.addEventListener("beforeunload", leave);
    return () => { document.removeEventListener("visibilitychange", focus); window.removeEventListener("beforeunload", leave); };
  }, [load]);

  function mutate(operations: LibraryOperation[]) {
    if (!loaded.current) { setMessage("请先完成收藏数据加载或重试连接"); return; }
    const base = applyOperations(record.current.data, draftOperations(pending.current));
    const next = parseLibrary(applyOperations(base, operations));
    if (JSON.stringify(next) === JSON.stringify(base)) return;
    if (new TextEncoder().encode(JSON.stringify(next)).byteLength > 500_000) { setMessage("收藏容量已达上限，请先清理部分条目"); return; }
    if (!owner.current) {
      record.current.data = next; setData(next);
      try { saveGuest(next); setState("guest"); setMessage(""); }
      catch { setState("error"); setMessage("浏览器存储不可用，改动仅在本次会话保留"); }
    } else {
      if (!operations.length) return;
      let entries: DraftEntry[];
      try { entries = appendDraft(pending.current, operations); persistDraft(owner.current, entries); }
      catch (failure) { setState("error"); setMessage(failure instanceof Error ? failure.message : "未同步草稿无法保存，本次改动未接受"); return; }
      pending.current = entries; draftNeedsWrite.current = false;
      setData(next); setState("syncing"); setMessage("");
      setHasPending(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 200);
    }
  }
  function replace<K extends keyof LibraryData>(section: K, update: SetStateAction<LibraryData[K]>) {
    const base = applyOperations(record.current.data, draftOperations(pending.current));
    const next = typeof update === "function" ? (update as (value: LibraryData[K]) => LibraryData[K])(base[section]) : update;
    mutate(libraryDiff(section, base[section], next));
  }
  function importGuest() {
    const guest = readGuest();
    mutate(guestImportOperations(guest));
  }
  function discardPending(): boolean {
    const account = owner.current;
    if (!account) return true;
    try { persistDraft(account, []); }
    catch (failure) { setState("error"); setMessage(failure instanceof Error ? failure.message : "草稿无法清除，请重试后再退出"); return false; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    generation.current += 1; abort.current?.abort(); abort.current = new AbortController();
    pending.current = []; draftNeedsWrite.current = false; saving.current = false; loading.current = false;
    setHasPending(false); setData(record.current.data);
    setState(loaded.current ? "synced" : "error");
    setMessage(loaded.current ? "" : "已放弃未同步草稿，请重试读取云端收藏");
    return true;
  }
  return { ...data, state, message, mode: user ? "cloud" as const : "guest" as const, available: canEdit, hasPending,
    setBookmarks: (update: SetStateAction<Item[]>) => replace("bookmarks", update),
    setViews: (update: SetStateAction<SavedView[]>) => replace("views", update),
    setOverrides: (update: SetStateAction<Record<string, Topic[]>>) => replace("overrides", update),
    retry: () => loaded.current && (pending.current.length || draftNeedsWrite.current) ? void flush() : void load(),
    importGuest, discardPending, clear: () => mutate([{ section: "clear" }]) };
}
