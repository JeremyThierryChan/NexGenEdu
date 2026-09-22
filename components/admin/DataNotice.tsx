"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { BackendStatus } from "@/components/admin/BackendStatus";
import { backendBase, getConnectionState, subscribeConnection } from "@/lib/backend/connection";

/**
 * 后台数据提示条。
 *
 * ## 两种环境的说法都必须是真的（§7.1）
 *
 * 这句话直接决定员工怎么理解"我的数据在哪"，写错比不写更糟：
 *   - **连上后端**（本机使用）：数据在服务端的 SQLite 里 —— 换设备、清缓存都不会丢，
 *     而且后端每天会自动备份一份；
 *   - **没连后端**（线上静态站）：这里根本没有能存数据的地方，后台也无法登录。
 *     早期这段写的是"数据保存在这台电脑的浏览器里" —— 那时是真的，
 *     但第 6 步之后后台不再把数据写进浏览器存储，留着它就成了假话，
 *     会让人以为"在线上录的数据本机也能看到"。
 *
 * 这里**刻意不提供「重置示例数据」**：那是纯前端阶段的临时功能，
 * 点一下就会把数据全部换成示例数据 —— 对已经在录真实数据的机构来说，
 * 这是个随时可能误触的破坏性按钮，而它解决的问题（"想从头来过"）用
 * 「数据与备份 → 导入空库」就够了，而且那条路会先自动备份。
 *
 * ## 「刷新」按钮为什么自己管"刷新中…"
 *
 * 各页面的刷新现在都是**安静刷新**（`load({ quiet: true })`）：不清空列表、不进加载态 ——
 * 这样点一下不会把页面高度塌掉（§15.3：页高在滚动位置上方塌了，浏览器会把滚动位置夹回顶部）。
 * 代价是"刷新中"这件事不能再靠页面自己说了，所以由这个按钮说：把各页面传进来的
 * 刷新函数**等它结束**，期间按钮上是"刷新中…"。按钮上的字不会改变页面高度（按钮一直是那一行），
 * 这正是这次想要的：有反馈，但不动版面。
 */
export function DataNotice({ onRefresh }: { onRefresh?: () => void | Promise<void> }) {
  /*
   * 这段话必须**依据真实探活结果**来说，不能只看"配没配地址"。
   * 以前它只判断环境变量，于是后端没在跑时照样宣称"已连接后端…数据不会丢" ——
   * 那是句假话，而且正好是出事时最不该说的一句（让人以为数据平安）。
   */
  const state = useSyncExternalStore(subscribeConnection, getConnectionState, getConnectionState);
  /** 这次刷新还没结束（各页面传进来的刷新函数返回 Promise 时才有）。 */
  const [refreshing, setRefreshing] = useState(false);

  function onRefreshClick(): void {
    if (onRefresh === undefined) return;
    const result = onRefresh();
    // 同步刷新（不用等的实现）没有"刷新中"可言：拿不到 Promise 就不假装在等
    if (!(result instanceof Promise)) return;
    setRefreshing(true);
    void result.finally(() => setRefreshing(false));
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-200 bg-white px-3.5 py-2.5">
      {state.status === "ready" && state.dbReason === "expired" ? (
        <p className="min-w-0 text-xs leading-relaxed text-warning-600">
          <strong className="font-medium">登录已失效</strong>（后端重启过，或闲置超时）：
          服务端还在，但它已经不认这个令牌了 —— 这一页上的操作会失败。
          <strong className="font-medium text-ink-700">数据没有丢</strong>，
          点右上角状态里的「重新登录」再进来即可。
        </p>
      ) : state.status === "ok" || state.status === "ready" ? (
        <p className="min-w-0 text-xs leading-relaxed text-ink-500">
          已连接后端（<span className="font-mono text-ink-600">{backendBase()}</span>）：
          数据保存在<strong className="font-medium text-ink-700">服务端数据库</strong>里，
          不在浏览器里 —— 换设备、清缓存都不会丢；后端每天会自动备份一份
          （「数据与备份」页可导出 JSON 留档）。
        </p>
      ) : state.status === "down" ? (
        <p className="min-w-0 text-xs leading-relaxed text-ink-500">
          <strong className="font-medium text-danger-600">连不上后端</strong>
          （<span className="font-mono text-ink-600">{state.base === "" ? "地址未配置" : state.base}</span>）：
          {state.reason}
          <strong className="font-medium text-ink-700">这不代表数据丢了</strong> ——
          数据在服务端的库文件里；后端起来后刷新即可。点右边看详情或手动指定地址。
        </p>
      ) : (
        <p className="min-w-0 text-xs leading-relaxed text-ink-500">
          正在检查后端连接状态…
          {backendBase() === "" && "（当前没有配置后端地址）"}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-2">
        <BackendStatus />
        {onRefresh !== undefined && (
          <Button variant="outline" size="sm" onClick={onRefreshClick} disabled={refreshing}>
            {refreshing ? "刷新中…" : "刷新"}
          </Button>
        )}
      </div>
    </div>
  );
}
