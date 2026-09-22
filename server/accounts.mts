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
 *
 * ## 写账号表（后台「账号」页，见文末"写操作"那一节）
 *
 * 这一段（`createAccount` / `updateAccount` / `deleteAccount`）是给**技术管理员的后台页面**用的：
 * 加人、改角色、绑教师、重置口令、停用、删除都在那里做，不必再手工编辑这个文件
 * （手工编辑仍然是**备用**做法：那需要重启后端，而这里改完**立刻生效**）。
 *
 * 三条不能破的性质（下面的代码与 `scripts/check-auth.mts` 的 [10] 节一起盯着它）：
 *   1. **写盘保留原样**：落盘写的是**原始条目**，只有被改的那一条变，其余条目一个字节都不动
 *      （账号表是人手维护的，有人会顺手加个 `"phone"`、调一下字段顺序；按规范化结果整份重写会抹掉）；
 *   2. **写完立刻生效**：落盘成功之后**清掉内存缓存**，下一次登录会重新读文件 ——
 *      新账号马上能登，不需要重启后端；
 *   3. **只读钩子下拒写**：`NEXGENEDU_ACCOUNTS_JSON` 有值时整表只读、不落盘，
 *      写操作一律拒绝并说明原因（那是自检/验收用的钩子，改了也不会生效）。
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
  /**
   * **停用**：这条账号还在表里（历史/日志都留着），但**不许再登录**。
   *
   * 为什么要有它（而不是"不用了就删掉"）：机构里的人会离职、会换岗，
   * 而删掉一条账号之后，操作日志里那些"某人改了什么"就再也对不上人了 ——
   * "不带课了"和"这个人从系统里消失"是两件事。停用 = 关门但不抹痕迹。
   *
   * 判定刻意**只认布尔 `true`**：手写账号表时把 `"disabled": "yes"` 写错了格式，
   * 结果是"停用没生效"（那个人还能登进来，一眼能看出来），而不是"莫名其妙登不进去"
   * （那种故障很难查，而且会把一位还在上班的老师挡在门外）。
   */
  disabled: boolean;
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

/**
 * 一条原始条目里的 `username` / `password`；不是对象、或缺其中一个 → `null`（"这条不算数"）。
 *
 * 单独抽出来是为了**只有一份**"算不算数"的判据：`toAccount`（读）与
 * `rawIdentity` 的使用者（写：按用户名在原始条目里定位那一条）必须用同一个口径，
 * 否则会出现"读的时候不算数、写的时候算数"这种自相矛盾的行为
 * （表现是"删了一条同名账号，另一个不受影响的同名条目又顶上来生效了"）。
 */
function rawIdentity(raw: unknown): { username: string; password: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const username = typeof record.username === "string" ? record.username.trim() : "";
  const password = typeof record.password === "string" ? record.password : "";
  return username === "" || password === "" ? null : { username, password };
}

