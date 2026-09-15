import type { ReactNode } from "react";

type FeatureCardProps = {
  /** 简洁的线性图标，避免引入图标库依赖。 */
  icon: ReactNode;
  title: string;
  description: string;
};

/** 首页教学特色卡片：标题 + 一句话说明，不做花哨装饰。 */
export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-6">
      <div className="flex size-9 items-center justify-center rounded-md bg-brand-50 text-brand-700">
        {icon}
      </div>
      <h3 className="mt-5 text-base font-medium text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{description}</p>
    </div>
  );
}
