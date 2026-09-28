import { emptyLibrary, parseLibrary } from "@/lib/library";
import { authenticatedClient, readSmallJSON } from "@/lib/supabase/request";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
  const auth = await authenticatedClient(request);
  if (!auth) return Response.json({ error: "请先登录" }, { status: 401, headers });
  const { data, error } = await auth.client.from("user_library").select("data,revision").eq("user_id", auth.user.id).maybeSingle();
  if (error) return Response.json({ error: "暂时无法读取云端收藏" }, { status: 503, headers });
  try { return Response.json({ data: data ? parseLibrary(data.data) : emptyLibrary(), revision: data?.revision || 0 }, { headers }); }
  catch { return Response.json({ error: "云端收藏格式异常，请联系管理员" }, { status: 503, headers }); }
  } catch { return Response.json({ error: "暂时无法读取云端收藏" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  try {
  const auth = await authenticatedClient(request);
  if (!auth) return Response.json({ error: "请先登录" }, { status: 401, headers });
  let data, revision;
  try {
    const body = await readSmallJSON(request) as { data?: unknown; revision?: unknown };
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) throw new Error("Invalid revision");
    data = parseLibrary(body.data); revision = Number(body.revision);
    if (Buffer.byteLength(JSON.stringify(data)) > 500_000) throw new Error("Too large");
  } catch { return Response.json({ error: "收藏数据格式不正确或容量已满" }, { status: 400, headers }); }
  const result = await auth.client.rpc("save_library", { p_data: data, p_expected_revision: revision });
  if (result.error?.code === "40001") return Response.json({ error: "其他设备已更新，请合并后重试" }, { status: 409, headers });
  if (result.error || !result.data?.[0]) return Response.json({ error: "暂时无法保存云端收藏" }, { status: 503, headers });
  return Response.json({ data: parseLibrary(result.data[0].data), revision: result.data[0].revision }, { headers });
  } catch { return Response.json({ error: "暂时无法保存云端收藏" }, { status: 503, headers }); }
}
