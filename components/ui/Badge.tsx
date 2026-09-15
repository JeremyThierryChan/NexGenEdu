import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "accent"
  | "success"
  | "warning"
  | "danger";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-700 border-ink-200",
  brand: "bg-brand-50 text-brand-700 border-brand-200",
  accent: "bg-accent-50 text-accent-700 border-accent-200",
  success: "bg-success-50 text-success-600 border-success-100",
  warning: "bg-warning-50 text-warning-600 border-warning-100",
  danger: "bg-danger-50 text-danger-600 border-danger-100",
};

type BadgeProps = {
  tone?: BadgeTone;
  children: ReactNode;
  /** 前置小圆点，用于「使用中 / 空闲」这类状态标识。 */
  dot?: boolean;
  className?: string;
};

/** 状态徽章：课程状态、教室占用、课时预警等统一使用。 */
export function Badge({ tone = "neutral", children, dot = false, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
