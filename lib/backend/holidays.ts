import { WEEKDAY_LABELS, isoWeekday } from "./availability";

/**
 * **法定节假日与调休上班日**的年度表：解析、双源交叉校验、汇总。
 *
 * ## 这个模块解决什么（以及刻意不解决什么）
 *
 * 机构要"知道哪天是法定假日、哪天是调休上班日"。这张表就是那份数据：
 * 一年一份，每天标一件事 —— **放假**（法定假日）还是**调休上班**（周末被调成工作日）。
 *
 * **它固定不改排课**：`lib/backend/recurrence.ts` 的"按星期几往后数"、
 * `isWithinAvailability` 的"按星期几判教室可用"，这一版**一行都不动**。
 * 于是"调休与节假日请手动处理"那句仍然成立（写在 `recurrence.ts`、
 * `LessonSeriesForm.tsx`、`docs/使用手册.md`、`docs/后台API约定.md` 四处）。
 * 这张表的作用是**让人看着它手动处理**，而不是让排课自动跳过 ——
 * 那种自动化要先把"假期到底是上课还是停课"定下来（机构还在定），
 * 半截做了反而更危险：排课会静默地少排或排错。
 *
 * ## 为什么要有"交叉校验"（本模块存在的主要理由）
 *
 * 这种数据错了会直接影响排课与家长沟通，而它一年只更新一两次、没人会去逐日核对。
 * 所以**两个独立来源必须对得上才允许写入**：
 *
 *   - `apple`：Apple 的 `中国大陆节假日` 日历（`calendars.icloud.com/holidays/cn_zh.ics`），
 *     带机器可读标记 `X-APPLE-SPECIAL-DAY:WORK-HOLIDAY`（放假）/ `ALTERNATE-WORKDAY`（调休）；
 *   - `gov`：国务院办公厅通知的 JSON（`NateScarlet/holiday-cn`，自动抓 gov.cn 公告）。
 *
 * 两个源都是"人工维护的公开数据"，都可能出错；但它们**错法不同**（一个 Apple 自己维护、
 * 一个抓政府公告），所以"两边逐日一致"是很强的证据。不一致时**拒绝写入**并列出差异，
 * 由人去查公告 —— 宁可这次没导进来（界面上会显示"缺哪一年"），也不要静默用错数据排课。
 *
 * ## 口径差异不是数据打架（这条判据很要紧）
 *
 * 实测 2024 年：Apple 把 `2024-06-08`、`2024-06-09` 也标成"休"，而国务院口径只列
 * `2024-06-10`（端午）。这不是谁错了 —— **Apple 把假期块里正好落在周六周日的那两天一起标**，
 * 而国务院口径只列"法定安排日"（周末本来就是周末，不必列）。
 * 所以校验规则是**不对称**的，而不是"两边必须一模一样"：
 *
 *   - **调休上班日：必须完全一致**（这一项没有口径差异的余地）；
 *   - **放假：国务院列出的每一天都必须在 Apple 那份里**（少一天就是真缺）；
 *   - **Apple 多出来的每一天都必须是周六或周日**（否则就是真多）——
 *     这条把"口径差异"与"数据错误"严格分开了，不用人去肉眼判断。
 */

/** 两种日历类型。用中文而不是 `off`/`work`：它直接出现在界面与错误信息里。 */
export type HolidayKind = "放假" | "调休上班";

/** 一天。`date` 一律是本地日历日的 `YYYY-MM-DD`（与全站一致，不用 UTC 字符串）。 */
export type HolidayDay = {
  date: string;
  /** 节日名（元旦 / 春节 / 清明 / 劳动节 / 端午 / 中秋 / 国庆）。 */
  name: string;
  kind: HolidayKind;
};

/** 数据源标识。`apple` = Apple 日历 ics；`gov` = 国务院通知口径的 JSON。 */
export type HolidaySourceId = "apple" | "gov";

