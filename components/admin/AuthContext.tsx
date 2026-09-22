"use client";

import { createContext, useContext } from "react";
import { ROLES, type Role } from "@/lib/auth/roles";

/**
 * 当前登录者是谁、有哪些角色（只在后台界面里用）。
 *
 * ## 为什么需要一个上下文
 *
 * 角色要同时给三个地方用：**侧边导航**（藏掉看不到的入口）、**页面守卫**
 * （直接敲网址进来时给一句人话）、**顶栏**（显示"已登录：某人 · 角色"）。
 * 三处各自去问一次 `/api/session` 就是三次请求，而且可能出现"导航已经按新角色画了、
 * 顶部还显示旧角色"这种自相矛盾的中间态。因此由 `RequireAuth` 问一次、放在这里。
 *
 * ## 它不是权限
 *
 * 权限由**服务端**按会话判定（`server/index.mts` 的闸门）。这里只决定"界面上显示什么"：
 * 把入口藏起来是为了不让人点了才碰壁，而不是为了拦住谁 —— 直接调接口一样会被服务端拒。
 */
export type AuthState = {
  username: string;
  roles: Role[];
  /**
   * 行级范围不正常的提示（空串 = 正常；Phase B）。
   *
   * 服务端在登录响应与 `/api/session` 里都给这一句：普通教师账号没填 / 填错了
   * `teacherId` 时，范围是空的（登录后什么都看不到）。界面必须把它显示出来 ——
   * 否则那位老师面对一个空后台，而原因（账号少填了一个字段）没有任何地方说得出。
   */
  scopeWarning: string;
};

export const AuthContext = createContext<AuthState | null>(null);

/** 读当前登录者与角色；`null` 表示还没拿到（或不在后台界面里）。 */
export function useAuth(): AuthState | null {
  return useContext(AuthContext);
}

/**
 * 读角色的兜底版本：拿不到上下文时按"全角色"处理。
 *
 * 为什么兜底是"全角色"而不是"无角色"：拿不到只可能是"界面还没问完服务端"或
 * "服务端版本比前端旧"。这两种情况下把导航藏掉，用户看到的是一个空后台，
 * 而真正的问题（没登录 / 服务端旧）反而不明显。权限由服务端把关，藏错方向的代价更大。
 */
export function rolesOrAll(state: AuthState | null): Role[] {
  if (state === null || state.roles.length === 0) return [...ROLES];
  return state.roles;
}
