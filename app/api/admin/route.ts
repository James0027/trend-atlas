import { authenticatedClient } from "@/lib/supabase/request";
import { serviceDatabase } from "@/lib/database";
import { COLLECTION_REQUEST_BUDGET, runCollection, withinDeadline } from "@/lib/collector";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
async function authorize(request: Request, deadline: number) {
  // getUser's transport is already bounded at ten seconds. The route also caps
  // this read-only wait and includes it in the same budget as the collection.
  const auth = await withinDeadline(deadline, 10_000, () => authenticatedClient(request));
  if (!auth) return 401;
  const result = await withinDeadline(deadline, 8_000, signal => auth.client.rpc("is_admin").abortSignal(signal));
  if (result.error) return 503;
  return result.data === true ? 200 : 403;
}
export async function GET(request: Request) {
  const deadline = Date.now() + COLLECTION_REQUEST_BUDGET;
  try {
  const status = await authorize(request, deadline);
  if (status !== 200) return Response.json({ error: status === 401 ? "请先登录" : status === 403 ? "需要管理员权限" : "权限服务暂不可用" }, { status, headers });
  const db = serviceDatabase();
  if (!db) return Response.json({ error: "数据服务尚未配置" }, { status: 503, headers });
  const [runs, snapshots] = await Promise.all([
    withinDeadline(deadline, 8_000, signal => db.from("collection_runs").select("id,started_at,ended_at,status,summary").order("started_at", { ascending: false }).limit(20).abortSignal(signal)),
    withinDeadline(deadline, 8_000, signal => db.from("source_snapshots").select("source_id,next_attempt,updated_at").abortSignal(signal)),
  ]);
  if (runs.error || snapshots.error) return Response.json({ error: "暂时无法读取运行状态" }, { status: 503, headers });
  return Response.json({ runs: runs.data, snapshots: snapshots.data, at: Date.now() }, { headers });
  } catch { return Response.json({ error: "暂时无法读取管理状态" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const deadline = Date.now() + COLLECTION_REQUEST_BUDGET;
  try {
  const status = await authorize(request, deadline);
  if (status !== 200) return Response.json({ error: status === 401 ? "请先登录" : status === 403 ? "需要管理员权限" : "权限服务暂不可用" }, { status, headers });
  const db = serviceDatabase();
  if (!db) return Response.json({ error: "数据服务尚未配置" }, { status: 503, headers });
  const now = Date.now();
  const limit = await withinDeadline(deadline, 8_000, signal => db.rpc("consume_api_budget", {
    p_bucket: "admin-refresh-" + Math.floor(now / 60_000), p_limit: 1, p_expires: now + 120_000,
  }).abortSignal(signal));
  if (limit.error || limit.data !== true) return Response.json({ error: "请稍后再触发采集" }, { status: 429, headers });
  try {
    const result = await runCollection("manual", deadline);
    return Response.json(result, { status: result.state === "degraded" ? 503 : 200, headers });
  }
  catch { return Response.json({ error: "采集未完成，请检查运行记录" }, { status: 503, headers }); }
  } catch { return Response.json({ error: "采集未完成，请检查运行记录" }, { status: 503, headers }); }
}
