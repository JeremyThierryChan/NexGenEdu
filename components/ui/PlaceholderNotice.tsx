import { cn } from "@/lib/utils/cn";

type PlaceholderNoticeProps = {
  /** 提示中显示的来源文件，便于定位要改哪个 .md。 */
  source?: string;
  /** 追加说明，例如「教室名称待替换」。 */
  detail?: string;
  variant?: "block" | "inline";
  className?: string;
};

/**
 * 「（占位信息）」提示。
 *
 * 内容仍为占位信息时显示在对应区块旁，提醒此处需要替换为真实内容。
 * 对应的 .md 文件里把 placeholder 改为 false 后，该提示自动消失。
 */
export function PlaceholderNotice({
  source,
  detail,
  variant = "block",
  className,
}: PlaceholderNoticeProps) {
  const label = (
    <>
      <span className="font-medium">（占位信息）</span>
      {detail !== undefined && <span className="ml-1">{detail}</span>}
      {source !== undefined && (
        <span className="ml-1 text-ink-400">来源：{source}</span>
      )}
    </>
  );

  if (variant === "inline") {
    return (
      <p
        className={cn(
          "inline-flex items-center rounded-sm border border-dashed border-warning-500/40 bg-warning-50 px-2 py-0.5 text-xs text-warning-600",
          className,
        )}
      >
        {label}
      </p>
    );
  }

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1 rounded-md border border-dashed border-warning-500/40 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-600",
        className,
      )}
    >
      {label}
    </p>
  );
}
