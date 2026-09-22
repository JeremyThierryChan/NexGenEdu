/**
 * 多账号与角色（第 7 步）。
 *
 * ## 这一步要解决什么
 *
 * 第 6 步之前只有**一个账号**：`admin` 登进来就能看、能改全部数据。
 * 机构里其实是四种人（技术管理员 / 财务管理员 / 招生老师 / 普通教师），
 * 职责完全不同 —— 一个账号意味着"把口令给了谁，就是把全部数据给了谁"，
 * 而前台老师只该看到自己的课。
 *
 * 现在：账号表是一份文件里的**多条账号**（每人一条，一个人可以兼多个角色），
 * 服务端按角色拦接口（闸门在 `server/index.mts`），界面按 `/api/session` 回的角色隐藏入口。
 * 角色的定义与"哪一组接口归谁"全在 `lib/auth/roles.ts` —— 这个文件**只负责账号**，
 * 不重新发明一遍角色判断（两套判断迟早会不一致，而这是权限）。
 *
 * ## 账号文件放哪：跟着**凭证文件**所在目录（**绝不写死 `server/data`**）
 *
 * `accountsFile()` 用的是 `auth.mts` 的 `credentialFile()` 所在目录，因此它自动继承
 * 那条**踩出来的规矩**：临时库（`NEXGENEDU_DB=...临时目录...`）带来的账号文件也落在
 * 临时目录里。写死 `server/data` 的后果是真发生过的：自检起一个临时服务端，
 * 把机构真实的凭证覆盖成随机测试口令 —— 跑完自检人就登不进去了。
 * 账号文件比凭证文件更要命：凭证文件里只有一条口令，**账号文件里装着所有账号与角色**。
 *
 * ## 为什么明文口令也要落一份（与 admin-credential.json 同一约定）
 *
 * 理由与 `auth.mts` 里写的一样：能读到这个文件的人本来就能读到 `nexgenedu.db`
 * （数据连文件都在他手上），此时"口令不可读"提供不了任何保护，却会带来
 * "口令打印一次、刷过去就再也进不去，只能删库重来"的真实风险。
 * 文件权限 0600，放在数据目录（已在 .gitignore 里），不进 git。
 *
 * ## 校验：复用 auth.mts 的 scrypt + 常量时间比较
 *
 * **只有一份实现**（`server/auth.mts` 导出 `hashPassword` / `constantTimeEqual`）。
 * 在这里另写一套的后果不是报错，而是"某些账号永远登不上"（salt 长度、哈希长度、
 * 编码方式任一处不同都会这样），而那种故障很难查 —— 所以宁可从 auth.mts 引入。
 *
 * ## 测试钩子：`NEXGENEDU_ACCOUNTS_JSON`
 *
 * 有值时**只读、不落盘**地拿它当账号表（自检 / 验收靠它造一个"普通教师"账号起临时服务端，
 * 这样验收不必去改真实账号文件）。解析失败**抛错**，而不是退回文件账号：
 * 那是测试钩子，静默退回会让"验证了新代码"变成假话 —— 测的其实是另一份账号表。
 *
 * ## 与凭证文件的关系（两条来源，方向定死）
 *
 * `admin-credential.json` 是**上一版（单账号）留下的**。这一版里它只承担两件事：
 *   1. 迁移：`accounts.json` 不存在时，按它生成第一条账号（角色给全部 → 老部署升级后
 *      照样能用原来的口令做原来能做的事，不会一上来就"没权限"）；
 *   2. 换口令：显式设 `NEXGENEDU_ADMIN_PASSWORD` 启动时，把新口令**同步进账号表**
 *      （这是文档里写着的"怎么换口令"的做法，必须继续有效）。
 *
 * 登录**只认账号表**。凭证文件与账号表不一致时（不是环境变量那种显式情况）**不改账号表**，
 * 只在启动日志里把"登录用的是账号表那份"说清楚 —— 账号表是人手维护的，
 * 后台偷偷改它会让人查不明白"我的口令怎么变了"。
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROLES, type Role } from "../lib/auth/roles.ts";
// 与凭证文件**同一套**哈希与比较（见文件头"只有一份实现"）
import {
  activeCredential,
  constantTimeEqual,
  credentialFile,
  credentialPasswordFromEnv,
  hashPassword,
} from "./auth.mts";

/** 一条账号。 */
export type Account = {
  username: string;
  /**
   * 明文口令（**找回用**，与 `admin-credential.json` 同一约定）。
   *
   * 校验不用它（用下面的 salt + hash），它存在的理由是：口令只在首次启动时打印一次，
   * 终端一滚过去就没地方看了 —— 而"加一个老师的账号"是要交接给别人的事，
   * 不能变成"口令在谁的聊天记录里"。
   */
  password: string;
  /** scrypt 的参数一并存下来：将来调参数时老账号仍可校验。 */
  salt: string;
  hash: string;
  roles: Role[];
  /**
   * 普通教师账号对应教师档案里的哪一位（`teachers.id`）。
   *
   * 现在**可以留空**：行级范围（"只看自己的课"）是下一步的事，
   * 但账号形状里先留出这个字段，免得那时候再改一遍文件格式。
   */
  teacherId: string;
  /** 备注（这个人是谁、什么时候开的），给人看。 */
  note: string;
  createdAt: string;
};

