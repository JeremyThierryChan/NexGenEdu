/**
 * 网站内容导出：**库 → `data/site/*.md`**（`npm run site:export`）。
 *
 * ## 为什么需要它
 *
 * 宣传网站是**静态导出**的：构站那一刻问一次后端，把公开数据写成
 * `data/site/.backend-snapshot.ts`，页面读它。而**线上（GitHub Actions → Pages）那台机器
 * 连不上后端**，工作流里设了 `SITE_CONTENT_SOURCE=template` —— 也就是说
 * **线上读的就是 `data/site/*.md` 这六个内容文件**。
 *
 * 机构的口径是「网站上有显示的内容都要和后台同步，这样我的后台才有用」。于是有了这条命令：
 * 把库里的教师 / 课程卡片 / 课程正文 / 报价 / 常见问题 / 案例 / 特色课程 / 页面文案一次性
 * 写回那六个 `.md`，提交推送之后 CI 照旧构站。
 *
 * 方向与 `lib/backend/site-content.ts`（内容文件 → 库）**正好相反**，两者互为逆运算：
 * 那一份负责建库时的初始数据，这一份负责建库之后「以后端为准」。
 *
 * ## 为什么是"外科手术式"改写，而不是整份重新生成
 *
 * 六个 `.md` 里除了库里的数据，还有**大量写给人看的说明**：文件头的引用块、
 * 每个分组标题下的「格式为…」、`<!-- -->` 注释、页面之间的段落。
 * 这些东西库里没有、公开接口里也没有，整份重新生成会把它们全部删掉 ——
 * 一次导出就把机构手里那份说明书抹了，而且 `git diff` 会因为几百行说明的消失
 * 而看不出**到底哪一处是库里的真实改动**。
 *
 * 因此这里的做法是：**只替换库里拥有的那些区域**，其余原样搬过去。
 * 具体到每一处：
 *
 *   - **文件头**（第一个 `## 页面:` 之前的全部内容）：原样保留，并在引用块末尾追加一行
 *     醒目提醒（`EXPORT_NOTICE`），告诉读文件的人"这份是导出产物，改这里会被覆盖"；
 *   - **页面短字段**（`--- … ---`）：按库里的值重写**已有字段行的值**，
 *     保留行顺序、注释行与 `>` 说明行；库里没有的键删掉、库里新加的键追加在末尾；
 *   - **分组标题下的说明文字**（「格式为…」这类）：原样保留（库里没有这一份）；
 *   - **条目 / 小节 / 教师 / 案例 / 课程树**：从库里重新生成；
 *   - **报价的正文**：直接复用 `pricingConfigToMarkdown()`（`pricing.exportMarkdown`
 *     就是它），只把文件里每个 `## 分组` 标题下的说明文字补回去。
 *
 * ## 公开接口里没有的东西
 *
 * 数据来自 `GET /api/public/site`（只读、不需要登录），因此**教师分成规则拿不到**
 * （`PublicPricing` 刻意不给 `teacherShare`：那是机构的内部成本口径）。
 * 这一节只能沿用**文件里原有的那一份**，导出时会在 `notes` 里说明。
 *
 * ## 表达不了的东西会明说
 *
 * `.md` 这套格式不是数据库：有些内容写不进去（某个字段在库里有换行、特色课程的字段名
 * 不在四个可用字段里、卡片在后台显式设过「点进哪一节」…）。
 * 这些不会让导出失败，但会在 `warnings` 里逐条点名 —— 静默丢数据比报错糟糕得多。
 *
 * ## 自检里的回读
 *
 * `readSiteCore()` 是这套写法的**回读**（把导出的文件读回"核心内容"），
 * `siteCoreFromViews()` 把网站视图模型转成同一形状。`scripts/check.mts` 第 43 节
 * 用这两者做两件事：① 库 → Markdown → 回读 与库里那一份逐字段一致；
 * ② 回读的口径与 `lib/data/*` 现成的解析口径一致（拿真实的 `.md` 对一遍）。
 *
 * ## 回读要带上"显示顺序"（2026-09：暂未开放往后排）
 *
 * `readSiteCore()` 回读出来的是**网站上看到的那一份**，因此它也套用网站上那条显示规则
 * （`lib/backend/availability-order.ts`）：卡片在子栏目内、学科整组、选修课在栏目内、
 * 报价的阶段与课程，暂未开放的一律排到最后。
 *
 * 为什么回读也必须排：`siteCoreFromViews()` 那一侧吃的是**网站视图模型**
 * （`backendCourseColumns` / `backendCoursesPage` / `backendPricingData`），
 * 它们已经排过了；回读这边不排的话，自检 §43 的两条断言会拿"两侧都对的数据"
 * 报出几十条假差异（我第一版就是这样：导出明明是好的，却看起来像丢了卡片）。
 * **写文件那条路（`exportSiteMarkdown`）一个字都没动** —— 排序是显示规则，
 * 不能因此改变导出到 `data/site/*.md` 的内容。
 */
import { parseDocument, type PageBlock, type Section } from "@/lib/data/content";
import {
  DEFAULT_TEACHER_SHARE_RULES,
  parsePricingSource,
  pricingWithUnavailableLast,
  type PricingData,
  type TeacherShareRules,
} from "@/lib/data/pricing";
import { unavailableLast, unavailableLastInGroups } from "./availability-order";
import { readString } from "@/lib/markdown";
import { configFromPricingData, pricingConfigCore, pricingConfigToMarkdown, type PricingConfig } from "./pricing";
import { groupByPartition, partitionPlace } from "./course-partitions";
import { deriveSlug } from "./featured-tree";
import { SITE_COPY_GROUPS, SITE_COPY_KEYS, SITE_COPY_PAGES } from "./site-copy-model";
import type { PublicSite } from "./public-site";
import type { SiteCopyBlock, SiteCopyKey } from "./types";
import type {
  CaseItem,
  CasesContent,
  Course,
  CourseColumn,
  CourseColumnCard,
  CourseTag,
  CourseDetail,
  ElectiveCourse,
  FaqContent,
  FeaturedContent,
  SectionHeading,
  Teacher,
} from "@/lib/types/site";

/* ── 一、六个文件与那句提醒 ─────────────────────────────────────────────── */

/** 要导出的六个内容文件（顺序就是打印顺序）。 */
export const SITE_EXPORT_FILES = ["content", "pricing", "faq", "cases", "featured", "schedule"] as const;

export type SiteExportFile = (typeof SITE_EXPORT_FILES)[number];

/** 每个文件的中文名（打印用）。 */
export const SITE_EXPORT_LABELS: Record<SiteExportFile, string> = {
  content: "content.md（全站 / 首页 / 课程 / 教师 / 关于 / 联系我们）",
  pricing: "pricing.md（报价）",
  faq: "faq.md（常见问题）",
  cases: "cases.md（学生案例）",
  featured: "featured.md（特色课程）",
  schedule: "schedule.md（课程时间安排）",
};

/**
 * 追加在文件头引用块末尾的那句提醒。
 *
 * 为什么必须有一句：文件现在**看起来还是一份手写的内容文件**，
 * 下一个人照着里面的「格式为…」改一通，下次导出全没了 —— 那是最容易发生的误解。
 */
export const EXPORT_NOTICE =
  "> ⚠️ 本文件由 `npm run site:export` 从后台导出：**后台为准**，手工改动会在下次导出时被覆盖。";

/* ── 二、输入输出 ─────────────────────────────────────────────────────── */

export type SiteExportInput = {
  /** 后端公开数据（`GET /api/public/site` 的 `data`；自检里传内存夹具）。 */
  site: PublicSite;
  /** 现有文件内容：文件头说明块、分组说明文字与字段顺序都从它保留下来。 */
  existing: Readonly<Record<SiteExportFile, string>>;
};

export type SiteExportResult = {
  files: Record<SiteExportFile, string>;
  /** 内容真的变了的文件（写盘时只写这些，免得白改 mtime）。 */
  changed: SiteExportFile[];
  /** 说明（打印给操作的人看）。 */
  notes: string[];
  /** 库里有、但 `.md` 这套格式表达不了、因此**没有**写进文件的东西。 */
  warnings: string[];
  /**
   * **不许写的文件**：文件不见了 / 是空的 / 页面标记（`## 页面: xxx`）没认出来。
   *
   * 为什么要单列：这几种情况下生成出来的是一份"没有页面"的残骸 ——
   * 写下去等于把机构那份内容文件（连同里面写给人看的说明）一次抹掉。
   * 导出应当**停在这里**，让人先去把文件找回来（`git checkout -- data/site/xxx.md`）。
   */
  unsafe: Array<{ file: SiteExportFile; reason: string }>;
};

/** 收集警告（同一条只报一次，免得反复导出时刷屏）。 */
class Warnings {
  private readonly seen = new Set<string>();
  readonly list: string[] = [];

  add(message: string): void {
    if (this.seen.has(message)) return;
    this.seen.add(message);
    this.list.push(message);
  }
}

/* ── 三、行级工具 ─────────────────────────────────────────────────────── */

/** `## 页面: xxx` 标记（与 `lib/data/content.ts` 的 parseDocument 同一口径）。 */
const PAGE_MARKER = /^##\s+页面\s*[:：]\s*(.+?)\s*$/;

