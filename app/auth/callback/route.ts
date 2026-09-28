import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { boundedFetch } from "@/lib/network";

/** PKCE exchanges the one-use code with the public key and browser verifier. */
export async function GET(request: Request) {
  const location = new URL(request.url);
  const code = location.searchParams.get("code");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const target = new URL("/account?error=oauth", location.origin);
  if (code && code.length <= 4096 && url && key) {
    try {
      const store = await cookies();
      const client = createServerClient(url, key, {
        global: { fetch: boundedFetch },
        cookies: {
          getAll: () => store.getAll(),
          setAll: values => values.forEach(({ name, value, options }) => store.set(name, value, options)),
        },
      });
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) target.search = "";
    } catch { /* Keep tokens, provider details and internal errors private. */ }
  }
  // Fixed same-origin path: arbitrary next/forwarded-host parameters cannot redirect a user elsewhere.
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