/** 一次抓取的留痕：来源、是否成功、那天拿到了多少天、内容指纹。 */
export type HolidaySourceRecord = {
  id: HolidaySourceId;
  label: string;
  url: string;
  ok: boolean;
  /** 这一年从该源解析出的天数（两个源对不上时，这个数字就是第一手线索）。 */
  days: number;
  /** 内容指纹（`sha256:…`，由服务端算；界面用它看"这份数据是不是换了"）。 */
  fingerprint: string;
  /** 失败原因或说明（成功且无话可说时是空串）。 */
  note: string;
};

/** 交叉校验的结论。 */
export type HolidayVerdict = {
  /** `true` 才允许写入。 */
  agree: boolean;
  /** 拒绝写入的理由（空数组 = 没问题）。每条都要能让人去查公告。 */
  blocking: string[];
  /** 说明性差异（不阻断写入，例如"多出来的都是周末，属口径差异"）。 */
  notes: string[];
  /**
   * 两个来源都空 = **这一年的安排还没公布**。
   *
   * 单独一个布尔而不是让调用方去匹配错误文字：这两种结局要做的事完全不同 ——
   * "还没公布"是**正常**的（每年 11 月之前都是这样，命令行不该报错退出、
   * 界面该显示一句说明），"对不上"是**要人去查公告**的告警。
   * 用文字判断的话，以后改一句文案就会让命令行在正常年份里报错退出。
   */
  notPublished: boolean;
};

/** 一年一份的假日表（就是 `data/holidays/<年>.json` 的内容）。 */
export type HolidayYear = {
  year: number;
  /** 抓取时间（ISO 字符串，由服务端写）。 */
  fetchedAt: string;
  sources: HolidaySourceRecord[];
  verdict: HolidayVerdict;
  /** 按日期升序。 */
  days: HolidayDay[];
};

/**
 * 解析结果：**失败必须明说**，不能返回空表让人以为"这一年没有假期"。
 *
 * 那"这一年还没公布"怎么办？—— 它不是失败，是 `ok: true` + `days: []` + `note` 说明，
 * 由**交叉校验**去分辨两种情形：两个源都空 = 还没公布（正常）；
 * 只有一个源空 = 那个源坏了或抓错了（拒绝写入）。把这个判断放在校验里、
 * 而不是让解析器去猜，是因为"两边是不是一致"这件事只有校验器同时看得到两份数据。
 */
export type HolidayParseResult =
  | { ok: true; days: HolidayDay[]; note: string }
  | { ok: false; error: string };

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 一段假期 / 一次导入最多能有多少天。
 *
 * 两条都是"防坏数据"而不是业务上限：实测一年 33 天放假、最长连休 9 天，
 * 而放假块跨过一个月、一年列出几百天，都只可能是数据写错或解析读错字段。
 * 那种数据**必须明确报错**：静默展开出来的是几十天凭空多出来的"假期"，
 * 界面上完全看不出问题，而排课会照着它走。
 */
const MAX_BLOCK_DAYS = 60;
const MAX_DAYS_PER_YEAR = 400;

/** `start` 到 `end` 相差几天（`end` 排他，所以 2/15→2/24 是 9 天）。 */
function daySpan(start: string, end: string): number {
  const from = parseDateKey(start);
  const to = parseDateKey(end);
  if (from === null || to === null) return 0;
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / 86_400_000);
}

