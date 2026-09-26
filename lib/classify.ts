import type { Topic } from "./types";
const rules: [Topic,RegExp][] = [
  ["ai",/\b(ai|llm|gpt|claude|gemini|chatgpt|deepseek|qwen|openai|anthropic|copilot|machine learning|artificial intelligence)\b|人工智能|大模型|智能体|生成式|深度学习/i],
  ["automation",/automat|robot|workflow|\bagent[s]?\b|n8n|zapier|rpa|自动化|机器人|工作流|智能体|无人驾驶/i],
  ["technology",/software|programming|developer|github|\bcode\b|chip|iphone|android|apple|linux|database|科技|芯片|编程|软件|手机|华为|小米|计算|开源/i],
  ["finance",/financ|econom|stock|market|bank|crypto|bitcoin|invest|inflation|trade|fed\b|金融|股票|经济|银行|基金|投资|利率|黄金|股市|财报|消费|房价|证券/i],
  ["beauty",/beauty|makeup|skincare|cosmetic|fashion|lipstick|perfume|美妆|护肤|彩妆|口红|穿搭|时尚|防晒|精华|发型|美容|香水/i],
  ["gaming",/\bgame[s]?\b|gaming|steam|playstation|nintendo|xbox|minecraft|游戏|电竞|原神|王者荣耀|黑神话/i],
  ["design",/\bdesign\b|figma|typography|branding|illustrat|architecture|设计|建筑|字体|插画|审美|视觉/i],
  ["travel",/travel|tourism|flight|food|recipe|restaurant|cooking|旅行|旅游|美食|餐厅|酒店|航班|景区|做饭|国庆/i],
  ["sports",/sport|football|soccer|basketball|tennis|olympic|nba|体育|足球|篮球|网球|奥运|夺冠|联赛/i],
  ["health",/health|medical|cancer|hospital|disease|fitness|diet|健康|医院|癌症|疾病|医疗|健身|养生|减肥|疫苗/i],
  ["culture",/movie|film|music|concert|celebrity|netflix|album|电影|音乐|演唱会|明星|电视剧|综艺|演员|歌手|动画/i],
];
export function classify(title:string,description:string,fallback?:Topic):Topic[] {
  const text = title+" "+description;
  const tags=rules.filter(([,r])=>r.test(text)).map(([id])=>id);
  if(fallback && !tags.includes(fallback)) tags.push(fallback);
  return tags.length?tags.slice(0,4):["society"];
}
export function safeUrl(value:unknown,base?:string):string | null {
  if(typeof value!=="string" || value.length>6000) return null;
  try { const u=new URL(value,base); return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null; } catch { return null; }
}
export function textOnly(value:unknown):string {
  if(typeof value!=="string") return "";
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)>0&&Number(n)<1114112?Number(n):32)).replace(/\s+/g," ").trim();
}
export function validTime(value:unknown):number | undefined {
  const n=typeof value==="number"?(value<1e12?value*1000:value):typeof value==="string"?Date.parse(value):NaN;
  return Number.isFinite(n)&&n>946684800000&&n<=Date.now()+300000?n:undefined;
}
export function scoreRank(rank:number,total:number):number { return total>1?Math.round(100*(total-rank)/(total-1)):0; }
