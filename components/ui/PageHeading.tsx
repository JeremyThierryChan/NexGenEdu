import type { ComponentProps } from "react";

type PageHeadingProps = {
  title: string;
  description?: string;
} & Omit<ComponentProps<"div">, "title" | "className" | "children">;

/** 页面标题区：后台各页面统一使用，保证标题层级一致。 */
export function PageHeading({ title, description, ...props }: PageHeadingProps) {
  return (
    <div className="mb-5" {...props}>
      <h1 className="text-lg font-medium text-ink-900">{title}</h1>
      {description !== undefined && (
        <p className="mt-1 text-sm text-ink-500">{description}</p>
      )}
    </div>
  );
}
