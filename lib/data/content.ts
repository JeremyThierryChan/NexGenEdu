import { contentSource } from "@/data/site/content";
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
  /** 该分组内部的子分组（`####` 层级）。例如报价页「科目」下的各科目项。 */
  children: Group[];
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
function parseGroup(name: string, block: string, depth: number): Group {
  const itemLevel = depth + 1;
  const childLevel = depth + 1;

  // 先看这一层有没有更深一层的子分组（例如「科目」下面还有「科目：数学」）。
  const childBlocks =
    depth < 5 ? splitByTitleLevel(block, childLevel + 1) : [];
  if (childBlocks.length > 0) {
    return {
      name,
      note: "",
      items: [],
      body: "",
      children: childBlocks.map(([childName, childBlock]) =>
        parseGroup(childName, childBlock, depth + 1),
      ),
    };
  }

  const itemBlocks = splitByTitleLevel(block, itemLevel);
  if (itemBlocks.length > 0) {
    const pattern = new RegExp(`^#{${itemLevel}}\\s`, "m");
    const firstItemIndex = block.search(pattern);
    return {
      name,
      note: firstItemIndex === -1 ? "" : block.slice(0, firstItemIndex).trim(),
      items: itemBlocks.map(([title, body]) => ({ ...splitTitle(title), body })),
      body: "",
      children: [],
    };
  }

  // 既没有子分组也没有条目，则为正文组（长文本场景）。
  return { name, note: "", items: [], body: block.trim(), children: [] };
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
  // 找字段块的结束分隔符：一行只有 `---` 的内容。
  //
  // 两个坑：
  //   1. 不能用 indexOf("\n---")：正文里的 Markdown 表格分隔行（| --- | --- |）会命中。
  //   2. 也不能用 /^---$/m：字段值里可能就有这样的表格（例如 `| 分组 | 基础价含义 |`
  //      后面跟的 | --- | --- |），那会匹配到字段块内部，把正文全部吃掉。
  // 因此限定：该行恰好是 `---`，且**不含冒号**（frontmatter 字段必然含冒号）。
  const closingMatch = /^---[ \t]*$/m.exec(trimmed.slice(3));
  if (closingMatch === null) {
    throw new Error(`data/site/content.md 的「## 页面: ${name}」字段块未闭合（缺少 ---）。`);
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
 * 收集页面内的分组。
 *
 * 兼容两种写法：
 *   - 页面内直接写 `### 分组名`（content.md 的约定）
 *   - 页面内写 `## 分组名`（pricing.md 的约定，与页面段落同级更直观）
 * 两种都支持是为了让数据文件按语义选择更自然的层级，解析结果一致。
 */
function collectGroups(rest: string): Group[] {
  const topLevel = splitByTitleLevel(rest, 2).filter(
    ([title]) => !/^页面\s*[:：]/.test(title),
  );

  if (topLevel.length > 0) {
    return topLevel.map(([groupName, groupBlock]) => {
      // 分组下面若还有 `### 子项`，继续向下一层展开
      const subGroups = splitByTitleLevel(groupBlock, 3);
      if (subGroups.length > 0) {
        return {
          name: groupName,
          note: "",
          items: [],
          body: "",
          // 子分组是三级标题，因此深度传 3：其条目为四级标题（depth + 1）。
          // 若这里传 4，就会去找五级标题，子项会全部解析为空。
          children: subGroups.map(([childName, childBlock]) =>
            parseGroup(childName, childBlock, 3),
          ),
        };
      }
      return parseGroup(groupName, groupBlock, 3);
    });
  }

  return splitByTitleLevel(rest, 3)
    .map(([groupName, groupBlock]) => parseGroup(groupName, groupBlock, 3))
    // 只丢弃空分组。注意不能只保留「有条目或子分组」的分组：
    // 课程分组的内容是正文（body），没有条目，那样会被整体丢掉。
    .filter(
      (group) =>
        group.items.length > 0 ||
        group.children.length > 0 ||
        group.body.trim() !== "",
    );
}

/**
 * 读取并解析 data/site/content.md。
 *
 * 故意不做进程内缓存：这样在 `npm run dev` 下修改 content.md 后，
 * 刷新页面即可看到最新内容，不需要重启开发服务器。
 * 文件很小（约 10 KB），解析成本可以忽略；生产构建期只会读取一次。
 */
export function loadContent(): ContentDocument {
  return parseDocument(contentSource);
}

/** 解析任意一份数据文件（content.md 之外的其它文件也复用同一套结构）。 */
export function parseDocument(source: string): ContentDocument {

  const pages = new Map<string, PageBlock>();

  // 按 `## 页面: xxx` 切块，而不是按任意二级标题。
  // 原因：页面内部的分组本身也可能是二级标题（例如报价页的「## 科目」），
  // 若按二级标题切块，页面块会在第一个分组处被截断，分组全部丢失。
  const markerPattern = /^##\s+页面\s*[:：]\s*(.+?)\s*$/;
  const lines = source.split(/\r?\n/);
  let currentName: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentName !== null) {
      const page = parsePage(currentName, buffer.join("\n"));
      pages.set(page.name, page);
    }
    buffer = [];
  };

  for (const line of lines) {
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
  return (
    page.groups.find((group) => group.name === name) ?? {
      name,
      note: "",
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
