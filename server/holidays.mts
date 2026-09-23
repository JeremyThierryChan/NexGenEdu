/**
 * 后台「节假日」页的数据层：**读 / 写 `data/holidays/<年>.json`**，以及从两个公开来源抓取。
 *
 * ## 为什么数据放在仓库里的 JSON 文件、而不是数据库
 *
 * 这张表是**参考资料**，不是业务数据：它一年只更新一两次、由公网数据源决定、
 * 与任何学生/课时/金额都没有外键关系。放进数据库要跟着走一遍迁移（`CURRENT_VERSION`）、
 * 契约、权限表、导出导入、备份 —— 全是为一个"查得着的表"付的代价；
 * 而放在 `data/holidays/` 里：
 *
 *   - **进 git**：哪一年、哪一天改了，`git log` 一眼看见（比备份更能说明"谁改的"）；
 *   - **丢了重新抓一次就行**（`npm run holidays:fetch`），因此不需要进数据库备份；
 *   - **手改也方便**：机构要给某一年加一天特殊安排，直接编辑那个文件即可
 *     （读的时候会校验，坏数据会被明确拒绝而不是静默当成"这天没假期"）。
 *
 * ## 为什么抓取放在服务端（而不是浏览器）
 *
 * 一是浏览器抓 `calendars.icloud.com` 与 `raw.githubusercontent.com` 会撞 CORS；
 * 二是**这条网络访问只应该发生在后端这一处**（自检有一条断言守着：除本文件外，
 * 前端源码里不出现任何对外的 `fetch`）。
 *
 * ## 为什么两个源都要抓、都要比对
 *
 * 见 `lib/backend/holidays.ts` 文件头：这种数据错了直接影响排课与家长沟通，
 * 所以**两边逐日对得上才允许写入**；对不上就拒绝并把差异列出来，由人去查政府公告。
 * 宁可这次没导进来（界面会显示"缺哪一年"），也不要静默用错数据。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkHolidaySources,
  combineHolidaySources,
  parseAppleHolidays,
  parseGovHolidays,
  readHolidayYear,
  type HolidayDay,
  type HolidaySourceRecord,
  type HolidayVerdict,
  type HolidayYear,
} from "../lib/backend/holidays.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 假日表所在目录：仓库里的 `data/holidays/`。
 *
 * 与 `server/accounts.mts` 的账号文件不同，这里**没有**只读钩子 —— 这份数据本来就该改，
 * 而且改错了重新抓一次就能回来。
 */
export function holidaysDir(): string {
  const override = process.env.NEXGENEDU_HOLIDAY_DIR;
  return typeof override === "string" && override.trim() !== "" ? override : path.join(HERE, "..", "data", "holidays");
}

/**
 * 某一年的文件路径。
 *
 * 年份在这里**自己校验一次**（非法直接抛）：`path.join(dir, `${year}.json`)` 对
 * `"../../evil"` 这种输入是会真的走出目录的。今天唯一的 HTTP 入口逐个年份过了
 * `holidayYearError`，所以打不进来 —— 但那是"靠调用方自觉"，
 * 将来加一条"删掉某一年"的路由就会带着这个洞一起上线。
 */
export function holidayYearFile(year: number): string {
  const problem = holidayYearError(year);
  if (problem !== null) throw new Error(`不写 / 不读这个文件名：${problem}`);
  return path.join(holidaysDir(), `${year}.json`);
}

/** 合法的年份范围（挡手滑：`20255` 这种会去抓一个不存在的年份）。 */
export const HOLIDAY_YEAR_MIN = 2000;
export const HOLIDAY_YEAR_MAX = 2100;

export function holidayYearError(year: number): string | null {
  if (!Number.isInteger(year)) return `年份必须是整数（给的是 ${JSON.stringify(year)}）。`;
  if (year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) {
    return `年份要在 ${HOLIDAY_YEAR_MIN}–${HOLIDAY_YEAR_MAX} 之间（给的是 ${year}）。`;
  }
  return null;
}

// ── 两个来源 ───────────────────────────────────────────────────────────────────

