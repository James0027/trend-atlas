import { describe, expect, it } from "vitest";
import { classify } from "../lib/classify";
import type { Topic } from "../lib/types";

type LanguageExamples = { language: string; examples: readonly [Topic,string][] };
const examples: LanguageExamples[] = [
  { language: "Japanese", examples: [
    ["ai", "大規模言語モデル"], ["automation", "自動化"], ["technology", "半導体"],
    ["finance", "株式"], ["beauty", "化粧品"], ["gaming", "ビデオゲーム"],
    ["design", "グラフィックデザイン"], ["travel", "観光"], ["sports", "サッカー"],
    ["health", "医療"], ["culture", "映画"], ["society", "選挙"],
  ] },
  { language: "Korean", examples: [
    ["ai", "인공지능"], ["automation", "자동화"], ["technology", "반도체"],
    ["finance", "주식"], ["beauty", "화장품"], ["gaming", "비디오 게임"],
    ["design", "그래픽 디자인"], ["travel", "관광"], ["sports", "축구"],
    ["health", "백신"], ["culture", "영화"], ["society", "선거"],
  ] },
  { language: "French", examples: [
    ["ai", "intelligence artificielle"], ["automation", "flux de travail"], ["technology", "logiciel"],
    ["finance", "économie"], ["beauty", "maquillage"], ["gaming", "jeu vidéo"],
    ["design", "typographie"], ["travel", "tourisme"], ["sports", "jeux olympiques"],
    ["health", "santé"], ["culture", "cinéma"], ["society", "élection"],
  ] },
  { language: "Hindi", examples: [
    ["ai", "कृत्रिम बुद्धिमत्ता"], ["automation", "स्वचालन"], ["technology", "अर्धचालक"],
    ["finance", "शेयर बाजार"], ["beauty", "सौंदर्य प्रसाधन"], ["gaming", "वीडियो गेम"],
    ["design", "वास्तुकला"], ["travel", "पर्यटन"], ["sports", "क्रिकेट"],
    ["health", "स्वास्थ्य"], ["culture", "सिनेमा"], ["society", "चुनाव"],
  ] },
];

for (const { language, examples: cases } of examples) {
  describe(`${language} keywords`, () => {
    it.each(cases)("classifies explicit %s terms", (topic, title) => {
      expect(classify(title, "")).toContain(topic);
      if(topic==="society")expect(classify(title,"","technology")).toEqual(["society","technology"]);
    });
  });
}

describe("classification boundaries and source defaults", () => {
  it("matches keywords in descriptions, Unicode accents, case, and phrase whitespace", () => {
    expect(classify("Un titre", "INTELLIGENCE ARTIFICIELLE")).toContain("ai");
    expect(classify("e\u0301conomie", "")).toContain("finance");
    expect(classify("", "कृत्रिम   बुद्धिमत्ता")).toContain("ai");
  });
  it("does not infer topics from incomplete foreign words or ambiguous syllables", () => {
    expect(classify("암호화폐", "")).toEqual(["finance"]);
    expect(classify("배우기", "")).toEqual(["society"]);
    expect(classify("बैंकिंग", "")).toEqual(["society"]);
    expect(classify("cosmétiquement", "")).toEqual(["society"]);
    expect(classify("がんばる", "")).toEqual(["society"]);
    expect(classify("ゲーム理論", "")).toEqual(["society"]);
  });
  it("preserves existing Chinese and English matches", () => {
    expect(classify("人工智能工作流", "")).toEqual(["ai", "automation"]);
    expect(classify("AI software for skincare", "")).toEqual(["ai", "technology", "beauty"]);
  });
  it("keeps up to four distinct directions and reserves a slot for the source default", () => {
    const classified = classify("人工知能 自動化 半導体 株式 化粧品 映画", "", "culture");
    expect(classified).toEqual(["ai", "automation", "technology", "culture"]);
    expect(new Set(classified).size).toBe(classified.length);
    expect(classify("人工知能", "", "ai")).toEqual(["ai"]);
    expect(classify("人工知能", "", "beauty")).toEqual(["ai", "beauty"]);
  });
  it("uses society when there is no keyword, and the configured source direction when provided", () => {
    expect(classify("unrelated 12345", "")).toEqual(["society"]);
    expect(classify("", "")).toEqual(["society"]);
    expect(classify("unrelated 12345", "", "beauty")).toEqual(["beauty"]);
  });
});