/** 把一个原始条目规范成账号；缺 username/password 的按"这条不算数"处理（返回 null）。 */
function toAccount(raw: unknown): { account: Account; unknownRoles: string[] } | null {
  const identity = rawIdentity(raw);
  if (identity === null) return null;
  const record = raw as Record<string, unknown>;
  const { username, password } = identity;

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
      // 只有布尔 true 才算停用（理由见 Account.disabled 上那段注释）
      disabled: record.disabled === true,
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
function writeAccountsFile(file: string, entries: unknown[]): string | null {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    /*
     * 空格的差别要说清楚：`JSON.stringify(entries, null, 2)` + 末尾换行
     * 与**人手维护的那份文件**格式完全一致（缩进 2 空格、每条占多行）。
     * 用别的写法（单行、缩进 4 空格）不会报错，只会让每次"改一条账号"变成
     * 整份文件的 diff —— 以后再想从 git 历史或备份里看"谁动了哪一条"就没法看了。
     *
     * `mode: 0o600` 每次都要显式给：这个文件里有**明文口令**。
     * （注意 writeFileSync 的 mode 只在**新建**时生效；改权限要靠已有的 0600 保持不变 ——
     * 这个文件从第一天起就是 0600，且只放在数据目录里，不进 git。）
     */
    writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/**
 * 一条账号 → 落盘的原始条目（字段顺序固定：与手写的那份长得一样，好读也好 diff）。
 *
 * `disabled` 总是写出来（哪怕 false）：账号表是给人看的，字段齐了才不用猜
 * "这条没有 disabled 是什么意思"。旧文件里没有这个字段时按"没停用"读（见 toAccount）。
 */
function accountRecord(account: Account): Record<string, unknown> {
  return {
    username: account.username,
    password: account.password,
    salt: account.salt,
    hash: account.hash,
    roles: [...account.roles],
    teacherId: account.teacherId,
    note: account.note,
    createdAt: account.createdAt,
    disabled: account.disabled,
  };
}

/**
 * 把一条账号合并回**原始条目**列表；返回新的数组（不改原数组、也不改原条目）。
 *
 * 合并规则与"同名的只认第一条"一致：找到同名的那条就**在那一条上改**，找不到就追加。
 * **其余条目一个字节都不动** —— 这是"写盘保留人手工写的字段与格式"的具体做法：
 * 整份按规范化结果重写会把别人顺手写的 `"phone"`、自定义字段、字段顺序悄悄抹掉，
 * 而账号表本来就是给人手写的（"加一个王老师"）。
 */
function mergeRawAccount(
  raw: unknown[],
  username: string,
  full: Record<string, unknown>,
): unknown[] {
  const index = raw.findIndex((item) => rawIdentity(item)?.username === username);
  if (index === -1) return [...raw, full];
  const existing = raw[index];
  const merged =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>), ...full }
      : full;
  return raw.map((item, at) => (at === index ? merged : item));
}

/**
 * 从原始条目里删掉一条账号；返回新的数组。
 *
 * **同名的那几条全删**（不只是生效的第一条）：同名的条目本来只认第一条（见 `collectAccounts`），
 * 只删第一条的后果是"删完之后第二位又冒出来顶上了" —— 一个说不清、而且很危险的行为
 * （人以为账号没了，其实还能登进来）。
 */
function removeRawAccount(raw: unknown[], username: string): unknown[] {
  return raw.filter((item) => rawIdentity(item)?.username !== username);
}

/* ── 账号表从哪来（环境变量 / 文件 / 迁移）────────────────────────────── */

type AccountsState = {
  /** 缓存键：来源变了（环境变量改了、临时目录换了）就必须重新读，不能拿旧表继续用。 */
  key: string;
  source: "环境变量" | "账号文件" | "从凭证文件迁移";
  accounts: Account[];
  /**
   * **原始条目**（没被规范化的那一份，与文件里/环境变量里的一模一样）。
   *
   * 为什么要多存这一份：写操作落盘时要"只改动的字段、其余原样保留"。
   * 规范化之后的 `Account` 里已经把缺的字段补齐了（salt / hash / teacherId / note / createdAt），
   * 拿它整份重写会把别人手工写的内容冲掉（见 `mergeRawAccount`）。
   * 表读不出来（`brokenReason !== null`）时它是空数组 —— 那种情况下**写操作一律被拒**。
   */
  raw: unknown[];
  /** 要让人看见的提醒（跳过条目、角色名不认识、口令同步…）。**绝不含口令**。 */
  notices: string[];
  /** 账号文件存在但读不出来时的原因；非 null 表示"本次谁也登录不了"。 */
  brokenReason: string | null;
};

let cache: AccountsState | null = null;

/**
 * `NEXGENEDU_ACCOUNTS_JSON` 的值（没设或只有空格 → null）。
 *
 * 单独一个函数，与 `auth.mts` 的 `credentialPasswordFromEnv` 同一个理由：
 * 这个环境变量有**两个读者**（`loadAccounts` 决定账号表从哪来、写操作决定要不要拒绝），
 * 各写一遍 `typeof … === "string" && … !== ""` 迟早会有一处漏掉某种写法（空串、只有空格），
 * 而"只读钩子下放行了写"是这里最不能出的一种错。
 */
