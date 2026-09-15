"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/layout/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { HEADER_CTA, MAIN_NAV } from "@/lib/site/nav";
import type { SiteBrand } from "@/lib/types/site";
import { cn } from "@/lib/utils/cn";

/** 判断导航项是否处于选中态（首页精确匹配，其余匹配子路径）。 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

type HeaderProps = {
  brand: SiteBrand;
};

/** 宣传网站顶部导航：桌面完整展示，移动端折叠。 */
export function Header({ brand }: HeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // 路由变化后自动收起移动端菜单，避免菜单遮挡新页面。
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Logo brand={brand} />

        <nav className="hidden items-center gap-1 lg:flex" aria-label="主导航">
          {MAIN_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                isActive(pathname, item.href)
                  ? "font-medium text-brand-700"
                  : "text-ink-600 hover:text-ink-900",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ButtonLink href={HEADER_CTA.href} size="sm" className="hidden sm:inline-flex">
            {HEADER_CTA.label}
          </ButtonLink>
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "关闭菜单" : "打开菜单"}
            className="inline-flex size-10 items-center justify-center rounded-md text-ink-700 hover:bg-ink-100 lg:hidden"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              {mobileOpen ? (
                <path d="M5 5l10 10M15 5L5 15" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" />
              )}
            </svg>
          </button>
        </div>
      </Container>

      {mobileOpen && (
        <nav
          id="mobile-nav"
          aria-label="移动端导航"
          className="border-t border-ink-200 bg-white lg:hidden"
        >
          <Container className="flex flex-col py-2">
            {MAIN_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(pathname, item.href) ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-3 text-sm",
                  isActive(pathname, item.href)
                    ? "font-medium text-brand-700"
                    : "text-ink-700",
                )}
              >
                {item.label}
              </Link>
            ))}
          </Container>
        </nav>
      )}
    </header>
  );
}
