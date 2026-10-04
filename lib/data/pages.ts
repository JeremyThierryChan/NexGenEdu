import { getPage, itemFieldText, pageString } from "@/lib/data/content";
import { backendCasesContent, backendFaqContent, backendReviewsContent, backendSnapshot, siteContentSource } from "@/lib/site/backend-source";
import { copySourceFor } from "@/lib/data/site";
import type { CopySource } from "@/lib/backend/site-copy-model";
import type {
  CaseItem,
  CasesContent,
  FaqContent,
  FaqGroup,
  ReviewItem,
  ReviewsContent,
  ScheduleContent,
} from "@/lib/types/site";

/**
 * 「学生案例 / 常见问题 / 家长与学生评价 / 课程时间安排」几个页面的数据访问。
 *
 * 这些页面结构一致（页面短字段 + 若干分组 + 组内条目），共用一个映射函数，
 * 内容分别放在 data/site/cases.md、faq.md、reviews.md、schedule.md。
 * 页面只调用这里的函数，不直接解析 Markdown。
 */

// ── 常见问题 ──────────────────────────────────────────────────────────────

/**
 * 常见问题（`/faq`）。
 *
 * 三态（口径见 `lib/data/site.ts` 文件头）：连上后端用库里的问答；
 * **没连上（默认）= 模版骨架 + 空问答**（分组标题照常显示 —— 机构要求"得有分区标题"）；
 * 显式 `SITE_CONTENT_SOURCE=template` 才整份用模版。
 */
export function getFaqContent(): FaqContent {
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendFaqContent(snapshot);
  const frame = getFaqContentFromTemplate();
  if (siteContentSource() === "template") return frame;
  return {
    eyebrow: frame.eyebrow,
    title: frame.title,
    description: frame.description,
    notice: frame.notice,
    groups: frame.groups.map((group) => ({ title: group.title, items: [] })),
    count: 0,
  };
}

/**
 * 常见问题（**只读模版**，不看后端快照）。
 *
 * 为什么单独留这个出口：`lib/backend/site-content.ts` 属于
 * **「内容文件 → 数据库」**这个方向（空库初始化、老库迁移），
 * 它必须读模版 —— 否则就是把库里的问答再导一遍，绕成一个圈。
 */
export function getFaqContentFromTemplate(): FaqContent {
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
  const frame = getCasesContentFromTemplate();
  if (siteContentSource() === "template") return frame;
  /*
   * 没连上后端（默认）：**骨架用模版、案例为空**。
   * 标题（「学生是怎么进步的」）与页脚那句提示是页面骨架，空着会让家长以为这一页坏了
   * （机构反馈过"不能全空，得有分区标题"）；案例本身是**条目**，没连后端就没有。
   */
  return { eyebrow: frame.eyebrow, title: frame.title, description: frame.description, notice: frame.notice, cases: [] };
}

/**
 * 学生案例（**只读模版**，不看后端快照）。
 *
 * 为什么单独留这个出口：`lib/backend/site-content.ts` 属于
 * **「内容文件 → 数据库」**这个方向（空库初始化、老库迁移），
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
      // v38 的任课老师（**公开实名**）：老文件没有这一栏 → 空串（前台那一行不渲染）
      teacher: field("任课老师").trim(),
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

// ── 家长与学生评价（`/cases` 页里那块） ────────────────────────────────────

/**
 * 家长 / 学生评价（挂在「学生案例」页里，案例列表之后那一块）。
 *
 * 三态与案例 / 常见问题同一套（口径见 `lib/data/site.ts` 文件头）：
 * 连上后端用库里的评价；**没连上（默认）= 模版骨架 + 空评价**；
 * 显式 `SITE_CONTENT_SOURCE=template` 才整份用模版（含文件里那几条体例示例）。
 *
 * 为什么"没连上"时不留体例示例：评价是**真实发生过的话**，
 * 把文件里的写法样例当评价显示给家长看，等于机构编了一条评价 ——
 * 这一条与案例 / 常见问题的空态口径一致（骨架在、条目空），只是这里更要紧。
 */
