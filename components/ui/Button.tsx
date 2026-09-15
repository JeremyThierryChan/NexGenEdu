import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 shadow-sm",
  secondary:
    "bg-accent-400 text-brand-950 hover:bg-accent-300 active:bg-accent-500",
  outline:
    "border border-ink-300 bg-white text-ink-800 hover:border-brand-400 hover:text-brand-700",
  ghost: "text-ink-700 hover:bg-ink-100 hover:text-ink-900",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors " +
  "disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap";

type ButtonBaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

/** 普通按钮：用于表单提交等交互场景。 */
export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonBaseProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button
      className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * 链接按钮：视觉与 Button 一致，但渲染为 next/link。
 * 宣传网站的 CTA 全部使用它，避免「按钮里套链接」的无障碍问题。
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonBaseProps & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link
      className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)}
      {...props}
    >
      {children}
    </Link>
  );
}
