"use client";

import { backendBase } from "@/lib/backend/connection";
import { readToken } from "@/lib/auth/token";

/**
 * 账号管理（后台「账号」页）的前端客户端。
 *
 * ## 为什么单独一个文件、而不是 `lib/backend/api.ts` 的方法
 *
 * 账号表是**服务端进程里的一个文件**（`accounts.json`），而 `api` 在浏览器里也会跑
 * （没配 `NEXT_PUBLIC_API_BASE` 时它直接用 localStorage 那份实现）—— 在那里做一个
 * `api.accounts.create()`，要么在浏览器里必然失败，要么被实现成一个假的成功。
 * 更糟的是它会进入 `API_CONTRACT`（自检要求"服务层每个方法都必须在契约里"），
 * 于是契约里出现一个"只有服务端才有意义"的方法。
 *
 * 所以账号管理走**服务端自己的四条路由**（`GET/POST/PATCH/DELETE /api/accounts`，
 * 见 `server/index.mts`），这个文件就是它们的客户端 —— 与 `lib/auth/session.ts`
 * 调 `/api/login`、`/api/session` 是同一个做法（都是"服务端专属接口"的客户端）。
 *
 * ## 它与权限无关
 *
 * 这里**不做**任何"是不是技术管理员"的判断：判定在服务端（`accountsRouteDenial`）。
 * 前端能做的只是"把按钮禁掉、把 403 的话显示出来" —— 与项目一贯的纪律一致
 * （前端拦得住手滑，拦不住直接调接口）。
 *
 * ## 口令只在写入时经过这里
 *
 * 新建与重置口令时要把明文口令发给服务端（必须如此：校验用的是服务端那份 scrypt），
 * 而**读回来的任何东西里都没有口令**（服务端只回 `AccountSummary`）。
 * 这里也**不存**口令：提交完就丢掉，绝不写进 localStorage。
 */

/** 一条账号（服务端只回这些字段：**没有 password / salt / hash**）。 */
export type AccountRow = {
  username: string;
  /**
   * 角色名单。刻意是 `string[]` 而不是 `Role[]`：认不出来的角色名也**照原样显示**，
   * 好让技术管理员一眼看见"这条账号的角色不对劲、去改一下"。
   * （`lib/auth/roles.ts` 的 `readRoles` 在会话里认不出就退化成"全角色"，那是权限兜底；
   * 这里只是展示，不需要兜底，也不能骗人。）
   */
  roles: string[];
  /** 绑定的教师档案 id（`teachers.id`），空串 = 没绑。 */
  teacherId: string;
  note: string;
  createdAt: string;
  /** 停用：账号还在表里，但不许登录。 */
  disabled: boolean;
};

/** 账号列表 + "这份账号表能不能改"。 */
export type AccountTable = {
  accounts: AccountRow[];
  /** `true` = 本次账号表来自只读钩子（`NEXGENEDU_ACCOUNTS_JSON`），写操作会被服务端拒绝。 */
  readOnly: boolean;
  /** 只读的原因（可写时是空串）。界面直接显示它 —— 那句话是服务端写的，比前端再编一句准。 */
  readOnlyReason: string;
  /** 账号表文件（给人看的：备用做法是直接改它，那种改法要重启后端）。 */
  file: string;
};

/** 写操作的结果：成功时带回**改动之后**那条账号，失败时带一句人话。 */
export type AccountWriteOutcome =
  | { ok: true; account: AccountRow; warnings: string[] }
  | { ok: false; error: string };

export type AccountTableOutcome = { ok: true; table: AccountTable } | { ok: false; error: string };

/** 服务端回来的原始 JSON（只声明我们真的会用到的字段）。 */
type RawResponse = {
  ok?: boolean;
  error?: string;
  accounts?: AccountRow[];
  account?: AccountRow;
  warnings?: unknown;
  readOnly?: unknown;
  readOnlyReason?: unknown;
  file?: unknown;
  deleted?: unknown;
  username?: unknown;
};

