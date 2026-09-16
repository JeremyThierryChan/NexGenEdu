import Link from "next/link";
import type { SiteBrand } from "@/lib/types/site";
import { cn } from "@/lib/utils/cn";

type LogoProps = {
  brand: SiteBrand;
  /** 后台等深色背景场景使用反白样式。 */
  tone?: "dark" | "light";
  className?: string;
};

/** 品牌标识：文字 Logo，避免依赖图片资源。名称来自 data/site/content.md。 */
export function Logo({ brand, tone = "dark", className }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn("inline-flex items-baseline gap-2", className)}
      aria-label={`${brand.brandNameZh} 首页`}
    >
      <span
        className={cn(
          "text-lg font-bold tracking-tight",
          tone === "dark" ? "text-brand-800" : "text-white",
        )}
      >
        {brand.brandName}
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          tone === "dark" ? "text-ink-500" : "text-ink-300",
        )}
      >
        {brand.brandNameZh}
      </span>
    </Link>
  );
}
