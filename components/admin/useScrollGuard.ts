"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { inPlaceScrollCorrection } from "@/lib/admin/scroll-restore";
import { readMaxScrollY, readScrollHeight, readScrollY, restoreScrollY } from "@/components/admin/scroll-io";

/**
 * 「就地动作」期间的滚动守护：动作开始时 `arm()`，结束时 `release()`。
 *
 * ## 它防的是什么
 *
 * 就地动作（例如课程库里点「设为暂未开放」）会就地更新一条数据 —— 不重载、不清空列表。
 * 但那次重渲染确实可能让**文档高度**变一下（卡片上多一行结果提示、按钮上的字变短），
 * 浏览器在这种情况下可能顺手把滚动位置挪一下。**用户不该因为这个丢位置。**
 *
 * ## 为什么这样写才对（而不是"记住位置、每次都放回去"）
 *
 * 无条件把位置放回去会**跟用户抢滚动条**：用户在动作还没跑完时自己滚了一下，
 * 我们就把他拽回来 —— 那比跳顶更让人恼火。所以这里的判据（纯函数
 * `inPlaceScrollCorrection`，自检里穷举过）只在**"文档高度确实变了、位置也确实被挪了"**
 * 时才动手；文档高度没变而位置变了，那一定是人自己在滚，**一个字都不写**。
 *
 * 另外：它写回去的是**记下来的那个位置**，不是 0、也不是任何常量 ——
 * 所以它没有能力制造"跳到最顶部"，只能把被外力挪走的位置放回原地。
 *
 * ## 为什么用 `useLayoutEffect` 且不写依赖表
 *
 * 浏览器调整滚动位置发生在**布局阶段**，因此必须在"提交之后、绘制之前"读一次当前值
 * 才量得到（`useEffect` 太晚，用户可能已经看到那一下跳动）。不写依赖表 =
 * 这个组件的**每一次**提交都查一遍 —— 一次动作可能带出好几次提交
 * （先改这条数据、再写结果提示、最后清掉"切换中…"），每一次都可能是改动高度的那一次。
 */
export function useScrollGuard(): { arm: () => void; release: () => void } {
  /** 动作开始时记下的位置；`null` = 没有守护在进行（此时这个 Hook 完全不动手）。 */
  const desiredY = useRef<number | null>(null);
  /** 上一次看到的文档高度：用来判断"这一次提交有没有改高度"。 */
  const lastHeight = useRef<number | null>(null);

  const arm = useCallback((): void => {
    desiredY.current = readScrollY();
    lastHeight.current = readScrollHeight();
  }, []);

  const release = useCallback((): void => {
    desiredY.current = null;
    lastHeight.current = null;
  }, []);

  useLayoutEffect(() => {
    if (desiredY.current === null) return;
    const currentHeight = readScrollHeight();
    const target = inPlaceScrollCorrection({
      recordedY: desiredY.current,
      recordedHeight: lastHeight.current,
      currentY: readScrollY(),
      currentHeight,
      maxScroll: readMaxScrollY(),
    });
    // 先算后记：下一次提交比的是"相对这一刻"的变化
    lastHeight.current = currentHeight;
    if (target !== null) restoreScrollY(target);
  });

  return { arm, release };
}
