import Link from "next/link";
import type { SiteBrand } from "@/lib/types/site";
import { cn } from "@/lib/utils/cn";

type LogoProps = {
  brand: SiteBrand;
  /** 深色背景场景（后台侧栏等）使用：给图垫一块白底，保证深色画稿也看得清。 */
  tone?: "dark" | "light";
  className?: string;
};

/**
 * 品牌标识：**图形 logo（英文标准字已经画在图里）+ 不再写第二遍文字**。
 *
 * 图片来自机构（2026-09：「用 image.png 这个图片，我已经放到根目录了」，
 * 「图里只有英文，不过没关系就用英文」）。原始图 1254×1254、**透明背景**；
 * 仓库里用的是**裁到内容、按内容比例重新导出**的 `public/logo.png`（512×386，
 * 去掉了原图四周不均匀的留白 —— 否则放进页头会因为左边多出 114px 空白而看着偏）。
 * 浏览器标签页的图标见 `app/icon.png` 与 `app/apple-icon.png`（同一张图、方形导出）。
 *
 * 两个刻意的取舍：
 *   1. **英文名不再另写一遍**：图里已经有了，页面上再写一次就是"logo 旁边又印一遍牌子"；
 *      中文名仍然在（`aria-label` 与页脚文案里），读屏与搜索不会因此丢掉"新锐教培"；
 *   2. **不写 `alt` 文字而是用外层链接的 `aria-label`**：读屏会把这段读两遍（链接名 + 图片名），
 *      所以图片按"装饰"处理，名字由链接说一次。
 *
 * 高度 44px：页头是固定 `h-16`（64px），装得下且不会因为 logo 换尺寸而改变页头高度
 * （页头高度是后台侧栏定位变量的一部分，改它会连带错位）。
 */
export function Logo({ brand, tone = "dark", className }: LogoProps) {
  const mark = (
    // 静态导出的站点不需要 next/image 的优化管线（next.config 里也是 unoptimized）
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt=""
      width={512}
      height={386}
      className="h-11 w-auto"
      // 图不大且是页头第一屏元素，优先加载（避免"先说文字、再冒出 logo"的跳动）
      fetchPriority="high"
    />
  );

  return (
    <Link
      href="/"
      className={cn("inline-flex shrink-0 items-center", className)}
      aria-label={`${brand.brandNameZh} 首页`}
    >
      {tone === "light" ? (
        <span className="inline-flex rounded-lg bg-white/95 px-2 py-1 shadow-sm">{mark}</span>
      ) : (
        mark
      )}
    </Link>
  );
}
