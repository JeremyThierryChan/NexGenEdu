"use client";

import { Button } from "@/components/ui/Button";

/**
 * 后台数据提示条。
 *
 * 这里**刻意不再提供「重置示例数据」**：那是纯前端阶段的临时功能，
 * 点一下就会把浏览器里的数据全部换成示例数据 —— 对已经在录真实数据的机构来说，
 * 这是个随时可能误触的破坏性按钮，而它解决的问题（"想从头来过"）用
 * 「数据与备份 → 导入空库」就够了，而且那条路会先自动备份。
 *
 * 保留下来的提示才是不能省的那部分：**数据只在这台电脑的浏览器里**。
 * 不写清楚，用户会以为数据在服务器上、换台电脑也能看到。
 */
export function DataNotice({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-200 bg-white px-3.5 py-2.5">
      <p className="min-w-0 text-xs leading-relaxed text-ink-500">
        数据保存在<strong className="font-medium text-ink-700">这台电脑的浏览器</strong>里：
        换设备、清缓存或用隐私窗口都会看不到。请定期到
        <strong className="font-medium text-ink-700">「数据与备份」导出 JSON</strong> 作为备份；
        接上服务端后即为真实数据（多人共用）。
      </p>
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
