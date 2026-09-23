"use client";

import { clampScroll, SCROLL_MEMO_KEY } from "@/lib/admin/scroll-restore";

/**
 * **全仓库唯一允许写滚动位置的地方。**
 *
 * ## 为什么要单独一个文件（而不是散在各处）
 *
 * 历史上这一页有过两处"点一下就跳顶部"的显式滚动（点「编辑」时把人带到页顶的表单、
 * 删小节被拒时把人带到页顶的原因），都删干净了；`scripts/check.mts` 第 13 节因此有一条
 * 断言：**前端源码里一处显式滚动都没有**。那条断言是有价值的（它挡住了"再加一句跳顶部"
 * 这类改动），所以这一轮要引入"恢复型滚动"时，取舍是**不放开断言、而是把白名单收到最窄**：
 *
 *   - 允许写滚动的文件**只有这一个**（断言里写死了这个路径）；
 *   - 这个文件写进去的 top **必须是参数**（`scrollTo({ top: y, … })` 里的 `y` 是标识符），
 *     不许是字面量 —— 断言直接查这一条。于是"写常量 0"这种代码在这里根本过不了自检，
 *     而"写回记下来的位置"才是这个文件唯一能做到的事。
 *
 * 于是第 13 节那条断言**仍然防得住真正的乱滚动**：别处一句都不许有；而这一个文件里
 * 也不可能写死"顶部"（判据是源码级的，不是靠注释说好话）。
 *
 * ## 为什么 `behavior: "instant"`（而不是默认的 "auto"）
 *
 * `app/globals.css` 给 `html` 设了 `scroll-behavior: smooth`。不显式写 `instant` 的话，
 * 这两处"放回原位"会被**动画**执行 —— 用户看到的是一次可见的滑动，甚至可能打断他正在做的
 * 手势。这里要的是"位置看起来根本没动过"，所以必须 instant。
 */

/** 当前滚动位置。 */
export function readScrollY(): number {
  if (typeof window === "undefined") return 0;
  return window.scrollY;
}

/** 文档当前位置有多高（重载后它还会继续长，见 ScrollMemory）。 */
export function readScrollHeight(): number {
  if (typeof window === "undefined") return 0;
  return document.documentElement.scrollHeight;
}

/** 现在最多能滚到哪儿。 */
export function readMaxScrollY(): number {
  if (typeof window === "undefined") return 0;
  return Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight);
}

/**
 * 把滚动位置放回去。
 *
 * `y` 来自**记下来的位置**（必要时夹进当前可滚动范围，见 `clampScroll`）——
 * 这个函数自己没有"去哪"的意见，它只会去调用方算出来的那个位置。
 */
export function restoreScrollY(y: number): void {
  if (typeof window === "undefined") return;
  const target = clampScroll(y, readMaxScrollY());
  window.scrollTo({ top: target, behavior: "instant" });
}

/** 本次导航的类型（"reload" / "navigate" / "back_forward" / "prerender"；拿不到就空串）。 */
export function readNavigationType(): string {
  if (typeof window === "undefined") return "";
  const entries = performance.getEntriesByType("navigation");
  const first = entries[0] as PerformanceNavigationTiming | undefined;
  return first?.type ?? "";
}

/**
 * 记住/读回"上次离开这个地址时滚到哪儿"。
 *
 * 用 `sessionStorage` 而不是 `localStorage`：这是**这个标签页**的位置，
 * 同一个人在另一个标签页里看同一页不该被这边的位置影响。
 * 拿不到存储（隐私模式、被策略禁掉）时一律当"没有记忆"——**不抛错、不降级成别的行为**。
 */
export function readScrollMemoRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(SCROLL_MEMO_KEY);
  } catch {
    return null;
  }
}

export function writeScrollMemoRaw(raw: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SCROLL_MEMO_KEY, raw);
  } catch {
    // 存不进去就算了：代价只是"重载后回到顶部"，与没有这个功能时一样
  }
}
