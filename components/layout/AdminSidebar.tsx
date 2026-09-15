"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/site/admin-nav";
import { cn } from "@/lib/utils/cn";

/** 选中态：/admin 精确匹配，其余匹配子路径。 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin" || pathname === "/admin/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 后台侧边导航。
 * 桌面端为固定侧栏，移动端折叠为横向可滚动导航（后台以桌面使用为主）。
 */
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="后台导航"
      className={cn(
        "shrink-0 border-ink-200 bg-white",
        // 桌面：固定宽度侧栏
        "lg:w-56 lg:border-r",
        // 移动端：横向滚动条
        "max-lg:border-b",
      )}
    >
      <ul
        className={cn(
          "flex gap-1 p-3",
          "max-lg:overflow-x-auto",
          "lg:flex-col lg:overflow-visible",
        )}
      >
        {ADMIN_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0 lg:shrink">
              <Link
                href={item.href}
                title={item.description}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-brand-50 font-medium text-brand-700"
                    : "text-ink-600 hover:bg-ink-50 hover:text-ink-900",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
