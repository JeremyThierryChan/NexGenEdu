import { getHomeContent, getTeachersPage } from "@/lib/data/site";
import type {
  Classroom,
  Course,
  Database,
  Student,
  Teacher,
} from "./types";

/**
 * **批量导入**：把 CSV / JSON 里成批的记录一次导进库。
 *
 * ## 为什么要有它，以及它**不做**什么
 *
 * 机构的历史名单常常在 Excel / 表格里，一条条手录既慢又容易错。这个模块负责把这些
 * 记录一次导入。但它刻意**只管"档案类"信息**：
 *
 *   - 导入的是**学生 / 教师 / 教室 / 课程**的基本字段；
 *   - **不导入报课、收款、课时、排课** —— 那些牵动钱与课时的账本
 *     （实收 = 收款 − 退款、已用课时 = 有效上课流水），必须走页面上的正规流程，
 *     一次导入几百条"看起来对"的账，是最难查的一类事故。
 *
 * ## 三条设计选择（每条都对应一种"批量操作最容易出的错"）
 *
 * 1. **只新增，不覆盖**：同名（同键）记录**跳过并报告**，绝不静默把已有记录改掉。
 *    批量改数据是不可逆的，而"导入前先看看结果"是人的本能；宁可少做一步。
 * 2. **一次落盘**：`applyImport` 在**一份**数据库对象上改完再统一 `persist`，
 *    而不是每条调一次新建 —— 后者在 1000 行时会写 1000 次整库快照，且中途失败会留半截数据。
 * 3. **日志记一条，不记 N 条**：日志上限是 500 条；若每行写一条，一次大导入就会把
 *    历史日志全部冲掉。所以只留一条"批量导入 教师 42 条"的摘要。
 *
 * ## 解析要硬的地方
 *
 * CSV 是"看起来简单、实际到处是坑"的格式：引号内的逗号与换行、双写引号、BOM、
 * CRLF、Excel 导出的多余空列。这些都在 `parseCsv` 里处理，并且有断言钉住
 * （见 `scripts/check.mts` 的批量导入一节）。
 */

// ── 字段规格（模板、解析、校验、模板示例都从这里生成，只有一份定义）──────────

export type FieldKind = "text" | "number" | "list" | "bool" | "enum";

export type FieldSpec = {
  /** 内部字段名（与 types.ts 一致）。 */
  key: string;
  /** 模板与提示里用的中文列名。 */
  header: string;
  /** 兼容的其他列名（大小写与空格不敏感）。 */
  aliases?: string[];
  required?: boolean;
  kind: FieldKind;
  /** enum 的候选值。 */
  options?: string[];
  /** 模板里的示例值。 */
  example: string;
};

export type EntitySpec = {
  key: ImportEntity;
  label: string;
  /** id 前缀（与 api.ts 的 nextId 前缀保持一致，便于排查）。 */
  idPrefix: string;
  fields: FieldSpec[];
  /** 判重用的字段（都为空时才退回用 name）。 */
  keyFields: string[];
  /** 导入前给用户的一句提醒。 */
  warning: string;
};

export type ImportEntity = "students" | "teachers" | "classrooms" | "courses";

export const IMPORT_ENTITIES: ImportEntity[] = ["students", "teachers", "classrooms", "courses"];

