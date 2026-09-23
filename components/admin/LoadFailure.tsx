"use client";

import { Button } from "@/components/ui/Button";

/**
 * **读不出来时的那一屏**（每个后台页面共用）。
 *
 * ## 为什么要有它（审计抓到的"永久加载中"）
 *
 * 界面上的读写都是 `await api.…()`，而远端代理在服务端回 401/403/400/500 时**一定 reject**
 * （见 `lib/backend/remote.ts`）。但 10 个页面的 `load()` 都没有 `try/catch`：
 * 于是后端没开、登录过期、权限不足时，`setLoading(false)` 那一行永远走不到 ——
 * 页面就停在"加载中…"，**没有任何解释**，用户会一直等。
 *
 * 审计里的原话是"空状态、加载态、错误态三者里，只有错误态是必须解释的"。
 * 这个组件就是那一句解释：把服务端（或网络）的原话显示出来，并给一个「重试」。
 *
 * ## 为什么它不做成整页替换
 *
 * `accounts` 与 `holidays` 两页的做法是"读不出来就整页换成一句人话"（那一页本来也没有内容可保）。
 * 而这里这 10 个页面在刷新失败时**屏幕上还留着上一次的数据**——把整页换掉等于把那些数据藏了。
 * 因此它是一块**就跑在原位**的提示：数据还在上面，原因写在它下面，重试按钮就在旁边。
 *
 * 位置放在 `DataNotice` 之后、内容之前：它出现/消失只会影响下方内容，
 * 不会把上方的固定版式抽走（§15.3 那条纪律）。
 */
export function LoadFailure({
  error,
  onRetry,
  className = "",
}: {
  /** 失败原因（服务端原话优先）。 */
  error: string;
  /** 重试（**走安静刷新**：屏幕上可能还留着上一次的数据）。 */
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-sm leading-relaxed text-danger-600 ${className}`}
    >
      <p className="font-medium">这一页的数据没读出来</p>
      <p className="mt-1">{error === "" ? "原因未知 —— 请重试，或去看后端日志。" : error}</p>
      <p className="mt-2 text-xs text-ink-600">
        屏幕上如果有内容，那是**上一次成功读到的**数据，可能已经过期。常见原因：后端没在跑
        （顶栏的连接状态能看到）、登录过期（重新登录）、或你的角色看不到这一块。
      </p>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={onRetry}>
          重试
        </Button>
      </div>
    </div>
  );
}
