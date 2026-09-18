/**
 * 课表上的「空档」：前后两节课之间空出来的时间。
 *
 * ## 为什么要有这个
 *
 * 「今天 17:30–18:30 一节课、19:00–20:30 一节课」——两节课中间那半小时，看课表的人
 * 得自己心算。接新学生、答应家长的临时加课、安排补课，靠的都是这段空档，
 * 而**它恰恰是课表上唯一没有写出来的信息**。所以这里把它算出来、显示成一张卡片。
 *
 * ## 口径（都是刻意定的，改之前先想清楚）
 *
 * 1. **只算课与课之间**：第一节课之前、最后一节课之后不算。那不是「中间空着」，
 *    而是「还没开始」与「已经结束」——把它们也算成空档，会让课表变成一张
 *    全天都是空档的表，反而看不出真正的空隙。
 * 2. **已取消的课不算占用**：它不占教师也不占教室（与统计页「已取消的课不占时间」
 *    同一口径）。若把它当成占用，就会出现「明明空着却显示没空」。
 * 3. **重叠的课不产生空档**：用「到目前为止最晚的结束时间」往后比，
 *    因此两节课时间交叉（排错了，或者同一时段给不同学生上课）时不会算出负数或假空档。
 * 4. 输入必须是**同一天**的课节：页面按天分组后再调用。
 *
 * 这里只做纯计算，不碰存储 —— 与其它领域模块一样，将来搬到服务端可以直接用。
 */

import type { Lesson } from "./types";

/** 一段空档。 */
export type DayGap = {
  /** 空档开始的分钟数（当天 0 点起算）。 */
  startMinutes: number;
  /** 空档结束的分钟数。 */
  endMinutes: number;
  /** 空档长度（分钟），恒大于 0。 */
  minutes: number;
  /** 空档**前**那节课的 id（占用一直持续到空档开始的那节）。 */
  afterLessonId: string;
  /** 空档**后**那节课的 id（列表里空档卡片插在它前面）。 */
  beforeLessonId: string;
  /** 给人看的长度，例如「30 分钟」「1 小时 30 分钟」。 */
  label: string;
  /** 给人看的时间段，例如「18:30–19:00」。 */
  rangeLabel: string;
};

/** 课表里的一项：要么是一节课，要么是一段空档。 */
export type DayTimelineItem =
  | { kind: "lesson"; lesson: Lesson }
  | { kind: "gap"; gap: DayGap };

/** 把分钟数写成人话：45 分钟 / 1 小时 / 1 小时 30 分钟。 */
export function formatGapDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

/** 分钟数 → `HH:MM`（用于显示空档的时间段）。 */
export function formatMinuteOfDay(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${`${hours}`.padStart(2, "0")}:${`${rest}`.padStart(2, "0")}`;
}

/** 一节课开始 / 结束在当天的第几分钟。 */
function startMinutesOf(lesson: Lesson): number {
  const start = new Date(lesson.startsAt);
  return start.getHours() * 60 + start.getMinutes();
}

function endMinutesOf(lesson: Lesson): number {
  return startMinutesOf(lesson) + Math.max(0, lesson.durationMinutes);
}

/** 按开始时间升序（不改动传入的数组）。 */
function byStart(a: Lesson, b: Lesson): number {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

/**
 * 算出这一天里前后两节课之间的空档。
 *
 * 返回按时间升序排列的空档；没有空档时返回空数组（调用方不必判空）。
 */
export function dayLessonGaps(lessons: Lesson[]): DayGap[] {
  const active = lessons.filter((lesson) => lesson.status !== "已取消").slice().sort(byStart);

  const gaps: DayGap[] = [];
  /** 到目前为止最晚的结束时间，以及是谁占着它（重叠时归「结束最晚」的那节课）。 */
  let occupiedUntil = -1;
  let occupiedBy: Lesson | undefined;

  for (const lesson of active) {
    const start = startMinutesOf(lesson);
    if (occupiedBy !== undefined && start > occupiedUntil) {
      const minutes = start - occupiedUntil;
      gaps.push({
        startMinutes: occupiedUntil,
        endMinutes: start,
        minutes,
        afterLessonId: occupiedBy.id,
        beforeLessonId: lesson.id,
        label: formatGapDuration(minutes),
        rangeLabel: `${formatMinuteOfDay(occupiedUntil)}–${formatMinuteOfDay(start)}`,
      });
    }
    const end = endMinutesOf(lesson);
    if (end > occupiedUntil) {
      occupiedUntil = end;
      occupiedBy = lesson;
    }
  }

  return gaps;
}

/**
 * 把课节与空档排成一条时间线（空档卡片插在「后一节课」之前）。
 *
 * 页面直接用这个结果渲染，不要在页面里再算一遍 —— 口径只能有一处。
 */
export function buildDayTimeline(lessons: Lesson[]): DayTimelineItem[] {
  const gapBefore = new Map(dayLessonGaps(lessons).map((gap) => [gap.beforeLessonId, gap]));

  const items: DayTimelineItem[] = [];
  for (const lesson of lessons.slice().sort(byStart)) {
    const gap = gapBefore.get(lesson.id);
    if (gap !== undefined) items.push({ kind: "gap", gap });
    items.push({ kind: "lesson", lesson });
  }
  return items;
}

/** 这一天一共空着多少分钟（课与课之间）。 */
export function totalGapMinutes(lessons: Lesson[]): number {
  return dayLessonGaps(lessons).reduce((sum, gap) => sum + gap.minutes, 0);
}