/**
 * 两个来源的定义（界面与错误信息里都要显示"数据是从哪儿来的"）。
 *
 * `apple`：Apple 的「中国大陆节假日」日历。它是**国内网络可达**的（`calendars.icloud.com`），
 * 带机器可读标记，因此作为主源 —— 实测本机 0.32 秒返回，是三个地址里最快的。
 *
 * `gov`：国务院办公厅通知口径的 JSON（`NateScarlet/holiday-cn` 自动抓 gov.cn 公告）。
 * 它没有噪音（只有安排日），但文件挂在 GitHub 上，于是**给了三个镜像地址、按顺序试**：
 *
 *   1. `cdn.jsdelivr.net`（实测 4/4 成功，0.7~1.0 秒）
 *   2. `fastly.jsdelivr.net`（实测 2/2 成功，约 0.85 秒）
 *   3. `raw.githubusercontent.com`（**实测很不稳**：同一台机器上 6 次里 4 次超时，
 *      只有 2 次成功 —— 所以它排最后，只在前两个都失败时兜底）
 *
 * 为什么要写镜像链而不是一个地址：抓不到时**整个年份都会被拒绝写入**（这是刻意的），
 * 所以"地址不稳"会直接变成"这个功能今天用不了"。三个地址各试一次的成本只有几秒。
 */
