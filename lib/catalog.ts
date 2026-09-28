import type { Source } from "./types";
export const TOPICS = [
  {id:"ai",name:"AI",color:"#6554c0"},{id:"automation",name:"自动化",color:"#137d68"},
  {id:"technology",name:"科技",color:"#2563eb"},{id:"finance",name:"金融",color:"#ad7720"},
  {id:"beauty",name:"美妆时尚",color:"#ba4677"},{id:"culture",name:"文娱",color:"#9b58ac"},
  {id:"gaming",name:"游戏",color:"#517b33"},{id:"design",name:"设计",color:"#328f96"},
  {id:"travel",name:"旅行美食",color:"#d47532"},{id:"sports",name:"体育",color:"#477dba"},
  {id:"society",name:"社会",color:"#64748b"},{id:"health",name:"健康",color:"#31936e"},
] as const;
export const REGIONS = [
  {id:"all",name:"全球",short:"ALL"},{id:"CN",name:"中国",short:"CN"},{id:"US",name:"美国",short:"US"},
  {id:"JP",name:"日本",short:"JP"},{id:"KR",name:"韩国",short:"KR"},{id:"EU",name:"欧洲",short:"EU"},
  {id:"IN",name:"印度",short:"IN"},{id:"GLOBAL",name:"国际社区",short:"INT"},
] as const;
const hot = (id:string,name:string,platform:string,color:string,mark:string,homepage:string,topic?:Source["defaultTopic"]):Source => ({id,name,platform,region:"CN",kind:"hot",adapter:"uapi",provider:"UAPI · 第三方聚合",endpoint:`https://uapis.cn/api/v1/misc/hotboard?type=${id}`,homepage,color,mark,defaultTopic:topic,note:"平台公开榜单的第三方快照；源服务可能延迟或中断。"});
const wiki = (language:string,name:string,region:Source["region"]):Source => ({
  id:`wikipedia-${language}`,name:`维基百科 · ${name}阅读榜`,platform:"Wikipedia",region,
  kind:"hot",adapter:"wikimedia",provider:"Wikimedia Analytics 官方 API · CC0",
  endpoint:`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${language}.wikipedia.org/all-access`,
  homepage:`https://${language}.wikipedia.org/`,color:"#53606d",mark:"W",
  note:`${name}维基百科最近可用 UTC 日的阅读次数榜，通常延迟一天；保留官方排名并过滤首页/管理页面。地区仅为语言版面导航，不代表读者、作者或事件所在地。统计数据 CC0，不复制百科正文。`,
});
const research = (id:string,name:string,query:string,topic:Source["defaultTopic"]):Source => ({
  id,name,platform:"arXiv",region:"GLOBAL",kind:"news",adapter:"arxiv",provider:"arXiv 官方 API · CC0 元数据",
  endpoint:`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=30&sortBy=submittedDate&sortOrder=descending`,
  homepage:"https://arxiv.org/",color:"#b31b1b",mark:"arX",defaultTopic:topic,
  note:"最新提交论文，序号是按提交时间排列的位置，不是热度或被引排名。标题、作者和短摘要来自 CC0 描述元数据；论文内容版权由作者/出版者持有。链接前往 arXiv，不提供论文全文。",
});
const youtube = (id:string,name:string,region:Source["region"],market:string):Source => ({
  id,name:`YouTube · ${name}热门`,platform:"YouTube",region,kind:"hot",adapter:"youtube",provider:"YouTube Data API v3",
  endpoint:`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=${market}&maxResults=30`,
  color:"#ef3030",mark:"YT",homepage:`https://www.youtube.com/feed/explore?gl=${market}`,
  note:"官方 mostPopular 内容市场榜，现涵盖音乐、电影和游戏热门视频，不是所有类别热榜；地区代表内容市场，欧洲采用英国市场。服务器需配置 YOUTUBE_API_KEY，缺失时仅提供入口；每次请求消耗 1 个配额单位。",
});
const sixty=(s:Source,route:string):Source=>({...s,adapter:"sixty",endpoint:`https://60s.zellon.top/v2/${route}`,provider:"60s 社区实例 / UAPI 备用",note:"第三方平台榜单快照，保留原平台链接。社区接口不保证持续可用；失败时使用受配额限制的备用源。"});
export const SOURCES:Source[] = [
  sixty(hot("zhihu","知乎热榜","知乎","#1772f6","知","https://www.zhihu.com/hot"),"zhihu"),
  sixty(hot("weibo","微博热搜","微博","#e84e49","微","https://s.weibo.com/top/summary"),"weibo"),
  sixty(hot("douyin","抖音热点","抖音","#171717","抖","https://www.douyin.com/hot"),"douyin"),
  sixty(hot("xiaohongshu","小红书热点","小红书","#ee3653","红","https://www.xiaohongshu.com/explore"),"rednote"),
  hot("bilibili","哔哩哔哩热门","哔哩哔哩","#ed75a5","哔","https://www.bilibili.com/v/popular/rank/all"),
  sixty(hot("baidu","百度热搜","百度","#3468ed","百","https://top.baidu.com/board?tab=realtime"),"baidu/hot"),
  hot("toutiao","头条热榜","今日头条","#e94d43","头","https://www.toutiao.com/"),
  hot("ithome","IT之家","IT之家","#d9393f","IT","https://www.ithome.com/","technology"),
  {...hot("36kr","36氪快讯","36氪","#3668c6","氪","https://36kr.com/","finance"),kind:"news",note:"第三方聚合的资讯/快讯顺序，序号不是平台热搜名次；保留原发布链接。空热度不补数值。"},
  hot("juejin","掘金热榜","掘金","#227cf0","掘","https://juejin.cn/","technology"),
  {id:"hackernews",name:"Hacker News",platform:"Hacker News",region:"GLOBAL",kind:"community",adapter:"hn",provider:"Hacker News 官方 API",endpoint:"https://hacker-news.firebaseio.com/v0/topstories.json",homepage:"https://news.ycombinator.com/",color:"#ed7626",mark:"Y",defaultTopic:"technology",note:"官方首页榜单；points 是站内投票，不与其他平台播放量比较。"},
  {id:"github",name:"GitHub Trending",platform:"GitHub",region:"GLOBAL",kind:"community",adapter:"newsnow",provider:"NewsNow · 第三方聚合",endpoint:"https://newsnow.busiyi.world/api/s?id=github-trending-today",homepage:"https://github.com/trending",color:"#24292f",mark:"GH",defaultTopic:"technology",note:"每日热门仓库快照；星标与其他平台指标不可直接比较。"},
  {id:"devto",name:"DEV Community",platform:"DEV",region:"GLOBAL",kind:"community",adapter:"devto",provider:"DEV / Forem 官方 API",endpoint:"https://dev.to/api/articles?top=1&per_page=30",homepage:"https://dev.to/top/week",color:"#222",mark:"DEV",defaultTopic:"technology",note:"最近一天的热门开发文章。"},
  {id:"reddit",name:"Reddit Popular",platform:"Reddit",region:"GLOBAL",kind:"restricted",adapter:"restricted",provider:"需要授权的数据源",homepage:"https://www.reddit.com/r/popular/",color:"#ed5a24",mark:"r",note:"Reddit Data API 需要合规用途申请与 OAuth 授权；当前未接入。匿名 JSON 被拒绝时不绕过限制，前往原站查看。"},
  wiki("en","英语","US"),
  wiki("zh","中文","CN"),
  wiki("ja","日语","JP"),
  wiki("ko","韩语","KR"),
  wiki("fr","法语","EU"),
  wiki("hi","印地语","IN"),
  research("arxiv-ai","AI 最新研究","cat:cs.AI OR cat:cs.LG","ai"),
  research("arxiv-automation","机器人与自动化最新研究","cat:cs.RO OR cat:cs.SY","automation"),
  research("arxiv-finance","金融与经济最新研究","cat:q-fin.* OR cat:econ.*","finance"),
  {id:"crossref-beauty",name:"化妆品最新研究",platform:"Crossref",region:"GLOBAL",kind:"news",adapter:"crossref",provider:"Crossref 官方 API · 开放书目元数据",endpoint:"https://api.crossref.org/journals/2079-9284/works",homepage:"https://www.mdpi.com/journal/cosmetics",color:"#b64c7d",mark:"CR",defaultTopic:"beauty",note:"Cosmetics 期刊近 90 天已发表研究，按出版日期排列，不是美妆消费热榜。仅展示开放书目元数据、期刊/出版者及 DOI 链接，不复制可能受版权保护的摘要或正文。"},
  ...[
    {id:"twitter",name:"X / Twitter",platform:"X / Twitter",region:"GLOBAL" as const,color:"#171717",mark:"𝕏",homepage:"https://x.com/explore",note:"原生趋势需要符合条件的授权接口；当前未接入，前往 X 查看。"},
    {id:"tiktok",name:"TikTok",platform:"TikTok",region:"GLOBAL" as const,color:"#111",mark:"Tk",homepage:"https://www.tiktok.com/explore",note:"原生趋势接口未接入；前往 TikTok 查看。"},
    {id:"instagram",name:"Instagram",platform:"Instagram",region:"GLOBAL" as const,color:"#b64095",mark:"IG",homepage:"https://www.instagram.com/explore/",note:"原生趋势接口未接入；前往 Instagram 查看。"},
  ].map(s=>({...s,kind:"restricted" as const,adapter:"restricted" as const,provider:"需要授权的数据源"})),
  youtube("youtube","美国","US","US"),
  youtube("youtube-jp","日本","JP","JP"),
  youtube("youtube-kr","韩国","KR","KR"),
  youtube("youtube-gb","英国市场","EU","GB"),
  youtube("youtube-in","印度","IN","IN"),
];
export const PLATFORMS = [...new Set(SOURCES.map(s=>s.platform))];
