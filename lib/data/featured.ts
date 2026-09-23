import { getPage, pageString, type Section } from "@/lib/data/content";
import { backendFeaturedContent, backendSnapshot, siteContentSource } from "@/lib/site/backend-source";
import type { CourseDetail, FeaturedContent, LabeledItem } from "@/lib/types/site";

/**
 * 特色课程数据：读取 data/site/featured.md。
 *
 * 层级完全由标题层级决定：
 *   ### 课内辅导          → 一级课程
 *   #### 一对一定制课      → 二级课程
 *   ##### 精品小升初       → 三级课程
 *
 * 每门课程都有自己的独立页面，路径由「从根到该课程的课程名」拼成：
 *   /courses/featured/课内辅导/一对多小班课/精品小升初
 *
 * 页面只调用本文件的函数，不直接解析 Markdown。
 */

/** 课程描述字段的资料名，会按此顺序展示。 */
const COURSE_FIELDS = ["适合对象", "课程定位", "主要做法", "可以期待"] as const;

/**
 * 由课程名派生 URL 路径分段（未显式声明「路径」时使用）。
 *
 * 剔除非 ASCII 可见字符：空格与斜杠等字符在 URL 里会被百分号编码，
 * 其中 `%2F` 会被静态托管与一部分浏览器当作路径分隔符处理，
 * 导致页面解析失败（例如「一对二 / 一对三小组课」）。
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 把课程字段整理成「标题 + 内容」列表，缺失的字段自动跳过。 */
function toFields(section: Section): LabeledItem[] {
  return COURSE_FIELDS.map((name) => ({
    title: name,
    value: section.fields.find((field) => field.name === name)?.value ?? "",
  })).filter((item) => item.value !== "");
}

/** 递归把标题树转成课程树。parentSlugs 记录从根到当前课程的 URL 路径。 */
function toCourses(sections: Section[], parentSlugs: string[]): CourseDetail[] {
  return sections
    .map((section) => {
      // URL 路径分段：优先用显式声明的「路径」，未声明时由课程名派生
      const declared = section.fields.find((field) => field.name === "路径")?.value;
      const segment = declared !== undefined && declared !== "" ? declared : slugify(section.name);
      const slugs = [...parentSlugs, segment];
      return {
        slug: segment,
        /** 完整路径分段，用于生成链接与查找。 */
        path: slugs,
        name: section.name,
        fields: toFields(section),
        body: section.body.trim(),
        children: toCourses(section.children, slugs),
      };
    })
    .filter((course) => course.fields.length > 0 || course.body !== "" || course.children.length > 0);
}

/** 把课程树拍平成列表，便于查找与统计。 */
function flatten(courses: CourseDetail[]): CourseDetail[] {
  return courses.flatMap((course) => [course, ...flatten(course.children)]);
}

/** 缓存**模版**解析结果：内容文件是编译期常量，无需每次重建。 */
let cachedTemplate: { content: FeaturedContent; all: CourseDetail[] } | null = null;

function loadTemplate(): { content: FeaturedContent; all: CourseDetail[] } {
  if (cachedTemplate !== null) return cachedTemplate;

  const page = getPage("featured", "特色课程");
  const courses = toCourses(page.groups, []);

  const content: FeaturedContent = {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    notice: pageString(page, "notice"),
    courses,
  };

  cachedTemplate = { content, all: flatten(courses) };
  return cachedTemplate;
}

/**
 * 特色课程（`/courses` 底部那块 + `/courses/featured/**` 的课程页）。
 *
 * **三态取数**（口径见 `lib/data/site.ts` 的文件头）：连上后端就用**库里的课程树**；
 * 没连上 = **空白**（机构要求：需要后端数据的地方就该是空的）；
 * 显式 `SITE_CONTENT_SOURCE=template` 才解析 `data/site/featured.md`。
 *
 * 为什么它也要进库：它是**对外文案**（机构会改文案、加班型、调顺序），
 * 而它原先只在内容文件里 —— 后台看不到、改一次要动文件再构站；
 * 而且后台课程表单里的「可开班型」候选就是它的**二级课程名**（见 `lib/backend/featured-tree.ts`）。
 */
export function getFeaturedContent(): FeaturedContent {
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendFeaturedContent(snapshot);
  if (siteContentSource() === "template") return loadTemplate().content;
  return { eyebrow: "", title: "", description: "", notice: "", courses: [] };
}

/** 全部课程（含各级），用于静态路由生成 —— 与 `getFeaturedContent()` 同源。 */
export function getAllFeaturedCourses(): CourseDetail[] {
  return flatten(getFeaturedContent().courses);
}

/**
 * 特色课程（**只读模版**，不看后端快照）。
 *
 * 为什么单独留这个出口：`lib/backend/site-content.ts` 属于
 * **「内容文件 → 数据库」**这个方向（空库初始化、老库迁移、从网站导入），
 * 它必须读模版 —— 否则就是把库里的课程树再导一遍，绕成一个圈。
 */
export function getFeaturedContentFromTemplate(): FeaturedContent {
  return loadTemplate().content;
}

/**
 * 按路径查找课程。
 * @param slugs 从根到目标课程的课程名数组，例如 ["课内辅导", "一对多小班课", "精品小升初"]
 * @returns 找到的课程，以及从根到它的完整链路（用于面包屑）
 */
export function findFeaturedCourse(
  slugs: string[],
): { course: CourseDetail; trail: CourseDetail[] } | null {
  if (slugs.length === 0) return null;

  const trail: CourseDetail[] = [];
  // 查的是**当前实际渲染的那一棵树**（后端态就是快照里那棵），而不是模版那一份
  let level: CourseDetail[] = getFeaturedContent().courses;

  for (const slug of slugs) {
    const found: CourseDetail | undefined = level.find((course) => course.slug === slug);
    if (found === undefined) return null;
    trail.push(found);
    level = found.children;
  }

  const course = trail[trail.length - 1];
  return course === undefined ? null : { course, trail };
}