/**
 * 给界面用的账号形状：**不含口令与哈希**。
 *
 * 界面只需要知道"有谁、各是什么角色"；把明文口令塞进任何一个响应里，
 * 都是下一次"顺手打进日志"的起点。
 */
export type AccountSummary = Omit<Account, "password" | "salt" | "hash">;

/** 登录结果。成功时带上角色与教师档案 id —— 会话要按角色拦接口。 */
export type AccountLoginResult =
  | { ok: true; username: string; roles: Role[]; teacherId: string }
  | { ok: false; error: string };

/** 登录失败的**同一句话**：不区分"账号不存在"与"口令不对"（区分开等于告诉试探者账号存在）。 */
const FAILED_LOGIN = "账号或密码不正确。";

/** 账号不存在时也照样算一次哈希，用的固定盐（只为耗时一致，不保护任何东西）。 */
const DUMMY_SALT = "nexgenedu-account-not-found";

/** 提示里指向的那一节：账号与角色怎么分工，写在使用手册里。 */
const ROLES_DOC = "docs/使用手册.md 的「谁能做什么」";

/**
 * 账号文件：**与凭证文件同一个目录**（也就是跟着数据库文件走，理由见文件头）。
 *
 * 刻意从 `credentialFile()` 推导而不是自己再判断一次环境变量：那条路径逻辑
 * 是踩过事故才定下来的（`NEXGENEDU_DB` 指向临时目录时，凭证文件也必须在临时目录里），
 * 判断写两遍，早晚有一份先漂移。
 */
export function accountsFile(): string {
  return path.join(path.dirname(credentialFile()), "accounts.json");
}

/* ── 读 / 写 / 规范化 ─────────────────────────────────────────────────── */

/** 把一个原始条目规范成账号；缺 username/password 的按"这条不算数"处理（返回 null）。 */
function toAccount(raw: unknown): { account: Account; unknownRoles: string[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const username = typeof record.username === "string" ? record.username.trim() : "";
  const password = typeof record.password === "string" ? record.password : "";
  if (username === "" || password === "") return null;

  /*
   * 角色只认 `ROLES` 里有的四个名字。
   * 认不出来的**丢掉**（等于不给权限，方向是关门），并把名字带出去让人在启动日志里看见 ——
   * 悄悄忽略一个拼错的角色名，会让人对着"我明明给了他财务"发呆。
   */
  const rawRoles: unknown[] = Array.isArray(record.roles) ? record.roles : [];
  const known: Role[] = [];
  const unknownRoles: string[] = [];
  for (const item of rawRoles) {
    if (typeof item !== "string") continue;
    if (ROLES.includes(item as Role)) known.push(item as Role);
    else unknownRoles.push(item);
  }

  /*
   * salt / hash 缺了就**按口令现算一份**（只存在内存里，落盘时才算"补全"）。
   *
   * 为什么要容忍缺字段：账号文件是给人手写的（"加一个王老师"），
   * 要求他手动算 scrypt 是不现实的；`NEXGENEDU_ACCOUNTS_JSON` 那个测试钩子
   * 也刻意只给 username/password/roles。缺 hash 不算错，算"按口令推导"。
   */
  const salt =
    typeof record.salt === "string" && record.salt !== "" ? record.salt : randomBytes(16).toString("hex");
  const hash =
    typeof record.hash === "string" && record.hash !== ""
      ? record.hash
      : hashPassword(password, salt);

  return {
    account: {
      username,
      password,
      salt,
      hash,
      roles: [...new Set(known)],
      teacherId: typeof record.teacherId === "string" ? record.teacherId : "",
      note: typeof record.note === "string" ? record.note : "",
      createdAt:
        typeof record.createdAt === "string" && record.createdAt !== ""
          ? record.createdAt
          : new Date().toISOString(),
    },
    unknownRoles,
  };
}

/** 把一批原始条目收集成账号表（环境变量与文件两条来源共用这一段，口径就不会分叉）。 */
function collectAccounts(items: unknown[]): { accounts: Account[]; notices: string[] } {
  const accounts: Account[] = [];
  const notices: string[] = [];
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const normalized = toAccount(item);
    if (normalized === null) {
      notices.push(`第 ${index + 1} 条缺少 username 或 password，已跳过`);
      return;
    }
    if (normalized.unknownRoles.length > 0) {
      notices.push(
        `账号 ${normalized.account.username} 的角色里有不认识的名字` +
          `（${normalized.unknownRoles.join("、")}）已忽略：角色只认 lib/auth/roles.ts 里的那四个`,
      );
    }
    /*
     * 同名的只认第一条：这不是"取并集"也不是"取最后一条"，而是**确定地取第一条**。
     * 同名两条的后果是"口令到底哪个生效"说不清，所以取第一条 + 在启动日志里点名。
     */
    if (seen.has(normalized.account.username)) {
      notices.push(`账号名重复：${normalized.account.username}（只认第一条）`);
      return;
    }
    seen.add(normalized.account.username);
    accounts.push(normalized.account);
  });

  return { accounts, notices };
}

