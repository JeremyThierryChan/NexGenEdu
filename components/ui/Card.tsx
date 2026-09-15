import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type CardProps = {
  children: ReactNode;
  /** 可选标题与描述，传了就渲染统一的卡片头部。 */
  title?: ReactNode;
  description?: ReactNode;
  /** 右上角操作区（例如「查看全部」）。 */
  action?: ReactNode;
  /** hover 效果：可点击的卡片开启，纯展示卡片关闭。 */
  interactive?: boolean;
  className?: string;
} & Omit<ComponentProps<"div">, "className" | "children" | "title">;

/**
 * 通用卡片容器。
 * 后台与宣传网站共享：后台使用更紧凑的 padding，通过 className 覆盖即可。
 */
export function Card({
  children,
  title,
  description,
  action,
  interactive = false,
  className,
  ...props
}: CardProps) {
  const hasHeader = title !== undefined || description !== undefined || action !== undefined;

  return (
    <div
      className={cn(
        "rounded-lg border border-ink-200 bg-white",
        interactive && "transition-colors hover:border-brand-300",
        className,
      )}
      {...props}
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            {title !== undefined && (
              <h3 className="text-base font-medium text-ink-900">{title}</h3>
            )}
            {description !== undefined && (
              <p className="mt-1 text-sm text-ink-500">{description}</p>
            )}
          </div>
          {action !== undefined && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}
