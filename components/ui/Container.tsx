import type { ComponentProps, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type ContainerProps = {
  children: ReactNode;
  className?: string;
  /** 允许渲染为 nav / section 等语义标签，避免多余包裹层。 */
  as?: ElementType;
} & Omit<ComponentProps<"div">, "className" | "children">;

/** 全站统一的内容宽度与左右留白。 */
export function Container({ children, className, as, ...props }: ContainerProps) {
  const Tag = (as ?? "div") as ElementType;

  return (
    <Tag className={cn("mx-auto w-full max-w-6xl px-5 sm:px-8", className)} {...props}>
      {children}
    </Tag>
  );
}
