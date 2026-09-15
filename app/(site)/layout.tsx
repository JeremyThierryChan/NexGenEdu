import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { getSiteBrand } from "@/lib/data/site";

/**
 * 宣传网站（访客可见）布局：顶部导航 + 页脚。
 *
 * 品牌与联系信息在这里读取一次，向下传给页头与页脚，
 * 避免同一份数据被每个组件各自读取。管理后台有独立布局，互不影响。
 */
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brand = getSiteBrand();

  return (
    <div className="flex min-h-dvh flex-col">
      <Header brand={brand} />
      <main className="flex-1">{children}</main>
      <Footer brand={brand} />
    </div>
  );
}