export const ENTITY_SPECS: Record<ImportEntity, EntitySpec> = {
  students: {
    key: "students",
    label: "学生",
    idPrefix: "s",
    keyFields: ["name", "guardian"],
    fields: [
      { key: "name", header: "姓名", required: true, kind: "text", example: "张三" },
      { key: "grade", header: "年级", kind: "text", example: "初二" },
      { key: "guardian", header: "家长联系方式", aliases: ["家长电话", "联系方式", "电话"], kind: "text", example: "138-0000-0000" },
      { key: "status", header: "状态", kind: "enum", options: ["在读", "暂停", "已结课", "退课"], example: "在读" },
      { key: "note", header: "备注", kind: "text", example: "" },
    ],
    warning: "只导入档案（姓名/年级/家长/状态/备注）。**报课与收款不导入** —— 那些要在学生的「报课与课时」页走正规流程，否则课时与账本会对不上。",
  },
  teachers: {
    key: "teachers",
    label: "教师",
    idPrefix: "t",
    keyFields: ["name"],
    fields: [
      { key: "name", header: "姓名", required: true, kind: "text", example: "王老师" },
      { key: "subjects", header: "可带科目", aliases: ["科目"], kind: "list", example: "初中数学|初中物理" },
      { key: "role", header: "职务", kind: "text", example: "授课教师" },
      { key: "phone", header: "电话", kind: "text", example: "138-0000-0000" },
      { key: "active", header: "在职", kind: "bool", example: "是" },
      // 资料字段（v13）：可以从网站导入，也可以自己填
      { key: "years", header: "教龄", kind: "text", example: "5 年" },
      { key: "summary", header: "一句话简介", aliases: ["简介"], kind: "text", example: "擅长引导学生自己把思路走通。" },
      { key: "bio", header: "详细介绍", aliases: ["介绍", "bio"], kind: "text", example: "（可留空；网站教师页的完整介绍会填在这里）" },
      { key: "kind", header: "类型", kind: "enum", options: ["教师", "AI"], example: "教师" },
    ],
    warning:
      "可选科目要与**课程库里的课程名**一致，否则排课时会报「教师科目不符」。" +
      "类型选 AI 的是智能体（如试课诊断）：它留在档案里，但**不会出现在排课下拉里**。" +
      "「详细介绍」里如果要换行，写在引号里（CSV 支持多行单元格）。",
  },
  classrooms: {
    key: "classrooms",
    label: "教室",
    idPrefix: "c",
    keyFields: ["name"],
    fields: [
      { key: "name", header: "名称", required: true, kind: "text", example: "301 教室" },
      { key: "kind", header: "用途", kind: "enum", options: ["上课用教室", "自习室"], example: "上课用教室" },
      { key: "capacity", header: "容量", kind: "number", example: "8" },
      { key: "note", header: "备注", kind: "text", example: "白板 + 投影" },
    ],
    warning: "可用时段（哪个时段开放）不在这里导入 —— 导入后到「教室」页给每间房设时段；不设时段表示不限。",
  },
  courses: {
    key: "courses",
    label: "课程",
    idPrefix: "course",
    keyFields: ["name"],
    fields: [
      { key: "name", header: "课程名", aliases: ["名称"], required: true, kind: "text", example: "初中数学" },
      { key: "category", header: "分类", kind: "text", example: "初中课内" },
      { key: "forms", header: "班型", kind: "list", example: "一对一定制课|一对二 / 一对三小组课" },
      { key: "status", header: "状态", kind: "enum", options: ["开放", "暂未开放"], example: "开放" },
      { key: "note", header: "备注", kind: "text", example: "" },
    ],
    warning: "课程名是排课、报课、教师科目的**引用键**，重名会被拦住（同一门课不要写成两行）。网站来源的课程已经自动在库里，不必再导一遍。",
  },
};

// ── CSV 解析 ────────────────────────────────────────────────────────────────

/**
 * 解析 CSV 为二维数组。
 *
 * 处理：BOM、CRLF/LF、**引号内的逗号与换行**、双写引号（`""` → `"`）。
 * 这些不是"以防万一"，而是 Excel / Google Sheets 导出时真的会出现。
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\r" || char === "\n") {
      // CRLF 当成一次换行
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  // 收尾：最后一行没有换行符时也要收进来
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // 丢掉完全空白的行（Excel 常在末尾留空行）
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

/** 把二维数组还原成 CSV 文本（模板下载用；与 backup.ts 的 createCsv 同一套转义规则）。 */
export function toCsv(rows: string[][]): string {
  const escape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}

/** 生成某实体的 CSV 模板（表头 + 一行示例）。 */
export function csvTemplate(entity: ImportEntity): string {
  const spec = ENTITY_SPECS[entity];
  return toCsv([
    spec.fields.map((field) => field.header),
    spec.fields.map((field) => field.example),
  ]);
}

