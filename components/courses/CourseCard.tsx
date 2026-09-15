import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type CourseCardProps = {
  title: string;
  /** 右上角标签，例如「初中 · 高中」；留空则不显示。 */
  tag?: string;
  /** 点击跳转地址。# 锚点会定位到课程详情。 */
  href: string;
  linkLabel: string;
  className?: string;
};

/** 课程卡片。首页与课程页共用，保证两处观感一致。 */
export function CourseCard({ title, tag, href, linkLabel, className }: CourseCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-lg border border-ink-200 bg-white p-6 transition-colors hover:border-brand-300",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium text-ink-900">{title}</h3>
        {tag !== undefined && tag !== "" && (
          <span className="shrink-0 text-xs text-ink-400">{tag}</span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink-500 transition-colors group-hover:text-brand-600">
        {linkLabel}
      </p>
    </Link>
  );
}
