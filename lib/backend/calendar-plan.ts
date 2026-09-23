/**
 * **哪一天适用哪一组上课时段**（纯函数：不读数据库、不读文件、不读时钟）。
 *
 * ## 这一层解决什么（机构 2026-09 定的口径）
 *
 * 机构原先只有一张"按星期几"的时间表（`data/site/schedule.md` → 网站的「课程时间安排」页）：
 * 工作日晚上两节、周末全天六节。但"这一天到底按哪一组"在日历上看不出来，
 * 而三件事会打乱"星期几"这个直觉：
 *
 *   - **法定假日**（国庆 / 春节 / 清明…）机构**照常上课**（假期正是旺季、白天反而能排），
 *     因此这些天按**周末**那一组时段；
 *   - **调休上班日**（某个周六被调成上班日）学生要上学，白天的课排不了 → 按**工作日**那一组；
 *   - **寒暑假**期间每天都上课、时段与周末一样（机构原话：「作息和现在的周末上课时间完全一样」）
 *     → 整段按**周末**那一组。寒暑假的起止**每年手动录入**（不猜、不按农历算），
 *     而且**按学段**分别录（小学与初中放假日期通常接近但不完全相同）。
 *
 * 于是每个日期都归到两组之一：**工作日组** 或 **周末组**。这一份判定是**唯一口径**：
 * 今天日历页用它标「休 / 班 / 寒 / 暑」，将来排课（另行安排）也问它 —— 两处各判一次
 * 必然会出现"日历说能排、排课说不能"。
 *
 * ## 优先级（从高到低），以及为什么
 *
 *   1. **寒暑假段**（该学段的）：整段都是假期作息 —— 注意春节的调休上班日与法定假日**落在寒假里**，
 *      但那时学校已经放假，学生不上学，因此**寒暑假优先于调休与法定假日**；
 *   2. **调休上班日**：按工作日组（这是"调休"这件事唯一的实际影响）；
 *   3. **法定假日**：按周末组（机构照常上课）；
 *   4. 周六 / 周日：周末组；
 *   5. 其余：工作日组。
 *
 * ## 这一版**不改排课**
 *
 * 机构明确「后续的排课再另外安排」：本模块只做判定与展示，`lib/backend/recurrence.ts`
 * 的日期生成一行都不动（它仍然是"按星期几往后数"）。判定结果先摆出来，等排课那一步接。
 */
import type { HolidayDay } from "./holidays";
import type { SiteCopyBlock, VacationPeriod } from "./types";

/** 一天的类别。 */
export type DayKind = "workday" | "weekend" | "holiday" | "makeup" | "vacation";

/** 适用的时段组 —— 全系统只有这两组（就是「课程时间安排」页上那两组）。 */
export type WindowGroup = "工作日" | "周末";

/** 判定结果。 */
export type DayPlan = {
  /** `YYYY-MM-DD`。 */
  date: string;
  kind: DayKind;
  /** 这一天按哪一组时段。 */
  windowGroup: WindowGroup;
  /** 短标记（页面上那一天栏头显示的那一个字）。 */
  badge: string;
  /** 一句话说明（节日名 / 假期段名 / 「调休上班日」这类）。 */
  label: string;
  /** 判定的依据（写清为什么，页面上做 tooltip）。 */
  reason: string;
};

export type CalendarPlanInput = {
  /** 这一年的节假日表；没抓过 / 读不到时给空数组（那就只按星期几判）。 */
  holidays?: readonly HolidayDay[];
  /** 寒暑假段（手动录入）。 */
  vacations?: readonly VacationPeriod[];
  /**
   * 只看某个学段的假期段（页面上选了学段时用）。
   *
   * 不给 = 看全部学段的段（那天只要有**任何一个**学段在假期里就算假期 —— 页面上会写清是哪一段）。
   */
  stageId?: string;
};

/** 一天是星期几（1 = 周一 … 7 = 周日）。解析失败返回 null。 */
function isoWeekdayOf(date: string): number | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (matched === null) return null;
  const at = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  if (Number.isNaN(at.getTime())) return null;
  const day = at.getDay();
  return day === 0 ? 7 : day;
}

/** `YYYY-MM-DD` 是合法的本地日期吗（`2026-02-30` 这种要挡掉）。 */
export function isDateKey(value: string): boolean {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (matched === null) return false;
  const at = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  if (Number.isNaN(at.getTime())) return false;
  // 2 月 30 日会被 Date 规整成 3 月 2 日 —— 回读一次确认没有被规整
  return (
    at.getFullYear() === Number(matched[1]) &&
    at.getMonth() === Number(matched[2]) - 1 &&
    at.getDate() === Number(matched[3])
  );
}