function accountsJsonFromEnv(): string | null {
  const value = process.env.NEXGENEDU_ACCOUNTS_JSON;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

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

  return { key: `env:${json}`, source: "环境变量", accounts, raw: items, notices, brokenReason: null };
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

  /*
   * 读不出来时 `raw` 给空数组就够了：这种状态下**写操作一律被拒**（见 `tableUnavailableReason`），
   * 绝不会拿一份空表去覆盖那个坏掉的文件（那会把还能用眼睛抄回来的账号抹掉）。
   */
  const broken = (reason: string): FileRead => ({
    kind: "loaded",
    state: { key, source: "账号文件", accounts: [], raw: [], notices: [], brokenReason: reason },
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
  return { kind: "loaded", state: { key, source: "账号文件", accounts, raw: items, notices, brokenReason: null } };
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
      raw: [],
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
    disabled: false,
  };

  const notices = [
    `这是第一次启动这一版：已按凭证文件（${credentialFile()}）生成上面这条账号，` +
      `口令与原来一样；要加人就把他们写进 ${accountsFile()} 后重启后端`,
  ];
  const failed = writeAccountsFile(file, [accountRecord(account)]);
  if (failed !== null) {
    notices.push(
      `账号文件写不进去（${failed}）：本次启动能用（在内存里），但重启后会再迁移一次 —— ` +
        "如果这个目录是只读挂载，加账号时也会同样失败",
    );
  }

  return {
    key: `file:${file}`,
    source: "从凭证文件迁移",
    accounts: [account],
    // 迁移出来的这条本身就是"原始条目"（字段齐全），写盘时按它原样写
    raw: [accountRecord(account)],
    notices,
    brokenReason: null,
  };
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
): { state: AccountsState; changed: boolean; changedUsername: string } {
  const envPassword = credentialPasswordFromEnv();
  const credential = activeCredential();
  if (envPassword === null || credential === null || state.brokenReason !== null) {
    return { state, changed: false, changedUsername: "" };
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
      disabled: false,
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
      changedUsername: created.username,
    };
  }

  const existing = state.accounts[index];
  if (existing === undefined || existing.password === envPassword) {
    return { state, changed: false, changedUsername: "" };
  }

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
    changedUsername: updated.username,
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
  const envJson = accountsJsonFromEnv();
  if (envJson !== null) {
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
  let withNotes: AccountsState = {
    ...synced.state,
    notices: [...synced.state.notices, ...noteCredentialDivergence(synced.state)],
  };
  if (synced.changed && synced.changedUsername !== "") {
    const account = withNotes.accounts.find((item) => item.username === synced.changedUsername);
    if (account !== undefined) {
      /*
       * 落盘写的是**原始条目**（只有这一条被换掉，其余条目原样保留，理由见 `mergeRawAccount`）。
       * 写成功之后缓存里的 `raw` 也要跟着更新：这份缓存还会被后面的写操作用来定位条目，
       * 留着旧的那份会让"改完这条的口令，再改它的角色"把口令一起改回去（静默的错）。
       */
      const raw = mergeRawAccount(withNotes.raw, account.username, accountRecord(account));
      const failed = writeAccountsFile(file, raw);
      if (failed !== null) {
        withNotes.notices.push(`账号文件写不进去（${failed}）：本次启动按内存里这份生效，重启后又会重来`);
      } else {
        withNotes = { ...withNotes, raw };
      }
    }
  }
  cache = withNotes;
  return cache;
}

/* ── 对外接口 ─────────────────────────────────────────────────────────── */

/** 一条账号 → 给界面用的形状（**不含口令与哈希**，逐字段点名 —— 将来 Account 加了字段时要显式决定放不放出去）。 */
function toSummary(account: Account): AccountSummary {
  return {
    username: account.username,
    roles: [...account.roles],
    teacherId: account.teacherId,
    note: account.note,
    createdAt: account.createdAt,
    disabled: account.disabled,
  };
}

/** 账号一览（**给界面用**：不含口令与哈希）。 */
export function listAccounts(): AccountSummary[] {
  return loadAccounts().accounts.map(toSummary);
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
  /*
   * **停用的账号不许登录** —— 判定刻意排在"口令对不对"**之后**：
   *
   * 先说口令对不对，才能在这一步说实话（"这个账号已停用，请联系技术管理员"）。
   * 反过来先判停用，就等于对任何一个试探者说"这个账号存在，只是被停用了"
   * —— 那是把上面那条"不区分账号不存在与口令不对"的纪律从后门破掉。
   * 而现在：只有**口令正确的那个人**才会看到这句原因，他本来就知道自己有这个账号。
   * 这也正是停用功能能不能用的关键 —— 否则那位老师只会以为自己记错了口令，
   * 反复试、反复找管理员，而真正的原因（账号被停了）一个字都没有。
   */
  if (account.disabled) {
    return {
      ok: false,
      error: "这个账号已停用（口令没有问题）。请联系技术管理员确认是否需要重新启用。",
    };
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
    lines.push(
      `[账号] 账号文件：${accountsFile()}（0600，含明文口令）；` +
        "加人 / 改角色 / 重置口令用后台的「账号」页（只有技术管理员能进，改完**立刻生效**）；" +
        "手工编辑这个文件是备用做法，那种改法要重启后端才生效",
    );
  }

  for (const notice of state.notices) lines.push(`[账号] 注意：${notice}`);
  return lines.join("\n");
}

/* ── 写操作（后台「账号」页：加人 / 改角色 / 绑教师 / 重置口令 / 停用 / 删除）──────────
 *
 * ## 为什么这些函数写在这里，而不做成服务层（`lib/backend/api.ts`）的方法
 *
 * 服务层的 `api` 在**浏览器里也会跑**（没配 `NEXT_PUBLIC_API_BASE` 时它直接用
 * localStorage 实现，线上静态站与逐页验收都会走到那条路）。账号表是**服务端进程里
 * 的一个文件**，浏览器里根本没有它 —— 做成 `api.accounts.create()` 的后果是
 * 那个方法在浏览器里必然失败（或者更糟：被实现成一个假的成功），
 * 而"哪个环境下这个方法才有意义"会变成一句只有文档知道的话。
 *
 * 所以账号管理走**独立路由**（`GET/POST/PATCH/DELETE /api/accounts`，见 server/index.mts），
 * 页面直接 fetch 它们（`lib/auth/accounts.ts`）。判定与落盘都在这两个服务端文件里，
 * 浏览器里那份代码只是界面。
 *
 * ## 三条安全线（`scripts/check-auth.mts` 的 [10] 节逐条盯着）
 *
 * ① **不能把系统锁死**：账号管理只有技术管理员能做、口令又只能在这里改，
 *    所以"最后一位技术管理员"（删掉 / 改成别的角色 / 停用）必须被拒绝 —— 见 `lockoutReason`；
 * ② **不能静默改坏**：用户名非空且不重名、角色必须是 `ROLES` 里有的（不认识就**拒绝**，
 *    不像读文件那样丢掉）、口令有长度下限、`teacherId` 给了就必须真的存在（在路由那层查教师档案）；
 * ③ **绝不写坏文件**：落盘写**原始条目**（只有被改的那一条变，其余原样），0600，
 *    与手工编辑的格式一致；写完清缓存让改动**立刻生效**；只读钩子下直接拒写。
 */

/** 口令长度下限（**8 位**：写进错误文案，也写在文档里）。 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * 口令下限为什么定 8 位：校验用的是 scrypt（离线爆破很贵），真正的风险是"口令被人看到/猜中"，
 * 而机构的用法是老师之间口头交接一个口令。8 位是"不能是 1234 / 生日 / 与用户名相同"的最低门槛，
 * 又短到不会逼人写在便利贴上贴在显示器上 —— 太长会被写下来，那反而更不安全。
 */

/**
 * 写操作的结果：失败时带一个 HTTP 状态码，路由直接拿它回响应（**不让路由自己翻译**，
 * 免得"哪一步是什么错"在两层里各判一遍、两边说法不一致）。
 *
 * 状态码的取法（与老 REST 接口一致）：
 *   400 = 这次的参数/规则不允许（重名、空口令、不认识的角色、最后一位管理员…）—— 改一改再提交就行；
 *   404 = 没有这个账号；
 *   409 = 账号表本次是**只读**的（环境变量钩子），再试也没用；
 *   500 = 落盘失败（磁盘/权限）—— 这次改动**没有生效**。
 */
export type AccountWriteResult =
  | { ok: true; account: AccountSummary }
  | { ok: false; status: number; error: string };

/** 删除的结果（删掉之后没有"这条账号"可回了，所以形状不同）。 */
export type AccountDeleteResult =
  | { ok: true; username: string }
  | { ok: false; status: number; error: string };

/** 新建账号的输入：口令是**明文**，只在这里变成 salt + hash（校验用 `auth.mts` 的那一套）。 */
export type CreateAccountInput = {
  username: string;
  password: string;
  /** 原始角色数组（可能是任意字符串 —— 校验在下面，**绝不静默丢弃**）。 */
  roles: string[];
  teacherId: string;
  note: string;
};

/** 改一条账号：只改给了的字段（`undefined` = 这一项不动）。 */
export type UpdateAccountInput = {
  username: string;
  roles?: string[];
  teacherId?: string;
  /** 重置口令（长度按同一套下限校验；换了口令就一定重算 salt + hash）。 */
  password?: string;
  note?: string;
  /** 停用（true）/ 启用（false）。 */
  disabled?: boolean;
};

/**
 * 账号表现在是不是**只读**的：返回原因（只读时）或 `null`（可写）。
 *
 * 钩子本身是自检/验收用的（"造一个普通教师账号起临时服务端"），而它是**只读、不落盘**的：
 * 对它的写操作必须**明确拒绝**，绝不能"改到内存里让它看起来成功了" ——
 * 那会让自检验证的是另一份账号表（这类钩子最容易骗到人的地方）。
 */
export function accountsReadOnlyReason(): string | null {
  if (accountsJsonFromEnv() === null) return null;
  return (
    "本次是环境变量提供的只读账号表（NEXGENEDU_ACCOUNTS_JSON）：它是自检 / 验收用的钩子，" +
    "不落盘也不生效，因此这里不能改账号。" +
    `要真正加人 / 改角色，请用不带这个环境变量的那份账号表：${accountsFile()}。`
  );
}

/** 账号表本身读不出来（JSON 坏了）时的统一说法：先修好文件，再谈改账号。 */
function tableUnavailableReason(state: AccountsState): string | null {
  if (state.brokenReason === null) return null;
  return (
    `账号表读不出来（${state.brokenReason}），因此不能改账号：` +
    `请先修好或删掉 ${accountsFile()} 后重启后端（原文件没有被覆盖，内容还在）。` +
    "在这之前任何写操作都不做 —— 拿一份空表去覆盖那个坏文件，会把还能用眼睛抄回来的账号抹掉。"
  );
}

/** 角色数组 → 校验过的角色列表（不认识的角色**拒绝**，不是丢掉）。 */
function checkRoles(roles: readonly string[]): { ok: true; roles: Role[] } | { ok: false; error: string } {
  const unknown: string[] = [];
  for (const item of roles) {
    if (!ROLES.includes(item as Role) && !unknown.includes(item)) unknown.push(item);
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `不认识的角色：${unknown.join("、")}。角色只能是 ${ROLES.join("、")} 这四个（一个账号可以兼多个）。` +
        "这里刻意**报错而不是忽略**：读账号文件时会静默丢掉不认识的角色名（方向是关门：不给权限），" +
        "但在界面上静默丢掉就成了「说一套做一套」：你勾了「财务管理员」，存进去的却是别的，只能对着结果发呆。",
    };
  }
  // 按 ROLES 的顺序排：文件是给人看的，顺序稳定才好 diff（界面上也按它显示）
  const ordered = ROLES.filter((role) => roles.includes(role));
  if (ordered.length === 0) {
    return {
      ok: false,
      error: "至少要选一个角色：没有角色的账号登录之后什么都做不了（每个接口都会拒绝它）。",
    };
  }
  return { ok: true, roles: ordered };
}

