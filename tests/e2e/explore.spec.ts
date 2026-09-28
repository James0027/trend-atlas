import { expect, test } from "@playwright/test";
import type { Feed, Item } from "../../lib/types";
import { SOURCES } from "../../lib/catalog";
function fixture(): Feed {
  const now = Date.now();
  const items: Item[] = [
    {id:"douyin:test-ai",sourceId:"douyin",platform:"抖音",region:"CN",title:"测试 AI 自动化话题",topics:["ai","automation"],url:"https://www.douyin.com/hot",description:"自动化测试专用来源条目",rank:1,score:100},
    {id:"xiaohongshu:test-beauty",sourceId:"xiaohongshu",platform:"小红书",region:"CN",title:"测试美妆护肤话题",topics:["beauty"],url:"https://www.xiaohongshu.com/explore",description:"自动化测试专用来源条目",rank:2,score:80},
    {id:"hackernews:test-global",sourceId:"hackernews",platform:"Hacker News",region:"GLOBAL",title:"Global robotics research test",topics:["automation","technology"],url:"https://news.ycombinator.com/item?id=1",description:"Browser test fixture only",rank:3,score:70},
  ].map(item => ({...item,fetchedAt:now,firstSeen:now,history:[{at:now-900000,rank:item.rank+1},{at:now,rank:item.rank}],previousRank:item.rank+1,sampleSize:10})) as Item[];
  return { items, sources: SOURCES.map(source => ({id:source.id,state:items.some(item=>item.sourceId===source.id)?"ok":"restricted",count:items.filter(item=>item.sourceId===source.id).length,fetchedAt:now,checkedAt:now,nextRefreshAt:now+900000,message:"Test fixture only"})),
    generatedAt:now,refreshAfter:60000,storage:"durable",warnings:[] };
}
test.beforeEach(async ({page})=>{
  await page.route("**/api/feed",route=>route.fulfill({json:fixture()}));
});
test("combined region/topic/platform URL filters and reset",async({page})=>{
  await page.goto("/?region=CN&topics=ai&platforms=%E6%8A%96%E9%9F%B3");
  await expect(page.locator(".trend-item")).toHaveCount(1);
  await expect(page.locator(".trend-item")).toContainText("测试 AI 自动化话题");
  await page.getByRole("button",{name:"重置筛选",exact:true}).click();
  await expect(page.locator(".trend-item")).toHaveCount(3);
  await page.getByRole("textbox",{name:"搜索趋势内容"}).fill("robotics");
  await expect(page.locator(".trend-item")).toHaveCount(1);
  await expect(page).toHaveURL(/q=robotics/);
});
test("source detail, bookmark persistence, and privacy explanation",async({page})=>{
  await page.goto("/");
  await page.locator(".item-title").first().click();
  await expect(page.getByRole("heading",{name:"榜单记录",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"阅读原文"})).toHaveAttribute("href",/^https:/);
  await page.locator(".detail-actions").getByRole("button",{name:"收藏",exact:true}).click();
  await expect(page.locator(".detail-actions").getByRole("button",{name:"已收藏",exact:true})).toBeVisible();
  await page.reload();
  await expect(page.locator(".bookmark-button.is-saved")).toHaveCount(1);
  await page.getByRole("button",{name:"数据与隐私",exact:true}).click();
  await expect(page.getByText("本网站公开提供个人非商业阅读。",{exact:false})).toBeVisible();
});
test("saved views restore filters after reload",async({page})=>{
  await page.goto("/?topics=beauty");
  await expect(page.locator(".trend-item")).toHaveCount(1);
  if(test.info().project.name==="mobile") {
    await page.getByRole("button",{name:"Toggle Sidebar",exact:true}).click();
    await page.getByRole("button",{name:"保存当前视图",exact:true}).click();
  } else await page.getByRole("button",{name:"保存视图",exact:true}).first().click();
  await page.getByLabel("视图名称").fill("美妆测试视图");
  await page.getByRole("dialog").getByRole("button",{name:"保存视图",exact:true}).click();
  await page.reload();
  if(test.info().project.name==="mobile") await page.getByRole("button",{name:"Toggle Sidebar",exact:true}).click();
  await expect(page.getByRole("button",{name:"美妆测试视图",exact:true})).toBeVisible();
});
test("refresh failure retains loaded content and permits retry",async({page})=>{
  await page.goto("/");
  await expect(page.locator(".trend-item")).toHaveCount(3);
  await page.unroute("**/api/feed");
  await page.route("**/api/feed",route=>route.fulfill({status:503,json:{error:"test outage"}}));
  await page.getByRole("button",{name:"刷新内容",exact:true}).click();
  await expect(page.locator(".notice.error")).toContainText("保留上次获取的内容");
  await expect(page.locator(".trend-item")).toHaveCount(3);
});
test("layout fits viewport and has no hydration or runtime exceptions",async({page})=>{
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".trend-item")).toHaveCount(3);
  expect(errors).toEqual([]);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
  expect(overflow).toBe(false);
  await page.getByRole("link",{name:"登录或同步账户数据"}).click();
  await expect(page.getByRole("heading",{name:/账号服务正在配置中|登录 Trend Atlas/})).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("link",{name:"登录管理员账号"})).toBeVisible();
});
