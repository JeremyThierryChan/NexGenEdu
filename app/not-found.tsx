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

/** 教务后台的路径前缀（与 lib/site/admin-nav.ts 里各入口的前缀一致）。 */
const BACKOFFICE_PREFIX = "/admin";

/**
 * 分流脚本：按当前地址决定显示哪一版 404。
 *
 * 为什么需要它：静态托管（GitHub Pages）只认站点根目录的**一个** 404.html，
 * 服务器没有机会按路径返回不同内容。因此两版内容都渲染进同一个文件，
 * 由这段脚本读 location.pathname 打上 `data-nf-route`，再用 CSS 选择显示。
 *
 * 三个细节：
 * - 脚本放在最前面，只写属性、不碰 DOM 节点 —— 此刻两版内容还没被解析出来，
 *   而且属性一打上 CSS 立即生效，不会先闪一下网站版；
 * - 站内链接带 basePath（项目站点在 /<repo>/ 下），比较前先剥掉；
 * - 不依赖 React 水合：即使 JS 包加载失败，这段内联脚本也已经执行过。
 */
const ROUTE_SCRIPT = `(function(){try{
var base=${JSON.stringify(process.env.NEXT_PUBLIC_BASE_PATH ?? "")};
var path=location.pathname;
if(base&&path.indexOf(base)===0)path=path.slice(base.length);
if(path==="${BACKOFFICE_PREFIX}"||path.indexOf("${BACKOFFICE_PREFIX}/")===0){
document.documentElement.setAttribute("data-nf-route","backoffice");
document.addEventListener("DOMContentLoaded",function(){
document.title="功能尚未完善 | 教务后台";
var slot=document.querySelector("[data-nf-path]");
if(slot)slot.textContent=location.pathname;});
}}catch(e){}})();`;

/**
 * 404 页面（两版合一的静态产物）。
 *
 * 一、网站版：给误入的访客用。
 * 设计思路是用「页码」的学习意象（翻书翻到了不存在的页码），
 * 而不是常见的「迷路了」套路文案；除了文案，重点在于给出**完整的页面入口** ——
 * 误入 404 的访客多数是想找课程 / 报价 / 联系方式，铺开导航比只放「返回首页」更有用。
 *
 * 二、教务后台版：给后台同事用。
 * 后台的 404 大多是**功能还没做**（侧边栏的 学生 / 教师 / 教室 / 课程安排 / 日历
 * 都还没实现），不是地址打错。因此这一版不放营销文案、不放站内目录、不显示页脚，
 * 只说明「功能尚未完善 + 找谁」，并给出返回后台首页的入口。
 *
 * 说明：GitHub Pages 这类静态托管只在站点根目录查找 404.html，
 * 因此这里不依赖 (site) 路由组的布局，两版都自行组合自己的页头与页脚。
 */
export default function NotFound() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ROUTE_SCRIPT }} />
      <PublicNotFound />
      <BackofficeNotFound />
    </>
  );
}

/** 网站版：翻到不存在的页码。 */
function PublicNotFound() {
  const brand = getSiteBrand();
  const entries = [...MAIN_NAV, ...SECONDARY_NAV].filter((item) => item.href !== "/");

  return (
    <div className="nf-public flex min-h-dvh flex-col">
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

/**
 * 教务后台版：功能尚未实现。
 *
 * 刻意做成「工具页」的观感：等宽字、状态码、请求路径、警示色提示条，
 * 与 app/admin/layout.tsx 一致的顶栏（NexGenEdu 教务后台 + 返回网站），
 * 让后台同事一眼看出自己在后台，而不是误以为进了错误页面。
 */
function BackofficeNotFound() {
  return (
    <div className="nf-backoffice flex min-h-dvh flex-col bg-ink-50" hidden>
      <header className="border-b border-ink-200 bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-bold tracking-tight text-brand-800">
              NexGenEdu
            </span>
            <span className="text-sm text-ink-500">教务后台</span>
          </div>
          <Link
            href="/"
            className="text-sm text-ink-600 transition-colors hover:text-brand-700"
          >
            返回网站
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-start px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-xl">
          <p className="font-mono text-xs tracking-wider text-ink-400">
            404 · 教务后台
          </p>
          <h1 className="mt-3 text-xl font-medium text-ink-900">这个功能还没有</h1>

          {/* 后台的 404 多数是功能未实现，因此把「找谁」直接放在最显眼处 */}
          <p className="mt-5 rounded-md border border-warning-100 bg-warning-50 px-3.5 py-3 text-sm leading-relaxed text-warning-600">
            该功能尚未完善，请联系管理员陈林维祎
          </p>

          <dl className="mt-6 space-y-2 font-mono text-xs">
            <div className="flex gap-3">
              <dt className="shrink-0 text-ink-400">请求路径</dt>
              <dd className="min-w-0 truncate text-ink-700" data-nf-path>
                —
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="shrink-0 text-ink-400">状态</dt>
              <dd className="text-ink-700">未实现 / 未开放</dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/admin" size="sm">
              返回后台首页
            </ButtonLink>
            <ButtonLink href="/" size="sm" variant="outline">
              返回网站
            </ButtonLink>
          </div>

          <p className="mt-8 border-t border-ink-200 pt-4 text-xs leading-relaxed text-ink-400">
            后台的学生 / 教师 / 教室 / 课程安排 / 日历仍在开发中。
          </p>
        </div>
      </main>
    </div>
  );
}
