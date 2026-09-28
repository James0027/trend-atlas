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
type LocalizedKeywords = { ja: readonly string[]; ko: readonly string[]; fr: readonly string[]; hi: readonly string[] };
// Explicit terms only. This remains keyword classification, without translation
// or inference from names, nationalities, broad stems, or individual syllables.
const localizedKeywords: Record<Topic,LocalizedKeywords> = {
  ai: {
    ja: ["人工知能", "大規模言語モデル", "生成AI", "機械学習", "深層学習"],
    ko: ["인공지능", "대규모 언어 모델", "생성형 AI", "기계 학습", "기계학습", "딥러닝"],
    fr: ["intelligence artificielle", "modèle de langage", "modèles de langage", "apprentissage automatique", "apprentissage profond"],
    hi: ["कृत्रिम बुद्धिमत्ता", "बड़े भाषा मॉडल", "मशीन लर्निंग", "जनरेटिव एआई", "एआई"],
  },
  automation: {
    ja: ["自動化", "ロボット", "ワークフロー", "自動運転"],
    ko: ["자동화", "로봇", "워크플로", "워크플로우", "자율주행"],
    fr: ["automatisation", "robotique", "flux de travail", "conduite autonome"],
    hi: ["स्वचालन", "रोबोटिक्स", "कार्यप्रवाह", "स्वायत्त वाहन"],
  },
  technology: {
    ja: ["ソフトウェア", "プログラミング", "半導体", "データベース", "スマートフォン"],
    ko: ["소프트웨어", "프로그래밍", "반도체", "데이터베이스", "스마트폰"],
    fr: ["logiciel", "logiciels", "programmation", "informatique", "semi-conducteur", "semi-conducteurs", "base de données", "bases de données"],
    hi: ["सॉफ्टवेयर", "प्रोग्रामिंग", "अर्धचालक", "डेटाबेस", "स्मार्टफोन"],
  },
  finance: {
    ja: ["金融", "経済", "株式", "投資", "銀行", "暗号資産", "インフレ"],
    ko: ["금융", "경제", "주식", "투자", "은행", "암호화폐", "인플레이션"],
    fr: ["finance", "économie", "bourse", "banque", "banques", "investissement", "investissements", "cryptomonnaie", "cryptomonnaies", "inflation"],
    hi: ["वित्त", "वित्तीय", "अर्थव्यवस्था", "शेयर बाजार", "निवेश", "बैंक", "क्रिप्टोकरेंसी", "मुद्रास्फीति"],
  },
  beauty: {
    ja: ["美容", "化粧品", "スキンケア", "メイク", "口紅", "香水"],
    ko: ["미용", "화장품", "스킨케어", "메이크업", "립스틱", "향수"],
    fr: ["cosmétique", "cosmétiques", "maquillage", "soins de la peau", "rouge à lèvres", "parfumerie"],
    hi: ["सौंदर्य प्रसाधन", "त्वचा की देखभाल", "मेकअप", "लिपस्टिक", "परफ्यूम"],
  },
  gaming: {
    ja: ["ビデオゲーム", "コンピュータゲーム", "ゲーム機", "任天堂", "プレイステーション", "eスポーツ"],
    ko: ["비디오 게임", "컴퓨터 게임", "게임기", "닌텐도", "플레이스테이션", "이스포츠"],
    fr: ["jeu vidéo", "jeux vidéo", "console de jeux", "consoles de jeux", "esport"],
    hi: ["वीडियो गेम", "कंप्यूटर गेम", "गेम कंसोल", "ईस्पोर्ट्स"],
  },
  design: {
    ja: ["グラフィックデザイン", "建築", "タイポグラフィ", "イラスト"],
    ko: ["그래픽 디자인", "건축", "타이포그래피", "일러스트"],
    fr: ["design graphique", "architecture", "typographie", "illustration", "illustrations"],
    hi: ["ग्राफिक डिजाइन", "वास्तुकला", "टाइपोग्राफी", "चित्रांकन"],
  },
  travel: {
    ja: ["旅行", "観光", "航空便", "ホテル", "レストラン", "料理"],
    ko: ["여행", "관광", "항공편", "호텔", "레스토랑", "요리"],
    fr: ["voyage", "voyages", "tourisme", "vol aérien", "vols aériens", "hôtel", "hôtels", "restaurant", "restaurants", "recette de cuisine", "recettes de cuisine"],
    hi: ["यात्रा", "पर्यटन", "उड़ान", "होटल", "रेस्तरां", "खाना पकाना"],
  },
  sports: {
    ja: ["スポーツ", "サッカー", "バスケットボール", "テニス", "オリンピック", "野球"],
    ko: ["스포츠", "축구", "농구", "테니스", "올림픽", "야구"],
    fr: ["sport", "sports", "football", "basket-ball", "tennis", "jeux olympiques", "baseball"],
    hi: ["खेलकूद", "फुटबॉल", "बास्केटबॉल", "टेनिस", "ओलंपिक", "क्रिकेट"],
  },
  health: {
    ja: ["健康", "医療", "病院", "癌", "ワクチン", "フィットネス"],
    ko: ["건강", "의료", "병원", "암 치료", "백신", "피트니스"],
    fr: ["santé", "médecine", "hôpital", "hôpitaux", "cancer", "vaccination"],
    hi: ["स्वास्थ्य", "चिकित्सा", "अस्पताल", "कैंसर", "टीकाकरण", "फिटनेस"],
  },
  culture: {
    ja: ["映画", "音楽", "コンサート", "俳優", "女優", "アニメ", "漫画", "文学"],
    ko: ["영화", "음악", "콘서트", "배우", "드라마", "애니메이션", "만화", "문학"],
    fr: ["cinéma", "musique", "concert", "concerts", "acteur", "actrice", "acteurs", "actrices", "littérature", "bande dessinée", "bandes dessinées"],
    hi: ["सिनेमा", "फिल्म", "संगीत", "संगीत समारोह", "अभिनेता", "अभिनेत्री", "साहित्य", "कॉमिक्स"],
  },
  society: {
    ja: ["社会問題", "社会保障", "選挙", "人口問題", "自然災害"],
    ko: ["사회 문제", "사회 보장", "선거", "인구 문제", "자연재해"],
    fr: ["élection", "élections", "protection sociale", "questions sociales", "catastrophe naturelle", "catastrophes naturelles", "recensement"],
    hi: ["सामाजिक समस्या", "सामाजिक सुरक्षा", "चुनाव", "जनगणना", "प्राकृतिक आपदा"],
  },
};
function keywordPattern(terms:readonly string[]):string {
  return terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/ +/g,"\\s+")).join("|");
}
const localizedPatterns = new Map<Topic,RegExp>(Object.entries(localizedKeywords).map(([topic,terms])=>[
  topic as Topic,
  // Japanese compounds have no whitespace separators. For the other languages,
  // include combining marks in the boundary so a partial Devanagari syllable
  // or a Korean verb stem cannot become a topic keyword.
  new RegExp(`(?:${keywordPattern(terms.ja)})|(?:^|[^\\p{L}\\p{M}\\p{N}_])(?:${keywordPattern([...terms.ko,...terms.fr,...terms.hi])})(?=$|[^\\p{L}\\p{M}\\p{N}_])`,"iu"),
]));
export function classify(title:string,description:string,fallback?:Topic):Topic[] {
  const text = (title+" "+description).normalize("NFC");
  const tags=rules.filter(([id,r])=>r.test(text)||localizedPatterns.get(id)?.test(text)).map(([id])=>id);
  if(localizedPatterns.get("society")?.test(text))tags.push("society");
  if(fallback && (!tags.includes(fallback)||tags.indexOf(fallback)>=4)) return [...tags.filter(tag=>tag!==fallback).slice(0,3),fallback];
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
