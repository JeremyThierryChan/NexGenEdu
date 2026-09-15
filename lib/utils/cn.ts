/**
 * 合并 className 的小工具。
 *
 * 只做「过滤空值 + 拼接」，不做 Tailwind 冲突消解：
 * 约定调用方传入的 className 位于最后，由 Tailwind 的 CSS 顺序决定胜负。
 * 保持零依赖、可预测，避免引入额外的运行时。
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