const isBlank = (line: string): boolean => line.trim() === "";

/** 标题层级（井号数）；不是标题返回 0。 */
function headingLevel(line: string): number {
  const match = /^(#{1,6})\s/.exec(line);
  return match?.[1] === undefined ? 0 : match[1].length;
}

/** 恰好是 `---` 的一行（短字段块的边界）。 */
const isFence = (line: string): boolean => /^---[ \t]*$/.test(line);

/** 去掉首尾空行；中间原样。 */
function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] ?? "")) start += 1;
  while (end > start && isBlank(lines[end - 1] ?? "")) end -= 1;
  return lines.slice(start, end);
}

/**
 * 字符串兜底。
 *
 * 类型上这些字段都是 `string`，但**老库 / 手工改过的 JSON** 运行时可能是 `undefined`
 * （见 `lib/site/backend-source.ts` 里同名的那个 `text()`）。导出一份坏数据不该崩，
 * 该崩的地方是"导出的文件读不回来"那类能被断言抓住的地方。
 */
function text(value: string | undefined): string {
  return value ?? "";
}

/** 标题行 → 标题文字。 */
function headingText(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

/** 一个页面在源码里的位置。 */
type PageSpan = {
  name: string;
  /** `## 页面: xxx` 那一行的下标。 */
  markerIndex: number;
  marker: string;
  /** 短字段块的起止（两行 `---` 的下标）；没有短字段块时为 null。 */
  fields: { open: number; close: number } | null;
  /** 页面块结束位置（下一个 `## 页面:` 之前，或文件末尾）。 */
  end: number;
};

/** 按 `## 页面: xxx` 切出页面（与 parseDocument 同一口径：引用块不算标记）。 */
function pageSpans(lines: readonly string[]): PageSpan[] {
  const marks: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trimStart().startsWith(">")) continue;
    if (PAGE_MARKER.test(line)) marks.push(index);
  }

  return marks.map((markerIndex, order) => {
    const markerLine = lines[markerIndex] ?? "";
    const end = marks[order + 1] ?? lines.length;
    let open = -1;
    for (let index = markerIndex + 1; index < end; index += 1) {
      if (isFence(lines[index] ?? "")) {
        open = index;
        break;
      }
    }
    let close = -1;
    if (open !== -1) {
      for (let index = open + 1; index < end; index += 1) {
        if (isFence(lines[index] ?? "")) {
          close = index;
          break;
        }
      }
    }
    return {
      name: headingText(markerLine.replace(/^##\s+页面\s*[:：]/, "")),
      markerIndex,
      marker: markerLine,
      fields: open !== -1 && close !== -1 ? { open, close } : null,
      end,
    };
  });
}

/** 一个分组：标题行的下标 + 结束位置（下一个同级或更高级标题之前）。 */
type GroupSpan = { headingIndex: number; end: number };

function groupSpans(lines: readonly string[], from: number, to: number, level: number): GroupSpan[] {
  const heads: number[] = [];
  for (let index = from; index < to; index += 1) {
    if (headingLevel(lines[index] ?? "") === level) heads.push(index);
  }
  return heads.map((headingIndex, order) => ({ headingIndex, end: heads[order + 1] ?? to }));
}

/** 分组标题下、第一个子标题之前的说明行（去掉首尾空行）。 */
function groupHeadLines(lines: readonly string[], span: GroupSpan, level: number): string[] {
  let stop = span.end;
  for (let index = span.headingIndex + 1; index < span.end; index += 1) {
    if (headingLevel(lines[index] ?? "") > level) {
      stop = index;
      break;
    }
  }
  return trimBlankEdges(lines.slice(span.headingIndex + 1, stop));
}

/** 某个页面里「分组标题 → 说明行」的映射。 */
function headMap(lines: readonly string[], page: PageSpan, level: number): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const from = page.fields === null ? page.markerIndex + 1 : page.fields.close + 1;
  for (const span of groupSpans(lines, from, page.end, level)) {
    map.set(headingText(lines[span.headingIndex] ?? ""), groupHeadLines(lines, span, level));
  }
  return map;
}

/* ── 四、短字段（frontmatter）─────────────────────────────────────────── */

/** 哪些字段是"一个字段多行"（内容文件里写成 `key:` + `  - 值`）。 */
const LIST_FIELD_KEYS = new Set(["keywords", "trial_points"]);

/**
 * 把值写成一行。
 *
 * 内容文件的短字段是一行一个（`key: 值`），库里的值若含换行就写不进去 ——
 * 这时折成一行**并报一条警告**，而不是悄悄写出会被解析成"新字段"的多行内容。
 */
function inlineValue(key: string, value: string, warnings: Warnings, where: string): string {
  if (!value.includes("\n") || LIST_FIELD_KEYS.has(key)) return value;
  warnings.add(
    `${where}：字段「${key}」在库里有 ${String(value.split("\n").length)} 行，` +
      "内容文件里一个字段只能写一行 —— 已折成一行（换行变空格）。",
  );
  return value.replace(/\s*\n\s*/g, " ");
}

/** 一个字段写进短字段块时占几行。 */
function emitField(key: string, value: string): string[] {
  if (value.includes("\n") && LIST_FIELD_KEYS.has(key)) {
    const items = value
      .split("\n")
      .map((item) => item.trim())
      .filter((item) => item !== "");
    return [`${key}:`, ...items.map((item) => `  - ${item}`)];
  }
  return [`${key}: ${value}`];
}

/**
 * 重写一个短字段块：**保留原有的行顺序、注释行与 `>` 说明行**，只换值。
 *
 * 为什么不整块重新生成：`content.md` 的「全站」段里有三行 `#` 注释（营业时间与上课时间
 * 的区别）、课程段里有两行 `>` 说明 —— 那些是写给人看的，库里没有。
 * 重新生成会把它们删掉，而它们恰恰是最需要留给下一个人的那几句。
 */
function rewriteFields(
  existing: readonly string[],
  fields: ReadonlyArray<readonly [string, string]>,
  warnings: Warnings,
  where: string,
): string[] {
  const remaining = new Map(fields.map(([key, value]) => [key, value]));
  const out: string[] = [];

  for (let index = 0; index < existing.length; index += 1) {
    const line = existing[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(">")) {
      out.push(line);
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    // 紧随其后的 `  - 值` 行属于这个字段（无论它原来是不是数组写法）
    let stop = index + 1;
    while (stop < existing.length && /^\s+- /.test(existing[stop] ?? "")) stop += 1;

    if (!remaining.has(key)) {
      warnings.add(`${where}：短字段「${key}」在库里没有，已从文件里删除（后台为准）。`);
      index = stop - 1;
      continue;
    }
    const value = remaining.get(key) ?? "";
    remaining.delete(key);
    out.push(...emitField(key, inlineValue(key, value, warnings, where)));
    index = stop - 1;
  }

  // 库里新加的字段追加在末尾（顺序在短字段块里没有语义）
  for (const [key, value] of fields) {
    if (!remaining.has(key)) continue;
    remaining.delete(key);
    out.push(...emitField(key, inlineValue(key, value, warnings, where)));
  }

  return out;
}

/* ── 五、生成"分组" ───────────────────────────────────────────────────── */

/**
 * 一个要写进文件的分组。
 *
 * `preserveHead`：标题下的说明文字要不要从**现有文件**里搬过来。
 * 属于库的数据（学科的导语、教师字段）当然不用搬 —— 它们由 `blocks` 生成；
 * 而「格式为…」这类写给人看的话只在文件里，必须搬。
 */
type GroupSpec = {
  heading: string;
  preserveHead: boolean;
  blocks: string[];
  /** 这个分组在现有文件里叫什么（默认 = heading 去掉井号）。 */
  lookup?: string;
};

/** 一个页面的生成结果。 */
type PageSpec = {
  name: string;
  fields: ReadonlyArray<readonly [string, string]>;
  groups: GroupSpec[];
};

/** 分组标题行 + 说明 + 条目，拼回源码行。 */
function renderGroups(spec: PageSpec, existingHeads: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const group of spec.groups) {
    const lookup = group.lookup ?? headingText(group.heading);
    const blocks = group.blocks.filter((block) => block.trim() !== "");
    const parts: string[] = [];
    if (group.preserveHead) {
      const head = existingHeads.get(lookup) ?? [];
      if (head.length > 0) parts.push(...head, "");
    }
    blocks.forEach((block, index) => {
      if (index > 0) parts.push("");
      parts.push(...block.split("\n"));
    });
    // 分组内部拼完之后**只留一个空行**：说明文字后面那个空行与"分组之间的空行"
    // 会撞成两个（`教室照片格位` 那种"没有条目、只有说明"的分组就会中招）
    out.push(...trimBlankEdges([group.heading, "", ...parts]), "");
  }
  return out;
}

