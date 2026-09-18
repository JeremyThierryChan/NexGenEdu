import { getPage, pageString, type Section } from "@/lib/data/content";
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

/** 把课程字段整理成「标题 + 内容」列表，缺失的字段自动跳过。 */
function toFields(section: Section): LabeledItem[] {
  return COURSE_FIELDS.map((name) => ({
    title: name,
    value: section.fields.find((field) => field.name === name)?.value ?? "",
  })).filter((item) => item.value !== "");
}

/** 递归把标题树转成课程树。parentSlugs 记录从根到当前课程的路径。 */
function toCourses(sections: Section[], parentSlugs: string[]): CourseDetail[] {
  return sections
    .map((section) => {
      const slugs = [...parentSlugs, section.name];
      return {
        slug: section.name,
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

/** 缓存解析结果：数据是编译期常量，无需每次重建。 */
let cached: { content: FeaturedContent; all: CourseDetail[] } | null = null;

function load(): { content: FeaturedContent; all: CourseDetail[] } {
  if (cached !== null) return cached;

  const page = getPage("featured", "特色课程");
  const courses = toCourses(page.groups, []);

  const content: FeaturedContent = {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    notice: pageString(page, "notice"),
    courses,
  };

  cached = { content, all: flatten(courses) };
  return cached;
}

/** 特色课程页面内容（含完整课程树）。 */
export function getFeaturedContent(): FeaturedContent {
  return load().content;
}

/** 全部课程（含各级），用于静态路由生成。 */
export function getAllFeaturedCourses(): CourseDetail[] {
  return load().all;
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
  let level: CourseDetail[] = load().content.courses;

  for (const slug of slugs) {
    const found: CourseDetail | undefined = level.find((course) => course.slug === slug);
    if (found === undefined) return null;
    trail.push(found);
    level = found.children;
  }

  const course = trail[trail.length - 1];
  return course === undefined ? null : { course, trail };
}
