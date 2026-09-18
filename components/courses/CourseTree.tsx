import Link from "next/link";
import { courseHref } from "@/lib/site/featured-routes";
import type { CourseDetail } from "@/lib/types/site";

type CourseTreeProps = {
  courses: CourseDetail[];
  /**
   * 父课程标题的层级。默认 2（页面主内容，如特色课程主页）；
   * 嵌在带标题的 Section 里时传 3，避免和 Section 的 h2 平级。
   */
  level?: 2 | 3;
};

/**
 * 特色课程：父课程作为分组标题，每门课程一张卡片，整张卡片可点进入独立页面。
 *
 * 两个刻意的处理：
 * - 父课程（如课内辅导）也做成可点卡片：它有自己的说明页与下级导航
 * - 卡片容器用 div 而不是 a：三级课程需要作为卡片内的独立链接，
 *   若整张卡片是链接，就会出现 `<a>` 嵌套 `<a>`（无效 HTML，
 *   且点击区域互相抢占）。因此标题与说明各自成链接，视觉上仍是一张卡片。
 */
export function CourseTree({ courses, level = 2 }: CourseTreeProps) {
  // 标题层级跟着 Section 走：Section 本身是 h2，这里就降一级到 h3。
  const GroupHeading = level === 2 ? "h2" : "h3";
  const CardHeading = level === 2 ? "h3" : "h4";
  return (
    <div className="space-y-12">
      {courses.map((course) => (
        <section key={course.slug}>
          <div className="max-w-2xl">
            <GroupHeading className="text-lg font-medium text-ink-900">
              <Link
                href={courseHref(course.path)}
                className="transition-colors hover:text-brand-700"
              >
                {course.name}
              </Link>
            </GroupHeading>
            {course.fields
              .filter((field) => field.title === "课程定位")
              .map((field) => (
                <p key={field.title} className="mt-2 text-sm leading-relaxed text-ink-600">
                  {field.value}
                </p>
              ))}
          </div>

          {course.children.length > 0 && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {course.children.map((child) => (
                <CourseCard key={child.slug} course={child} heading={CardHeading} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function CourseCard({ course, heading }: { course: CourseDetail; heading: "h3" | "h4" }) {
  const CardHeading = heading;
  const position = course.fields.find((field) => field.title === "课程定位");
  const audience = course.fields.find((field) => field.title === "适合对象");
  const href = courseHref(course.path);

  return (
    <div className="flex flex-col rounded-lg border border-ink-200 bg-white p-5 transition-colors hover:border-brand-300">
      <CardHeading className="text-base font-medium text-ink-900">
        <Link href={href} className="transition-colors hover:text-brand-700">
          {course.name}
        </Link>
      </CardHeading>

      {position !== undefined && (
        <Link href={href} className="mt-2 block text-sm leading-relaxed text-ink-600">
          {position.value}
        </Link>
      )}

      {audience !== undefined && (
        <p className="mt-3 text-xs leading-relaxed text-ink-500">适合：{audience.value}</p>
      )}

      {course.children.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-ink-100 pt-3">
          {course.children.map((child) => (
            <li key={child.slug}>
              <Link
                href={courseHref(child.path)}
                className="text-sm text-brand-700 transition-colors hover:text-brand-800"
              >
                {child.name} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
