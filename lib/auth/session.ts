"use client";

import { createKeyValueStore, type KeyValueStore } from "@/lib/backend/storage";

/**
 * 假的登录（纯前端）。
 *
 * ============================ 重要：这不是安全机制 ============================
 * 静态站点没有服务端，账号密码必须写在客户端代码里 —— 也就是说，任何打开
 * 开发者工具、或直接读这个仓库源码的人都能看到口令。它**只能**阻止「误点进来
 * 的访客」，不能保护任何数据：后台数据本来也不在服务端，而在访问者自己的浏览器里。
 *
 * 仓库是公开的，因此这里刻意把口令集中在一处并写明现状：等前后端分离之后，
 * 登录必须改为服务端校验（口令存服务端、签发 token、接口鉴权），
 * 届时只需替换本文件的实现 —— 页面调用方式（login / logout / getSession）不变。
 * ==========================================================================
 */

const USERNAME = "admin";
const PASSWORD = "689992";

const SESSION_KEY = "nexgenedu.admin.session.v1";

export type Session = {
  username: string;
  /** 登录时间（ISO）。 */
  loginAt: string;
};

let store: KeyValueStore = createKeyValueStore();
let cache: Session | null | undefined;

/** 读取当前会话（null 表示未登录）。 */
export function getSession(): Session | null {
  if (cache !== undefined) return cache;

  const raw = store.read(SESSION_KEY);
  if (raw === null) {
    cache = null;
    return cache;
  }

  try {
    const parsed = JSON.parse(raw) as Session;
    cache = typeof parsed.username === "string" ? parsed : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function isLoggedIn(): boolean {
  return getSession() !== null;
}

/** 校验账号密码；成功后写入会话。 */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 与伪后端保持一致的轻微延迟，让提交态可见
  await new Promise((resolve) => setTimeout(resolve, 160));

  if (username.trim() === "" || password === "") {
    return { ok: false, error: "请输入账号与密码。" };
  }
  if (username.trim() !== USERNAME || password !== PASSWORD) {
    return { ok: false, error: "账号或密码不正确。" };
  }

  const session: Session = { username: USERNAME, loginAt: new Date().toISOString() };
  store.write(SESSION_KEY, JSON.stringify(session));
  cache = session;
  return { ok: true };
}

export function logout(): void {
  store.remove(SESSION_KEY);
  cache = null;
}

/** 仅供自检使用：把会话存储切到内存实现。 */
export function __useSessionStoreForTesting(backing: KeyValueStore): void {
  store = backing;
  cache = undefined;
}

/** 仅供自检使用：确认真实口令可用（不把口令硬编码在别处）。 */
export const __credentialsForTesting = { username: USERNAME, password: PASSWORD };
