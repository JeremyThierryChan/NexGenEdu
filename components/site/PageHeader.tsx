import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
};

/** 内页页头：统一标题区排版，避免每个页面各写一套。 */
export function PageHeader({ eyebrow, title, description, children }: PageHeaderProps) {
  return (
    <div className="border-b border-ink-200 bg-ink-50">
      <Container className="py-14 sm:py-16">
        <div className="max-w-2xl">
          {eyebrow !== undefined && (
            <p className="text-sm font-medium text-brand-600">{eyebrow}</p>
          )}
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {description !== undefined && (
            <p className="mt-5 text-base leading-relaxed text-ink-600">{description}</p>
          )}
          {children !== undefined && <div className="mt-7">{children}</div>}
        </div>
      </Container>
    </div>
  );
}
