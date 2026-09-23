import { bumpVersion } from "./concurrency";
/*
 * 教室的"拆分「校区·教室名」"与 api.ts 里的迁移**共用同一处实现**（v31）。
 * 导入为什么要自己调一次：导入的记录是 `Record<string, unknown>`（文件里的原始形状），
 * 不是 `Classroom` 对象，而**判重键用的是 `name`** —— 不先拆开的话，
 * 一份"名称列里写着「沐阳教育·教室1」"的旧表会被当成一间**新**教室，
 * 于是库里出现两间同一校区的同一间房（一间叫「教室1」、一间叫「沐阳教育·教室1」）。
 */
import { normalizeClassroom, splitCampusFields } from "./classrooms";
import { ensurePartitions, partitionName } from "./course-partitions";
import { nextId } from "./ids";
import type {
  Classroom,
  Course,
  CoursePartition,
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
  /**
   * 这一列**允许不在文件里**（但它仍然是必填列）：值＝能替它把值算出来的那一列的 key。
   *
   * 只为「校区」而生（v31 收紧）：教室的校区既可以直接写在「校区」那一列，
   * 也可以**藏在名称里**（老表那种「沐阳教育·教室1」，行归一会按第一个「·」拆开）。
   * 于是它的必填判据不是"这一格填了没有"，而是"**拆完之后校区有没有值**"——
   * 因此它**不能进"整份不导入"那道表头闸**（`missingRequiredHeaders`）：
   * 一份只有「名称」一列、名字里全是合并写法的旧名单**本来是能导的**，
   * 判在拆分之前会把它们整份拒掉。改成**逐行判**（行归一之后），
   * 只有"拆完还是没有校区"的那一行才报错。
   *
   * 为什么做成列自己的一个显式声明、而不是在解析器里特判 `campus`：
   * 与 `empty`（枚举列留空取什么）同一个做法 —— 特判会把"教室的校区能从名字里拆"
   * 这件事埋进通用代码里，后来的人既看不到它、也就不敢碰它。
   */
  derivableFrom?: string;
  /**
   * 这一列必填却（**归一之后**）仍为空时报的原话。
   *
   * 不给就用通用的 `「${header}」不能为空`。校区要自己一句，因为它缺了不只是"这格空了"，
   * 而是"名称里也没有「校区·教室名」的写法可拆"—— 不写出来，用户会盯着一个他明明（以为）填了的列。
   */
  emptyReason?: string;
  kind: FieldKind;
  /** enum 的候选值。 */
  options?: string[];
  /**
   * `enum` 列**留空时**取什么值（默认取 `options[0]`）。
   *
   * 为什么需要它（v30 的「全职兼职」）：枚举列有两类完全不同的语义 ——
   *   - `kind`（教师 / AI）：留空＝"没说"，取第一个候选「教师」是**安全**的
   *     （宁可多一个可排课的教师，也不要因为空格把一个真人从排课下拉里静默移走）；
   *   - `employment`（全职 / 兼职）：留空＝**未填**，这是一个**真实的第三档**，
   *     取第一个候选「全职」等于凭空记下一条用工事实。
   * 因此把"留空取什么"变成列自己的一个显式声明，而不是让所有枚举列共用一个默认值。
   */
  empty?: string;
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
      // 资料字段（v13）：网站教师页上就写着这几项，照着填即可
      { key: "years", header: "教龄", kind: "text", example: "5 年" },
      { key: "summary", header: "一句话简介", aliases: ["简介"], kind: "text", example: "擅长引导学生自己把思路走通。" },
      { key: "bio", header: "详细介绍", aliases: ["介绍", "bio"], kind: "text", example: "（可留空；网站教师页的完整介绍会填在这里）" },
      { key: "kind", header: "类型", kind: "enum", options: ["教师", "AI"], example: "教师" },
      { key: "siteVisible", header: "网站展示", aliases: ["在网站展示"], kind: "bool", example: "否" },
      /*
       * v30 的两个**内部**字段（机构要的「全职/兼职」与「教师来源」）。
       *
       * 「全职兼职」用 enum：非法值（「临时工」这种）**报错拒绝并指到行**，
       * 而不是当自由文本收下来 —— 服务层那道闸也只认这两个值，
       * 在导入这一层就拦下能给出更好的提示（哪一行、错在哪一列）。
       * `empty: ""` 是**必须的**：留空＝未填，不能默认成「全职」（见 FieldSpec.empty 的说明）。
       *
       * 「来源」是**招聘渠道**（人事口径，自由文本），与教师表里那个技术性的
       * `origin`（网站同步 / 后台手建）**不是一回事** —— 那一列刻意**不做成可导入的列**：
       * 它由系统自己写（见 `finalize` 里那一行），人手工指定"这条档案是网站来的"
       * 只会造出一批说法的自相矛盾。
       */
      {
        key: "employment",
        header: "全职兼职",
        aliases: ["全职/兼职", "全职 / 兼职", "用工性质", "雇佣性质"],
        kind: "enum",
        options: ["全职", "兼职"],
        empty: "",
        example: "全职",
      },
      {
        key: "source",
        header: "来源",
        aliases: ["招聘渠道", "教师来源", "来源渠道"],
        kind: "text",
        example: "朋友介绍",
      },
    ],
    warning:
      "可选科目要与**课程库里的课程名**一致，否则排课时会报「教师科目不符」。" +
      "类型选 AI 的是智能体（如试课诊断）：它留在档案里，但**不会出现在排课下拉里**。" +
      "「全职兼职」只能填 全职 / 兼职（留空＝未填）；「来源」填的是**招聘渠道**" +
      "（招聘网站 / 朋友介绍 / 内部推荐 / 校招 / 其他）—— 它与档案本身的技术来源（`origin`）" +
      "不是一回事，但那个来源**界面上已经不显示了**，因此不必担心两个「来源」撞名。" +
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
      /*
       * v30：校区（自由文本）。**v31 起必填**（机构原话：「校区必须填」）。
       *
       * `derivableFrom: "name"`：校区也能从「名称」里拆出来（老表那种「沐阳教育·教室1」），
       * 因此这一列**不在"整份不导入"的表头闸里**，而是**行归一之后逐行判** ——
       * 一份只有名称列、名字里都是合并写法的旧名单照样能导（判在拆分之前会把它整份拒掉）。
       * 判据与文案都取自 `lib/backend/classrooms.ts`（与服务层那个写入闸共用，见 `hasCampus`）。
       */
      {
        key: "campus",
        header: "校区",
        aliases: ["所属校区", "所在校区"],
        required: true,
        derivableFrom: "name",
        emptyReason: `缺少必填列：校区（这一行没填校区，名称里也没有「校区·教室名」的写法可拆开）`,
        kind: "text",
        example: "城西校区",
      },
      { key: "note", header: "备注", kind: "text", example: "白板 + 投影" },
    ],
    warning: "可用时段（哪个时段开放）不在这里导入 —— 导入后到「教室」页给每间房设时段；不设时段表示不限。" +
      "「校区」**必填**（v31 收紧）：名称里不带校区的行必须自己带上校区列 —— " +
      "为什么必填：它决定教室在列表与排课里显示成「校区·教室名」，也用来**按校区筛**。" +
      "「校区」与「名称」分开两列填（显示时拼成「校区·教室名」）：**名称只填房间本身的名字**。" +
      "「校区」是自由文本（沐阳教育 / 全慧教育这类机构自己的叫法）；已在用的校区会在页面表单里提示出来，" +
      "导完想统一叫法到教室页改一下就行。" +
      "老表里那种「沐阳教育·教室1」的合并写法**照样能导**（名称里带着校区就不必再填校区列）：" +
      "系统会按第一个「·」拆开（显示一模一样），因此重导一份旧名单不会多出一间重复的房。",
  },
  courses: {
    key: "courses",
    label: "课程",
    idPrefix: "course",
    keyFields: ["name"],
    fields: [
      { key: "name", header: "课程名", aliases: ["名称"], required: true, kind: "text", example: "初中数学" },
      { key: "category", header: "分类", aliases: ["栏目"], kind: "text", example: "初中课内" },
      { key: "forms", header: "班型", kind: "list", example: "一对一|一对二" },
      { key: "status", header: "状态", kind: "enum", options: ["开放", "暂未开放"], example: "开放" },
      { key: "note", header: "备注", kind: "text", example: "" },
      // v15 的网站卡片字段：填了这张课才会出现在网站上（详见 docs/后台API约定.md）
      { key: "siteKind", header: "网站形态", aliases: ["展示形态"], kind: "enum", options: ["学科", "选修", "不展示"], example: "学科" },
      { key: "path", header: "卡片路径", aliases: ["路径"], kind: "text", example: "junior-math" },
      { key: "subgroup", header: "子栏目", kind: "text", example: "七选三" },
      { key: "target", header: "点进哪一节", aliases: ["锚点"], kind: "text", example: "高中物理学考" },
      { key: "order", header: "显示顺序", aliases: ["顺序"], kind: "number", example: "1" },
      { key: "intro", header: "一句话介绍", aliases: ["简介"], kind: "text", example: "建立数学模型" },
    ],
    warning:
      "课程名是排课、报课、教师科目的**引用键**，重名会被拦住（同一门课不要写成两行）。" +
      "网站来源的课程已经自动在库里，不必再导一遍。" +
      "「网站形态」填「学科 / 选修」并给出卡片路径，这门课才会出现在网站的课程栏目里（不展示则只在后台用于排课）。",
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
      /*
       * 留空取什么由列自己声明（`field.empty`；没声明才退回第一个候选值）。
       * 这里刻意**不用** `?? ""`：`??` 分不清"列没声明"与"列声明了空串"。
       */
      if (text === "") return { ok: true, value: field.empty ?? field.options?.[0] ?? "" };
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
 *
 * 唯一不进这道闸的是带 `derivableFrom` 的列 —— 目前只有教室的「校区」（v31 收紧）：
 * 它的值可能是从「名称」里拆出来的，因此只在**行归一之后**逐行判
 * （见行循环里"先拆后判"那一段与 `FieldSpec.derivableFrom`）。
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

  /*
   * 表头闸：**必填列缺了就整份不导入**。
   *
   * 带 `derivableFrom` 的列（目前只有「校区」）**不进这道闸**：它的值可能是拆出来的，
   * 只在表头这一层判会误杀（见下面行循环里"先拆后判"那一段）。
   */
  const missingRequiredHeaders = spec.fields
    .filter(
      (field) =>
        field.required === true &&
        field.derivableFrom === undefined &&
        ![...matched.values()].includes(field),
    )
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

    /*
     * **先拆后判**（v31，机构口径「校区必须填」）。
     *
     * 行归一（拆分「校区·教室名」）必须早于必填判：`campus` 那一格空着时，
     * 校区可能就写在名称里（老表那种「沐阳教育·教室1」）。顺序反了的话，
     * 一份只有名称列、名字里全是合并写法的旧名单会**整行整行地被判成"缺校区"**
     * —— 而它本来是能导的（"把旧表再导一次"正是机构最常做的事）。
     *
     * 于是必填判据是**拆完之后**的 `campus`：拆出来有值就通过，拆完还是空的那一行才报
     * （`emptyReason` 把"名称里也没有可拆的写法"说清）。
     */
    const finalized = entity === "classrooms" ? normalizeClassroomRow(record) : record;
    const emptyRequired = spec.fields.find(
      (field) => field.required === true && String(finalized[field.key] ?? "").trim() === "",
    );
    if (emptyRequired !== undefined) {
      convertedProblems.push({
        line: row.line,
        reason: emptyRequired.emptyReason ?? `「${emptyRequired.header}」不能为空`,
      });
      continue;
    }
    records.push(finalized);
  }

  return { entity, records, problems: convertedProblems, headers, unknownHeaders, missingRequiredHeaders: [] };
}

