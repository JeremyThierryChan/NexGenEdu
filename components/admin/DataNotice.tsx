"use client";

import { useState } from "react";
import { api } from "@/lib/backend/api";

/**
 * 示例数据提示条。
 *
 * 纯前端版本里数据只存在**当前浏览器**的 localStorage 中，
 * 且初始数据是示例数据 —— 这两件事必须在界面上说清楚，
 * 否则容易被误当成「系统里的真实数据」。同时提供一个重置入口，
 * 演示或改乱之后能一键回到初始状态（接服务端后删掉本组件）。
 */
export function DataNotice({ onReset }: { onReset?: () => void }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function reset() {
    if (!window.confirm("重置为初始示例数据？当前在浏览器里改过的内容会丢失。")) return;
    setPending(true);
    await api.reset();
    setPending(false);
    setDone(true);
    window.setTimeout(() => setDone(false), 2500);
    onReset?.();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-200 bg-white px-3.5 py-2.5">
      <p className="min-w-0 text-xs leading-relaxed text-ink-500">
        当前为<strong className="font-medium text-ink-700">示例数据</strong>
        ，只保存在这台电脑的浏览器里（换设备/清缓存会丢）。接上服务端后即为真实数据。
      </p>
      <button
        type="button"
        onClick={reset}
        disabled={pending}
        className="shrink-0 rounded-md border border-ink-300 px-2.5 py-1 text-xs text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-60"
      >
        {pending ? "重置中…" : done ? "已重置" : "重置示例数据"}
      </button>
    </div>
  );
}
