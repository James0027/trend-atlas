# Trend Atlas development

Canonical source: `D:\个人项目\trend-atlas`. The earlier Sites checkout is a preserved deployment, not the production workspace.

Target: public global personal/noncommercial website, strict free budget. Next.js App Router + React + TypeScript, Tailwind/shadcn, Supabase PostgreSQL/Auth/Cron, Vercel, GitHub CI. Never purchase resources, enable paid plans, or publish secrets.

All contributors share this checkout. Own only the files assigned to you, accommodate others' changes, and never revert unrelated edits. Do not commit/push/deploy from delegated tasks unless explicitly assigned.

Source rules: real source records only; region denotes the source market/edition; source order/metrics and sampled score are distinct; failed or unauthorized sources show status and entry links. No fabricated fallback entries, cross-platform metric sums, or full article copies. Keep provenance and required attribution.

User data: bookmarks, saved filters, and topic corrections belong to the authenticated user. Enforce row-level security, validate inputs, and retain a usable guest mode. Never expose service-role keys to client bundles.

Runtime: public GET feed reads shared durable snapshots; protected scheduled collection writes snapshots, applies per-source TTL/backoff/quota limits, and uses expiring owner-scoped leases. User refresh must not multiply upstream collection work.

Verification: typecheck, focused behavioral tests, production build, browser flows, and real deployed checks. A green local build is not evidence of cloud scheduling/auth persistence. Record unverified requirements explicitly in `PRODUCTION_PLAN.md`.
