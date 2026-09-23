import { getPage, pageString, type PageBlock, type Section } from "@/lib/data/content";
import { backendCasesContent, backendSnapshot, siteContentSource } from "@/lib/site/backend-source";
import type {
  CaseItem,
  CasesContent,
  FaqContent,
  FaqGroup,
  InfoGroup,
  ScheduleContent,
} from "@/lib/types/site";

/**
 * 「学生案例 / 常见问题 / 课程时间安排」三个页面的数据访问。
 *
 * 三个页面结构一致（页面短字段 + 若干分组 + 组内条目），因此共用一个映射函数，
 * 内容分别放在 data/site/cases.md、faq.md、schedule.md。
 * 页面只调用这里的函数，不直接解析 Markdown。
 */

/** 把一个页面块的分组统一映射成「标题 + 条目」结构。 */
function toInfoGroups(page: PageBlock): InfoGroup[] {
  return page.groups.map((group: Section) => ({
    title: group.name,
    note: group.note,
    items: group.items.map((item) => ({ title: item.title, value: item.value })),
  }));
}

// ── 常见问题 ──────────────────────────────────────────────────────────────

export function getFaqContent(): FaqContent {
  const page = getPage("faq", "常见问题");
  const groups: FaqGroup[] = page.groups.map((group) => ({
    title: group.name,
    items: group.items.map((item) => ({ question: item.title, answer: item.value })),
  }));

  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    notice: pageString(page, "notice"),
    groups,
    count: groups.reduce((total, group) => total + group.items.length, 0),
  };
}

// ── 学生案例 ──────────────────────────────────────────────────────────────

/** 案例的字段名（与 cases.md 里的 `#### 字段: 值` 对应）。 */
const CASE_FIELDS = ["年级", "科目", "入学水平", "当前水平", "辅导周期", "主要问题"] as const;

/**
 * 学生案例（`/cases` 与首页那块案例区）。
 *
 * **两态取数**（与 `lib/data/site.ts` 同一套规则）：连上后端就用库里的案例，
 * 否则解析 `data/site/cases.md`。案例是机构要经常更新的内容，因此从 v19 起以后端为主。
 */
export function getCasesContent(): CasesContent {
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendCasesContent(snapshot);
  // 没连上后端 = 空白（机构口径：需要后端数据的地方就该是空的）；显式 template 才用模版
  if (siteContentSource() === "template") return getCasesContentFromTemplate();
  return { eyebrow: "", title: "", description: "", notice: "", cases: [] };
}

/**
 * 学生案例（**只读模版**，不看后端快照）。
 *
 * 为什么单独留这个出口：`lib/backend/site-content.ts` 属于
 * **「内容文件 → 数据库」**这个方向（空库初始化、老库迁移、从网站导入），
 * 它必须读模版 —— 否则就是把库里的案例再导一遍，绕成一个圈。
 */
export function getCasesContentFromTemplate(): CasesContent {
  const page = getPage("cases", "学生案例");

  const cases: CaseItem[] = page.groups.map((group) => {
    const field = (name: string): string =>
      group.items.find((item) => item.title === name)?.value ?? "";

    return {
      id: group.name,
      // 标题形如「初二 李同学｜数学从 62 分到 91 分」，竖线后是简短结论
      title: group.name,
      fields: CASE_FIELDS.map((name) => ({ title: name, value: field(name) })).filter(
        (item) => item.value !== "",
      ),
      from: field("入学水平"),
      to: field("当前水平"),
      /**
       * 过程描述写在所有 `#### 字段` 之后，因此会被并进最后一个字段的正文里。
       * 与教师简介同理：把小节正文与最后一项的正文拼起来作为故事，
       * 字段增减都不会影响取到内容。
       */
      story: [group.body, group.items.at(-1)?.body ?? ""]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join("\n\n"),
    };
  });

  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    notice: pageString(page, "notice"),
    cases: cases.filter((item) => item.story !== "" || item.fields.length > 0),
  };
}

// ── 课程时间安排 ──────────────────────────────────────────────────────────

export function getScheduleContent(): ScheduleContent {
  const page = getPage("schedule", "课程时间安排");
  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    notice: pageString(page, "notice"),
    groups: toInfoGroups(page),
  };
}
