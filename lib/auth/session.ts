"use client";

import { isRemoteMode } from "@/lib/backend/remote";
import { backendBase } from "@/lib/backend/connection";
import { clearToken, readToken, writeToken } from "@/lib/auth/token";
import { ROLES, type Role } from "@/lib/auth/roles";

/**
 * 登录与会话（第 6 步：改成**服务端**会话）。
 *
 * ## 为什么必须改
 *
 * 早期这个文件里硬编码着 `admin` / 一个固定口令，而仓库是公开的 —— 任何能看到源码
 * 的人都知道口令，它只能挡住"误点进来的访客"。当时还说得过去（后台数据本来就在
 * 访问者自己的浏览器里）；现在数据在**服务端的真实数据库**里（钱、课时、家长联系方式），
 * 再用一个公开的口令守着，性质完全不同了。
 *
 * 现在：口令与校验都在服务端（`server/auth.mts`），前端只拿**令牌**。
 * 这一层做三件事：调 `/api/login`、存/删令牌、向服务端问"我是谁"。
 *
 * ## 为什么 `getSession()` 变成异步
 *
 * 因为"已登录"这件事现在**只有服务端说了算**：本地存着令牌不等于令牌还有效
 * （服务端重启、闲置过期都会失效）。同步返回一个本地状态会让界面先亮一下再报错，
 * 那种"看着进去了、点什么都失败"的体验比多等一次请求差得多。
 *
 * ## 没有后端时（线上静态站）
 *
 * `NEXT_PUBLIC_API_BASE` 没设置时**登录直接不可用**，并明确说明原因 —— 不退回
 * "口令写在前端的假登录"。线上那份后台连不上后端、数据也无处可存，
 * 让它能登进去只会制造"我在这儿录的数据去哪了"的困惑。
 * 线上站点本身（给家长看的宣传页）完全不受影响。
 */

export type Session = {
  username: string;
  /**
   * 这个账号的角色（可能多个：一个账号可兼任多个角色）。
   *
   * 用途只有一个：**决定界面显示哪些入口**（导航、以及"这一页你看不到"的提示）。
   * 它**不是**权限本身 —— 权限由服务端按会话判定（见 `server/index.mts` 的闸门）。
   * 前端藏起来只是体验：直接调接口一样会被服务端拒。
   */
  roles: Role[];
  /**
   * 行级范围不正常的提示（Phase B；空串 = 一切正常）。
   *
   * 服务端在登录响应与 `/api/session` 里都回它，内容是"这个账号的范围为什么是空的、
   * 该去哪里补"（普通教师账号没填 / 填错了 `teacherId` 时会出现）。
   * 界面把它显示在后台顶部 —— 否则那位老师看到的是一个**空后台**，
   * 而"账号少填了一个字段"这件事没有任何地方会告诉他。
   */
  scopeWarning: string;
  /** 登录时间（ISO）。服务端目前只回账号，因此这里是空串。 */
  loginAt: string;
};

/**
 * 当前环境为什么不能登录；`null` 表示可以登录（已经连上后端）。
 * 登录页用它给出**明确的下一步**，而不是让人反复试口令。
 */
export function loginUnavailableReason(): string | null {
  if (isRemoteMode()) return null;
  return (
    "这是线上静态站点：没有后端可连，后台无法登录。" +
    "正式使用请在本机运行 npm run server（后端）与 npm run dev（前端），" +
    "再用启动后端时打印的账号口令登录。"
  );
}

/**
 * 会话检查的结果。
 *
 * **为什么要区分原因**：以前这里失败一律返回 `null`，界面就只能把"未登录"一个结论
 * 呈现出来 —— 于是"后端没开""浏览器把请求拦了（CORS 预检）""令牌过期"三种完全不同的
 * 情况，表现都是**无声地弹回登录页**。用户看到的是"密码明明对，怎么都进不去"，
 * 而没有一条线索能指向真正的原因（这一轮就为此绕了很久）。
 * 现在把原因带出来，界面才能说人话。
 */
export type SessionCheck = {
  session: Session | null;
  reason: "ok" | "no-backend" | "no-token" | "expired" | "unreachable";
  /** 排错用的细节（只在控制台与"连不上"提示里显示，不含敏感信息）。 */
  detail?: string;
};

/**
 * 向服务端确认会话（唯一可信来源）。
 *
 * `expired` 会顺手清掉本地令牌；`unreachable` **不清** —— 那多半是后端没开或请求被拦，
 * 把令牌留着，等后端恢复就不用重新登录。
 */
