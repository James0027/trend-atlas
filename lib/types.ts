export type Topic = "ai" | "automation" | "technology" | "finance" | "beauty" | "culture" | "gaming" | "design" | "travel" | "sports" | "society" | "health";
export type Region = "CN" | "US" | "JP" | "KR" | "EU" | "IN" | "GLOBAL";
export type Item = {
  id: string; sourceId: string; platform: string; title: string; url: string;
  description: string; region: Region; topics: Topic[]; rank: number;
  metric?: string; publishedAt?: number; fetchedAt: number; firstSeen: number;
  score: number; previousRank?: number; history: {at: number; rank: number}[];
  publisher?: string; stale?:boolean; sampleSize?:number; channel?:string;
};
export type Source = {
  id: string; name: string; platform: string; region: Region; kind: "hot" | "news" | "community" | "restricted";
  provider: string; homepage: string; note: string; defaultTopic?: Topic;
  adapter: "sixty" | "uapi" | "dailyhot" | "newsnow" | "rss" | "hn" | "devto" | "reddit" | "youtube" | "restricted";
  endpoint?: string; color: string; mark: string;
};
export type SourceStatus = {id: string; state: "ok" | "cached" | "error" | "restricted"; count: number; fetchedAt: number | null; upstreamUpdatedAt?: number; channel?:string; checkedAt: number; message: string; nextRefreshAt: number};
export type Feed = {items: Item[]; sources: SourceStatus[]; generatedAt: number; refreshAfter: number; storage: "durable" | "temporary"; warnings: string[]};
export type Filters = {query: string; region: string; topics: string[]; platforms: string[]; sort: "signal" | "latest" | "rising"; time: string; dedupe: boolean};
export type SavedView = {id: string; name: string; filters: Filters};
