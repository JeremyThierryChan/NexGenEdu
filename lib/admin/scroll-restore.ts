/**
 * **恢复型滚动**的判定：什么情况下可以把滚动位置放回去、放到哪。
 *
 * ## 这个模块存在的理由（以及它为什么不是"掩盖问题"）
 *
 * 机构反馈过两次、这一轮又确认过的现象是"点一下卡片上的「设为暂未开放」，**过一会儿**
 * 页面跳到最顶部"。排查结论是：**重渲染本身不会把位置夹到 0**（页面上方那点高度差
 * 只有一两行、约 20~40px，而"夹到 0"要求文档塌到不足一屏），真正能做到这件事的只有
 * **整页重载**——重载后后台外壳先渲染一屏高的占位屏，滚动位置在那一刻被夹到 0，
 * 之后内容长回来位置也不会自己回去。
 *
 * 重载这件事本身**不是我们能在页面里禁止的**（开发模式的"盯着后端"、热更新、
 * 浏览器缓存失效后的重载都属于这一类，而且浏览器**本来就会**在重载后把滚动位置放回原处，
 * 只是后台外壳先渲染"正在检查登录状态…"、那时文档只有一屏高，浏览器的恢复被夹成了 0）。
 * 所以这里做的是**把浏览器本该做到、却被短占位屏破坏的那一步补回来**：
 * 重载前记下位置，重载后等页面长够高再放回去。
 *
 * 而"就地动作期间"那一类（`inPlaceScrollCorrection`）针对的是另一种情形：
 * 一次就地更新让文档高度变了，浏览器可能顺手把你的滚动位置挪一下。那种挪动**同样不该**
 * 让用户丢位置 —— 但**只在"文档高度确实变了、位置也确实被挪了"时才动手**，
 * 其余一律不干预（见下面那条判据）。
 *
 * ## 一条贯穿始终的纪律：只写"记下来的值"，绝不写常量
 *
 * 两个函数返回的都是**记下来的那个位置**（必要时夹到当前可滚动范围内），
 * 而不是 `0`、也不是"某个容器的顶部"。因此它们**不可能**制造出
 * "跳到最顶部"这种行为 —— 那正是这一节要防的东西。
 * `scripts/check.mts` 第 13 节有一条源码级断言守着这件事：
 * 全仓库只允许 `components/admin/scroll-io.ts` 这一个文件写滚动，而且它写进去的 top
 * 必须是**参数**、不许是字面量。
 *
 * 纯函数、不碰 DOM：自检可以直接穷举它们的判定表（`scripts/check.mts` 第 14 节）。
 */

/** 记住滚动位置用的键（`sessionStorage`：**按标签页**存，两个标签页看不同页面时不会互相干扰）。 */
export const SCROLL_MEMO_KEY = "nexgenedu.admin.scroll.v1";

/** 一份"上次离开这个地址时滚到哪儿"的记录。 */
export type ScrollMemo = { href: string; y: number };

/**
 * 把位置夹进当前可滚动范围。
 *
 * 为什么必须夹：重载后页面可能比原来**矮**（例如刚开始数据还没回来、
 * 或者上次记下的位置比现在这一屏能滚到的最大值还大）。不夹的话写进去也无效
 * （浏览器自己会夹），但"夹到多少"这件事要在纯函数里定下来、可测：
 * 夹到**当前能滚到的最远处**，而不是夹到 0 —— 夹到 0 就成了"跳到最顶部"。
 */
export function clampScroll(y: number, maxScroll: number): number {
  if (!Number.isFinite(y)) return 0;
  const ceiling = Number.isFinite(maxScroll) ? Math.max(0, Math.round(maxScroll)) : 0;
  return Math.min(Math.max(Math.round(y), 0), ceiling);
}

export function encodeScrollMemo(memo: ScrollMemo): string {
  return JSON.stringify({ href: memo.href, y: Math.round(memo.y) });
}