/** 生成某实体的 JSON 模板（字段名 + 示例值，数组形式）。 */
export function jsonTemplate(entity: ImportEntity): string {
  const spec = ENTITY_SPECS[entity];
  const row: Record<string, string> = {};
  for (const field of spec.fields) row[field.key] = field.example;
  return `${JSON.stringify([row], null, 2)}\n`;
}

// ── 解析结果（行 → 记录）────────────────────────────────────────────────────

export type RowProblem = { line: number; reason: string };

export type ParsedImport = {
  entity: ImportEntity;
  /** 通过校验、可以直接落库的记录。 */
  records: Array<Record<string, unknown>>;
  /** 解析/校验不通过的行（带上行号，界面直接显示给人改）。 */
  problems: RowProblem[];
  /** 识别到的表头（或 JSON 的键），供界面确认"列对上了没有"。 */
  headers: string[];
  /** 表头里没被识别的列（多半是拼错或多余列，提醒但不阻断）。 */
  unknownHeaders: string[];
  /** 必填列缺失时整份不导入。 */
  missingRequiredHeaders: string[];
};

export type ImportFormat = "csv" | "json";

/** 从文本猜格式：以 `[` 或 `{` 开头当 JSON，否则 CSV。 */
export function detectFormat(text: string): ImportFormat {
  return /^\s*[[{]/.test(text) ? "json" : "csv";
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** 表头（或 JSON 键）→ 字段定义。 */
function matchField(entity: ImportEntity, header: string): FieldSpec | null {
  const target = normalizeHeader(header);
  for (const field of ENTITY_SPECS[entity].fields) {
    if (normalizeHeader(field.key) === target || normalizeHeader(field.header) === target) return field;
    if ((field.aliases ?? []).some((alias) => normalizeHeader(alias) === target)) return field;
  }
  return null;
}

const TRUTHY = new Set(["是", "y", "yes", "true", "1", "在职", "开放", "启用"]);
const FALSY = new Set(["否", "n", "no", "false", "0", "离职", "停用", ""]);

/** 一个单元格 → 字段值；返回 null 表示不合法（附原因）。 */
function convertCell(field: FieldSpec, raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const text = raw.trim();
  switch (field.kind) {
    case "number": {
      if (text === "") return { ok: true, value: 0 };
      const value = Number(text);
      if (!Number.isFinite(value)) return { ok: false, reason: `「${field.header}」要填数字，收到“${raw}”` };
      return { ok: true, value };
    }
    case "list": {
      // 支持 | 、 / ; 换行 分隔（Excel 里常见的几种写法）
      const items = text.split(/[|、;；\n]/).map((item) => item.trim()).filter((item) => item !== "");
      return { ok: true, value: items };
    }
    case "bool": {
      const lower = text.toLowerCase();
      if (TRUTHY.has(lower)) return { ok: true, value: true };
      if (FALSY.has(lower)) return { ok: true, value: false };
      return { ok: false, reason: `「${field.header}」要填 是/否，收到“${raw}”` };
    }
    case "enum": {
      if (text === "") return { ok: true, value: field.options?.[0] ?? "" };
      if ((field.options ?? []).includes(text)) return { ok: true, value: text };
      return {
        ok: false,
        reason: `「${field.header}」只能是 ${(field.options ?? []).join(" / ")}，收到“${raw}”`,
      };
    }
    case "text":
    default:
      return { ok: true, value: text };
  }
}

type RawRow = { line: number; cells: Record<string, string> };

/** CSV 文本 → 原始行（带行号，行号对用户可见，所以按文件里的物理行算）。 */
function csvRows(entity: ImportEntity, text: string): { rows: RawRow[]; headers: string[]; problems: RowProblem[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], headers: [], problems: [{ line: 1, reason: "文件里没有任何内容。" }] };

  const headerRow = table[0] ?? [];
  const headers = headerRow.map((value) => value.trim()).filter((value) => value !== "");
  const problems: RowProblem[] = [];
  const rows: RawRow[] = [];

  for (let index = 1; index < table.length; index += 1) {
    const line = index + 1;
    const cells: Record<string, string> = {};
    const row = table[index] ?? [];
    for (let column = 0; column < headerRow.length; column += 1) {
      const header = (headerRow[column] ?? "").trim();
      if (header === "") continue;
      cells[header] = row[column] ?? "";
    }
    if (Object.values(cells).every((value) => value.trim() === "")) continue;
    rows.push({ line, cells });
  }
  return { rows, headers, problems };
}

/** JSON 文本 → 原始行。接受数组，或 `{ students: [...] }` 这种按实体分组的对象。 */
function jsonRows(entity: ImportEntity, text: string): { rows: RawRow[]; headers: string[]; problems: RowProblem[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], headers: [], problems: [{ line: 1, reason: "不是合法的 JSON。" }] };
  }

  let list: unknown = parsed;
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    list = record[entity] ?? null;
    if (list === null) {
      return {
        rows: [],
        headers: [],
        problems: [{
          line: 1,
          reason: `JSON 对象里没有 ${ENTITY_SPECS[entity].label} 数组（期望键名 "${entity}"），也没有直接给数组。`,
        }],
      };
    }
  }
  if (!Array.isArray(list)) {
    return { rows: [], headers: [], problems: [{ line: 1, reason: "JSON 顶层应当是数组，或包含该数组的对象。" }] };
  }

  const rows: RawRow[] = [];
  const headerSet = new Set<string>();
  (list as unknown[]).forEach((item, index) => {
    const line = index + 1;
    if (typeof item !== "object" || item === null || Array.isArray(item)) return;
    const cells: Record<string, string> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      headerSet.add(key);
      cells[key] = Array.isArray(value) ? value.join("|") : String(value ?? "");
    }
    rows.push({ line, cells });
  });
  return { rows, headers: [...headerSet], problems: [] };
}

