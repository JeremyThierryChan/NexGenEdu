import { clearToken, readToken } from "@/lib/auth/token";
import { backendBase } from "@/lib/backend/connection";

/**
 * 远端代理：把本地 `api` 的每一个方法换成对后端的 `POST /api/call`。
 *
 * ## 为什么是「代理」而不是「重写一遍 fetch 版」
 *
 * 页面只认 `api` 这个对象的方法（106 个）。如果按方法手写 fetch 版本，等于把接口
 * 描述第二遍 —— 少写一个方法、参数传错一个字段，都是**静默**出错（上一轮把报课字段
 * 猜成 `totalLessons`，写进去就是 null）。所以这里**遍历本地实现的结构**生成远端版本：
 * 方法名、参数个数、返回类型全部与本地一致，页面与类型都不用改。
 *
 * ## 什么时候用远端
 *
 * 由 `NEXT_PUBLIC_API_BASE` 决定（见 docs/后端开发方案.md §5.4）：
 *   - 本机用（`.env.local` 里设置）→ 走 `/api/call`，数据进 SQLite —— 真正的使用环境；
 *   - 线上/未设置 → 保持本地实现（线上站点不该因为后台切换而打不开）。
 *
 * ## 认证（第 6 步）
 *
 * 每个请求都带上 `Authorization: Bearer <令牌>`。令牌从 `lib/auth/token.ts` 取 ——
 * 也就是**口令从不经过这一层**，这一层只搬令牌。未登录/过期时服务端回 401，
 * 这里把它翻译成一句人话，并**立刻清掉本地令牌**，好让界面下次检查时把人送回登录页。
 */

/**
 * 当前生效的后端地址（"" = 没有可用后端）。
 *
 * 判定逻辑集中在 `lib/backend/connection.ts`（优先级：**界面手动指定的地址** →
 * 构建期环境变量 → 没有）。早先这里直接读环境变量，于是有两件事说不通：
 * 界面上改不了地址；而后端没跑时界面照样宣称"已连接后端"。现在地址与连接状态
 * 都只有一个真源。
 */
export function remoteBase(): string {
  return backendBase();
}

/** 当前是否配置了后端（页面用它决定走远端还是本地实现）。 */
export function isRemoteMode(): boolean {
  return remoteBase() !== "";
}

/**
 * 参数序列化：`Date` 必须**显式标记**。
 *
 * JSON.stringify 会把 Date 变成字符串，服务端收到后调 `getFullYear()` 就炸 ——
 * 实测就是这样：`finance(new Date())` 报 `anchor.getFullYear is not a function`。
 * 但也不能"看到像日期的字符串就转回 Date"：很多方法的参数本来就是字符串日期
 * （`startedAt`、`startsAt`），乱转一样会出错。所以用标记显式区分。
 */
function encodeArg(value: unknown): unknown {
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeArg);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encodeArg(item);
    return out;
  }
  return value;
}

/**
 * 取本次请求要用的令牌。
 *
 * 浏览器里就是 `localStorage` 里那份；**Node 脚本**（自检 / 演练 / 逐页验收）没有登录
 * 界面，因此额外允许两种来源，省得每个脚本自己写一遍登录：
 *   - `NEXGENEDU_API_TOKEN`：直接给令牌（最省事）；
 *   - `NEXGENEDU_ADMIN_USER` + `NEXGENEDU_ADMIN_PASSWORD`：脚本自己登一次并缓存。
 *
 * 这两条只在 Node 里生效（浏览器的 `process.env` 里没有这些值，
 * 何况只认 `NEXT_PUBLIC_` 前缀的才会被打进前端包），所以不会让线上站点变成"免登录"。
 */
let scriptToken: string | null = null;

async function resolveToken(base: string): Promise<string | null> {
  const direct = process.env.NEXGENEDU_API_TOKEN;
  if (typeof direct === "string" && direct !== "") return direct;

  const stored = readToken();
  if (stored !== null) return stored;

  const password = process.env.NEXGENEDU_ADMIN_PASSWORD;
  if (typeof password !== "string" || password === "") return null;
  if (scriptToken !== null) return scriptToken;

  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.NEXGENEDU_ADMIN_USER ?? "admin",
      password,
    }),
  });
  const payload = (await response.json()) as { ok?: boolean; token?: string; error?: string };
  if (payload.ok !== true || typeof payload.token !== "string") {
    throw new Error(`脚本登录失败：${payload.error ?? `HTTP ${response.status}`}`);
  }
  scriptToken = payload.token;
  return scriptToken;
}

/** 一次 RPC 调用：失败时抛出带服务端原文的错误（不要吞成"未知错误"）。 */
async function callRemote(base: string, method: string, args: unknown[]): Promise<unknown> {
  const token = await resolveToken(base);
  const response = await fetch(`${base}/api/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ method, args: encodeArg(args) }),
  });

  if (response.status === 401) {
    /*
     * 登录失效：清掉本地令牌，让人回到登录页。
     *
     * 刻意**不**在代理层做跳转（代理不该知道路由）：清掉令牌之后，
     * `RequireAuth` 下一次检查就会把人送过去。只清不跳，也避免
     * "在后台某页报错却被踢到登录页、还不知道为什么"。
     */
    clearToken();
    throw new Error("登录已过期，请重新登录。");
  }

  let payload: { ok?: boolean; result?: unknown; error?: string };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error(`后端返回的不是 JSON（HTTP ${response.status}）：${base} 在跑吗？`);
  }
  if (payload.ok !== true) throw new Error(payload.error ?? `调用 ${method} 失败`);
  return payload.result;
}

/**
 * 按本地实现的结构生成远端版本。
 *
 * 只遍历「函数」与「对象」两类成员：方法映射成 RPC，分组递归下去。
 * 这样后端加了新方法、本地实现了新方法，代理都会自动跟上 —— 不需要维护第二份方法清单。
 */
export function createRemoteApi<T extends object>(local: T, base: string): T {
  const build = (target: object, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (typeof value === "function") {
        out[key] = (...args: unknown[]) => callRemote(base, path, args);
      } else if (typeof value === "object" && value !== null) {
        out[key] = build(value, path);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  return build(local, "") as T;
}
