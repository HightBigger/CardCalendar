import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "卡片档案 | Cardfolio",
  description: "信用卡信息、年费与重要事项管理",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
