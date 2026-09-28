import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { LibraryProvider } from "@/components/library-provider";

export const metadata: Metadata = {
  title: "Trend Atlas · 全球趋势雷达",
  description: "从地区、方向和平台探索全球热点。公开数据、可追溯来源与持续刷新的趋势工作台。",
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
      <body className="antialiased"><AuthProvider><LibraryProvider>{children}</LibraryProvider></AuthProvider></body>
    </html>
  );
}
