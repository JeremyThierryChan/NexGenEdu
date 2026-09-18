"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession } from "@/lib/auth/session";

/**
 * 后台登录守卫（纯前端）。
 *
 * 静态导出没有服务端中间件，因此守卫只能在浏览器里做：挂载后检查会话，
 * 未登录就跳转到 /admin/login。为了不把后台界面渲染进静态 HTML，
 * 这里**在确认登录之前不渲染子内容**（只显示一个占位），
 * 也顺便避免「先闪一下后台界面再跳走」。
 *
 * 再次强调：这是体验层的门，不是安全边界（见 lib/auth/session.ts 的说明）。
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "authed" | "anonymous">("checking");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (getSession() !== null) {
      setState("authed");
      return;
    }
    setState("anonymous");
    // 带上来源路径，登录后回到原来想看的页面
    router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [pathname, router]);

  if (state === "authed") return <>{children}</>;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-50">
      <p className="text-sm text-ink-500">
        {state === "checking" ? "正在检查登录状态…" : "未登录，正在跳转到登录页…"}
      </p>
    </div>
  );
}