/** `YYYY-MM-DD` → 本地日期对象；格式不对或不是真实存在的日期返回 `null`。 */
export function parseDateKey(key: string): Date | null {
  const match = DATE_KEY.exec(key.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // `new Date(2026, 1, 30)` 会滚到 3 月 2 日 —— 必须回头核对，否则"2026-02-30"会被悄悄接受
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** 本地日期 → `YYYY-MM-DD`。 */
export function toDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 这一天是周几（1 = 周一 … 7 = 周日）；日期不合法返回 `null`。 */
export function holidayWeekday(date: string): number | null {
  const parsed = parseDateKey(date);
  return parsed === null ? null : isoWeekday(parsed);
}

/** 「2026-02-15」→「周日」；日期不合法返回空串（界面自己决定怎么显示空值）。 */
export function holidayWeekdayLabel(date: string): string {
  const weekday = holidayWeekday(date);
  if (weekday === null) return "";
  return `周${WEEKDAY_LABELS.find((item) => item.value === weekday)?.label ?? weekday}`;
}

/** 这一天是不是周六或周日（校验"多出来的是不是周末"要用）。 */
export function isWeekendDate(date: string): boolean {
  const weekday = holidayWeekday(date);
  return weekday === 6 || weekday === 7;
}

// ── Apple 的 ics ───────────────────────────────────────────────────────────────

/**
 * 从 Apple 那份 ics 里解析出**这一年**的放假 / 调休日。
 *
 * ## 为什么必须按 `X-APPLE-SPECIAL-DAY` 过滤，而不是按名字猜
 *
 * 那份 ics 里有 246 个事件，其中**只有 40 个**是放假或调休，其余是 24 节气
 * （小寒、大寒、立春…）与固定节日（妇女节、儿童节、建党节…），还有带 `RRULE` 的
 * "节日当天"重复标记。按名字猜一定会把「小寒」当成放假日。
 *
 * 过滤条件是**两个互相印证的判据**：标记（`X-APPLE-SPECIAL-DAY`）与名字后缀
 * （`（休）` / `（班）`）。实测两者一一对应；**一旦对不上就报错拒绝**而不是挑一个信 ——
 * 那说明 Apple 改了约定，这时"少一天假"比"报错"危险得多。
 *
 * ## 其他几个必须处理的细节
 *
 *   - **CRLF**：那份文件是 `\r\n` 行尾；
 *   - **折行**：iCalendar 规定长行可以折（续行以空格开头），这里先展开；
 *   - **`DTEND` 是排他的**：`DTSTART 20260215` + `DTEND 20260224` 是 2/15–2/23 共 9 天，
 *     不是 10 天；
 *   - **没有 `DTEND` = 单日**（调休日与部分单日假期就是这样）；
 *   - **带 `RRULE` 的放假事件**：实测没有，但真出现就必须拒绝 —— 那种事件要按规则展开，
 *     这里没有展开它的能力，悄悄漏掉就等于少了一整段假期。
 */
export function parseAppleHolidays(text: string, year: number): HolidayParseResult {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const blocks = normalized.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  if (blocks === null || blocks.length === 0) {
    return { ok: false, error: "Apple 日历里没有解析出任何事件（文件格式变了？先人工看一眼再导入）。" };
  }

  const days: HolidayDay[] = [];
  for (const block of blocks) {
    const marker = propertyValue(block, "X-APPLE-SPECIAL-DAY");
    if (marker !== "WORK-HOLIDAY" && marker !== "ALTERNATE-WORKDAY") continue;

    const summary = propertyValue(block, "SUMMARY");
    const suffixOff = summary.includes("（休）");
    const suffixWork = summary.includes("（班）");
    const expectOff = marker === "WORK-HOLIDAY";
    /*
     * 两个判据必须同时成立：是放假就得带（休）且**不带**（班），是调休就得反过来。
     * 写成显式的两个条件（而不是让读者自己去算布尔代数）—— 这里判错的后果是
     * "把调休日当成放假日"，而它在界面上看起来完全正常。
     */
    const consistent = expectOff ? suffixOff && !suffixWork : suffixWork && !suffixOff;
    if (!consistent) {
      return {
        ok: false,
        error:
          `Apple 日历的事件「${summary}」自相矛盾：标记是 ${marker}、名字后缀是` +
          `${suffixOff ? "（休）" : suffixWork ? "（班）" : "（无）"}。` +
          "两个判据必须一致（实测一直是），对不上说明 Apple 改了约定 —— 请人工核对后再导入。",
      };
    }
    if (propertyValue(block, "RRULE") !== "") {
      return {
        ok: false,
        error:
          `Apple 日历的放假事件「${summary}」带了重复规则（RRULE），本模块不会展开它 ——` +
          "展开不了却照常导入，等于少掉一整段假期。请人工核对。",
      };
    }

    const start = datePropertyValue(block, "DTSTART");
    if (start === null) {
      return { ok: false, error: `Apple 日历的事件「${summary}」没有可读的开始日期。` };
    }
    const endRaw = datePropertyValue(block, "DTEND");
    const end = endRaw ?? nextDayKey(start);
    if (end <= start) {
      return { ok: false, error: `Apple 日历的事件「${summary}」的结束日期不晚于开始日期（${start}…${end}）。` };
    }
    if (!start.startsWith(`${year}`) && !end.startsWith(`${year}`)) continue;

    const kind: HolidayKind = expectOff ? "放假" : "调休上班";
    const name = summary.replace(/（休）|（班）/g, "").trim() || "未命名";
    /*
     * 一段假期不可能长过一个月（实测最长 9 天）。超过就说明数据坏了（时间写错、或者我们
     * 把某个字段读成了日期），这时**必须报错**而不是照常展开 —— 展开出来的是几十天
     * 平白多出来的"假期"，而界面上看不出来。
     */
    const span = daySpan(start, end);
    if (span > MAX_BLOCK_DAYS) {
      return {
        ok: false,
        error:
          `Apple 日历的事件「${summary}」跨了 ${span} 天（${start}…${end}），` +
          `一段假期不可能这么长（上限 ${MAX_BLOCK_DAYS} 天）—— 请人工核对这份日历。`,
      };
    }
    for (const date of dateRangeKeys(start, end)) {
      if (!date.startsWith(`${year}`)) continue;
      days.push({ date, name, kind });
    }
  }

  return {
    ok: true,
    days: normalizeDays(days),
    note:
      days.length === 0
        ? `${year} 年在这份日历里没有任何放假或调休标记（未公布，或 Apple 改了标记约定）。`
        : "",
  };
}

/** ics 里除 `DTSTART`/`DTEND` 外的属性值（`NAME;PARAM=x:VALUE` → `VALUE`）。 */
function propertyValue(block: string, name: string): string {
  const match = new RegExp(`^${name}(?:;[^:\\n]*)?:([^\\n]*)`, "m").exec(block);
  return match?.[1]?.trim() ?? "";
}

/** `DTSTART;VALUE=DATE:20260215` → `2026-02-15`（只认日期形式，带时间的返回 `null`）。 */
function datePropertyValue(block: string, name: string): string | null {
  const raw = propertyValue(block, name);
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (match === null) return null;
  const key = `${match[1]}-${match[2]}-${match[3]}`;
  return parseDateKey(key) === null ? null : key;
}

/** `2026-02-15` → `2026-02-16`（`DTEND` 排他时，缺省的单日结束）。 */
function nextDayKey(key: string): string {
  const date = parseDateKey(key);
  if (date === null) return key;
  return toDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
}

/** `[start, end)` 里的每一天。 */
function dateRangeKeys(start: string, end: string): string[] {
  const from = parseDateKey(start);
  if (from === null) return [];
  const out: string[] = [];
  const guard = MAX_DAYS_PER_YEAR; // 上游已按 MAX_BLOCK_DAYS 拦过；这里是防死循环的最后一道
  for (let index = 0; index < guard; index += 1) {
    const key = toDateKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + index));
    if (key >= end) break;
    out.push(key);
  }
  return out;
}

