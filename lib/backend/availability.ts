import type { ClassroomAvailability } from "./types";

/**
 * 教室可用时段相关的小工具。
 *
 * 单独成文件的原因：这里有明确的边界规则（跨天、相邻、星期换算），
 * 排课表单与自检都要用同一套判断，不能各写一份。
 */

/** JS 的 getDay()：0=周日 … 6=周六；这里换算成 1=周一 … 7=周日。 */
export function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** 「HH:MM」→ 当天的分钟数；无效格式返回 null。 */
export function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 星期几的中文简称，用于展示与表单。 */
export const WEEKDAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 7, label: "日" },
];

/**
 * 某节课是否落在教室的可用时段内。
 *
 * 规则（与排课表单的提示保持一致）：
 * - 教室没有设置任何可用时段 → 视为**不限**，永远返回 true；
 * - 否则该节课必须**完整落在某一行**时段内（星期匹配、开始不早于、结束不晚于）；
 * - 一行时段若结束时间不晚于开始时间，视为无效行，不匹配任何课
 *   （跨天时段不支持：机构的教室不会用到凌晨）。
 */
export function isWithinAvailability(
  availability: ClassroomAvailability[],
  startsAt: Date,
  durationMinutes: number,
): boolean {
  if (availability.length === 0) return true;

  const weekday = isoWeekday(startsAt);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = startMinutes + durationMinutes;

  return availability.some((row) => {
    if (!row.weekdays.includes(weekday)) return false;
    const rowStart = toMinutes(row.start);
    const rowEnd = toMinutes(row.end);
    if (rowStart === null || rowEnd === null || rowEnd <= rowStart) return false;
    return startMinutes >= rowStart && endMinutes <= rowEnd;
  });
}

/** 可用时段的中文摘要，例如「周一–周五 17:00–21:00；周六 08:00–20:00」。 */
export function describeAvailability(availability: ClassroomAvailability[]): string {
  if (availability.length === 0) return "不限时段";

  return availability
    .map((row) => {
      const days = [...row.weekdays].sort((a, b) => a - b);
      return `${describeWeekdays(days)} ${row.start}–${row.end}`;
    })
    .join("；");
}

/** 把 [1,2,3,4,5] 压成「周一–周五」；不连续时逐个列出。 */
export function describeWeekdays(days: number[]): string {
  if (days.length === 0) return "未选星期";
  if (days.length === 7) return "每天";

  const label = (value: number) =>
    `周${WEEKDAY_LABELS.find((item) => item.value === value)?.label ?? value}`;

  const isConsecutive = days.every((value, index) => index === 0 || value === (days[index - 1] ?? 0) + 1);
  if (isConsecutive && days.length >= 3) {
    return `${label(days[0] ?? 1)}–${label(days[days.length - 1] ?? 7)}`;
  }
  return days.map(label).join("、");
}
