import { casesSource } from "@/data/site/cases";
import { contentSource } from "@/data/site/content";
import { faqSource } from "@/data/site/faq";
import { featuredSource } from "@/data/site/featured";
import { scheduleSource } from "@/data/site/schedule";
import { parseItems, parseMarkdown, readArray, readString } from "@/lib/markdown";

/**
 * 单文件内容源。
 *
 * 全部可自定义内容都放在 data/site/content.md 一个文件里，按页面分段：
 *
 *   ## 页面: 首页
 *   ---
 *   title: 让学习真正发生      ← 该页面的短字段（frontmatter）
 *   ---
 *   ### 教学特色               ← 该页面的列表分组
 *   #### 小班教学 | 每班 4–8 人  ← 分组内的条目
 *
 * 这样只需维护一个文件，改完刷新页面即可看到效果。
 *
 * 读取方式：content.md 通过 webpack 的 asset/source 以字符串导入
 * （见 next.config.ts），因此它属于构建依赖 —— 开发时保存文件即触发重新编译，
 * 生产构建时内容被内联进产物。这样「改完刷新页面即生效」才成立。
 * 未来接入数据库时替换本文件实现即可，页面调用方式不变。
 */

/**
 * 一个节：页面内的分组，或分组下的子节。
 *
 * 层级由数据文件里的井号数决定（详见 buildTree）。
 */
export type Section = {
  name: string;
  /** 分组标题下的说明文字，不会显示在页面上。 */
  note: string;
  /**
   * 以 `- · 字段名: 内容` 声明的字段。
   *
   * 为什么要这个前缀：课程字段（适合对象 / 课程定位…）若写成同级标题，
   * 会与「子课程」在格式上无法区分（两者都是 `#### xxx`），
   * 造成子课程被当字段、或字段被当课程。加 `· ` 前缀后语义明确。
   */
  fields: Array<{ name: string; value: string }>;
  /** 条目：`#### 标题 | 值`；body 是条目下方到下一个条目之间的正文。 */
  items: Array<{ title: string; value: string; body: string }>;
  /** 正文段落组（长文本场景）。 */
  body: string;
  /** 该分组内部的子分组（`####` 层级）。例如报价页「科目」下的各科目项。 */
  children: Section[];
};

/** 兼容别名：分组与子节是同一结构。 */
export type Group = Section;

/** 一个页面的全部内容。 */
export type PageBlock = {
  /** 页面名称，对应 `## 页面: 首页` 里的「首页」。 */
  name: string;
  /** 该页面的短字段。 */
  data: Record<string, string | string[]>;
  groups: Section[];
};

export type ContentDocument = {
  /** 页面名 → 内容块。 */
  pages: Map<string, PageBlock>;
};

/**
 * 从标题行里解析出「名称 + 值」。
 *
 * 支持两种分隔符，按语义选用更自然的写法：
 *   `#### 班级规模 | 4–8 人`   列表项用竖线
 *   `#### 科目: 数学, 物理`    字段用冒号
 * 冒号只作为兜底：竖线优先，因此「1 : 6」这类含冒号的数值不会被误拆。
 */
function splitTitle(raw: string): {
  title: string;
  value: string;
  /** 是否为内容小节标题（而非 `字段: 值` 形式的条目）。 */
  isSection: boolean;
} {
  const pipe = raw.indexOf("|");

  if (pipe !== -1) {
    const head = raw.slice(0, pipe).trim();
    const tail = raw.slice(pipe + 1).trim();

    /**
     * 竖线前含**全角冒号**时判定为内容小节标题：
     *   小学数学｜建立数学基础        ← 小节标题，正文写在标题下方
     *   小学语文｜建立阅读与表达的基础  ← 同上
     * 而「标题 | 值」这类条目的值统一用半角冒号（`1 : 6`、`课程: 小学课内: 150`），
     * 因此全角冒号是区分「章节标题」与「条目」的可靠信号。
     */
    if (head.includes("：") && !tail.includes(":")) {
      return { title: raw.trim(), value: "", isSection: true };
    }
    return { title: head, value: tail, isSection: false };
  }

  const colon = raw.search(/[:：]/);
  if (colon !== -1) {
    return {
      title: raw.slice(0, colon).trim(),
      value: raw.slice(colon + 1).trim(),
      isSection: false,
    };
  }
  return { title: raw.trim(), value: "", isSection: true };
}

