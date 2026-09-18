import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type TagCardProps = {
  /** 卡片标题；只有一个标签时可省略（此时标签即标题）。 */
  title?: string;
  /** 卡片上的标签；每个标签各自跳转，因此卡片本身不是链接。 */
  tags: Array<{ label: string; href: string }>;
  className?: string;
};

/**
 * 标签卡片：一张卡片里放多个可点击的标签。
 *
 * 为什么不用整张卡片作为链接：一张卡片里的标签会跳到**不同**小节
 * （例如「欧标语言」的 16 个标签分属四门语言、四个等级），
 * 整卡可点会与标签点击冲突，也会出现 <a> 嵌套 <a> 的无效结构。
 * 因此卡片是容器，标签各自成链接。
 */
export function TagCard({ title, tags, className }: TagCardProps) {
  // 标题与唯一标签重复时不再重复显示
  const showTitle = title !== undefined && title !== "" && !(tags.length === 1 && tags[0]?.label === title);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-ink-200 bg-white p-4",
        className,
      )}
    >
      {showTitle && (
        <h3 className="text-sm font-medium text-ink-900">{title}</h3>
      )}

      <div className={cn("flex flex-wrap gap-1.5", showTitle && "mt-3")}>
        {tags.map((tag) => (
          <Link
            key={`${tag.label}-${tag.href}`}
            href={tag.href}
            className="rounded-sm bg-brand-50 px-2 py-0.5 text-xs text-brand-700 transition-colors hover:bg-brand-100"
          >
            {tag.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