/**
 * 文本 → 可落库记录（解析 + 校验）。
 *
 * **必填列缺失时整份不导入**（记进 `missingRequiredHeaders`）：那种情况通常是列名写错或
 * 选错了实体，硬导进去只会得到一堆空名字的记录。
 */
export function parseImport(entity: ImportEntity, text: string, format?: ImportFormat): ParsedImport {
  const spec = ENTITY_SPECS[entity];
  const kind = format ?? detectFormat(text);
  const { rows, headers, problems } = kind === "json" ? jsonRows(entity, text) : csvRows(entity, text);

  const matched = new Map<string, FieldSpec>();
  const unknownHeaders: string[] = [];
  for (const header of headers) {
    const field = matchField(entity, header);
    if (field === null) unknownHeaders.push(header);
    else matched.set(header, field);
  }

  const missingRequiredHeaders = spec.fields
    .filter((field) => field.required === true && ![...matched.values()].includes(field))
    .map((field) => field.header);

  if (missingRequiredHeaders.length > 0) {
    return { entity, records: [], problems, headers, unknownHeaders, missingRequiredHeaders };
  }

  const records: Array<Record<string, unknown>> = [];
  const convertedProblems = [...problems];
  for (const row of rows) {
    const record: Record<string, unknown> = {};
    let rowFailed = false;
    for (const [header, field] of matched) {
      const converted = convertCell(field, row.cells[header] ?? "");
      if (!converted.ok) {
        convertedProblems.push({ line: row.line, reason: converted.reason });
        rowFailed = true;
        break;
      }
      record[field.key] = converted.value;
    }
    if (rowFailed) continue;

    // 必填字段（列存在但值为空）也算不通过
    const emptyRequired = spec.fields.find(
      (field) => field.required === true && String(record[field.key] ?? "").trim() === "",
    );
    if (emptyRequired !== undefined) {
      convertedProblems.push({ line: row.line, reason: `「${emptyRequired.header}」不能为空` });
      continue;
    }
    records.push(record);
  }

  return { entity, records, problems: convertedProblems, headers, unknownHeaders, missingRequiredHeaders: [] };
}

