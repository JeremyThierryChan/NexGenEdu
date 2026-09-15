import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { Container } from "@/components/ui/Container";
import { SITE } from "@/lib/site/config";
import { MAIN_NAV } from "@/lib/site/nav";

/**
 * 宣传网站页脚。
 * TODO(Phase 2): 联系方式改为读取 data/site/contact.md。
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-ink-200 bg-ink-50">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">
            {SITE.tagline}
          </p>
        </div>

        <nav aria-label="页脚导航">
          <h2 className="text-sm font-medium text-ink-900">网站导航</h2>
          <ul className="mt-4 space-y-2.5">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-ink-600 transition-colors hover:text-brand-700"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="text-sm font-medium text-ink-900">联系方式</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-600">
            <li>电话：{SITE.contact.phone}</li>
            <li>微信：{SITE.contact.wechat}</li>
            <li>邮箱：{SITE.contact.email}</li>
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium text-ink-900">校区地址</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-600">
            <li>{SITE.contact.address}</li>
            <li>{SITE.contact.businessHours}</li>
          </ul>
        </div>
      </Container>

      <Container className="flex flex-col gap-3 border-t border-ink-200 py-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {SITE.nameZh}（{SITE.name}）. 保留所有权利.
        </p>
        {/*
          后台入口（“教务后台” → /admin）暂不展示：
          静态导出时 /admin 页面尚未实现（Phase 4），链接会指向 404。
          Phase 4 完成 /admin 后在此处恢复该链接，届时用 <Link href="/admin">。
        */}
      </Container>
    </footer>
  );
}
