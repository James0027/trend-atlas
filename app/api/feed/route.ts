import { getFeed } from "@/lib/feed";
export async function GET() {
  try{return Response.json(await getFeed(),{headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}
  catch {return Response.json({error:"暂时无法读取趋势数据，请稍后重试。"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
