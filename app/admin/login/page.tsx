import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/admin/LoginForm";

export const metadata: Metadata = {
  title: "登录",
  description: "教务后台登录。",
};

/**
 * 登录页（假登录）。
 *
 * 两件事必须在页面上说清楚，否则后来的人会误以为后台已经被保护起来：
 * 账号密码写在客户端代码里（见 lib/auth/session.ts），只能挡住误入的访客；
 * 后台数据也只存在访问者自己的浏览器中。等前后端分离后由服务端校验。
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

          <p className="mt-6 rounded-md border border-warning-100 bg-warning-50 px-3 py-2.5 text-xs leading-relaxed text-warning-600">
            当前是纯前端演示登录：口令写在页面代码里，只用于挡住误入的访客，
            <strong className="font-medium">不是安全机制</strong>；
            后台数据也只存在本浏览器中。
          </p>
        </div>
      </main>
    </div>
  );
}
