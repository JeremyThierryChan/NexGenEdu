import Link from "next/link";
import { courseHref } from "@/lib/site/featured-routes";
import type { CourseDetail } from "@/lib/types/site";

type CourseTreeProps = {
  courses: CourseDetail[];
  /** 卡片列数类名，默认三列（宽屏）。 */
  className?: string;
};

/**
 * 特色课程卡片网格：每门课程一张卡片，卡片内列出它的下级班型。
 *
 * 为什么用卡片而不是缩进列表：三层结构用缩进列表会拉得很长，
 * 而层级关系可以用「下级班型作为卡片内的小链接」表达，
 * 家长扫一遍就能看出有哪些课、彼此是什么关系。
 */
export function CourseTree({ courses, className }: CourseTreeProps) {
  return (
    <div className={className ?? "grid gap-5 sm:grid-cols-2 lg:grid-cols-3"}>
      {courses.map((course) => (
        <CourseCard key={course.slug} course={course} />
      ))}
    </div>
  );
}

function CourseCard({ course }: { course: CourseDetail }) {
  const position = course.fields.find((field) => field.title === "课程定位");
  const audience = course.fields.find((field) => field.title === "适合对象");

  return (
    <div className="flex flex-col rounded-lg border border-ink-200 bg-white p-6">
      <h3 className="text-base font-medium text-ink-900">
        <Link
          href={courseHref(course.path)}
          className="transition-colors hover:text-brand-700"
        >
          {course.name}
        </Link>
      </h3>

      {position !== undefined && (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">{position.value}</p>
      )}

      {audience !== undefined && (
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          适合：{audience.value}
        </p>
      )}

      {course.children.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-ink-100 pt-4">
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

      <div className="mt-auto pt-4">
        <Link
          href={courseHref(course.path)}
          className="text-sm text-ink-500 transition-colors hover:text-brand-700"
        >
          查看课程说明
        </Link>
      </div>
    </div>
  );
}
