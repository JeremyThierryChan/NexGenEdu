import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  label: string;
  options: SelectOption[];
  /** 未选择时显示的提示文字，同时作为空选项。 */
  placeholder: string;
  hint?: string;
} & Omit<ComponentProps<"select">, "className" | "children">;

/**
 * 下拉选择框。
 * 用原生 select：移动端体验好、无额外 JS、无障碍默认可用。
 */
export function Select({ label, options, placeholder, hint, id, ...props }: SelectProps) {
  const selectId = id ?? props.name ?? label;

  return (
    <div>
      <label htmlFor={selectId} className="block text-sm font-medium text-ink-800">
        {label}
      </label>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      <select
        id={selectId}
        className={cn(
          "mt-2 w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-800",
          "transition-colors hover:border-brand-400",
          "focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
        )}
        {...props}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