export async function checkSession(): Promise<SessionCheck> {
  const base = backendBase();
  if (base === "") return { session: null, reason: "no-backend" };

  const token = readToken();
  if (token === null) return { session: null, reason: "no-token" };

  let response: Response;
  try {
    response = await fetch(`${base}/api/session`, {
      headers: { authorization: `Bearer ${token}` },
      /*
       * **必须有超时**：没有它的话，请求卡住（后端没响应、被拦截、连接排队）
       * 会让界面永远停在"正在检查登录状态…"—— 用户看不到任何原因、也等不到结果。
       * 这一条是踩出来的：另一种"无声失败"。
       */
      signal: AbortSignal.timeout(8000),
    });
  } catch (cause) {
    // fetch 抛错 = 根本没拿到响应：后端没开、地址不对，或**请求被浏览器拦掉**（CORS）
    const detail = `${base}/api/session 请求失败：${cause instanceof Error ? cause.message : String(cause)}`;
    console.warn(
      `[登录] ${detail}\n` +
      "  常见原因：① npm run server 没在跑；② 该请求带的 Authorization 头没被服务端放行" +
      "（预检响应里的 access-control-allow-headers 必须包含 authorization）；" +
      "③ 浏览器把旧的预检结果缓存住了（重启浏览器即可清掉，服务端现在只缓存 60 秒）。",
    );
    return { session: null, reason: "unreachable", detail };
  }

  if (response.status === 401) {
    // 服务端重启或闲置过期都会走到这里：清掉令牌，别留一个"看起来还在"的状态
    clearToken();
    return { session: null, reason: "expired", detail: "服务端说该令牌无效或已过期。" };
  }
  if (!response.ok) {
    return { session: null, reason: "unreachable", detail: `HTTP ${response.status}（${base}/api/session）` };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    username?: string;
    roles?: unknown;
    scopeWarning?: unknown;
  };
  if (payload.ok !== true || typeof payload.username !== "string") {
    return { session: null, reason: "unreachable", detail: "服务端返回的会话格式不认识。" };
  }
  return {
    session: {
      username: payload.username,
      roles: readRoles(payload.roles),
      /*
       * 范围提示只认**字符串**：老服务端（还没有行级范围）不回这个字段，
       * 那时按"没有提示"处理 —— 与 readRoles 的兜底方向一致
       * （升级服务端忘了升级前端时，表现应该是"和以前一样"，而不是弹出假警报）。
       */
      scopeWarning: typeof payload.scopeWarning === "string" ? payload.scopeWarning : "",
      loginAt: "",
    },
    reason: "ok",
  };
}

/**
 * 把服务端返回的角色转成可信的列表。
 *
 * 只认 `ROLES` 里有的名字：服务端将来加了新角色而前端还没更新时，
 * 未知角色被忽略（界面少一个入口），而不是当成"什么都能做"。
 * **认不出来时按"全角色"处理**：老服务端（还没有角色这个概念）返回空，
 * 此时不该把管理员的导航全藏掉 —— 那种"升级服务端忘了升级前端"的场景，
 * 表现应该是"和以前一样"，而不是"后台突然空了"。
 */
function readRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [...ROLES];
  const known = value.filter((item): item is Role => ROLES.includes(item as Role));
  return known.length > 0 ? known : [...ROLES];
}

/** 读取当前会话（只关心"有没有"时用它）。 */
export async function getSession(): Promise<Session | null> {
  return (await checkSession()).session;
}

export async function isLoggedIn(): Promise<boolean> {
  return (await getSession()) !== null;
}

/** 校验账号口令；成功后把服务端签发的令牌存下来。 */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = backendBase();
  const unavailable = loginUnavailableReason();
  if (unavailable !== null || base === "") {
    return { ok: false, error: unavailable ?? "没有配置后端地址。" };
  }

  if (username.trim() === "" || password === "") {
    return { ok: false, error: "请输入账号与密码。" };
  }

  let response: Response;
  try {
    response = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
      // 同上：登录也不能无限等（否则按钮永远停在"登录中…"）
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      ok: false,
      error: `连不上后端（${base}）：请确认 npm run server 正在运行，且后端地址与端口正确。`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    token?: string;
    error?: string;
  };
  if (!response.ok || payload.ok !== true || typeof payload.token !== "string") {
    return { ok: false, error: payload.error ?? "登录失败，请重试。" };
  }

  writeToken(payload.token);
  return { ok: true };
}

/** 退出登录：先让服务端作废令牌，再清本地。 */
export async function logout(): Promise<void> {
  const base = backendBase();
  const token = readToken();
  clearToken();
  if (base === "" || token === null) return;
  try {
    await fetch(`${base}/api/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    // 后端没开也无所谓：本地令牌已经清了，服务端那份会自己过期
  }
}
