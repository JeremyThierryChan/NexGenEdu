"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visiblePages } from "@/lib/auth/roles";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";

/**
 * **页面守卫**：直接敲网址（或别人发来的链接）进来时，给一句人话而不是坏掉的界面。
 *
 * 为什么要在客户端也判一次：导航里已经把入口藏掉了，但网址是可以直接输入的 ——
 * 那时候如果照常渲染，用户会看到一个**点了就报错的页面**（服务端会拒每个请求），
 * 那种"页面在、但什么都干不了"的状态最难解释。这里直接说清楚"你的角色看不到这一页、
 * 需要什么角色"，比让人自己去猜好得多。
 *
 * 再强调一次：这只影响界面。**权限由服务端判定** —— 手工调接口一样会被拒。
 */
export function RoleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const auth = useAuth();
  const roles = rolesOrAll(auth);

  /*
   * 路径归一化：静态导出是 `trailingSlash: true`，于是 `/admin/finance/` 与 `/admin/finance`
   * 都真实存在。不归一化的话，带斜杠的访问会被误判成"没权限"。
   */
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const allowed = visiblePages(roles);

  // 首页谁都进得来；子路径按最长前缀匹配（`/admin/students` 也可能有子页面）
  if (path === "/admin" || allowed.some((href) => path === href || path.startsWith(`${href}/`))) {
    return <>{children}</>;
  }

  const needed = roleHints.find(([prefix]) => path.startsWith(prefix))?.[1] ?? "";
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-ink-200 bg-white px-5 py-6">
      <p className="text-base font-semibold text-ink-800">你的角色看不到这一页</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">
        你现在的角色是
        <strong className="mx-1 font-medium text-ink-800">{roles.join(" · ") || "（未知）"}</strong>
        ，这一页不归你的角色。{needed !== "" ? `它需要：${needed}。` : ""}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-500">
        各角色分别该看到哪些页，见使用手册的「谁能做什么」一节；确实需要这个权限，
        请联系技术管理员调整你的账号角色。
      </p>
      <p className="mt-4">
        <Link
          href="/admin"
          className="rounded-md border border-ink-300 px-3 py-1.5 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
        >
          回今日概览
        </Link>
      </p>
    </div>
  );
}

/**
 * 「这一页需要什么角色」的提示语（按路径前缀）。
 *
 * 只写那些**真的会有人问**的几页：财务、报价改价、数据与备份、账号、咨询。
 * 其余页面不提示，免得出现一句多数情况下不准确的话 —— 宁可少说，也不要瞎说。
 */
const roleHints: Array<[string, string]> = [
  ["/admin/finance", "财务管理员 或 技术管理员"],
  ["/admin/pricing", "财务管理员 或 技术管理员"],
  ["/admin/data", "技术管理员"],
  ["/admin/accounts", "技术管理员"],
  ["/admin/inquiries", "招生老师 或 技术管理员"],
  ["/admin/scripts", "招生老师 或 技术管理员"],
  ["/admin/followups", "招生老师 或 财务管理员 或 技术管理员"],
];