// ── 落库 ────────────────────────────────────────────────────────────────────

/**
 * 冲突处理策略 —— 对应"把文件复制进目标文件夹时同名了怎么办"那三个选择。
 *
 * | 策略 | 含义 | 什么时候用 |
 * | --- | --- | --- |
 * | `skip` | 保留库里那条，忽略文件里这条 | 库里已经录好、只是文件里有重复 |
 * | `overwrite` | 用文件里的值**更新**库里的那条 | 文件是更新过的版本，要以文件为准 |
 * | `duplicate` | 两条都留（第二条加序号后缀，避免看起来一模一样） | 确实是两个人/两间房，或想留档对比 |
 *
 * 默认 `skip`：批量改数据不可逆，而"少做一步"永远是更安全的默认值。
 */
export type ConflictStrategy = "skip" | "overwrite" | "duplicate";

export type Conflict = {
  /** 行号（CSV 的物理行 / JSON 的序号），界面用它定位到具体哪一行。 */
  line: number;
  /** 判重键（内部用，不展示）。 */
  key: string;
  /** 文件里这条的字段值（用于和库里对比展示）。 */
  incoming: Record<string, unknown>;
  /** 库里已有的那条：只带 id、名称与一句摘要，避免把整条记录塞进响应。 */
  existing: { id: string; name: string; summary: string };
};

export type ApplyOutcome = {
  entity: ImportEntity;
  added: number;
  /** 被覆盖（更新）的条数。 */
  overwritten: number;
  /** 以"保留两份"方式新增的条数。 */
  duplicated: number;
  /** 因为已存在或文件内重复而跳过的行（带行号与原因）。 */
  skipped: RowProblem[];
  problems: RowProblem[];
  /** 与库里冲突的行（`onConflict: "ask"` 时返回，供人逐个决定）。 */
  conflicts: Conflict[];
};

/** 覆盖时**不能动**的字段：结构性或派生的数据，改了就破坏不变式。 */
const STRUCTURAL_FIELDS: Record<ImportEntity, string[]> = {
  // 报课记录、采集表、科目（由报课推导）都不属于"档案基础字段"
  students: ["id", "enrollments", "profile", "subjects", "createdAt"],
  teachers: ["id"],
  // 可用时段是单独在页面上设的，导入不该把它清掉
  classrooms: ["id", "availability"],
  courses: ["id", "createdAt", "origin"],
};

