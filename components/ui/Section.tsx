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
}: SectionProps) {
  const hasHeading = eyebrow !== undefined || title !== undefined || description !== undefined;

  return (
    <section className={cn("py-16 sm:py-20", className)}>
      {hasHeading && (
        <header className="mb-10 max-w-2xl">
          {eyebrow !== undefined && (
            <p className="mb-3 text-sm font-medium tracking-wide text-brand-600">
              {eyebrow}
            </p>
          )}
          {title !== undefined && (
            <h2 className="text-2xl font-medium sm:text-3xl">{title}</h2>
          )}
          {description !== undefined && (
            <p className="mt-4 text-base leading-relaxed text-ink-600">{description}</p>
          )}
        </header>
      )}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
