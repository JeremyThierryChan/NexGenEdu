import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

/**
 * 宣传网站（访客可见）布局：顶部导航 + 页脚。
 * 管理后台有自己的布局，二者互不影响。
 */
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
