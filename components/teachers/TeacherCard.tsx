import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { Teacher } from "@/lib/types/site";
import { cn } from "@/lib/utils/cn";

type TeacherCardProps = {
  teacher: Teacher;
  /** 点击跳转地址。传 null 时渲染为纯展示卡片（详情页内部使用）。 */
  href?: string | null;
  className?: string;
};

/**
 * 教师卡片。
 * 没有照片时用姓名首字作为圆形头像，避免出现空白占位框。
 */
export function TeacherCard({ teacher, href, className }: TeacherCardProps) {
  const content = (
    <>
      <div className="flex items-center gap-4">
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-base font-medium text-brand-700"
          aria-hidden
        >
          {teacher.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-medium text-ink-900">{teacher.name}</h3>
          <p className="mt-0.5 text-sm text-ink-500">{teacher.role}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {teacher.subjects.map((subject) => (
          <Badge key={subject} tone="brand">
            {subject}
          </Badge>
        ))}
        {teacher.years !== "" && <Badge tone="neutral">{teacher.years}</Badge>}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-600">{teacher.summary}</p>
    </>
  );

  const baseClassName = cn(
    "block rounded-lg border border-ink-200 bg-white p-6",
    href != null && "transition-colors hover:border-brand-300",
    className,
  );

  if (href == null) {
    return <div className={baseClassName}>{content}</div>;
  }

  return (
    <Link href={href} className={baseClassName}>
      {content}
    </Link>
  );
}