// ── 国务院通知口径的 JSON ───────────────────────────────────────────────────────

/**
 * 从 `holiday-cn` 那种 JSON 里解析出这一年的放假 / 调休日。
 *
 * 形状（实测）：
 *
 * ```json
 * { "year": 2026, "papers": ["https://www.gov.cn/…"], "days": [
 *   { "name": "元旦", "date": "2026-01-01", "isOffDay": true },
 *   { "name": "元旦", "date": "2026-01-04", "isOffDay": false } ] }
 * ```
 *
 * 与 Apple 那份的关键差异：**它只列"法定安排日"**，假期块里正好落在周六周日的那几天
 * 不列（周末本来就是周末）。这正是不对称校验规则的由来（见文件头）。
 */
export function parseGovHolidays(text: string, year: number): HolidayParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { ok: false, error: `国务院口径的数据不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "国务院口径的数据不是对象（格式变了？先人工看一眼）。" };
  }
  const { year: rawYear, days: rawDays } = parsed as { year?: unknown; days?: unknown };
  if (typeof rawYear === "number" && rawYear !== year) {
    return { ok: false, error: `要的是 ${year} 年，这份数据是 ${rawYear} 年。` };
  }
  if (!Array.isArray(rawDays)) {
    return { ok: false, error: "国务院口径的数据里没有 days 数组（格式变了？先人工看一眼）。" };
  }
  if (rawDays.length === 0) {
    /*
     * 空数组 = **这一年的安排还没公布**（实测 2027 年那份就是 `"days": []`、`"papers": []`），
     * 不是错误。它是不是"真的还没公布"由交叉校验判断：另一个源有数据时，
     * 那份空表会被判成"这个源坏了"并拒绝写入。
     */
    return {
      ok: true,
      days: [],
      note: `${year} 年的安排还没有公布（数据源里 days 是空的）。国务院通常在上一年 11 月公布。`,
    };
  }

  const days: HolidayDay[] = [];
  for (const item of rawDays) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, error: "国务院口径的数据里有一条不是对象。" };
    }
    const { name, date, isOffDay } = item as { name?: unknown; date?: unknown; isOffDay?: unknown };
    if (typeof date !== "string" || parseDateKey(date) === null) {
      return { ok: false, error: `国务院口径的数据里有一个日期读不出来：${JSON.stringify(date)}` };
    }
    if (typeof isOffDay !== "boolean") {
      return { ok: false, error: `国务院口径的数据里 ${date} 缺 isOffDay（不知道是放假还是调休）。` };
    }
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: `国务院口径的数据里 ${date} 没有节日名。` };
    }
    days.push({ date, name: name.trim(), kind: isOffDay ? "放假" : "调休上班" });
    if (days.length > MAX_DAYS_PER_YEAR) {
      return {
        ok: false,
        error: `国务院口径的数据里 ${year} 年列了超过 ${MAX_DAYS_PER_YEAR} 天（明显不对）—— 请人工核对。`,
      };
    }
  }
  return { ok: true, days: normalizeDays(days), note: "" };
}

// ── 交叉校验 ───────────────────────────────────────────────────────────────────

/**
 * 合并成"每天一条"：按 `(日期, 类型)` 去重，**同一天的两个节日名合起来**。
 *
 * ## 为什么不能按"日期 + 类型 + 名字"去重（这是真实数据逼出来的）
 *
 * 2025-10-06 既是国庆假期、又是中秋（那年两个假期连在一起），Apple 那份里有**两个事件**
 * 覆盖这一天。按名字去重的话这一天会出现两次，于是：
 *   - "放假多少天"多数一天（29 而不是 28）；
 *   - 连休块会**互相重叠**（"国庆 10/1–10/6" 与 "中秋 10/6–10/8" 两段都算），
 *     而"到底连休几天"正是排课与家长沟通最需要看准的数字。
 *
 * 所以口径定成：**一天一条**，名字用「、」连起来（`2025-10-06` → 「国庆节、中秋节」）。
 * 界面上因此不会出现同一天列两行、也不会出现两段重叠的连休。
 *
 * 排序按日期升序；同一天的多个来源/事件里，**先出现的名字排前面**
 * （调用方按"Apple 在前、国务院口径在后"拼，于是名字口径以 Apple 为准）。
 */
export function mergeHolidayDays(days: HolidayDay[]): HolidayDay[] {
  const merged = new Map<string, HolidayDay>();
  for (const day of [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const key = `${day.date}|${day.kind}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, { ...day });
      continue;
    }
    for (const name of day.name.split("、")) {
      if (name !== "" && !existing.name.split("、").includes(name)) {
        existing.name = `${existing.name}、${name}`;
      }
    }
  }
  return [...merged.values()];
}

