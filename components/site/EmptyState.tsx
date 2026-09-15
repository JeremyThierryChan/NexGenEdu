import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

/** 空状态：用于数据尚未接入的区块，明确告知「待录入」而不是展示假数据。 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-medium text-ink-800">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-500">
        {description}
      </p>
      {action !== undefined && <div className="mt-6">{action}</div>}
    </div>
  );
}
