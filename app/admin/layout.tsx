import type { Metadata } from "next";

/**
 * 教务后台的根布局：只负责 metadata，界面外壳在 (dashboard) 分组里。
 *
 * 这样分是因为登录页 `/admin/login` 不属于「已登录后台」：
 * 它不该出现侧边栏，也不该被登录守卫包裹。
 *
 * 静态导出（GitHub Pages）下后台同样是静态页面：数据来自浏览器 localStorage，
 * 写操作也保存在浏览器里，不跨设备共享（见 lib/backend/api.ts 与 PROJECT.md）。
 */
export const metadata: Metadata = {
  // Next 的 title 模板必须同时提供 default（只写 template 通不过类型检查），
  // 因此这里把 default 设为后台首页名称。各子页面自行声明 title，
  // 渲染结果形如「学生 | 教务后台」。
  title: {
    default: "今日概览",
    template: "%s | 教务后台",
  },
  // 后台不应被搜索引擎收录。
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
