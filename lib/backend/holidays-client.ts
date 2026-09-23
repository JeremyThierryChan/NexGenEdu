"use client";

import { backendBase } from "@/lib/backend/connection";
import { readToken } from "@/lib/auth/token";
import type { HolidayCoverage, HolidayYear } from "@/lib/backend/holidays";

/**
 * 后台「节假日」页的前端客户端（服务端两条路由的客户端）。
 *
 * ## 为什么单独一个文件、而不是 `lib/backend/api.ts` 的方法
 *
 * 与 `lib/auth/accounts.ts` 同一个理由：节假日表是**服务端机器上的文件**
 * （`data/holidays/<年>.json`），抓取还要走外网；而 `api` 在浏览器里也会跑
 * （没配 `NEXT_PUBLIC_API_BASE` 时它直接用 localStorage 那份实现）。在那里放一个
 * `api.holidays.refresh()`，要么在浏览器里必然失败，要么被实现成一个假的成功 ——
 * 更糟的是它会进入 `API_CONTRACT`，于是契约里出现一个"只有服务端才有意义"的方法。
 *
 * 所以走服务端自己的两条路由（见 `server/index.mts` 的 `handleHolidaysRoute`）：
 *
 *   - `GET  /api/holidays`          —— 读表（登录即可）；
 *   - `POST /api/holidays/refresh`  —— 抓取（技术管理员）。
 *
 * ## 这一页不做权限判断
 *
 * "能不能抓取"由服务端判（`holidaysRefreshDenial`）；这里只是"把按钮禁掉、
 * 把 403 的话原样显示出来"。前端拦得住手滑，拦不住直接调接口 —— 与全站纪律一致。
 */

/**
 * 一个来源的展示信息（界面上要写清「数据是从哪儿来的」）。
 *
 * `mirrorCount` = 除主地址外还有几个备用地址。为什么要显示它：国务院那个源挂在 GitHub 上，
 * `raw.githubusercontent.com` 实测很不稳（同一台机器 6 次里 4 次超时），因此配了镜像链 ——
 * 把这件事说出来，抓不到时才不会让人以为是"数据源没了"。
 */
export type HolidaySourceInfo = { id: string; label: string; url: string; mirrorCount: number };

/** 整张表（GET 与抓取之后回来的都是这一份）。 */
export type HolidayTableView = {
  /** 数据目录（给人看的：也能直接去改文件）。 */
  dir: string;
  /** 有数据的年份（升序）。 */
  years: HolidayYear[];
  /** 坏掉的文件（有值时界面必须显示 —— "静默少一年"正是这个功能最不能出的错）。 */
  errors: string[];
  coverage: HolidayCoverage;
  sources: HolidaySourceInfo[];
};

/** 一次抓取里某一年结局（与服务端 `HolidayRefreshView` 对应）。 */
export type HolidayRefreshResult = {
  year: number;
  status: "written" | "checked" | "not-published" | "rejected";
  file: string;
  dayCount: number;
  error: string;
  verdict: { agree: boolean; blocking: string[]; notes: string[]; notPublished: boolean } | null;
  sources: { id: string; label: string; url: string; ok: boolean; days: number; fingerprint: string; note: string }[];
};

export type HolidayTableOutcome = { ok: true; table: HolidayTableView } | { ok: false; error: string };
export type HolidayRefreshOutcome =
  | { ok: true; results: HolidayRefreshResult[]; table: HolidayTableView }
  | { ok: false; error: string };

/** 服务端回来的原始 JSON（只声明我们真的会用到的字段）。 */
type RawResponse = {
  ok?: boolean;
  error?: string;
  view?: unknown;
  results?: unknown;
};

type RequestOutcome = { ok: true; payload: RawResponse } | { ok: false; error: string };

/** 请求超时：读表很快，但**抓取要走外网**（两个来源、每个还有镜像），因此给得宽一些。 */
const READ_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 90_000;

/**
 * 发一次请求。
 *
 * 把"没有后端 / 没登录 / 后端拒绝 / 连不上"四种情况分开说法（照抄 `session.ts` 与
 * `accounts.ts` 的教训）：一律回"操作失败"的话，人就只能靠猜 ——
 * 而"后端没开"和"你没有权限"要做的事完全不同。
 */
async function request(
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<RequestOutcome> {
  const base = backendBase();
  if (base === "") {
    return {
      ok: false,
      error:
        "当前没有配置后端地址：节假日表只存在于服务端，请先启动后端（npm run server）并在顶栏确认已连接。",
    };
  }
  const token = readToken();
  const path = method === "GET" ? "/api/holidays" : "/api/holidays/refresh";

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(method === "GET" ? READ_TIMEOUT_MS : REFRESH_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      error: `连不上后端（${base}）：${cause instanceof Error ? cause.message : String(cause)}。请确认后端在跑。`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as RawResponse;

  if (response.status === 401) return { ok: false, error: "登录已过期，请重新登录后再试。" };
  if (!response.ok || payload.ok !== true) {
    // 403 的话**原样显示服务端那句**（它写清了"需要什么角色"）
    return { ok: false, error: payload.error ?? `服务端拒绝了这次请求（HTTP ${response.status}）。` };
  }
  return { ok: true, payload };
}

/**
 * 把服务端回的 `view` 收成我们认得的样子。
 *
 * 为什么要收一遍而不是直接 `as`：服务端与前端是两个进程，字段对不上时
 * `as` 会让界面在渲染到深处才崩（"一片空白"），而这里能当场给出一句人话。
 */
function readView(raw: unknown): HolidayTableView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { dir, years, errors, coverage, sources } = raw as Record<string, unknown>;
  if (!Array.isArray(years)) return null;
  return {
    dir: typeof dir === "string" ? dir : "",
    years: years as HolidayYear[],
    errors: Array.isArray(errors) ? errors.filter((item): item is string => typeof item === "string") : [],
    coverage:
      typeof coverage === "object" && coverage !== null
        ? (coverage as HolidayCoverage)
        : { currentYear: new Date().getFullYear(), expected: [], missing: [], available: [] },
    sources: Array.isArray(sources) ? (sources as HolidaySourceInfo[]) : [],
  };
}

/** 读整张表（登录即可）。 */
export async function loadHolidayTable(): Promise<HolidayTableOutcome> {
  const result = await request("GET");
  if (!result.ok) return result;
  const table = readView(result.payload.view);
  if (table === null) {
    return { ok: false, error: "服务端回的节假日表看不懂（字段对不上）：请刷新这一页，仍然这样就去看后端日志。" };
  }
  return { ok: true, table };
}

/** 抓取指定的年份（技术管理员）；不给年份时由服务端按"今年 + 明年"处理。 */
export async function refreshHolidayYears(years?: number[]): Promise<HolidayRefreshOutcome> {
  const result = await request("POST", years === undefined ? {} : { years });
  if (!result.ok) return result;
  const table = readView(result.payload.view);
  if (!Array.isArray(result.payload.results) || table === null) {
    return { ok: false, error: "服务端回的抓取结果看不懂（字段对不上）：请刷新这一页，仍然这样就去看后端日志。" };
  }
  return { ok: true, results: result.payload.results as HolidayRefreshResult[], table };
}