/** 口令长度校验；返回错误说明或 null（通过）。口令**不去空格** —— 空格也是口令的一部分。 */
function checkPassword(password: string, label: string): string | null {
  if (password === "") return `${label}不能为空。`;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `${label}至少 ${MIN_PASSWORD_LENGTH} 位（这次给了 ${password.length} 位）：口令是这个系统唯一的门锁，短口令等于把后台交给猜到的人。`;
  }
  return null;
}

/**
 * `NEXGENEDU_ADMIN_PASSWORD` 指定的那个账号名（没设那个环境变量时是 null）。
 *
 * 有了它才能说清一件很容易让人困惑的事：**与它同名的那条账号删不掉**。
 * 理由是环境变量那条路的既有语义（见 `syncEnvPassword`）：启动时指定的口令会
 * "同步进账号表里同名的那条；**没有同名的那条就新建一条**（角色给技术管理员）"。
 * 于是把那条账号删掉之后，下一次读账号表（登录、列账号都会读）就会**把它建回来**
 * —— 表现是"我删了这个账号，刷新一下它又在了"。
 * 与其让删除看起来成功、然后莫名其妙地复活，不如在这里直接拒绝并说清怎么绕开。
 */
function envCredentialUsername(): string | null {
  if (credentialPasswordFromEnv() === null) return null;
  return activeCredential()?.username ?? null;
}

