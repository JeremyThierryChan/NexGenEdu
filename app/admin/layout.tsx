import type { Metadata } from "next";
import Link from "next/link";
import { AdminSidebar } from "@/components/layout/AdminSidebar";

/**
 * 教务后台布局：顶部条 + 侧边导航 + 内容区。
 *
 * 设计说明：
 * - 与宣传网站共用品牌色与字体，但信息密度更高（紧凑 padding、小字号）。
 * - 静态导出（GitHub Pages）下后台同样以静态页面呈现，数据来自构建时的数据层，
 *   用户写操作保存在浏览器 localStorage，不跨设备共享（见 PROJECT.md 第 7.1 / 8 节）。
 * - 当前不需要登录，后续接入认证时在此布局统一做入口控制即可，页面无需改动。
 */
export const metadata: Metadata = {
  // Next 的 title 模板必须同时提供 default（只写 template 通不过类型检查），
  // 因此这里把 default 设为后台首页名称。各子页面（Phase 4）自行声明 title，
  // 渲染结果形如「学生 | 教务后台」。
  title: {
    default: "今日概览",
    template: "%s | 教务后台",
  },
  // 后台不应被搜索引擎收录。
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold tracking-tight text-brand-800">
              NexGenEdu
            </span>
            <span className="text-sm text-ink-500">教务后台</span>
          </div>
          <Link
            href="/"
            className="text-sm text-ink-600 transition-colors hover:text-brand-700"
          >
            返回网站
          </Link>
        </div>
        {/*
          全局搜索框（支持学生 / 教师 / 教室）计划在 Phase 5 加入此处，
          属于「10 秒内找到信息」的关键入口。
        */}
      </header>

      <div className="flex flex-1 max-lg:flex-col">
        <AdminSidebar />
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
