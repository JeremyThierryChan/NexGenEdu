"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, logout } from "@/lib/auth/session";

/**
 * 后台顶栏：品牌 + 当前账号 + 退出登录 + 重置示例数据。
 *
 * 「重置示例数据」是纯前端版本的必需功能：数据存在浏览器里，
 * 演示时改乱了需要一个一键恢复入口（将来接服务端后删掉即可）。
 */
export function AdminTopBar() {
  const router = useRouter();
  const [username, setUsername] = useState("");

  useEffect(() => {
    setUsername(getSession()?.username ?? "");
  }, []);

  function onLogout() {
    logout();
    router.replace("/admin/login");
  }

  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tracking-tight text-brand-800">
            NexGenEdu
          </span>
          <span className="text-sm text-ink-500">教务后台</span>
        </div>

        <div className="flex items-center gap-3">
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