/**
 * 一行教室记录的**行归一**：把「校区·教室名」的合并写法拆开（规则与迁移同一处实现）。
 *
 * 为什么在解析这一层就做，而不是留到落库时的 `finalize`：
 *   - 判重键用的是 `name`（`keyFields: ["name"]`）。一份**导出/旧表**里名称列写着
 *     「沐阳教育·教室1」的名单，如果等落库时才拆，判重那一刻它叫「沐阳教育·教室1」、
 *     库里那间叫「教室1」→ 认不出是同一条 → **库里多出一间重复的房**
 *     （旧表重导一次就会发生，而这正是机构最常做的事）；
 *   - 顺带让界面上的"体检"预览显示的是**将要落库的形状**，而不是文件里的原始写法。
 *
 * 只碰 `name` / `campus` 两格，其余字段原样带过（`splitCampusFields` 的约定）。
 *
 * ⚠️ 它**必须早于必填判**（`parseImport` 的行循环里就是这个次序）：校区那一列空着时，
 * 校区可能写在名称里，拆完才算得清这一行到底缺不缺校区。
 */
function normalizeClassroomRow(record: Record<string, unknown>): Record<string, unknown> {
  const parts = splitCampusFields(record);
  return { ...record, name: parts.name, campus: parts.campus };
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
  /**
   * 这次导入**顺带新建**了几个课程分区（只在导课程表时可能不为 0）。
   *
   * 为什么要报出来：表格的「分类」列写着库里还没有的栏目时，导入会把它建出来 ——
   * 那是件好事，但必须让人知道（"导了 30 门课"与"导了 30 门课、还多了 2 个栏目"是两件事，
   * 后者要去看一眼那个栏目名字对不对）。静默新建是这一版最该避免的。
   */
  partitionsCreated: number;
};

