import type { Metadata } from "next";

/**
 * 教务后台的根布局：只负责 metadata，界面外壳在 (dashboard) 分组里。
 *
 * 这样分是因为登录页 `/admin/login` 不属于「已登录后台」：
 * 它不该出现侧边栏，也不该被登录守卫包裹。
 *
 * 后台页面本身是静态导出的，但**数据不在页面这一侧**：本机使用时（设置了
 * `NEXT_PUBLIC_API_BASE`）`lib/backend/api.ts` 导出的 `api` 是一层代理，
 * 请求打到本机后端的 `POST /api/call`，数据落在服务端 SQLite 里。
 * 线上那份静态站连不上后端，因此后台在线上**无法登录**（界面会说明原因）。
 * 见 lib/backend/remote.ts、server/index.mts 与 PROJECT.md。
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
