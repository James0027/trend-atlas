import type { Source } from "./types";

export const HISTORY_WINDOW = 24 * 60 * 60_000;
export const SNAPSHOT_RETENTION = 72 * 60 * 60_000;
export function sourceInterval(source: Source, channel?: string): number {
  if (source.adapter === "wikimedia" || source.adapter === "arxiv") return 24 * 60 * 60_000;
  if (source.adapter === "crossref") return 12 * 60 * 60_000;
  if (source.adapter === "youtube") return 60 * 60_000;
  if ((source.adapter === "uapi" || channel?.startsWith("UAPI")) && !process.env.UAPI_KEY) return 6 * 60 * 60_000;
  return 15 * 60_000;
}
export function safeCollectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^HTTP \d{3}$/.test(message)) return message;
  if (/^(来源|响应|需要配置)/.test(message) && message.length < 150 && !/https?:|Bearer|key=/i.test(message)) return message;
  return "连接超时或来源暂不可访问";
}
