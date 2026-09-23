import { useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";
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

/**
 * 折叠状态的存放处（浏览器本地）。
 *
 * 键 = **页面路径 + 面板标题**：
 *   - 带路径是必须的 —— 后台里「批量导入」「保存」这类标题在很多页面上都有，
 *     不带路径的话在课程页折叠了「批量导入」，学生页那几个也跟着折叠；
 *   - 用标题而不是序号：序号会随页面上新面板的加入整体错位，
 *     而标题是稳定、人能读懂的键（改标题会丢这条记忆，可以接受）。
 *
 * 与令牌一样放在 `localStorage`：这是"这台电脑上这个人的使用习惯"，
 * 不该进数据库，也不该跨机器同步（见 `lib/auth/token.ts` 的同类说明）。
 */
const PANEL_STATE_KEY = (path: string, title: string): string =>
  `nexgenedu.admin.panel-open.v1::${path}::${title}`;

function panelStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 隐私模式 / 被禁用的 localStorage：读不到就当没记住过，折叠仍然能用
    return null;
  }
}

function readPanelOpen(path: string, title: string): boolean | null {
  try {
    const raw = panelStorage()?.getItem(PANEL_STATE_KEY(path, title)) ?? null;
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writePanelOpen(path: string, title: string, open: boolean): void {
  try {
    panelStorage()?.setItem(PANEL_STATE_KEY(path, title), open ? "1" : "0");
  } catch {
    // 写不进去（配额 / 隐私模式）不影响这次折叠，只是下次打开记不住
  }
}

/**
 * 面板（后台的"卡片"）：行内编辑区 / 详情区共用的容器。
 *
 * ## 可以折叠，而且**记得住**（机构：「每个卡片都可以折叠，这样闲时可以占用更少的空间」）
 *
 * - 点标题栏（或它右边的箭头）折叠 / 展开；`actions` 上的按钮**始终可见** ——
 *   「保存」这类动作不该因为面板收起来而消失；
 * - 折叠状态按"页面路径 + 面板标题"记在本地，下次打开这一页还是那个样子；
 * - **折叠不卸载内容**：收起来用 `hidden`，不是"不渲染"。
 *   这条是硬的 —— 面板里常有没保存的草稿（课程正文、报价草稿），
 *   卸载等于把它们悄悄丢掉（同一个教训见 /admin/courses 的页签：那里也要求 `hidden` 保活）。
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  collapsible = true,
  defaultCollapsed = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 是否可折叠（默认可以）。 */
  collapsible?: boolean;
  /** 第一次见到这个面板时是展开还是折叠（默认展开：藏起来的东西没人会去找）。 */
  defaultCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const bodyId = useId();

  /*
   * 记住的那个状态在**挂载之后**才应用，而不是写进 `useState` 的初始值。
   *
   * 为什么：这些页面是静态导出的，服务端渲染时没有 `window`；在初始值里读
   * 会变成"服务端渲染成展开、浏览器首屏就折叠"，两边不一致 —— React 会报
   * hydration 错误（开发模式下显眼，生产环境是一次静默的整树重建）。
   * 代价是首帧按展开渲染、随后按记忆收起来，肉眼基本看不见。
   */
  useEffect(() => {
    if (!collapsible) return;
    const saved = readPanelOpen(window.location.pathname, title);
    if (saved !== null) setOpen(saved);
  }, [collapsible, title]);

  const toggle = (): void => {
    setOpen((prev) => {
      const next = !prev;
      writePanelOpen(window.location.pathname, title, next);
      return next;
    });
  };

  return (
    <section className={cn("rounded-lg border border-ink-200 bg-white", className)}>
      <header
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
          // 展开时标题栏与内容之间有一条分隔线；收起时那条线是多余的（下面什么都没有）
          open && "border-b border-ink-100",
        )}
      >
        {collapsible ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0 text-ink-400 transition-transform",
                !open && "-rotate-90",
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
            <span className="min-w-0">
              <h2 className="text-sm font-medium text-ink-900">{title}</h2>
              {description !== undefined && (
                <p className="mt-0.5 text-xs text-ink-500">{description}</p>
              )}
            </span>
          </button>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-ink-900">{title}</h2>
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-ink-500">{description}</p>
            )}
          </div>
        )}
        {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {/* `hidden` 而不是条件渲染：见上面「折叠不卸载内容」 */}
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
