# Trend Atlas 公开网站来源核查

## 2026-09-27 公开版决定（以下历史核查不再作为当前接入清单）

旧版私有阅读器的 Google News RSS 许可判断不适用于公开网站。11 个 Google News 来源已从目录删除；BBC/Guardian 也不擅自扩展私人阅读器用途。当前新增下列官方开放数据，原国内平台与受限平台入口保留。

| 来源 | 排序/指标含义 | 公开使用范围 |
| --- | --- | --- |
| Wikimedia Analytics 六种语言版 | 最近可用 UTC 日的百科阅读排名/次数，通常延迟一天 | CC0 统计数据；仅标题/链接/指标，不复制百科正文 |
| arXiv AI、机器人/自动化、金融/经济 | 最新提交论文，按 submittedDate 降序 | CC0 描述元数据、作者和短摘要；不下载或转发论文全文 |
| Crossref Cosmetics 期刊 | 近 90 天论文按出版日期降序 | 开放书目元数据；不请求可能有版权的 abstract 字段 |
| YouTube US/JP/KR/GB/IN | 官方 mostPopular 内容市场榜 | key 配置后可采集；目前涵盖音乐/电影/游戏，不代表所有视频类别 |
| Reddit | 未授权平台入口 | 匿名 JSON 已遭拒绝，改为明确受限，不绕过政策或补假榜单 |

国内 60s/UAPI、GitHub NewsNow 仍是第三方聚合，并非原平台官方授权 API。代码许可不赋予原内容转载权；保留原始平台链接、聚合来源、作者字段，只展示最多 280 字符短描述。收到停用要求或明确使用限制时停用对应来源，商业化须重新核查。

### Wikimedia 官方文档与正常 TLS 请求证据

[Analytics 入门](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/getting-started.html) 以语言项目提供数据。[访问政策](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html) 指定统计数据 CC0、联系信息 User-Agent 和请求串行化。[API 使用指南](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) 要求尊重限流和内容许可。实现 User-Agent 指向运营者 GitHub 公开主页。

接口模板为 `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/<language>.wikipedia.org/all-access/YYYY/MM/DD`。2026-09-27 使用 Node fetch 正常 TLS 信任校验、串行请求 2026-09-26 UTC 日榜：

| 语言版 | 导航分组 | HTTP | 原始榜单条数 | 真实样本 |
| --- | --- | ---: | ---: | --- |
| en | 美国频道英语版面 | 200 | 1000 | Main_Page: views 6869512, rank 1；Special:Search: views 835113, rank 2 |
| zh | 中国频道中文版面 | 200 | 1000 | Wikipedia:首页: views 206375, rank 1；刘欢: views 87707, rank 2 |
| ja | 日本频道日语版面 | 200 | 1000 | メインページ: views 788455, rank 1；玄理: views 112595, rank 2 |
| ko | 韩国频道韩语版面 | 200 | 992 | 위키백과:대문: views 80894, rank 1；문화방송: views 15196, rank 2 |
| fr | 欧洲频道法语版面 | 200 | 1000 | Wikipédia:Accueil_principal: views 486403, rank 1；Léon_XIV: views 177170, rank 2 |
| hi | 印度频道印地语版面 | 200 | 979 | ज्ञानेश_कुमार: views 8144, rank 1；मुखपृष्ठ: views 5457, rank 2 |

语言版读者分布多个国家，这些分组仅便于找相关语言内容，不是国家读者/作者/事件统计。欧洲不覆盖所有当地语言，印度也不覆盖所有当地语言。首页与管理命名空间过滤后，官方 rank 不重排，sampleSize 保留原榜规模，最多存 60 条有效百科条目；空缺名次就是过滤结果。

先请求昨日，仅在官方返回 404 时顺序尝试前两日；三天均无数据就显示来源失败。fetchedAt 是获取时间，upstreamUpdatedAt 是统计日 UTC 结束时间，不冒充文章发布时间。日榜每天采集即可，不应以“上游时间超过 30 分钟”直接认定异常，也不应按网站访问量重复请求官方 API。

### arXiv 官方条款与排序边界

