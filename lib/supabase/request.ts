import "server-only";
import { createClient } from "@supabase/supabase-js";
import { boundedFetch } from "../network";

export async function authenticatedClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get("authorization") || "";
  if (!url || !key || !/^Bearer [\w.\-]{20,4096}$/.test(authorization)) return null;
  const client = createClient(url, key, { global: { fetch: boundedFetch, headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  return error || !data.user ? null : { client, user: data.user };
}
export async function readSmallJSON(request: Request, limit = 510_000): Promise<unknown> {
  if (!request.body || Number(request.headers.get("content-length") || 0) > limit) throw new Error("Invalid body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("Body too large"); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(buffer));
}