/** 解析一个分组块（`### 分组名` 的内容）。 */
/**
 * 内容文件的格式问题只警告、不抛错。
 *
 * 这样一处笔误不会让整页 500（此前需要重启开发服务器才能恢复），
 * 作者能在终端看到明确提示，页面则渲染为对应的空内容。
 */
function warn(message: string): void {
  console.warn(`[content] ${message}`);
}

/** 标题块：一段以某个层级标题开头的内容。 */
type HeadingBlock = {
  /** 标题层级（井号数）。 */
  level: number;
  /** 标题原文（未拆分）。 */
  rawTitle: string;
  /** 标题下的正文原文（不含子标题内容）。 */
  text: string;
  /** 更深层级的子标题块。 */
  children: HeadingBlock[];
};

/**
 * 把 Markdown 正文按标题层级**如实**建成树。
 *
 * 这里不做任何「哪一层是分组、哪一层是条目」的推断 ——
 * 之前靠 groupLevel±1 推断层级的做法在多层结构下反复出错
 * （`## 分组 → ### 阶段 → #### 条目` 会被压平、中间层消失）。
 * 现在层级完全由作者写的井号数决定，数据层按名字与层级取用。
 */
function buildTree(markdown: string): HeadingBlock[] {
  const root: HeadingBlock = { level: 0, rawTitle: "", text: "", children: [] };
  // 栈顶始终是当前正在填充的块
  const stack: HeadingBlock[] = [root];
  const plainLines: string[] = [];

  const flushPlain = () => {
    if (plainLines.length > 0) {
      const text = plainLines.join("\n").trim();
      const top = stack[stack.length - 1];
      if (top !== undefined && text !== "") {
        top.text = top.text === "" ? text : `${top.text}\n${text}`;
      }
      plainLines.length = 0;
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading?.[1] === undefined || heading[2] === undefined) {
      plainLines.push(line);
      continue;
    }

    flushPlain();
    const level = heading[1].length;
    const block: HeadingBlock = { level, rawTitle: heading[2], text: "", children: [] };

    // 弹栈直到找到层级更浅的父块
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (top !== undefined && top.level >= level) stack.pop();
      else break;
    }
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push(block);
    stack.push(block);
  }
  flushPlain();

  return root.children;
}

/** 把标题块转成节（含条目与子节）。 */
/** 从正文里解析 `- · 字段名: 内容` 形式的字段。 */
function parseFieldsFrom(text: string): Array<{ name: string; value: string }> {
  const fields: Array<{ name: string; value: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*[-*]\s*·\s*(.+?)\s*[:：]\s*(.*)$/.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    fields.push({ name: match[1].trim(), value: match[2].trim() });
  }
  return fields;
}

/** 与 parseFieldsFrom 配对：取走字段行后剩下的正文。 */
function withoutFieldLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*[-*]\s*·\s*.+?\s*[:：]/.test(line))
    .join("\n")
    .trim();
}

function blockToSection(block: HeadingBlock): Section {
  const parsed = splitTitle(block.rawTitle);
  const children = block.children.map(blockToSection);

  // 子块里有内容小节（`#### 学段｜一句话` + 正文）时，整体作为子分组
  const childItems = block.children.map((child) => {
    const item = splitTitle(child.rawTitle);
    return { item, child };
  });
  const allItems = childItems.every(({ item }) => !item.isSection);

  if (childItems.length > 0 && allItems && block.children[0]?.level === block.level + 1) {
    return {
      name: parsed.title,
      note: "",
      fields: parseFieldsFrom(block.text),
      items: childItems.map(({ item, child }) => ({
        title: item.title,
        value: item.value,
        body: child.text,
      })),
      body: "",
      children: [],
    };
  }

  return {
    name: parsed.title,
    note: "",
    fields: parseFieldsFrom(block.text),
    items: [],
    body: withoutFieldLines(block.text),
    children,
  };
}

