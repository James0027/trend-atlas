import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir(".sites-runtime",{recursive:true});
await build({entryPoints:["tests/core.ts"],outfile:".sites-runtime/core-tests.mjs",platform:"node",target:"node24",format:"esm",bundle:true,plugins:[{name:"worker-test-bindings",setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:"bindings",namespace:"test-env"}));b.onLoad({filter:/.*/,namespace:"test-env"},()=>({contents:"globalThis.__testEnv ||= {}; export const env = globalThis.__testEnv;",loader:"js"}));}}]});
const r=spawnSync(process.execPath,[".sites-runtime/core-tests.mjs"],{stdio:"inherit"});if(r.error)throw r.error;process.exit(r.status??1);
