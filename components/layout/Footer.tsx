import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { Container } from "@/components/ui/Container";
import { PlaceholderNotice } from "@/components/ui/PlaceholderNotice";
import { MAIN_NAV } from "@/lib/site/nav";
import type { SiteBrand } from "@/lib/types/site";

type FooterProps = {
  brand: SiteBrand;
};

/** 宣传网站页脚。品牌与联系方式来自 data/site/content.md。 */
export function Footer({ brand }: FooterProps) {
  const year = new Date().getFullYear();
  const { contact } = brand;

  return (
    <footer className="border-t border-ink-200 bg-ink-50">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <Logo brand={brand} />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600">
            {brand.tagline}
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
            <li>电话：{contact.phone}</li>
            <li>微信：{contact.wechat}</li>
            <li>邮箱：{contact.email}</li>
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium text-ink-900">校区地址</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-600">
            <li>{contact.address}</li>
            <li>{contact.businessHours}</li>
          </ul>
        </div>
      </Container>

      {contact.placeholder && (
        <Container className="pb-6">
          <PlaceholderNotice source="data/site/content.md" />
        </Container>
      )}

      <Container className="flex flex-col gap-3 border-t border-ink-200 py-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {brand.copyrightHolder}. 保留所有权利.
        </p>
        <Link href="/admin" className="transition-colors hover:text-brand-700">
          教务后台
        </Link>
      </Container>
    </footer>
  );
}