/** 内部别名：解析器里那几处用的就是同一件事（只有一处实现）。 */
const normalizeDays = mergeHolidayDays;

/**
 * 把两个来源的逐日表合起来：**以第一个来源为准**，第二个只补基准里没有的 `(日期, 类型)`。
 *
 * ## 为什么名字不做跨来源合并（真实数据逼出来的）
 *
 * 跨来源合并名字会造出「清明、清明节」这种废话 —— 实测两个来源对同一个节的叫法不同：
 * Apple 写「清明」、国务院口径写「清明节」。合起来既难看又没多出任何信息。
 * 反过来，**同一份数据内部**的两条事件确实要合（2025-10-06 在 Apple 那份里既是国庆、又是中秋），
 * 那种合并由 `mergeHolidayDays` 负责。
 *
 * 于是口径定成：
 *   - 同一天在**一份数据里**出现多次 → 名字用「、」连起来（真有两个节日）；
 *   - 同一天在**两个来源里**都有 → 用第一个来源的名字（实测国务院那份是 Apple 的子集，
 *     所以这条实际上只在"将来校验规则放宽"时有意义 —— 但那时它必须有个明确行为）。
 */
export function combineHolidaySources(first: HolidayDay[], second: HolidayDay[]): HolidayDay[] {
  const byKey = new Map<string, HolidayDay>();
  for (const day of mergeHolidayDays(first)) byKey.set(`${day.date}|${day.kind}`, day);
  for (const day of mergeHolidayDays(second)) {
    const key = `${day.date}|${day.kind}`;
    if (!byKey.has(key)) byKey.set(key, day);
  }
  return [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 取某一天在某一类型下的集合。 */
function kindSet(days: HolidayDay[], kind: HolidayKind): Set<string> {
  return new Set(days.filter((day) => day.kind === kind).map((day) => day.date));
}

/** 两个集合的差集（`a` 里有、`b` 里没有），升序。 */
function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((item) => !b.has(item)).sort();
}

/**
 * 两个来源能不能互证。**规则是不对称的**（理由见文件头：2024 年端午那两天是口径差异）：
 *
 *   1. 两个源都不能是空的（空 = 数据没发布或抓取坏了）；
 *   2. **调休上班日必须完全一致**；
 *   3. **国务院列的放假日，Apple 那份必须都有**；
 *   4. **Apple 多出来的放假日，必须全都是周六或周日**（否则是真多）；
 *   5. 任一份里同一天不能既"放假"又"调休上班"（自相矛盾）。
 */
export function checkHolidaySources(apple: HolidayDay[], gov: HolidayDay[]): HolidayVerdict {
  const blocking: string[] = [];
  const notes: string[] = [];

  if (apple.length === 0 && gov.length === 0) {
    blocking.push(
      "两个来源都没有这一年的数据。国务院通常在上一年 11 月公布安排，" +
        "公布前没有数据是正常的 —— 不要把它当成「全年无假期」。",
    );
    return { agree: false, blocking, notes, notPublished: true };
  }
  if (apple.length === 0) blocking.push("Apple 日历那份里这一年一天都没有（另一个源有数据，说明不是没发布）。");
  if (gov.length === 0) blocking.push("国务院口径那份里这一年一天都没有（另一个源有数据，说明不是没发布）。");
  if (blocking.length > 0) return { agree: false, blocking, notes, notPublished: false };

  for (const [label, days] of [
    ["Apple 日历", apple],
    ["国务院口径", gov],
  ] as const) {
    const both = days.filter((day) => day.kind === "放假").map((day) => day.date)
      .filter((date) => days.some((day) => day.date === date && day.kind === "调休上班"));
    if (both.length > 0) blocking.push(`${label}里这几天既算放假又算调休上班：${both.join("、")}。`);
  }

  const appleWork = kindSet(apple, "调休上班");
  const govWork = kindSet(gov, "调休上班");
  const workOnlyApple = difference(appleWork, govWork);
  const workOnlyGov = difference(govWork, appleWork);
  if (workOnlyApple.length > 0 || workOnlyGov.length > 0) {
    blocking.push(
      "「调休上班日两边对不上」（这一项不允许有口径差异）：" +
        (workOnlyApple.length > 0 ? `只有 Apple 有 ${workOnlyApple.join("、")}；` : "") +
        (workOnlyGov.length > 0 ? `只有国务院口径有 ${workOnlyGov.join("、")}；` : "") +
        "请对照政府公告确认后再导入。",
    );
  }

  const appleOff = kindSet(apple, "放假");
  const govOff = kindSet(gov, "放假");
  const offOnlyGov = difference(govOff, appleOff);
  if (offOnlyGov.length > 0) {
    blocking.push(`国务院列的放假日里，Apple 那份缺了：${offOnlyGov.join("、")}。`);
  }
  const offOnlyApple = difference(appleOff, govOff);
  const offOnlyAppleWeekday = offOnlyApple.filter((date) => !isWeekendDate(date));
  if (offOnlyAppleWeekday.length > 0) {
    blocking.push(
      `Apple 多出来的放假日里有不是周末的日子：${offOnlyAppleWeekday.join("、")}（多出来的只允许是周末）。`,
    );
  } else if (offOnlyApple.length > 0) {
    notes.push(
      `Apple 多标了 ${offOnlyApple.length} 天放假（${offOnlyApple.join("、")}），` +
        "它们都是假期块里的周六周日 —— 国务院口径只列法定安排日，属口径差异，不算冲突。",
    );
  }

  notes.push(
    `放假日 ${appleOff.size} 天、调休上班日 ${appleWork.size} 天，两个来源一致。`,
  );
  return { agree: blocking.length === 0, blocking, notes, notPublished: false };
}

// ── 展示用的汇总 ───────────────────────────────────────────────────────────────

/** 一段连续的日子（例如"春节 2/15–2/23 共 9 天"）。 */
export type HolidayBlock = {
  from: string;
  to: string;
  /** 块里有几天（含块内的周六周日）。 */
  days: number;
  kind: HolidayKind;
  /** 这一块涉及几个节日名（例如"国庆节、中秋节"）。 */
  names: string[];
};

/**
 * 把逐日的表压成"连休块"。
 *
 * 为什么按**类型**而不是按节日名分组：`2025-10-06` 是中秋、但它落在国庆假期块中间，
 * 按名字分组会把一段 8 天的连休切成两段，界面上就看不出"到底连休几天"——
 * 而"连休几天"正是排课与家长沟通真正要看的东西。所以块里允许出现多个节日名，
 * 由 `names` 一起带出来。
 */
export function holidayBlocks(days: HolidayDay[]): HolidayBlock[] {
  const sorted = normalizeDays(days);
  const blocks: HolidayBlock[] = [];
  for (const day of sorted) {
    const last = blocks[blocks.length - 1];
    const previous = last === undefined ? null : parseDateKey(last.to);
    const expected = previous === null ? null : toDateKey(new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1));
    if (last !== undefined && last.kind === day.kind && expected === day.date) {
      last.to = day.date;
      last.days += 1;
      // 一天可能同时属于两个节日（2025-10-06 是国庆 + 中秋），名字按「、」拆开逐个收
      for (const name of day.name.split("、")) {
        if (name !== "" && !last.names.includes(name)) last.names.push(name);
      }
      continue;
    }
    blocks.push({
      from: day.date,
      to: day.date,
      days: 1,
      kind: day.kind,
      names: day.name.split("、").filter((name) => name !== ""),
    });
  }
  return blocks;
}

