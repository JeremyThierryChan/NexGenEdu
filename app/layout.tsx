import type { Metadata } from "next";
import "./globals.css";

/**
 * 站点级 metadata。
 * TODO(Phase 2): 改为从 data/site/settings.md 读取，当前为占位常量。
 */
export const metadata: Metadata = {
  title: {
    default: "NexGenEdu 新径教育",
    template: "%s | NexGenEdu 新径教育",
  },
  description:
    "NexGenEdu 新径教育 —— 小班教学 · 个性化辅导 · 持续反馈。提供初高中学科辅导与升学规划。",
};

/**
 * 根布局：只负责 html/body 与全局样式。
 * 宣传网站与后台各自有独立布局，见 app/(site)/layout.tsx 与 app/admin/layout.tsx。
 *
 * 字体说明：使用系统字体栈（见 globals.css 的 --font-sans）。
 * 不引入 next/font/google，避免构建期依赖外部字体 CDN；中文字体文件体积过大，
 * 也不适合自托管。系统栈在 macOS / Windows / 移动端均有良好中文字形。
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-white text-ink-800 antialiased">
        {children}
      </body>
    </html>
  );
}
