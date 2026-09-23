"use client";

import { useEffect } from "react";
import { decodeScrollMemo, encodeScrollMemo, reloadRestoreTarget } from "@/lib/admin/scroll-restore";
import {
  readMaxScrollY,
  readNavigationType,
  readScrollMemoRaw,
  readScrollY,
  restoreScrollY,
  writeScrollMemoRaw,
} from "@/components/admin/scroll-io";

/**
 * 整页重载后**把滚动位置放回去**（挂在后台外壳里，不渲染任何东西）。
 *
 * ## 它防的是什么（这是"跳到最顶部"唯一说得通的机制）
 *
 * 要把滚动位置夹到 **0**，文档高度必须塌到**不足一屏** —— 页面上方少几十像素只能让位置
 * 往上收几十像素。整页重载正好会这样：重载之后后台外壳先渲染"正在检查登录状态…"
 * （那是一个 `min-h-dvh`、正好一屏高的占位屏），滚动位置在那一刻被夹成 0；
 * 等后台内容再长回来，位置也不会自己回去。于是用户看到的就是
 * "**过一会儿页面跳到最顶部，还得重新滚下来**"（机构反馈过的原话）。
 *
 * 重载本身不是页面能禁止的（开发模式的"盯着后端"、热更新、用户自己按 F5 都会重载），
 * 而且**浏览器本来就会**在重载后把位置放回去 —— 只是它恢复的那一刻文档只有一屏高，
 * 恢复被夹成了 0。这个组件做的就是把浏览器本该做到的那一步补回来：
 * **重载前记下位置，重载后等页面长够高再放回去。**
 *
 * ## 三条自我约束（都不靠"说好话"，而是写死在判据里）
 *
 *   1. **只在"整页重载且地址没变"时恢复**（`reloadRestoreTarget` 的第一条判据）：
 *      普通跳转、首次进入、前进后退一律不插手 —— 那些情况下该到哪儿是另一回事。
 *   2. **只写"记下来的位置"**：值来自 `sessionStorage` 里那份记录，夹进当前可滚动范围。
 *      没有"跳到顶部"这种路径（全仓库唯一写滚动的地方是 `scroll-io.ts`，
 *      而它写进去的 top 必须是参数 —— 自检第 13 节的源码断言查这一条）。
 *   3. **用户一动手就收手**：页面长起来可能要一两秒（列表在等数据回来），
 *      这段时间里人要是自己滚了，我们立刻停手，绝不去抢滚动条。
 *
 * ## 为什么不用 `setTimeout` 反复试
 *
 * "过一会儿自己动"正是这一节要根除的毛病，再往这里塞一个定时器等于把坑挖回去。
 * 页面长高时 `document.body` 会**自己触发 `ResizeObserver`**（body 的高度就是内容高度），
 * 所以"等它长够"有更准确的信号，而且不需要任何定时器 —— 自检第 14 节还有一条
 * "就地动作相关的文件里不许出现定时器"的断言。
 */
export function ScrollMemory() {
  // ① 离开页面之前（含整页重载）把当前位置记下来
  useEffect(() => {
    const save = (): void => {
      writeScrollMemoRaw(encodeScrollMemo({ href: window.location.href, y: readScrollY() }));
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);

  // ② 重载之后：等页面长够高，再把位置放回去
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const memo = decodeScrollMemo(readScrollMemoRaw());
    const href = window.location.href;
    const navigationType = readNavigationType();

    /** 试着放回原位；返回 true 表示"已经到位（或判据说不该恢复），不用再试"。 */
    const attempt = (): boolean => {
      const target = reloadRestoreTarget({
        memo,
        href,
        navigationType,
        maxScroll: readMaxScrollY(),
      });
      if (target === null) return true;
      restoreScrollY(target);
      // 页面还没长够时会被夹在当前能滚到的位置，下一次长高再来一次
      return Math.abs(readScrollY() - target) <= 1;
    };

    if (attempt()) return;

    const observer = new ResizeObserver(() => {
      if (attempt()) observer.disconnect();
    });
    observer.observe(document.body);

    const giveUp = (): void => observer.disconnect();
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events) window.addEventListener(event, giveUp, { once: true, passive: true });
    return () => {
      observer.disconnect();
      for (const event of events) window.removeEventListener(event, giveUp);
    };
  }, []);

  return null;
}
