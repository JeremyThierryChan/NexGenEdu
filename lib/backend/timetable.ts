/**
 * 课表上的「空档」：没有排课、但可能还能排一节课的时间。
 *
 * ## 为什么要有这个
 *
 * 「今天 17:30–18:30 一节课、19:00–20:30 一节课」——中间那半小时，看课表的人
 * 得自己心算。接新学生、答应家长的临时加课、安排补课，靠的都是这些空隙，
 * 而**它恰恰是课表上唯一没有写出来的信息**。所以这里把它算出来、显示成卡片。
 *
 * ## 空档有三段（这正是它的用法）
 *
 * | 类型 | 位置 | 用来回答 |
 * | --- | --- | --- |
 * | `head` | 上课时间开始 → 第一节课 | 「早来的学生 / 临时加课能不能排在课前」 |
 * | `between` | 两节课之间 | 「这个缝里还能不能再接一个学生」 |
 * | `tail` | 最后一节课 → 上课时间结束 | 「下课后还有没有时间」 |
 *
 * 头尾两段需要知道**上课时间**（默认 8:00–22:00，见内容里的「上课时间」字段），
 * 因此是可选的：不传窗口就只算课与课之间的空档（调用方不必知道营业/上课时间）。
 * 窗口由 `lib/backend/options.ts` 的 `getClassHoursWindow()` 从站点内容解析后传入 ——
 * 机构改上课时间，这里跟着变，不写死。
 *
 * ## 口径（都是刻意定的，改之前先想清楚）
 *
 * 1. **已取消的课不算占用**：它不占教师也不占教室（与统计页「已取消的课不占时间」同一口径）。
 *    取消中间那节课后，左右两段空档会连成一整段 —— 这正是取消后的真实情况。
 * 2. **重叠的课不产生空档**：用「到目前为止最晚的结束时间」往后比，
 *    因此两节课时间交叉（排错了，或同一时段给不同学生上课）时不会算出负数或假空档。
 * 3. **一节课都没有的那天不算空档**：整天空着由页面的空状态表达
 *    （「空档」/「今天没有排课」），再画一张 14 小时的卡片只是重复。
 * 4. 输入必须是**同一天**的课节：页面按天分组后再调用。
 *
 * 这里只做纯计算，不碰存储 —— 与其它领域模块一样，将来搬到服务端可以直接用。
 */

import type { Lesson } from "./types";

/** 空档的三段。 */
export type GapKind = "head" | "between" | "tail";

/** 一天里可供排课的时间窗口（当天分钟数，从 0 点起算）。 */
export type GapWindow = {
  startMinutes: number;
  endMinutes: number;
};

