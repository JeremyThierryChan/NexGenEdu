"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { isRemoteMode } from "@/lib/backend/remote";

/**
 * 后台登录守卫。
 *
 * 静态导出没有服务端中间件，因此守卫只能在浏览器里做：挂载后**问一次服务端**
 * "这个令牌还有效吗"，未登录就跳转到 /admin/login。为了不把后台界面渲染进静态 HTML，
 * 这里**在确认登录之前不渲染子内容**（只显示占位），也顺便避免
 * 「先闪一下后台界面再跳走」。
 *
 * 第 6 步之后它是一道**真的**门了（口令与校验都在服务端），但仍然只是**体验层**的：
 * 真正的边界在服务端 —— 未登录的请求一律 401，直接敲接口也拿不到数据。
 * 这个区别值得记住：守卫漏了只是体验差，服务端漏了才是数据被看走。
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "authed" | "anonymous" | "offline">("checking");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await getSession();
      if (cancelled) return;

      if (session !== null) {
        setState("authed");
        return;
      }
      /*
       * 没连后端时**不往登录页踢**：那种环境下登录页也做不了什么，
       * 来回跳只会让人以为是"口令输错了"。停在一句明确的说明上更有用。
       */
      if (!isRemoteMode()) {
        setState("offline");
        return;
      }
      setState("anonymous");
      // 带上来源路径，登录后回到原来想看的页面
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (state === "authed") return <>{children}</>;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-50 px-6">
      {state === "offline" ? (
        <div className="max-w-md text-center">
          <p className="text-base font-semibold text-ink-800">后台需要本机后端</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            当前构建没有配置后端地址（<span className="font-mono">NEXT_PUBLIC_API_BASE</span>），
            因此后台无法使用。请在本机运行：
          </p>
          <p className="mt-3 font-mono text-xs text-ink-600">npm run server</p>
          <p className="font-mono text-xs text-ink-600">npm run dev</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            然后用**启动后端时打印的**账号口令登录。线上站点（给家长看的宣传页）不受影响。
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-500">
          {state === "checking" ? "正在检查登录状态…" : "未登录，正在跳转到登录页…"}
        </p>
      )}
    </div>
  );
}
