import Link from "next/link";
import { COURSES_HREF } from "@/lib/site/featured-routes";
import type { CourseColumnPageData } from "@/lib/types/site";

/**
 * 栏目（学段）页：`/courses/<栏目路径>`（primary / junior / senior / languages /
 * interests / adults）。
 *
 * 家长的实际决策顺序是「先定学段，再看科目」，所以这一层只做一件事：
 * 把这个阶段开设的科目逐个列出来，每个给一句简介，点标题进入科目页看具体内容。
 */
export function CourseColumnPage({ data }: { data: CourseColumnPageData }) {
  return (
    <div className="space-y-10">
      {data.subgroups.map((subgroup) => (
        <section key={subgroup.title}>
          {/* 只有一个分组时不再重复一次标题（组名与栏目名相同） */}
          {data.subgroups.length > 1 && subgroup.title !== "" && (
            <h2 className="mb-5 text-lg font-medium text-ink-900">{subgroup.title}</h2>
          )}

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subgroup.cards.map((card) => (
              <li key={card.path}>
                <Link
                  href={`/courses/${card.path}`}
                  className="group flex h-full flex-col rounded-lg border border-ink-200 bg-white p-5 transition-colors hover:border-brand-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-medium text-ink-900 transition-colors group-hover:text-brand-700">
                      {card.title}
                    </h3>
                    {card.unavailable && (
                      <span className="shrink-0 rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                        暂未开放
                      </span>
                    )}
                  </div>

                  {card.summary !== "" && (
                    <p className="mt-2.5 text-sm leading-relaxed text-ink-600">
                      {card.summary}
                    </p>
                  )}

                  <div className="mt-4 flex flex-1 flex-wrap items-end gap-1.5">
                    {card.tags.map((tag) => (
                      <span
                        key={`${tag.label}-${tag.target}`}
                        className="rounded-sm bg-brand-50 px-2 py-0.5 text-xs text-brand-700"
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>

                  <span className="mt-4 text-sm text-ink-500 transition-colors group-hover:text-brand-600">
                    查看课程内容 →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 相邻栏目：学段之间也应当能横向走通 */}
      {data.otherColumns.length > 0 && (
        <section className="border-t border-ink-200 pt-8">
          <h2 className="text-sm font-medium text-ink-900">其他栏目</h2>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {data.otherColumns.map((column) => (
              <Link
                key={column.href}
                href={column.href}
                className="text-sm text-brand-700 transition-colors hover:text-brand-800"
              >
                {column.title} →
              </Link>
            ))}
            <Link
              href={COURSES_HREF}
              className="text-sm text-ink-500 transition-colors hover:text-brand-700"
            >
              返回课程总览
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
