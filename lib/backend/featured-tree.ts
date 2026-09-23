/**
 * 特色课程树：**纯函数**（不读数据库、不读 Markdown、不 import 任何会读它们的模块）。
 *
 * ## 为什么单独一个模块
 *
 * 同一棵树有**三个读者**，分别在三个地方：
 *
 *   1. **网站**：`lib/data/featured.ts` 与 `/courses/featured/**` 那几页
 *      （构站时读快照，连后端都不在场）；
 *   2. **服务层**：`site.saveBlocks` 的校验与删除护栏（`site-content.ts` 用它）；
 *   3. **后台**：课程表单里的「可开班型」候选 —— 班型的名字就是特色课程的**二级课程**名。
 *
 * 三处各写一遍"层级怎么算、路径怎么拼、名字怎么派生"必然会分叉（网站的网址与后台看到的
 * 对不上就是分叉的样子）。因此这些规则收在这里，输入输出都是普通对象，谁都能调。
 *
 * ## 这里的规则就是**网址的规则**
 *
 * 一门特色课程的网址 = `/courses/featured/<各级 slug 拼起来>`。slug 与课程名是**两份数据**：
 * 改名字不该让网址失效（内容文件里那些 `- · 路径:` 字段就是干这个的）。
 * 没写 slug 时按名字派生（`deriveSlug`），派生结果必须满足两条：
 *   - 只留 ASCII 可见字符与中文（`%2F` 这类编码会被一部分静态托管当成路径分隔符）；
 *   - 不能为空（空分段拼出来的路径会多出 `//`，页面直接 404）。
 */
import type { SiteFeaturedCourse, SiteFeaturedPage } from "./types";

/**
 * 特色课程最多几级。
 *
 * 三级是**内容与网站结构本身的限制**（内容文件用 `###` / `####` / `#####` 表达，
 * 网站的导航与页面也只做到三级）。允许第四级只会让人建出一批"存得下、没有任何入口"的课程。
 */
export const FEATURED_MAX_DEPTH = 3;

/** 课程描述字段的固定顺序（内容文件里就这么写，页面上也按这个顺序展示）。 */
export const FEATURED_FIELDS = ["适合对象", "课程定位", "主要做法", "可以期待"] as const;

/**
 * 由课程名派生 URL 分段。
 *
 * 与 `lib/data/featured.ts` 里那份**同一套规则**（那边是模版路径用的），
 * 之所以搬到这里：后台新建一门课程时也要能立刻算出它的网址，
 * 而那一步发生在**浏览器**里（没有模版可读）。
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 取一门课程实际生效的 URL 分段（没写 slug 时按名字派生）。 */
export function effectiveSlug(course: { name: string; slug: string }): string {
  const declared = course.slug.trim();
  if (declared !== "") return declared;
  return deriveSlug(course.name);
}

/** 树的层级：一级 = 1；空树 = 0。 */
export function featuredDepth(courses: readonly SiteFeaturedCourse[]): number {
  if (courses.length === 0) return 0;
  return 1 + Math.max(...courses.map((course) => featuredDepth(course.children)));
}

/**
 * 把树拍平，并算出每门课的**完整路径**（从根到它自己）。
 *
 * 返回顺序就是页面上的顺序（深度优先）：一级 →  它的子课程 → 下一个一级。
 * `path` 用于查找与生成链接，和模版路径（`lib/data/featured.ts` 的 `CourseDetail.path`）
 * 是同一个含义。
 */
export function flattenFeatured(
  courses: readonly SiteFeaturedCourse[],
  parentPath: readonly string[] = [],
): Array<{ course: SiteFeaturedCourse; path: string[]; depth: number; parentId: string }> {
  return courses.flatMap((course) => {
    const path = [...parentPath, effectiveSlug(course)];
    const self = { course, path, depth: parentPath.length + 1, parentId: "" };
    return [self, ...flattenFeatured(course.children, path)];
  });
}

/** 按 id 找一门课程（含它自己的路径）；找不到返回 `null`。 */
export function findFeaturedById(
  page: SiteFeaturedPage,
  id: string,
): { course: SiteFeaturedCourse; path: string[]; depth: number } | null {
  const found = flattenFeatured(page.courses).find((entry) => entry.course.id === id);
  return found === undefined ? null : { course: found.course, path: found.path, depth: found.depth };
}

/**
 * 「可开班型」候选 = 特色课程里**一级课程的二级课程名**（一对一 / 晚托管 / 精品小升初…）。
 *
 * 这是后台若干表单（课程库的「可开班型」、报课时的班型、排课的班型）的候选来源，
 * 而它原先读的是**网站内容文件**（`data/site/featured.md`）—— 于是机构在后台改了特色课程，
 * 后台自己的下拉也不跟着变。现在它读库里的同一棵树（v20 搬进来之后），
 * 三处（网站那块、课程页、后台下拉）用的是同一份数据。
 */
export function featuredFormOptions(page: SiteFeaturedPage): string[] {
  return page.courses.flatMap((course) => course.children.map((child) => child.name.trim()))
    .filter((name) => name !== "");
}

/**
 * 这门课程的名字是不是正被某门课程当成**班型**用（课程库里的 `forms`）。
 *
 * 用途只有一个：删除护栏。特色课程里的**二级课程名**就是后台课程表单里
 * 「可开班型」的候选（例如「小班课（4-8人）」），删掉它会让那些课程的班型变成一个查不到的名字 ——
 * 网站与排课不会报错，只是"这门课的班型在某处对不上"，那是最难查的一类问题。
 */
export function featuresUsingForm(
  courses: readonly { name: string; forms: readonly string[] }[],
  name: string,
): string[] {
  const target = name.trim();
  if (target === "") return [];
  return courses.filter((course) => course.forms.some((form) => form.trim() === target)).map((c) => c.name);
}

/**
 * 这个节点能不能删；不能删时给出理由（与学员 / 课程 / 课程分区的删除护栏同一套做法）。
 *
 * 两种不能删：
 *   - **还有子课程**：删掉它，下面的三级课程就没人能到了（它们本身还在数据里，
 *     但网站上的入口消失 —— 那是静默的"页面不见了"）；
 *   - **名字正被课程当成班型用**：见 `featuresUsingForm`。
 * 两种情况都点名说清"先做什么"。
 */
export function featuredDeleteRefusal(
  page: SiteFeaturedPage,
  id: string,
  courses: readonly { name: string; forms: readonly string[] }[],
): string {
  const found = findFeaturedById(page, id);
  if (found === null) return "";
  const { course } = found;
  if (course.children.length > 0) {
    return (
      `「${course.name}」下面还有 ${String(course.children.length)} 门子课程` +
      `（${course.children.map((child) => child.name).join("、")}）：请先删掉或移走它们。`
    );
  }
  const users = featuresUsingForm(courses, course.name);
  if (users.length > 0) {
    return (
      `「${course.name}」还是课程 ${users.map((name) => `「${name}」`).join("、")} 的**班型**：` +
      "先到「课程库」把那门课的班型改掉，再回来删 —— 否则那些课的班型会变成一个查不到的名字。"
    );
  }
  return "";
}