/** 一年的概览数字（界面顶部那几行）。 */
export type HolidaySummary = {
  offDays: number;
  workDays: number;
  /** 放假的连休块（按开始日期升序）。 */
  offBlocks: HolidayBlock[];
  /** 调休上班的日子（都是单日，但可能连着）。 */
  workBlocks: HolidayBlock[];
  /** 最长的一段连休有多少天（0 = 这一年没有放假数据）。 */
  longestOff: number;
};

export function summarizeHolidayYear(days: HolidayDay[]): HolidaySummary {
  const blocks = holidayBlocks(days);
  const offBlocks = blocks.filter((block) => block.kind === "放假");
  return {
    offDays: days.filter((day) => day.kind === "放假").length,
    workDays: days.filter((day) => day.kind === "调休上班").length,
    offBlocks,
    workBlocks: blocks.filter((block) => block.kind === "调休上班"),
    longestOff: offBlocks.reduce((max, block) => Math.max(max, block.days), 0),
  };
}

/** 覆盖情况：哪一年有数据、哪一年该有却没有。 */
export type HolidayCoverage = {
  currentYear: number;
  /** 现在**应该**有数据的年份：今年与明年（明年那份通常在上一年 11 月公布）。 */
  expected: number[];
  /** `expected` 里没有数据的年份 —— 界面上要显眼地提出来。 */
  missing: number[];
  /** 有数据的年份（升序）。 */
  available: number[];
};