/** 把提醒行追加到文件头引用块的末尾（已经有就不重复加 —— 反复导出必须收敛）。 */
function withNotice(prologue: readonly string[]): string[] {
  if (prologue.some((line) => line.trim() === EXPORT_NOTICE.trim())) return [...prologue];
  let lastQuote = -1;
  for (let index = 0; index < prologue.length; index += 1) {
    if ((prologue[index] ?? "").trimStart().startsWith(">")) lastQuote = index;
  }
  const out = [...prologue];
  if (lastQuote === -1) out.push("", EXPORT_NOTICE);
  // 前面补一个 `>` 空行：否则提醒会接在引用块最后一段（甚至一条列表项）后面，
  // 读起来像那段话的一部分 —— 这条提醒必须是单独一段
  else out.splice(lastQuote + 1, 0, ">", EXPORT_NOTICE);
  return out;
}

/**
 * 按页面重写整份文件。
 *
 * 页面的**集合与顺序**由现有文件决定（那是文件的结构，不是库里的数据）；
 * 库里多出来的块会在 `warnings` 里点名。
 */
function rewriteFile(
  source: string,
  groupLevel: number,
  pages: readonly PageSpec[],
  warnings: Warnings,
  missing: string[],
): string {
  const lines = source.split("\n");
  const spans = pageSpans(lines);
  const pageMap = new Map(pages.map((page) => [page.name, page]));

  const firstPage = spans[0];
  const out: string[] = [...withNotice(lines.slice(0, firstPage === undefined ? lines.length : firstPage.markerIndex))];

  for (const span of spans) {
    const spec = pageMap.get(span.name);
    if (spec === undefined) {
      warnings.add(`文件里的「## 页面: ${span.name}」在导出规则里没有对应的一块，已原样保留。`);
      out.push(...lines.slice(span.markerIndex, span.end));
      continue;
    }
    const pageLines = lines.slice(span.markerIndex, span.end);
    const heads = headMap(lines, span, groupLevel);
    const fieldLines = span.fields === null ? [] : lines.slice(span.fields.open + 1, span.fields.close);
    const nextFields = rewriteFields(fieldLines, spec.fields, warnings, `页面「${span.name}」`);

    // 页面正文（短字段块之后、第一个分组之前）原样保留
    const bodyStart = span.fields === null ? 1 : span.fields.close + 1 - span.markerIndex;
    let firstGroup = -1;
    for (let index = bodyStart; index < pageLines.length; index += 1) {
      if (headingLevel(pageLines[index] ?? "") === groupLevel) {
        firstGroup = index;
        break;
      }
    }
    const pageHead = firstGroup === -1
      ? pageLines.slice(bodyStart)
      : pageLines.slice(bodyStart, firstGroup);

    // 短字段块不存在时补一个（否则这一页的字段全写不进去）
    if (span.fields === null) {
      warnings.add(`页面「${span.name}」原本没有 \`---\` 短字段块，导出时补了一个。`);
    }
    out.push(span.marker, "", "---", ...nextFields, "---", ...pageHead);
    out.push(...renderGroups(spec, heads));
  }

  for (const spec of pages) {
    if (!spans.some((span) => span.name === spec.name)) {
      missing.push(spec.name);
      warnings.add(`库里有页面「${spec.name}」，但内容文件里没有这一页，导出没有写它。`);
    }
  }

  return endWith(out, source);
}

/**
 * 收尾：末尾的空行数**按原文件来**。
 *
 * 为什么在意这个：`featured.md` 末尾本来有两个换行，统一成一个就会多出一处
 * 与内容无关的 diff（"到底改了什么"要一眼能看出来，靠的就是 diff 干净）。
 */
function endWith(lines: readonly string[], source: string): string {
  const original = /\n*$/.exec(source)?.[0] ?? "\n";
  const tail = original === "" ? "\n" : original;
  return `${lines.join("\n").replace(/\n*$/, "")}${tail}`;
}

/* ── 六、通用小工具 ───────────────────────────────────────────────────── */

/** 文案块的短字段 → 有序键值对（空键丢掉）。 */
function copyFields(block: SiteCopyBlock | undefined): Array<[string, string]> {
  return (block?.fields ?? [])
    .filter((field) => text(field.key).trim() !== "")
    .map((field) => [text(field.key), text(field.value)] as [string, string]);
}

/** 一个标题区 → 短字段（可选一个 `notice`）。 */
function headingFields(
  heading: { eyebrow: string; title: string; description: string },
  notice?: string,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["eyebrow", heading.eyebrow],
    ["title", heading.title],
    ["description", heading.description],
  ];
  if (notice !== undefined) rows.push(["notice", notice]);
  return rows;
}

/**
 * 条目行（`#### 名称 | 值`）；值为空时只写名称。
 *
 * `level` 是条目的井号数：`content.md` 与 `schedule.md` 的分组是 `###`、条目是 `####`，
 * 而 `faq.md` 的分组是 `##`、一个问题一条是 `###`（层级即结构，写错一层整页就没有内容）。
 */
function itemLine(
  title: string,
  value: string,
  warnings: Warnings,
  where: string,
  level = "####",
): string {
  title = text(title);
  value = text(value);
  if (title.includes("|") || title.includes("·")) {
    warnings.add(`${where}：「${title}」这个名字里有「|」或「·」，条目写法会把它截断。`);
  }
  if (value.includes("\n")) {
    warnings.add(`${where}：「${title}」在库里的内容有换行，文件里条目只能写一行（已折成一行）。`);
    return `${level} ${title} | ${value.replace(/\s*\n\s*/g, " ")}`;
  }
  return value.trim() === "" ? `${level} ${title}` : `${level} ${title} | ${value}`;
}

/** 名字里不能有的字符（会被解析器当成"名称 | 值"或"字段: 值"切开）。 */
function checkName(name: string, what: string, warnings: Warnings): void {
  if (name.trim() === "") warnings.add(`${what}有一个名字是空的。`);
  else if (name.includes("|") || name.includes("：") || name.includes(":")) {
    warnings.add(`${what}「${name}」的名字里有冒号或竖线：解析器会把它截断，请换一个写法。`);
  }
}

/**
 * 把一段正文变成**能写进 `.md` 的那一份**：会被解析器当成标题的行，转义掉。
 *
 * ## 为什么必须转义（2026-09 课程页「一门课一段正文」）
 *
 * 格式里 `#` 开头的行都是标题（层级即数据结构，见 `lib/data/content.ts` 的 `buildTree`）。
 * 而课程正文现在自带 `### 小标题`：级别 / 技能（学考 / 选考、N5–N3、A1–B2、雅思四项、
 * 3D 建模的三个软件、编程的四个方向）降级成了正文里的三级标题。
 * 不转义就写文件，读回来时它们会变成**新的 `###` 分组**，那门课的正文被**拦腰截断**
 * —— 而且不报错，页面上只是"少了一半内容"，正是最难查的那种。
 *
 * 用的是 CommonMark 本身就有的 `\#` 写法（不是新造的语法），
 * 解析器那一侧认它（`buildTree` 里那段配对说明）。
 *
 * 仍然转义不了、只能报警告的：`- · 字段: 值` 那种字段行（写进文件就会被当成字段）。
 *
 * @returns 写进文件的那一份正文
 */
function bodyForFile(body: string, what: string, warnings: Warnings, allowFieldLines = true): string {
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    if (/^#{1,6}\s+.+$/.test(line)) {
      lines.push(`\\${line}`);
      continue;
    }
    if (!allowFieldLines && /^\s*[-*]\s*·\s*.+?\s*[:：]/.test(line)) {
      warnings.add(`${what}里有一行 \`- · 字段: 值\`：它会被当成字段，正文会被截掉。`);
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

/* ── 七、content.md ───────────────────────────────────────────────────── */

/** 网站上的卡片 = `siteKind !== "不展示"` 且填了路径（与构站脚本、网站的判据一致）。 */
function isSiteCard(course: PublicSite["courses"][number]): boolean {
  return course.siteKind !== "不展示" && (course.path ?? "") !== "";
}

/** 公开数据里的分区表（只有 id / 名字 / 上级 / 顺序）。 */
function partitionsOf(site: PublicSite) {
  return (site.partitions ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    parentId: item.parentId,
    order: item.order,
  }));
}

/** 一门课的分区位置（栏目 / 子栏目）。 */
function placeOf(site: PublicSite, partitionId: string): { column: string; leaf: string } {
  const place = partitionPlace(partitionsOf(site), partitionId);
  return {
    column: place.column === null ? "" : place.column.name.trim(),
    leaf: place.leaf === null ? "" : place.leaf.name.trim(),
  };
}

/**
 * 卡片点进哪个小节（与 `lib/site/backend-source.ts` 的 `cardTarget` 同一口径）：
 * 有同名小节就用课程名，否则用第一个标签的目标，都没有就用课程名。
 *
 * 内容文件的条目行里**没有这个字段的写法**，因此导出只能按这条推导 ——
 * 后台若显式设过别的值，导出的文件与后台就会不一致，这件事必须报出来。
 */
