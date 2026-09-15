/**
 * 站点导航配置。
 *
 * 这里是结构配置（路径与顺序），不是文案内容，因此留在代码里。
 * 若未来需要让非技术人员调整导航，可迁移到 data/site/*.md。
 */
export type NavItem = {
  href: string;
  label: string;
};

export const MAIN_NAV: readonly NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/courses", label: "课程" },
  { href: "/teachers", label: "教师" },
  { href: "/about", label: "关于我们" },
  { href: "/contact", label: "联系我们" },
] as const;

/** 页头右上角的行动按钮。文案与链接属于可自定义内容，当前取值见 data/site/site.md（后续可扩展）。 */
export const HEADER_CTA = {
  label: "预约试听",
  href: "/contact",
} as const;
