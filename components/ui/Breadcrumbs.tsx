import Link from "next/link";

export type Crumb = {
  label: string;
  /** 省略 href 表示当前页（不可点击）。 */
  href?: string;
};

type BreadcrumbsProps = {
  items: Crumb[];
  className?: string;
};

/**
 * 面包屑导航。
 *
 * 用 nav + ol 的标准结构，并给最后一项加 aria-current="page"，
 * 屏幕阅读器与搜索引擎都能正确理解层级关系。
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="面包屑" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index > 0 && (
                <span className="text-ink-300" aria-hidden>
                  /
                </span>
              )}
              {item.href === undefined || isLast ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "text-ink-800" : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="transition-colors hover:text-brand-700"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