function derivedTarget(card: CourseColumnCard, site: PublicSite): string {
  const anchors = new Set<string>();
  for (const subject of site.siteContent.coursePage.subjects) {
    // 学科下有小节时，**学科名本身就是课程页上的锚点**（`courseSectionNames` 同一口径）：
    // 卡片指向"日语"这一节，而不是"日语N5"那一个小节。
    if (subject.bands.some((band) => (band.title ?? "").includes("｜"))) anchors.add(subject.name);
    for (const band of subject.bands) {
      const id = (band.id ?? "").trim();
      if (id !== "") anchors.add(id);
    }
  }
  if (anchors.has(card.title)) return card.title;
  const first = card.tags[0];
  const target = first === undefined ? "" : first.target.trim();
  return target === "" ? card.title : target;
}

/** 卡片条目行：`#### 名字 | 路径: … · 班型: … · 栏目: … · 子栏目: … · 状态: … · 标签: …`。 */
function cardLine(card: CourseColumnCard, column: string, subgroup: string, warnings: Warnings): string {
  checkName(card.title, "课程卡片", warnings);
  const parts = [`路径: ${card.path}`];
  if (card.forms.length > 0) parts.push(`班型: ${card.forms.join("、")}`);
  if (column !== "") parts.push(`栏目: ${column}`);
  if (subgroup !== "" && subgroup !== column) parts.push(`子栏目: ${subgroup}`);
  if (card.unavailable) parts.push("状态: 暂未开放");
  if (card.tags.length > 0) {
    const tags = card.tags.map((tag) => {
      if (tag.label.includes("·") || tag.target.includes("·")) {
        warnings.add(`标签「${tag.label}→${tag.target}」里有「·」：条目写法会把它截断。`);
      }
      if (tag.label === tag.target || tag.target.trim() === "") return tag.label;
      return `${tag.label}→${tag.target}`;
    });
    parts.push(`标签: ${tags.join("、")}`);
  }
  return `#### ${card.title} | ${parts.join(" · ")}`;
}

/** 「页面: 全站 → 课程栏目」的条目（栏目 → 子栏目 → 卡片）。 */
function courseCardBlocks(site: PublicSite, warnings: Warnings): string[] {
  const cards = (site.courses ?? []).filter(isSiteCard);
  const blocks: string[] = [];

  for (const column of groupByPartition(cards, partitionsOf(site))) {
    for (const group of column.groups) {
      // 空栏目不上网（与 `backendCourseColumns` 同一口径）：文件里也不写
      if (group.items.length === 0) continue;
      const sorted = [...group.items].sort((a, b) => a.order - b.order);
      const subgroup = group.subgroup === null ? "" : group.subgroup.name.trim();
      for (const course of sorted) {
        const place = placeOf(site, course.partitionId);
        const card: CourseColumnCard = {
          title: (course.name ?? "").trim(),
          path: course.path,
          unavailable: course.status !== "开放",
          forms: (course.forms ?? []).filter((item) => item !== ""),
          tags: (course.tags ?? []).map((tag) => ({ label: tag.label, target: tag.target })),
          target: course.target,
        };
        const derived = derivedTarget(card, site);
        if (card.target.trim() !== "" && card.target.trim() !== derived) {
          warnings.add(
            `课程卡片「${card.title}」在后台设了「点进哪一节 = ${card.target}」，` +
              `而按卡片名与标签推出来的是「${derived}」—— 内容文件里没有写这个字段的地方，` +
              "导出的文件会按推出来的那个走。",
          );
        }
        blocks.push(cardLine(card, place.column, subgroup, warnings));
      }
    }
  }
  return blocks;
}

/** 学科分组的正文（状态 + 导语 + 各学段小节），不含分组标题行。 */
function subjectBody(
  unavailable: boolean,
  lead: string,
  bands: ReadonlyArray<{ title: string; body: string }>,
  warnings: Warnings,
  subjectName: string,
): string {
  const blocks: string[] = [];
  const leadText = text(lead).trim();
  if (unavailable) blocks.push("- · 状态: 暂未开放");
  if (leadText !== "") {
    blocks.push(bodyForFile(leadText, `学科「${subjectName}」的导语`, warnings, false));
  }
  for (const band of bands) {
    /*
     * 小节名的合法性：**不要求**有「｜」。
     *
     * `splitTitle` 对「既没有半角竖线、又没有冒号」的标题判定为内容小节
     * （`isSection: true`），因此 `#### 高中物理` 这样的裸课程名是合法小节名 ——
     * 旧的这条警告是误报（2026-09 做成「一门课一段正文」时实测确认：
     * 解析回来 group=物理 / child=高中物理 / body 正常）。
     * 真正会出事的是名字里的冒号或半角竖线（解析器会把标题切成「名称 | 值」）。
     */
    const title = text(band.title);
    if (/[:：]/.test(title) || title.includes("|")) {
      warnings.add(
        `学科「${subjectName}」的小节「${title}」名字里有冒号或半角竖线：` +
          "解析器会把它切成「名称 | 值」的字段条目，而不是小节。",
      );
    }
    const body = bodyForFile(text(band.body).trim(), `小节「${title}」的正文`, warnings);
    blocks.push(`#### ${title}\n\n${body}`);
  }
  return blocks.join("\n\n");
}

/** 选修课：`#### 名字` + 栏目 + 介绍 + 状态。 */
function electiveBlock(course: PublicSite["courses"][number], site: PublicSite, warnings: Warnings): string {
  checkName(course.name, "选修课", warnings);
  const group = placeOf(site, course.partitionId).column;
  const blocks: string[] = [];
  const intro = text(course.intro).trim();
  if (group !== "") blocks.push(`- · 栏目: ${group}`);
  if (intro !== "") {
    blocks.push(bodyForFile(intro, `选修课「${course.name}」的介绍`, warnings));
  }
  /*
   * ⚠️ `状态` **开放的也要写**：解析器认出"这一组是选修课"的判据是
   * **每个子项都有 `状态` 字段**（`getCoursesPageFromTemplate` 的 `isElectiveGroup`）。
   * 只给未开放的那些写，整组会被读成"学科"—— 开放的选修课跑到学科网格里、选修课那一摊整块消失。
   * 文件里原来的四条全是"暂未开放"，所以这个坑一直没露出来。
   */
  blocks.push(course.status === "开放" ? "- · 状态: 开放" : "- · 状态: 暂未开放");
  return [`#### ${course.name}`, blocks.join("\n\n")].join("\n\n");
}

/** 教师字段的规范顺序（文件里没有对应块时用它）。 */
const TEACHER_FIELD_ORDER = ["排序", "类型", "职务", "科目", "教龄", "简介", "推荐理由", "状态"];

/** 教师字段（跳过空值；`排序` 与 AI 标记总要写）。 */
function teacherFields(teacher: PublicSite["teachers"][number]): Array<[string, string]> {
  const rows: Array<[string, string]> = [["排序", String(teacher.order)]];
  if (teacher.kind === "AI") rows.push(["类型", "AI"]);
  if (text(teacher.role).trim() !== "") rows.push(["职务", text(teacher.role).trim()]);
  if ((teacher.subjects ?? []).length > 0) rows.push(["科目", teacher.subjects.join(", ")]);
  if (text(teacher.years).trim() !== "") rows.push(["教龄", text(teacher.years).trim()]);
  if (text(teacher.summary).trim() !== "") rows.push(["简介", text(teacher.summary).trim()]);
  if (text(teacher.recommendation).trim() !== "") {
    rows.push(["推荐理由", text(teacher.recommendation).trim()]);
  }
  if (!teacher.active) rows.push(["状态", "离职"]);
  return rows;
}

/** 现有文件里每位教师的字段顺序（按姓名、以及按 `排序` 值各记一份）。 */
function teacherFieldOrders(
  lines: readonly string[],
  span: PageSpan | undefined,
): { byName: Map<string, string[]>; byOrder: Map<string, string[]> } {
  const byName = new Map<string, string[]>();
  const byOrder = new Map<string, string[]>();
  if (span === undefined) return { byName, byOrder };
  const from = span.fields === null ? span.markerIndex + 1 : span.fields.close + 1;
  for (const group of groupSpans(lines, from, span.end, 3)) {
    const name = headingText(lines[group.headingIndex] ?? "");
    const titles: string[] = [];
    let orderValue = "";
    for (let index = group.headingIndex + 1; index < group.end; index += 1) {
      const line = lines[index] ?? "";
      if (headingLevel(line) === 0) continue;
      const title = headingText(line).split(/[:：]/)[0]?.trim() ?? "";
      if (title === "") continue;
      titles.push(title);
      if (title === "排序") {
        orderValue = headingText(line).replace(/^排序\s*[:：]\s*/, "").trim();
      }
    }
    byName.set(name, titles);
    if (orderValue !== "" && !byOrder.has(orderValue)) byOrder.set(orderValue, titles);
  }
  return { byName, byOrder };
}

