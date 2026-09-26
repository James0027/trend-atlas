import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trend Atlas · 全球趋势雷达",
  description: "从地区、方向和平台探索全球热点。公开数据、可追溯来源与持续刷新的趋势工作台。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
