"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlobalSearch } from "@/components/admin/GlobalSearch";
import { BackendStatus } from "@/components/admin/BackendStatus";
import { getSession, logout } from "@/lib/auth/session";

/**
 * 后台顶栏：品牌 + 当前账号 + 退出登录。
 *
 * 「谁改的」不再由这里告诉服务端了（第 6 步）：操作人由服务端的**会话**决定，
 * 每次请求按令牌所属账号设置。早期是前端调 `api.setOperator(name)`，而它是同步方法、
 * 经远端代理会静默变成 Promise —— 操作日志里的操作人一直是默认值，且没人会发现。
 * 现在前端说什么都不作数，这也是"谁改的"应当由服务端说了算的一个例子。
 */
export function AdminTopBar() {
  const router = useRouter();
  const [username, setUsername] = useState("");

  useEffect(() => {
    void (async () => {
      setUsername((await getSession())?.username ?? "");
    })();
  }, []);

  function onLogout() {
    void logout().then(() => router.replace("/admin/login"));
  }

  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tight text-brand-800">
            NexGenEdu
          </span>
          <span className="text-sm text-ink-500 max-sm:hidden">教务后台</span>
        </div>

        <GlobalSearch />

        <div className="flex items-center gap-3">
          {/* 后端/数据库的真实连接状态：后端没跑、地址填错时，这里会直接变色并可手动改地址 */}
          <BackendStatus compact />
          {username !== "" && (
            <span className="text-sm text-ink-500 max-sm:hidden">
              已登录：{username}
            </span>
          )}
          <Link
            href="/"
            className="text-sm text-ink-600 transition-colors hover:text-brand-700"
          >
            返回网站
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-md border border-ink-300 px-2.5 py-1 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
          >
            退出登录
          </button>
        </div>
      </div>
    </header>
  );
}
