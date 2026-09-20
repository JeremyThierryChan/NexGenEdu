"use client";

import { Button } from "@/components/ui/Button";
import { isRemoteMode, remoteBase } from "@/lib/backend/remote";

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
 */
export function DataNotice({ onRefresh }: { onRefresh?: () => void }) {
  const remote = isRemoteMode();

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-200 bg-white px-3.5 py-2.5">
      {remote ? (
        <p className="min-w-0 text-xs leading-relaxed text-ink-500">
          已连接后端（<span className="font-mono text-ink-600">{remoteBase()}</span>）：
          数据保存在<strong className="font-medium text-ink-700">服务端数据库</strong>里，
          不在浏览器里 —— 换设备、清缓存都不会丢；后端每天会自动备份一份
          （「数据与备份」页可导出 JSON 留档）。
        </p>
      ) : (
        <p className="min-w-0 text-xs leading-relaxed text-ink-500">
          这是<strong className="font-medium text-ink-700">线上静态站点</strong>：
          没有后端可连，后台不保存任何数据（因此也无法登录）。
          正式使用请在本机运行 <span className="font-mono">npm run server</span> 与{" "}
          <span className="font-mono">npm run dev</span>。
        </p>
      )}
      {onRefresh !== undefined && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          className="shrink-0"
        >
          刷新
        </Button>
      )}
    </div>
  );
}
