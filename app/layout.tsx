import type { Metadata } from "next";
import { getSiteBrand } from "@/lib/data/site";
import "./globals.css";

/**
 * 站点级 metadata 从 data/site/content.md 的「页面: 全站」段读取，
 * 因此你修改品牌名 / 描述 / 关键词后无需改代码。
 */
export function generateMetadata(): Metadata {
  const brand = getSiteBrand();
  return {
    title: {
      default: `${brand.homeTitle} | ${brand.titleSuffix}`,
      template: `%s | ${brand.titleSuffix}`,
    },
    description: brand.description,
    keywords: brand.keywords,
  };
}

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
