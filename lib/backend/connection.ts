"use client";

import { createKeyValueStore, type KeyValueStore } from "@/lib/backend/storage";

/**
 * 后端连接：**地址从哪来**与**到底连上没有**。
 *
 * ## 为什么需要这一层（两个真实的坑）
 *
 * 1. **"已连接后端"曾经是句假话**：界面只判断环境变量 `NEXT_PUBLIC_API_BASE` 有没有值，
 *    于是后端没在跑时它照样显示"已连接后端"。用户看到的是"连着"，实际每个请求都失败。
 *    现在状态来自**真实探活**：`GET /health`，并且要看到服务自报的名字。
 * 2. **地址原来是构建期定死的**：`NEXT_PUBLIC_API_BASE` 在打包时就写进产物了，界面改不了。
 *    而这轮真实发生的故障就是"地址不对"——前端在 3001、后端在 4000，用户却在另一个
 *    项目的页面上反复输口令。所以这里允许**运行时指定地址**，并支持**自动探测**。
 *
 * ## 优先级（只有一个真源，避免"哪个在生效"说不清）
 *
 *   1. 运行时覆盖（界面里手动填的，存 localStorage）
 *   2. 构建期环境变量 `NEXT_PUBLIC_API_BASE`
 *   3. 都没有 → 没有后端可用（线上静态站就是这种情况）
 *
 * ## 只认"自报家门"的服务
 *
 * 探活成功不够 —— 还要 `service === "nexgenedu-server"`。原因：端口上跑的可能**不是**
 * 这个后端（这一天真发生过：3000 上是另一个 Next 项目）。只看到"有个 HTTP 服务在"就
 * 认定"后端连上了"，会把人送回同一个坑里。不匹配就明确说"这个地址上不是本系统的后端"。
 *
 * ## 关于安全：允许填任意地址，但非本机会给出警告
 *
 * 登录时**口令会发到配置的那个地址**。所以：填本机（localhost / 127.0.0.1）没有任何提示；
 * 填别的机器会持续显示一条警告（那是把口令交给另一台机器，必须是你自己的）。
 * 不禁止是因为真有"局域网里另一台机器跑后端"的用法（`NEXGENEDU_HOST=0.0.0.0`），
 * 但必须让人知道自己做了什么。
 */

const OVERRIDE_KEY = "nexgenedu.backend.base.v1";

/** 探活超时：本机请求应当在毫秒级返回；超过这个时间就当连不上（不能无限等）。 */
const PROBE_TIMEOUT_MS = 4000;

/** 定期复查的间隔（以及窗口重新获得焦点时立刻复查一次）。 */
const POLL_INTERVAL_MS = 30_000;

/**
 * 自动探测的候选地址。
 *
 * 后端默认 4000；4001/4002 覆盖"又起了一个实例"或端口被占后换端口的情况。
 * 顺序固定，探测很便宜（本机请求），找到第一个"自报家门"的就停。
 */
export const CANDIDATE_BASES = [
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  "http://localhost:4001",
  "http://127.0.0.1:4001",
  "http://localhost:4002",
  "http://127.0.0.1:4002",
];

/** 服务自报的名字：只有它能证明"这是本系统的后端"。 */
export const SERVICE_NAME = "nexgenedu-server";

let store: KeyValueStore = createKeyValueStore();

/** 仅供自检使用：把地址覆盖的存储切到内存实现。 */
export function __useConnectionStoreForTesting(backing: KeyValueStore): void {
  store = backing;
  cachedOverride = undefined;
}

let cachedOverride: string | null | undefined;