/**
 * 算"该有却没有"的年份。
 *
 * 为什么把**明年**也算进"应该有"：国务院一般在上一年 11 月公布次年安排，
 * 于是每年 11 月之前的"明年"确实还没数据 —— 那不是错误，而是**要提示的事**
 * （界面上写"2027 年的安排通常 2026 年 11 月才公布"）。反过来，
 * 到了 12 月还没有明年数据就是真的该抓了。这里不做时间判断，
 * 只把年份列出来，措辞交给界面 —— 判定表本身越简单越不容易错。
 */
export function holidayCoverage(available: number[], today: Date): HolidayCoverage {
  const currentYear = today.getFullYear();
  const years = [...new Set(available)].sort((a, b) => a - b);
  const expected = [currentYear, currentYear + 1];
  return {
    currentYear,
    expected,
    missing: expected.filter((year) => !years.includes(year)),
    available: years,
  };
}

// ── 读盘校验 ───────────────────────────────────────────────────────────────────

/** 读回来的文件校验结果（坏文件要说清坏在哪，不能装作"这一年没有数据"）。 */
export type HolidayYearReadResult =
  | { ok: true; value: HolidayYear }
  | { ok: false; error: string };

/**
 * 校验 `data/holidays/<年>.json` 的内容。
 *
 * 为什么要校验：这个文件是**可以手改的**（有人想加一天就加一天），也可能被编辑器写坏。
 * 读的时候不校验的话，坏数据会以"这一天没有假期"的形式静默流到界面上 ——
 * 而"静默少一天假"正是这个功能最不能出的错。
 */
