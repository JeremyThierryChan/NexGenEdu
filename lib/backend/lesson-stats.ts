import type { Lesson } from "./types";

/**
 * 课时 / 课次的**统一口径**：**一律不计已取消的课**，取消的单独给一个数。
 *
 * ## 为什么要有这个模块（审计抓到的"同一个词四个意思"）
 *
 * "今天几节课 / 几小时"原先在四个地方各算一遍，而且**规则不一样**：
 *
 * | 位置 | 已取消的课 |
 * | --- | --- |
 * | 今日概览 | **算进**节数与小时数（`totalMinutes` 直接累加） |
 * | 课程安排页 | 节数**算进**、小时数**排除** → 同一个页面同一行写"3 节 · 2 小时" |
 * | 课表与占用页 | 焦点行**排除**、本周总览**算进** → 同一屏两个小时数 |
 * | 统计页 | 排除，并把"取消的课"单列一张卡 |
 *
 * 员工看到两个数会先怀疑数据错了，然后去"核对" —— 而两个数都对，只是口径不同。
 * 更糟的是**取消一门课之后数字反而变大**，那是最容易被当成故障的那种不一致。
 *
 * 因此口径定成一句话：**取消的课不算课时、不算课次**（它没上，凭什么占课时），
 * 但要把"有几节被取消了"单独说出来（那是要人去处理的信息，不能藏掉）。
 * 每个消费点都调这里，不再各自 `filter` / `reduce`。
 */

export type LessonCounts = {
  /** 有效的课次（不含已取消）。 */
  active: number;
  /** 已取消的课次。 */
  cancelled: number;
  /** 全部（有效 + 已取消）—— 只有"要不要显示取消那一行"时才用得着。 */
  total: number;
  /** 有效课时的分钟数。 */
  activeMinutes: number;
  /** 已取消的课时分钟数。 */
  cancelledMinutes: number;
};

export function countLessons(lessons: Lesson[]): LessonCounts {
  let active = 0;
  let cancelled = 0;
  let activeMinutes = 0;
  let cancelledMinutes = 0;
  for (const lesson of lessons) {
    if (lesson.status === "已取消") {
      cancelled += 1;
      cancelledMinutes += lesson.durationMinutes;
      continue;
    }
    active += 1;
    activeMinutes += lesson.durationMinutes;
  }
  return {
    active,
    cancelled,
    total: lessons.length,
    activeMinutes,
    cancelledMinutes,
  };
}

/** 「3 节 · 2 小时」里那句课次的说法（取消的课顺带说一句，没取消就不提）。 */
export function describeLessonCounts(counts: LessonCounts): string {
  const hours = Math.round((counts.activeMinutes / 60) * 10) / 10;
  return `${counts.active} 节 · ${hours} 小时${counts.cancelled > 0 ? `（另有 ${counts.cancelled} 节已取消，未计入）` : ""}`;
}
