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
 *
 * ## 顶栏与侧边导航在滚动时**不动**（"它不该跟着页面跑"就落在这里）
 *
 * 以前整页滚动时侧边导航会跟着滚走：想点「数据与备份」得先滚回页面顶端。
 * 现在顶栏与侧栏都用 `position: sticky`（**不是** fixed）钉在视口上：
 *
 * - **为什么坚持 sticky 而不是 fixed**：fixed 会把元素**移出文档流**，于是文档高度变矮、
 *   内容要另加左边距 —— 而这套界面里有一大批机制依赖"文档高度 / 窗口滚动位置"
 *   （就地动作的滚动守护 `useScrollGuard`、整页重载后的位置还原 `ScrollMemory`、
 *   "点编辑不跳顶部"那一整条链路，见使用手册 §15.3）。sticky 的元素**仍在文档流里**
 *   （高度不变），只是渲染时被钉在视口上 —— 对上面那些机制完全透明。
 * - **顶栏为什么也要钉住**：侧栏的 sticky 偏移正是"顶栏高度"（它得贴在顶栏下面）。
 *   顶栏若滚走，侧栏上方就会空出一条缝、露出后面的内容。两者必须一起钉。
 * - **顶栏高度只有一处定义**：下面那个 CSS 变量。顶栏用它定高、侧栏用它算偏移与最大高度 ——
 *   改高度只改这一处，不会出现"顶栏变高了、侧栏还按老高度贴，于是压住第二行导航"。
 * - **移动端不变**：小屏下导航是顶栏下方的一条横向滚动条（`max-lg:` 那几处），
 *   只占一行、不参与垂直滚动，钉不钉都一样。
 */
export default function AdminDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <RequireAuth>
      <div
        className="flex min-h-dvh flex-col bg-ink-50"
        // 顶栏高度的唯一来源（顶栏与侧栏都引用它，见上面的说明）
        style={{ "--admin-topbar-height": "3.5rem" } as React.CSSProperties}
      >
        {/*
          挂在**确认登录之后**的这一层：要等真实内容渲染出来才谈得上"放回原位"
          （挂在守卫的占位屏那一层时文档只有一屏高，放回去也会立刻被夹住）。
        */}
        <ScrollMemory />
        <AdminTopBar />
        <ScopeNotice />
        <div className="flex flex-1 max-lg:flex-col">
          <AdminSidebar />
          {/*
            分隔线画在**内容区这一侧**，而不是侧栏上：侧栏现在是"内容高度 + sticky"，
            不再被拉伸到整列高 —— 画在它身上的右边框会只画到导航最后一项就断掉。
            main 仍然是拉伸的，因此这条边框是整列高。
          */}
          <main className="min-w-0 flex-1 p-4 sm:p-6 max-lg:border-t lg:border-l lg:border-ink-200">
            {/* 直接敲网址进来时给一句人话（导航里已经按角色藏掉了入口） */}
            <RoleGuard>{children}</RoleGuard>
          </main>
        </div>
      </div>
    </RequireAuth>
  );
}