/** 一次请求的结果：成功带回 JSON，失败带回给人看的原因。 */
type RequestOutcome = { ok: true; payload: RawResponse } | { ok: false; error: string };

/** 请求超时：与 `session.ts` 同一个取舍 —— 界面不能卡在"提交中…"上等一个不回话的请求。 */
const TIMEOUT_MS = 10_000;

/**
 * 发一次账号管理请求。
 *
 * 把"没有后端 / 没登录 / 后端拒绝 / 连不上"四种情况分开说法（照抄 `session.ts` 的教训）：
 * 一律回"操作失败"的话，人就只能靠猜 —— 而"后端没开"和"你没有权限"要做的事完全不同。
 */
async function request(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<RequestOutcome> {
  const base = backendBase();
  if (base === "") {
    return {
      ok: false,
      error: "当前没有配置后端地址：账号只存在于服务端，请先启动后端（npm run server）并在顶栏确认已连接。",
    };
  }
  const token = readToken();

  let response: Response;
  try {
    response = await fetch(`${base}/api/accounts`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      error: `连不上后端（${base}）：${cause instanceof Error ? cause.message : String(cause)}。请确认后端在跑。`,
    };
  }

  const payload = (await response.json().catch(() => ({}))) as RawResponse;

  if (response.status === 401) {
    return { ok: false, error: "登录已过期，请重新登录后再试。" };
  }
  if (!response.ok || payload.ok !== true) {
    /*
     * 403 的话**原样显示服务端那句**（它写清了"需要什么角色"）：
     * 这一页正常轮不到非技术管理员进来（导航里没有入口、`RoleGuard` 也会挡），
     * 但"直接敲网址"是可能的 —— 那时界面必须给一句人话，而不是白屏。
     */
    return { ok: false, error: payload.error ?? `服务端拒绝了这次请求（HTTP ${response.status}）。` };
  }
  return { ok: true, payload };
}

/** 读账号列表（含"这份账号表能不能改"）。 */
export async function loadAccountTable(): Promise<AccountTableOutcome> {
  const result = await request("GET");
  if (!result.ok) return result;
  return {
    ok: true,
    table: {
      accounts: Array.isArray(result.payload.accounts) ? result.payload.accounts : [],
      readOnly: result.payload.readOnly === true,
      readOnlyReason:
        typeof result.payload.readOnlyReason === "string" ? result.payload.readOnlyReason : "",
      file: typeof result.payload.file === "string" ? result.payload.file : "",
    },
  };
}

/** 把服务端回的 `warnings` 收成字符串数组（只认字符串，别的一律忽略）。 */
function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item !== "");
}

/** 一次写操作（新建 / 改动 / 删除）的公共收尾。 */
function writeOutcome(result: RequestOutcome): AccountWriteOutcome {
  if (!result.ok) return result;
  const account = result.payload.account;
  if (account === undefined) {
    return { ok: false, error: "服务端没有回这条账号的内容，请刷新这一页确认改动是否生效。" };
  }
  return { ok: true, account, warnings: readWarnings(result.payload.warnings) };
}

/** 新建一条账号（用户名、初始口令、角色、绑定教师、备注）。 */
export async function createAccountRow(input: {
  username: string;
  password: string;
  roles: string[];
  teacherId: string;
  note: string;
}): Promise<AccountWriteOutcome> {
  return writeOutcome(await request("POST", { ...input }));
}

/**
 * 改一条账号：`username` 指定改谁，其余字段**给了才改**。
 *
 * 刻意不做成"整条覆盖"：界面上"改角色与教师"和"重置口令"是两件事，
 * 一次只发一件，就不会出现"只是想改备注、结果把口令一起重置了"。
 */
export async function updateAccountRow(
  username: string,
  patch: { roles?: string[]; teacherId?: string; note?: string; password?: string; disabled?: boolean },
): Promise<AccountWriteOutcome> {
  return writeOutcome(await request("PATCH", { username, ...patch }));
}

/** 删掉一条账号。 */
export async function removeAccountRow(username: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await request("DELETE", { username });
  return result.ok ? { ok: true } : result;
}