/** content.md：六个页面。 */
function contentFile(site: PublicSite, source: string, warnings: Warnings, missing: string[]): string {
  const lines = source.split("\n");
  const spans = pageSpans(lines);
  const teacherSpan = spans.find((span) => span.name === "教师");
  const orders = teacherFieldOrders(lines, teacherSpan);

  const copy = (key: SiteCopyKey): SiteCopyBlock | undefined => site.siteContent.copy?.[key];
  const groupBlocks = (key: SiteCopyKey): GroupSpec[] =>
    (copy(key)?.groups ?? []).map((group) => {
      if (group.description.trim() !== "") {
        warnings.add(
          `「${group.title}」分组在后台有一段分组说明，但内容文件的分组说明读的是**文件正文**` +
            "（库里那一栏不参与解析）—— 它没有被写进文件。",
        );
      }
      return {
        heading: `### ${group.title}`,
        preserveHead: true,
        blocks: (group.items ?? []).map((item) => {
          const line = itemLine(text(item.title), text(item.value), warnings, `分组「${group.title}」`);
          const body = text(item.body).trim();
          if (body === "") return line;
          const safe = bodyForFile(body, `分组「${group.title}」里「${item.title}」的正文`, warnings);
          return `${line}\n\n${safe}`;
        }),
      };
    });

  const subjects = [...site.siteContent.coursePage.subjects].sort((a, b) => a.order - b.order);
  const electiveTitle = text(site.siteContent.coursePage.electiveTitle).trim();
  const electives = [...(site.courses ?? [])]
    .filter((course) => course.siteKind === "选修")
    .sort((a, b) => a.order - b.order);

  const pages: PageSpec[] = [
    {
      name: "全站",
      fields: copyFields(copy("brand")),
      groups: [{ heading: "### 课程栏目", preserveHead: true, blocks: courseCardBlocks(site, warnings) }],
    },
    { name: "首页", fields: copyFields(copy("home")), groups: groupBlocks("home") },
    {
      name: "课程",
      fields: headingFields(site.siteContent.coursePage.heading),
      groups: [
        ...subjects.map((subject): GroupSpec => {
          checkName(subject.name, "学科", warnings);
          const body = subjectBody(subject.unavailable, subject.lead, subject.bands, warnings, subject.name);
          return {
            heading: `### ${subject.name}`,
            // 学科的导语与小节都是库里那一份，标题下的说明由 blocks 生成
            preserveHead: false,
            blocks: body === "" ? [] : [body],
          };
        }),
        {
          heading: `### ${electiveTitle === "" ? "选修课程" : electiveTitle}`,
          preserveHead: true,
          blocks: electives.map((course) => electiveBlock(course, site, warnings)),
        },
      ],
    },
    {
      name: "教师",
      fields: headingFields(site.siteContent.teacherPage.heading),
      groups: site.teachers
        .filter((teacher) => teacher.siteVisible === true)
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((teacher): GroupSpec => {
          checkName(teacher.name, "教师", warnings);
          const values = new Map(teacherFields(teacher));
          const preferred =
            orders.byName.get(teacher.name) ??
            orders.byOrder.get(String(teacher.order)) ??
            TEACHER_FIELD_ORDER;
          const ordered = [
            ...preferred.filter((key) => values.has(key)),
            ...TEACHER_FIELD_ORDER.filter((key) => values.has(key) && !preferred.includes(key)),
          ];
          const blocks = ordered.map((key) => `#### ${key}: ${values.get(key) ?? ""}`);
          const bio = (teacher.bio ?? "").trim();
          if (bio !== "") {
            blocks.push(bodyForFile(bio, `教师「${teacher.name}」的介绍`, warnings));
          }
          return { heading: `### ${teacher.name}`, preserveHead: true, blocks };
        }),
    },
    { name: "关于", fields: copyFields(copy("about")), groups: groupBlocks("about") },
    { name: "联系我们", fields: copyFields(copy("contact")), groups: groupBlocks("contact") },
  ];

  return rewriteFile(source, 3, pages, warnings, missing);
}

/* ── 八、pricing.md ───────────────────────────────────────────────────── */

/** 报价页短字段：库里的键（`result`…）→ 文件里的键（`result_title`…）。 */
const PRICING_LABEL_KEYS: ReadonlyArray<readonly [keyof PricingData["labels"], string]> = [
  ["result", "result_title"],
  ["submit", "submit_label"],
  ["reset", "reset_label"],
  ["unitPriceLabel", "unit_price_label"],
  ["unit", "unit_label"],
  ["totalLabel", "total_label"],
  ["formulaNote", "formula_note"],
  ["calculatorTitle", "calculator_title"],
  ["calculatorHint", "calculator_hint"],
  ["otherTitle", "other_title"],
  ["lessonsLabel", "lessons_label"],
  ["lessonsHint", "lessons_hint"],
  ["durationLabel", "duration_label"],
  ["classSizeLabel", "class_size_label"],
  ["classCostLabel", "class_cost_label"],
  ["classCostHint", "class_cost_hint"],
];

/**
 * 把公开数据里的报价拼成一份 `PricingConfig`（导出 Markdown 用）。
 *
 * `teacherShare` 公开接口不给（内部成本口径），因此由调用方从**现有文件**读进来：
 * 那一节继续以文件为准，导出不碰它。
 */
function pricingConfigFromSite(site: PublicSite, teacherShare: TeacherShareRules): PricingConfig {
  const pricing = site.pricing;
  return {
    rules: pricing.rules,
    teacherShare,
    stages: (pricing.stages ?? []).map((stage) => ({
      name: stage.name,
      courses: (stage.courses ?? []).map((course) => ({
        name: course.name,
        basePrice: course.basePrice,
        available: course.available,
      })),
    })),
    classTypes: (pricing.classTypes ?? []).map((item) => ({
      name: item.name,
      formatId: "",
      mode: item.mode,
      coefficient: item.coefficient,
    })),
    durations: (pricing.durations ?? []).map((item) => ({
      name: item.name,
      hours: item.hours,
      multiplier: item.multiplier,
    })),
    trial:
      pricing.trial === null || pricing.trial === undefined
        ? null
        : { name: pricing.trial.name, priceLabel: pricing.trial.priceLabel },
    otherItems: (pricing.otherItems ?? []).map((item) => ({
      name: item.name,
      details: (item.details ?? []).map((detail) => ({ title: detail.title, value: detail.value })),
    })),
    source: "",
    updatedAt: "",
  };
}

/** 从现有 pricing.md 里读教师分成规则。 */
function teacherShareFrom(source: string, notes: string[], warnings: Warnings): TeacherShareRules {
  try {
    const data = parsePricingSource(source);
    notes.push(
      "「报价 → 教师分成」沿用 `data/site/pricing.md` 里原有的一份：它是机构内部成本口径，" +
        "公开接口（`/api/public/site`）不给这一项。",
    );
    return data.teacherShare;
  } catch {
    warnings.add("读不出 `data/site/pricing.md` 里的教师分成规则（文件可能坏了），已用默认值。");
    return DEFAULT_TEACHER_SHARE_RULES;
  }
}

/**
 * 报价正文：`pricingConfigToMarkdown()` 生成的片段 + **文件里每个 `## 分组` 标题下的说明**。
 *
 * 说明文字（「这里的『系数』是人数系数…」）只在文件里，库里与公开接口都没有，
 * 生成器也不会产出 —— 因此这里按 `## 标题` 对齐，把文件里那几行搬回去。
 */
function pricingBody(config: PricingConfig, existing: readonly string[], startIndex: number): string[] {
  const generated = pricingConfigToMarkdown(config).split("\n");
  const existingBody = existing.slice(startIndex);

  const heads = new Map<string, string[]>();
  for (let index = 0; index < existingBody.length; index += 1) {
    const line = existingBody[index] ?? "";
    if (!/^##\s+/.test(line) || /^##\s+页面\s*[:：]/.test(line)) continue;
    const title = headingText(line);
    let stop = existingBody.length;
    for (let scan = index + 1; scan < existingBody.length; scan += 1) {
      if (/^#{2,6}\s+/.test(existingBody[scan] ?? "")) {
        stop = scan;
        break;
      }
    }
    heads.set(title, trimBlankEdges(existingBody.slice(index + 1, stop)));
  }

  const out: string[] = [];
  for (let index = 0; index < generated.length; index += 1) {
    const line = generated[index] ?? "";
    if (!/^##\s+/.test(line)) {
      out.push(line);
      continue;
    }
    out.push(line);
    const head = heads.get(headingText(line)) ?? [];
    if (head.length > 0) {
      // 生成器在标题后写了一个空行：说明行插在那里，它后面的空行照写（说明与 `###` 之间要空一行）
      out.push("", ...head, "");
      if ((generated[index + 1] ?? "") === "") index += 1;
    }
  }
  return trimBlankEdges(out);
}

/** pricing.md：短字段（页面文案）+ 正文（复用后台的导出器）。 */
function pricingFile(
  site: PublicSite,
  source: string,
  notes: string[],
  warnings: Warnings,
  missing: string[],
): string {
  const lines = source.split("\n");
  const span = pageSpans(lines).find((item) => item.name === "智能报价");
  if (span === undefined) missing.push("智能报价");
  const teacherShare = teacherShareFrom(source, notes, warnings);
  const labels = site.siteContent.pricingPage.labels;
  const fields = PRICING_LABEL_KEYS.map(
    ([key, fileKey]) => [fileKey, labels[key] ?? ""] as [string, string],
  );

  const existingFields = span?.fields == null ? [] : lines.slice(span.fields.open + 1, span.fields.close);
  const nextFields = rewriteFields(existingFields, fields, warnings, "页面「智能报价」");
  const bodyStart = span?.fields == null ? 0 : span.fields.close + 1;

  // 短字段与第一个分组之间的页面说明（「页面文案在上方短字段里…」）原样保留
  let firstGroup = lines.length;
  for (let index = bodyStart; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index] ?? "")) {
      firstGroup = index;
      break;
    }
  }
  const pageHead = lines.slice(bodyStart, firstGroup);

  const out = [
    ...withNotice(lines.slice(0, span === undefined ? 0 : span.markerIndex)),
    span?.marker ?? "## 页面: 智能报价",
    "",
    "---",
    ...nextFields,
    "---",
    ...pageHead,
    ...pricingBody(pricingConfigFromSite(site, teacherShare), lines, firstGroup),
  ];
  return endWith(out, source);
}