/** 分段名（寒假 / 暑假 / 其他）→ 栏头上的那一个字。 */
function badgeOfVacation(kind: VacationPeriod["kind"]): string {
  if (kind === "寒假") return "寒";
  if (kind === "暑假") return "暑";
  return "假";
}

/** 这一天的假期段（按学段筛；`stageId` 不给就找任意学段的段）。越早开始的优先。 */
export function vacationOn(
  date: string,
  vacations: readonly VacationPeriod[],
  stageId?: string,
): VacationPeriod | null {
  const hits = vacations.filter((item) => {
    if (date < item.startDate || date > item.endDate) return false;
    if (stageId === undefined || stageId === "") return true;
    return item.stageIds.includes(stageId);
  });
  if (hits.length === 0) return null;
  return [...hits].sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
}

/**
 * 判定某一天适用哪一组时段（**唯一口径**）。
 *
 * 节假日表按年份给（`data/holidays/<年>.json` 是一年一份），因此调用方给的是**那一年**的表；
 * 给空数组也能跑 —— 那就退回"按星期几"判（与今天的行为一致）。
 */
export function dayPlanFor(date: string, input: CalendarPlanInput = {}): DayPlan {
  const weekday = isoWeekdayOf(date);
  const weekend = weekday !== null && weekday >= 6;

  const vacation = vacationOn(date, input.vacations ?? [], input.stageId);
  if (vacation !== null) {
    return {
      date,
      kind: "vacation",
      windowGroup: "周末",
      badge: badgeOfVacation(vacation.kind),
      label: `${vacation.name}（${vacation.startDate} 起）`,
      reason: `落在${vacation.name}里：寒暑假按周末那一组时段（机构口径：作息与周末相同）`,
    };
  }

  const holiday = (input.holidays ?? []).find((item) => item.date === date);
  if (holiday !== undefined && holiday.kind === "调休上班") {
    return {
      date,
      kind: "makeup",
      windowGroup: "工作日",
      badge: "班",
      label: `${holiday.name}调休上班`,
      reason: "调休上班日：学生要上学，按工作日那一组时段（白天排不了）",
    };
  }
  if (holiday !== undefined) {
    return {
      date,
      kind: "holiday",
      windowGroup: "周末",
      badge: "休",
      label: holiday.name,
      reason: "法定假日：机构照常上课，按周末那一组时段（白天可以排）",
    };
  }

  if (weekend) {
    return { date, kind: "weekend", windowGroup: "周末", badge: "周末", label: "周末", reason: "周末按周末那一组时段" };
  }
  return {
    date,
    kind: "workday",
    windowGroup: "工作日",
    badge: "工作日",
    label: "工作日",
    reason: "学期内的工作日：放学后与晚上",
  };
}

/* ── 时段：从「课程时间安排」那两组里读 ────────────────────────────────────────
 *
 * 为什么不另建一套"作息配置"：机构原话是「作息和现在的周末上课时间完全一样」——
 * 那两组时段**已经**在「网站内容 → 时间安排」里维护着，再造一份必然与网站上公布的漂开
 * （家长看到的时间与排课用的时间不一致，是最难解释的一类错）。因此这里只做**解析**：
 * 从那一块文案里读出「工作日」「周末」两组的具体时段。
 *
 * 组名是人写的（可能被改成「双休日」），所以按关键字匹配并要求**排课/上课**语义；
 * 读不出来时返回 `missing`，页面上明说"去「网站内容 → 时间安排」确认组名" ——
 * 静默返回空时段的后果是"这一天看着能排、实际没有任何可选时段"，那更难查。
 */

/** 一个可排时段。 */
export type ScheduleWindow = {
  /** 条目标题（「晚第一节」「第三节」）。 */
  label: string;
  /** `HH:mm`。 */
  start: string;
  /** `HH:mm`。 */
  end: string;
  /** 原始文本（页面上按原样显示，例如「08:00–10:00」）。 */
  raw: string;
};

export type WindowLookup = {
  group: WindowGroup;
  /** 命中的分组标题（读不到时是空串）。 */
  groupTitle: string;
  windows: ScheduleWindow[];
  /** 没找到那一组（或一组里没有一个能解析的时段）时为 true。 */
  missing: boolean;
};

const TIME_RANGE = /(\d{1,2}:\d{2})\s*[–—~-]\s*(\d{1,2}:\d{2})/;

