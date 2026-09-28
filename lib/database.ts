import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { boundedFetch } from "./network";

export function serverConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  let validUrl = false;
  try { validUrl = new URL(url).protocol === "https:"; } catch { /* Not configured. */ }
  return {
    url,
    key,
    configured: validUrl && key.length > 0,
    youtubeKey: process.env.YOUTUBE_API_KEY?.trim() || undefined,
    uapiKey: process.env.UAPI_KEY?.trim() || undefined,
  };
}

let cachedClient: SupabaseClient | null = null;
let cachedIdentity = "";
export function serviceDatabase(): SupabaseClient | null {
  const configuration = serverConfiguration();
  if (!configuration.configured) return null;
  const identity = `${configuration.url}\u0000${configuration.key}`;
  if (!cachedClient || cachedIdentity !== identity) {
    cachedClient = createClient(configuration.url, configuration.key, {
      global: { fetch: boundedFetch },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    cachedIdentity = identity;
  }
  return cachedClient;
}
