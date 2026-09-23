"use client";

import type { ConnectionState } from "@/lib/backend/connection";

/**
 * 连接状态提示条（`components/admin/DataNotice.tsx`）的**版面契约**。
 *
 * ## 为什么把"版面"单独抽成一个模块
 *
 * 这条提示条在课程清单**上方**，而它显示的是**会变的东西**：后端通不通、会话有没有失效。
 * 滚动位置上方的高度一变，浏览器就可能把滚动位置往上收（§15.3 原因二：上方塌掉），
 * 收到头就是"页面自己跳到最顶部、还得重新滚下来"—— 机构反馈过两次的那个毛病。
 *
 * 光靠"复查时不退回检查中"不够：状态**真的**变了（后端断了 / 会话失效）时说法本来就得换，
 * 而四种说法的长短并不一样。所以这里再做一层更硬的保证：
 *
 *   **四种说法渲染在同一个容器里，共用同一份最小高度 → 任何一次说法切换都只会"变高"，
 *   永远不会"变矮"。**
 *
 * 变高是安全的：页面只是把下面的内容往下推一点，浏览器不会因此调整滚动位置；
 * 只有变矮才会把滚动位置夹回去。于是"夹回顶部"这件事在**任何宽度**下都不可能由这条提示条引起。
 *
 * 纯常量 + 纯函数：没有 JSX、不碰 DOM，因此自检可以直接断言它们（`scripts/check.mts` 第 14 节）。
 */

/**
 * 提示条当前该说哪一句。
 *
 * 刻意做成**穷尽的**（四种连接状态 → 五种说法）：以后加了状态，`switch` 少写一个分支
 * 会被 `tsc` 挡下来，而不是静默落进那句最泛的"正在检查…"里。
 */
export type NoticeBranch = "checking" | "ok" | "ready" | "ready-expired" | "down";

export function noticeBranchOf(state: ConnectionState): NoticeBranch {
  if (state.status === "ok") return "ok";
  if (state.status === "ready") return state.dbReason === "expired" ? "ready-expired" : "ready";
  if (state.status === "down") return "down";
  // idle / checking：还没结论（只有第一次探活会经过这里，见 connection.ts 的说明）
  return "checking";
}

/**
 * 提示条预留的高度 = **几行字**。
 *
 * 为什么是 3 行：这四种说法在正常桌面宽度（正文区 ≥ 约 700px）下最长的那一句
 * （`down`：地址 + 原因 + "不代表数据丢了"那句）也只要 2 行，留 3 行就够把
 * **所有**分支都托到同一高度。窄屏（手机）下某一句可能超过 3 行 —— 那只会让它更高，
 * 而变高不夹滚动位置。
 *
 * 一句话：**这个数字是"最矮也不可能矮于"的下限，不是"一定能装下"的上限。**
 */
export const NOTICE_RESERVED_LINES = 3;

/** 一行字实际占多高（rem）：`text-xs` 的字号 × `leading-relaxed` 的行高。 */
export const NOTICE_LINE_REM = 0.75 * 1.625;

/**
 * 提示条容器的最小高度类。
 *
 * **必须是字面量**，不能在运行时拼出来：Tailwind 是扫源码里出现的类名来生成 CSS 的，
 * 拼出来的类名它看不见，写进去等于没写（页面上不会有任何效果，而且不会报错）。
 * 自检里有一条断言把"这个字面量确实等于按预留行数算出来的高度"钉住，
 * 因此改行数就必须同时改这个字符串 —— 两处不可能各说一套。
 */
export const NOTICE_MIN_H_CLASS = "min-h-[3.75rem]";
