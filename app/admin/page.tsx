import type { Metadata } from "next";
import { EmptyState } from "@/components/site/EmptyState";
import { PageHeading } from "@/components/ui/PageHeading";
import { ADMIN_NAV } from "@/lib/site/admin-nav";

export const metadata: Metadata = {
  title: "今日概览",
};

/**
 * 后台首页（今日概览）。
 *
 * Phase 4 将在此实现三块核心信息，对应「10 秒内知道今天谁上课、在哪上课、老师是谁、
 * 还剩多少课时」的目标：
 *   1. 今日课程
 *   2. 教室状态（使用中 / 空闲）
 *   3. 学生课时预警
 */
export default function AdminPage() {
  return (
    <>
      <PageHeading
        title="今日概览"
        description="今天有哪些课程、各教室是否空闲、哪些学生课时不足。"
      />
      <EmptyState
        title="数据层尚未接入"
        description="Phase 2 建立 Markdown 数据访问层，Phase 4 在此基础上实现本页的今日课程、教室状态与课时预警。"
      />

      <section className="mt-6">
        <h2 className="text-sm font-medium text-ink-900">计划中的功能</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_NAV.slice(1).map((item) => (
            <li
              key={item.href}
              className="rounded-lg border border-ink-200 bg-white px-4 py-3"
            >
              <p className="text-sm font-medium text-ink-800">{item.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                {item.description}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
