# Production delivery

## Confirmed direction

- Public browsing, global deployment, strict free budget and personal noncommercial operation.
- Canonical source in `D:\个人项目\trend-atlas`; GitHub owner `James0027`, repository `trend-atlas`.
- Standard Next.js/React/TypeScript, Tailwind/shadcn, Supabase PostgreSQL/Auth/Cron, Vercel.
- Gemini is an external Antigravity CLI worker. Tasks have bounded ownership; Codex reviews changes and tests the integrated application.

## Acceptance ledger

| Requirement | Evidence needed | Current state |
|---|---|---|
| Canonical D drive project | Directory + Git history + production changes | D drive Git main pushed and tracking GitHub main |
| GitHub repository | Remote URL + pushed commit | Private repository [James0027/trend-atlas](https://github.com/James0027/trend-atlas), main pushed |
| Standard Next.js | Dependency lock + successful production build | Next.js 16 build passed on Node 24 |
| Public deployed website | Ready deployment + anonymous HTTP/browser access | Vercel `dpl_F3EPKGzaEJgakyj691GLsUCZXfnZ` READY; [public site](https://trend-atlas-eta.vercel.app) HTTP 200 and desktop/mobile rendered |
| Global region/topic/platform discovery | Real feed + combined filter browser checks | 32 real cloud source rows, live API and browser render verified; combined fixture filters passed |
| Search, sort, dedupe, list/cards, details | Behavioral/browser checks | Desktop/mobile fixture browser flows and live anonymous render passed |
| Real public sources + coverage/status | Current source requests + documented provenance | 19/32 currently OK, 4 error, 9 restricted; 808 real items after seed |
| Protected scheduled collection | Cron job definition + successful cloud run + stored results | Manual cloud collection stored; Cron install pending |
| Independent refresh with no visitor | Two scheduled runs and timestamps | Pending live Cron verification |
| Backoff, quotas, leases, bounded history | Concurrent/failure tests + schema/RPC | Unit and cloud SQL checks passed; scheduled behavior pending |
| Guest bookmarks/views/corrections/export | Browser tests and safe CSV | Guest bookmark/view desktop/mobile flows passed; remaining live behavior pending |
| Account login/logout/recovery | Actual Auth session/browser flows | Code and focused tests passed; provider and live login pending |
| Cloud bookmarks/views/corrections | RLS isolation + second session synchronization | Cloud RLS SQL tests passed; actual two-session flow pending |
| Admin collection/health | Authorized owner flow; unauthorized rejection | API tests passed; owner account and live flow pending |
| Free limits | No paid plans/resources; bounded retention/quota configuration | Free cloud resources created; quota/retention tests passed |
| Responsive/accessibility/error states | Desktop/mobile browser checks | 10/10 browser fixture flows passed; live 1440px/390px no horizontal overflow or page exceptions |
| Secrets/private data | Git diff/ignore + client bundle check + RLS | Staged diff and 17 client static files excluded actual server secrets; Vercel secrets hidden; cloud RLS SQL passed |
| CI and recovery workflow | GitHub checks + README + rollback/redeploy steps | [GitHub Actions 36451308821](https://github.com/James0027/trend-atlas/actions/runs/36451308821) passed; auto Git deployment needs Vercel Login Connection |
| Gemini worker | Successful real model response + reviewed task artifact | Prior worker artifact documented; production independence preserved |

## Workflow

The public alias still serves the verified `dpl_F3EPKGzaEJgakyj691GLsUCZXfnZ` deployment. A later CLI deploy of commit `3033972` was blocked by Vercel because that commit's author resolves to a different GitHub account. Repository-local author identity has been corrected to `James0027` for future commits; the existing public deployment was not replaced. Vercel GitHub Login Connection remains necessary for automatic Git deployments.

1. Preserve the previous deployment, clone source, verify tool authorization, create GitHub repository.
2. Migrate framework and database; replace sources that cannot support public presentation.
3. Integrate Auth, cloud collections and owner admin controls; add server collection endpoint and scheduled job.
4. Run focused unit/database/browser checks, build, provision free cloud resources, publish.
5. Verify anonymous access, account isolation/sync, consecutive scheduled runs and deployment logs. Record evidence and remaining limits.

## Worker prompt contract

Every delegated prompt specifies purpose, owned files, input/output types, authorized operations, acceptance checks, and forbidden changes. Workers do not read credentials or change unrelated configuration. Gemini artifacts are reviewed before integration; delegated completion does not prove site completion.

## Rate limits and continuation

Website collection runs on the deployed runtime and is independent of coding model quotas. A coding CLI quota event is recorded with the task, current files and next command. Automatic Codex wakeups can only be claimed after an actual supported automation is configured and verified; waiting in a terminal is not a deployment or persistence strategy.