/** 写账号文件（0600）。返回错误原因（写不进去时不让服务起不来，但要在日志里说出来）。 */
function writeAccountsFile(file: string, accounts: Account[]): string | null {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/* ── 账号表从哪来（环境变量 / 文件 / 迁移）────────────────────────────── */

type AccountsState = {
  /** 缓存键：来源变了（环境变量改了、临时目录换了）就必须重新读，不能拿旧表继续用。 */
  key: string;
  source: "环境变量" | "账号文件" | "从凭证文件迁移";
  accounts: Account[];
  /** 要让人看见的提醒（跳过条目、角色名不认识、口令同步…）。**绝不含口令**。 */
  notices: string[];
  /** 账号文件存在但读不出来时的原因；非 null 表示"本次谁也登录不了"。 */
  brokenReason: string | null;
};

let cache: AccountsState | null = null;

/**
 * 解析 `NEXGENEDU_ACCOUNTS_JSON`。
 *
 * **格式不对就抛错，绝不退回文件账号**：这是自检/验收用的钩子，
 * 静默退回会让"我验证了新代码"变成假话（真正生效的是另一份账号表），
 * 而那正是这类钩子最容易骗到人的地方。
 */
function accountsFromEnv(json: string): AccountsState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new Error(
      `NEXGENEDU_ACCOUNTS_JSON 不是合法 JSON：${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      'NEXGENEDU_ACCOUNTS_JSON 必须是数组，形如 [{"username":"teacher","password":"pw","roles":["普通教师"]}]',
    );
  }

  const items: unknown[] = parsed;
  const { accounts, notices } = collectAccounts(items);
  if (accounts.length === 0) {
    throw new Error(
      "NEXGENEDU_ACCOUNTS_JSON 里没有一条可用的账号（每条都要有 username 与 password）——" +
        "空账号表会让所有登录都失败，所以这里直接报错，而不是当成'没有账号'继续跑。",
    );
  }

  return { key: `env:${json}`, source: "环境变量", accounts, notices, brokenReason: null };
}

/** 读账号文件的结果：没有文件（要迁移）/ 读到了（里面可能是"读不出来"的说明）。 */
type FileRead = { kind: "missing" } | { kind: "loaded"; state: AccountsState };

/**
 * 读账号文件。
 *
 * 文件**存在但读不出来**（JSON 坏了、结构不对）时不抛错，而是带一个 brokenReason 回来：
 * 调用方据此**关门并喊出来**（理由见 `loadAccounts` 里那段）。
 */
function readAccountsFile(file: string): FileRead {
  const key = `file:${file}`;
  if (!existsSync(file)) return { kind: "missing" };

  const broken = (reason: string): FileRead => ({
    kind: "loaded",
    state: { key, source: "账号文件", accounts: [], notices: [], brokenReason: reason },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    return broken(`JSON 解析失败：${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(parsed)) {
    return broken("文件内容不是一个数组（期望 [{username, password, roles, …}, …]）");
  }

  const items: unknown[] = parsed;
  const { accounts, notices } = collectAccounts(items);
  return { kind: "loaded", state: { key, source: "账号文件", accounts, notices, brokenReason: null } };
}

/**
 * 迁移：`accounts.json` 不存在时，按凭证文件生成第一条账号。
 *
 * 角色给**全权限**是刻意的：老部署第一次启动这一版时，它只有一个账号，
 * 而那个账号以前能做的事就是全部的事。给一半角色会让人一升级就撞上
 * "这个接口没有权限"，然后把权限当成 bug 去查 —— 属于自找的故障。
 *
 * 给的是**单一角色「技术管理员」**，而不是四个角色都写上：技术管理员在
 * `lib/auth/roles.ts` 里就是"全权限"的定义（自检断言它等于全部页面与全部分组），
 * 再叠另外三个角色在效果上完全一样，只会让账号表里出现一句读不懂的话
 * （"这个人为什么同时是老师和财务？"）。**几个角色都写只有在真的兼任时才写。**
 */
function migrateFromCredential(): AccountsState {
  const file = accountsFile();
  const credential = activeCredential();
  if (credential === null) {
    return {
      key: `file:${file}`,
      source: "从凭证文件迁移",
      accounts: [],
      notices: [],
      brokenReason:
        "既没有账号文件，也读不到凭证文件（admin-credential.json）：一个账号都没有。" +
        "请先用 NEXGENEDU_ADMIN_PASSWORD=... 启动一次后端，或自己写一份 accounts.json。",
    };
  }

  const account: Account = {
    username: credential.username,
    password: credential.password,
    salt: credential.salt,
    hash: credential.hash,
    roles: ["技术管理员"],
    teacherId: "",
    note: "由单账号凭证（admin-credential.json）迁移而来：口令与原来一样，角色是全权限（技术管理员）",
    createdAt: new Date().toISOString(),
  };

  const notices = [
    `这是第一次启动这一版：已按凭证文件（${credentialFile()}）生成上面这条账号，` +
      `口令与原来一样；要加人就把他们写进 ${accountsFile()} 后重启后端`,
  ];
  const failed = writeAccountsFile(file, [account]);
  if (failed !== null) {
    notices.push(
      `账号文件写不进去（${failed}）：本次启动能用（在内存里），但重启后会再迁移一次 —— ` +
        "如果这个目录是只读挂载，加账号时也会同样失败",
    );
  }

  return { key: `file:${file}`, source: "从凭证文件迁移", accounts: [account], notices, brokenReason: null };
}

/**
 * **显式的换口令**：设了 `NEXGENEDU_ADMIN_PASSWORD` 时，把新口令同步进账号表里同名的那条。
 *
 * 为什么必须做（两条都是真实路径）：
 *   1. 文档与界面都写着"忘了口令就停掉后端，用 `NEXGENEDU_ADMIN_PASSWORD=新口令 npm run server`
 *      启动一次来换口令"。账号表落地之后，如果不同步，那条路径就会**静默失效** ——
 *      人换了口令却发现登不进去，只会怀疑口令抄错了；
 *   2. 自检与演练会在**同一个临时目录里反复起服务**，每次都由脚本指定一个新的随机口令
 *      （见 `scripts/temp-server.mts`）。不同步的话，第二次启动就会用不了它自己的口令。
 *
 * 为什么**只在环境变量这条路**上同步：那是"我现在就是要换口令"的显式信号。
 * 账号表是人手维护的；在别的情况下（比如凭证文件与账号表不一致）就悄悄改账号表，
 * 会让人对着"我的口令怎么自己变了"查半天 —— 那种情况只提示，不改。
 *
 * 同步时**保留原有的角色 / teacherId / 备注**：只换口令，不碰权限。
 * （把权限一并"重置成全部"是最糟糕的做法：限制过的账号会悄悄变成全权限。）
 */
function syncEnvPassword(
  state: AccountsState,
): { state: AccountsState; changed: boolean } {
  const envPassword = credentialPasswordFromEnv();
  const credential = activeCredential();
  if (envPassword === null || credential === null || state.brokenReason !== null) {
    return { state, changed: false };
  }

  const index = state.accounts.findIndex((item) => item.username === credential.username);
  if (index === -1) {
    /*
     * 账号表里没有这个用户名 —— 这是"环境变量指定了一个新账号"的情况。
     * 与迁移同样的道理：给全权限（技术管理员这一个角色就够，见上面迁移那段注释），
     * 否则它一登录进来就什么都做不了。
     */
    const created: Account = {
      username: credential.username,
      password: envPassword,
      salt: credential.salt,
      hash: credential.hash,
      roles: ["技术管理员"],
      teacherId: "",
      note: "由环境变量 NEXGENEDU_ADMIN_PASSWORD 指定（账号表里原来没有这个名字）",
      createdAt: new Date().toISOString(),
    };
    return {
      state: {
        ...state,
        accounts: [...state.accounts, created],
        notices: [
          ...state.notices,
          `已按环境变量 NEXGENEDU_ADMIN_PASSWORD 新建账号 ${created.username}（角色：${ROLES.join("、")}）`,
        ],
      },
      changed: true,
    };
  }

  const existing = state.accounts[index];
  if (existing === undefined || existing.password === envPassword) return { state, changed: false };

  // 换了口令就必须重算 salt + hash：只改明文而留着旧 hash，会让新口令**校验不过**（静默的错）
  const salt = randomBytes(16).toString("hex");
  const updated: Account = { ...existing, password: envPassword, salt, hash: hashPassword(envPassword, salt) };
  const accounts = state.accounts.map((item, at) => (at === index ? updated : item));
  return {
    state: {
      ...state,
      accounts,
      notices: [
        ...state.notices,
        `已按环境变量 NEXGENEDU_ADMIN_PASSWORD 更新账号 ${updated.username} 的口令（角色不变：${updated.roles.join("、") || "无"}）`,
      ],
    },
    changed: true,
  };
}

/**
 * 账号表与凭证文件不一致时**只提示**（不改账号表），说清"登录用的是哪一份"。
 *
 * 这条提示是给一种很常见的困惑用的：文档写着"忘了口令就看 admin-credential.json"，
 * 而这一版登录只认 accounts.json。两份不一致时，人拿着凭证文件里的口令是登不进去的，
 * 没有一行提示就只能在两个文件之间反复试。
 */
function noteCredentialDivergence(state: AccountsState): string[] {
  const credential = activeCredential();
  if (credential === null) return [];
  const same = state.accounts.find((item) => item.username === credential.username);
  if (same === undefined || same.password === credential.password) return [];
  return [
    `凭证文件（${credentialFile()}）里的口令与账号表里 ${same.username} 的口令不一致：` +
      `**登录用的是账号表那份**（这一版只认 ${accountsFile()}）。` +
      "要换口令就改账号表，或用 NEXGENEDU_ADMIN_PASSWORD=新口令 启动一次后端。",
  ];
}

/** 缓存账号表；来源（环境变量 / 文件路径）变了就重新读。 */
function loadAccounts(): AccountsState {
  const envJson = process.env.NEXGENEDU_ACCOUNTS_JSON;
  if (typeof envJson === "string" && envJson.trim() !== "") {
    const key = `env:${envJson}`;
    if (cache !== null && cache.key === key) return cache;
    cache = accountsFromEnv(envJson);
    return cache;
  }

  const file = accountsFile();
  const key = `file:${file}`;
  if (cache !== null && cache.key === key) return cache;

  const read = readAccountsFile(file);
  if (read.kind === "missing") {
    cache = migrateFromCredential();
    return cache;
  }
  const state = read.state;
  /*
   * 文件**存在但读不出来**：不覆盖它，本次谁也登录不了。
   *
   * 为什么不学 auth.mts 那样"坏了就当作没有、重新生成一份"：凭证文件重新生成
   * 只会换掉唯一那条口令（而且新口令会打印出来）；账号文件重新生成会**把其他账号
   * 一起抹掉**，只留下迁移出来的那一条。文件坏了（比如手工编辑时少了个逗号）
   * 用眼睛还能把用户名抄回来，覆盖掉就真没了。所以：原样留着、喊出来、关门。
   */
  if (state.brokenReason !== null) {
    cache = state;
    return cache;
  }

  const synced = syncEnvPassword(state);
  const withNotes: AccountsState = {
    ...synced.state,
    notices: [...synced.state.notices, ...noteCredentialDivergence(synced.state)],
  };
  if (synced.changed) {
    const failed = writeAccountsFile(file, withNotes.accounts);
    if (failed !== null) {
      withNotes.notices.push(`账号文件写不进去（${failed}）：本次启动按内存里这份生效，重启后又会重来`);
    }
  }
  cache = withNotes;
  return cache;
}

/* ── 对外接口 ─────────────────────────────────────────────────────────── */

/** 账号一览（**给界面用**：不含口令与哈希）。 */
export function listAccounts(): AccountSummary[] {
  return loadAccounts().accounts.map((account) => ({
    username: account.username,
    roles: [...account.roles],
    teacherId: account.teacherId,
    note: account.note,
    createdAt: account.createdAt,
  }));
}

/**
 * 校验账号口令。
 *
 * 失败时**不区分**"账号不存在"与"口令不对"，都回同一句 ——
 * 区分开来等于告诉试探者"这个账号是存在的"，那是给撞库的人省了一半功夫。
 * 而且账号不存在时也照样算一次哈希：响应快慢也不能泄漏账号是否存在。
 */
export function loginAccount(username: string, password: string): AccountLoginResult {
  const state = loadAccounts();

  // 账号表本身读不出来：说清原因。这与"账号/口令不对"不是一类问题，混在一起会让人查错方向
  if (state.brokenReason !== null) {
    return {
      ok: false,
      error:
        `账号表读不出来（${state.brokenReason}），本次启动谁也登录不了。` +
        `请修好或删掉 ${accountsFile()} 后重启后端（原文件没有被覆盖，内容还在）。`,
    };
  }

  const wanted = username.trim();
  const account = state.accounts.find((item) => item.username === wanted) ?? null;

  if (account === null) {
    // 照样算一次（耗时一致），结果不用
    hashPassword(password, DUMMY_SALT);
    return { ok: false, error: FAILED_LOGIN };
  }
  if (!constantTimeEqual(hashPassword(password, account.salt), account.hash)) {
    return { ok: false, error: FAILED_LOGIN };
  }

  return { ok: true, username: account.username, roles: [...account.roles], teacherId: account.teacherId };
}

/**
 * 启动日志用的一行（或几行）：账号数 / 各账号角色。
 *
 * **绝不打印口令**（唯一的例外是首次启动随机生成的那一条，由 `auth.mts` 打印一次，
 * 因为"不打印就第一次都登不进去"）。这里打印的是用户名与角色 ——
 * 它们要出现在日志里，人才知道"现在到底有几个账号、谁能做什么"。
 */
export function accountBootstrapNote(): string {
  const state = loadAccounts();
  const lines: string[] = [];

  if (state.brokenReason !== null) {
    lines.push(`[账号] 账号表读不出来：${state.brokenReason}`);
    lines.push(
      `[账号] **本次启动谁也登录不了**。原来那份 ${accountsFile()} 没有被覆盖，` +
        "修好它（或先把它备份走再删掉）后重启即可；不要为了「能进去」而随便清掉它。",
    );
    return lines.join("\n");
  }

  if (state.accounts.length === 0) {
    lines.push("[账号] 一个账号都没有：本次启动谁也登录不了。");
    lines.push(`[账号] 请先设置 NEXGENEDU_ADMIN_PASSWORD 启动一次，或自己写一份 ${accountsFile()}。`);
    return lines.join("\n");
  }

  const roster = state.accounts
    .map((account) => {
      const roles =
        account.roles.length === 0
          ? "没有任何已知角色，什么都做不了"
          : account.roles.join("、");
      return `${account.username}（${roles}）`;
    })
    .join("、");
  // 只有一个账号时不写"1 个账号："：老部署升级后第一眼看到的应该还是熟悉的那个形状
  lines.push(
    `[账号] ${state.accounts.length === 1 ? "" : `${state.accounts.length} 个账号：`}${roster}` +
      `；如需多人使用，见 ${ROLES_DOC}`,
  );

  if (state.source === "环境变量") {
    lines.push(
      "[账号] 本次账号表来自 NEXGENEDU_ACCOUNTS_JSON（只读、不落盘）：" +
        "上面那行凭证文件口令在本次启动里用不上，登录请用 JSON 里的那个账号。",
    );
  } else {
    lines.push(`[账号] 账号文件：${accountsFile()}（0600，含明文口令；加人 / 改角色就改它，改完重启后端）`);
  }

  for (const notice of state.notices) lines.push(`[账号] 注意：${notice}`);
  return lines.join("\n");
}
