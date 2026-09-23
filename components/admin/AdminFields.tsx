import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * 后台表单控件。
 *
 * 与宣传网站的表单分开：后台的信息密度更高（标签在上、控件更矮、副标题更小），
 * 而且大量用于「列表上方的行内编辑面板」，因此统一收在这里，
 * 避免每个模块各写一套 input 样式。
 */

/**
 * 输入控件的统一样式。
 *
 * 导出它是给**表格里的行内编辑**用的（课程类型页那种"一行若干控件、表头已经写了名字"的
 * 场景）：那里用 `TextField` 会多出一行空标签（标签在上，空串也占位），
 * 而直接用裸 `<input>` 又会丢掉这套样式。于是样式在一处，页面自己拼控件。
 */
export const CONTROL_CLASS =
  "block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm text-ink-900 " +
  "outline-none transition-colors placeholder:text-ink-400 " +
  "focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50 disabled:text-ink-400";

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
};

/** 字段外壳：标签 + 提示 + 控件。 */
export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <label className={cn("block", className)}>
      <span className="text-xs font-medium text-ink-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint !== undefined && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  hint,
  className,
  ...props
}: { label: string; hint?: string; className?: string } & Omit<
  ComponentProps<"input">,
  "className"
>) {
  return (
    <Field label={label} hint={hint}>
      <input className={cn(CONTROL_CLASS, className)} {...props} />
    </Field>
  );
}

export function TextAreaField({
  label,
  hint,
  rows = 3,
  className,
  ...props
}: { label: string; hint?: string; className?: string } & Omit<
  ComponentProps<"textarea">,
  "className"
>) {
  return (
    <Field label={label} hint={hint}>
      <textarea rows={rows} className={cn(CONTROL_CLASS, className)} {...props} />
    </Field>
  );
}

/**
 * 后缀要占多宽，就得给输入框留多宽。
 *
 * 这里原先固定写 `pr-10`（40px）—— 够放「元」「节」「分钟」，但「**元 / 小时**」
 * 有 4 个可见字（≈56px），后缀会压在输入的数字上；原生微调箭头又贴着右缘
 * （已经在 `app/globals.css` 里全局去掉）。两处叠起来就是机构看到的那团混乱。
 * 按后缀长度分档留白，比"再加一点"稳：换单位文字（例如「元 / 小时」→「元 / 课时」）
 * 不用回来改这个文件。
 */
function suffixPadding(suffix: string | undefined): string {
  if (suffix === undefined || suffix === "") return "";
  if (suffix.length <= 3) return "pr-10";
  if (suffix.length <= 5) return "pr-16";
  return "pr-20";
}

export function NumberInput({
  label,
  hint,
  suffix,
  className,
  ...props
}: { label: string; hint?: string; suffix?: string; className?: string } & Omit<
  ComponentProps<"input">,
  "className" | "type"
>) {
  return (
    <Field label={label} hint={hint}>
      <span className="relative block">
        <input
          type="number"
          className={cn(CONTROL_CLASS, suffixPadding(suffix), className)}
          {...props}
        />
        {suffix !== undefined && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-ink-400">
            {suffix}
          </span>
        )}
      </span>
    </Field>
  );
}

export function SelectInput({
  label,
  hint,
  options,
  className,
  ...props
}: {
  label: string;
  hint?: string;
  className?: string;
  options: Array<{ value: string; label: string }>;
} & Omit<ComponentProps<"select">, "className" | "children">) {
  return (
    <Field label={label} hint={hint}>
      <select className={cn(CONTROL_CLASS, className)} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** 面板：行内编辑区 / 详情区共用的容器。 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-ink-200 bg-white", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink-900">{title}</h2>
          {description !== undefined && (
            <p className="mt-0.5 text-xs text-ink-500">{description}</p>
          )}
        </div>
        {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