export const HOLIDAY_SOURCES: readonly { id: "apple" | "gov"; label: string; urls: (year: number) => string[] }[] = [
  {
    id: "apple",
    label: "Apple 日历（中国大陆节假日）",
    urls: () => ["https://calendars.icloud.com/holidays/cn_zh.ics"],
  },
  {
    id: "gov",
    label: "国务院公告口径（holiday-cn）",
    urls: (year) => [
      `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
      `https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
      `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
    ],
  },
];

/** 一次抓取的超时（毫秒）。这两个地址正常都是秒回，慢到超过这个数就当失败、换下一个镜像。 */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * 抓一个来源的内容：按镜像顺序试，返回第一个成功的那份。
 *
 * 三种结局分得很清楚（混在一起就会出现"看起来像没公布、其实是网络不通"这种误导）：
 *   - `ok`：拿到了内容；
 *   - `missing`：地址回了 404 —— 说明**这个文件不存在**（未来的年份就是这样），
 *     不是网络问题，因此不再试下一个镜像；
 *   - `error`：所有镜像都没成功，把每个地址的失败原因都带回来。
 */
type FetchOutcome =
  | { kind: "ok"; text: string; url: string }
  | { kind: "missing"; url: string }
  | { kind: "error"; error: string };

/**
 * 这个模块用的 `fetch`（**可注入**）。
 *
 * 为什么要能注入：这个功能最核心的承诺是"两个来源逐日比对一致才写盘"，而那件事过去
 * 在自检里**没有行为性覆盖** —— 真去连外网会让自检依赖网络、且只能测到"今天两个源恰好一致"
 * 这一种情形。注入之后自检能确定性地造出"只有一个源有数据""调休日对不上""某个源 404"，
 * 再去断言**盘上到底有没有多出文件**（见 `scripts/check.mts` 第 16 节）。
 */
export type HolidayFetch = (url: string) => Promise<Response>;

async function fetchSource(urls: string[], label: string, doFetch: HolidayFetch): Promise<FetchOutcome> {
  const failures: string[] = [];
  for (const url of urls) {
    let response: Response;
    let text: string;
    try {
      /*
       * `text()` 必须**在 try 里**：`AbortSignal.timeout` 的计时覆盖整个响应体读取，
       * 所以"响应头回来了、正文拖到超时"（或正文被中途掐断）是在 `text()` 上抛的。
       * 早先它在那两行 try 之外 —— 于是最可能发生的那种失败（超时）会成为唯一
       * **逃出** `refreshHolidayYear` 的异常：HTTP 回 500、命令行直接栈回溯，
       * 与"抓取总是回 200、每年一个结局"的设计正好相反。
       */
      response = await doFetch(url);
      if (response.status === 404) return { kind: "missing", url };
      if (!response.ok) {
        failures.push(`${url}：HTTP ${response.status}`);
        continue;
      }
      text = await response.text();
    } catch (cause) {
      failures.push(`${url}：${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    return { kind: "ok", text, url };
  }
  return {
    kind: "error",
    error:
      `连不上${label}，试过的每一个地址都失败了：${failures.join("；")}。` +
      "这通常是本机网络的问题（这些地址都是公开的静态文件）—— 稍后重试即可，不会因此写入任何数据。",
  };
}

/** 内容指纹：界面用它看"这次抓到的和上次是不是同一份"。 */
function fingerprint(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;
}

/**
 * 一次抓取的结果。**四种结局分开**，不让界面/命令行去猜：
 *
 *   - `written`：校验通过并写盘了；
 *   - `checked`：校验通过但没写（`write: false`，命令行 `--dry-run` 用）；
 *   - `not-published`：这一年还没公布 —— **正常情形**（每年 11 月之前都是这样），
 *     命令行不该为此报错退出，界面该显示一句说明而不是一条红色错误；
 *   - `rejected`：真失败（对不上 / 连不上 / 写不进去）—— 这是要人去查公告的那一类。
 *
 * 把"还没公布"与"真失败"混成一个 `ok: false`，就会出现"每年 10 月命令行固定报错"
 * 或者"数据对不上被当成还没公布、于是没人去查"这两种结局之一。
 */
export type HolidayRefreshOutcome =
  | { status: "written"; year: number; value: HolidayYear; file: string }
  | { status: "checked"; year: number; value: HolidayYear; file: string }
  | { status: "not-published"; year: number; error: string; verdict: HolidayVerdict; sources: HolidaySourceRecord[] }
  | { status: "rejected"; year: number; error: string; verdict: HolidayVerdict | null; sources: HolidaySourceRecord[] };

/**
 * 抓某一年：两个来源各抓一次 → 各解析一次 → 交叉校验 → **一致才写盘**。
 *
 * `write: false` 是"只看结果不落盘"（CLI 的 `--dry-run`、以及想知道差异时用）。
 */
export async function refreshHolidayYear(
  year: number,
  options: { write?: boolean; fetchImpl?: HolidayFetch } = {},
): Promise<HolidayRefreshOutcome> {
  const shouldWrite = options.write !== false;
  /*
   * 默认用全局 `fetch`，但包一层拿到超时信号 —— `AbortSignal.timeout` 只在这里建一次，
   * 于是"注入的替身"也能被测到同一套超时语义。
   */
  const doFetch: HolidayFetch =
    options.fetchImpl ??
    ((url: string) =>
      fetch(url, {
        headers: { accept: "text/calendar, application/json, text/plain, */*", "user-agent": "NexGenEdu-holidays" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }));
  const yearError = holidayYearError(year);
  if (yearError !== null) {
    return { status: "rejected", year, error: yearError, verdict: null, sources: [] };
  }

  const sources: HolidaySourceRecord[] = [];
  let appleDays: HolidayDay[] | null = null;
  let govDays: HolidayDay[] | null = null;
  const parseErrors: string[] = [];

  for (const source of HOLIDAY_SOURCES) {
    const urls = source.urls(year);
    const record: HolidaySourceRecord = {
      id: source.id,
      label: source.label,
      url: urls[0] ?? "",
      ok: false,
      days: 0,
      fingerprint: "",
      note: "",
    };
    const fetched = await fetchSource(urls, source.label, doFetch);
    if (fetched.kind === "missing") {
      /*
       * 404 的含义**按来源区分**，不能一律当成"这一年还没公布"：
       *
       *   - 国务院那份是**一年一个文件**（`…/<年>.json`），未来的年份本来就没有文件
       *     → 这正是"还没公布"，记成 0 天，交给交叉校验与另一个源比对；
       *   - Apple 那份是**一个不分年的文件**（`holidays/cn_zh.ics`）—— 它 404 只可能是
       *     "地址变了 / 已下线"，与哪一年无关。若也记成"还没公布"，就会出现
       *     "主源挂掉了，而命令行打印一句'国务院通常在上一年 11 月公布…'并退出码 0"，
       *     把真问题说成正常状态。
       */
      record.url = fetched.url;
      if (source.id === "apple") {
        record.note = "404：Apple 那个日历地址可能已经变了（它是不分年的单一文件，与哪一年无关）";
        parseErrors.push(`${source.label}：${record.note}`);
      } else {
        record.ok = true;
        record.note = "这一年还没有文件（尚未公布）";
        govDays = [];
      }
      sources.push(record);
      continue;
    }
    if (fetched.kind === "error") {
      record.note = fetched.error;
      parseErrors.push(`${source.label}：${fetched.error}`);
      sources.push(record);
      continue;
    }

    record.url = fetched.url;
    record.fingerprint = fingerprint(fetched.text);
    const parsed = source.id === "apple" ? parseAppleHolidays(fetched.text, year) : parseGovHolidays(fetched.text, year);
    if (!parsed.ok) {
      record.note = parsed.error;
      parseErrors.push(`${source.label}：${parsed.error}`);
    } else {
      record.ok = true;
      record.days = parsed.days.length;
      record.note = parsed.note;
      if (source.id === "apple") appleDays = parsed.days;
      else govDays = parsed.days;
    }
    sources.push(record);
  }

  /*
   * 解析失败的处理分两种：
   *   - 两个源都解析不出来 → 整件事失败（网络断了、或者两个源都改了格式）；
   *   - 只有一个源可用（比如 GitHub 在国内连不上）→ **仍然拒绝写入**。
   *     理由：交叉校验是这个功能的核心价值，只剩一个源时"一致"这件事无从谈起，
   *     而静默降级成"单源数据"会让人以为它被校验过了。界面上会显示哪个源失败了，
   *     以及"按单源写入"这种做法没有被提供 —— 缺数据比错数据好收拾。
   */
  if (appleDays === null || govDays === null) {
    return {
      status: "rejected",
      year,
      error:
        `这一年没有通过校验，没有写入任何东西。${parseErrors.join(" ")}` +
        "（两个来源都必须成功，缺一个都不写：只剩一个源时「两边一致」这件事无从谈起。）",
      verdict: null,
      sources,
    };
  }

  const verdict = checkHolidaySources(appleDays, govDays);
  /*
   * Apple 在前、国务院口径在后：`combineHolidaySources` 以第一个来源为基准，
   * 于是逐日表就是 Apple 那份（它把连休块里的周末也列出来了 —— 界面上"连休几天"要的正是这个），
   * 而节日名不会被两个来源的不同叫法搅成「清明、清明节」。
   */
  const merged = combineHolidaySources(appleDays, govDays);
  const value: HolidayYear = {
    year,
    fetchedAt: new Date().toISOString(),
    sources,
    verdict,
    days: merged,
  };

  if (!verdict.agree) {
    if (verdict.notPublished) {
      return {
        status: "not-published",
        year,
        error: verdict.blocking.join(" "),
        verdict,
        sources,
      };
    }
    return {
      status: "rejected",
      year,
      error: `这一年没有通过校验，没有写入任何东西：${verdict.blocking.join(" ")}`,
      verdict,
      sources,
    };
  }
  const file = holidayYearFile(year);
  if (!shouldWrite) return { status: "checked", year, value, file };

  const writeError = writeHolidayYearFile(year, value);
  if (writeError !== null) {
    return { status: "rejected", year, error: writeError, verdict, sources };
  }
  return { status: "written", year, value, file };
}

/*
 * 合并两个来源的逐日表这一步**不在这里实现**：它整份在 `lib/backend/holidays.ts` 的
 * `mergeHolidayDays`（按 日期+类型 去重、同名合并）。
 *
 * 早先这里自己写了一份（按 `日期|类型` 放进 Map，后来的覆盖先来的）——
 * 于是同一天的两个节日名会被**悄悄丢掉一个**，而界面上看不出来；
 * 更糟的是它算出来的天数与 `summarizeHolidayYear` 算出来的不一致
 * （那个函数按"一天一条"数）。两处口径必须只有一处实现，因此改成复用。
 */

// ── 读盘 / 写盘 ───────────────────────────────────────────────────────────────

/** 写盘（先写临时文件再改名：中途失败不会留下半截 JSON）。返回错误说明或 `null`。 */
export function writeHolidayYearFile(year: number, value: HolidayYear): string | null {
  const file = holidayYearFile(year);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporary, file);
    return null;
  } catch (cause) {
    return `写不进 ${file}：${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

/** 目录里有哪些年份有数据（升序）。文件名不合规的一律忽略，不算年份。 */
export function listHolidayYears(): number[] {
  const dir = holidaysDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^(\d{4})\.json$/.exec(name)?.[1] ?? "")
    .filter((value) => value !== "")
    .map((value) => Number(value))
    .sort((a, b) => a - b);
}

/** 读一年的文件（读盘 + 校验）；没有文件时 `value` 为 `null`。 */
export function readHolidayYearFile(year: number): { ok: true; value: HolidayYear | null } | { ok: false; error: string } {
  const file = holidayYearFile(year);
  if (!existsSync(file)) return { ok: true, value: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    return { ok: false, error: `${file} 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}` };
  }
  const validated = readHolidayYear(raw, year);
  if (!validated.ok) return { ok: false, error: `${file} 的内容有问题：${validated.error}` };
  return { ok: true, value: validated.value };
}

/** 读全部年份（按年份升序），坏文件不藏起来 —— 作为 `errors` 一起回给界面。 */
export function readAllHolidayYears(): { years: HolidayYear[]; errors: string[] } {
  const years: HolidayYear[] = [];
  const errors: string[] = [];
  for (const year of listHolidayYears()) {
    const read = readHolidayYearFile(year);
    if (read.ok) {
      if (read.value !== null) years.push(read.value);
    } else {
      errors.push(read.error);
    }
  }
  return { years, errors };
}

/** 抓取年份的默认值：今年与明年（明年那份通常在上一年 11 月公布）。 */
export function defaultHolidayYears(today: Date = new Date()): number[] {
  const year = today.getFullYear();
  return [year, year + 1];
}