/* ── 九、faq.md / cases.md / featured.md / schedule.md ────────────────── */

/** faq.md：`## 分组` + `### 问题 | 答案`。 */
function faqFile(site: PublicSite, source: string, warnings: Warnings, missing: string[]): string {
  const page = site.siteContent.faqPage;
  const spec: PageSpec = {
    name: "常见问题",
    fields: headingFields(page.heading, page.notice),
    groups: (page.groups ?? []).map((group): GroupSpec => {
      checkName(group.title, "常见问题分组", warnings);
      return {
        heading: `## ${group.title}`,
        preserveHead: true,
        // 问答条目没有"正文"这一栏（`SiteFaqItem` 只有问题与答案），
        // 而解析器也只读 `### 问题 | 答案` 那一行 —— 多行的答案写不进文件
        blocks: (group.items ?? []).map((item) =>
          itemLine(text(item.question), text(item.answer), warnings, `常见问题「${group.title}」`, "###"),
        ),
      };
    }),
  };
  return rewriteFile(source, 2, [spec], warnings, missing);
}

/** cases.md：`### 案例标题` + 字段 + 过程描述。 */
function casesFile(site: PublicSite, source: string, warnings: Warnings, missing: string[]): string {
  const page = site.siteContent.casesPage;
  const spec: PageSpec = {
    name: "学生案例",
    fields: headingFields(page.heading, page.notice),
    groups: (page.cases ?? []).map((item): GroupSpec => {
      checkName(item.title, "案例", warnings);
      const blocks = (item.fields ?? [])
        .filter((field) => text(field.value).trim() !== "")
        .map((field) => {
          if (text(field.title).includes(":")) {
            warnings.add(`案例「${item.title}」的字段「${field.title}」里有冒号：字段名会被截断。`);
          }
          return `#### ${field.title}: ${text(field.value).replace(/\s*\n\s*/g, " ")}`;
        });
      const story = text(item.story).trim();
      if (story !== "") {
        blocks.push(bodyForFile(story, `案例「${item.title}」的过程描述`, warnings));
      }
      return { heading: `### ${item.title}`, preserveHead: false, blocks };
    }),
  };
  return rewriteFile(source, 3, [spec], warnings, missing);
}

/** 特色课程可用的字段（解析器的白名单）。 */
const FEATURED_FIELDS = ["适合对象", "课程定位", "主要做法", "可以期待"] as const;

/**
 * 一门特色课程（含子课程）：字段 + 正文 + 子课程。
 *
 * `level` 是**本门课程的标题层级**（一级 = 3），子课程比它深一级。
 */
function featuredCourseBlock(
  course: PublicSite["siteContent"]["featuredPage"]["courses"][number],
  level: number,
  warnings: Warnings,
  tightHeadings: ReadonlySet<string> = new Set(),
): string {
  checkName(course.name, "特色课程", warnings);
  const fieldLines: string[] = [];
  const slug = text(course.slug).trim() !== "" ? text(course.slug).trim() : deriveSlug(course.name);
  if (slug === "") {
    warnings.add(`特色课程「${course.name}」没有路径、也派生不出路径：网址会拼出空分段，点进去是 404。`);
  } else {
    fieldLines.push(`- · 路径: ${slug}`);
  }
  for (const field of course.fields ?? []) {
    if (text(field.value).trim() === "") continue;
    if (!FEATURED_FIELDS.includes(text(field.title) as (typeof FEATURED_FIELDS)[number])) {
      warnings.add(
        `特色课程「${course.name}」的字段「${field.title}」不在可用字段（${FEATURED_FIELDS.join(" / ")}）里：` +
          "内容文件读不回这个字段（可用字段是解析器的白名单）。",
      );
    }
    fieldLines.push(`- · ${field.title}: ${field.value}`);
  }
  const blocks: string[] = [];
  if (fieldLines.length > 0) blocks.push(fieldLines.join("\n"));
  const body = text(course.body).trim();
  if (body !== "") {
    blocks.push(bodyForFile(body, `特色课程「${course.name}」的介绍`, warnings));
  }
  let out = blocks.join("\n\n");
  for (const child of course.children ?? []) {
    const childText = `${"#".repeat(level + 1)} ${child.name}\n\n${featuredCourseBlock(
      child,
      level + 1,
      warnings,
      tightHeadings,
    )}`;
    /*
     * 正文与下一个课程标题之间的空行**按原文件来**：featured.md 里「周中预习课」的正文
     * 后面直接就是「#### 假期预习课」（没有空行）。空行的有无不是内容，
     * 导出替它补一个只会制造与数据无关的 diff。
     */
    out += `${tightHeadings.has(child.name) ? "\n" : "\n\n"}${childText}`;
  }
  return out;
}

/**
 * 原文案里"上一行不是空行"的标题（井号 ≥ 3）。
 *
 * 只用来决定导出时那两行之间要不要空行 —— 空行数不是数据，原样保留才不会
 * 让每次导出都改到文件里与内容无关的地方。
 */
function tightHeadings(source: string): Set<string> {
  const lines = source.split("\n");
  const tight = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    if (headingLevel(lines[index] ?? "") >= 3 && (lines[index - 1] ?? "").trim() !== "") {
      tight.add(headingText(lines[index] ?? ""));
    }
  }
  return tight;
}

/** featured.md：`### 一级课程` → `#### 二级` → `##### 三级`。 */
function featuredFile(site: PublicSite, source: string, warnings: Warnings, missing: string[]): string {
  const page = site.siteContent.featuredPage;
  const tight = tightHeadings(source);
  const spec: PageSpec = {
    name: "特色课程",
    fields: headingFields(page.heading, page.notice),
    groups: (page.courses ?? []).map((course): GroupSpec => ({
      heading: `### ${course.name}`,
      preserveHead: false,
      blocks: [featuredCourseBlock(course, 3, warnings, tight)],
    })),
  };
  return rewriteFile(source, 3, [spec], warnings, missing);
}

/** schedule.md：`### 分组` + `#### 时段 | 内容`。 */
function scheduleFile(site: PublicSite, source: string, warnings: Warnings, missing: string[]): string {
  const block = site.siteContent.copy?.schedule;
  const spec: PageSpec = {
    name: "课程时间安排",
    fields: copyFields(block),
    groups: (block?.groups ?? []).map((group): GroupSpec => ({
      heading: `### ${group.title}`,
      preserveHead: true,
      blocks: (group.items ?? []).map((item) =>
        itemLine(text(item.title), text(item.value), warnings, `时间安排「${group.title}」`),
      ),
    })),
  };
  return rewriteFile(source, 3, [spec], warnings, missing);
}

/* ── 十、导出主函数 ───────────────────────────────────────────────────── */

export function exportSiteMarkdown(input: SiteExportInput): SiteExportResult {
  const { site, existing } = input;
  const warnings = new Warnings();
  const notes: string[] = [];

  const missingPages: Record<SiteExportFile, string[]> = {
    content: [],
    pricing: [],
    faq: [],
    cases: [],
    featured: [],
    schedule: [],
  };
  const files: Record<SiteExportFile, string> = {
    content: contentFile(site, existing.content, warnings, missingPages.content),
    pricing: pricingFile(site, existing.pricing, notes, warnings, missingPages.pricing),
    faq: faqFile(site, existing.faq, warnings, missingPages.faq),
    cases: casesFile(site, existing.cases, warnings, missingPages.cases),
    featured: featuredFile(site, existing.featured, warnings, missingPages.featured),
    schedule: scheduleFile(site, existing.schedule, warnings, missingPages.schedule),
  };

  // 不展示的教师**不写进文件**：`.md` 表达不了「在后台但不上网站」这个开关，
  // 写进去就等于把他们发到线上（线上读的就是这份文件）。
  const hidden = (site.teachers ?? []).filter((teacher) => teacher.siteVisible !== true);
  if (hidden.length > 0) {
    notes.push(
      `有 ${String(hidden.length)} 位教师在后台设了「不在网站展示」（${hidden
        .map((teacher) => teacher.name)
        .join("、")}）：内容文件里没有这个开关，因此**没有**写进文件。`,
    );
  }

  /*
   * 文件不见了 / 是空的 / 页面标记没认出来 → **不许写**。
   *
   * 这条护栏是防"一次导出把内容文件抹成两行"的：`## 页面: xxx` 一旦被改坏
   * （或者文件本来就不在），生成出来的是一份没有页面的残骸，而写盘是**静默**的。
   * 宁可让命令停下来，让人先 `git checkout -- data/site/xxx.md` 把文件找回来。
   */
  const unsafe = SITE_EXPORT_FILES.filter(
    (name) => existing[name].trim() === "" || missingPages[name].length > 0,
  ).map((name) => ({
    file: name,
    reason:
      existing[name].trim() === ""
        ? "文件不存在或是空的"
        : `页面标记没认出来（缺 ${missingPages[name].join("、")}）`,
  }));

  const changed = SITE_EXPORT_FILES.filter((name) => files[name] !== existing[name]);
  return { files, changed, notes, warnings: warnings.list, unsafe };
}

