"use client";

import { useEffect, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { CoursesLedgerPanel } from "@/components/admin/CoursesLedgerPanel";
import { CatalogDimensionsPanel } from "@/components/admin/CatalogDimensionsPanel";
import { OffersMatrixPanel } from "@/components/admin/OffersMatrixPanel";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { ADMIN_COURSE_TABS, canAccess, type AdminCourseTab } from "@/lib/auth/roles";
import { cn } from "@/lib/utils/cn";

/**
 * 课程（一页三个页签）—— 台账 / 课程类型 / 开放矩阵。
 *
 * ## 为什么合成一页（机构要求）
 *
 * 这三块本来就是"课程"这件事的三层，而且在日常使用里**来回跳**：
 *
 *   1. **课程台账**（原「课程库」页）：实际开的课 —— 分区、卡片、网站正文、报价；
 *   2. **课程类型**（原「课程类型」页）：坐标系 —— 学段 × 学科 / 项目 × 内容模块 × 班型；
 *   3. **开放矩阵**（原「开放矩阵」页）：组合 —— 哪些「学科 × 模块 × 班型」真的开。
 *
 * 加一门新课的路径本来是"课程库 →（发现没有这个学科 / 班型）→ 课程类型 →（加完回来）→
 * 再决定这条组合开不开 → 开放矩阵"，三个页面各点一次。合成一页之后是一次点击的事。
 * 导航里因此只剩「课程」一条（机构口径：**网址只留一个**）。
 *
 * ## 三条保存语义**各自独立**（这是这一页最关键的一条）
 *
 * | 页签 | 保存的是什么 | 语义 |
 * | --- | --- | --- |
 * | 课程台账 | 一门课的记录 + 网站正文 + 报价 | **逐条**保存，带乐观锁（两个人同时改同一门课会被拒） |
 * | 课程类型 | 四张维度表 | **整份替换**（"在这一份草稿上改完再交"） |
 * | 开放矩阵 | 稀疏组合表 | **整份替换** |
 *
 * 因此**绝不能**在页面顶部放一个统一的"保存"：那会把"改一门课的名字"变成"提交整份维度表"，
 * 乐观锁与"改了三处只有两处落库"这两个问题都会回来。每个页签顶部保留它自己的保存条。
 *
 * ## 页签的挂载策略：**去过就留着**
 *
 * 切走再切回来时草稿还在（三个面板各自持有草稿，卸载就等于把没保存的改动悄悄丢掉）。
 * 因此第一次进入某个页签才挂载它，之后只用 `hidden` 藏起来 —— 不重复拉数据，
 * 也不会让人"切个页签改动就没了"。
 *
 * ## 权限：路由取并集，页签按原口径把关
 *
 * 三个页面原本的角色并不一样（课程台账给教师只读；课程类型与开放矩阵是技术 / 财务 / 招生）。
 * 机构说"先不管权限"，那就**不放开也不收紧**：路由取并集（四个角色都能进），
 * 每个页签仍然按它原来那一套角色判定（`ADMIN_COURSE_TABS`）——
 * 谁也不会因此多看到一块他本来进不去的功能。
 */
export default function AdminCoursesPage() {
  const roles = rolesOrAll(useAuth());
  const tabs = ADMIN_COURSE_TABS.filter((tab) => canAccess(roles, tab.roles));
  const [tab, setTab] = useState<AdminCourseTab | null>(null);
  /** 已经挂载过的页签（见上面"去过就留着"）。 */
  const [mounted, setMounted] = useState<Set<AdminCourseTab>>(new Set());

  /*
   * 默认页签 = 这个角色能进的第一个。地址里的 `#矩阵` 这类锚点优先（可以直达 / 分享），
   * 但**必须**先确认这个角色进得去 —— 否则一个教师拿到别人发的 `#矩阵` 链接，
   * 会看到一个空壳页签（那比"看不到"更让人困惑）。
   */
  useEffect(() => {
    const raw = window.location.hash.replace("#", "");
    const hit = ADMIN_COURSE_TABS.find((item) => item.key === raw || item.hash === raw);
    const initial = hit !== undefined && tabs.some((item) => item.key === hit.key) ? hit.key : (tabs[0]?.key ?? null);
    setTab(initial);
    if (initial !== null) setMounted(new Set([initial]));
  }, [tabs]);

  useEffect(() => {
    if (tab === null) return;
    setMounted((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
    const hash = ADMIN_COURSE_TABS.find((item) => item.key === tab)?.hash ?? tab;
    // 只改 hash：不触发导航、不重新挂载页面，但刷新与分享都能回到同一个页签
    window.history.replaceState(null, "", `#${hash}`);
  }, [tab]);

  if (tab === null) {
    return (
      <>
        <PageHeading title="课程" description="台账 / 课程类型 / 开放矩阵。" />
        <p className="mt-6 text-sm text-ink-400">
          你的角色（{roles.join(" · ")}）看不了这一页里的任何一块 ——
          课程台账归 技术管理员 / 招生老师 / 普通教师，课程类型与开放矩阵归 技术管理员 / 财务管理员 / 招生老师。
        </p>
      </>
    );
  }

  const active = ADMIN_COURSE_TABS.find((item) => item.key === tab);

  return (
    <>
      <PageHeading title="课程" description={active?.blurb ?? "台账 / 课程类型 / 开放矩阵。"} />

      {/*
        页签：一屏一件事。三块的保存语义不同（见文件头），因此页签不是"随便切的视图"，
        而是"三个各自独立的工作区"—— 页签旁边那句提示就是提醒这一点的。
      */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            title={item.blurb}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              tab === item.key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-ink-200 bg-white text-ink-600 hover:border-ink-300",
            )}
          >
            {item.label}
          </button>
        ))}
        <span className="text-xs text-ink-500">{active?.hint ?? ""}</span>
      </div>

      {/*
        三个面板各自保留自己的保存条与读数据逻辑，这里只负责"显示哪一个"。
        `hidden` 而不是卸载：切回来时草稿还在（见文件头）。
      */}
      <div hidden={tab !== "ledger"}>{mounted.has("ledger") && <CoursesLedgerPanel />}</div>
      <div hidden={tab !== "dimensions"}>{mounted.has("dimensions") && <CatalogDimensionsPanel />}</div>
      <div hidden={tab !== "matrix"}>{mounted.has("matrix") && <OffersMatrixPanel />}</div>
    </>
  );
}
