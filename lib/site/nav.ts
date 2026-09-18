/**
 * 站点导航配置。
 *
 * 这里是结构配置（路径与顺序），不是文案内容，因此留在代码里。
 * 若未来需要让非技术人员调整导航，可迁移到 data/site/*.md。
 *
 * 分两级的原因：页面变多后（课程 / 报价 / 教师 / 学生案例 / 常见问题 /
 * 时间安排 / 关于 / 联系）全部塞进页头会挤成一排小字。
 * 页头只放家长最常点的入口，次一级入口放在页脚，仍是一层可达。
 */
export type NavItem = {
  href: string;
  label: string;
};

/** 页头主导航。 */
export const MAIN_NAV: readonly NavItem[] = [
  { href: "/", label: "首页" },
  { href: "/courses", label: "课程" },
  { href: "/quote", label: "报价" },
  { href: "/teachers", label: "教师" },
  { href: "/cases", label: "学生案例" },
  { href: "/contact", label: "联系我们" },
] as const;

/** 页脚补充导航（与主导航合并后覆盖全部页面）。 */
export const SECONDARY_NAV: readonly NavItem[] = [
  { href: "/courses/featured", label: "特色课程" },
  { href: "/schedule", label: "课程时间安排" },
  { href: "/faq", label: "常见问题" },
  { href: "/about", label: "关于我们" },
] as const;

/** 页头右上角的行动按钮。文案与链接属于可自定义内容，当前为代码内固定值，后续可迁移到 content.md。 */
export const HEADER_CTA = {
  label: "预约试听",
  href: "/contact",
} as const;