/* ── 十一、回读：把导出的文件读回"核心内容" ───────────────────────────── */

/**
 * 回读的实现**刻意与 `lib/data/*` 的解析口径一一对应**（每一处都写了指路注释）。
 *
 * 为什么不直接调 `lib/data/*` 那几个函数：它们读的是**编译进模块的**
 * `data/site/*.ts`（构站时的常量），拿不到"一份刚生成出来的字符串"。
 * 要让它们认任意源码，就得把 `lib/data/*` 改成"接收源码"的形状 —— 那是改动
 * 网站的数据层，而这一版只增加"导出"这一个方向。因此这里照口径再走一遍，
 * 并由 `scripts/check.mts` 第 43 节那条「回读 == 现实口径」的断言钉住两边不会漂。
 */
export type CopyCore = {
  /**
   * 短字段（**按 key 排序**）。
   *
   * 为什么是数组而不是对象、还要排序：字段在短字段块里的先后顺序**不是语义**
   * （后台改动字段顺序不该被算成"与文件不一致"），而对象比较是顺序敏感的。
   */
  fields: Array<[string, string]>;
  groups: Array<{
    title: string;
    description: string;
    items: Array<{ title: string; value: string; body: string }>;
  }>;
};

export type SiteCore = {
  copy: Record<SiteCopyKey, CopyCore>;
  teachersPage: { heading: SectionHeading; teachers: Teacher[] };
  courseColumns: CourseColumn[];
  coursesPage: {
    heading: SectionHeading;
    courses: Array<{
      nameZh: string;
      unavailable: boolean;
      lead: string;
      bands: Array<{ title: string; content: string }>;
    }>;
    electiveTitle: string;
    electiveGroups: Array<{
      title: string;
      items: Array<{ name: string; description: string; group: string; available: boolean }>;
    }>;
  };
  /** 报价：直接用 `pricingConfigCore()` 的结果（与后台的导出回读校验同一口径）。 */
  pricing: string;
  faq: FaqContent;
  /** 案例：**不比 `id`**（文件里没有这个字段，导入时按标题派生；改标题就会变）。 */
  cases: {
    eyebrow: string;
    title: string;
    description: string;
    notice: string;
    cases: Array<{
      title: string;
      fields: Array<{ title: string; value: string }>;
      from: string;
      to: string;
      story: string;
    }>;
  };
  featured: FeaturedContent;
};

/** 网站视图模型（库里那一份走这里，与回读那一份同形状）。 */
export type SiteViews = {
  copy: Record<SiteCopyKey, SiteCopyBlock> | undefined;
  teachersPage: { heading: SectionHeading; teachers: Teacher[] };
  courseColumns: CourseColumn[];
  coursesPage: {
    heading: SectionHeading;
    courses: Course[];
    electiveTitle: string;
    electiveGroups: Array<{ title: string; items: ElectiveCourse[] }>;
  };
  pricing: PricingData;
  faq: FaqContent;
  cases: CasesContent;
  featured: FeaturedContent;
};

/** 短字段：数组按换行拼（与 `copyBlocksFromContent` 存库时的写法一致）。 */
function fieldText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join("\n");
  return typeof value === "string" ? value : "";
}