/** 覆盖时**不能动**的字段：结构性或派生的数据，改了就破坏不变式。 */
const STRUCTURAL_FIELDS: Record<ImportEntity, string[]> = {
  // 报课记录、采集表、科目（由报课推导）都不属于"档案基础字段"
  students: ["id", "enrollments", "profile", "subjects", "createdAt", "version"],
  teachers: ["id", "version"],
  // 可用时段是单独在页面上设的，导入不该把它清掉
  classrooms: ["id", "availability", "version"],
  courses: ["id", "createdAt", "origin", "version"],
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

/**
 * 把「分类」一列解析成分区路径：`高中课内 / 七选三` → `{ column: "高中课内", subgroup: "七选三" }`。
 *
 * 三个宽容处（都是真实的表格会长成的样子）：
 *   - 半角 `/` 与全角 `／` 都认（中文输入法下很容易打出全角）；
 *   - 两边空格一律去掉（`高中课内 / 七选三`、`高中课内/七选三` 等价）；
 *   - 只有一个名字时视为一级栏目（`小学课内`）。
 *
 * 为什么按**第一个**斜杠分而不是最后一个：分区名里带斜杠的情形不存在（那会让路径本身
 * 有歧义），因此"第一个"与"最后一个"在这份数据上等价；写清楚只是为了让后来的人不必猜。
 * 与导出侧的 `partitionLabel()`（`export.ts`）是同一套写法 —— 导出来再导回去必须对得上。
 */
export function parsePartitionPath(text: string): { column: string; subgroup: string } {
  const raw = text.trim();
  if (raw === "") return { column: "", subgroup: "" };
  const parts = raw.split(/[/／]/);
  return {
    column: (parts[0] ?? "").trim(),
    subgroup: parts.slice(1).join("/").trim(),
  };
}

/** 库里那条记录的一句话摘要（冲突列表里给用户看，便于判断"是不是同一个人"）。 */
function describeExisting(
  entity: ImportEntity,
  record: Record<string, unknown>,
  partitions: readonly CoursePartition[] = [],
): string {
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
      /*
       * 课程的分区在库里存的是 id，因此这里要用分区表换成名字（否则冲突列表里会显示一串 `cp_xxx`，
       * 人根本认不出那是哪一区 —— 而这一列正是用来判断"要不要覆盖"的）。
       * 导入行自己带的 `分类` 文本（record.category）在**新**记录上才存在，
       * 因此两个来源都要试：先按 id 换，换不到再看有没有名字。
       */
      return [
        partitionName(partitions, String(record.partitionId ?? "")),
        String(record.category ?? ""),
        record.status,
      ]
        .filter((value) => String(value ?? "") !== "")
        .join(" · ");
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
          summary: describeExisting(parsed.entity, existing, db.coursePartitions),
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
function finalize(
  entity: ImportEntity,
  record: Record<string, unknown>,
  resolvePartition?: (path: string) => string,
): Record<string, unknown> {
  switch (entity) {
    case "students":
      return {
        name: String(record.name ?? ""),
        // 新记录从第 1 版开始（乐观锁，见 concurrency.ts）
        version: 1,
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
        version: 1,
        subjects: (record.subjects as string[]) ?? [],
        role: String(record.role ?? ""),
        phone: String(record.phone ?? ""),
        // 未填"在职"时默认在职（导入历史名单时最常见的意图）
        active: record.active === undefined ? true : Boolean(record.active),
        years: String(record.years ?? ""),
        summary: String(record.summary ?? ""),
        bio: String(record.bio ?? ""),
        // v14 的两个字段：批量导入的 CSV/JSON 里可以带上（表头写「推荐理由」「顺序」）
        recommendation: String(record.recommendation ?? ""),
        order: Number.isFinite(Number(record.order)) ? Number(record.order) : 999,
        // 类型只有明确的"AI"才算 AI（拼错/留空都当教师，宁可多一个可排课的教师，
        // 也不要因为一个错别字把真人教师从排课下拉里"静默移走"）
        kind: record.kind === "AI" ? "AI" : "教师",
        origin: record.origin === "网站" ? "网站" : "后台",
        // 表里没写"网站展示"时按来源默认：网站导进来的展示，其余不展示
        siteVisible:
          record.siteVisible === undefined
            ? record.origin === "网站"
            : record.siteVisible === true || record.siteVisible === "是" || record.siteVisible === "true",
        /*
         * v30 的两个内部字段。`employment` 已经在 `convertCell` 里过了 enum 那道校验，
         * 因此这里只需要给"整份 JSON 导入、没写这一列"的行补空串（＝未填）。
         * **不要在这里再猜一次**：空就是未填，与迁移给老库补的口径完全一致。
         */
        employment: String(record.employment ?? ""),
        source: String(record.source ?? ""),
      };
    case "classrooms":
      /*
       * 教室：落库前的形状走**与迁移同一处实现**的 `normalizeClassroom`
       * （去空白 + 把「校区·教室名」拆开）。解析那一步已经拆过一次，这里是幂等的第二道 ——
       * 留着它是为了"无论从哪条路进来，落库的形状都过同一处归一"这条纪律不漏。
       */
      return normalizeClassroom({
        name: String(record.name ?? ""),
        version: 1,
        // 「用途」列已经过 enum 校验（只能是两个候选值之一），这里只兜"整份 JSON 没写这一列"
        kind: (record.kind as Classroom["kind"]) ?? "上课用教室",
        capacity: Number(record.capacity ?? 0),
        // 时段留空 = 不限（与页面上的语义一致）
        availability: [],
        // v30：校区（自由文本）
        campus: String(record.campus ?? ""),
        note: String(record.note ?? ""),
      });
    case "courses":
      return {
        name: String(record.name ?? ""),
        version: 1,
        /*
         * 分区：Excel 里写的是**路径名字**（`高中课内 / 七选三`），库里存 id。
         * 解析器由 `applyImport` 传进来（它才有库、也才知道要新建哪些分区）。
         */
        partitionId: resolvePartition === undefined ? "" : resolvePartition(String(record.category ?? "")),
        forms: (record.forms as string[]) ?? [],
        origin: "后台",
        status: (record.status as string) ?? "开放",
        note: String(record.note ?? ""),
        createdAt: new Date().toISOString(),
        // v15 的网站卡片字段：导入的课默认**不上网站**（不展示），
        // 要上网站就得在表里写明「网站形态」与「卡片路径」—— 默认展示会让
        // 一次导入把网站上多出一批空卡片。
        path: String(record.path ?? ""),
        subgroup: String(record.subgroup ?? ""),
        tags: [],
        target: String(record.target ?? ""),
        order: Number.isFinite(Number(record.order)) ? Number(record.order) : 999,
        intro: String(record.intro ?? ""),
        siteKind: record.siteKind === "学科" || record.siteKind === "选修" ? record.siteKind : "不展示",
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
  /*
   * 课程导入：先把表格里的「分类」路径补成真实分区（缺的建出来），再逐行换成 id。
   *
   * 为什么在这里一次性补齐而不是每行各建一次：同一份表里几十行写着同一个栏目是常态，
   * 逐行建会建出几十个同名分区（`ensurePartitions` 的名字判重只在它自己维护的表上生效，
   * 每行传一份新的进去就判不出来）。补齐之后的映射对整份文件都有效。
   *
   * 新建的分区**会写进库**（`imports.apply` 本来就要落盘）：导入一份带新栏目的课程表，
   * 期望的结果就是"栏目也建好了"，而不是"课进来了、分区全空着"。
   * 结果里会数出来（`partitionsCreated`），不静默。
   */
  let resolvePartition: ((path: string) => string) | undefined;
  let partitionsCreated = 0;
  if (parsed.entity === "courses") {
    const refs = parsed.records.map((record) => parsePartitionPath(String(record.category ?? "")));
    const ensured = ensurePartitions(db.coursePartitions, refs, () => nextId("cp"));
    partitionsCreated = ensured.partitions.length - db.coursePartitions.length;
    db.coursePartitions = ensured.partitions;
    resolvePartition = (path: string) => {
      const { column, subgroup } = parsePartitionPath(path);
      return ensured.idOf(column, subgroup);
    };
  }

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
          summary: describeExisting(parsed.entity, existing, db.coursePartitions),
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
        const patch = finalize(parsed.entity, record, resolvePartition);
        for (const [field, value] of Object.entries(patch)) {
          if (structural.includes(field)) continue;
          // 导入行没提这个字段（空值）时不覆盖，避免"空表格清空已有内容"
          const provided = record[field];
          if (provided === undefined) continue;
          if (typeof provided === "string" && provided.trim() === "" && field !== "note") continue;
          existing[field] = value;
        }
        /*
         * 覆盖也是一次真实写入：把这条记录的版本推进一格。
         *
         * 少了这一步，批量导入就成了乐观锁的后门 —— 导完表之后，别人手上还开着的
         * 表单（读到的版本没变）一保存就会把这次导入的内容静默盖回去，
         * 而界面上写的是"保存成功"。`version` 已列进 STRUCTURAL_FIELDS，
         * 因此导入行**不可能**自己传一个版本号进来。见 `lib/backend/concurrency.ts`。
         */
        bumpVersion(existing as { version?: number });
        overwritten += 1;
        return;
      }
      // duplicate：两条都留。名称若会被当作身份（教师/教室/课程）就加序号，避免看起来一模一样
      const renamed = parsed.entity === "students" ? false : true;
      const name = String(record.name ?? "");
      const finalName = renamed ? uniqueName(takenNames, name) : name;
      takenNames.add(finalName.toLowerCase());
      list.push({
        ...finalize(parsed.entity, { ...record, name: finalName }, resolvePartition),
        id: nextId(spec.idPrefix),
      });
      byKey.set(keyOf(spec, { ...record, name: finalName }, record), list[list.length - 1] as Record<string, unknown>);
      duplicated += 1;
      added += 1;
      return;
    }

    byKey.set(key, record);
    takenNames.add(String(record.name ?? "").toLowerCase());
    list.push({ ...finalize(parsed.entity, record, resolvePartition), id: nextId(spec.idPrefix) });
    added += 1;
  });

  return {
    entity: parsed.entity,
    added,
    overwritten,
    duplicated,
    skipped,
    partitionsCreated,
    problems: parsed.problems,
    conflicts,
  };
}


/** 给界面用的一句话摘要。 */
export function summarizeImport(outcome: ApplyOutcome): string {
  const label = ENTITY_SPECS[outcome.entity].label;
  const parts = [`新增 ${outcome.added} 条${label}`];
  if (outcome.overwritten > 0) parts.push(`更新（覆盖）${outcome.overwritten} 条`);
  if (outcome.duplicated > 0) parts.push(`保留两份 ${outcome.duplicated} 条`);
  if (outcome.skipped.length > 0) parts.push(`跳过 ${outcome.skipped.length} 条`);
  // 顺带建出来的课程分区也要报（界面上那句"导入完成"就说全了，不必再去看日志）
  if (outcome.partitionsCreated > 0) parts.push(`新建课程分区 ${outcome.partitionsCreated} 个`);
  if (outcome.problems.length > 0) parts.push(`${outcome.problems.length} 行没通过校验`);
  return parts.join("，");
}

export type { Classroom, Course, Student, Teacher };
