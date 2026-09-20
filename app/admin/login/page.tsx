import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/admin/LoginForm";

export const metadata: Metadata = {
  title: "登录",
  description: "教务后台登录。",
};

/**
 * 登录页。
 *
 * 第 6 步之后这里**不再有"演示登录"的说明**：口令与校验都在服务端
 * （`server/auth.mts`），前端只拿令牌，所以页面上不必再说
 * "口令写在前端、不是安全机制" —— 那句话已经不成立了。
 * 现在要讲清楚的是**口令从哪来**：后端第一次启动时会生成并打印一次，
 * 也可以自己用 `NEXGENEDU_ADMIN_PASSWORD` 指定。
 *
 * 表单在 LoginForm 里；它刻意不用 useSearchParams，因此能直接静态预渲染
 * （否则会走 CSR bailout，登录框要等 JS 加载完才出现）。
 */
export default function AdminLoginPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
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

      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-medium text-ink-900">登录教务后台</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            登录后才能查看学生、排课与课时数据。
          </p>

          <div className="mt-7">
            <LoginForm />
          </div>

          <p className="mt-6 rounded-md border border-ink-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-ink-500">
            账号口令由<strong className="font-medium text-ink-700">本机后端</strong>持有：
            第一次启动后端（<span className="font-mono">npm run server</span>）时会生成并
            <strong className="font-medium text-ink-700">打印一次</strong>，
            存在 <span className="font-mono">server/data/admin-credential.json</span>；
            也可以自己指定 <span className="font-mono">NEXGENEDU_ADMIN_PASSWORD</span>。
            登录后令牌只在本浏览器保存，重启后端需要重新登录。
          </p>
        </div>
      </main>
    </div>
  );
}
