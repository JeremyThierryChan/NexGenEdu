/**
 * 后台的日期 / 时间格式化。
 *
 * 集中在一处的原因：今日概览、课程安排、日历都要显示时间，
 * 各自写一遍「补零 + 拼字符串」很容易出现不一致（有的 9:00、有的 09:00）。
 */

/** 日期键：YYYY-MM-DD（本地时区），与 lib/backend/api.ts 的 dateKey 口径一致。 */
export function dateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 「09:30」 */
export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

/** 「09:30–11:00」 */
export function formatTimeRange(startsAt: string, durationMinutes: number): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** 「9月18日」 */
export function formatMonthDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * **月视图的日期格子**：覆盖一整个月的星期一到星期日，含前后补齐的天，总是 7 的倍数。
 *
 * 为什么补齐到整周：月视图是一张"周 × 7"的表 —— 不补齐的话每一行的列对不上星期几
 * （1 号可能是周三，第一行就只有半截），而"哪几天是周末"正是看这张表的第一件事。
 *
 * 为什么**总是从周一开始**：与 `weekDays()` 同一口径（本系统里"一周"从周一开始），
 * 两处不一致的话周视图与月视图会把同一节课画在不同的列上。
 */
export function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = weekDays(first)[0] ?? first;
  const end = weekDays(last)[6] ?? last;

  const days: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor));
  }
  return days;
}

/**
 * 前后翻几个月（月视图的「上一月 / 本月 / 下一月」）。
 *
 * 刻意**锚到当月 1 号**：直接给当前日期加一个月的话，1 月 31 日会变成 3 月 3 日
 * （2 月没有 31 号，`Date` 会往后规整），于是"下一月"跳过了 2 月 —— 这类 bug
 * 只在月末那几天出现，最难被发现。
 */
export function shiftMonths(date: Date, months: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** 这一天是否属于 `anchor` 所在的那个月（月视图里给"隔壁月"的天淡显）。 */
export function isSameMonth(date: Date, anchor: Date): boolean {
  return date.getFullYear() === anchor.getFullYear() && date.getMonth() === anchor.getMonth();
}

/** 「9月18日 周四」；今天 / 明天 / 昨天用相对说法。 */
export function formatDayLabel(value: string | Date, today: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diff = dayDiff(date, today);

  const relative =
    diff === 0 ? "今天" : diff === 1 ? "明天" : diff === -1 ? "昨天" : undefined;
  const weekday = WEEKDAYS[date.getDay()] ?? "";

  return relative !== undefined
    ? `${relative} · ${formatMonthDay(date)} ${weekday}`
    : `${formatMonthDay(date)} ${weekday}`;
}

/** 相差几天（按日历天算，忽略时刻）。 */
export function dayDiff(target: Date, base: Date): number {
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const b = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** 从某天所在周的周一算起，返回 7 天。 */
export function weekDays(anchor: Date): Date[] {
  const start = new Date(anchor);
  // getDay(): 周日是 0，这里以周一为一周起点
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}
