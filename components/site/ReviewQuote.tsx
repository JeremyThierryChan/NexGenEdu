"use client";

import { useState } from "react";

import { reviewQuoteView } from "./review-quote-view";

type ReviewQuoteProps = {
  /** 译文（卡片默认显示的那一份）。 */
  text: string;
  /** 原文；空串／不传＝没有原文（单语评价：不显示按钮、不加任何前缀）。 */
  original?: string;
  /** 原文语言（例：`法语`）；空串时原文前缀退化成「（原文）」。 */
  originalLanguage?: string;
};

/**
 * 一条评价的正文 + 「看原文 / 看译文」小按钮（v37 / E26）。
 *
 * ## 为什么做成**通用组件**（机构原话：「后续这个按钮会复用」）
 *
 * 机构要的是"卡片默认显示译文、点一下看原文"，并明确说这个按钮**以后还会用在别处**。
 * 因此切换逻辑与那行前缀都收在这一个组件里（判定部分再抽到 `review-quote-view.ts`
 * 的纯函数，供自检直接验三态）：以后别的双语内容（教师简介、课程介绍…）
 * 只要把两份文字传进来就能复用，不用把 `useState` 与按钮再抄一遍。
 *
 * ## 三态（判定见 `reviewQuoteView`）
 *
 *   1. `original` 为空 → **单语**：只显示 `text`，**不加前缀、不显示按钮**（保持干净）；
 *   2. `original` 非空 · 默认 → 显示 `text`，段落前小字「（译文）」；
 *   3. `original` 非空 · 切过去 → 显示 `original`，前缀「（{originalLanguage}原文）」。
 *
 * ## 不记住状态（与仓库既有取舍一致）
 *
 * 用 `useState` 而不是 `localStorage`／URL：**刷新回到默认的译文**。
 * 「看的方式」不是数据，机构从没要求"刷新后还停在原文"；把它记下来反而会在
 * 换一条评价 / 换一台设备时给出与预期相反的那一份。
 *
 * ## 换行保留
 *
 * 译文与原文都是多段，`whitespace-pre-line` 让段落里的换行照常断行
 * （折成一行会把段落挤成一坨）。
 */
export function ReviewQuote({ text, original = "", originalLanguage = "" }: ReviewQuoteProps) {
  // 默认停在译文上（机构口径：卡片上展示译文）
  const [showOriginal, setShowOriginal] = useState(false);
  const view = reviewQuoteView({ text, original, originalLanguage }, showOriginal);

  return (
    <div className="min-w-0">
      <blockquote className="whitespace-pre-line text-sm leading-relaxed text-ink-700">
        {view.prefix !== "" && (
          /*
           * 前缀是**小字 + 浅色**，与正文同一行起头：机构要求"在段落前面加"，
           * 因此它是一个 inline 的 span（不是另起一段的标题）。
           */
          <span className="mr-1 text-xs text-ink-400">{view.prefix}</span>
        )}
        {view.body}
      </blockquote>

      {view.showToggle && (
        /*
         * 原生 `<button type="button">`：键盘可 Tab、可回车，不需要额外的 keydown；
         * `aria-pressed` 说出"现在停在原文上吗"，`aria-label` 说清按了会变成哪一份。
         * 按钮很小、放在正文下方左对齐（不抢正文的注意力）。
         */
        <button
          type="button"
          aria-pressed={showOriginal}
          aria-label={view.toggleAriaLabel}
          onClick={() => setShowOriginal((current) => !current)}
          className="mt-2 rounded-sm border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
        >
          {view.toggleLabel}
        </button>
      )}
    </div>
  );
}
