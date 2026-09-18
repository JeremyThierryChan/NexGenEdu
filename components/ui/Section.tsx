import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type SectionProps = {
  children: ReactNode;
  /** 小节标题：eyebrow 为上方小字，title 为主标题，description 为说明。 */
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  /** 内容区额外样式。 */
  contentClassName?: string;
  /**
   * 紧凑间距：区块上下留白与标题下方间距都收紧。
   *
   * 用于首页课程栏目这类**连续排列的同类区块**：默认的大留白在单个区块里好看，
   * 但六个栏目依次叠起来时，上一个的下留白会和下一个的上留白相加
   * （py-16×2 ≈ 128px，宽屏 160px），中间像断了一截。
   */
  compact?: boolean;
};

/**
 * 宣传网站的内容区块：统一垂直留白与标题排版。
 * 大留白是设计基调，区块间距默认给得比较宽。
 */
export function Section({
  children,
  eyebrow,
  title,
  description,
  className,
  contentClassName,
  compact = false,
}: SectionProps) {
  const hasHeading = eyebrow !== undefined || title !== undefined || description !== undefined;

  return (
    <section className={cn(compact ? "py-6 sm:py-8" : "py-16 sm:py-20", className)}>
      {hasHeading && (
        <header className={cn("max-w-2xl", compact ? "mb-5" : "mb-10")}>
          {eyebrow !== undefined && (
            <p className="mb-3 text-sm font-medium tracking-wide text-brand-600">
              {eyebrow}
            </p>
          )}
          {title !== undefined && (
            <h2 className="text-2xl font-medium sm:text-3xl">{title}</h2>
          )}
          {description !== undefined && (
            <p
              className={cn(
                "leading-relaxed text-ink-600",
                compact ? "mt-2.5 text-sm" : "mt-4 text-base",
              )}
            >
              {description}
            </p>
          )}
        </header>
      )}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
