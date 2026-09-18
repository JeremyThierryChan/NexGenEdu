import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/layout/Footer";
import { Logo } from "@/components/layout/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { getSiteBrand } from "@/lib/data/site";
import { MAIN_NAV, SECONDARY_NAV } from "@/lib/site/nav";

export const metadata: Metadata = {
  title: "这一页还没学到",
  description: "页面不存在或已调整。可以从下面的入口继续浏览。",
};

/**
 * 404 页面。
 *
 * 设计思路：用「页码」的学习意象（翻书翻到了不存在的页码），
 * 而不是常见的「迷路了」套路文案 —— 与教育机构的语境更贴合。
 *
 * 除了文案，重点在于给出**完整的页面入口**：
 * 误入 404 的访客多数是想找课程 / 报价 / 联系方式，
 * 直接把导航铺开比只放一个「返回首页」更有用。
 *
 * 说明：GitHub Pages 这类静态托管只在站点根目录查找 404.html，
 * 因此这里不依赖 (site) 路由组的布局，自行组合页头与页脚。
 */
export default function NotFound() {
  const brand = getSiteBrand();
  const entries = [...MAIN_NAV, ...SECONDARY_NAV].filter((item) => item.href !== "/");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-ink-200 bg-white">
        <Container className="flex h-16 items-center">
          <Logo brand={brand} />
        </Container>
      </header>

      <main className="flex-1">
        <Container className="py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="max-w-2xl">
              {/* 页码意象：像一本翻到不存在页码的书 */}
              <p className="text-sm font-medium text-brand-600">404</p>
              <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                这一页还没学到
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-ink-600">
                你要找的页面不存在，或者地址已经调整过了。
              </p>
              <p className="mt-3 leading-relaxed text-ink-500">
                像翻书翻到了还没印上去的页码。不过没关系，该学的内容都在下面的目录里。
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <ButtonLink href="/" size="lg">
                  回到首页
                </ButtonLink>
                <ButtonLink href="/courses" size="lg" variant="outline">
                  浏览课程
                </ButtonLink>
              </div>

              <dl className="mt-12 grid gap-6 border-t border-ink-200 pt-8 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-ink-900">想了解怎么上课</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-ink-600">
                    课程时间安排写明了工作日与周末的时段。
                  </dd>
                  <dd className="mt-2">
                    <Link
                      href="/schedule"
                      className="text-sm text-brand-700 transition-colors hover:text-brand-800"
                    >
                      查看时间安排 →
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-ink-900">想直接问我们</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-ink-600">
                    电话或微信都可以，说明学生的年级与科目即可。
                  </dd>
                  <dd className="mt-2">
                    <Link
                      href="/contact"
                      className="text-sm text-brand-700 transition-colors hover:text-brand-800"
                    >
                      联系方式 →
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>

            {/* 目录：把站点入口铺开，避免误入者只能返回首页 */}
            <aside className="rounded-lg border border-ink-200 bg-ink-50 p-6">
              <h2 className="text-sm font-medium text-ink-900">站内目录</h2>
              <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 lg:grid-cols-1">
                {entries.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-ink-700 transition-colors hover:text-brand-700"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </Container>
      </main>

      <Footer brand={brand} />
    </div>
  );
}
