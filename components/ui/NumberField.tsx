import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * 后缀要占多宽，就给输入框留多宽（与后台的 `NumberInput` 同一套口径）。
 *
 * 固定 `pr-10` 只够放「元」「节」「人」；单位一变长（「元 / 小时」）就会压住数字。
 * 原生上下微调箭头已经在 `app/globals.css` 里全局去掉了 —— 它与单位文字抢的是同一块地方。
 */
function suffixPadding(suffix: string | undefined): string {
  if (suffix === undefined || suffix === "") return "";
  if (suffix.length <= 3) return "pr-10";
  if (suffix.length <= 5) return "pr-16";
  return "pr-20";
}

type NumberFieldProps = {
  label: string;
  hint?: string;
  /** 单位后缀，例如「节」「人」「元」。 */
  suffix?: string;
} & Omit<ComponentProps<"input">, "className" | "type">;

/**
 * 数字输入框。
 * 报价页的「报课节数 / 班级人数 / 教师课时总费用」共用，
 * 统一标签、单位与焦点样式，避免三处各写一套。
 */
export function NumberField({ label, hint, suffix, id, ...props }: NumberFieldProps) {
  const fieldId = id ?? props.name ?? label;

  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      <div className="relative mt-2">
        <input
          id={fieldId}
          type="number"
          inputMode="numeric"
          className={cn(
            "w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-800",
            "transition-colors hover:border-brand-400",
            "focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
            suffixPadding(suffix),
          )}
          {...props}
        />
        {suffix !== undefined && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
