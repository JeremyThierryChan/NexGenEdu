import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import type { Teacher } from "@/lib/types/site";
import { cn } from "@/lib/utils/cn";

/** 卡片上最多显示的科目标签数，超出部分折叠为「等 N 门」。 */
const MAX_CARD_SUBJECTS = 4;

type TeacherCardProps = {
  /** 教学角色（真人教师或 AI 智能体）。 */
  teacher?: Teacher;
  /** 语义别名：写 agent={{...}} 更易读，与 teacher 二选一。 */
  agent?: Teacher;
  /** 点击跳转地址。传 null 时渲染为纯展示卡片（详情页内部使用）。 */
  href?: string | null;
  className?: string;
};

/**
 * 教师卡片。
 * 没有照片时用姓名首字作为圆形头像，避免出现空白框。
 */
export function TeacherCard({
  teacher: teacherProp,
  agent,
  href,
  className,
}: TeacherCardProps) {
  const teacher = agent ?? teacherProp;
  if (teacher === undefined) {
    throw new Error("TeacherCard 需要传入 teacher 或 agent。");
  }
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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium text-ink-900">{teacher.name}</h3>
            {/* AI 智能体需要显著标注，避免家长误认为是真人教师 */}
            {teacher.kind === "ai" && <Badge tone="accent">AI 智能体</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-ink-500">{teacher.role}</p>
        </div>
      </div>

      {/*
        卡片上最多显示 4 个科目标签，其余折叠为「等 N 门」。
        否则像一位覆盖十几门学科的教师，卡片会被标签撑得远高于同排其他卡片。
      */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {teacher.subjects.slice(0, MAX_CARD_SUBJECTS).map((subject) => (
          <Badge key={subject} tone="brand">
            {subject}
          </Badge>
        ))}
        {teacher.subjects.length > MAX_CARD_SUBJECTS && (
          <Badge tone="neutral">等 {teacher.subjects.length} 门</Badge>
        )}
        {teacher.years !== "" && <Badge tone="neutral">{teacher.years}</Badge>}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-600">{teacher.summary}</p>

      {teacher.recommendation !== "" && (
        <p className="mt-4 rounded-md bg-brand-50/70 px-3 py-2 text-xs leading-relaxed text-brand-800">
          <span className="font-medium">推荐理由</span>
          {teacher.recommendation}
        </p>
      )}
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
