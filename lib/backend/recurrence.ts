/**
 * **按周批量排课**的日期生成（纯函数，可测）。
 *
 * ## 它解决什么
 *
 * 学生报了 20 节、每周二 17:00 上课 —— 以前要一节一节点二十次。这个模块负责把
 * "每周二、五 17:00，先来 20 节"翻译成一串具体的日期时间，剩下的交给排课的冲突判定。
 *
 * ## 刻意的边界（写清楚，免得期待落空）
 *
 * - **不处理调休、节假日、寒暑假**：就是"按星期几往后数"，数满为止。
 *   机构确认这类情况**手动处理**（挪课 / 补课都有现成入口），
 *   因此这里不做一张"停课日历" —— 做了反而要人去维护它，容易忘。
 * - **不猜什么时候该停**：`count` 由调用方给（界面上默认填"该科目剩余课时 − 已排未上"）。
 * - **时间用本地时区构造**：与全站一致（`new Date(y, m, d, hh, mm)`），
 *   因此"每周二 17:00"在夏令时切换的那一周也不会漂成 16:00 或 18:00。
 */

export type RecurrenceSpec = {
  /** 起排日期（本地日期 `YYYY-MM-DD`）。当天符合星期几就会排上。 */
  startDate: string;
  /** 每周几：1 = 周一 … 7 = 周日。空数组会生成 0 节（调用方负责提示）。 */
  weekdays: number[];
  /** 开始时间 `HH:mm`。 */
  time: string;
  /** 要排几节。 */
  count: number;
};

/** 一次批量排课的节数上限：防手滑（例如想填 20 打成 2000）。 */
export const MAX_SERIES_LESSONS = 200;

/**
 * 往后找多少天就放弃。
 *
 * 按"要几节就最多看几周"来算（每周最多命中 7 次，因此 `count * 7` 天足够），
 * 再加一周余量。这里的教训：原先写死 1100 天（约 3 年），而**上限是 200 节、
 * 每周一节就要 1400 天** —— 于是"填 200 节"实际只生成 157 节，静默少了 43 节。
 * 上限与搜索范围必须对得上，否则限制会变成"悄悄少排"。
 */
function horizonDays(wantedCount: number): number {
  return wantedCount * 7 + 7;
}

/** `YYYY-MM-DD`（本地）→ 年月日；解析失败返回 null。 */
function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (matched === null) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** `HH:mm` → 时与分；解析失败返回 null。 */
function parseTime(value: string): { hour: number; minute: number } | null {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (matched === null) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * 生成一串具体的开课时间（ISO 字符串，本地时区）。
 *
 * 规则：从 `startDate`（含）起逐天往后看，星期几命中 `weekdays` 就产出一节，
 * 直到凑够 `count` 节；`count` 超过上限会被截断到上限。
 */
export function generateSeriesDates(spec: RecurrenceSpec): string[] {
  const start = parseLocalDate(spec.startDate);
  const time = parseTime(spec.time);
  if (start === null || time === null) return [];

  const wanted = new Set(spec.weekdays.filter((day) => day >= 1 && day <= 7));
  if (wanted.size === 0) return [];

  const wantedCount = Math.min(Math.max(0, Math.trunc(spec.count)), MAX_SERIES_LESSONS);
  if (wantedCount === 0) return [];

  const dates: string[] = [];
  const cursor = new Date(start.year, start.month - 1, start.day, time.hour, time.minute, 0, 0);

  for (let step = 0; step < horizonDays(wantedCount) && dates.length < wantedCount; step += 1) {
    // JS 的 getDay()：0 = 周日 … 6 = 周六；这里统一成 1 = 周一 … 7 = 周日
    const isoWeekday = cursor.getDay() === 0 ? 7 : cursor.getDay();
    if (wanted.has(isoWeekday)) dates.push(new Date(cursor).toISOString());
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

/** 星期几的中文名。 */
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 一个 ISO 时间 → 「9月23日 周二」这样的人话（预览里逐节显示）。 */
export function describeSeriesDate(iso: string): string {
  const at = new Date(iso);
  const weekday = WEEKDAY_LABELS[(at.getDay() === 0 ? 7 : at.getDay()) - 1] ?? "";
  const hh = `${at.getHours()}`.padStart(2, "0");
  const mm = `${at.getMinutes()}`.padStart(2, "0");
  return `${at.getMonth() + 1}月${at.getDate()}日 ${weekday} ${hh}:${mm}`;
}