/**
 * 这一组该匹配哪一个分组标题。
 *
 * 「工作日排课」要匹配，但「全日托」里的「工作日 | 08:00–17:00」不该被当成排课时段 ——
 * 因此要求标题里含「排课」或「上课」，且**不含**「辅导」「托」（那两组是服务时段，不是排课时段）。
 */
function groupMatches(title: string, group: WindowGroup): boolean {
  const text = title.trim();
  if (text.includes("辅导") || text.includes("托")) return false;
  if (!text.includes("排课") && !text.includes("上课")) return false;
  return group === "工作日" ? text.includes("工作日") : text.includes("周末") || text.includes("双休");
}

/** 从「课程时间安排」那一块里读出某个时段的组。 */
export function windowsFromSchedule(
  block: Pick<SiteCopyBlock, "groups"> | null | undefined,
  group: WindowGroup,
): WindowLookup {
  const found = (block?.groups ?? []).find((item) => groupMatches(item.title, group));
  if (found === undefined) return { group, groupTitle: "", windows: [], missing: true };

  const windows: ScheduleWindow[] = [];
  for (const item of found.items) {
    const matched = TIME_RANGE.exec(item.value);
    if (matched === null) continue;
    windows.push({
      label: item.title.trim(),
      start: matched[1] ?? "",
      end: matched[2] ?? "",
      raw: item.value.trim(),
    });
  }
  return { group, groupTitle: found.title, windows, missing: windows.length === 0 };
}

/* ── 寒暑假段：校验与重叠提示 ──────────────────────────────────────────────── */

/**
 * 校验寒暑假段（`vacations.save` 的闸门）。
 *
 * 规则与代价：
 *   - 名字非空、起止日期是合法日期、`start <= end`（写反了会变成"永远不在假期里"，
 *     而页面上看不出问题）；
 *   - 至少勾一个**存在的**学段（机构口径：寒暑假按学段录；不勾学段等于"所有学段"，
 *     那样小学与初中不同的放假日期就没法分开录）；
 *   - 同一个学段的两段**允许重叠**（国庆集训常常套在暑假里），但会由
 *     `vacationOverlaps` 单独提示 —— 不当作错误拦下来。
 */
export function validateVacations(
  rows: readonly VacationPeriod[],
  catalog: { stages: Array<{ id: string; name: string }> },
): string[] {
  const problems: string[] = [];
  const stageIds = new Set(catalog.stages.map((item) => item.id));
  const seen = new Set<string>();

  for (const row of rows) {
    const label = row.name.trim() === "" ? "有一段寒暑假没有名字" : `寒暑假段「${row.name}」`;
    if (row.name.trim() === "") problems.push("有一段寒暑假没有名字。");
    if (row.id.trim() === "") problems.push(`${label}没有 id。`);

    if (!isDateKey(row.startDate) || !isDateKey(row.endDate)) {
      problems.push(`${label}的起止日期不是合法日期（要 YYYY-MM-DD 这种写法）。`);
    } else if (row.startDate > row.endDate) {
      problems.push(`${label}的结束日期早于开始日期。`);
    }

    if (row.stageIds.length === 0) problems.push(`${label}没有勾学段（至少勾一个）。`);
    for (const id of row.stageIds) {
      if (!stageIds.has(id)) problems.push(`${label}引用了一个不存在的学段。`);
    }

    if (seen.has(row.id)) problems.push(`${label}出现了两次（同一段只能有一行）。`);
    seen.add(row.id);
  }

  return problems;
}

/**
 * 同一条学段上重叠的两段（**提示**，不是错误）。
 *
 * 为什么只是提示：国庆集训套在暑假里、寒假里再插一段春节集训都是正常安排；
 * 但两段重叠时"这一天到底算哪一段"就有两说（页面上会按最早开始的那一段显示），
 * 因此要说出来让人确认一眼。
 */
export function vacationOverlaps(rows: readonly VacationPeriod[]): string[] {
  const notes: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a === undefined || b === undefined) continue;
      if (!a.stageIds.some((id) => b.stageIds.includes(id))) continue;
      if (a.startDate <= b.endDate && b.startDate <= a.endDate) {
        notes.push(`「${a.name}」（${a.startDate}–${a.endDate}）与「${b.name}」（${b.startDate}–${b.endDate}）有重叠。`);
      }
    }
  }
  return notes;
}

/** 某一年里的假期段（跨年的段按"落在这一年里"算）。 */
export function vacationsInYear(rows: readonly VacationPeriod[], year: number): VacationPeriod[] {
  const from = `${String(year)}-01-01`;
  const to = `${String(year)}-12-31`;
  return rows.filter((item) => item.startDate <= to && item.endDate >= from);
}
