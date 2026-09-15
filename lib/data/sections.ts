import { parseMarkdown, type ParsedMarkdown } from "@/lib/markdown";

/**
 * 数据层内部工具：把一份 Markdown 正文解析成结构化的「小节」。
 *
 * 约定：`## 名称` 是一级小节，`### 名称` 是其子条目；
 * `## 名称 | 值` 形式会同时解析出 title 与 value，
 * 便于把「标签 + 数值」「标题 + 说明」这类列表写成一目了然的一行。
 *
 * 该文件只做结构解析，不负责读取文件（读取在 lib/data/site.ts）。
 */

/**
 * 把标题文本拆成「名称 + 值」。
 *
 * 支持两种写法，便于按语义选择更自然的那个：
 *   `## 班级规模 | 4–8 人`   列表项：用竖线
 *   `### 科目: 数学, 物理`    字段：单值用冒号更自然
 * 两种都取最左侧的分隔符，因此「1 : 6」这类含冒号的数值不会被误拆
 * （因为冒号出现在竖线右侧时会优先按竖线拆）。
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

/** 一个 `## 名称` 小节。 */
export type Section = {
  /** 小节名称。对列表项而言就是它的标题。 */
  title: string;
  /** `## 名称 | 值` / `### 名称: 值` 中的值；不是该形式时为空字符串。 */
  value: string;
  /** 标题下方、子标题之前的正文原文。 */
  body: string;
  /** 该小节内部的子条目（`### 名称`）。 */
  children: Section[];
};

/** 把正文按 `## 标题` 切成小节（并递归处理 `###` 子条目）。 */
export function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  let currentChild: { title: string; value: string; lines: string[] } | null = null;

  const flushChild = () => {
    if (current !== null && currentChild !== null) {
      current.children.push({
        title: currentChild.title,
        value: currentChild.value,
        body: currentChild.lines.join("\n").trim(),
        children: [],
      });
    }
    currentChild = null;
  };

  const flushSection = () => {
    flushChild();
    if (current !== null) sections.push(current);
    current = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2?.[1] !== undefined) {
      flushSection();
      current = { ...splitTitle(h2[1]), body: "", children: [] };
      continue;
    }

    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3?.[1] !== undefined && current !== null) {
      flushChild();
      const parsed = splitTitle(h3[1]);
      currentChild = { title: parsed.title, value: parsed.value, lines: [] };
      continue;
    }

    // 第一个 `##` 之前的说明文字不属于任何小节，忽略。
    if (current === null) continue;
    if (currentChild !== null) {
      currentChild.lines.push(line);
    } else {
      current.body = current.body === "" ? line : `${current.body}\n${line}`;
    }
  }
  flushSection();

  return sections.map((section) => ({ ...section, body: section.body.trim() }));
}

/** 取指定标题的小节，找不到时返回 null。 */
export function findSection(sections: Section[], title: string): Section | null {
  return sections.find((section) => section.title === title) ?? null;
}

/**
 * 取「以某标题开头的一组条目」。
 *
 * 数据文件里列表项的写法是：先写一个小节标题，紧跟着写各个条目，
 * 每个条目是 `## 名称 | 值`：
 *
 *   ## 教学特色
 *   格式为「标题 | 说明」。当前 4 条，可增删。
 *   ## 小班教学 | 每班 4–8 人……
 *   ## 个性化方案 | 入学测评后……
 *
 * 因此这里从标题小节之后开始，连续收集带「值」的小节，
 * 直到遇到下一个不带「值」的小节（即下一个分组标题）为止。
 */
export function itemsIn(
  sections: Section[],
  title: string,
): Array<{ title: string; value: string }> {
  const startIndex = sections.findIndex((section) => section.title === title);
  if (startIndex === -1) return [];

  const items: Array<{ title: string; value: string }> = [];
  for (let index = startIndex + 1; index < sections.length; index += 1) {
    const section = sections[index];
    if (section === undefined) break;

    if (section.value === "" && section.children.length > 0) {
      // 带下级字段但不带「值」，这是下一个分组的标题（如教师姓名），本组结束。
      if (items.length > 0) break;
      continue;
    }

    if (section.value === "" && section.body !== "") {
      // 既不带头部值、也没有字段，但有说明正文 —— 属于文档小节，作为分界。
      if (items.length > 0) break;
      continue;
    }

    // 其余情况都是条目：包括「值恰好为空」的条目（例如教室照片暂缺）。
    items.push({ title: section.title, value: section.value });
  }
  return items;
}

/** 直接解析一段 Markdown 正文的小节（供数据层做一次性解析使用）。 */
export function sectionsFromParsed(parsed: ParsedMarkdown): Section[] {
  return parseSections(parsed.body);
}

export { parseMarkdown };
