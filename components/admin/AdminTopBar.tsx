"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlobalSearch } from "@/components/admin/GlobalSearch";
import { BackendStatus } from "@/components/admin/BackendStatus";
import { logout } from "@/lib/auth/session";
import { useAuth } from "@/components/admin/AuthContext";

/**
 * 后台顶栏：品牌 + 当前账号 + 退出登录。
 *
 * 「谁改的」不再由这里告诉服务端了（第 6 步）：操作人由服务端的**会话**决定，
 * 每次请求按令牌所属账号设置。早期是前端调 `api.setOperator(name)`，而它是同步方法、
 * 经远端代理会静默变成 Promise —— 操作日志里的操作人一直是默认值，且没人会发现。
 * 现在前端说什么都不作数，这也是"谁改的"应当由服务端说了算的一个例子。
 *
 * ## 它是**钉住的**（页面滚动时不动）
 *
 * 侧边导航的 sticky 偏移就是"顶栏高度"，它得贴在顶栏下面：顶栏若跟着滚走，
 * 侧栏上方就会空出一条缝、露出后面的内容。因此两者一起钉（见 `(dashboard)/layout.tsx`）。
 * 顺带的好处是搜索框与「退出登录」永远在眼前，不必先滚回顶端。
 *
 * 高度用 `--admin-topbar-height`（**唯一一份定义**在 layout 里）：
 * 侧栏的 `top-` 与 `max-h-` 引用的是同一个变量，改高度只改一处。
 */
export function AdminTopBar() {
  const router = useRouter();
  /*
   * 账号与角色来自 `RequireAuth` 问的那一次会话（它已经问过了，这里不再重复请求）。
   * 显示角色是有用的：一个人兼多个角色时，他会想知道"现在按哪个身份在看这个后台"。
   */
  const { username, roles } = useAuth() ?? { username: "", roles: [], scopeWarning: "" };

  function onLogout() {
    void logout().then(() => router.replace("/admin/login"));
  }

  return (
    <header className="sticky top-0 z-20 border-b border-ink-200 bg-white">
      {/*
        高度用那个共享变量（而不是 `h-14`）：它同时决定侧栏从哪里开始贴。
        两处各写一个数字的话，改一处就会出现"侧栏压住第二行导航"这种错位。
      */}
      <div className="flex h-[var(--admin-topbar-height)] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tight text-brand-800">
            NexGenEdu
          </span>
          <span className="text-sm text-ink-500 max-sm:hidden">教务后台</span>
        </div>

        <GlobalSearch />

        <div className="flex items-center gap-3">
          {/* 后端/数据库的真实连接状态：后端没跑、地址填错时，这里会直接变色并可手动改地址 */}
          <BackendStatus compact />
          {username !== "" && (
            <span className="text-sm text-ink-500 max-sm:hidden">
              已登录：{username}
              {roles.length > 0 && (
                <span className="ml-1 text-xs text-ink-400">（{roles.join(" · ")}）</span>
              )}
            </span>
          )}
          <Link
            href="/"
            className="text-sm text-ink-600 transition-colors hover:text-brand-700"
          >
            返回网站
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-ink-300 px-2.5 py-1 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
          >
            退出登录
          </button>
        </div>
      </div>
    </header>
  );
}