/** 解析一个页面块。 */
/**
 * 收集页面内的分组：取页面正文里**最外层**的标题块。
 *
 * 层级完全由作者写的井号数决定，不做推断：
 *   `### 分组`              → 页面级分组
 *   `## 分组 → ### 阶段`     → 页面级分组是 `## 分组`，`### 阶段` 是它的子节
 * 数据层按名字查找即可，需要更深的层级就继续读 children。
 */
function collectGroups(rest: string): Section[] {
  return buildTree(rest).map(blockToSection);
}

/** 解析一个页面块。 */

/** 解析一个页面块。 */
function parsePage(name: string, block: string): PageBlock {
  const trimmed = block.trim();

  // 页面短字段是一个 `--- ... ---` 块，位于该页面内容的开头。
  if (!trimmed.startsWith("---")) {
    // 不抛错：内容文件的格式问题不应让整站 500，
    // 返回空短字段 + 该段落全部作为正文（页面仍可渲染，只是缺字段）。
    warn(`「## 页面: ${name}」缺少 --- 包裹的字段块，该段短字段将为空。`);
    return { name, data: {}, groups: collectGroups(trimmed) };
  }
  // 找字段块的结束分隔符：一行只有 `---` 的内容。
  //
  // 两个坑：
  //   1. 不能用 indexOf("\n---")：正文里的 Markdown 表格分隔行（| --- | --- |）会命中。
  //   2. 也不能用 /^---$/m：字段值里可能就有这样的表格（例如 `| 分组 | 基础价含义 |`
  //      后面跟的 | --- | --- |），那会匹配到字段块内部，把正文全部吃掉。
  // 因此限定：该行恰好是 `---`，且**不含冒号**（frontmatter 字段必然含冒号）。
  const closingMatch = /^---[ \t]*$/m.exec(trimmed.slice(3));
  if (closingMatch === null) {
    warn(`「## 页面: ${name}」字段块未闭合（缺少 ---），该段短字段将为空。`);
    return { name, data: {}, groups: collectGroups(trimmed) };
  }
  const closingIndex = 3 + closingMatch.index;
  const closingDelimiter = closingMatch[0];

  const fieldSource = trimmed.slice(3, closingIndex);
  const rest = trimmed.slice(closingIndex + closingDelimiter.length);
  // 复用 parseMarkdown 的 frontmatter 解析：
  // 需要以 `---\n` 开头、以 `\n---` 结尾，因此这里补上新行。
  const { data } = parseMarkdown(`---\n${fieldSource.trim()}\n---\n`);

  return { name, data, groups: collectGroups(rest) };
}

/**
 * 解析一份内容文件源码，得到「页面名 → 页面内容」的映射。
 *
 * 按 `## 页面: xxx` 切块（而不是按任意二级标题）：页面内部的分组本身
 * 也可能是二级标题，按二级标题切会把页面块截断。
 */
export function parseDocument(source: string): ContentDocument {
  const pages = new Map<string, PageBlock>();
  const markerPattern = /^##\s+页面\s*[:：]\s*(.+?)\s*$/;

  let currentName: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentName !== null) {
      const page = parsePage(currentName, buffer.join("\n"));
      pages.set(page.name, page);
    }
    buffer = [];
  };

  for (const line of source.split(/\r?\n/)) {
    // 跳过引用块（`> ...`）：文件头的说明里会写示例「## 页面: xxx」，
    // 不加这一条就会被当成真正的页面标记，导致页面名错乱或取到空页面。
    if (line.trimStart().startsWith(">")) continue;

    const marker = markerPattern.exec(line);
    if (marker?.[1] !== undefined) {
      flush();
      currentName = marker[1].trim();
      continue;
    }
    if (currentName !== null) buffer.push(line);
  }
  flush();

  if (pages.size === 0) {
    // 同样不抛错：文件内容有问题时页面继续渲染（内容为空），
    // 由控制台警告提示作者，而不是让用户看到 500。
    warn("内容文件中没有找到任何「## 页面: xxx」段落，本文件将被视为空。");
  }

  return { pages };
}

