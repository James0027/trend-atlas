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
const news = (id:string,name:string,region:Source["region"],hl:string,gl:string,ceid:string,q?:string,topic?:Source["defaultTopic"]):Source => ({id,name,platform:"Google News",region,kind:"news",adapter:"rss",provider:"Google News RSS",endpoint:`https://news.google.com/rss${q?"/search?q="+encodeURIComponent(q+" when:1d")+"&":"?"}hl=${hl}&gl=${gl}&ceid=${ceid}`,homepage:`https://news.google.com/?hl=${hl}&gl=${gl}&ceid=${ceid}`,color:"#4285f4",mark:"G",defaultTopic:topic,note:q?"主题新闻检索；不代表社交平台原生热榜。":"所选新闻版面。地区代表版面市场，不是作者所在地。"});
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
  hot("36kr","36氪","36氪","#3668c6","氪","https://36kr.com/","finance"),
  hot("juejin","掘金热榜","掘金","#227cf0","掘","https://juejin.cn/","technology"),
  {id:"hackernews",name:"Hacker News",platform:"Hacker News",region:"GLOBAL",kind:"community",adapter:"hn",provider:"Hacker News 官方 API",endpoint:"https://hacker-news.firebaseio.com/v0/topstories.json",homepage:"https://news.ycombinator.com/",color:"#ed7626",mark:"Y",defaultTopic:"technology",note:"官方首页榜单；points 是站内投票，不与其他平台播放量比较。"},
  {id:"github",name:"GitHub Trending",platform:"GitHub",region:"GLOBAL",kind:"community",adapter:"newsnow",provider:"NewsNow · 第三方聚合",endpoint:"https://newsnow.busiyi.world/api/s?id=github-trending-today",homepage:"https://github.com/trending",color:"#24292f",mark:"GH",defaultTopic:"technology",note:"每日热门仓库快照；星标与其他平台指标不可直接比较。"},
  {id:"devto",name:"DEV Community",platform:"DEV",region:"GLOBAL",kind:"community",adapter:"devto",provider:"DEV / Forem 官方 API",endpoint:"https://dev.to/api/articles?top=1&per_page=30",homepage:"https://dev.to/top/week",color:"#222",mark:"DEV",defaultTopic:"technology",note:"最近一天的热门开发文章。"},
  {id:"reddit",name:"Reddit Popular",platform:"Reddit",region:"GLOBAL",kind:"community",adapter:"reddit",provider:"Reddit 公开 JSON",endpoint:"https://www.reddit.com/r/popular/hot.json?limit=30&raw_json=1",homepage:"https://www.reddit.com/r/popular/",color:"#ed5a24",mark:"r",note:"公开接口可能受平台网络与访问策略限制。"},
  news("news-us","美国新闻","US","en-US","US","US:en"),
  news("news-jp","日本新闻","JP","ja","JP","JP:ja"),
  news("news-kr","韩国新闻","KR","ko","KR","KR:ko"),
  news("news-eu","欧洲新闻 · 英国版","EU","en-GB","GB","GB:en"),
  news("news-in","印度新闻","IN","en-IN","IN","IN:en"),
  news("news-cn","中国新闻","CN","zh-CN","CN","CN:zh-Hans"),
  news("news-ai","AI 动态","GLOBAL","en-US","US","US:en","artificial intelligence","ai"),
  news("news-automation","自动化动态","GLOBAL","en-US","US","US:en","automation robotics AI agent","automation"),
  news("news-beauty","美妆时尚动态","GLOBAL","en-US","US","US:en","beauty makeup skincare fashion","beauty"),
  news("news-finance","金融市场动态","GLOBAL","en-US","US","US:en","finance stock markets economy","finance"),
  news("news-beauty-cn","国内美妆动态","CN","zh-CN","CN","CN:zh-Hans","美妆 护肤 时尚","beauty"),
  ...[
    {id:"twitter",name:"X / Twitter",platform:"X / Twitter",region:"GLOBAL" as const,color:"#171717",mark:"𝕏",homepage:"https://x.com/explore",note:"原生趋势需要符合条件的授权接口；当前未接入，前往 X 查看。"},
    {id:"tiktok",name:"TikTok",platform:"TikTok",region:"GLOBAL" as const,color:"#111",mark:"Tk",homepage:"https://www.tiktok.com/explore",note:"原生趋势接口未接入；前往 TikTok 查看。"},
    {id:"instagram",name:"Instagram",platform:"Instagram",region:"GLOBAL" as const,color:"#b64095",mark:"IG",homepage:"https://www.instagram.com/explore/",note:"原生趋势接口未接入；前往 Instagram 查看。"},
  ].map(s=>({...s,kind:"restricted" as const,adapter:"restricted" as const,provider:"需要授权的数据源"})),
  {id:"youtube",name:"YouTube · 美国热门",platform:"YouTube",region:"US",kind:"hot",adapter:"youtube",provider:"YouTube Data API v3",color:"#ef3030",mark:"YT",homepage:"https://www.youtube.com/feed/explore",note:"官方热门视频 API。需要在服务器配置 YOUTUBE_API_KEY；未配置时只提供平台入口。"},
];
export const PLATFORMS = [...new Set(SOURCES.map(s=>s.platform))];
