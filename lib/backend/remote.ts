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
 *   - 线上/未设置 → 保持本地 localStorage 行为（线上是给家长看的静态站，
 *     不该因为后台切换而打不开；那条横幅负责说明差别）。
 */

/** 走远端的判定：环境变量存在且非空。 */
export function remoteBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  return typeof base === "string" ? base.trim().replace(/\/+$/, "") : "";
}

/** 当前是否使用远端后端（页面用它决定是否显示"本机服务"提示）。 */
export function isRemoteMode(): boolean {
  return remoteBase() !== "";
}

/** 一次 RPC 调用：失败时抛出带服务端原文的错误（不要吞成"未知错误"）。 */
async function callRemote(base: string, method: string, args: unknown[]): Promise<unknown> {
  const response = await fetch(`${base}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args }),
  });

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
