/**
 * 服务端会话认证（第 6 步）。
 *
 * ## 要解决的是什么
 *
 * 早期登录是纯前端的：账号口令**硬编码在 `lib/auth/session.ts`** 里。仓库是公开的，
 * 所以那等于没有口令 —— 它只能挡住"误点进来的访客"。现在口令与校验都搬到服务端：
 *
 *   - 前端只拿一个**令牌**，拿不到口令；
 *   - `/api/call` 与各 REST 接口未登录一律 401；
 *   - 口令存服务端本机的文件里（0600），或由环境变量给出。
 *
 * ## 口令从哪来（三种情况，优先级从高到低）
 *
 *   1. `NEXGENEDU_ADMIN_PASSWORD` 环境变量 —— 你自己指定，最省事；
 *   2. 已存在的 `server/data/admin-credential.json` —— 上次生成过的，重启后保持不变；
 *   3. 首次启动：**随机生成一个强口令**，写进上面那个文件，并在启动日志里打印一次。
 *      打印是为了"第一次就能登进去"；文件是为了"打印刷过去之后还能找回来"。
 *
 * 为什么**不**把口令写进数据库：数据库会被备份、会被导出、会被恢复。
 * 把凭证放进数据库，意味着"恢复一份三个月前的备份"会把口令一起回退成三个月前的 ——
 * 那种故障很难联想到，而且正好发生在你手忙脚乱恢复数据的时候。
 *
 * ## 为什么明文口令要落一份在文件里
 *
 * 看着不体面，但在这里它是**正确的取舍**：能读到 `server/data/` 的人，
 * 本来就能直接读 `nexgenedu.db`（数据连文件都在他手上）。此时"口令不可读"
 * 提供不了任何保护，却会带来一个真实风险 —— 口令打印一次、刷过去就再也进不去，
 * 于是只能删库重来。文件权限设 0600，并放在 `server/data/`（已在 .gitignore 里）。
 *
 * ## 会话本身
 *
 * 令牌放**内存**，重启即失效。理由：单用户本机使用，重启后重新登录一次不麻烦；
 * 而把令牌持久化会引入"过期与回收"这一整套逻辑，收益几乎为零。
 * 令牌有闲置有效期（默认 12 小时），每次使用都会续期。
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "../lib/auth/roles.ts";
/*
 * 账号表（第 7 步）。这里与 `accounts.mts` 是**互相引用**的关系：
 * 本文件给它"凭证文件路径 + 哈希实现"，它给本文件"校验账号口令"。
 *
 * ESM 下循环引用是安全的**在这里**成立，因为两个模块的顶层都只有声明：
 * 没有"导入时就要用对方"的代码，而函数声明在实例化阶段就已经就绪。
 * 因此谁先被加载都不会读到未初始化的绑定（这也意味着：那两个文件里
 * 别在顶层直接调用对方的东西，否则循环引用会变成真的问题）。
 */
import { loginAccount } from "./accounts.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 凭证文件：**与它保护的那个数据库同目录**（默认 `server/data/`，不进 git）。
 *
 * 为什么必须跟着**数据库文件**走，而不是只看 `NEXGENEDU_DB_DIR`：
 * 自检 / 验收 / 演练起的是**临时库**（`NEXGENEDU_DB=.../dual-check-123.db`），
 * 那种情况下凭证若仍写到 `server/data/admin-credential.json`，就会**把真实口令覆盖掉** ——
 * 真发生过：跑完一轮自检，机构那边的登录口令变成了一个随机测试口令。
 * 现在临时库带来的凭证文件也落在临时目录里（而临时目录跑完就删）。
 */
export function credentialFile(): string {
  const dbFile = process.env.NEXGENEDU_DB;
  if (typeof dbFile === "string" && dbFile.trim() !== "" && dbFile !== ":memory:") {
    return path.join(path.dirname(dbFile), "admin-credential.json");
  }
  const dir = process.env.NEXGENEDU_DB_DIR ?? path.join(HERE, "data");
  return path.join(dir, "admin-credential.json");
}

/** 闲置有效期：默认 12 小时（本机一天用下来够用，放着不管也会自己过期）。 */
function idleTimeoutMs(): number {
  const minutes = Number.parseInt(process.env.NEXGENEDU_SESSION_MINUTES ?? "", 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 12 * 60 * 60_000;
}

type StoredCredential = {
  username: string;
  /**
   * 当前口令的**明文**（连同 hash 一起存，见文件头"为什么明文口令要落一份在文件里"）。
   *
   * 这一项不是为了校验（校验用下面的 salt + hash），而是为了**找回**：
   * 口令只在首次启动时打印一次，终端一滚过去就没地方看了。
   *
   * 这一项是补上的 —— 最初只存了 `salt` + `hash`，而登录页与使用手册都写着
   * "忘了口令就去这个文件里看"：**代码与文档不一致，后果是真锁死**（打印的那次没记下来，
   * 就再也进不去了，只能删凭证重来）。文档承诺的恢复路径必须真的存在。
   */
  password: string;
  /** scrypt 的参数一并存下来：将来调参数时老凭证仍可校验。 */
  salt: string;
  hash: string;
};

/** 口令哈希：scrypt + 随机盐。用 Node 内置的 crypto，不引第三方依赖。 */
function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type CredentialSetup = {
  username: string;
  /** 仅当本次是**新生成**（或旧格式重生成）口令时才有值（调用方负责打印一次）。 */
  generatedPassword: string | null;
  /** 口令来源，便于启动日志说清楚"这个口令是哪来的"。 */
  source: "环境变量" | "已有凭证文件" | "本次新生成" | "旧格式已重新生成";
};

let cached: StoredCredential | null = null;

/**
 * 读凭证文件。
 *
 * 缺少 `password` 的**旧格式**文件按"读不出来"处理（返回 null）→ 调用方会重新生成一份
 * 并打印新口令。这是刻意的：旧格式意味着那份口令**已经无法找回**，
 * 与其让服务带着一个谁也说不出的口令继续跑（等于锁死），不如重新生成并把新口令写清楚。
 */
function readCredentialFile(file: string): StoredCredential | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredCredential>;
    if (
      typeof parsed.username === "string" &&
      typeof parsed.password === "string" &&
      typeof parsed.salt === "string" &&
      typeof parsed.hash === "string"
    ) {
      return {
        username: parsed.username,
        password: parsed.password,
        salt: parsed.salt,
        hash: parsed.hash,
      };
    }
    return null;
  } catch {
    // 文件坏了就当作没有：下面会重新生成，而不是让服务起不来
    return null;
  }
}

