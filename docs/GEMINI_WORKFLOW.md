# Gemini 外部 worker 工作流

本轮已验证 Antigravity CLI `agy 1.2.12` 通过已授权账户调用 `gemini-3.8-flash-high`，以 `--print --output-format json` 返回结果。它是由 Codex 调用的外部代码 worker；Codex 原生 subagent 的模型列表不会因此变成 Gemini。

已验证返回结构包含 `status`、`response`、`usage` 等字段。代码任务的 `response` 是包含 `files`、`notes` 的 JSON 字符串；简单 smoke response 也可能是普通文本，不能无条件二次 JSON 解析。本轮候选文件经过父代理审查和修改后集成，CLI 成功不是正确性证明。

## 任务契约

每次委派先限定：

- 目标、拥有的文件及允许新增的路径；告知其他代理同时开发，不回退他人修改。
- 可以读取的源文件、接口/数据结构、UI 约束和验收标准。
- 输出仅候选代码，格式为 `{"files":[{"path":"相对路径","content":"完整候选文件"}],"notes":["说明"]}`。
- 禁止读取 `.env*` 的真实值、凭据目录、登录配置或私人数据；可读取 `.env.example`。
- 禁止修改任务外文件、安装依赖、执行生成代码、运行真实云端采集、推送、提交、部署或向其他人发消息；需要依赖时只提议。
- 不声称账户、数据库、Cron 或网站上线完成；列出未验证项，由父代理决定下一步。

适合委派边界清楚的组件、解析器、纯函数或流程文档。跨账户权限、数据库迁移及云端授权由父代理控制，候选方案仍可请 worker 只读审查。

## 可复用 PowerShell 调用

在已安装、已完成网页登录的环境执行；不在命令行传 token。下例只要求一个纯函数候选文件，实际任务应替换 ownership 和只读输入。

```powershell
Set-Location -LiteralPath 'D:\个人项目\trend-atlas'
New-Item -ItemType Directory -Path 'work' -Force | Out-Null
agy --version

$taskPrompt = @'
你是此项目的 Gemini 代码 worker。
目标：为文档给出一个纯函数 safeLabel(input: string): string 的候选实现。
只拥有候选路径 lib/safe-label.ts；当前不直接写入项目文件。
你不是唯一开发者，不得回退或修改他人文件。
只读输入：README.md、lib/types.ts；不读取真实 .env、凭据或用户数据。
约束：无依赖、无网络请求、无副作用；清理控制字符并限制为 120 个字符。
不得执行安装、commit、push、部署或真实采集。
只返回合法 JSON，无 Markdown 围栏：
{"files":[{"path":"lib/safe-label.ts","content":"完整候选源码"}],"notes":["验收建议和未验证项"]}
'@

agy --print --output-format json --model gemini-3.8-flash-high --effort high --mode plan --log-file work/gemini-task.log --print-timeout 120s $taskPrompt 1> work/gemini-task-result.json 2> work/gemini-task-stderr.log
if ($LASTEXITCODE -ne 0) {
  throw 'Gemini 调用失败，请检查日志中的状态；不要自动应用候选文件。'
}
```

`--print` 要求 prompt 字符串作为位置参数；单独通过 stdin 管道传入会报错。保持 `$taskPrompt` 为一个参数，不拼接成待 shell 执行的命令字符串。`--project` 指注册项目的 name/ID，不能把文件路径当通用工作目录；工作目录由 `Set-Location` 设置。本例不需要 `--project`。不用跳过全部权限的开关；`work/` 结果保留在被忽略的本机目录，不作为公开日志发布。

## 解析候选，不自动执行

```powershell
$envelope = Get-Content -LiteralPath 'work/gemini-task-result.json' -Raw | ConvertFrom-Json
$envelope | Select-Object status, duration_seconds, num_turns
$candidate = $envelope.response | ConvertFrom-Json
if (-not $candidate.files) {
  throw '缺少候选文件，需检查实际响应格式。'
}
$candidate.files | Select-Object path, @{Name='characters';Expression={$_.content.Length}}
```

先检查外层 `status` 和 CLI exit code；若 `response` 是普通文本、JSON 不完整或字段错误，保留原始结果并重试明确任务。这里只打印候选路径及长度，不把响应内命令当指令执行。

父代理逐项核对文件 allowlist、内容类型与大小；拒绝绝对路径、`..`、凭据路径及超出 ownership 的新增文件。把路径规范化后必须仍在项目根目录内。审查 import、依赖、权限、数据流与冲突，再用可审查 patch 写入允许文件；不要直接循环写出模型给出的任意路径。

## 集成与验收

1. 查看候选和当前 diff，调整以兼容其他代理的编辑；保留已有工作。
2. 运行 `npm run typecheck` 与受影响的 `npm test`；涉及持久化/权限时运行 `npm run test:db`。
3. `npm run build` 后运行 `npm run test:e2e`，检查实际相关页面；新改动导致失败时继续修复。
4. 涉及 Auth、同步或定时采集时，另做真实云端测试；夹具通过不能替代公开登录、RLS 隔离与后台运行证据。
5. 父代理审查最终 diff 和验证结果后提交；发布还须确认部署 Ready、匿名访问与生产配置。

网站框架、源策略和部署步骤见 [README](../README.md) 与 [WORKFLOW](../WORKFLOW.md)。不用为调用 Gemini 给网站增加运行时 LLM API 或付费服务。

## 失败与额度恢复

CLI 非零退出、模型不可用、登录失效或配额错误时，记录任务契约、版本/模型、输出日志位置、已生成候选和下一次命令；不得把空文件或旧候选当新成功结果。日志可能带源文件内容，分享前需检查隐私。

先保存进度，再在账户额度恢复后续作。尚未配置且验证的自动化不承诺无人值守唤醒；不靠一条持续五小时 sleep 来维持任务。部署好的网站由云端 Cron 运行，与 Gemini/Codex 会话额度分离。