/** 一个页面块 → 短字段 + 分组（按 `SITE_COPY_GROUPS` 过滤，与导入时同一口径）。 */
function copyCoreFromPage(page: PageBlock | undefined, key: SiteCopyKey): CopyCore {
  if (page === undefined) return { fields: [], groups: [] };
  const allowed = SITE_COPY_GROUPS[key];
  const fields = Object.entries(page.data)
    .filter(([name]) => name.trim() !== "")
    .map(([name, value]) => [name, fieldText(value)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    fields,
    groups: page.groups
      .filter((group) => allowed === "all" || allowed.includes(group.name))
      .map((group) => ({
        title: group.name,
        // `Section.note` 解析器永远是空串：分组说明在库里那一栏是后台专属的
        description: "",
        items: group.items.map((item) => ({
          title: item.title,
          value: item.value,
          body: item.body ?? "",
        })),
      })),
  };
}

/** 库里的文案块 → 核心形状。 */
export function copyCoreFromBlock(block: SiteCopyBlock | undefined): CopyCore {
  const fields = (block?.fields ?? [])
    .map((field) => [text(field.key), text(field.value)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    fields,
    groups: (block?.groups ?? []).map((group) => ({
      title: text(group.title),
      description: text(group.description),
      items: group.items.map((item) => ({
        title: text(item.title),
        value: text(item.value),
        body: text(item.body),
      })),
    })),
  };
}

export function readSiteCore(sources: Readonly<Record<SiteExportFile, string>>): SiteCore {
  // 每个文件各解析一次（六份内容分成六个文件，页面名不重叠）
  const content = parseDocument(sources.content);
  const faqDoc = parseDocument(sources.faq);
  const casesDoc = parseDocument(sources.cases);
  const featuredDoc = parseDocument(sources.featured);
  // 时间安排整块就是"页面文案块"（短字段 + 分组 = 文件全部内容），
  // 因此它不单独进核心：`copy.schedule` 已经把那一页读全了。
  const scheduleDoc = parseDocument(sources.schedule);
  const pageOf = (name: string): PageBlock | undefined => content.pages.get(name);

  const copy = {} as Record<SiteCopyKey, CopyCore>;
  for (const key of SITE_COPY_KEYS) {
    copy[key] = key === "schedule"
      ? copyCoreFromPage(scheduleDoc.pages.get(SITE_COPY_PAGES.schedule), key)
      : copyCoreFromPage(pageOf(SITE_COPY_PAGES[key]), key);
  }

  const courseColumns = readCourseColumns(sources.content);
  return {
    copy,
    teachersPage: readTeachersPage(pageOf("教师")),
    courseColumns,
    coursesPage: readCoursesPage(pageOf("课程")),
    // 报价同样按"网站上看到的那一份"回读（阶段 / 课程都把暂未开放的排到最后）
    pricing: pricingConfigCore(
      configFromPricingData(pricingWithUnavailableLast(parsePricingSource(sources.pricing)), ""),
    ),
    faq: readFaq(faqDoc.pages.get("常见问题")),
    cases: toCaseCore(readCases(casesDoc.pages.get("学生案例"))),
    featured: readFeatured(featuredDoc.pages.get("特色课程")),
  };
}

/** 课程页上真实存在的锚点（与 `lib/data/site.ts` 的 `courseSectionNames` 同一口径）。 */
function courseSectionNames(page: PageBlock | undefined): Set<string> {
  const names = new Set<string>();
  for (const group of page?.groups ?? []) {
    if (group.children.some((child) => child.name.includes("｜"))) names.add(group.name);
    for (const child of group.children) {
      names.add((child.name.split("｜")[0] ?? child.name).trim());
    }
  }
  return names;
}

/** 课程栏目（回读 `### 课程栏目` 的条目行；口径同 `getCourseColumnsFromTemplate`）。 */
function readCourseColumns(source: string): CourseColumn[] {
  const content = parseDocument(source);
  const page = content.pages.get("全站");
  const sections = courseSectionNames(content.pages.get("课程"));
  const columns: CourseColumn[] = [];

  for (const item of page?.groups.find((group) => group.name === "课程栏目")?.items ?? []) {
    const subgroupRaw = /子栏目\s*[:：]\s*([^·]+)/.exec(item.value)?.[1]?.trim() ?? "";
    const rest = item.value.replace(/子栏目\s*[:：][^·]*/, "");
    const columnTitle = /栏目\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    if (columnTitle === "") continue;
    const cardPath = /路径\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    const statusText = /状态\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    const formsText = /班型\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    const tagText = /标签\s*[:：]\s*(.+)$/.exec(rest)?.[1]?.trim() ?? "";
    const tags: CourseTag[] = tagText
      .split(/[、,，]/)
      .map((raw) => raw.trim())
      .filter((raw) => raw !== "")
      .map((raw) => {
        const [label = "", target] = raw.split(/→|->/).map((part) => part.trim());
        return { label, target: target !== undefined && target !== "" ? target : label };
      });

    const title = item.title.trim();
    const card: CourseColumnCard = {
      title,
      path: cardPath,
      unavailable: statusText === "暂未开放",
      forms: formsText
        .split(/[、,，]/)
        .map((part) => part.trim())
        .filter((part) => part !== ""),
      tags,
      target: sections.has(title) ? title : (tags[0]?.target ?? title),
    };

    let column = columns.find((entry) => entry.title === columnTitle);
    if (column === undefined) {
      column = { title: columnTitle, subgroups: [] };
      columns.push(column);
    }
    let subgroup = column.subgroups.find((entry) => entry.title === subgroupRaw);
    if (subgroup === undefined) {
      subgroup = { title: subgroupRaw, cards: [] };
      column.subgroups.push(subgroup);
    }
    subgroup.cards.push(card);
  }

  // 回读要给出**网站上看到的那一份**：子栏目内暂未开放的卡片排到最后（见文件头那段）
  return columns.map((column) => ({
    ...column,
    subgroups: column.subgroups.map((subgroup) => ({
      ...subgroup,
      cards: unavailableLast(subgroup.cards, (card) => card.unavailable),
    })),
  }));
}

/** 短字段三件套（口径同 `pageHeading`）。 */
function headingOf(page: PageBlock | undefined): SectionHeading {
  const data = page?.data ?? {};
  return {
    eyebrow: readString(data, "eyebrow"),
    title: readString(data, "title"),
    description: readString(data, "description"),
  };
}

/** 课程页（回读口径同 `getCoursesPageFromTemplate`）。 */
function readCoursesPage(page: PageBlock | undefined): SiteCore["coursesPage"] {
  const isElective = (group: Section): boolean =>
    group.children.length > 0 &&
    group.children.every((child) => child.fields.some((field) => field.name === "状态"));

  const subjectGroups = (page?.groups ?? []).filter((group) => !isElective(group));
  const electiveGroup = (page?.groups ?? []).find(isElective);

  const courses = subjectGroups.map((group) => ({
    nameZh: group.name,
    unavailable: group.fields.find((field) => field.name === "状态")?.value.trim() === "暂未开放",
    lead: group.body.trim(),
    bands: group.children.map((child) => ({ title: child.name, content: child.body.trim() })),
  }));

  const electives = (electiveGroup?.children ?? []).map((child) => ({
    name: child.name,
    description: child.body.trim(),
    group: child.fields.find((field) => field.name === "栏目")?.value.trim() ?? "",
    available: child.fields.find((field) => field.name === "状态")?.value.trim() !== "暂未开放",
  }));

  const electiveGroups: SiteCore["coursesPage"]["electiveGroups"] = [];
  for (const course of electives) {
    const title = course.group !== "" ? course.group : (electiveGroup?.name ?? "选修课程");
    const existing = electiveGroups.find((entry) => entry.title === title);
    if (existing !== undefined) existing.items.push(course);
    else electiveGroups.push({ title, items: [course] });
  }

  return {
    heading: headingOf(page),
    // 同样回读"网站上看到的那一份"：整组暂未开放的学科排最后
    courses: unavailableLast(courses, (course) => course.unavailable),
    electiveTitle: electiveGroup?.name ?? "",
    // 选修课：不可选的排到**它所在栏目分组内**的最后（分组本身的顺序不动）
    electiveGroups: unavailableLastInGroups(
      electiveGroups,
      (group) => group.items,
      (group, items) => ({ ...group, items }),
      (item) => !item.available,
    ),
  };
}

/** 教师页（回读口径同 `getTeachersPageFromTemplate`）。 */
function readTeachersPage(page: PageBlock | undefined): { heading: SectionHeading; teachers: Teacher[] } {
  const fieldOf = (group: Section, label: string): string =>
    group.items.find((item) => item.title === label)?.value ?? "";

  const teachers: Teacher[] = (page?.groups ?? [])
    .filter((group) => fieldOf(group, "科目") !== "" || fieldOf(group, "简介") !== "")
    .map((group) => {
      const order = Number.parseFloat(fieldOf(group, "排序"));
      const status = fieldOf(group, "状态");
      const kind = fieldOf(group, "类型");
      const last = group.items.at(-1);
      return {
        id: group.name,
        kind: kind.trim().toUpperCase() === "AI" ? ("ai" as const) : ("teacher" as const),
        name: group.name,
        role: fieldOf(group, "职务"),
        subjects: fieldOf(group, "科目")
          .split(/[,，、]/)
          .map((item) => item.trim())
          .filter((item) => item !== ""),
        years: fieldOf(group, "教龄"),
        summary: fieldOf(group, "简介"),
        recommendation: fieldOf(group, "推荐理由"),
        order: Number.isFinite(order) ? order : 999,
        active: status === "" || status === "在职",
        bio: [group.body, last?.body ?? ""]
          .map((part) => part.trim())
          .filter((part) => part !== "")
          .join("\n\n"),
      };
    })
    .filter((teacher) => teacher.active)
    .sort((a, b) => a.order - b.order);

  return { heading: headingOf(page), teachers };
}

/** 常见问题（回读口径同 `getFaqContentFromTemplate`）。 */
function readFaq(page: PageBlock | undefined): FaqContent {
  const groups = (page?.groups ?? []).map((group) => ({
    title: group.name,
    items: group.items.map((item) => ({ question: item.title, answer: item.value })),
  }));
  return {
    ...headingOf(page),
    notice: readString(page?.data ?? {}, "notice"),
    groups,
    count: groups.reduce((total, group) => total + group.items.length, 0),
  };
}

/** 学生案例（回读口径同 `getCasesContentFromTemplate`）。 */
function readCases(page: PageBlock | undefined): CasesContent {
  const CASE_FIELDS = ["年级", "科目", "入学水平", "当前水平", "辅导周期", "主要问题"];

  const cases: CaseItem[] = (page?.groups ?? []).map((group) => {
    const field = (name: string): string => group.items.find((item) => item.title === name)?.value ?? "";
    const last = group.items.at(-1);
    return {
      id: group.name,
      title: group.name,
      fields: CASE_FIELDS.map((name) => ({ title: name, value: field(name) })).filter(
        (item) => item.value !== "",
      ),
      from: field("入学水平"),
      to: field("当前水平"),
      story: [group.body, last?.body ?? ""]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join("\n\n"),
    };
  });

  return {
    ...headingOf(page),
    notice: readString(page?.data ?? {}, "notice"),
    cases: cases.filter((item) => item.story !== "" || item.fields.length > 0),
  };
}

/** 案例视图 → 核心内容（丢掉后台内部的 `id`：文件里没有它，导入时按标题派生）。 */
function toCaseCore(content: CasesContent): SiteCore["cases"] {
  return {
    eyebrow: content.eyebrow,
    title: content.title,
    description: content.description,
    notice: content.notice,
    cases: content.cases.map((item) => ({
      title: item.title,
      fields: item.fields,
      from: item.from,
      to: item.to,
      story: item.story,
    })),
  };
}

/** 特色课程（回读口径同 `getFeaturedContentFromTemplate`）。 */
function readFeatured(page: PageBlock | undefined): FeaturedContent {
  const COURSE_FIELDS = ["适合对象", "课程定位", "主要做法", "可以期待"];

  const toCourses = (
    sections: ReadonlyArray<Section>,
    parentSlugs: readonly string[],
  ): CourseDetail[] =>
    sections
      .map((section) => {
        const declared = section.fields.find((field) => field.name === "路径")?.value;
        // 派生规则与 `lib/data/featured.ts` 的 slugify / featured-tree 的 deriveSlug 一致
        const segment =
          declared !== undefined && declared !== ""
            ? declared
            : section.name
                .toLowerCase()
                .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
                .replace(/^-+|-+$/g, "");
        const slugs = [...parentSlugs, segment];
        return {
          slug: segment,
          path: slugs,
          name: section.name,
          fields: COURSE_FIELDS.map((name) => ({
            title: name,
            value: section.fields.find((field) => field.name === name)?.value ?? "",
          })).filter((item) => item.value !== ""),
          body: section.body.trim(),
          children: toCourses(section.children, slugs),
        };
      })
      .filter((course) => course.fields.length > 0 || course.body !== "" || course.children.length > 0);

  return {
    ...headingOf(page),
    notice: readString(page?.data ?? {}, "notice"),
    courses: toCourses(page?.groups ?? [], []),
  };
}

/** 网站视图模型 → 核心内容。 */
export function siteCoreFromViews(views: SiteViews): SiteCore {
  const copy = {} as Record<SiteCopyKey, CopyCore>;
  for (const key of SITE_COPY_KEYS) copy[key] = copyCoreFromBlock(views.copy?.[key]);

  return {
    copy,
    teachersPage: { heading: views.teachersPage.heading, teachers: views.teachersPage.teachers },
    courseColumns: views.courseColumns,
    coursesPage: {
      heading: views.coursesPage.heading,
      courses: views.coursesPage.courses.map((course) => ({
        nameZh: course.nameZh,
        unavailable: course.unavailable,
        lead: course.lead,
        bands: course.bands.map((band) => ({ title: band.title, content: band.content })),
      })),
      electiveTitle: views.coursesPage.electiveTitle,
      electiveGroups: views.coursesPage.electiveGroups.map((group) => ({
        title: group.title,
        items: group.items.map((item) => ({
          name: item.name,
          description: item.description,
          group: item.group,
          available: item.available,
        })),
      })),
    },
    pricing: pricingConfigCore(configFromPricingData(views.pricing, "")),
    faq: views.faq,
    cases: toCaseCore(views.cases),
    featured: views.featured,
  };
}