/** 还能登录的技术管理员有几个（**停用的不算**：它登不进来，救不了场）。 */
function enabledAdminCount(accounts: readonly Account[]): number {
  return accounts.filter((account) => !account.disabled && account.roles.includes("技术管理员")).length;
}

/**
 * 这次改动会不会把系统**锁死**（技术管理员账号数变成 0）。
 *
 * ## 为什么这条线必须有，而且必须有断言盯着
 *
 * 账号管理只有技术管理员能做，口令又只能在这个页面上改（或手工改文件后重启）——
 * 于是"删掉最后一位技术管理员 / 把他改成普通教师 / 把他停用"的后果是
 * **谁也进不了后台，而且没有任何界面能把它改回来**（剩下的人连这一页都看不到）。
 * 那种状态只能靠手工编辑 `accounts.json` 再重启来救，而会手工改文件的人正是
 * 刚把账号删掉的那位 —— 他手上已经没有能登录的账号了。
 *
 * ## 为什么写成一个"前后对比"而不是分别拦删除与改角色
 *
 * 因为真正要守的性质是**结果**（改完之后还有技术管理员），不是某一种操作：
 * 停用最后一位管理员同样会锁死（这是本轮新加的字段，很容易漏掉），
 * 而"给第二位加上技术管理员再删第一位"必须**允许**（不然这条线就成了没法正常换人的障碍）。
 * 所以判定写成"改动前有、改动后没有 → 拒绝"，与具体操作无关。
 *
 * 改动前就是 0（账号表被手工改坏了、或本来就没有管理员）时**不拦**：
 * 那种状态下拦掉所有写操作，等于把唯一能修它的路也堵死了。
 */