/** 给"保留两份"的第二条生成一个不重名的名字：王老师 → 王老师（2）。 */
function uniqueName(taken: Set<string>, name: string): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let index = 2; index < 999; index += 1) {
    const candidate = `${name}（${index}）`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name}（副本）`;
}

/** 库里那条记录的一句话摘要（冲突列表里给用户看，便于判断"是不是同一个人"）。 */
function describeExisting(entity: ImportEntity, record: Record<string, unknown>): string {
  switch (entity) {
    case "students":
      return [record.grade, record.guardian].filter((value) => String(value ?? "") !== "").join(" · ");
    case "teachers":
      return [record.role, (record.subjects as string[] | undefined)?.join("、")]
        .filter((value) => String(value ?? "") !== "")
        .join(" · ");
    case "classrooms":
      return [record.kind, record.capacity === undefined ? "" : `${String(record.capacity)} 人`]
        .filter((value) => String(value ?? "") !== "")
        .join(" · ");
    case "courses":
      return [record.category, record.status].filter((value) => String(value ?? "") !== "").join(" · ");
  }
}

/** 找出文件里与库中（或文件内）重复的行。 */
export function detectConflicts(db: Database, parsed: ParsedImport): Conflict[] {
  const spec = ENTITY_SPECS[parsed.entity];
  const list = targetList(db, parsed.entity);
  const seen = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    const record = item as Record<string, unknown>;
    seen.set(keyOf(spec, record, record), record);
  }

  const conflicts: Conflict[] = [];
  const insideFile = new Set<string>();
  parsed.records.forEach((record, index) => {
    const key = keyOf(spec, record, record);
    const existing = seen.get(key);
    if (existing !== undefined) {
      conflicts.push({
        line: index + 1,
        key,
        incoming: record,
        existing: {
          id: String(existing.id ?? ""),
          name: String(existing.name ?? ""),
          summary: describeExisting(parsed.entity, existing),
        },
      });
    } else if (insideFile.has(key)) {
      // 文件内部自己重复：按"库里没有"处理，但也提示出来
      conflicts.push({
        line: index + 1,
        key,
        incoming: record,
        existing: { id: "", name: String(record.name ?? ""), summary: "文件里前面已经出现过同名的一条" },
      });
    }
    insideFile.add(key);
  });
  return conflicts;
}

function keyOf(spec: EntitySpec, record: Record<string, unknown>, existing: Record<string, unknown>): string {
  const parts = spec.keyFields
    .map((key) => String(record[key] ?? "").trim())
    .filter((value) => value !== "");
  if (parts.length === spec.keyFields.length && parts.length > 0) return parts.join("\u0000").toLowerCase();
  return String((record.name ?? existing.name ?? "") as string).trim().toLowerCase();
}

/** 补齐各实体的默认值（与页面新建时的默认一致）。 */
function finalize(entity: ImportEntity, record: Record<string, unknown>): Record<string, unknown> {
  switch (entity) {
    case "students":
      return {
        name: String(record.name ?? ""),
        grade: String(record.grade ?? ""),
        guardian: String(record.guardian ?? ""),
        status: (record.status as string) ?? "在读",
        note: String(record.note ?? ""),
        subjects: [],
        enrollments: [],
        profile: {},
        createdAt: new Date().toISOString(),
      };
    case "teachers":
      return {
        name: String(record.name ?? ""),
        subjects: (record.subjects as string[]) ?? [],
        role: String(record.role ?? ""),
        phone: String(record.phone ?? ""),
        // 未填"在职"时默认在职（导入历史名单时最常见的意图）
        active: record.active === undefined ? true : Boolean(record.active),
        years: String(record.years ?? ""),
        summary: String(record.summary ?? ""),
        bio: String(record.bio ?? ""),
        // 类型只有明确的"AI"才算 AI（拼错/留空都当教师，宁可多一个可排课的教师，
        // 也不要因为一个错别字把真人教师从排课下拉里"静默移走"）
        kind: record.kind === "AI" ? "AI" : "教师",
        origin: record.origin === "网站" ? "网站" : "后台",
      };
    case "classrooms":
      return {
        name: String(record.name ?? ""),
        kind: (record.kind as string) ?? "上课用教室",
        capacity: Number(record.capacity ?? 0),
        // 时段留空 = 不限（与页面上的语义一致）
        availability: [],
        note: String(record.note ?? ""),
      };
    case "courses":
      return {
        name: String(record.name ?? ""),
        category: String(record.category ?? ""),
        forms: (record.forms as string[]) ?? [],
        origin: "后台",
        status: (record.status as string) ?? "开放",
        note: String(record.note ?? ""),
        createdAt: new Date().toISOString(),
      };
  }
}

function targetList(db: Database, entity: ImportEntity): unknown[] {
  return db[entity] as unknown[];
}

/**
 * 把解析好的记录写进库（**只新增**，跳过已存在的）。
 *
 * 返回逐项结果，调用方负责落盘与写日志 —— 这样"改了什么"和"什么时候落盘"分开，
 * 自检可以只测前半段而不落盘。
 */
export function applyImport(
  db: Database,
  parsed: ParsedImport,
  options: {
    /** 冲突时的处理方式；默认 `skip`（保守）。 */
    strategy?: ConflictStrategy;
    /** 逐行覆盖全局策略：键是行号（字符串）。 */
    perRow?: Record<string, ConflictStrategy>;
  } = {},
): ApplyOutcome {
  const spec = ENTITY_SPECS[parsed.entity];
  const list = targetList(db, parsed.entity);
  const byKey = new Map<string, Record<string, unknown>>();
  const takenNames = new Set<string>();
  for (const item of list) {
    const record = item as Record<string, unknown>;
    byKey.set(keyOf(spec, record, record), record);
    takenNames.add(String(record.name ?? "").toLowerCase());
  }

  const skipped: RowProblem[] = [];
  const conflicts: Conflict[] = [];
  let added = 0;
  let overwritten = 0;
  let duplicated = 0;

  parsed.records.forEach((record, index) => {
    const line = index + 1;
    const choice = options.perRow?.[String(line)] ?? options.strategy ?? "skip";
    const key = keyOf(spec, record, record);
    if (key === "") {
      skipped.push({ line, reason: "没有可用于判重的名称" });
      return;
    }

    const existing = byKey.get(key);
    if (existing !== undefined) {
      conflicts.push({
        line,
        key,
        incoming: record,
        existing: {
          id: String(existing.id ?? ""),
          name: String(existing.name ?? ""),
          summary: describeExisting(parsed.entity, existing),
        },
      });

      if (choice === "skip") {
        skipped.push({ line, reason: `已存在同名记录（按 ${spec.keyFields.join(" + ")} 判重），保留库里那条` });
        return;
      }
      if (choice === "overwrite") {
        /*
         * 覆盖只改**导入行里真的带了值的字段**，并跳过结构性字段
         * （报课记录、采集表、可用时段、来源…）：那些不是"档案基础信息"，
         * 用一份表格把它们清掉是事故，不是更新。
         */
        const structural = STRUCTURAL_FIELDS[parsed.entity];
        const patch = finalize(parsed.entity, record);
        for (const [field, value] of Object.entries(patch)) {
          if (structural.includes(field)) continue;
          // 导入行没提这个字段（空值）时不覆盖，避免"空表格清空已有内容"
          const provided = record[field];
          if (provided === undefined) continue;
          if (typeof provided === "string" && provided.trim() === "" && field !== "note") continue;
          existing[field] = value;
        }
        overwritten += 1;
        return;
      }
      // duplicate：两条都留。名称若会被当作身份（教师/教室/课程）就加序号，避免看起来一模一样
      const renamed = parsed.entity === "students" ? false : true;
      const name = String(record.name ?? "");
      const finalName = renamed ? uniqueName(takenNames, name) : name;
      takenNames.add(finalName.toLowerCase());
      list.push({ ...finalize(parsed.entity, { ...record, name: finalName }), id: makeId(spec.idPrefix) });
      byKey.set(keyOf(spec, { ...record, name: finalName }, record), list[list.length - 1] as Record<string, unknown>);
      duplicated += 1;
      added += 1;
      return;
    }

    byKey.set(key, record);
    takenNames.add(String(record.name ?? "").toLowerCase());
    list.push({ ...finalize(parsed.entity, record), id: makeId(spec.idPrefix) });
    added += 1;
  });

  return { entity: parsed.entity, added, overwritten, duplicated, skipped, problems: parsed.problems, conflicts };
}

/**
 * 生成 id。
 *
 * 这里没有直接复用 `api.ts` 的 `nextId`（那个是模块私有），但**规则保持一致**：
 * 前缀 + 时间戳 + 随机串。同一次导入里连续生成时靠随机串避免撞号。
 */
function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 给界面用的一句话摘要。 */
export function summarizeImport(outcome: ApplyOutcome): string {
  const label = ENTITY_SPECS[outcome.entity].label;
  const parts = [`新增 ${outcome.added} 条${label}`];
  if (outcome.overwritten > 0) parts.push(`更新（覆盖）${outcome.overwritten} 条`);
  if (outcome.duplicated > 0) parts.push(`保留两份 ${outcome.duplicated} 条`);
  if (outcome.skipped.length > 0) parts.push(`跳过 ${outcome.skipped.length} 条`);
  if (outcome.problems.length > 0) parts.push(`${outcome.problems.length} 行没通过校验`);
  return parts.join("，");
}

export type { Classroom, Course, Student, Teacher };

// ── 从"前端"（网站内容）导入 ────────────────────────────────────────────────
//
// 网站上有两份现成的、**真实**的名单：教师团队（`data/site/content.md` 的教师段）
// 与场地照片格里写的场地名（301 教室、302 教室…）。机构刚起步时不必手录一遍 ——
// 这就是"从前端导入"的用途。
//
// 刻意**只做教师与教室**：
//   - 课程已有「从网站同步课程」（同一件事，不重复造）；
//   - 学生网站上没有（那是机构自己的数据，没有来源可导）。

export type SiteImportSource = "teachers" | "classrooms";

export type SiteImportData = {
  /** 表单里给用户看的来源说明。 */
  description: string;
  records: Array<Record<string, unknown>>;
};

/**
 * 读网站内容，产出**与 CSV/JSON 导入同一种形状**的记录。
 *
 * 这一点很重要：产出走同一套 `applyImport`（判重、冲突策略、日志、落盘），
 * 因此"从网站导入"与"从文件导入"在行为上完全一致，只有数据来源不同。
 */
export function siteImportRecords(source: SiteImportSource): SiteImportData {
  if (source === "teachers") {
    /*
     * **包含 AI 智能体**（采苓 · 试课诊断、有恒 · 学习跟踪…）：机构要能在后台看到
     * "有哪些工具在服务学生"，所以它们也进档案，只是 `kind: "AI"`。
     *
     * 与"人"的区别落在一处：**排课下拉不列 AI**（见 api.ts 的 teachers.listActive）——
     * 否则会排出一节"由 AI 上"的课。类型写在档案里，页面上一眼能分辨。
     *
     * 资料字段（教龄 / 一句话简介 / 详细介绍）一并带过来 —— 这正是"导入教师资料"的本意：
     * 网站教师页本来就写着这些，机构不该再抄一遍。
     */
    const teachers = getTeachersPage().teachers;
    const aiCount = teachers.filter((teacher) => teacher.kind === "ai").length;
    return {
      description:
        `网站「教师」页的 ${teachers.length} 位` +
        (aiCount > 0 ? `（其中 ${aiCount} 个是 AI 智能体，会标成「AI」且不参与排课）` : ""),
      records: teachers.map((teacher) => ({
        name: teacher.name,
        subjects: teacher.subjects,
        role: teacher.role,
        phone: "",
        active: true,
        years: teacher.years ?? "",
        summary: teacher.summary ?? "",
        bio: teacher.bio ?? "",
        kind: teacher.kind === "ai" ? "AI" : "教师",
        origin: "网站",
      })),
    };
  }

  /*
   * 场地名来自首页的「教室照片格位」小节（`getHomeContent().classrooms`）。
   * 条目形如 `301 教室 | classroom-301.jpg`：竖线后面是图片文件名，不是场地名的一部分，
   * 所以取竖线前的那一段；照片格位留空的行会被跳过（那是还没填的位子）。
   *
   * 「是不是自习室」按名字猜（名字里带"自习"就是自习室）：这一条是**猜**，
   * 所以只在名字明确时生效，其余一律按"上课用教室"导入并在界面上让人改 ——
   * 宁可让人改一次，也不要静默把自习室当成上课教室。
   */
  const rooms: string[] = [];
  for (const item of getHomeContent().classrooms) {
    const name = (item.title ?? "").split("|")[0]?.trim() ?? "";
    if (name !== "" && !rooms.includes(name)) rooms.push(name);
  }
  return {
    description: `网站首页「教室照片格位」里的 ${rooms.length} 个场地名（可用时段要导入后在「教室」页单独设）`,
    records: rooms.map((name) => ({
      name,
      kind: name.includes("自习") ? "自习室" : "上课用教室",
      capacity: 0,
      note: "从网站导入，容量与时段请按实际填写",
    })),
  };
}
