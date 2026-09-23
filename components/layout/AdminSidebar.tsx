"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV } from "@/lib/site/admin-nav";
import { visiblePages } from "@/lib/auth/roles";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { cn } from "@/lib/utils/cn";

/** 选中态：/admin 精确匹配，其余匹配子路径。 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin" || pathname === "/admin/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * 后台侧边导航。
 *
 * 桌面端是**钉住的**侧栏（页面滚动时它不跟着走），移动端折叠为横向可滚动导航
 * （后台以桌面使用为主）。
 *
 * ## 桌面端"钉住"的三个必需要素（缺一个都会失效，不是可有可无的样式）
 *
 * 1. `lg:sticky` + `lg:top-[var(--admin-topbar-height)]`：贴在顶栏下面。
 *    偏移量用的是**顶栏那一份 CSS 变量**（定义在 `app/admin/(dashboard)/layout.tsx`）——
 *    写成固定的 `top-14` 就变成两处定义，顶栏一改高度侧栏就错位；
 * 2. `lg:self-start`：flex 行默认把子项**拉伸到整列高**，而"钉住"只在元素比滚动容器矮时
 *    才有意义 —— 一个本身就有整列高的元素是钉不住的（它会跟着页面一起滚走，看起来像没生效，
 *    这正是它以前"只写了注释说固定、实际没固定"的原因）。加了它之后侧栏高度 = 内容高度；
 *    代价是它不再铺满整列，因此**右边那条分隔线移到了内容区**（见 layout.tsx 的说明）；
 * 3. `lg:max-h-[…]` + `lg:overflow-y-auto`：侧栏比视口高时（导航项多、或窗口压得很扁）
 *    必须自己能滚 —— 否则被钉住之后，最下面那几项落在屏幕外，**怎么滚页面都够不到**。
 *    这是"钉住"最容易漏掉的一半：钉住了却够不到最后一项。
 */
export function AdminSidebar() {
  const pathname = usePathname();
  /*
   * 按角色藏入口：普通教师不该看到「数据与备份」这种入口 ——
   * 不是"点了才碰壁"，而是根本不该出现（分工见 docs/使用手册.md 的「谁能做什么」）。
   * 藏起来**不是**权限：权限在服务端（同一张角色表，见 lib/auth/roles.ts）。
   */
  const auth = useAuth();
  const allowed = visiblePages(rolesOrAll(auth));
  const items = ADMIN_NAV.filter((item) => allowed.includes(item.href));

  return (
    <nav
      aria-label="后台导航"
      className={cn(
        "shrink-0 bg-white",
        // 桌面：钉在顶栏下面、自身可滚、宽度固定（见上面三条说明）
        "lg:sticky lg:top-[var(--admin-topbar-height)] lg:z-10 lg:w-56 lg:self-start",
        "lg:max-h-[calc(100dvh_-_var(--admin-topbar-height))] lg:overflow-y-auto",
        // 移动端：横向滚动条（不钉，它只占一行、不参与垂直滚动）
        "max-lg:border-b max-lg:border-ink-200",
      )}
    >
      <ul
        className={cn(
          "flex gap-1 p-3",
          "max-lg:overflow-x-auto",
          "lg:flex-col lg:overflow-visible",
        )}
      >
        {items.map((item) => {
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