export function readHolidayYear(raw: unknown, expectedYear: number): HolidayYearReadResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "内容不是一个对象。" };
  }
  const { year, fetchedAt, sources, verdict, days } = raw as Record<string, unknown>;
  if (year !== expectedYear) {
    return { ok: false, error: `文件里写的年份是 ${JSON.stringify(year)}，文件名却是 ${expectedYear}。` };
  }
  if (typeof fetchedAt !== "string" || fetchedAt === "") {
    return { ok: false, error: "缺抓取时间（fetchedAt）。" };
  }
  if (!Array.isArray(days) || days.length === 0) {
    return { ok: false, error: "没有任何一天的数据 —— 空表比没有这个文件更容易骗人，因此拒绝。" };
  }
  const parsedDays: HolidayDay[] = [];
  for (const item of days) {
    if (typeof item !== "object" || item === null) return { ok: false, error: "days 里有一条不是对象。" };
    const { date, name, kind } = item as Record<string, unknown>;
    if (typeof date !== "string" || parseDateKey(date) === null) {
      return { ok: false, error: `days 里有一个日期读不出来：${JSON.stringify(date)}` };
    }
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: `${date} 没有节日名。` };
    }
    if (kind !== "放假" && kind !== "调休上班") {
      return { ok: false, error: `${date} 的类型是 ${JSON.stringify(kind)}（只认"放假"或"调休上班"）。` };
    }
    parsedDays.push({ date, name: name.trim(), kind });
  }
  /*
   * `sources` 只用来显示"数据从哪来"，因此这里**过滤**而不是拒绝：手改文件时多写一条、
   * 少写一个字段都不该让整页打不开（页面上会直接把 label / url 打出来，
   * 碰到 `null` 之类的东西会渲染崩）。
   */
  const readSources: HolidaySourceRecord[] = (Array.isArray(sources) ? sources : [])
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      id: item.id === "gov" ? "gov" : "apple",
      label: typeof item.label === "string" ? item.label : "（未署名来源）",
      url: typeof item.url === "string" ? item.url : "",
      ok: item.ok === true,
      days: typeof item.days === "number" && Number.isFinite(item.days) ? item.days : 0,
      fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : "",
      note: typeof item.note === "string" ? item.note : "",
    }));
  return {
    ok: true,
    value: {
      year: expectedYear,
      fetchedAt,
      sources: readSources,
      verdict:
        typeof verdict === "object" && verdict !== null
          ? (verdict as HolidayVerdict)
          : { agree: false, blocking: ["文件里没有校验结论"], notes: [], notPublished: false },
      days: normalizeDays(parsedDays),
    },
  };
}
