import { CURRENT_VERSION } from "./version";
import type { Database } from "./types";

/**
 * 导出 / 导入 / 日历文件生成。
 *
 * 全部是**纯函数**，不碰存储与浏览器 API，因此：
 *   - 自检可以在 Node 里逐条验证（导入校验、ICS 格式、CSV 转义）；
 *   - 页面只负责「拿字符串 → 触发下载」这部分副作用。
 *
 * 这一组功能还有一个容易被忽略的价值：**将来转前后端分离时，
 * 要靠导出把用户浏览器里的数据搬到服务端**，所以导入必须严谨 ——
 * 一个坏文件不能把现有数据洗掉。
 */

export type DatabaseStats = {
  students: number;
  teachers: number;
  classrooms: number;
  lessons: number;
  lessonRecords: number;
  homeworkRecords: number;
  assessments: number;
  transactions: number;
  updatedAt: string;
  version: number;
};

/** 数据统计（导出确认、导入前后对比都用它）。 */
export function databaseStats(db: Database): DatabaseStats {
  return {
    students: db.students.length,
    teachers: db.teachers.length,
    classrooms: db.classrooms.length,
    lessons: db.lessons.length,
    lessonRecords: db.lessonRecords.length,
    homeworkRecords: db.homeworkRecords.length,
    assessments: db.assessments.length,
    transactions: db.transactions.length,
    updatedAt: db.updatedAt,
    version: db.version,
  };
}

/** 导出用的 JSON 文本（带缩进，便于人读与 diff）。 */
export function serializeDatabase(db: Database): string {
  return JSON.stringify(db, null, 2);
}

export type ImportValidation =
  | { ok: true; database: Database }
  | { ok: false; error: string };

/**
 * 校验导入文件的结构。
 *
 * 只做**结构**校验（字段在不在、类型对不对），不做业务校验：
 * 业务层面的问题（例如报课科目为空）应该照常导进来由界面暴露，
 * 而不是因为一条脏数据就整份拒收 —— 那会让人无法修复数据。
 *
 * 但**结构不对必须拒收**：宁可让管理员看到「文件不对」，
 * 也不能把一份空对象导进去把现有数据洗掉。
 */
export function validateImportedDatabase(value: unknown): ImportValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "文件内容不是一份数据对象。" };
  }

  const candidate = value as Partial<Database>;

  if (typeof candidate.version !== "number" || !Number.isFinite(candidate.version)) {
    return { ok: false, error: "缺少 version 字段，这不像是本系统导出的文件。" };
  }
  if (candidate.version > CURRENT_VERSION) {
    return {
      ok: false,
      error: `文件版本（v${candidate.version}）比当前程序（v${CURRENT_VERSION}）更新，请先升级程序再导入。`,
    };
  }

  // v1 就有的四张表必须齐全；后续版本新增的表由迁移补
  const required: Array<keyof Database> = ["students", "teachers", "classrooms", "lessons"];
  for (const key of required) {
    if (!Array.isArray(candidate[key])) {
      return { ok: false, error: `缺少 ${key} 数组，文件可能已损坏。` };
    }
  }

  // 抽查 id：没有 id 的记录会让整套增删改查失效
  for (const key of required) {
    const list = candidate[key] as Array<{ id?: unknown }>;
    if (list.some((item) => typeof item?.id !== "string" || item.id === "")) {
      return { ok: false, error: `${key} 里有记录缺少 id，无法导入。` };
    }
  }

  return { ok: true, database: candidate as Database };
}

/** 导入结果：成功时带上条数，便于界面告诉用户「导入了什么」。 */
export type ImportOutcome =
  | { ok: true; stats: DatabaseStats; note: string }
  | { ok: false; error: string };

// ── 日历文件（ICS） ─────────────────────────────────────────────────────

export type CalendarEvent = {
  /** 唯一 id（同一节课每次导出应保持一致，重复导入才不会产生副本）。 */
  uid: string;
  title: string;
  location: string;
  description: string;
  /** 开始时间（ISO）。 */
  startsAt: string;
  durationMinutes: number;
};

/**
 * ICS 文本转义（RFC 5545）。
 *
 * 反斜杠、分号、逗号、换行都必须转义，否则一句「提高班，周六」会把日历文件写坏；
 * 中文本身不需要转义。
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** ISO → ICS 本地时间格式 `YYYYMMDDTHHMMSS`（不带 Z：按本地时间，不做时区换算）。 */
export function icsLocalTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 长行折行（RFC 5545 要求 75 字节以内，超出部分续行以空格开头）。 */
function foldLine(line: string): string {
  if (line.length <= 74) return line;

  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  parts.push(rest);
  return parts.join("\r\n ");
}

/** 生成日历文件（多节课 → 一个日历）。 */
export function createIcs(events: CalendarEvent[], calendarName: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NexGenEdu//教务后台//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  const stamp = icsLocalTime(new Date().toISOString());

  for (const event of events) {
    const start = new Date(event.startsAt);
    const end = new Date(start.getTime() + event.durationMinutes * 60_000);

    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsLocalTime(event.startsAt)}`,
      `DTEND:${icsLocalTime(end.toISOString())}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      ...(event.location !== "" ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
      ...(event.description !== "" ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

// ── 表格文件（CSV） ─────────────────────────────────────────────────────

/**
 * 生成 CSV 文本。
 *
 * 两个细节：
 *   - 单元格里的引号、逗号、换行都要转义（用双引号包裹并把内部引号写成两个）；
 *   - 开头加 BOM，否则 Excel 打开中文会乱码 —— 这是最常见的「导出后打不开」投诉。
 */
export function createCsv(headers: string[], rows: string[][]): string {
  const escapeCell = (value: string) =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** 触发浏览器下载（页面专用；自检不碰它）。 */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 释放对象 URL，避免长会话下内存一直涨
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 文件名里的日期戳：`2026-09-18`。 */
export function stampForFilename(date: Date = new Date()): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