function lockoutReason(before: readonly Account[], after: readonly Account[]): string | null {
  if (enabledAdminCount(before) === 0 || enabledAdminCount(after) > 0) return null;
  return (
    "不能删掉 / 改掉 / 停用**最后一位技术管理员**：账号管理只有技术管理员能进，" +
    "而口令也只能在这里改 —— 这一步做完就没人能再进后台改账号了（等于把系统锁死，只能手工改文件再重启）。" +
    "请先给另一个账号加上「技术管理员」，再把这一位删掉 / 改角色 / 停用。"
  );
}

/**
 * 落盘 + **让内存缓存失效**；返回失败说明或 null。
 *
 * 落盘写的是**原始条目**（`state.raw`），不是规范化后的账号表：只有被改的那一条变，
 * 其余条目一个字节都不动（理由见 `mergeRawAccount`）。
 *
 * 为什么成功之后是**清缓存**（而不是把新表塞进缓存）：文件才是唯一真源，
 * "落盘了才算生效"这条纪律要能用代码说出来。清掉缓存之后，
 * 下一次 `loadAccounts()`（登录、列账号、启动日志都会调它）会**重新读文件** ——
 * 于是新账号立刻能登录，不需要重启后端；而万一写盘其实没成功（权限、磁盘满），
 * 也不会出现"内存里看着改了、重启之后又没了"那种假象。
 */
function persistAccounts(file: string, raw: unknown[]): { status: number; error: string } | null {
  const failed = writeAccountsFile(file, raw);
  if (failed !== null) {
    return {
      status: 500,
      error:
        `账号表写不进去（${failed}）：这次改动**没有生效**（登录还是按改之前那份）。` +
        `请检查 ${file} 的权限（需要 0600 可写）与磁盘空间。`,
    };
  }
  cache = null;
  return null;
}