/** 该路径上是否存在"旧格式"（无明文）凭证文件 —— 只为启动日志能说清原因。 */
function hasLegacyCredentialFile(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredCredential>;
    return typeof parsed.hash === "string" && typeof parsed.password !== "string";
  } catch {
    return false;
  }
}

/**
 * 准备凭证（服务端启动时调用一次）。
 *
 * 返回的 `generatedPassword` 只在**新生成**时有值，调用方打印它一次。
 */
export function prepareCredential(): CredentialSetup {
  const username = (process.env.NEXGENEDU_ADMIN_USER ?? "admin").trim() || "admin";
  const fromEnv = process.env.NEXGENEDU_ADMIN_PASSWORD;

  if (typeof fromEnv === "string" && fromEnv !== "") {
    const salt = randomBytes(16).toString("hex");
    cached = { username, password: fromEnv, salt, hash: hashPassword(fromEnv, salt) };
    /*
     * 环境变量指定口令时，**也要把它落进凭证文件**（保持"一份真相"）。
     *
     * 踩过这个坑：原来只把环境变量记在内存里、不动文件，于是文件里躺着的是**上一份**
     * 口令。后果很隐蔽 —— 哪天不带环境变量启动（换个终端、忘了、写进脚本却没写全），
     * 生效的口令会突然变成文件里那份旧的，人只会看到"我明明设过口令，怎么又不对了"。
     * 现在无论怎么启动，**文件里那份永远是当前生效的那份**。
     */
    try {
      mkdirSync(path.dirname(credentialFile()), { recursive: true });
      writeFileSync(credentialFile(), `${JSON.stringify(cached, null, 2)}\n`, { mode: 0o600 });
    } catch {
      // 写不了文件（只读挂载等）不该让服务起不来：内存里的凭证仍是有效的
    }
    return { username, generatedPassword: null, source: "环境变量" };
  }

  const file = credentialFile();
  const existing = readCredentialFile(file);
  if (existing !== null) {
    cached = existing;
    return { username: existing.username, generatedPassword: null, source: "已有凭证文件" };
  }
  const wasLegacy = hasLegacyCredentialFile(file);

  // 首次启动：生成一个**强**口令。刻意不用固定的默认口令 ——
  // 固定的默认口令写在公开仓库里，等于没有口令，而这正是本次要修掉的东西。
  const password = randomBytes(12).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  cached = { username, password, salt, hash: hashPassword(password, salt) };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cached, null, 2)}\n`, { mode: 0o600 });
  return {
    username,
    generatedPassword: password,
    source: wasLegacy ? "旧格式已重新生成" : "本次新生成",
  };
}

export type LoginResult =
  | { ok: true; token: string; username: string; expiresAt: string }
  | { ok: false; error: string };

type Session = { username: string; expiresAt: number };

/** 会话表：令牌 → 会话。放内存，重启即失效（理由见文件头）。 */
const sessions = new Map<string, Session>();

function sweep(now: number): void {
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

/**
 * 校验账号口令，成功则签发令牌。
 *
 * 失败时**不区分**"账号不存在"与"口令不对"，都回同一句：
 * 区分开来等于告诉试探者"这个账号是存在的"。
 */
export function login(username: string, password: string): LoginResult {
  if (cached === null) return { ok: false, error: "服务端尚未准备好凭证，请重启后端。" };

  const now = Date.now();
  sweep(now);

  const usernameMatches = username.trim() === cached.username;
  const passwordMatches = constantTimeEqual(hashPassword(password, cached.salt), cached.hash);
  if (!usernameMatches || !passwordMatches) {
    return { ok: false, error: "账号或密码不正确。" };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = now + idleTimeoutMs();
  sessions.set(token, { username: cached.username, expiresAt });
  return {
    ok: true,
    token,
    username: cached.username,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** 校验令牌（并**续期**：本机使用时一直在操作，不该被闲置超时打断）。 */
export function verifyToken(token: string | null): Session | null {
  if (token === null || token === "") return null;
  const now = Date.now();
  const session = sessions.get(token);
  if (session === undefined) return null;
  if (session.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = now + idleTimeoutMs();
  return session;
}

/** 退出登录：作废该令牌。 */
export function logout(token: string | null): void {
  if (token !== null) sessions.delete(token);
}

/** 从 `Authorization: Bearer <token>` 头里取令牌。 */
export function tokenFromHeader(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const matched = /^Bearer\s+(.+)$/i.exec(header.trim());
  return matched?.[1] ?? null;
}

/** 当前有效会话数（/api/status 显示用，也方便确认"退出登录"真的作废了）。 */
export function activeSessionCount(): number {
  sweep(Date.now());
  return sessions.size;
}
