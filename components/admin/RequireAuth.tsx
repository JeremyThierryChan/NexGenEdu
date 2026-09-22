"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { checkSession } from "@/lib/auth/session";
import { AuthContext, type AuthState } from "@/components/admin/AuthContext";
import { isRemoteMode, remoteBase } from "@/lib/backend/remote";
import { BackendStatus } from "@/components/admin/BackendStatus";

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
  const [state, setState] = useState<"checking" | "authed" | "anonymous" | "offline" | "blocked">("checking");
  /** 当前登录者与角色（问一次会话，供导航 / 守卫 / 顶栏共用）。 */
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [detail, setDetail] = useState("");
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      /*
       * 整段包 try/catch：**检查本身出错也必须给结论**。
       * 以前这里一旦抛异常（例如浏览器里还是半新半旧的模块、`checkSession` 根本不存在），
       * effect 就静悄悄死掉，界面永远停在"正在检查登录状态…"—— 没有任何提示，
       * 也没法自救。现在任何异常都会落到"出错"这一屏，把原因摆出来。
       */
      let check;
      try {
        check = await checkSession();
      } catch (cause) {
        if (cancelled) return;
        setDetail(
          `检查登录状态时出错：${cause instanceof Error ? cause.message : String(cause)}` +
          "（若刚刚改过代码，请用 Cmd+Shift+R 强制刷新一次，清掉浏览器里缓存的旧模块）",
        );
        setState("blocked");
        return;
      }
      if (cancelled) return;

      if (check.session !== null) {
        // 会话里带着角色（一个账号可能兼多个）：界面按它决定显示哪些入口
        setAuth({ username: check.session.username, roles: check.session.roles });
        setState("authed");
        return;
      }

      /*
       * 这里**不再把三种情况混成一种**。
       *
       * 以前失败一律当"未登录"→ 弹回登录页。于是"后端没开""浏览器把请求拦了"
       * "令牌过期"表现完全一样：用户在登录页反复试口令，怎么都不进去，
       * 而真正的原因一个字都没露出来（这一轮就为此绕了很久）。
       * 现在：只有"确实没令牌/令牌过期"才回登录页；"请求根本发不出去"停在这里说清楚。
       */
      if (!isRemoteMode()) {
        setState("offline");
        return;
      }
      if (check.reason === "unreachable") {
        setDetail(check.detail ?? "");
        setState("blocked");
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

  if (state === "authed") {
    return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-50 px-6">
      {state === "blocked" ? (
        <div className="max-w-lg">
          <p className="text-base font-semibold text-ink-800">没能确认登录状态</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            浏览器没拿到会话响应，所以没有进后台。<strong className="font-medium text-ink-700">这通常不是口令问题</strong>
            —— 是随后的请求发不出去（或出错了）。常见原因：
          </p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600">
            <li>后端没在跑：<span className="font-mono text-xs">npm run server</span>（端口 4000）；</li>
            <li>浏览器缓存了旧的跨源预检结果 —— <strong className="font-medium text-ink-700">重启浏览器</strong>即可清掉；</li>
            <li>服务端没放行 <span className="font-mono text-xs">Authorization</span> 头（应包含在
              <span className="font-mono text-xs"> access-control-allow-headers</span> 里）；</li>
            <li>浏览器里还是**半新半旧的模块**（刚改过代码时会出现）——
              <strong className="font-medium text-ink-700">Cmd+Shift+R 强制刷新</strong>即可。</li>
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            后端地址：<span className="font-mono">{remoteBase()}</span>
            {detail === "" ? null : <><br />技术细节（也可在浏览器控制台看到）：<span className="font-mono">{detail}</span></>}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <BackendStatus />
            <button
              type="button"
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
              onClick={() => window.location.reload()}
            >
              刷新页面重试
            </button>
          </div>
        </div>
      ) : state === "offline" ? (
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
