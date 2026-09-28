type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "ta-password-recovery";
const WINDOW = 60 * 60_000;
/** A same-tab UI marker, never an authorization credential. */
export function rememberRecovery(storage: RecoveryStorage, userId: string, now = Date.now()) {
  storage.setItem(KEY, JSON.stringify({ userId, expiresAt: now + WINDOW }));
}
export function hasRecovery(storage: RecoveryStorage, userId: string | undefined, now = Date.now()): boolean {
  if (!userId) return false;
  try {
    const value = JSON.parse(storage.getItem(KEY) || "null");
    return value?.userId === userId && Number.isSafeInteger(value.expiresAt)
      && value.expiresAt > now && value.expiresAt <= now + WINDOW;
  } catch { return false; }
}
export function clearRecovery(storage: RecoveryStorage) { storage.removeItem(KEY); }
