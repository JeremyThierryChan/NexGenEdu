import contentSource from "@/data/site/content.md";
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

/** 一个列表分组：`### 分组名` 下的若干条目。 */
export type Group = {
  name: string;
  /** 分组标题下的说明文字，不会显示在页面上。 */
  note: string;
  /** 条目：`#### 标题 | 值`；body 是条目下方到下一个条目之间的正文。 */
  items: Array<{ title: string; value: string; body: string }>;
  /** 正文段落组（长文本场景）。 */
  body: string;
};

/** 一个页面的全部内容。 */
export type PageBlock = {
  /** 页面名称，对应 `## 页面: 首页` 里的「首页」。 */
  name: string;
  /** 该页面的短字段。 */
  data: Record<string, string | string[]>;
  groups: Group[];
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
function splitTitle(raw: string): { title: string; value: string } {
  const pipe = raw.indexOf("|");
  if (pipe !== -1) {
    return { title: raw.slice(0, pipe).trim(), value: raw.slice(pipe + 1).trim() };
  }
  const colon = raw.search(/[:：]/);
  if (colon !== -1) {
    return { title: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() };
  }
  return { title: raw.trim(), value: "" };
}

/** 按指定层级标题把正文切成块，返回 [标题, 块内容] 列表。 */
function splitByTitleLevel(markdown: string, level: number): Array<[string, string]> {
  const pattern = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`);
  const blocks: Array<[string, string]> = [];
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentTitle !== null) blocks.push([currentTitle, buffer.join("\n").trim()]);
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) {
      flush();
      currentTitle = match[1];
      continue;
    }
    if (currentTitle !== null) buffer.push(line);
  }
  flush();

  return blocks;
}

/** 解析一个分组块（`### 分组名` 的内容）。 */
function parseGroup(name: string, block: string): Group {
  const itemBlocks = splitByTitleLevel(block, 4);

  if (itemBlocks.length > 0) {
    const firstItemIndex = block.search(/^####\s/m);
    return {
      name,
      note: firstItemIndex === -1 ? "" : block.slice(0, firstItemIndex).trim(),
      items: itemBlocks.map(([title, body]) => ({ ...splitTitle(title), body })),
      body: "",
    };
  }

  // 没有条目则为正文组（长文本场景）。
  return { name, note: "", items: [], body: block.trim() };
}

/** 解析一个页面块。 */
function parsePage(name: string, block: string): PageBlock {
  const trimmed = block.trim();

  // 页面短字段是一个 `--- ... ---` 块，位于该页面内容的开头。
  if (!trimmed.startsWith("---")) {
    throw new Error(
      `data/site/content.md 的「## 页面: ${name}」缺少 --- 包裹的字段块。`,
    );
  }
  const closingIndex = trimmed.indexOf("\n---", 3);
  if (closingIndex === -1) {
    throw new Error(`data/site/content.md 的「## 页面: ${name}」字段块未闭合（缺少 ---）。`);
  }

  const fieldSource = trimmed.slice(3, closingIndex);
  const rest = trimmed.slice(closingIndex + 4);
  // 复用 parseMarkdown 的 frontmatter 解析：
  // 需要以 `---\n` 开头、以 `\n---` 结尾，因此这里补上新行。
  const { data } = parseMarkdown(`---\n${fieldSource.trim()}\n---\n`);

  return {
    name,
    data,
    groups: splitByTitleLevel(rest, 3).map(([groupName, groupBlock]) =>
      parseGroup(groupName, groupBlock),
    ),
  };
}

/**
 * 读取并解析 data/site/content.md。
 *
 * 故意不做进程内缓存：这样在 `npm run dev` 下修改 content.md 后，
 * 刷新页面即可看到最新内容，不需要重启开发服务器。
 * 文件很小（约 10 KB），解析成本可以忽略；生产构建期只会读取一次。
 */
export function loadContent(): ContentDocument {
  const source = contentSource;

  const pages = new Map<string, PageBlock>();
  for (const [rawName, block] of splitByTitleLevel(source, 2)) {
    const marker = /^页面\s*[:：]\s*(.+)$/.exec(rawName);
    if (marker?.[1] === undefined) continue; // 非页面段落（例如文件说明）跳过
    const page = parsePage(marker[1].trim(), block);
    pages.set(page.name, page);
  }

  if (pages.size === 0) {
    throw new Error("data/site/content.md 中没有找到任何「## 页面: xxx」段落。");
  }

  return { pages };
}

/** 取某个页面块，缺失时报错（避免静默渲染空页面）。 */
export function getPageBlock(name: string): PageBlock {
  const page = loadContent().pages.get(name);
  if (page === undefined) {
    throw new Error(`data/site/content.md 中缺少「## 页面: ${name}」段落。`);
  }
  return page;
}

/** 取分组，缺失时返回空分组（便于某页暂时不需要某组）。 */
export function getGroup(page: PageBlock, name: string): Group {
  return page.groups.find((group) => group.name === name) ?? { name, note: "", items: [], body: "" };
}

/** 读取页面短字段中的字符串。 */
export function pageString(page: PageBlock, key: string, fallback = ""): string {
  return readString(page.data, key, fallback);
}

/** 读取页面短字段中的数组。 */
export function pageArray(page: PageBlock, key: string): string[] {
  return readArray(page.data, key);
}

/** 页面是否仍为占位内容：显式写 placeholder: false 才算已替换。 */
export function isPagePlaceholder(page: PageBlock): boolean {
  return pageString(page, "placeholder", "true") !== "false";
}

export { parseItems };
