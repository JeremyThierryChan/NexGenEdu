"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { getSession, login, loginUnavailableReason } from "@/lib/auth/session";
import { cn } from "@/lib/utils/cn";

/**
 * 登录表单。
 *
 * 刻意**不用 `useSearchParams()`**：在静态导出里它会触发 CSR bailout，
 * 表单会被排除在预渲染的 HTML 之外（用户要等 JS 加载完才看得到输入框）。
 * 这里改为挂载后自己读一次 `?next=`，页面因此能直接静态渲染出来。
 */
export function LoginForm() {
  const router = useRouter();
  const [next, setNext] = useState("/admin");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /*
   * 没有后端时（线上静态站）**先说清楚**，而不是让人对着输入框一遍遍试口令 ——
   * 那种体验会让人以为"密码不对"，而实际原因是这里根本没有后端可登录。
   */
  const unavailable = loginUnavailableReason();

  // 挂载后读取来源路径，并处理「已登录则直接进后台」
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("next");
    if (target !== null && target.startsWith("/admin")) setNext(target);

    void (async () => {
      if ((await getSession()) !== null) router.replace(target ?? "/admin");
    })();
  }, [router]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const result = await login(username, password);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace(next);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="text-sm text-ink-700">账号</span>
        <input
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoFocus
          className={INPUT_CLASS}
        />
      </label>

      <label className="block">
        <span className="text-sm text-ink-700">密码</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className={INPUT_CLASS}
        />
      </label>

      {unavailable !== null && (
        <p className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          {unavailable}
        </p>
      )}

      {error !== "" && (
        <p
          role="alert"
          className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {error}
        </p>
      )}

      <Button type="submit" disabled={pending || unavailable !== null} className="w-full">
        {pending ? "登录中…" : "登录"}
      </Button>
    </form>
  );
}

const INPUT_CLASS = cn(
  "mt-1.5 block w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900",
  "outline-none transition-colors placeholder:text-ink-400",
  "focus:border-brand-500 focus:ring-2 focus:ring-brand-100",
);
