import { env } from "cloudflare:workers";
type Bindings = { DB?: D1Database; YOUTUBE_API_KEY?: string; UAPI_KEY?:string };
export function bindings():Bindings { return env as unknown as Bindings; }
export function database():D1Database | undefined { return bindings().DB; }
