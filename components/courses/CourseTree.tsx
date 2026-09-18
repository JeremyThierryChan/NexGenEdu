import Link from "next/link";
import { courseHref } from "@/lib/site/featured-routes";
import type { CourseDetail } from "@/lib/types/site";

type CourseTreeProps = {
  courses: CourseDetail[];
};

/**
 * 特色课程树：按层级列出全部课程，每门课程链接到自己的独立页面。
 *
 * 层级用缩进与标题字号区分，而不是嵌套卡片 —— 三层嵌套卡片会很快变得拥挤，
 * 缩进列表更适合「一眼看清有哪些课、它们怎么归类」。
 */
export function CourseTree({ courses }: CourseTreeProps) {
  return (
    <ul className="space-y-6">
      {courses.map((course) => (
        <li key={course.slug}>
          <CourseNode course={course} depth={0} />
        </li>
      ))}
    </ul>
  );
}

function CourseNode({ course, depth }: { course: CourseDetail; depth: number }) {
  const position = course.fields.find((field) => field.title === "课程定位");

  return (
    <div
      className={
        depth === 0
          ? ""
          : "border-l border-ink-200 pl-5 sm:pl-6"
      }
    >
      <div className={depth === 0 ? "" : "mt-4"}>
        <Link
          href={courseHref(course.path)}
          className="text-base font-medium text-ink-900 transition-colors hover:text-brand-700"
        >
          {course.name}
        </Link>
        {position !== undefined && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-600">
            {position.value}
          </p>
        )}
        {course.children.length === 0 && position === undefined && course.fields.length > 0 && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-600">
            {course.fields[0]?.value}
          </p>
        )}
      </div>

      {course.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {course.children.map((child) => (
            <li key={child.slug}>
              <CourseNode course={child} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
