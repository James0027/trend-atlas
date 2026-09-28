import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { boundedFetch } from "../network";

let instance: SupabaseClient | null = null;
export function browserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  instance ??= createBrowserClient(url, key, { global: { fetch: boundedFetch } });
  return instance;
}
