import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { bandAnchorHref } from "@/lib/site/featured-routes";
import type { CourseColumn, CourseColumnCard } from "@/lib/types/site";

/**
 * 课程栏目：`栏目 → 子标题 → 卡片`。
 *
 * 结构约定（与数据层一致）：
 * - **一张卡片 = 一门课程**。课程内部没有细分时整张卡片就是链接；
 * - 只有确有细分的课程才带标签（外语按语种级别、七选三按学考/选考），
 *   此时卡片是容器、标签各自成链接——一张卡里的标签会跳到**不同**小节，
 *   整卡可点会与标签点击冲突，也会产生 `<a>` 嵌套 `<a>` 的无效 HTML；
 * - 卡片标题刻意不用标题标签：层级已经很深（h1 → h2 区块 → h3 栏目 →
 *   h4 子标题），再往下用 h5 只会让大纲更碎，链接本身已经可读。
 */

/** 子标题层级：首页每个栏目自己是一个 Section（h2），子标题用 3；课程页在「课程总览」之下，栏目是 h3、子标题用 4。 */
type SubHeadingLevel = 3 | 4;

/** 一个栏目内的子标题与卡片（不含栏目标题本身）。 */
export function CourseColumnCards({
  column,
  subHeadingLevel,
}: {
  column: CourseColumn;
  subHeadingLevel: SubHeadingLevel;
}) {
  const SubHeading = subHeadingLevel === 3 ? "h3" : "h4";

  return (
    <div className="space-y-6">
      {column.subgroups.map((subgroup) => (
        <div key={subgroup.title}>
          {subgroup.title !== "" && (
            <SubHeading className="mb-3 text-sm font-medium text-ink-700">
              {subgroup.title}
            </SubHeading>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {subgroup.cards.map((card) => (
              <ColumnCard key={`${subgroup.title}-${card.title}`} card={card} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 全部栏目（课程页「课程总览」用）：栏目 h3、子标题 h4。 */
export function CourseColumns({ columns }: { columns: CourseColumn[] }) {
  return (
    <div className="space-y-9">
      {columns.map((column) => (
        <section key={column.title}>
          <h3 className="mb-5 text-lg font-medium text-ink-900">{column.title}</h3>
          <CourseColumnCards column={column} subHeadingLevel={4} />
        </section>
      ))}
    </div>
  );
}

function ColumnCard({ card }: { card: CourseColumnCard }) {
  const href = bandAnchorHref(card.target);
  const hasTags = card.tags.length > 0;

  // 没有细分：整张卡片可点
  if (!hasTags) {
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center rounded-lg border border-ink-200 bg-white px-3.5 py-3",
          "text-sm font-medium text-ink-900 transition-colors",
          "hover:border-brand-300 hover:text-brand-700",
        )}
      >
        {card.title}
      </Link>
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-ink-200 bg-white px-3.5 py-3">
      <Link
        href={href}
        className="text-sm font-medium text-ink-900 transition-colors hover:text-brand-700"
      >
        {card.title}
      </Link>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {card.tags.map((tag) => (
          <Link
            key={`${tag.label}-${tag.target}`}
            href={bandAnchorHref(tag.target)}
            className="rounded-sm bg-brand-50 px-2 py-0.5 text-xs text-brand-700 transition-colors hover:bg-brand-100"
          >
            {tag.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
