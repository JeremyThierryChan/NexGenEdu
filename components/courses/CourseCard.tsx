import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type CourseCardProps = {
  title: string;
  /** 右上角标签，例如「初中 · 高中」；留空则不显示。 */
  tag?: string;
  /** 学段标签：同一学科的多个学段并排显示，便于横向对比。 */
  bands?: string[];
  /** 点击跳转地址。# 锚点会定位到课程详情。 */
  href: string;
  linkLabel: string;
  /**
   * 紧凑模式：更小的内边距与字号，且不显示底部链接文字。
   * 用于课程页顶部的学科总览（17 张卡片，需要一屏看清）；
   * 首页卡片用默认尺寸，两者观感仍属同一套设计语言。
   */
  compact?: boolean;
  className?: string;
};

/** 课程卡片。首页与课程页共用，通过 compact 控制信息密度。 */
export function CourseCard({
  title,
  tag,
  bands = [],
  href,
  linkLabel,
  compact = false,
  className,
}: CourseCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-lg border border-ink-200 bg-white transition-colors hover:border-brand-300",
        compact ? "px-3.5 py-3" : "p-6",
        className,
      )}
      aria-label={`${title}：${linkLabel}`}
    >
      <div className={cn("flex items-start justify-between", compact ? "gap-2" : "gap-3")}>
        <h3 className={cn("font-medium text-ink-900", compact ? "text-sm" : "text-base")}>
          {title}
        </h3>
        {tag !== undefined && tag !== "" && (
          <span className="shrink-0 text-xs text-ink-400">{tag}</span>
        )}
      </div>

      {bands.length > 0 && (
        <div className={cn("flex flex-wrap", compact ? "mt-2 gap-1" : "mt-3 gap-1.5")}>
          {bands.map((band) => (
            <span
              key={band}
              className={cn(
                "rounded-sm bg-ink-100 text-ink-600",
                compact ? "px-1.5 py-px text-[11px]" : "px-2 py-0.5 text-xs",
              )}
            >
              {band}
            </span>
          ))}
        </div>
      )}

      {/* 紧凑模式省去底部链接文字：整张卡片可点，不必为一行提示多占高度 */}
      {!compact && (
        <p className="mt-3 text-sm text-ink-500 transition-colors group-hover:text-brand-600">
          {linkLabel}
        </p>
      )}
    </Link>
  );
}
