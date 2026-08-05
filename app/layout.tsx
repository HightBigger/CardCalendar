import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "卡年历 | CardCalendar",
  description: "信用卡年费与免年费进度管理",
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
