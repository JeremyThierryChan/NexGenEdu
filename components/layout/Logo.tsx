import Link from "next/link";
import { SITE } from "@/lib/site/config";
import { cn } from "@/lib/utils/cn";

type LogoProps = {
  /** 后台侧边栏等深色背景场景使用反白样式。 */
  tone?: "dark" | "light";
  /** 是否显示中文全称。 */
  showName?: boolean;
  className?: string;
};

/** 品牌标识：文字 Logo，避免依赖图片资源，保证首屏无额外请求。 */
export function Logo({ tone = "dark", showName = true, className }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn("inline-flex items-baseline gap-2", className)}
      aria-label={`${SITE.nameZh} 首页`}
    >
      <span
        className={cn(
          "text-lg font-bold tracking-tight",
          tone === "dark" ? "text-brand-800" : "text-white",
        )}
      >
        {SITE.name}
      </span>
      {showName && (
        <span
          className={cn(
            "text-sm font-medium",
            tone === "dark" ? "text-ink-500" : "text-ink-300",
          )}
        >
          {SITE.nameZh}
        </span>
      )}
    </Link>
  );
}