/** 一段空档。 */
export type DayGap = {
  /** 这一段在一天里的位置（课前 / 课间 / 课后）。 */
  kind: GapKind;
  /** 空档开始的分钟数（当天 0 点起算）。 */
  startMinutes: number;
  /** 空档结束的分钟数。 */
  endMinutes: number;
  /** 空档长度（分钟），恒大于 0。 */
  minutes: number;
  /** 空档**前**那节课的 id；课前的空档没有。 */
  afterLessonId: string;
  /** 空档**后**那节课的 id（列表里空档卡片插在它前面）；课后的空档没有。 */
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

/** 计算选项：传了窗口才会算课前 / 课后两段。 */
export type GapOptions = {
  window?: GapWindow | null;
};

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

/**
 * 从「上课时间」这类文本里解析出时间窗口。
 *
 * 内容里的写法是「每日 8:00–22:00（含节假日）」，所以只认「时:分 + 分隔符 + 时:分」。
 * 解析不出来就返回 null（调用方退回「只算课间空档」），**不要猜**：
 * 猜错会让课表显示一堆根本不存在的空档。
 */
export function parseGapWindow(text: string): GapWindow | null {
  const match = /(\d{1,2}):(\d{2})\s*(?:[–—~～至到-]|--)\s*(\d{1,2}):(\d{2})/.exec(text);
  if (match === null) return null;

  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  // 结束必须晚于开始：跨天的写法（22:00–8:00）在这里没有意义，判为无效
  if (!(endMinutes > startMinutes)) return null;
  if (startMinutes < 0 || endMinutes > 1440) return null;
  return { startMinutes, endMinutes };
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

/** 造一段空档（统一算 label 与时间段，避免各处各写一次）。 */
function makeGap(
  kind: GapKind,
  startMinutes: number,
  endMinutes: number,
  afterLessonId: string,
  beforeLessonId: string,
): DayGap {
  const minutes = endMinutes - startMinutes;
  return {
    kind,
    startMinutes,
    endMinutes,
    minutes,
    afterLessonId,
    beforeLessonId,
    label: formatGapDuration(minutes),
    rangeLabel: `${formatMinuteOfDay(startMinutes)}–${formatMinuteOfDay(endMinutes)}`,
  };
}

/**
 * 算出这一天里的空档（按时间升序）。
 *
 * 不传窗口时只算**课与课之间**；传了窗口再补上**课前**与**课后**两段
 * （窗口外的那部分不算：例如课排在 7:00，早于上课时间开始，就不会有课前空档）。
 */
export function dayLessonGaps(lessons: Lesson[], options: GapOptions = {}): DayGap[] {
  const active = lessons.filter((lesson) => lesson.status !== "已取消").slice().sort(byStart);
  if (active.length === 0) return [];

  const gaps: DayGap[] = [];
  const first = active[0]!;
  const window = options.window ?? null;

  // 课前：上课时间开始 → 第一节课
  if (window !== null && window.startMinutes < startMinutesOf(first)) {
    gaps.push(makeGap("head", window.startMinutes, startMinutesOf(first), "", first.id));
  }

  /** 到目前为止最晚的结束时间，以及是谁占着它（重叠时归「结束最晚」的那节课）。 */
  let occupiedUntil = -1;
  let occupiedBy: Lesson | undefined;

  for (const lesson of active) {
    const start = startMinutesOf(lesson);
    if (occupiedBy !== undefined && start > occupiedUntil) {
      gaps.push(makeGap("between", occupiedUntil, start, occupiedBy.id, lesson.id));
    }
    const end = endMinutesOf(lesson);
    if (end > occupiedUntil) {
      occupiedUntil = end;
      occupiedBy = lesson;
    }
  }

  // 课后：最后一节课 → 上课时间结束
  if (window !== null && occupiedBy !== undefined && occupiedUntil < window.endMinutes) {
    gaps.push(makeGap("tail", occupiedUntil, window.endMinutes, occupiedBy.id, ""));
  }

  return gaps;
}

/**
 * 把课节与空档排成一条时间线（空档卡片插在「后一节课」之前，课后的插在最后）。
 *
 * 页面直接用这个结果渲染，不要在页面里再算一遍 —— 口径只能有一处。
 */
export function buildDayTimeline(lessons: Lesson[], options: GapOptions = {}): DayTimelineItem[] {
  const gaps = dayLessonGaps(lessons, options);
  const gapBefore = new Map(
    gaps.filter((gap) => gap.beforeLessonId !== "").map((gap) => [gap.beforeLessonId, gap]),
  );
  const tailGap = gaps.find((gap) => gap.kind === "tail");

  const items: DayTimelineItem[] = [];
  for (const lesson of lessons.slice().sort(byStart)) {
    const gap = gapBefore.get(lesson.id);
    if (gap !== undefined) items.push({ kind: "gap", gap });
    items.push({ kind: "lesson", lesson });
  }
  if (tailGap !== undefined) items.push({ kind: "gap", gap: tailGap });
  return items;
}

/** 这一天一共空着多少分钟（含课前 / 课后，取决于有没有传窗口）。 */
export function totalGapMinutes(lessons: Lesson[], options: GapOptions = {}): number {
  return dayLessonGaps(lessons, options).reduce((sum, gap) => sum + gap.minutes, 0);
}

/**
 * 空档卡片上的一句话。
 *
 * 三段用词不同是有意的：家长/老师看到「上课前空 9 小时 30 分钟」才知道
 * 那是「早上还没排课」，而不是「两节课之间的缝」。
 */
export function gapText(gap: DayGap): string {
  if (gap.kind === "head") return `上课前空 ${gap.label}`;
  if (gap.kind === "tail") return `下课后空 ${gap.label}`;
  return `两节课之间空 ${gap.label}`;
}