/** 新建一条账号（用户名、口令、角色、teacherId、备注）。 */
export function createAccount(input: CreateAccountInput): AccountWriteResult {
  const readOnly = accountsReadOnlyReason();
  if (readOnly !== null) return { ok: false, status: 409, error: readOnly };

  const state = loadAccounts();
  const unavailable = tableUnavailableReason(state);
  if (unavailable !== null) return { ok: false, status: 400, error: unavailable };

  const username = input.username.trim();
  if (username === "") {
    return { ok: false, status: 400, error: "账号名必填（不能只有空格）：它既是登录名，也是日志里「谁改的」那个名字。" };
  }
  // 重名**拒绝**：同名两条的后果是"口令到底哪个生效"说不清（读账号文件时只认第一条，见 collectAccounts）
  if (state.accounts.some((account) => account.username === username)) {
    return {
      ok: false,
      status: 400,
      error: `已经有叫「${username}」的账号了（账号名是登录名，不能重名）。如果那是一位新同事，请换一个名字（例如加上姓）。`,
    };
  }
  const roles = checkRoles(input.roles);
  if (!roles.ok) return { ok: false, status: 400, error: roles.error };
  const passwordError = checkPassword(input.password, "口令");
  if (passwordError !== null) return { ok: false, status: 400, error: passwordError };

  // salt + hash 与凭证文件、老账号**同一套**（auth.mts 的 hashPassword）：另写一份会让"某些账号永远登不上"
  const salt = randomBytes(16).toString("hex");
  const account: Account = {
    username,
    password: input.password,
    salt,
    hash: hashPassword(input.password, salt),
    roles: roles.roles,
    teacherId: input.teacherId.trim(),
    note: input.note,
    createdAt: new Date().toISOString(),
    disabled: false,
  };

  // 新建不会减少管理员数，但判定照样走同一条（少一处"这条不用判"的分支，就少一个漏判的入口）
  const lockout = lockoutReason(state.accounts, [...state.accounts, account]);
  if (lockout !== null) return { ok: false, status: 400, error: lockout };

  const file = accountsFile();
  const failed = persistAccounts(file, mergeRawAccount(state.raw, username, accountRecord(account)));
  if (failed !== null) return { ok: false, ...failed };
  return reloadedAccount(username);
}

/** 改一条账号：角色 / teacherId / 备注 / 重置口令 / 停用与启用。 */
export function updateAccount(input: UpdateAccountInput): AccountWriteResult {
  const readOnly = accountsReadOnlyReason();
  if (readOnly !== null) return { ok: false, status: 409, error: readOnly };

  const state = loadAccounts();
  const unavailable = tableUnavailableReason(state);
  if (unavailable !== null) return { ok: false, status: 400, error: unavailable };

  const username = input.username.trim();
  const existing = state.accounts.find((account) => account.username === username);
  if (existing === undefined) {
    return { ok: false, status: 404, error: `账号表里没有「${username}」这个账号（可能已经被删掉了，刷新看看）。` };
  }

  if (
    input.roles === undefined &&
    input.teacherId === undefined &&
    input.note === undefined &&
    input.password === undefined &&
    input.disabled === undefined
  ) {
    return { ok: false, status: 400, error: "没有要改的字段（角色 / 绑定教师 / 备注 / 口令 / 停用，至少给一项）。" };
  }

  const next: Account = { ...existing };
  if (input.roles !== undefined) {
    const roles = checkRoles(input.roles);
    if (!roles.ok) return { ok: false, status: 400, error: roles.error };
    next.roles = roles.roles;
  }
  if (input.teacherId !== undefined) next.teacherId = input.teacherId.trim();
  if (input.note !== undefined) next.note = input.note;
  if (input.disabled !== undefined) next.disabled = input.disabled;
  if (input.password !== undefined) {
    const passwordError = checkPassword(input.password, "新口令");
    if (passwordError !== null) return { ok: false, status: 400, error: passwordError };
    /*
     * 换口令**必须重算 salt + hash**：只改明文而留着旧 hash 的后果是新口令校验不过
     * （而旧口令照样能登）—— 一个不报错、只是"改了口令却登不上"的静默故障。
     */
    const salt = randomBytes(16).toString("hex");
    next.password = input.password;
    next.salt = salt;
    next.hash = hashPassword(input.password, salt);
  }

  const lockout = lockoutReason(
    state.accounts,
    state.accounts.map((account) => (account.username === username ? next : account)),
  );
  if (lockout !== null) return { ok: false, status: 400, error: lockout };

  const file = accountsFile();
  const failed = persistAccounts(file, mergeRawAccount(state.raw, username, accountRecord(next)));
  if (failed !== null) return { ok: false, ...failed };
  return reloadedAccount(username);
}