/**
 * 读回记录。**坏数据一律当"没有记录"**（返回 `null`），不去猜、也不把半截数据当可用：
 * 那份数据只用于"把位置放回原处"，猜错的结果是把人送到一个他没待过的地方。
 */
export function decodeScrollMemo(raw: string | null): ScrollMemo | null {
  if (raw === null || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { href, y } = parsed as { href?: unknown; y?: unknown };
  if (typeof href !== "string" || href === "") return null;
  if (typeof y !== "number" || !Number.isFinite(y) || y < 0) return null;
  return { href, y };
}

export type InPlaceCorrectionInput = {
  /** 动作开始时记下的位置（没记过就是 null → 不干预）。 */
  recordedY: number | null;
  /** 动作开始时记下的文档高度。 */
  recordedHeight: number | null;
  currentY: number;
  currentHeight: number;
  maxScroll: number;
};

/**
 * 就地动作期间：要不要把滚动位置放回去？返回 `null` = **一个字都不写**。
 *
 * 判据只有三条，按顺序：
 *
 *   1. **没有记录 → 不干预**（这个动作根本没被守护，或者已经结束了）；
 *   2. **位置没变 → 不写**（这是绝大多数情况：重渲染没有动滚动位置，那就什么都不做）；
 *   3. **文档高度没变、位置却变了 → 不写**：这不是"页面在动"，而是**人自己在滚**
 *      （滚轮 / 拖动滚动条 / 键盘），此时去写就是**跟用户抢滚动条** —— 那比跳顶更让人恼火。
 *
 * 三条都过了（＝文档高度变了、位置也跟着被挪了）才返回**记下来的那个位置**（夹进当前范围）。
 * 于是这段代码能做的只有一件事：**把被外力挪走的位置放回原地**，
 * 它没有任何路径能写出"顶部"。
 */
export function inPlaceScrollCorrection(input: InPlaceCorrectionInput): number | null {
  const { recordedY, recordedHeight, currentY, currentHeight, maxScroll } = input;
  if (recordedY === null || recordedHeight === null) return null;
  if (!Number.isFinite(recordedY) || !Number.isFinite(recordedHeight)) return null;
  if (currentY === recordedY) return null;
  // 「高度没变」= 这次重渲染没有让文档长高或变矮 → 位置变化只可能来自人自己
  if (currentHeight === recordedHeight) return null;
  return clampScroll(recordedY, maxScroll);
}

export type ReloadRestoreInput = {
  /** 上次离开这个地址时记下的位置（`null` = 没有记录 / 记录坏了）。 */
  memo: ScrollMemo | null;
  /** 当前地址（与记录里的地址不一致就不放回：地址都换了，说明不是同一份页面）。 */
  href: string;
  /** `PerformanceNavigationTiming.type`（"reload" / "navigate" / "back_forward" / "prerender"）。 */
  navigationType: string;
  maxScroll: number;
};

/**
 * 整页重载之后：要不要把位置放回去、放到哪？返回 `null` = 不干预。
 *
 * 判据同样只有几条，而且是**保守**的：
 *
 *   1. 导航类型必须是 `reload` —— 普通跳转、首次进入、前进后退都**不恢复**
 *      （那些情况下浏览器与该到哪儿是另一回事，我们不去插手）；
 *   2. 记录里的地址必须与当前地址一致；
 *   3. 记下的位置必须是正数（本来就停在顶部，没什么可放回的）；
 *   4. 放回的值 = 记下的位置夹进当前可滚动范围（页面可能还没长到原来那么高，
 *      那时等到长够再放，见 `components/admin/ScrollMemory.tsx`）。
 */
export function reloadRestoreTarget(input: ReloadRestoreInput): number | null {
  const { memo, href, navigationType, maxScroll } = input;
  if (navigationType !== "reload") return null;
  if (memo === null) return null;
  if (memo.href !== href) return null;
  if (memo.y <= 0) return null;
  return clampScroll(memo.y, maxScroll);
}