function normalize(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

/** 构建期配置的地址（环境变量）。 */
export function envBackendBase(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  return typeof base === "string" ? normalize(base) : "";
}

/** 界面里手动指定的地址（没设过返回 null）。 */
export function overrideBackendBase(): string | null {
  if (cachedOverride === undefined) {
    const raw = store.read(OVERRIDE_KEY);
    cachedOverride = raw === null || raw === "" ? null : normalize(raw);
  }
  return cachedOverride;
}

/**
 * 当前生效的后端地址（"" = 没有可用后端）。
 *
 * **所有需要后端的地方都必须走这里**（远端代理、登录、探活），
 * 否则"界面里改了地址、但某个请求还发往旧地址"这种分歧迟早出现。
 */
export function backendBase(): string {
  return overrideBackendBase() ?? (envBackendBase() === "" ? "" : envBackendBase());
}

/** 设置/清除手动地址（传 null 表示回到自动/环境变量）。 */
export function setBackendOverride(base: string | null): void {
  if (base === null || base.trim() === "") {
    store.remove(OVERRIDE_KEY);
    cachedOverride = null;
  } else {
    const normalized = normalize(base);
    store.write(OVERRIDE_KEY, normalized);
    cachedOverride = normalized;
  }
  notify();
}

/** 地址是否指向本机（非本机时界面要给警告：口令会发到那台机器）。 */
export function isLocalBase(base: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(base.trim());
}

/** 地址看起来是否像个 HTTP 地址（用于表单校验，不做过度限制）。 */
export function looksLikeBase(value: string): boolean {
  return /^https?:\/\/[^\s/]+(:\d+)?$/i.test(value.trim());
}

export type ProbeResult =
  | { ok: true; base: string; service: string; db: string }
  | { ok: false; base: string; reason: string };

/**
 * 探一个地址：它是不是本系统的后端。
 *
 * 只信 `/health` 里自报的 `service`；不是本系统（或压根不是 JSON）都算不匹配 ——
 * 这样"端口上跑着别的程序"不会被误判成"后端连上了"。
 */
export async function probeBackend(base: string): Promise<ProbeResult> {
  const target = normalize(base);
  if (target === "") return { ok: false, base: target, reason: "地址为空。" };

  let response: Response;
  try {
    response = await fetch(`${target}/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const timedOut = /abort|timeout/i.test(message);
    return {
      ok: false,
      base: target,
      reason: timedOut
        ? `${PROBE_TIMEOUT_MS / 1000} 秒内没有响应（后端没在跑，或地址/端口不对）。`
        : `请求失败：${message}`,
    };
  }

  if (!response.ok) {
    return { ok: false, base: target, reason: `该地址有响应，但返回 HTTP ${response.status}。` };
  }

  let payload: { ok?: boolean; service?: string; db?: string };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return {
      ok: false,
      base: target,
      reason: "该地址有响应，但返回的不是本系统的接口（可能端口上跑着别的程序）。",
    };
  }

  if (payload.service !== SERVICE_NAME) {
    return {
      ok: false,
      base: target,
      reason: `该地址上是别的服务（自报为 ${payload.service ?? "未知名"}），不是本系统的后端。`,
    };
  }
  return { ok: true, base: target, service: payload.service, db: String(payload.db ?? "") };
}

/**
 * 依次探测候选地址，返回第一个确认是本系统后端的地址（没有则 null）。
 *
 * 候选可传参：自检要用它验证"遇到别的服务会跳过"这条性质（探固定端口没法稳定复现）。
 */
export async function autoDetectBackend(
  candidates: string[] = CANDIDATE_BASES,
): Promise<ProbeResult | null> {
  for (const candidate of candidates) {
    const result = await probeBackend(candidate);
    if (result.ok) return result;
  }
  return null;
}

// ── 连接状态（真实探活的结果，界面就显示它）────────────────────────────────

export type DatabaseHealth = {
  schemaVersion: number;
  /** 各表条数（登录后从 /api/status 拿到）。 */
  counts: Record<string, number>;
  /** 最近一份备份的文件名与时间。 */
  latestBackup: string | null;
  latestBackupAt: string | null;
};

export type ConnectionState =
  /** 还没检查过。 */
  | { status: "idle" }
  | { status: "checking" }
  /**
   * 后端在、但这台浏览器没能拿到数据库细节 → 只能确认"服务活着"。
   *
   * `dbReason` 把"为什么"分开说 —— 原先三种原因都显示成"未登录，数据库细节看不到"，
   * 而**"会话已失效"（后端重启过）**那种最容易被误解：界面右上角还写着"已登录：admin"，
   * 状态那行却说你没登录，两边自相矛盾，人只会觉得系统坏了。
   * 真事：机构在重启后端之后看到这句话来问"为什么说我未登录"。
   */
  | {
      status: "ready";
      base: string;
      service: string;
      db: string;
      database: null;
      dbReason: "no-token" | "expired" | "unreachable";
    }
  /** 后端在且已登录 → 连数据库状态也能报。 */
  | { status: "ok"; base: string; service: string; db: string; database: DatabaseHealth }
  /** 连不上（含"那个地址上不是本系统的后端"）。 */
  | { status: "down"; base: string; reason: string; detected: string | null };

let state: ConnectionState = { status: "idle" };
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 登录后能拿到数据库细节时的补充查询。
 *
 * `/api/status` 需要令牌；把它放在这里而不是散在组件里，是为了让"数据库是否正常"
 * 只有一个判定处。拿不到就退化成 `ready`（后端在、细节未知），**不猜**。
 */
type DatabaseProbe =
  | { ok: true; health: DatabaseHealth }
  /** 没令牌 = 还没登录（正常状态，不是故障）。 */
  | { ok: false; reason: "no-token" }
  /** 令牌被服务端拒了 = **会话已失效**（后端重启过、或闲置过期）→ 需要重新登录。 */
  | { ok: false; reason: "expired" }
  /** 请求发不出去 / 超时 / 服务端 5xx → 说"拿不到"，不猜原因。 */
  | { ok: false; reason: "unreachable" };

async function fetchDatabaseHealth(base: string, token: string | null): Promise<DatabaseProbe> {
  if (token === null) return { ok: false, reason: "no-token" };
  try {
    const response = await fetch(`${base}/api/status`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    // 401 = 服务端不认这个令牌：会话失效（最常见的原因是后端重启过）
    if (response.status === 401) return { ok: false, reason: "expired" };
    if (!response.ok) return { ok: false, reason: "unreachable" };
    const payload = (await response.json()) as {
      schemaVersion?: number;
      counts?: Record<string, number>;
      backup?: { latest?: string | null; latestAt?: string | null };
    };
    return {
      ok: true,
      health: {
        schemaVersion: Number(payload.schemaVersion ?? 0),
        counts: payload.counts ?? {},
        latestBackup: payload.backup?.latest ?? null,
        latestBackupAt: payload.backup?.latestAt ?? null,
      },
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * 重新检查连接（界面按钮、定时器、窗口聚焦都会调它）。
 *
 * `autoDetect: true` 时，若当前地址连不上，会依次探测候选地址；
 * 探到就**记住它**（覆盖值），并把结果写进状态 —— 这就是"自动连接"。
 *
 * ## 为什么**已经有结论时不再退回 `checking`**
 *
 * 这一条是为了界面稳定（真实反馈推导出来的）：`checking` 的说法是"正在检查后端连接状态…"
 * 一行短字，而 `ok` / `ready` 是两三行的说明。以前每次复查（**30 秒一次**的定时器、
 * 窗口聚焦、手动点「重新检查」）都先切 `checking` 再切回来，于是页面顶部那块横幅
 * **每 30 秒就换一次说法、变一次高度** —— 而它就在滚动位置上方：页高一变，浏览器就可能
 * 把滚动位置夹一下（§15.3 里那条"页高变化 → 看起来跳到顶部"的机制）。
 *
 * 所以：只有**第一次**探活（还没有任何结论、也就是 `idle`）才显示"检查中…"；
 * 已经有结论时，屏幕上继续挂上一个真实结论（哪怕它马上就过期），复查完成后直接换成新结论。
 * 这也更诚实：右上角那个状态信号不该每半分钟改口说一次"检查中…"，它应该只在**真的变了**
 * 的时候改口。
 */
export async function refreshConnection(
  options: { autoDetect?: boolean; token?: string | null } = {},
): Promise<ConnectionState> {
  if (state.status === "idle") {
    state = { status: "checking" };
    notify();
  }
  const base = backendBase();
  if (base === "") {
    // 没有配置地址：先试着自动找一台（本机常见端口）
    const found = options.autoDetect === false ? null : await autoDetectBackend();
    if (found === null || !found.ok) {
      state = {
        status: "down",
        base: "",
        reason: "还没有配置后端地址（也没能在本机的常见端口上找到后端）。",
        detected: null,
      };
      notify();
      return state;
    }
    setBackendOverride(found.base);
    return refreshConnection({ autoDetect: false, token: options.token });
  }

  const probed = await probeBackend(base);
  if (probed.ok) {
    const database = await fetchDatabaseHealth(probed.base, options.token ?? null);
    state = database.ok
      ? { status: "ok", base: probed.base, service: probed.service, db: probed.db, database: database.health }
      : {
          status: "ready",
          base: probed.base,
          service: probed.service,
          db: probed.db,
          database: null,
          dbReason: database.reason,
        };
    notify();
    return state;
  }

  // 连不上：允许自动探测一次（并把探测到的地址记住）
  if (options.autoDetect !== false) {
    const found = await autoDetectBackend();
    if (found !== null && found.ok) {
      setBackendOverride(found.base);
      return refreshConnection({ autoDetect: false, token: options.token });
    }
  }

  state = { status: "down", base: probed.base, reason: probed.reason, detected: null };
  notify();
  return state;
}

/** 供界面显示的一句话结论。 */
export function connectionSummary(value: ConnectionState): string {
  switch (value.status) {
    case "idle":
      return "后端：未检查";
    case "checking":
      return "后端：检查中…";
    case "ready":
      /*
       * 三种原因分开说。原先一律写"未登录" —— 而"会话已失效"那种最误导：
       * 界面右上角还写着"已登录：admin"，这里却说没登录，人会以为系统坏了
       * （机构真问过这句话）。现在直接把该做的事说出来。
       */
      if (value.dbReason === "expired") return "后端：已连接 · 登录已失效，请重新登录";
      if (value.dbReason === "unreachable") return "后端：已连接（数据库细节暂时读不到）";
      return "后端：已连接（未登录，数据库细节看不到）";
    case "ok":
      return `后端：已连接 · 数据库 v${value.database.schemaVersion}`;
    case "down":
      return "后端：连不上";
  }
}

// ── 定时复查（只挂一次，由界面组件在挂载时启动）────────────────────────────

let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let onFocus: (() => void) | null = null;

/**
 * 开始定时复查（返回停止函数）。
 *
 * 用引用计数：多个组件同时挂着也只跑一个定时器；全部卸载后自动停。
 * 顺带在窗口重新获得焦点时立刻查一次 —— 用户切回页面时最想看到的就是"现在通不通"。
 */
export function startConnectionWatch(getToken: () => string | null): () => void {
  watchers += 1;
  if (watchers === 1) {
    timer = setInterval(() => void refreshConnection({ token: getToken() }), POLL_INTERVAL_MS);
    if (typeof window !== "undefined") {
      onFocus = () => void refreshConnection({ token: getToken() });
      window.addEventListener("focus", onFocus);
    }
  }
  return () => {
    watchers -= 1;
    if (watchers === 0) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      if (onFocus !== null && typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
      onFocus = null;
    }
  };
}
