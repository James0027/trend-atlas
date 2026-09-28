# Trend Atlas · 全球趋势雷达

正式网站：[trend-atlas-eta.vercel.app](https://trend-atlas-eta.vercel.app)。

公开的个人非商业趋势网站，支持地区、12 个方向、平台组合筛选、搜索、排序、列表/卡片、来源详情、原始排名与历史、收藏、保存视图、分类修正和 CSV 导出。访客数据保存在浏览器；登录后可同步到本人云端账户，访客内容由用户主动导入。

当前生产项目位于 `D:\个人项目\trend-atlas`，源码仓库为 [James0027/trend-atlas](https://github.com/James0027/trend-atlas)（私有仓库，网站已公开）。使用标准 Next.js 16 App Router、React 19、TypeScript、Tailwind/shadcn/Radix、Supabase PostgreSQL/Auth/Cron 和 Vercel。原 C 盘旧项目保留。

**云端状态：正式网站已公开上线，生产库、真实数据、CI 和匿名浏览器访问已验证。OAuth 登录及无人访问时的独立 Cron 仍待配置和实际验收。** 验收记录见 [PRODUCTION_PLAN.md](PRODUCTION_PLAN.md)。

## 安装与检查

使用 Node.js 24；仓库和 Vercel 均锁定 `24.x`。npm 使用兼容 Node 的随附版本，先升级 Node 再考虑升级 npm。

```powershell
Set-Location -LiteralPath 'D:\个人项目\trend-atlas'
node --version
npm ci
if (-not (Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
```

按下表配置本机 `.env.local` 或 Vercel 环境变量，不提交密钥。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发服务器，默认 http://127.0.0.1:3000 |
| `npm run typecheck` / `npm run lint` | 类型检查及配置范围内的 ESLint |
| `npm test` | Vitest 行为回归 |
| `npm run test:db` | PGlite 隔离数据库执行真实迁移，验证权限、锁、预算与版本比较的 SQL 行为，不连接云端 |
| `npm run test:schedule` | PGlite 执行调度安装逻辑；Cron/HTTP/Vault 扩展使用明确的模拟接口，不能证明真实定时运行 |
| `npm run build` | Next.js 生产构建 |
| `npx playwright install chromium` | 首次安装浏览器测试依赖 |
| `npm run test:e2e` | 构建后运行桌面/手机测试，测试服务端口 4178 |
| `npm run start` | 启动已经构建的生产服务 |
| `npm run collect` | 用已配置的云端服务执行一轮真实采集 |
| `npm run collect -- --seed` | 最多 12 轮建立全部来源状态；写入真实云数据库，需要先应用迁移 |

`--seed` 不生成演示热点；受限、失败来源也会有状态行，所有状态行存在不代表所有来源采集成功。PGlite 回归为单连接 SQL 行为验证，云端多连接竞争仍须单独验收。浏览器回归使用测试夹具，不能替代真实 Auth、源接口与 Cron 验收。GitHub Actions 在 main 推送及 PR 上执行类型、单元、数据库、构建和浏览器检查。

## 环境变量

以 [.env.example](.env.example) 为准，只有 `NEXT_PUBLIC_*` 可进入浏览器。生产与 Preview 分开配置；测试 Preview 不应向正式数据库运行采集。

| 变量 | 配置 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 必需：Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 必需：公开 anon key，权限由 RLS 控制 |
| `SUPABASE_SERVICE_ROLE_KEY` | 必需：仅服务端，用于采集及系统数据；绝不放入公开变量 |
| `CRON_SECRET` | 必需：32–512 字符随机值，调度端与网站保持一致 |
| `NEXT_PUBLIC_AUTH_GITHUB_ENABLED` | GitHub provider 配置及真实登录测试后才设为 `true` |
| `NEXT_PUBLIC_AUTH_EMAIL_ENABLED` | 无可用公开 SMTP 时设为 `false`；邮件注册/恢复验收后才开放 |
| `DATABASE_URL` | 可选：Drizzle 维护用 PostgreSQL 连接；网站运行通过 Supabase REST |
| `YOUTUBE_API_KEY` | 可选：服务器端官方 YouTube 热门接口；缺失时显示未接入 |
| `UAPI_KEY` | 可选：国内第三方聚合认证额度；未配置时保留匿名调用保护 |

公开变量及 Auth 开关在构建时注入，修改后重新部署。GitHub OAuth Client Secret、SMTP 凭据放在 Supabase 控制台，不需要新增网站公开变量。

## Supabase 配置

1. 创建 Free 项目。在空数据库应用 [生产迁移](supabase/migrations/202609270001_production.sql) 一次；可用 SQL Editor，或已授权的 Supabase 迁移工具。不要对已有生产库重复执行整份建表 SQL。
2. Auth 的 Site URL 使用正式 HTTPS origin；允许正式站的 `/account`、`/account?mode=recovery` 和 `/auth/callback`。开发时另列对应 `http://127.0.0.1:3000` 地址。见 [重定向配置](https://supabase.com/docs/guides/auth/redirect-urls)。
3. 免费公开登录可配置 [GitHub OAuth](https://supabase.com/docs/guides/auth/social-login/auth-github)：GitHub OAuth App 的回调地址使用 Supabase provider 显示的 `https://<project-ref>.supabase.co/auth/v1/callback`，客户端凭据仅填入 Supabase；网站登录后的目标为 `/auth/callback`。
4. 邮箱注册、确认及恢复需要自有 SMTP。Supabase 默认邮件服务只发给项目团队成员，当前限制 2 封/小时，不能承担公开注册；没有可用 SMTP 时关闭邮件入口，并验证 GitHub 登录。见 [官方 SMTP 限制](https://supabase.com/docs/guides/auth/auth-smtp)。
5. 账户登录后，由可信数据库管理员把已确认的 `auth.users.id` 加入管理员白名单。示例邮箱是占位符，先确认选中的用户：

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'owner@example.com'
on conflict (user_id) do nothing;
```

迁移为所有表启用 RLS：公众仅能读取校验通过的来源快照，账户只能读取本人收藏；收藏写入走带版本比较的 `save_library` RPC。管理员权限来自 `admin_users`，不依据可修改的用户资料授予。采集锁、预算、运行记录及系统写入仅服务端使用。

后续修改新增迁移并检查，保留已应用历史；`npm run db:generate` 只生成迁移，不会自动改变云数据库。

## Vercel 与独立刷新

1. 现有 Vercel Hobby 项目 `trend-atlas` 已通过 CLI 部署，框架为 Next.js、Node 24。要让 `main` 推送自动发布，先在 Vercel 账号 Authentication 连接拥有仓库的 GitHub 账号 `James0027`，再运行 `vercel git connect --yes`；连接完成前，GitHub CI 通过不代表新提交已上线。
2. 部署达到 Ready 并取得 URL 后，用未登录窗口验证首页、`/api/feed`、手机布局与失败提示；配置 Auth redirects，完成实际账户流程、两账户隔离、云端同步与管理员拒绝测试。
3. 迁移完成后运行 `npm run collect -- --seed`，或让已授权的管理员逐轮采集；检查来源状态与真实数据，不能靠首页外观判断采集成功。
4. 最后安装独立调度：[supabase/schedule.sql](supabase/schedule.sql)。脚本已准备，**目前尚未在云端安装/验证**。启用 `pg_cron`、`pg_net`、`supabase_vault`，在 Vault 控制台保存 `trend_atlas_site_url`（正式 HTTPS origin）与 `trend_atlas_cron_secret`（同一 CRON_SECRET），由 postgres 运行安装脚本。每 5 分钟向 `/api/cron` 发认证请求，不在 Git/SQL 历史写明文密钥。
5. 验证至少两次定时运行：Cron 成功仅说明请求入队，还须检查 HTTP 状态、`collection_runs` 和到期来源的快照时间。不打开页面时也应继续运行。

免费 Vercel Cron 仅支持每日一次，因此五分钟调度使用 Supabase Cron。浏览器自动检查和“刷新内容”只读取共享快照，不直接访问上游；管理员采集为独立受限操作。见 [Vercel Cron 额度](https://vercel.com/docs/cron-jobs/usage-and-pricing)、[Supabase Cron](https://supabase.com/docs/guides/cron)。

## 来源与范围

当前目录有 **32 个来源配置**，不是 32 个保证可用的热榜，更不代表覆盖所有平台的全部内容：

| 组别 | 范围与限制 |
| --- | --- |
| 国内 10 个平台 | 小红书、抖音、知乎、微博、百度、B站、头条、IT之家、36氪、掘金；60s/UAPI 第三方聚合，保留原平台链接 |
| 国际社区 3 个 | HN、DEV 官方 API；GitHub Trending 为 NewsNow 第三方快照 |
| Wikimedia 6 个 | en/zh/ja/ko/fr/hi 最近可用日的百科阅读榜；地区是语言版面导航，不是读者国籍统计 |
| 研究 4 个 | arXiv AI/自动化/金融最新论文，Crossref Cosmetics 最新出版研究；按日期排列，不称消费热榜 |
| YouTube 5 个 | US/JP/KR/GB/IN 官方 mostPopular，现覆盖音乐/电影/游戏；英国市场归欧洲导航；需要 API key |
| 授权受限 4 个 | X、TikTok、Instagram、Reddit：明确未接入，提供原站入口 |

Google News 私人阅读器来源已移除。官方开放数据保留排名、指标、署名和许可说明；只展示标题、链接及允许的短描述，不复制全文。第三方代码许可不等于原平台内容授权，商业化或收到停用要求时须重新核查。现场成功请求不保证长期可用，超时、旧缓存、受限和配额状态如实展示。核查与证据见 [SOURCE_RESEARCH.md](SOURCE_RESEARCH.md)。

排名只表示各来源样本中的位置；各平台原始指标不能相加成为“全网热度”。分类支持中、英、日、韩、法、印地语关键词，可个人修正；同标题合并保留原记录，不宣称识别所有相同事件。

来源刷新周期：Wikimedia/arXiv 24 小时，Crossref 12 小时，YouTube 1 小时，其他通常 15 分钟；匿名 UAPI 及其备用渠道 6 小时，应用侧每日 40/月 1200 次持久预算。失败退避并尊重 Retry-After。名次历史 24 小时，最多保留 72 小时快照，过期内容移出展示；运行记录最多 7 天/2000 行。

## 免费运行与维护

[Vercel Hobby](https://vercel.com/docs/plans/hobby) 限个人非商业使用；[Supabase Free](https://supabase.com/pricing) 当前数据库 500MB、闲置一周可能暂停。使用默认域名，不启用付费资源。免费额度不是无限服务承诺，应监控数据库、流量、函数和上游额度；达到限制时降低采集频率或暂停调度，不能自动升级付费。

部署、故障恢复、回滚和额度中断续作见 [WORKFLOW.md](WORKFLOW.md)；已验证的 Gemini 外部 worker 调用与审查流程见 [docs/GEMINI_WORKFLOW.md](docs/GEMINI_WORKFLOW.md)。网站运行不依赖编程代理的会话额度。
