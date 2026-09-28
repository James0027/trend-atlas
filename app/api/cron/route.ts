import { createHash, timingSafeEqual } from "node:crypto";
import { COLLECTION_REQUEST_BUDGET, runCollection } from "@/lib/collector";
import { serverConfiguration } from "@/lib/database";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request, secret: string): boolean {
  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

async function handle(request: Request) {
  const deadline = Date.now() + COLLECTION_REQUEST_BUDGET;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !serverConfiguration().configured) {
    return Response.json({ error: "云端采集尚未配置。" }, { status: 503, headers });
  }
  if (!authorized(request, secret)) return Response.json({ error: "未授权。" }, { status: 401, headers });
  try {
    const result = await runCollection("cron", deadline);
    return Response.json(result, { status: result.state === "degraded" ? 503 : 200, headers });
  } catch {
    return Response.json({ error: "云端采集暂不可用。" }, { status: 503, headers });
  }
}

export const GET = handle;
export const POST = handle;
