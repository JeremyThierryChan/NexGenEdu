import { RequireAuth } from "@/components/admin/RequireAuth";
import { ScrollMemory } from "@/components/admin/ScrollMemory";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { RoleGuard } from "@/components/admin/RoleGuard";
import { ScopeNotice } from "@/components/admin/ScopeNotice";

/**
 * 已登录后台的外壳：顶栏 + 侧边导航 + 内容区。
 *
 * 设计说明：
 * - 与宣传网站共用品牌色与字体，但信息密度更高（紧凑 padding、小字号）；
 * - 整棵子树被 RequireAuth 包住：未登录时不渲染后台界面，只显示占位并跳登录页；
 * - `(dashboard)` 是路由分组，不进入 URL：本文件对应 /admin，
 *   子页面就是 /admin/students、/admin/lessons 等；
 * - `ScopeNotice`（Phase B）只在**行级范围不正常**时出现一条横条（普通教师账号
 *   没填 / 填错 teacherId）：那种账号登录后什么都看不到，没有这句话就只能看到
 *   一片空白，而原因在账号表里（`server/data/accounts.json`）；
 * - `ScrollMemory` 不渲染任何东西，只做一件事：**整页重载之后把滚动位置放回去**。
 *   为什么需要它：要把滚动位置夹到 **0**，文档必须塌到不足一屏 —— 而整页重载时这个外壳
 *   先渲染"正在检查登录状态…"（`min-h-dvh`，正好一屏高），位置在那一刻被夹成 0，
 *   内容长回来也不会自己回去（使用手册 §15.3 原因五）。见那个组件的说明。
 */
export default function AdminDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <RequireAuth>
      <div className="flex min-h-dvh flex-col bg-ink-50">
        {/*
          挂在**确认登录之后**的这一层：要等真实内容渲染出来才谈得上"放回原位"
          （挂在守卫的占位屏那一层时文档只有一屏高，放回去也会立刻被夹住）。
        */}
        <ScrollMemory />
        <AdminTopBar />
        <ScopeNotice />
        <div className="flex flex-1 max-lg:flex-col">
          <AdminSidebar />
          <main className="min-w-0 flex-1 p-4 sm:p-6">
            {/* 直接敲网址进来时给一句人话（导航里已经按角色藏掉了入口） */}
            <RoleGuard>{children}</RoleGuard>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