/**
 * 内容文件清单：文件名 → 源码。
 *
 * 分文件的理由：一个文件装全部页面会越来越长（现已 6 个页面 + 报价 + 时间表），
 * 按功能拆开后每个文件的用途更明确，改动的范围也更小。
 *
 * 解析规则完全一致：`## 页面: xxx` 分段，标题层级即数据结构。
 */
const DOCUMENTS = {
  content: contentSource,
  faq: faqSource,
  cases: casesSource,
  schedule: scheduleSource,
  featured: featuredSource,
} as const;

export type DocumentName = keyof typeof DOCUMENTS;

/** 解析后的文档缓存：文件内容是编译期常量，解析结果可安全复用。 */
const documentCache = new Map<DocumentName, ContentDocument>();

/**
 * 取某个内容文件（已解析）。
 *
 * 缓存策略有个例外：**解析结果为空时不缓存**。
 * 原因：内容文件写错（例如页面标记被改坏）时解析结果为空，
 * 若把空结果缓存下来，作者改回正确内容后本进程仍会返回旧的空结果 ——
 * 表现为「改好了还是空白，必须重启」。空结果解析成本极低，重解析即可。
 */
export function getDocument(name: DocumentName): ContentDocument {
  const cached = documentCache.get(name);
  if (cached !== undefined) return cached;

  const source = DOCUMENTS[name];
  const doc = parseDocument(source);
  if (doc.pages.size === 0) return doc; // 不缓存空结果
  documentCache.set(name, doc);
  return doc;
}

/**
 * 取指定页面的内容块。
 * @param document 内容文件名（不含 .md），默认 content
 * @param page     页面名，对应 `## 页面: xxx` 里的名称
 */
export function getPage(document: DocumentName, page: string): PageBlock {
  const found = getDocument(document).pages.get(page);
  if (found !== undefined) return found;

  // 缓存里没有该页面时，清掉本文件缓存后重解析一次：
  // 内容可能刚被修好，而缓存里留着上一版（缺少该页面）的结果。
  documentCache.delete(document);
  const retried = getDocument(document).pages.get(page);
  if (retried !== undefined) return retried;

  // 严禁 500：页面名写错（例如手改时改动了「## 页面: xxx」）时
  // 只提示作者并渲染空内容，站点其余部分不受影响。
  warn(
    `data/site/${document}.md 中缺少「## 页面: ${page}」段落。` +
      `请检查该文件的页面标记是否被改动。本页将渲染为空。`,
  );
  return { name: page, data: {}, groups: [] };
}

/** 页面是否存在（需要区分「空页面」与「页面为空的正常情况」时使用）。 */
export function hasPage(document: DocumentName, page: string): boolean {
  return getDocument(document).pages.has(page);
}

/** 取 content.md 里的页面（最常用，单独提供便捷函数）。 */
export function getPageBlock(name: string): PageBlock {
  return getPage("content", name);
}

/** 取分组，缺失时返回空分组（便于某页暂时不需要某组）。 */
export function getGroup(page: PageBlock, name: string): Group {
  return (
    page.groups.find((group) => group.name === name) ?? {
      name,
      note: "",
      fields: [],
      items: [],
      body: "",
      children: [],
    }
  );
}

/** 读取页面短字段中的字符串。 */
export function pageString(page: PageBlock, key: string, fallback = ""): string {
  return readString(page.data, key, fallback);
}

/** 读取页面短字段中的数组。 */
export function pageArray(page: PageBlock, key: string): string[] {
  return readArray(page.data, key);
}

export { parseItems };
