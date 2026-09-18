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
