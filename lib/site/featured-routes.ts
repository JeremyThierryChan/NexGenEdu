import type { CourseDetail } from "@/lib/types/site";

/** 特色课程的路径前缀。 */
export const FEATURED_BASE = "/courses/featured";

/** 生成某门课程的独立页面路径。 */
export function courseHref(path: string[]): string {
  return `${FEATURED_BASE}/${path.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

/** 特色课程总览页路径。 */
export const FEATURED_INDEX_HREF = FEATURED_BASE;

/** 课程页路径（特色课程的总入口在课程页上）。 */
export const COURSES_HREF = "/courses";

/**
 * 生成某门课程的面包屑链路。
 *
 * 形如：首页 / 课程 / 特色课程 / 课内辅导 / 一对多小班课 / 精品小升初
 * 每一级都可点击回上级，最后一级是当前页。
 */
export function courseTrail(
  trail: CourseDetail[],
): Array<{ label: string; href?: string }> {
  return [
    { label: "首页", href: "/" },
    { label: "课程", href: COURSES_HREF },
    { label: "特色课程", href: FEATURED_INDEX_HREF },
    ...trail.map((course, index) => ({
      label: course.name,
      href: index === trail.length - 1 ? undefined : courseHref(course.path),
    })),
  ];
}