export function getReviewsContent(): ReviewsContent {
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendReviewsContent(snapshot);
  const frame = getReviewsContentFromTemplate();
  if (siteContentSource() === "template") return frame;
  return {
    eyebrow: frame.eyebrow,
    title: frame.title,
    description: frame.description,
    notice: frame.notice,
    reviews: [],
  };
}

/**
 * 家长 / 学生评价（**只读模版**，不看后端快照）。
 *
 * 与 `getCasesContentFromTemplate` 同一个理由：`lib/backend/site-content.ts`
 * 属于「内容文件 → 数据库」这个方向（空库初始化），它必须读模版。
 * 迁移给老库补的却是**空条目**（不把体例示例灌进真实库）——
 * 因此迁移那一步用这里的骨架、不用这里的条目，见 `api.ts` 的 v34 → v35。
 */
export function getReviewsContentFromTemplate(): ReviewsContent {
  const page = getPage("reviews", "家长与学生评价");
  const seen = new Set<string>();

  const reviews: ReviewItem[] = page.groups
    .map((group) => {
      /*
       * 字段值走 `itemFieldText`（而不是直接读 `item.value`）：v37 起
       * **正文 / 原文可以多段** —— 第一段在 `#### 字段:` 行上、其余段落写在下面，
       * 由它拼回 `\n\n`（见 `lib/data/content.ts` 的说明）。
       */
      const field = (name: string): string => {
        const item = group.items.find((entry) => entry.title === name);
        return item === undefined ? "" : itemFieldText(item);
      };
      const base = group.name.trim();
      // id 用署名（= 分组标题）：与内容文件一一对应，反复导入不会漂
      let id = base;
      let suffix = 2;
      while (seen.has(id)) {
        id = `${base}（${String(suffix)}）`;
        suffix += 1;
      }
      seen.add(id);
      return {
        id,
        group: field("分组").trim(),
        // 正文的字段名叫「正文」；「评价正文」也认（早期手写文件用的写法）
        quote: (field("正文") || field("评价正文")).trim(),
        // 署名默认就是分组标题（文件里 `### 署名` 那种写法最省事）
        author: (field("署名") || base).trim(),
        subject: field("科目").trim(),
        description: field("补充").trim(),
        // v37 的原文与原文语言（**公开内容**）：老文件没有这两栏 → 空串 = 单语评价
        original: field("原文").trim(),
        originalLanguage: field("原文语言").trim(),
      };
    })
    // 一条评价连"谁说的、说了什么"都没有就不产出条目（与案例同一条口径）
    .filter((item) => item.quote !== "" || item.author !== "");

  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    notice: pageString(page, "notice"),
    reviews,
  };
}

// ── 课程时间安排 ──────────────────────────────────────────────────────────

/**
 * 课程时间安排（`/schedule`）。
 *
 * 三态（口径见 `lib/data/site.ts` 文件头）：连上后端用库里的那一块；
 * **没连上（默认）= 短字段与分组标题来自模版、组内条目为空**；显式 template 才整份用模版。
 * 与其余各块共用同一个读取接口（`CopySource`），因此"哪一块走哪条来源"只在这一处定。
 */
export function getScheduleContent(): ScheduleContent {
  return scheduleFrom(copySourceFor("schedule"));
}

/** 时间安排（**只认 `CopySource`**）：模版（`schedule.md`）与库两处共用它。 */
function scheduleFrom(source: CopySource): ScheduleContent {
  return {
    eyebrow: source.field("eyebrow"),
    title: source.field("title"),
    description: source.field("description"),
    notice: source.field("notice"),
    // 「列举型」块：每一组都渲染（不按名字取），见 CopySource.groups 的说明
    groups: source.groups().map((group) => ({
      title: group.title,
      // 站点视图里这个字段仍叫 note（页面组件按它渲染），库/模版那一侧叫 description
      note: group.description,
      items: group.items.map((item) => ({ title: item.title, value: item.value })),
    })),
  };
}
