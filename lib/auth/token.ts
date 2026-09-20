"use client";

import { createKeyValueStore, type KeyValueStore } from "@/lib/backend/storage";

/**
 * 会话令牌的存放处（浏览器侧）。
 *
 * ## 为什么单独一个模块
 *
 * 令牌有**两个使用者**：登录/登出的 `lib/auth/session.ts`，以及每次请求都要带上它
 * 的 `lib/backend/remote.ts`。如果令牌存在 `session.ts` 里、`remote.ts` 再去 import 它，
 * 两个模块就互相依赖了（`session.ts` 为了判断"要不要走后端"本来就要 import `remote.ts`）。
 * 单独一层之后依赖是单向的：`session.ts` 与 `remote.ts` 都只依赖本模块。
 *
 * ## 存的是什么
 *
 * 存服务端签发的**令牌**，不是口令。口令从登录那一刻起就只存在于服务端
 * （见 `server/auth.mts`）—— 这是第 6 步要解决的核心问题：早期口令硬编码在
 * `session.ts` 里，而仓库是公开的，等于没有口令。
 *
 * 放 localStorage 而不是内存：页面之间跳转（Next.js 是客户端路由）与刷新都不该丢登录态。
 * 代价是同一个浏览器里其他脚本理论上能读到它 —— 对一个只在本机使用、
 * 且数据本来就在这台机器上的系统，这个取舍是划算的；真要多用户/公网时应当改用
 * HttpOnly Cookie（那时再加，见 docs/后端开发方案.md §7）。
 */

const TOKEN_KEY = "nexgenedu.admin.token.v1";

let store: KeyValueStore = createKeyValueStore();

/** 读取令牌（未登录返回 null）。 */
export function readToken(): string | null {
  const raw = store.read(TOKEN_KEY);
  return raw === null || raw === "" ? null : raw;
}

export function writeToken(token: string): void {
  store.write(TOKEN_KEY, token);
}

export function clearToken(): void {
  store.remove(TOKEN_KEY);
}

/** 仅供自检使用：把令牌存储切到内存实现。 */
export function __useTokenStoreForTesting(backing: KeyValueStore): void {
  store = backing;
}
