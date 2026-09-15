/**
 * 极简 Markdown 解析工具。
 *
 * 只实现数据文件真正需要的语法子集：frontmatter、标题、列表、段落、粗体。
 * 不引入 marked / gray-matter 等依赖：数据文件由本项目自己书写，
 * 语法可控，保持零依赖更容易长期维护。
 *
 * 约定：所有 data/ 下的文件都是「--- frontmatter --- + 正文」结构。
 */

/** 解析结果：结构化字段 + 正文原文 + 按标题切分的小节 + 「标题 | 值」形式的条目。 */
export type ParsedMarkdown = {
  /** frontmatter 解析出的字段，值一律为字符串或字符串数组。 */
  data: Record<string, string | string[]>;
  /** frontmatter 之后的正文原文。 */
  body: string;
  /** 按二级标题（## ）切分的小节，键为标题文本。 */
  sections: Record<string, string>;
  /**
   * 形如 `## 标题 | 值` 的条目列表（保持文档顺序）。
   * 用于需要在文档里逐行增删的列表数据，比 frontmatter 数组更好编辑，
   * 也不会出现「两个数组长度不一致」的隐患。
   */
  items: Array<{ title: string; value: string }>;
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * 去除值两端引号。YAML 里手机号、时间等需要引号包裹，
 * 解析时必须剥掉，否则会带进渲染结果。
 */
function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * 解析 frontmatter。
 * 支持两种值：
 *   key: 字符串
 *   key:\n  - 数组项\n  - 数组项
 * 不支持的语法（嵌套对象、多行字符串、注释）会被忽略，避免过度设计。
 */
function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};
  const lines = raw.split(/\r?\n/);
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // 数组项：  - 值
    if (trimmed.startsWith("- ")) {
      if (currentKey === null) continue;
      const value = unquote(trimmed.slice(2));
      const existing = data[currentKey];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        data[currentKey] = [value];
      }
      continue;
    }

    // 键值对：key: value
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (key === "") continue;

    if (rawValue === "") {
      // 形如 `key:`，后面可能跟数组项
      currentKey = key;
      data[key] = [];
    } else {
      currentKey = null;
      data[key] = unquote(rawValue);
    }
  }

  return data;
}

/** 按 `## 标题` 切分正文为小节。 */
function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentTitle !== null) {
      sections[currentTitle] = buffer.join("\n").trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      flush();
      currentTitle = match[1];
      continue;
    }
    if (currentTitle !== null) buffer.push(line);
  }
  flush();

  return sections;
}

/**
 * 抽取形如 `## 标题 | 值` 的条目。
 * 一个文件里只有某个小节内部使用该格式时，可以传入 section 限定范围。
 */
export function parseItems(markdown: string): Array<{ title: string; value: string }> {
  const items: Array<{ title: string; value: string }> = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^##\s+(.+?)\s*\|\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      items.push({ title: match[1], value: match[2] });
    }
  }
  return items;
}

/** 解析一个 Markdown 数据文件。 */
export function parseMarkdown(source: string): ParsedMarkdown {
  const match = FRONTMATTER_PATTERN.exec(source);

  if (match === null) {
    // 没有 frontmatter 也允许：整篇作为正文。
    return {
      data: {},
      body: source.trim(),
      sections: parseSections(source),
      items: parseItems(source),
    };
  }

  const [, frontmatter = "", body = ""] = match;
  return {
    data: parseFrontmatter(frontmatter),
    body: body.trim(),
    sections: parseSections(body),
    items: parseItems(body),
  };
}

/** 读取字符串字段，缺失时返回 fallback。 */
export function readString(
  data: Record<string, string | string[]>,
  key: string,
  fallback = "",
): string {
  const value = data[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? fallback;
  return fallback;
}

/** 读取数组字段。单值写法（key: 值）会被包装成长度为 1 的数组。 */
export function readArray(
  data: Record<string, string | string[]>,
  key: string,
): string[] {
  const value = data[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

/**
 * 极简 Markdown → HTML 渲染。
 *
 * 仅支持数据文件中会用到的语法：## 标题、- 列表、**粗体**、空行分段。
 * 输出内容全部来自本项目自己的 .md 文件，不接受用户输入，
 * 因此这里不做 HTML 转义之外的消毒处理；接入用户生成内容前必须重新评估。
 */
export function renderMarkdown(markdown: string): string {
  const escapeHtml = (text: string): string =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const inline = (text: string): string =>
    escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  const blocks = markdown.trim().split(/\n{2,}/);

  return blocks
    .map((block) => {
      const lines = block.split(/\r?\n/).filter((line) => line.trim() !== "");
      if (lines.length === 0) return "";

      // 标题
      const heading = /^(#{2,4})\s+(.+)$/.exec(lines[0] ?? "");
      if (heading !== null && lines.length === 1) {
        const level = heading[1]?.length ?? 3;
        return `<h${level}>${inline(heading[2] ?? "")}</h${level}>`;
      }

      // 列表
      if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
        const items = lines
          .map((line) => `<li>${inline(line.trim().replace(/^[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      // 段落
      return `<p>${lines.map((line) => inline(line.trim())).join("<br />")}</p>`;
    })
    .filter((html) => html !== "")
    .join("\n");
}
