"use client";

import { isRemoteMode, remoteBase } from "@/lib/backend/remote";
import { clearToken, readToken, writeToken } from "@/lib/auth/token";

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

/** 读取当前会话：把令牌交给服务端验一次，验不过就当未登录。 */
export async function getSession(): Promise<Session | null> {
  const base = remoteBase();
  if (base === "") return null;

  const token = readToken();
  if (token === null) return null;

  try {
    const response = await fetch(`${base}/api/session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      // 服务端重启或闲置过期都会走到这里：清掉本地令牌，别留一个"看起来还在"的状态
      clearToken();
      return null;
    }
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; username?: string };
    if (payload.ok !== true || typeof payload.username !== "string") return null;
    return { username: payload.username, loginAt: "" };
  } catch {
    // 后端没开：当作未登录（界面会明确提示连不上，而不是假装登录着）
    return null;
  }
}

export async function isLoggedIn(): Promise<boolean> {
  return (await getSession()) !== null;
}

/** 校验账号口令；成功后把服务端签发的令牌存下来。 */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = remoteBase();
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
    });
  } catch {
    return { ok: false, error: `连不上后端（${base}）：请确认 npm run server 正在运行。` };
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
  const base = remoteBase();
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