已核实 [API 条款](https://info.arxiv.org/help/api/tou.html) 和 [API 手册](https://info.arxiv.org/help/api/user-manual.html)。允许共享 CC0 描述元数据（含标题、作者、摘要）；全文通常仍受作者/出版者版权约束。全机单连接、每次请求至少间隔 3 秒。适配器有进程内队列，采集层仍须持久化全局锁以覆盖多个实例。手册说明同一查询通常按日更新，推荐每日刷新。

| 频道 | search_query | 首次现场观测 |
| --- | --- | --- |
| AI | `cat:cs.AI OR cat:cs.LG` | 10 秒超时；后续模块复测需单独记录，不能据此宣称稳定 |
| 机器人/自动化 | `cat:cs.RO OR cat:cs.SY` | HTTP 200，30 个 Atom entry |
| 金融/经济 | `cat:q-fin.* OR cat:econ.*` | HTTP 200，30 个 Atom entry |

共同参数 `start=0&max_results=30&sortBy=submittedDate&sortOrder=descending`；列表位置不是热度或被引排名。feed.updated 与单篇 published 分开保存。周末/假期没有新论文不是故障。链接至 arXiv abstract 页面，不服务 PDF。RSS/Atom 改为 fast-xml-parser 校验解析，拒绝 DOCTYPE/ENTITY、限制响应大小，处理命名空间/CDATA/多个 link；文本和 URL 仍进行安全校验。

### Crossref：美妆研究，非消费趋势榜

[REST 文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) 提供无需注册的 API；[许可说明](https://www.crossref.org/documentation/retrieve-metadata/) 区分开放书目事实与可能有版权的摘要；[访问建议](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) 要求缓存和退避。

实际请求 `https://api.crossref.org/journals/2079-9284/works`，近 90 天 from/until-pub-date、`sort=published&order=desc&rows=20&select=DOI,title,published,publisher,container-title`。正常 TLS 校验 HTTP 200，total-results 93，返回 20 条；首两 DOI `10.3390/cosmetics13050258`、`10.3390/cosmetics13050256`，published 2026-09-25。正式实现上限 30 条，不请求 abstract，不调用出版者正文。

候选 International Journal of Cosmetic Science（1468-2494）同样请求 200，总数 27，当前不再增加负载。此前对 Journal of Cosmetic Dermatology（1473-2165）的查询超时，未默认选用。仅年/年月的模糊出版日期不补成精确日期；序号是日期查询的位置。建议 12–24 小时刷新。

### YouTube 新覆盖与免费配额

[videos.list](https://developers.google.com/youtube/v3/docs/videos/list) 每请求 1 unit；[官方修订历史](https://developers.google.com/youtube/v3/revision_history) 说明自 2025-07-21，mostPopular 来自音乐、电影、游戏榜，旧 Trending Now 已弃用。不能用该接口承诺 AI、美妆、财经全类别视频热榜。

新增 US/JP/KR/GB/IN 五个市场，若每小时一次合计约 120 units/天；实际可用额度以 Google Cloud 项目为准。GB 是英国内容市场，非欧洲汇总。当前无 key，未取得授权的视频运行证据；缺 key 不请求，全部明确未授权状态与原站入口。

### 验证范围与最终上线边界

模块验证记录在 `work/public-source-verification.json` 与 `work/public-source-ai-recheck.json`。15 项确定性检查全部通过：RSS/Atom 的实体、CDATA、命名空间与作者；DOCTYPE/ENTITY/畸形 XML 拒绝；危险链接、去重和原排名间隔；短描述长度；移除私人 RSS；日榜 404 回退及 429 不回退；API 错误条目不当作论文；不复制 Crossref 摘要或补精确日期；YouTube 缺密钥；截止前停止新请求、取消在途请求、队列窗口检查和 arXiv 冷却保持在采集锁内；HTTP Retry-After 的秒数/日期/无效值处理。模块 TypeScript 检查与 git diff --check 通过。

真实 collect 的两轮观测累计覆盖六个 Wikipedia 来源各 60 条、arXiv 三频道各 30 条、Crossref 30 条。AI 最初出现连接超时，单独复测成功（首条 `2609.30266v1`，rank 1）；第二轮英语/中文百科一度 6.5 秒超时，其他源成功。失败记录也保留，不能由成功复测宣称持续稳定。官方 Atom RSS 合并分类接口曾返回 200 但零条（当日没有批次内容），未用它伪装“最新 30 篇”的 API 替代。

collect 第七参数接受绝对 deadline；HTTP 请求合并截止 AbortSignal，Wikimedia/arXiv 队列真正开始及日榜回退前检查剩余窗口。arXiv 请求结束后等待 3.1 秒冷却才返回，以便所有采集任务 settled 后再释放全局锁，避免下一实例立即发请求。生产锁 50 秒时，调用者使用 45 秒网络截止、40 秒停止派发，给冷却和持久化留余量。

以上 HTTP 200 只证明现场请求成功，没有长期可用性承诺。生产服务器还需核验源访问、持久化快照、定时采集、配额和退避。公众请求应读取快照，服务端采集才可接触密钥。状态包括成功、旧缓存、超时、授权缺失与额度耗尽，不以演示数据填充。排序代理不叫全网热度，不将各平台播放/投票/阅读量相加。

## 历史核查：旧版私有阅读器（保留证据，接入决策以上述公开版为准）

核查日期：2026-09-27（Asia/Shanghai）；HTTP 响应日期为 2026-09-26 16:11–16:23 UTC 附近。本文是一次现场连通性与文档核查，不代表长期 SLA。没有提交用户凭据、绕过平台登录、解验证码或调用 Sites。

## 可执行结论

1. 国内优先接入 UAPI 的微博、知乎、抖音、小红书、B站、百度、头条、IT之家、36氪、掘金。10 个类型均实测 200，均有真实榜单与原始链接。
2. UAPI 的 GitHub 类型实测 400；GitHub 使用公开 Trending 页面解析，或官方 Repository Search（如果使用后者，产品文案必须是“热门仓库/搜索结果”，不能称作 GitHub Trending）。HN 使用官方 Firebase API。
3. 60s 的官方公共实例列表中 `60s.zellon.top`、`60s.okbaike.com` 等有可用 JSON。可用于备用；主域 `60s.viki.moe` 被 README 明确限定为开发调试，不应作为唯一生产源。
4. YouTube 无 key 请求被 403 拒绝；X 无认证返回 401；Reddit 匿名请求被 403 拒绝。这些平台应显示接入状态/原站入口，不能放造出来的榜单。
5. Google News RSS 可访问，但用途限于个人、非商业的个人阅读器。当前站点若确实只向拥有者开放，作为个人阅读器属于此文字所描述的用途（这是基于条文的解释）；若以后公开分享，应停用采集或另获许可。
6. BBC/Guardian RSS 可承担个人阅读器的国外新闻。GDELT DOC API 文档支持无 key、多主题 OR、最多 250 条；本次请求超时/429，不能声称已跑通。NHK RSS 内容旧至 8 月，不满足实时。

## HTTP 测试方法与证据边界

先用正常 TLS 信任校验测试，Python、PowerShell、Windows curl 对多个互不相关 HTTPS 站点都出现本地信任/凭据问题。随后只对公开只读端点使用隔离的 TLS 诊断请求，从而区分 API 连通性与本地信任问题；原始记录有 `tls_trust_verified:false`。**该诊断设置不得用于网站实现或携带认证的请求**。证书信任必须在真实部署中正常验证。

- 单次网络超时 12 秒；无自动网络重试；并发上限 2–6（UAPI 逐条请求并间隔 0.3 秒）。
- HTTP 状态、耗时、响应头、实际 JSON/ XML 均保存在 `work/probe-*.json`。
- 大部分源只有单次观测；不能由单次 200 推断稳定性。
- NewsNow 的知乎数据通过 web 工具可读；本地同域全部 403 Cloudflare。两种现象都如实保留，不能把 web 的缓存响应当成部署服务器的成功请求。

## UAPI 主源

端点模板：`https://uapis.cn/api/v1/misc/hotboard?type=<type>`。

所有成功响应公共字段：

```text
type: string
update_time: UTC ISO8601 timestamp
list: array
list[].index: number
list[].title: string
list[].url: original platform URL
list[].hot_value: string (may be number-text, localized unit-text, or empty)
list[].extra: object | null
list[].cover: optional string
```

`update_time` 是服务的榜单/快照更新时间，**不是**单条文章发布时间，也不是本站请求时间。显示北京时间应使用时区转换。本站另存 `fetchedAt`。B站可以从 `extra.pubdate` 获得视频发布时间。不得把空热度补成数值，不得跨平台比较原始热度。

| 平台 | type | HTTP | 条数 | 响应时间 ms | 实际 update_time UTC |
|---|---|---:|---:|---:|---|
| 微博 | `weibo` | 200 | 50 | 119 | 2026-09-26T16:14:34.300Z |
| 知乎 | `zhihu` | 200 | 30 | 69 | 2026-09-26T16:05:57.594Z |
| 抖音 | `douyin` | 200 | 50 | 88 | 2026-09-26T15:52:11.537Z |
| 小红书 | `xiaohongshu` | 200 | 20 | 79 | 2026-09-26T16:02:10.709Z |
| 哔哩哔哩 | `bilibili` | 200 | 100 | 98 | 2026-09-26T15:47:29.315Z |
| 百度 | `baidu` | 200 | 51 | 94 | 2026-09-26T15:57:13.992Z |
| 今日头条 | `toutiao` | 200 | 50 | 96 | 2026-09-26T16:05:49.539Z |
| IT之家 | `ithome` | 200 | 12 | 95 | 2026-09-26T15:38:07.471Z |
| 36氪 | `36kr` | 200 | 30 | 98 | 2026-09-26T15:57:42.710Z |
| 稀土掘金 | `juejin` | 200 | 50 | 101 | 2026-09-26T15:58:10.417Z |
| GitHub | `github` | 400 | 0 | 91 | 无 |

前 2 条的完整真实响应字段和值已保存 `work/uapi-samples.json`，各源完整响应保存在 `work/probe-uapi-<type>.json`，供实现者直接核对。

实际差异：

| 平台 | 内容与字段差异 |
|---|---|
| 微博 | `hot_value` 为数字字符串，`extra` 可能空对象 |
| 知乎 | `hot_value` 例 `4238 万热度`；`extra.desc`、`extra.image` 可选，image 可为相对路径 |
| 抖音 | `extra` 含 `sentence_id`、`view_count`、`video_count`；封面有签名与过期参数 |
| 小红书 | 真实返回 20 条；`hot_value` 例 `947.5w`；`extra.type` 为热/新标签，跳转搜索页 |
| B站 | 此类型是 **100 条热门视频**，不是热搜词。`extra.owner/stat/pubdate/pic/bvid` 等可用，缩略图有 http URL |
| 百度 | 返回 51 条且可能含置顶；`extra.is_top` 为置顶标记，榜内 index 不应盲目等同真实热搜排名 |
| 头条 | `hot_value` 可为空，`extra` 空对象 |
| IT之家 | 12 条，热度为空，`extra:null` |
| 36氪 | 30 条快讯/RSS 链接，热度为空，`extra:null`；应称资讯/快讯，不能承诺热搜榜 |
| 掘金 | `hot_value` 例 `热度:630`；`extra.author/hot_score/view/like/comment/collect` |

来源性质：UAPI 是第三方聚合服务；官方 UAPI 文档是该服务的第一手资料，**不代表原平台提供/授权的开放 API**。原平台名称和链接需要保留，页面可加“数据经 UAPI 聚合”链接。

使用边界：主接口文档列出资讯聚合/仪表盘等用例，无需注册/key 的默认榜单可调用；当前访客额度和浏览器策略以 FAQ/响应头为准。未找到永久免费无限访问或 SLA 承诺。

- 访客每出口 IP 共享 1500 积分/月；基础调用通常 1 积分。缓存命中的半价扣费需以 `UAPI-Credits-Charged` 判断。
- 官方显示 4 QPS；实测还返回 `X-Ratelimit-Limit:2000` 和 `ip-daily`、`visitor-rate`、`visitor-quota` 多桶限额。额度不可只看单一旧头。
- FAQ 建议生产环境使用账号/key；服务端认证格式 `Authorization: Bearer <UAPI_KEY>`。不在浏览器暴露 key。
- FAQ 规定跨域浏览器 `/api/v1/*` 无 key 可返回 `403 CORS_FORBIDDEN`。此次带 Origin 的诊断 GET 200 且回显 Origin，不足以推翻该策略；仍以本站后端代理。
- `429` 应按 `Retry-After` 与额度桶退避；无 key 月额耗尽可为 `VISITOR_MONTHLY_QUOTA_EXHAUSTED`。不轮换 IP 规避额度。
- 响应 `Cache-Control:no-store, no-cache, must-revalidate`，但官方公平使用文档鼓励应用缓存；这不是数据新鲜度 TTL。本站应独立设置数据缓存和到期状态。

来源：[UAPI 热榜文档](https://uapis.cn/en/docs/api-reference/get-misc-hotboard)，[UAPI FAQ](https://uapis.cn/docs/api-reference/faq)，[公平使用政策](https://uapis.cn/en/docs/getting-started/fair-use-and-rate-limiting)，[隐私/服务政策](https://uapis.cn/en/docs/getting-started/privacy-policy)。

## 60s 备用源与公共实例

官方 README 的当前链接是小写 `readme.md`；不存在大写 README.md 的 raw 路径。

官方主域测试：

| 路径 | HTTP | 实际条数 | 常用字段 |
|---|---:|---:|---|
| `/v2/weibo` | 200 | 50 | `title, hot_value, link` |
| `/v2/zhihu` | 200 | 30 | `title, detail, hot_value_desc, answer_cnt, link, created_at` |
| `/v2/douyin` | 200 | 49 | `title, hot_value, link, event_time_at, active_time_at` |
| `/v2/baidu/hot` | 200 | 50 | `rank, title, score, score_desc, url` |
| `/v2/rednote` | 200 | 20 | `rank, title, score, word_type, link` |
| `/v2/toutiao` | 200 | 50 | `title, hot_value, link` |
| `/v2/bili` | 500 | 无 | 错误为上游 HTML 不能当 JSON 解析 |

通用响应 `{"code":200,"message":"...开源地址...","data":[...]}`。这些源在响应头中返回 CORS `*`，但多数没有统一的榜单更新时间或 HTTP 缓存 TTL；使用本站 fetchedAt，并明确为获取时间。知乎 `created_at` 是话题创建时间；抖音 event_time 和 active_time 不可都当榜单刷新时间。时间字段秒/毫秒不统一，需要按源解析。

官方公共实例清单（2026-09-20 更新）明示：社区实例没有稳定性保证，请注意版本。只测试清单中未划掉的域名，没有猜域名：

| 公共实例基础 URL | 微博实测 | 其他实测 | CORS/备注 |
|---|---|---|---|
| `https://60s.zellon.top` | 200/50 | 知乎 200/30、抖音 200/49、小红书 200/20、百度 200/50、B站 500 | 已测 JSON 为 `code/message/data`；CORS `*` |
| `https://60s.okbaike.com` | 200/50 | 小红书 200/20 | CORS `*` |
| `https://api.cczo.cc/60s` | 200/50 | 未测其他 | 基础 URL 必须带 `/60s`；使用后端转发 |
| `https://api.elysiayanyu.top` | 200/50 | 未测其他 | 返回旧版本 message 格式；使用后端转发 |
| `https://60s.7se.cn` | 12 秒握手超时 | 未测其他 | 此环境不采用 |

可执行备用 URL 例：`https://60s.zellon.top/v2/rednote`。小红书默认 UAPI `xiaohongshu`，备用 60s `rednote`；字段映射不同。B站 UAPI 的热门视频不可用 60s 热搜词悄悄替代，应保留缓存或展示明确的切换视图。

60s 是 MIT 开源的第三方抓取/整合服务，许可覆盖项目代码，不自动赋予原平台内容的商业转载权。保持原始平台链接和 60s 署名。无需复制项目中的签名/会话字段绕过原平台访问。

来源：[60s 官方 README](https://github.com/vikiboss/60s/blob/main/readme.md)，[官方公共实例清单](https://docs.60s-api.viki.moe/7306811m0)，[模块源码](https://github.com/vikiboss/60s/tree/main/src/modules)。

## NewsNow 与 DailyHot

| 服务/端点 | 实测情况 | 结构/限制 |
|---|---|---|
| `https://newsnow.busiyi.world/api/s?id=zhihu` | web 能读 JSON；本地 403 Cloudflare | `status,id,updatedTime,items,info`；items 中 `id,title,url,extra` |
| 同域 `weibo/douyin/bilibili-hot-search/baidu/github-trending-today/hackernews/toutiao/thepaper/ithome/36kr/tieba/sspai` | 本地全部 403 | 项目源码确有这些源，部署可用性需在网站服务器再验证 |
| 同域 `reddit/youtube/twitter/xiaohongshu/googlenews` | 本地 403，且不在源码清单 | **不能因猜 ID 写成已支持** |
| `https://api-hot.imsyy.top/{zhihu,douyin,weibo,xiaohongshu}` | 最后逐一核查全部 TLS EOF | 此环境无法确认可用；不要作默认依赖。项目官方列表也没有小红书 |
| `https://dailyhot.himiao.org/{zhihu,weibo,all}` | TLS EOF | 不采用 |

NewsNow 主仓库已从 `ourongxing/newsnow` 跳转 `newsnext/newsnow`。README 默认 TTL 30 分钟，源码按源 interval（2/10/30 分钟等）和缓存条件处理；fetch timeout 10s/retry3。**updatedTime 在 interval 命中分支可能是当前服务响应时间，而 items 仍是已有缓存**，不能一概视为源平台最新更新时间。上游失败可回落 cache，消费者要检查 `status`。

实际知乎示例有 `status:success`、`updatedTime:1790402755378`、`extra.info` 的热度文字、原平台 question URL；样本经 web 读取且不等于本地部署成功。`info.LICENCE:MIT`、GitHub 和捐赠信息是服务署名，代码 MIT 不等于所有新闻内容转载许可。

来源：[NewsNow 仓库](https://github.com/newsnext/newsnow)，[源清单](https://github.com/newsnext/newsnow/blob/main/shared/sources.json)，[源 API 处理](https://github.com/newsnext/newsnow/blob/main/server/api/s/index.ts)，[DailyHotApi 仓库](https://github.com/imsyy/DailyHotApi)。

## 国外与官方平台端点

| 平台/端点 | HTTP / 可用性 | 真实结构与限制 |
|---|---|---|
| HN `https://hacker-news.firebaseio.com/v0/topstories.json` | 200；500 IDs | 数字 ID 数组；再取 `/v0/item/<id>.json`。实际 item 有 `by,id,title,url,time,score,descendants,kids,type`。`time` 为秒。CORS 实际允许 Origin，`Cache-Control:no-cache` |
| GitHub `https://github.com/trending?since=daily` | 200 HTML | 官方 Trending 页面，无官方 Trending JSON API，需服务端 DOM 解析，不保证 DOM 永久稳定 |
| GitHub `https://api.github.com/search/repositories?q=topic:artificial-intelligence&sort=stars&order=desc&per_page=3` | 200 JSON/CORS * | `total_count,incomplete_results,items`；item 有 `full_name,html_url,description,stargazers_count,pushed_at,updated_at,language`。按星数搜索 ≠ 当日 Trending |
| Reddit `https://www.reddit.com/r/popular/hot.json?limit=5` | 403 Blocked | 本次未取得合法匿名 JSON，不虚构返回结构；官方 Data API 需要 OAuth/注册与用途许可 |
| YouTube `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=US&maxResults=3` | 403，无 key | 真实 `error.code:403,status:PERMISSION_DENIED`；message 要求注册调用者/key。官方 chart 可按 region，但每请求配额计费 |
| X `https://api.x.com/2/trends/by/woeid/1` | 401 | 真实 `title:Unauthorized,type:about:blank,status:401,detail:Unauthorized`；不具备匿名热榜 |
| B站 `https://s.search.bilibili.com/main/hotword?limit=5` | 200 | `code:0,timestamp,list,top_list,total_count`；`list[].keyword,show_name,heat_score,pos,hot_id`。实际 `score` 可为0，应使用源字段而非填造热度；最大榜单 30 条，响应 `max-age=30`。平台端点非承诺支持的开发者 API，无 CORS |
| B站 `https://api.bilibili.com/x/web-interface/popular?ps=5&pn=1` | 403 | 不绕过反爬；使用 UAPI 服务或明确失败状态 |
| 百度 `https://top.baidu.com/board?tab=realtime` | 200 HTML | 官方公开页面，NewsNow 从 s-data 注释解析；DOM/schema 可变，无 CORS |
| 微博 `https://weibo.com/ajax/side/hotSearch` | 403 | 实际 `{"error":"Forbidden"}`；不绕过登录/验证 |
| 知乎 `https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=5&desktop=true` | 401 | 实际 error.code 101、AuthenticationError、身份未验证 |
| 头条 `https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc` | 403 | 不绕过，使用第三方已公开服务 |

HN 官方文档当前没有请求速率限制；网站仍应缓存，并跳过 deleted/dead/null item，正文/标题 HTML 需要安全处理。GitHub 未认证常规 REST 60 次/小时，Search 有更严格独立桶，读取实际 `x-ratelimit-*`。

来源：[HN 官方 API](https://github.com/HackerNews/API)，[GitHub 速率限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)，[Reddit 开发者访问](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Reddit-Developer-Interfaces)，[YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list)，[X Trends](https://docs.x.com/x-api/trends/trends-by-woeid/introduction)。

## 国外 RSS：个人阅读器与公开分享不同

| 源 | 地址 | 实测 | 时间/条件 |
|---|---|---|---|
| Google News US | `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en` | 200 XML | `channel.lastBuildDate`、item `title/link/guid/pubDate/source`。无 CORS，no-store。版权用途限个人非商业阅读器；当前拥有者私有阅读器可以采用此用途解释，公开共享不可直接沿用 |
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | 200；24 条 | 当前 lastBuildDate 与发布条目接近核查时间。保留 BBC News 文字链接署名、原 feed 标记；不另添 BBC logo。商业用途需要许可 |
| Guardian World | `https://www.theguardian.com/world/rss` | 200；45 条 | 官方帮助支持个人非商业第三方聚合器。前 2 条为 9月24/23 内容，不能假设返回顺序就是发布时间顺序；需检查全部并按 pubDate 排序/过滤 |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 200；25 条 | 条款限制自动分析/抓取，暂不默认启用 |
| NHK News（日本语） | `https://www3.nhk.or.jp/rss/news/cat0.xml` | 200；7 条 | lastBuildDate 2026-08-08；明显过期，排除。这个地址不是 NHK World 英文 feed |

Google News copyright 的关键短句为 “within a personal feed reader for personal, non-commercial use”。完整原始条文在 `work/probe-google-news-us-details.json` 的 XML `channel/copyright`。单纯“私有网站”不自动等于获许可：实际用途也必须是拥有者个人阅读，无商业用途，无公共再分发。Google News 的 US 参数是新闻 edition，单篇 source 是发布方，不能推断事件都发生在美国。

来源：[Google News RSS 本身](https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en)，[BBC feed 指南](https://www.bbc.co.uk/news/10628494)，[BBC 使用条款 RSS 段](https://www.bbc.co.uk/usingthebbc/terms-of-use/#15metadataandrssfeeds)，[Guardian RSS 帮助](https://help.theguardian.com/article/how-do-i-use-the-guardian-s-rss-feeds)，[Al Jazeera 条款](https://www.aljazeera.com/terms-and-conditions)。

## GDELT DOC API

已核实官方文档，不声称本次运行成功：

```text
https://api.gdeltproject.org/api/v2/doc/doc
?query=("artificial intelligence" OR technology OR economy OR sports)
&mode=artlist&format=json&maxrecords=250&timespan=24h&sort=datedesc
```

请求时必须 URL 编码。官方支持最多 250 条、OR 多主题、ArtList JSON、至少15分钟 timespan，CORS `*`。它是媒体文章搜索/报道量，不是所有社交平台的热搜。

- `sourcecountry`/SourceCountry 指**发布媒体所在国家**，不是事件发生国家或读者所在国。Country 过滤文案应明确媒体来源国家。
- 官方条款允许免费学术、商业、政府使用和重发布数据，必须署名并链接 GDELT；不会自动授予新闻正文/图片的转载权。
- 本地 HTTPS 12s 握手超时；HTTP 诊断 429；web 小样本端点也无法获取。没有真实 articles JSON 样例，不能编造。
- 可作为部署后要验证的候选，默认失败显示暂无，不用构造250条“实时新闻”。

来源：[GDELT DOC API 官方文档](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)，[GDELT 使用条款](https://www.gdeltproject.org/about.html#termsofuse)。

## 推荐接入契约

`provider/platform/id/title/url/rank/heatText/publishedAt/sourceUpdatedAt/fetchedAt/status`。热度原始文本保留，不构造跨站“同一个热度单位”。无源更新字段时只显示获取时间；无 publishedAt 不把 fetchedAt 当发布时间。

服务端：可将微博/知乎/抖音/小红书优先走已测60s社区实例，UAPI 主用其他平台并作受控备用；每轮全站最多5次追加请求，已有24小时内成功缓存回落，再返回不可用状态。可按访问懒采集、请求去重、每源5分钟缓存、受控月/日预算；持续对10源每5分钟后台轮询约2880次/天，会超2000日/IP桶，也很快耗1500月积分。缓存过期与失败回落应把状态传到前端。社区 API 无 SLA，不把单次200当稳定承诺。

RSS personal-only 源仅在拥有者私有个人阅读模式启用；如果新增公开分享功能，应另行审核这些源并停用不允许公开分发的源。平台入口与认证必需状态保留，即使没有榜单也不要显示假列表。

原始证据：`work/uapi-samples.json`（指定11类型前2条完整字段）；`work/source-probe-uapi-results.json`（原始响应与headers）；`work/60s-mirror-results.json`；`work/60s-mirror-platform-results.json`；`work/dailyhot-final-results.json`；`work/guardian-rss-sample.json`；`work/rss-samples.json`；全部 `work/probe-*.json`。

## 最后补充：60s 时间字段与 GitHub/Reddit

60s 官方 [router.ts](https://github.com/vikiboss/60s/blob/main/src/router.ts) 和模块树不含 GitHub 端点；镜像 `https://60s.zellon.top/endpoints` 最后实测200，返回75个路由，其中没有任何 github 路由；不用猜 `/v2/github`。Reddit public JSON 在最后复测中仍返回 403 Blocked。

| 60s data[] 源 | 完整实测字段 | 上游时间含义 |
|---|---|---|
| weibo | title, hot_value, link | 无，保留本站 fetchedAt |
| zhihu | title, detail, cover, hot_value_desc, answer_cnt, follower_cnt, comment_cnt, created_at, created, link | created_at=问题创建毫秒时间；created=中国时区显示；都不是榜单更新时间 |
| douyin | title, hot_value, cover, link, event_time, event_time_at, active_time, active_time_at | event_time_at 实测秒；event_time 是事件时间文字。active_time 是无时区上游文字，active_time_at 为运行时 Date 解析的毫秒数，不能盲目信任 |
| rednote | rank, title, score, word_type, work_type_icon, link | 无，保留本站 fetchedAt |
| baidu/hot | rank, title, desc, score, score_desc, cover, type, type_desc, type_icon, url | 无，保留本站 fetchedAt |

实际抖音样例：`event_time_at:1790382206`，`active_time:"2026-09-27 00:21:26"`，`active_time_at:1790468486000`。后者比采集 HTTP 时间偏未来约8小时，[模块源码](https://github.com/vikiboss/60s/blob/main/src/modules/douyin.module.ts) 直接 `new Date(active_time)`，缺乏时区转换约束。优先用本站 fetchedAt；若业务需要解析 active_time，应明确 Asia/Shanghai 并做未来/过期范围校验。不将该字段误报为可靠榜单刷新时间。