/** 删掉一条账号（同名的那几条全删，理由见 `removeRawAccount`）。 */
export function deleteAccount(username: string): AccountDeleteResult {
  const readOnly = accountsReadOnlyReason();
  if (readOnly !== null) return { ok: false, status: 409, error: readOnly };

  const state = loadAccounts();
  const unavailable = tableUnavailableReason(state);
  if (unavailable !== null) return { ok: false, status: 400, error: unavailable };

  const wanted = username.trim();
  const existing = state.accounts.find((account) => account.username === wanted);
  if (existing === undefined) {
    return { ok: false, status: 404, error: `账号表里没有「${wanted}」这个账号（可能已经被删掉了，刷新看看）。` };
  }

  const lockout = lockoutReason(
    state.accounts,
    state.accounts.filter((account) => account.username !== wanted),
  );
  if (lockout !== null) return { ok: false, status: 400, error: lockout };

  /*
   * 与启动环境变量同名的那条账号：删了会被**自动建回来**（理由见 `envCredentialUsername`）。
   * 这里刻意排在"最后一位管理员"那条判定**之后**：如果它同时是最后一位技术管理员，
   * 该说的是更根本的那句话（不然人会以为"只要去掉环境变量就能删"，
   * 而那样做只是把锁死提前一步）。
   * 状态码用 409（当前配置下这件事做不到），与"只读账号表"同一类：
   * 它不是"你参数写错了"，重试多少次都一样 —— 得先改用别的方式启动后端。
   */
  const envUsername = envCredentialUsername();
  if (envUsername !== null && envUsername === wanted) {
    return {
      ok: false,
      status: 409,
      error:
        `「${wanted}」与启动环境变量 NEXGENEDU_ADMIN_PASSWORD 指定的账号同名，因此删不掉：` +
        "只要后端还用那个环境变量启动，账号表里没有它时就会被**自动建回来**（角色给技术管理员）。" +
        "要删它，请先**不带** NEXGENEDU_ADMIN_PASSWORD 启动后端（口令那时取自账号表 / 凭证文件），再删。",
    };
  }

  const failed = persistAccounts(accountsFile(), removeRawAccount(state.raw, wanted));
  if (failed !== null) return { ok: false, ...failed };

  // 删完再读一遍文件核对"真的没了"：只信内存里的结论而不看落盘结果，等于把写盘的失败当成功
  const after = loadAccounts();
  if (after.accounts.some((account) => account.username === wanted)) {
    return {
      ok: false,
      status: 500,
      error: `删除写盘之后账号表里仍然有「${wanted}」：这次改动不可信，请检查 ${accountsFile()} 的内容。`,
    };
  }
  return { ok: true, username: wanted };
}

/**
 * 写完之后**重新读一遍文件**，把这条账号的最新形状回给调用方。
 *
 * 刻意不拿内存里刚拼好的那份对象：回给界面的必须是**真正生效的那份**
 * （写盘之后可能被规范化、也可能被 `syncEnvPassword` 那条路改过）。
 * 读不回来就是一件必须报出来的事（说明文件里出了别的问题），而不是"当作成功"。
 */
function reloadedAccount(username: string): AccountWriteResult {
  const state = loadAccounts();
  const account = state.accounts.find((item) => item.username === username);
  if (account === undefined) {
    return {
      ok: false,
      status: 500,
      error: `写盘之后读不回「${username}」这条账号：请检查 ${accountsFile()} 的内容（这次改动不可信）。`,
    };
  }
  return { ok: true, account: toSummary(account) };
}
