/**
 * 宣传网站主导航。
 * 放在数据文件里而非组件里，方便后续接入后台可配置导航。
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
