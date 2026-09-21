"use client";

import { BackendStatus } from "@/components/admin/BackendStatus";

/**
 * 登录页上的后端提示：一句人话 + 状态信号（点开可以改地址）。
 *
 * 为什么放在登录页：**连不上后端时，人正是卡在这一页**。这之前这页只会说
 * "账号口令由本机后端持有"，但后端没在跑、或地址不对（比如前端在 3001、
 * 后端在 4000，而人打开了别的页面）时，光看那句话是没有任何下手的余地的。
 */
export function AdminBackendHint() {
  return (
    <div className="rounded-md border border-ink-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-ink-500">
          登录要连<strong className="font-medium text-ink-700">本机后端</strong>
          （<span className="font-mono">npm run server</span>）。
          连不上时点右边看原因、或手动指定地址。
        </p>
        <BackendStatus />
      </div>
    </div>
  );
}
