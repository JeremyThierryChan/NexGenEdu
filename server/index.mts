/**
 * 后端服务（开发阶段，第 3 步：只读接口）。
 *
 * 这一层只做两件事：
 *   1. 把数据库行转成页面用的 JSON 形状（camelCase、嵌套结构从 JSON 列解析回来）；
 *   2. 用最直白的路由把这几个只读接口暴露出来。
 *
 * 还没有的（下一步）：写接口（报课/收款/排课/标记已上…）、鉴权、CORS 或同源代理。
 *
 * 一个刻意的选择：**映射写在服务端，不写在 SQL 里**。用 `AS camelCase` 看着更短，
 * 但映射逻辑会散在每条查询里，将来改字段名要找十几处；集中在这里改一次就够。
 */

import {
  createServer,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import type Database from "better-sqlite3";
import {
  openDatabase,
  DB_PATH,
} from "./db.mts";
import {
  acquireDbLock,
} from "./db-lock.mts";
import {
  createSqliteStore,
  snapshotSize,
} from "./kv-store.mts";
// 伪后端的**同一份实现**：服务端只是换了一个 KeyValueStore，业务口径一行都不用重写
import {
  api,
  __appendSystemLog,
  __removeFixture,
  __useStoreForTesting,
} from "../lib/backend/api.ts";
/*
 * 版本冲突的类型：接口层要靠**类型**把它翻成 409。
 * 不按错误文字匹配是有意的（见下面 /api/call 的错误分支）——
 * 那种做法改一个字就悄悄失效，而这正是"冲突被当成参数错误"的开始。
 */
import {
  VersionConflictError,
} from "../lib/backend/concurrency.ts";
import {
  createEmptyDatabase,
} from "../lib/backend/initial.ts";
import {
  createSeedDatabase,
} from "../lib/backend/seed.ts";
import {
  currentVersion,
  migrate,
} from "./migrate.mts";
// 备份策略（每天一份 + 保留份数）只在这一处实现，见 server/backup.mts
import {
  backupDir,
  backupIfNotToday,
  backupsDisabled,
  latestBackup,
} from "./backup.mts";
// 会话认证（第 6 步）：口令与令牌都在服务端，见 server/auth.mts
import {
  activeSessionCount,
  credentialFile,
  login,
  logout,
  prepareCredential,
  tokenFromHeader,
  verifyToken,
  type Session,
} from "./auth.mts";
// 多账号与角色（第 7 步）：账号表在 server/accounts.mts（口令与角色都在服务端）
// 账号管理（加人 / 改角色 / 绑教师 / 重置口令 / 停用 / 删除）也走它 —— 见下面 /api/accounts 那一节
import {
  accountBootstrapNote,
  accountsFile,
  accountsReadOnlyReason,
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type AccountSummary,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "./accounts.mts";
// 权限的"一份数据"：**方法级判定只有这一处**（见下面的闸门 —— 服务端只调用它，不自己推）
import {
  allowedRolesForMethod,
  canAccess,
  groupOfMethod,
  HOLIDAY_ACTION_ACCESS,
  scopeForAccount,
  teacherScopeDenial,
  type Role,
  type SessionScope,
} from "../lib/auth/roles.ts";
// 接口契约：分组只用来写错误文案（"运维与审计"），判定不经过它
import {
  API_CONTRACT,
} from "../lib/backend/contract.ts";
// 复用伪后端阶段的纯函数：课时记账与剩余课时的口径只能有一份
// 金额与退费口径、请假扣课时规则：同样只复用伪后端阶段的纯函数
import {
} from "../lib/backend/finance.ts";
// 报价与课程库：口径同样只有一份（前台/后台/服务端共用）
import {
  holidayCoverage,
} from "../lib/backend/holidays.ts";
import {
  defaultHolidayYears,
  holidaysDir,
  HOLIDAY_SOURCES,
  holidayYearError,
  readAllHolidayYears,
  refreshHolidayYear,
  type HolidayRefreshOutcome,
} from "./holidays.mts";

const PORT = Number(process.env.PORT ?? 4000);

/** health 里统计的表（加表时同步加进来）。 */
/**
 * 老 REST 接口的路径形状（**已下线**，见路由里那段说明）。
 *
 * 留着它只是为了给这些路径回一句清楚的 410 与指路 —— 而不是让它们"悄悄 404"：
 * 有人（脚本、书签、旧文档）照着老路径调时，应该看到"这个接口下线了，请用 /api/call"。
 */
const LEGACY_REST_PATH =
  /^\/api\/(students|teachers|classrooms|courses|lessons|inquiries|payments|transactions|homework|assessments|logs|today|lesson-records|pricing)(\/|$)/;

const COUNTED_TABLES = [
  "students", "teachers", "classrooms", "lessons", "lesson_records", "homework_records",
  "assessments", "transactions", "payments", "courses", "logs", "inquiries", "site_content",
];



/* ── 行 → 页面形状 ──────────────────────────────────────────────────── */














/* ── 小表的按视图取数（界面高频调用，做成查询参数而不是整表拉回前端过滤）── */




/* ── 路由 ───────────────────────────────────────────────────────────── */



/** 读请求体（只接受 JSON，超过 1MB 直接拒绝）。 */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 1_000_000) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}


/**
 * 当前请求的操作人（来自会话，见 `requireAuth`）。
 *
 * 这里原来是**写死的 "admin"** —— 于是走老 REST 接口的每一次写入，日志里的操作人
 * 都是"admin"，不管登录的是谁。单用户时看不出问题，等到真有两个账号，
 * "谁改的"这条线就断了，而且断得毫无提示。
 *
 * 用模块级变量是刻意的取舍（与 `api.ts` 的 `operatorName` 一致）：本系统定位是
 * 单用户本机使用，一个请求一个操作人足够。**多用户并发时要改成随请求一路传下去**
 * （那时它才会真的出错：A 的写入可能被记成 B 干的）。
 */







/* ── 报价配置（界面调 6 个方法：读取 / 保存 / 试算 / 教师课时费 / 导出 / 恢复）── */






/* ── 通用增删改（教师 / 教室 / 课程 / 学生 / 排课）────────────────────── */







/**
 * 允许的来源：本机开发（localhost / 127.0.0.1 的任意端口）。
 *
 * 开发期前端跑在 3000、后端跑在 4000，属跨源，浏览器会拦；
 * 只放开本机来源（而不是 `*`）：将来真放服务器上时再按域名收紧。
 */
function allowedOrigin(request: IncomingMessage): string {
  const origin = request.headers.origin ?? "";
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "";
}

let currentCors: Record<string, string> = {};

/**
 * **异常 → HTTP 响应**：只有一处翻译规则（2026-09 审计后补的）。
 *
 * ## 为什么必须只有一处
 *
 * 审计里那三条问题是同一个病：同一类失败在三条路上给出三种答复。
 *   - 坏 JSON：`/api/call` 回 **500**，`/api/accounts` 与 `/api/holidays` 回 **400**；
 *   - **服务端自己的 bug**（例如 `Cannot read properties of undefined`）被答成 **400** ——
 *     而 400 的意思是"你把参数改一改就行"，于是排障方向被带偏；
 *   - SQLite 的原文（表名、列名）直接回给前端。
 *
 * 现在统一成：
 *   - 请求体不是合法 JSON → **400**（那是客户端写错了，改一改就能成）；
 *   - 权限不足 `PermissionDenied` → **403**、版本冲突 `VersionConflictError` → **409**
 *     （这两类调用方**自己会处理**，文案原样带出去，见 `/api/call` 那一节）；
 *   - 其余一律 **500**，而且**只回一句人话 + 一个编号**：真正的错误（含堆栈）写进服务端日志，
 *     由那个编号对上。不把内部异常原文回给浏览器（局域网里任何设备都能调它）。
 */
function httpError(cause: unknown, context: string): { status: number; payload: { ok: false; error: string } } {
  if (cause instanceof SyntaxError) {
    return {
      status: 400,
      payload: { ok: false, error: `请求体不是合法 JSON：${cause.message}` },
    };
  }
  if (cause instanceof PermissionDenied) {
    return { status: 403, payload: { ok: false, error: cause.message } };
  }
  if (cause instanceof VersionConflictError) {
    return { status: 409, payload: { ok: false, error: cause.message } };
  }
  /*
   * **业务拒绝**与**代码 bug** 怎么分（这一条是实测逼出来的）：
   *
   * `api.ts` 里所有"故意拒绝"都是 `throw new Error("中文说明…")` —— 例如
   * "课时不足：某某还能排 3 节""这位学生还有 2 条收款记录…"。它们带的是
   * **给操作人看的下一步**，必须原样回给界面（回 400：改一改就能成）。
   *
   * 而代码 bug 抛出来的是 `TypeError` / `RangeError` / `ReferenceError`
   * （实测那次是 `Cannot read properties of undefined (reading 'courseName')`）——
   * 那些**不是**"你参数改一改就行"，回 400 会把排障方向带偏，而且把内部原文
   * 暴露给浏览器（局域网里任何设备都能调这个后端）。
   *
   * 因此按**错误类型**分，而不是按文案猜：这是稳定的判据。
   */
  const isBug =
    !(cause instanceof Error) ||
    cause instanceof TypeError ||
    cause instanceof RangeError ||
    cause instanceof ReferenceError;
  if (!isBug) {
    return { status: 400, payload: { ok: false, error: (cause as Error).message } };
  }
  const id = `req_${Math.random().toString(36).slice(2, 8)}`;
  // 服务端日志里留下完整原因与堆栈 —— 排障靠它，界面靠那个编号对上
  console.error(`[请求失败 ${id}] ${context}`, cause);
  return {
    status: 500,
    payload: {
      ok: false,
      error:
        `服务端处理这次请求时出错了（编号 ${id}）。请刷新这一页重试；` +
        "仍然不行就把这个编号告诉开发 —— 完整原因在后端日志里。",
    },
  };
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...currentCors });
  response.end(JSON.stringify(payload, null, 2));
}

/**
 * 鉴权闸（`/api/` 下除公开入口外一律先过它）。
 *
 * 它管**登录**这件事（令牌 → 会话）。**权限**（这个角色能不能做这件事）在下一步：
 * `/api/call` 在 `callApi` 里判，老 REST 接口在 `requireRestPermission` 里判 ——
 * 两者共用 `permissionError` 一个判定函数（理由见上面那一节的开头）。
 *
 * 返回**会话**（而不是 true/false）：角色是权限判定的输入，直接往下传，
 * 而不是存进一个模块级变量 —— 模块级变量在多账号下会串：
 * `/api/call` 要先 `await` 读请求体，这期间另一个请求可能已经把它改掉了
 * （读写体是异步的，而"当前是谁"必须是这个请求自己的）。那就成了
 * "A 的调用拿着 B 的角色过闸门"，是权限里最不该有的那种错。
 */
function requireAuth(request: IncomingMessage, response: ServerResponse): Session | null {
  const session = verifyToken(tokenFromHeader(request.headers.authorization));
  if (session === null) {
    send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
    return null;
  }
  /*
   * 按会话记操作人：**每个请求都要重设一次**，这是"前端调 setOperator 也不能冒充别人"
   * 这条性质成立的前提（见权限闸门那一节）。
   *
   * 现在只有这一个通道：服务端自己的操作（账号管理、节假日抓取）也走
   * `__appendSystemLog` → 同一份快照日志，因此"谁改的"只有一处来源。
   * （早先还有第二个模块级变量 `currentOperator` 给 SQL 日志表用，随老 REST 一起删了。）
   */
  void api.setOperator(session.username);
  /*
   * 行级范围（Phase B）也在这里按会话设一次 —— 与操作人是**同一套机制、同一处调用点**。
   *
   * 范围是"普通教师只看自己的课与自己学生的课时余额"那条限制的输入：
   * 服务层（`lib/backend/api.ts`）按它过滤返回值。它同样是模块级状态，
   * 因此也必须**每请求重设**：少了这一行，教师 B 的请求就会用上教师 A 的范围
   * （或者更糟：非教师账号的请求用上某位教师的空范围，看着像"数据全没了"）。
   *
   * 判定本身不在这里：`scopeForAccount` 在 `lib/auth/roles.ts`（"只有恰好是普通教师才限"
   * 与"没绑 teacherId 就给空范围"两条规则都写在那儿）。
   */
  void api.setScope(scopeForAccount(session.roles, session.teacherId));
  return session;
}



/**
 * 这次会话的**范围提示**（空串 = 没问题）：给"教师账号没绑 teacherId / 绑了一个
 * 不存在的教师档案"这两种情况一句人话。
 *
 * ## 为什么要单独算一次、而不是只写一句静态提示
 *
 * `scopeForAccount` 只能判"填没填"（它是纯函数，看不到库）。而机构实际最容易犯的错
 * 是**填错**：把教师姓名填进 `teacherId`、或者复制了另一个环境的 id。
 * 那种情况下范围一样是空的，但静态提示说不到点子上（他会以为"我明明填了"）。
 * 所以这里额外查一次教师档案：查不到就把 id 原样带出来，人一眼能看出填错了什么。
 *
 * 这条提示出现在**登录响应**与 `/api/session` 两处（界面在后台顶部把它显示出来）——
 * 少了它，那位老师看到的是一个空后台，而且没有任何线索指向"账号少填了一个字段"。
 */
async function scopeWarningFor(scope: SessionScope): Promise<string> {
  if (scope.kind !== "own") return "";
  if (scope.warning !== "") return scope.warning;
  const teacher = await api.teachers.get(scope.teacherId);
  if (teacher !== null) return "";
  return (
    `账号绑定的教师档案找不到（teacherId = ${scope.teacherId}）：` +
    "这个 id 在教师档案里不存在，因此你的范围是空的，会看不到任何学生与排课。" +
    "teacherId 要填教师档案的 id（形如 t_xxxxxx，不是姓名）；" +
    "请让技术管理员在 accounts.json 里改成正确的 id，然后重启后端。"
  );
}

/* ── 账号管理（`/api/accounts`：加人 / 改角色 / 绑教师 / 重置口令 / 停用 / 删除）───────────
 *
 * ## 为什么是**四条独立路由**，而不是 `/api/call` 的方法
 *
 * 服务层的 `api`（`lib/backend/api.ts`）在**浏览器里也会跑**（没配 `NEXT_PUBLIC_API_BASE`
 * 时它直接用 localStorage 那份实现），而账号表是**服务端进程里的一个文件**。
 * 把它做成 `api.accounts.create()` 的后果有两个，都很糟：
 *   1. 界面在浏览器里根本调不通它（或者更糟：被实现成一个假的成功）；
 *   2. 它会进入 `API_CONTRACT`（自检要求"服务层每个方法都必须在契约里"），
 *      于是契约里出现一个"浏览器里没有意义、服务端才有"的方法 —— 契约就不再是
 *      "页面对服务层的形状"了。
 *
 * 所以这四条路由是**服务端自己的接口**（页面用 `lib/auth/accounts.ts` 直接 fetch），
 * 统一闸门只管"登录"这一层，角色判定由下面的 `accountsRouteDenial` 自己判一次
 * （判定数据仍然是 `lib/auth/roles.ts` 的 `canAccess`，不另写一套规则）。
 *
 * ## 口径与纪律
 *
 *   - **只有技术管理员**（与 `PAGE_ACCESS["/admin/accounts"]` 一致）：其它角色一律 403，
 *     文案与 `permissionError` 同一个形状（"你的角色…不能做这件事…这件事需要…分工见文档"）；
 *   - **绝不放出口令**：列表与写操作的响应里都没有 password / salt / hash
 *     （`listAccounts()` 给的是 `AccountSummary`），口令只在**写入时**收一次；
 *   - **参数错 400 / 没有这条 404 / 只读钩子 409 / 落盘失败 500**：判定在
 *     `server/accounts.mts` 里做，状态码跟着结果一起回来（不在这一层重新解释一遍）；
 *   - **留痕**：写成功之后记一条操作日志（`__appendSystemLog` → 与业务日志**同一份**，
 *     界面上的「操作日志」页就能看到），操作人来自会话，**口令不进日志**；
 *   - 每条路由都要过统一闸门（未登录 401）—— 这一段在 `createServer` 里排在闸门**之后**。
 */

/** 账号管理允许的角色（**只有一处**：与 `lib/auth/roles.ts` 的 `PAGE_ACCESS["/admin/accounts"]` 对应）。 */
const ACCOUNTS_ROUTE_ROLES: readonly Role[] = ["技术管理员"];

/**
 * 这一次账号管理请求该不该放行：`null` = 放行；字符串 = 拒绝（403）。
 *
 * 复用 `canAccess`（"角色集合里有一个允许就允许"）与 `permissionError` 的文案形状，
 * 但**不经过** `permissionError`：它的输入是契约方法名，而账号管理刻意不是服务层方法
 * （理由见上面那一节）。两条路用的仍然是同一份角色数据。
 */
function accountsRouteDenial(roles: readonly Role[]): string | null {
  if (canAccess(roles, ACCOUNTS_ROUTE_ROLES)) return null;
  return (
    `你的角色（${roleText(roles)}）不能做这件事：账号管理。` +
    `这件事需要：${ACCOUNTS_ROUTE_ROLES.join(" 或 ")}。` +
    "分工见 docs/使用手册.md 的「谁能做什么」。"
  );
}

/** 账号管理页面要的"这份账号表能不能改"（列表与写操作的错误文案共用同一份口径）。 */
function accountTableInfo(): { readOnly: boolean; readOnlyReason: string; file: string } {
  const reason = accountsReadOnlyReason();
  return { readOnly: reason !== null, readOnlyReason: reason ?? "", file: accountsFile() };
}

/** 请求体里一个字符串字段读出来的三种结果（"没给" 与 "类型不对" 必须分开，理由见 `badField`）。 */
type FieldRead = { kind: "absent" } | { kind: "bad" } | { kind: "ok"; value: string };

function readTextField(body: Record<string, unknown>, key: string): FieldRead {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return { kind: "absent" };
  const value = body[key];
  return typeof value === "string" ? { kind: "ok", value } : { kind: "bad" };
}

function hasField(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * 字段读不出来时的 400 响应。
 *
 * 为什么把"没给"与"类型不对"分开说：类型不对（例如 `disabled: "true"`）如果当成"没给"，
 * 这一项就**悄悄没生效** —— 人以为停用了，账号照样能登进来，而且没有任何提示。
 * 这类静默失败比一句 400 难查得多。
 */
function badField(response: ServerResponse, key: string, reason: "absent" | "bad" | "shape"): void {
  const detail =
    reason === "absent"
      ? `缺少字段 ${key}。`
      : reason === "shape"
        ? `字段 ${key} 必须是字符串数组（例如 ["财务管理员", "招生老师"]）。`
        : `字段 ${key} 的类型不对。`;
  send(response, 400, { ok: false, error: detail });
}

/** 请求体里的角色数组：没给 → `undefined`（不改角色）；不是字符串数组 → `null`（400）。 */
function rolesField(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === "string") ? value : null;
}

/**
 * 账号要绑的教师档案必须**真的存在**。
 *
 * 为什么必须查：`teacherId` 填错的后果是"登录成功但什么都看不到"（空范围），
 * 而那位老师在机构现场只会看到一片空白的后台。这一条能在**建账号的时候**就拦住，
 * 比让他自己发现好得多。查的是**服务层的读接口**（`api.teachers.list()`）：
 * 这里要的是"教师档案里到底有没有这个 id"，与页面下拉用的是同一份数据。
 *
 * 空串（不绑定）是允许的 —— 那是"还没配好"而不是"配错了"，
 * 提示由 `scopeWarningFor` 那句统一的 warning 给出（与登录时的口径一致）。
 */
async function teacherIdProblem(teacherId: string): Promise<string | null> {
  const id = teacherId.trim();
  if (id === "") return null;
  const teachers = await api.teachers.list();
  if (teachers.some((teacher) => teacher.id === id)) return null;
  return (
    `绑定的教师档案不存在：${id}。` +
    "这里要填教师档案的 id（形如 t_xxxxxx，在「教师」页那条记录上），不是姓名；" +
    "确实不需要绑定就留空 —— 但普通教师账号留空的后果是登录后看不到任何数据。"
  );
}

/**
 * 改完之后给界面的一句范围提示（空串 = 没问题）。
 *
 * 与登录响应、`/api/session` **同一套判定**（`scopeForAccount` + `scopeWarningFor`）：
 * 三处各写一套的话，早晚出现"登录时说没绑 teacherId、账号页却说一切正常"这种自相矛盾。
 */
function accountScopeWarning(roles: readonly Role[], teacherId: string): Promise<string> {
  return scopeWarningFor(scopeForAccount(roles, teacherId));
}

/** 一条账号的"给界面看的一句话"（日志里用，**绝不含口令**）。 */
function accountLine(account: AccountSummary): string {
  return `${account.username}（角色：${roleText(account.roles)}${account.disabled ? "，已停用" : ""}）`;
}

/**
 * 账号管理的四条路由（**统一闸门之后**调用：登录与"这条路要不要放行"都已经过了）。
 *
 * 判定与落盘都在 `server/accounts.mts`（那里才是账号表的家），这里只做三件事：
 * 把请求体读成有类型的输入、把结果翻成 HTTP 响应、写一条操作日志。
 */
async function handleAccountsRoute(
  db: Database.Database,
  request: IncomingMessage,
  response: ServerResponse,
  session: Session,
): Promise<void> {
  /*
   * 角色闸门放在**最前面**：任何分支（包括只读的 GET）都不能在没判权限之前先做事。
   * 与 `/api/call` 那边一样，403 的响应体里不带上任何数据。
   */
  const denied = accountsRouteDenial(session.roles);
  if (denied !== null) {
    send(response, 403, { ok: false, error: denied });
    return;
  }

  const method = request.method ?? "GET";

  if (method === "GET") {
    /*
     * 列表：`listAccounts()` 给的是 `AccountSummary`（**没有 password / salt / hash**）。
     * 顺带把"这份账号表能不能改"告诉界面：来自 `NEXGENEDU_ACCOUNTS_JSON` 时整表只读，
     * 界面要把按钮禁掉并说明原因 —— 否则人会对着"点了没反应"发呆。
     */
    send(response, 200, { ok: true, accounts: listAccounts(), ...accountTableInfo() });
    return;
  }

  const body = await readBody(request);

  if (method === "POST") {
    const username = readTextField(body, "username");
    const password = readTextField(body, "password");
    if (username.kind !== "ok") return badField(response, "username", username.kind);
    if (password.kind !== "ok") return badField(response, "password", password.kind);
    const roles = rolesField(body.roles);
    if (roles === null) return badField(response, "roles", "shape");
    const teacherId = readTextField(body, "teacherId");
    if (teacherId.kind === "bad") return badField(response, "teacherId", teacherId.kind);
    const note = readTextField(body, "note");
    if (note.kind === "bad") return badField(response, "note", note.kind);

    const problem = await teacherIdProblem(teacherId.kind === "ok" ? teacherId.value : "");
    if (problem !== null) {
      send(response, 400, { ok: false, error: problem });
      return;
    }

    const input: CreateAccountInput = {
      username: username.value,
      password: password.value,
      roles: roles ?? [],
      teacherId: teacherId.kind === "ok" ? teacherId.value : "",
      note: note.kind === "ok" ? note.value : "",
    };
    const result = createAccount(input);
    if (!result.ok) {
      send(response, result.status, { ok: false, error: result.error });
      return;
    }
    const warning = await accountScopeWarning(result.account.roles, result.account.teacherId);
    // 留痕：谁在什么时候开了哪个账号、什么角色。**口令不进日志**（日志会被导出、被人翻）
    __appendSystemLog({
      entity: "账号",
      action: "新建",
      targetId: result.account.username,
      summary: `新建账号 ${accountLine(result.account)}`,
    });
    send(response, 201, {
      ok: true,
      account: result.account,
      warnings: warning === "" ? [] : [warning],
    });
    return;
  }

  if (method === "PATCH") {
    const username = readTextField(body, "username");
    if (username.kind !== "ok") return badField(response, "username", username.kind);

    // 逐字段从严读：给了的才进 patch（`undefined` 语义 = 这一项不动）
    const patch: UpdateAccountInput = { username: username.value };
    const roles = rolesField(body.roles);
    if (roles === null) return badField(response, "roles", "shape");
    if (roles !== undefined) patch.roles = roles;

    const teacherId = readTextField(body, "teacherId");
    if (teacherId.kind === "bad") return badField(response, "teacherId", teacherId.kind);
    if (teacherId.kind === "ok") patch.teacherId = teacherId.value;

    const note = readTextField(body, "note");
    if (note.kind === "bad") return badField(response, "note", note.kind);
    if (note.kind === "ok") patch.note = note.value;

    const password = readTextField(body, "password");
    if (password.kind === "bad") return badField(response, "password", password.kind);
    if (password.kind === "ok") patch.password = password.value;

    if (hasField(body, "disabled")) {
      const disabled = body.disabled;
      if (typeof disabled !== "boolean") {
        send(response, 400, {
          ok: false,
          error: "字段 disabled 必须是 JSON 布尔（true / false），不是字符串 —— 写错格式时按「没停用」处理会让人以为停了。",
        });
        return;
      }
      patch.disabled = disabled;
    }

    // 改了 teacherId 才去查教师档案（没改就不查：避免"只想改备注"也被一个旧 id 挡住）
    if (patch.teacherId !== undefined) {
      const problem = await teacherIdProblem(patch.teacherId);
      if (problem !== null) {
        send(response, 400, { ok: false, error: problem });
        return;
      }
    }

    const result = updateAccount(patch);
    if (!result.ok) {
      send(response, result.status, { ok: false, error: result.error });
      return;
    }
    const warning = await accountScopeWarning(result.account.roles, result.account.teacherId);

    /*
     * 留痕：改了哪几项。动作名取"最主要的那件事"（重置口令 / 停用 / 启用 / 修改），
     * 摘要里把各项都列出来 —— 口令**只写"重置了口令"，绝不把口令写进去**。
     * 日志是会被导出、会被人翻的东西（见「数据与备份」页）。
     */
    const changes: string[] = [];
    if (patch.roles !== undefined) changes.push(`角色：${roleText(result.account.roles)}`);
    if (patch.teacherId !== undefined) {
      changes.push(`绑定教师：${result.account.teacherId === "" ? "（不绑）" : result.account.teacherId}`);
    }
    if (patch.note !== undefined) changes.push("备注");
    if (patch.password !== undefined) changes.push("重置口令");
    if (patch.disabled !== undefined) changes.push(result.account.disabled ? "停用" : "启用");
    const action =
      patch.password !== undefined
        ? "重置口令"
        : patch.disabled !== undefined
          ? result.account.disabled
            ? "停用"
            : "启用"
          : "修改";
    __appendSystemLog({
      entity: "账号",
      action,
      targetId: result.account.username,
      summary: `修改账号 ${result.account.username}：${changes.join("；")}（当前角色：${roleText(result.account.roles)}）`,
    });
    send(response, 200, {
      ok: true,
      account: result.account,
      warnings: warning === "" ? [] : [warning],
    });
    return;
  }

  if (method === "DELETE") {
    const username = readTextField(body, "username");
    if (username.kind !== "ok") return badField(response, "username", username.kind);

    const removed = deleteAccount(username.value);
    if (!removed.ok) {
      send(response, removed.status, { ok: false, error: removed.error });
      return;
    }
    __appendSystemLog({
      entity: "账号",
      action: "删除",
      targetId: removed.username,
      summary: `删除账号 ${removed.username}（他再也登不进来；要留痕请用「停用」而不是删除）`,
    });
    send(response, 200, { ok: true, deleted: true, username: removed.username });
    return;
  }

  send(response, 405, { ok: false, error: `账号管理不支持 ${method}：可用 GET / POST / PATCH / DELETE。` });
}

const db = openDatabase();
const migration = migrate(db);
/*
 * 路线 B 的核心一步：把 api.ts 的存储换成 SQLite 支持的实现。
 * 之后 `api` 上的方法全部可用，且**与浏览器里跑的是同一套逻辑**。（数量以 `contract.ts` 为准，
 * 不在这里写死 —— 写死的数字一定会过期。）
 */
const SNAPSHOT_KEY = "nexgenedu.admin.db.v1";
const serverStore = createSqliteStore(db);

/*
 * **空库起步**。
 *
 * 伪后端的 `load()` 在存储为空时会播种示例数据（实测：空存储调用 students.list 直接返回
 * 8 条示例学生）。机构已经把库清空、也明确要删掉示例数据，所以服务端在首次启动时
 * 写一份**空快照**进去：业务表全空，只保留课程库与报价配置 —— 这正是"重新一个一个录"要的起点。
 *
 * 这份定义现在与前端**共用同一个函数**（`createEmptyDatabase`）：早期是在这里手写一遍
 * 「把示例数据的各张表设成 []」，一旦 `Database` 加了新表，这里就会漏掉一张而
 * 悄悄把示例内容带进真实库 —— 口径写两遍的代价。
 *
 * 需要示例数据做演示时，设 NEXGENEDU_ALLOW_SEED=1 即可（走 `createSeedDatabase`）。
 */
if (serverStore.read(SNAPSHOT_KEY) === null) {
  // 示例数据只能**显式**要：默认空库。写成"默认灌示例、要空的再设变量"是本末倒置 ——
  // 忘了设变量的那位，会在真实库里看到 8 位不是自己录的学生。
  const withDemoData = process.env.NEXGENEDU_ALLOW_SEED === "1";
  serverStore.write(
    SNAPSHOT_KEY,
    JSON.stringify(withDemoData ? createSeedDatabase() : createEmptyDatabase()),
  );
  console.log(
    withDemoData
      ? "已写入示例数据快照（NEXGENEDU_ALLOW_SEED=1，仅供演示，别在上面录真实数据）"
      : "已写入空快照（业务表全空，保留课程库与报价配置）",
  );
}

__useStoreForTesting(serverStore);

/* ── 节假日表（`/api/holidays`：查看；`/api/holidays/refresh`：抓取并写入）────────── */

/**
 * 能"抓取节假日数据"的角色：**只有技术管理员**。
 *
 * 判定数据在 `lib/auth/roles.ts` 的 `HOLIDAY_ACTION_ACCESS["holidays.refresh"]`，
 * 这里**不另写一份**（前端那颗按钮读的也是同一份 —— 两边不会各说一套）。
 *
 * 为什么写操作只给技术管理员：它抓的是**外部数据源**、写的是**服务端机器上的文件**，
 * 属于运维动作而不是教务动作（招生与财务每天都在用系统，但不该有人顺手把假日表换掉）。
 * 查看（GET）则登录即可 —— 招生老师排课时要看哪天是假期。
 *
 * `?? []` 不是多余的：动作名写错时解析结果必须是**空角色列表**（谁都进不来），
 * 而不是"没有限制" —— 失败方向必须是关门的那一个。
 */
const HOLIDAYS_REFRESH_ROLES: readonly Role[] = HOLIDAY_ACTION_ACCESS["holidays.refresh"] ?? [];

/**
 * 这次抓取请求该不该放行：`null` = 放行；字符串 = 拒绝（403）。
 *
 * 与 `accountsRouteDenial` 同一套做法（复用 `canAccess` 与同一句文案形状），
 * 理由也一样：节假日表**不是服务层方法**（它读写的是服务端机器上的文件、
 * 还要走网络，浏览器里那份 `api` 做不了），所以不走 `permissionError` 那条路。
 * 但"哪个角色能做"这件事仍然只由 `lib/auth/roles.ts` 的 `canAccess` 判，
 * 不在这个文件里另写一套规则。
 */
function holidaysRefreshDenial(roles: readonly Role[]): string | null {
  if (canAccess(roles, HOLIDAYS_REFRESH_ROLES)) return null;
  return (
    `你的角色（${roleText(roles)}）不能做这件事：抓取节假日数据。` +
    `这件事需要：${HOLIDAYS_REFRESH_ROLES.join(" 或 ")}。` +
    "分工见 docs/使用手册.md 的「谁能做什么」。"
  );
}

/**
 * 抓取结果给界面看的形状（`days` 不重复塞进来 —— 抓完会回一份最新的整表）。
 *
 * `status` 原样带过去，界面据此决定"显示成一条说明还是一条红色错误"：
 * `not-published`（还没公布）是**正常情形**，不该画成红的 ——
 * 每年 11 月之前它都会出现，画红了就是在训练人忽略红色。
 */
type HolidayRefreshView = {
  year: number;
  status: HolidayRefreshOutcome["status"];
  file: string;
  dayCount: number;
  error: string;
  verdict: { agree: boolean; blocking: string[]; notes: string[]; notPublished: boolean } | null;
  sources: unknown[];
};

function holidayRefreshView(outcome: HolidayRefreshOutcome): HolidayRefreshView {
  if (outcome.status === "written" || outcome.status === "checked") {
    return {
      year: outcome.year,
      status: outcome.status,
      file: outcome.file,
      dayCount: outcome.value.days.length,
      error: "",
      verdict: outcome.value.verdict,
      sources: outcome.value.sources,
    };
  }
  return {
    year: outcome.year,
    status: outcome.status,
    file: "",
    dayCount: 0,
    error: outcome.error,
    verdict: outcome.verdict,
    sources: outcome.sources,
  };
}

/** 节假日表的完整形状（GET 与 POST 都回这一份，界面只需一套渲染）。 */
function holidayTableView(): Record<string, unknown> {
  const { years, errors } = readAllHolidayYears();
  const today = new Date();
  return {
    dir: holidaysDir(),
    years,
    errors,
    coverage: holidayCoverage(
      years.map((year) => year.year),
      today,
    ),
    sources: HOLIDAY_SOURCES.map((source) => {
      const urls = source.urls(today.getFullYear());
      return {
        id: source.id,
        label: source.label,
        // 主地址（实际会用第一个成功的；界面把备选数量也说出来，见 `mirrorCount`）
        url: urls[0] ?? "",
        mirrorCount: Math.max(0, urls.length - 1),
      };
    }),
  };
}

/**
 * 后台「节假日」页的两条路由。
 *
 *   1. `GET /api/holidays` —— 读表（登录即可）。**不碰数据库、不碰网络**：
 *      它只读 `data/holidays/*.json`，因此后端断网时这一页照样打得开
 *      （这很重要：查一张已经抓下来的表不该依赖外网）。
 *   2. `POST /api/holidays/refresh` —— 抓两个来源、交叉校验、一致才写盘（技术管理员）。
 *
 * ## 为什么"抓取"不是 `/api/call` 里的一个方法
 *
 * 与账号管理同一个理由（见上面那一段）：`lib/backend/api.ts` 在**浏览器里也会跑**，
 * 在那里放一个"抓外网并写服务端文件"的方法，要么在浏览器里必然失败，
 * 要么被实现成一个假的成功 —— 而契约自检要求服务层每个方法都在契约里，
 * 于是契约里会出现一个"只有服务端才有意义"的方法。
 *
 * ## 返回值的一处刻意的取舍
 *
 * 抓取**总是回 200**（只要请求本身合法），每个年份的成败写在 `results` 里。
 * 理由：`ok: false` 在这套接口里表示"这次调用本身不成"（参数错、没权限、服务端炸了），
 * 而"2027 年的安排还没公布，所以这一年的数据抓不到"**不是错误**，是正常结果 ——
 * 用 4xx/5xx 表示它，界面就只能显示一句红色错误，而人真正需要看到的是
 * "哪一年缺、为什么缺"。参数写错仍然回 400（那是客户端把请求写错了）。
 */
async function handleHolidaysRoute(
  db: Database.Database,
  request: IncomingMessage,
  response: ServerResponse,
  session: Session,
  /** 这一支是干什么的：读表还是抓取。由调用方按**路径 + 方法**判定后传进来。 */
  action: "read" | "refresh",
): Promise<void> {
  if (action === "read") {
    send(response, 200, { ok: true, view: holidayTableView() });
    return;
  }

  const denial = holidaysRefreshDenial(session.roles);
  if (denial !== null) {
    send(response, 403, { ok: false, error: denial });
    return;
  }

  const body = await readBody(request);
  /*
   * 要抓哪些年：不给就抓"今年 + 明年"（`defaultHolidayYears`，与界面上那颗按钮一致）。
   * 年份逐个校验 —— 拿 `20255` 去抓会得到一个 404 页面并被当成"没有数据"，
   * 那种失败方式最误导人（看起来像"这一年还没公布"）。
   */
  /*
   * 类型写错（例如 `years: "2026"`）**一律 400**，不当成"没给"。
   * 这条纪律与账号管理里那条一模一样：把写错的字段当成缺省值，会让"我要抓 2026"
   * 悄悄变成"抓今年与明年"，而请求看起来是成功的 —— 那种失败最难查。
   */
  if (body.years !== undefined && !Array.isArray(body.years)) {
    send(response, 400, {
      ok: false,
      error: `years 必须是一个数组（收到的是 ${typeof body.years}）。`,
    });
    return;
  }
  const rawYears = Array.isArray(body.years) ? body.years : defaultHolidayYears();
  const years: number[] = [];
  for (const item of rawYears) {
    const year = typeof item === "number" ? item : Number.NaN;
    const problem = holidayYearError(year);
    if (problem !== null) {
      send(response, 400, { ok: false, error: `要抓的年份不对：${problem}` });
      return;
    }
    years.push(year);
  }
  if (years.length === 0) {
    send(response, 400, { ok: false, error: "没有指定要抓哪一年。" });
    return;
  }
  if (years.length > 12) {
    send(response, 400, { ok: false, error: `一次最多抓 12 年（给了 ${years.length} 年）。` });
    return;
  }

  const results: HolidayRefreshView[] = [];
  for (const year of years) {
    results.push(holidayRefreshView(await refreshHolidayYear(year)));
  }

  const written = results.filter((item) => item.status === "written").map((item) => item.year);
  if (written.length > 0) {
    /*
     * 写一条操作日志：这张表会影响排课与家长沟通，事后要说得清"哪一年是什么时候导进来的"。
     * 操作人由会话决定（`requireAuth` 每个请求开头调过 `api.setOperator`），
     * 因此这里不传、也传不了 —— 与 `/api/call` 的纪律一致。
     */
    __appendSystemLog({
      entity: "holidays",
      action: "刷新",
      targetId: written.join(","),
      summary: `抓取节假日并写入：${written.join("、")} 年`,
    });
  }

  send(response, 200, { ok: true, results, view: holidayTableView() });
}

/* ── 权限闸门（第 7 步：按角色拦接口）──────────────────────────────────── */

/**
 * 关于这一节的一句话总纲：**两道门的判定必须是同一套**。
 *
 * 后端对外有两个入口 —— 页面走的 `/api/call`，以及路线 A 留下的老 REST 接口
 * （`/api/students`、`/api/pricing`…）—— 而它们**读写同一份数据**。
 * 只给其中一个加权限，等于前门锁了、窗户开着。这不是假设：
 * 第 6 步加"要登录"时，第一次跑 `npm run check:auth` 就抓到了 `/api/students` 没挡
 * （新入口挡上了、老入口漏了），未登录的人照样把学生数据读走了。
 *
 * 所以做法是：**判定只有一个函数**（`permissionError`），两道门各自负责把
 * "我这是哪个接口"翻译成**方法名**，再交给它。翻译不过来的（没有登记归属）一律**拒绝**
 * —— 失败方向必须是关门。
 *
 * 而**"哪个角色能做哪个方法"这件事不在这个文件里**：它整份在 `lib/auth/roles.ts`
 * （`allowedRolesForMethod`，按"特例 → 只读宽 → 分组默认 → 没登记就关门"解析）。
 * 服务端**只调用、不复制** —— 复制一份解析逻辑就等于给自己造一个
 * "改了那边忘了这边"的机会，而权限上这种不一致等于静默放权。
 */

/**
 * 会话管道方法：不做业务、只把"当前是谁"交给服务层，因此不属于任何权限分组。
 *
 * 为什么要白名单：`setOperator` 在契约里归在"运维与审计"（它确实属于审计那一摊），
 * 可它是**每个请求开场时由服务端按会话调用**的（见 `requireAuth`）：
 * 少了它，操作日志里的操作人就会退回默认值。如果按 ops 拦，
 * 除技术管理员之外的任何人**连正常写数据都会失败** —— 而那和"他不能改数据"是两件事。
 *
 * 放行它安全吗？安全，而且理由要说清楚：操作人在**每个请求开头**都会被按会话重设一次，
 * 而一次 `/api/call` 只处理一个方法 —— 前端就算调 `setOperator("老板")`，
 * 影响的也只是它自己那一次调用，下一个请求立刻被改回会话里的那个人。
 * （这条依赖"每请求重设"，所以 `requireAuth` 里那一行不是可有可无的。）
 *
 * 白名单必须排在"查归属"**之前**：`setRoles` 这类方法在角色表里根本没登记，
 * 先查归属会把它们当成"没登记归属的接口"拒掉。
 *
 * `setScope`（Phase B 的行级范围）也是这样进来的：它不做业务、只把"这次请求按谁的
 * 范围看"交给服务层，而它在契约里归在"运维与审计"（与 `setOperator` 同一处）。
 * 放行它一样安全，而且理由更硬：范围在**每个请求开头**都会被按会话重设一次，
 * 而一次 `/api/call` 只处理一个方法 —— 前端就算调 `setScope(全放开)`，
 * 影响的也只是它自己那一次调用，下一个请求立刻被改回会话算出来的那个范围。
 */
const SESSION_PIPELINE_METHODS: ReadonlySet<string> = new Set(["setOperator", "setRoles", "setScope"]);

/**
 * 分组 id → 分组的中文名（"运维与审计"），**只用来写错误文案**。
 *
 * 判定**不经过它**（判定完全在 `lib/auth/roles.ts`）：这里要的只是"让被拒的人看懂
 * 这件事叫什么"，所以标题去掉"七、"这种序号。取不到标题时就退回方法名本身。
 */
const GROUP_TITLES: ReadonlyMap<string, string> = new Map(
  API_CONTRACT.map((group) => [group.id, group.title.replace(/^[一二三四五六七八九十]+、/, "")]),
);

/** 角色列表变成人话（提示里要出现"你的角色是谁"，人才知道该找谁开权限）。 */
function roleText(roles: readonly Role[]): string {
  return roles.length === 0 ? "没有角色" : roles.join("、");
}

/**
 * 这一次调用该不该放行：`null` = 放行；字符串 = 拒绝（内容是给人看的话）。
 *
 * 两道门都只经过这一个函数，因此"同一个动作从哪个门进来"不会有两套结论。
 *
 * ## 判定完全交给 `lib/auth/roles.ts`，这里**不自己推**
 *
 * 调用 `allowedRolesForMethod(method)`，按它的 `Role[] | null` 分两种：
 *   - 拿到数组 → `canAccess(会话角色, 数组)`；有一个角色被允许就放行；
 *   - 拿到 `null` → 这个方法**没登记归属** → **关门**，并在错误里写清是哪个方法。
 *
 * 为什么**不**在这里用 `GROUP_ACCESS[分组]` 自己判：`API_CONTRACT` 的分组是
 * **接口分类，不总是权限边界** —— `crud` 里既有 `students.list`（读）也有
 * `students.remove`（删）；`actions` 里既有 `students.enroll`（招生 / 财务）
 * 也有 `lessons.markCompleted`（教师的核心动作）。同一个分组里两件事归不同角色，
 * 按分组判就必然两头都错（我第一版就是这么写的：普通教师**读不了任何列表**
 * ——连自己学生的课时都看不成，而报课、收款又对他开放）。
 *
 * `roles.ts` 里现在按"**特例 → 只读宽 → 分组默认 → 没登记就关门**"逐层解析，
 * 那是**唯一一份**判定数据，而且自检盯着它。服务端只调用它 ——
 * 在这里复制一份解析逻辑，就是给自己造一个"改了那边忘了这边"的机会，
 * 而权限上这种不一致等于静默放权。
 */
function permissionError(method: string, roles: readonly Role[]): string | null {
  // ① 会话管道方法放行（理由见 SESSION_PIPELINE_METHODS 的注释）
  if (SESSION_PIPELINE_METHODS.has(method)) return null;

  /*
   * ② 没登记归属就**拒绝**，不是放行。
   *
   * 这是整节里最重要的那个默认值：新增接口时忘了登记归属，结果必须是"用不了"，
   * 而不是"所有人都能用"（连技术管理员也不行 —— 否则"未登记"会变成一句空话，
   * 而真正需要的结果是"谁都用不了，于是有人去把它登记上"）。
   * 默认开放是权限系统里最危险的那种默认值：它不报错、不留痕，
   * 只会让一个"还没想清楚归谁"的新接口对所有人敞开。
   */
  const allowed = allowedRolesForMethod(method);
  if (allowed === null || allowed.length === 0) {
    return (
      `这个接口没有登记权限归属：${method}（一律拒绝）。` +
      "请在 lib/auth/roles.ts 里给它定角色 —— 方法级的 METHOD_ACCESS，或它所属分组的 GROUP_ACCESS。"
    );
  }

  // ③ 角色判定：角色集合里只要有一个被允许就放行（一个账号可兼任多个角色）
  if (!canAccess(roles, allowed)) {
    const group = groupOfMethod(method);
    const title = (group === null ? undefined : GROUP_TITLES.get(group)) ?? method;
    return (
      `你的角色（${roleText(roles)}）不能做这件事：${title}。` +
      `这件事需要：${allowed.join(" 或 ")}。` +
      "分工见 docs/使用手册.md 的「谁能做什么」。"
    );
  }

  /*
   * ④ 行级范围（Phase B）：角色放行之后，再判"普通教师这一次能不能调"。
   *
   * 判定完全在 `lib/auth/roles.ts`（`teacherScopeDenial`）：没登记范围处理的方法一律拒绝；
   * 标了 `hidden` 的整块业务（钱 / 待跟进 / 排课 / 课程库写入）也拒绝；
   * 其余放行 —— **放行之后由服务层按范围过滤返回值**（那是 ⑤，在 `lib/backend/api.ts`）。
   *
   * 这里**不复制**任何规则：复制一份解析逻辑就是给自己造一个"改了那边忘了这边"的机会，
   * 而权限上这种不一致等于静默放权。
   *
   * 为什么排在第 ③ 步之后：角色已经不让教师做的事（报课、收款、日志…）会先被角色的 403
   * 拦掉，两条信息不该互相盖住 —— "这件事需要财务管理员"比"这件事不归普通教师"
   * 更能告诉人该找谁。
   */
  return teacherScopeDenial(method, roles);
}








/** 还原远端代理显式标记的 Date（`{ __date: ISO }`），其余参数原样。 */
function decodeArg(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeArg);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.__date === "string") return new Date(record.__date);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decodeArg(item);
    return out;
  }
  return value;
}

/** 权限不足（与"参数不对"分开：接口层按它回 403，而不是 400）。 */
class PermissionDenied extends Error {}

/**
 * 通用分发：按 `api` 的真实形状逐级查表调用。
 *
 * 用「方法名 + 参数数组」而不是逐个写 REST 路由，是为了**不重复描述一遍接口**：
 * 契约已经在 contract.ts / docs/后台API约定.md 里，这里是机器照做。
 *
 * 第 7 步起，**权限闸门就在这里**（这个函数最前面）。为什么选这个位置：
 * 它是 `/api/call` 唯一的进门函数，任何"查到那个函数再调用"的路径都得从这里过。
 * 如果把闸门写在路由分支里（`url.pathname === "/api/call"` 那一处），
 * 将来多一个入口就多一处"要记得加闸门"的地方 —— 而"漏加一处"正是这一节要防的事。
 *
 * 角色是从**会话**传进来的（由 `requireAuth` 校验令牌得到），不是前端传的：
 * 前端说自己是什么角色不作数。
 */
async function callApi(method: string, args: unknown[], roles: readonly Role[]): Promise<unknown> {
  const denied = permissionError(method, roles);
  if (denied !== null) throw new PermissionDenied(denied);

  const parts = method.split(".");
  let target: unknown = api;
  for (const part of parts.slice(0, -1)) {
    if (typeof target !== "object" || target === null) throw new Error(`没有这个方法：${method}`);
    target = (target as Record<string, unknown>)[part];
  }
  if (typeof target !== "object" || target === null) throw new Error(`没有这个方法：${method}`);
  const name = parts[parts.length - 1] ?? "";
  const fn = (target as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`没有这个方法：${method}`);
  return await (fn as (...a: unknown[]) => unknown).apply(target, args);
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  /*
   * 全局兜底：任何未预期的异常都要变成 500 响应，而不是让进程退出。
   * 这一条是踩出来的 —— 之前一个 SQL 表名写错，直接把整个服务打挂了（测试时报
   * ERR_EMPTY_RESPONSE / other side closed），那种故障在真机上就是"后台突然全打不开"。
   */
  currentCors = ((): Record<string, string> => {
    const origin = allowedOrigin(request);
    return origin === ""
      ? {}
      : {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          /*
           * 必须显式列出 `authorization`：登录之后**每个**请求都带它，
           * 而它是一个"非简单头"，浏览器会先发预检来问"你允许这个头吗"。
           * 漏了它的后果非常隐蔽：登录本身能成功（只用 content-type），
           * 但登录后所有请求被浏览器拦掉 → `/api/session` 拿不到 → 界面把人**弹回登录页**，
           * 看起来就像"密码不对、登不进去"。而 Node 里的自检、验收、演练都不走 CORS，
           * 所以它们**永远查不出**这个问题 —— 只有浏览器会撞上。
           * （`check:auth` 现在会直接断言这条预检响应。）
           */
          "access-control-allow-headers": "content-type, authorization",
          /*
           * 预检结果的缓存时间**刻意短**（60 秒）。
           *
           * 原先是 600（10 分钟）。教训：我们自己在预检里漏了 `authorization` 时，
           * 改成正确的**也不会立刻生效** —— 浏览器把旧的"只允许 content-type"缓存住，
           * 期间每个带令牌的请求照样被拦，症状是"密码明明对、登录后一直被弹回登录页，
           * 怎么都不好"，而且改代码、重启服务端都看不出变化（因为浏览器压根没再问）。
           * 短缓存让这类修复一分钟内自己生效；预检本身很便宜，不值得为它省请求。
           */
          "access-control-max-age": "60",
        };
  })();

  try {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  // 预检请求直接回 204（浏览器在跨源 POST + JSON 前会先问一次）
  if (request.method === "OPTIONS") {
    response.writeHead(204, currentCors);
    response.end();
    return;
  }

  /*
   * ── 认证（第 6 步）────────────────────────────────────────────────────────
   *
   * 公开的只有四个：/health（探活）、/api/login（登录）、/api/logout（退出）、
   * /api/public/site（宣传网站构站时要读的公开内容，见下方）。
   * 其余一切（/api/call 与各 REST 接口）都要令牌。
   *
   * 为什么口令搬到服务端是必须的：早期登录是纯前端的，口令硬编码在
   * lib/auth/session.ts 里，而仓库是公开的 —— 那等于没有口令。
   *
   * 顺带说清楚一道**不是**防线的防线：CORS 只放开本机来源，但 CORS 是浏览器
   * 的规矩，`curl` 根本不看它。所以"能写数据的接口"必须靠令牌，不能靠 CORS。
   */
  const bearer = tokenFromHeader(request.headers.authorization);

  if (url.pathname === "/api/login" && request.method === "POST") {
    void readBody(request)
      .then(async (body) => {
        const result = login(String(body.username ?? ""), String(body.password ?? ""));
        if (!result.ok) {
          /*
           * 失败时刻意**慢一点**：本机使用时人不该感到延迟，但暴力试探的成本会明显上升。
           * 这一条不替代强口令，只是把"随手猜几百次"变成不划算。
           */
          await new Promise((resolve) => setTimeout(resolve, 400));
          send(response, 401, { ok: false, error: result.error });
          return;
        }
        /*
         * 行级范围（Phase B）：登录时就按账号算一次范围，并把"这个范围不正常"的提示
         * 一并回给界面（`scopeWarning`，空串 = 正常）。
         *
         * 为什么在登录这里算：① 这是唯一能**同步**知道"谁刚进来"的时刻；
         * ② 提示要让人**当场**看到（教师登录后什么都没有，总得有人说清为什么）。
         * 会话里那份范围由 `requireAuth` 每个请求重算（那儿才是真正生效的地方）。
         *
         * 先设范围再查教师档案：`scopeWarningFor` 会调一次 `api.teachers.get`，
         * 而服务层的范围是**模块级状态** —— 不先设好，这一次查询就可能用上
         * 上一个请求留下的范围（那种串号正是"每请求重设"要防的事）。
         */
        const scope = scopeForAccount(result.roles, result.teacherId);
        void api.setScope(scope);
        const scopeWarning = await scopeWarningFor(scope);
        send(response, 200, {
          ok: true,
          token: result.token,
          username: result.username,
          /*
           * 角色要回给前端：界面靠它决定"显示哪些入口"（服务端那边才是真的拦）。
           * 字段名就是 `roles`，且类型是 `Role[]` —— `/api/session` 用的是同一个字段，
           * 前端两处读的是同一份东西（`lib/auth/session.ts` 的 readRoles）。
           */
          roles: result.roles,
          expiresAt: result.expiresAt,
          scopeWarning,
        });
      })
      .catch((cause: unknown) => {
        const { status, payload } = httpError(cause, `POST ${url.pathname}`);
        send(response, status, payload);
      });
    return;
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    logout(bearer);
    send(response, 200, { ok: true });
    return;
  }

  /*
   * 公开只读：宣传网站构站时取教师 / 课程 / 正文 / 报价（见 docs/技术架构.md §10.1）。
   *
   * 它必须放在**统一闸门之前** —— 构站的是 CI 或本机脚本，没有也不会去登录。
   * 返回内容由 `lib/backend/public-site.ts` 按字段白名单构造：
   * 教师电话、学生与家长信息、金额、日志都不在其中（自检有断言盯着）。
   *
   * 走的是同一个 `api.site.publicContent()`（与后台调用同一条实现），
   * 因此"网站上看到的"和"后台预览的"不可能两样。
   */
  if (url.pathname === "/api/public/site" && request.method === "GET") {
    void api.site
      .publicContent()
      .then((data) => send(response, 200, { ok: true, data }))
      .catch((cause: unknown) => {
        const { status, payload } = httpError(cause, "GET /api/public/site");
        send(response, status, payload);
      });
    return;
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const session = verifyToken(bearer);
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期。" });
      return;
    }
    /*
     * **已登录探活**：字段名必须是 `roles`、类型是 `Role[]`。
     *
     * 前端靠它决定显示哪些导航（`lib/auth/session.ts` 的 readRoles 只认
     * `lib/auth/roles.ts` 里那四个名字，认不出来就按"全角色"处理，
     * 免得"升级了服务端忘了升级前端"让后台突然变空）。
     * 它**不是**权限本身：藏起来的入口照样能被直接调接口试，
     * 真正说了算的是服务端的两道闸门。
     *
     * `scopeWarning`（Phase B）：范围不正常的账号（教师账号没绑 / 绑错了 teacherId）
     * 在这里也回一句人话，界面把它显示在后台顶部 —— 否则那位老师看到的是一个空后台，
     * 而"账号少填了一个字段"这件事没有任何地方会告诉他。
     *
     * 这一支改成异步（要查一次教师档案），因此包一层 async IIFE：响应只在其中发一次，
     * 异常也照样落成 500，不会出现"请求挂住"。
     */
    void (async () => {
      try {
        const scope = scopeForAccount(session.roles, session.teacherId);
        void api.setScope(scope);
        const scopeWarning = await scopeWarningFor(scope);
        send(response, 200, {
          ok: true,
          username: session.username,
          roles: session.roles,
          scopeWarning,
        });
      } catch (cause) {
        const { status, payload } = httpError(cause, `POST ${url.pathname}`);
        send(response, status, payload);
      }
    })();
    return;
  }

  /*
   * ── 统一闸门：/api/ 下除上面几个公开入口外，一律要登录 ──────────────────────
   *
   * 为什么放在**一处**而不是每个分支里各写一遍：逐个分支加鉴权一定会漏 ——
   * 这一版第一次跑 `npm run check:auth` 就抓到了：`/api/call` 与写的接口都挡上了，
   * 而**读接口 `/api/students` 忘了挡**，未登录直接 200 把学生数据交出去。
   * 那种漏法很隐蔽（"我明明加了鉴权"），所以改成结构性的：
   * 只要在 /api/ 下，默认就是关门状态，新加接口不需要谁记得加一行。
   *
   * 第 7 步在这条闸门后面又加了**一道**：下面那行 `requireRestPermission`
   * 管的是"这个角色能不能做这件事"。两道都要过：先证明你是谁，再证明你能做。
   */
  let session: Session | null = null;
  if (url.pathname.startsWith("/api/")) {
    session = requireAuth(request, response);
    if (session === null) return;

  }

  /*
   * ── 账号管理（加人 / 改角色 / 绑教师 / 重置口令 / 停用 / 删除）────────────────
   *
   * 排在统一闸门**之后**（未登录的 401 已经拦过，也没走老 REST 那套路径翻译），
   * 角色判定交给 `handleAccountsRoute`（只有技术管理员）—— 它不是 `/api/call` 的方法，
   * 理由写在 `handleAccountsRoute` 上面那一段。
   *
   * 它是异步的（要读请求体、要查教师档案），因此与 `/api/call` 一样用 `void … .catch` 收尾：
   * 所有异常都要变成一个响应，绝不能让请求挂在那里（那种"点了没反应"最难查）。
   */
  if (url.pathname === "/api/accounts") {
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
      return;
    }
    void handleAccountsRoute(db, request, response, session).catch((cause: unknown) => {
      // 坏 JSON → 400、权限 → 403、冲突 → 409、其余 → 500 + 编号（规则只有一处：`httpError`）
      const { status, payload } = httpError(cause, "accounts");
      send(response, status, payload);
    });
    return;
  }

  /*
   * ── 节假日表（查看 / 抓取）──────────────────────────────────────────────────
   *
   * 与账号管理同一处理由：排在统一闸门**之后**（未登录的 401 已经拦过），
   * 角色判定交给 `handleHolidaysRoute`（抓取只有技术管理员，查看登录即可）。
   * 它也是异步的（要读请求体、要走网络），因此一样用 `void … .catch` 收尾：
   * 所有异常都要变成一个响应，绝不能让请求挂在那里。
   */
  /*
   * ── 测试钩子：夹具收尾（**只在测试后端上开着**）─────────────────────────────
   *
   * 自检为了给后面的断言腾地方，经常要收尾掉"刚刚造过账"的夹具；
   * 而产品层的删除现在有护栏（有账就不许删，见 lib/backend/api.ts 的 `DeleteGuard`）——
   * 那种夹具按产品规矩本来就删不掉。
   *
   * 因此给**测试后端**开一个入口：`NEXGENEDU_TEST_HOOKS=1` 时才存在，
   * 否则一律 404（默认关，生产后端上这个路径等于不存在）。
   * 它不写操作日志、不进契约（`contract: null`），只做一件事：把一条记录摘掉。
   *
   * 为什么不做成"产品方法放行"：那等于给护栏开后门。护栏必须对所有人一致，
   * 需要绕过的只有"造夹具然后收尾"这一件事 —— 那件事只发生在测试里。
   */
  if (url.pathname === "/api/test-hooks/remove-fixture") {
    if (process.env.NEXGENEDU_TEST_HOOKS !== "1") {
      send(response, 404, {
        ok: false,
        error: "这个入口只在测试后端上存在（需要 NEXGENEDU_TEST_HOOKS=1）：它绕过删除护栏，生产环境不开。",
      });
      return;
    }
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
      return;
    }
    void readBody(request)
      .then((body) => {
        const entity = typeof body.entity === "string" ? body.entity : "";
        const id = typeof body.id === "string" ? body.id : "";
        const removed = __removeFixture(entity, id);
        send(response, 200, { ok: true, removed });
      })
      .catch((cause: unknown) => {
        const { status, payload } = httpError(cause, "POST /api/test-hooks/remove-fixture");
        send(response, status, payload);
      });
    return;
  }

  if (url.pathname === "/api/holidays" || url.pathname === "/api/holidays/refresh") {
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
      return;
    }
    /*
     * **路径与方法必须精确配对**：读表是 `GET /api/holidays`，抓取是
     * `POST /api/holidays/refresh`。
     *
     * 早先这一支只按方法分流（非 GET 就当抓取），于是 `POST /api/holidays` 在代码本意上是
     * 抄近路抓取 —— 但契约表里只登记了 `/api/holidays/refresh`，闸门先跑，它落到
     * "这个接口没有登记权限归属"的兜底上：**403 的文案叫你去改内部路由表**，
     * 而真实原因是"路径写错了"。那种误导最费时间，因此这里直接回 405 并说清该用哪个路径，
     * 同时把契约表里那条 `POST /api/holidays` 也登记上（否则走不到这里）。
     */
    const action =
      url.pathname === "/api/holidays" && request.method === "GET"
        ? "read"
        : url.pathname === "/api/holidays/refresh" && request.method === "POST"
          ? "refresh"
          : null;
    if (action === null) {
      send(response, 405, {
        ok: false,
        error:
          `节假日表只有两个入口：读表用 GET /api/holidays，抓取用 POST /api/holidays/refresh。` +
          `收到的是 ${request.method ?? "?"} ${url.pathname}。`,
      });
      return;
    }
    void handleHolidaysRoute(db, request, response, session, action).catch((cause: unknown) => {
      const { status, payload } = httpError(cause, "POST /api/holidays/refresh");
      send(response, status, payload);
    });
    return;
  }

  /** 通用调用：{ method: "students.list", args: [] }。第 5 步前端就切到这一个入口。 */
  if (url.pathname === "/api/call" && request.method === "POST") {
    /*
     * 会话在闸门那里已经校验过；这里再判一次 null 不是为了"应该不会发生"，
     * 而是为了让**权限判定永远有一个真实输入**：拿不到会话就拒绝，
     * 绝不出现"角色未知 → 当成没有限制"这种默认值。
     */
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
      return;
    }
    // 捕获成常量：下面读请求体是异步的，`session` 是 let，闭包里用它会被当成可能为 null
    const roles: readonly Role[] = session.roles;
    /*
     * 范围也在闭包里算好一份（同步算，值本身就固定了）。
     *
     * 为什么不用"闸门里已经设过的那份"：设置范围（`requireAuth`）与真正调用方法之间
     * 隔着一次 `await readBody` —— 并发时另一个请求可能已经把模块级的那份换掉了，
     * 于是 A 的请求会拿 B 的范围去过滤数据（教师之间串号）。
     * 这里在**调用前**用本请求算好的值再设一次，中间没有任何 `await`，
     * 那段窗口就不存在；而服务层各方法在**方法体第一行**把范围读进局部常量，
     * 于是"这次调用按谁的范围看"从进方法那一刻起就定死了。
     */
    const requestScope = scopeForAccount(session.roles, session.teacherId);
    void readBody(request)
      .then(async (body) => {
        /*
         * 操作人由**会话**决定，不由前端传（第 6 步顺带修掉的一处静默错误）：
         * 早期前端调 `setOperator(name)` 把操作人告诉服务层，而它是同步方法、
         * 经远端代理会静默变成 Promise —— 于是操作日志里的操作人一直是默认值。
         * 现在每次请求都按令牌所属账号设置（上面的闸门做的），前端说什么都不作数。
         */
        const method = String(body.method ?? "");
        const args = Array.isArray(body.args) ? (body.args as unknown[]) : [];
        try {
          /*
           * 调方法**之前**重设一次范围（理由见上面 `requestScope` 那段：中间隔着 `await`，
           * 模块级状态可能已经被下一个请求换掉）。赋值在下一次事件循环之前同步完成
           * （`setScope` 里没有 await），因此紧接着的调用读到的一定是这一份。
           */
          void api.setScope(requestScope);
          // 权限闸门在 callApi 里（method → roles.ts 的 allowedRolesForMethod），这里只负责把会话带过去
          const result = await callApi(method, args.map(decodeArg), roles);
          send(response, 200, { ok: true, result });
        } catch (cause) {
          /*
           * 权限不足回 **403**，与"参数写错了(400)"分开：
           * 403 是"你有身份、但这件事不归你"，排障时看一眼状态码就知道该找谁，
           * 而不是去翻请求参数。
           */
          if (cause instanceof PermissionDenied) {
            send(response, 403, { ok: false, error: cause.message });
            return;
          }
          /*
           * 版本冲突回 **409**（乐观锁，v17）。三种错误各有各的处理方式，因此不能混：
           *   - 400 参数错 → 改一改表单再提交（**大概率能成**）；
           *   - 403 权限不足 → 找管理员开权限（**再试多少次都没用**）；
           *   - 409 冲突 → 先把这条记录重新读一遍（**刷新后重提交就能成**）。
           * 把冲突混进 400 的后果很具体：前端只能显示一句"参数不对"，
           * 而人看到的是"我什么都没改错啊"，于是开始乱改表单 ——
           * 而真正该做的是刷新。文案与服务端抛出来的**原话**一致（含"刚被别人改过"），
           * 因此界面上不必再翻译一遍。
           *
           * 判定用 `instanceof` 而不是匹配错误文字：文字随时会被改得更啰嗦，
           * 而"改了文案 → 冲突悄悄退回 400"是没有任何检查会发现的那种退化。
           */
          if (cause instanceof VersionConflictError) {
            send(response, 409, { ok: false, error: cause.message });
            return;
          }
          /*
           * 剩下的交给 `httpError`：它按**错误类型**把"业务拒绝"（`Error`，回 400 并带原文）
           * 与"代码 bug"（`TypeError` 之类，回 500 + 一个编号）分开 —— 见那里的说明。
           * 早先这里一律 400 并把内部原文回给浏览器，实测过一次
           * `Cannot read properties of undefined (reading 'courseName')` 就那样漏出去了。
           */
          const { status, payload } = httpError(cause, `POST /api/call ${String(args[0] ?? "")}`);
          send(response, status, payload);
        }
      })
      .catch((cause: unknown) => {
        const { status, payload } = httpError(cause, "POST /api/call");
        send(response, status, payload);
      });
    return;
  }

  /*
   * 探活分成两个：
   *   - `/health`：**公开**，但只回最少的信息（服务名 + 库文件名）。
   *     自检与演练脚本靠它确认"起来的确实是本次这个进程"（对库文件名），
   *     所以它必须公开、必须能对出身份；
   *   - `/api/status`：**要登录**，回数据库路径、迁移、各表条数、备份状态这些细节。
   *     这些细节对运维有用，但没道理让同一个局域网里的人随便看。
   */
  if (url.pathname === "/health") {
    send(response, 200, {
      ok: true,
      service: "nexgenedu-server",
      db: DB_PATH.split("/").pop() ?? DB_PATH,
      authRequired: true,
    });
    return;
  }

  if (url.pathname === "/api/status" && request.method === "GET") {
    /*
     * 条数从**真正的数据源**（kv 快照）里数，而不是从规范化表 ——
     * 早先这里数的是那套空的规范化表：机构有 5 位教师，`/api/status` 报 `teachers: 0`，
     * 而同一时刻界面里就有 5 位（数据在快照里）。运维照着它判断"库是不是空的"会走反方向。
     *
     * 键名保持不变（`students` / `lesson_records`…）：`lib/backend/connection.ts` 逐键比对
     * 这份 counts 来决定"数据库细节有没有变"，改形状会牵动界面。
     */
    const counts: Record<string, number> = {};
    const snapshotText = serverStore.read(SNAPSHOT_KEY);
    let snapshot: Record<string, unknown> = {};
    try {
      snapshot = snapshotText === null ? {} : (JSON.parse(snapshotText) as Record<string, unknown>);
    } catch {
      snapshot = {};
    }
    /** 表名 → 快照里的字段名（快照是 camelCase，表名是 snake_case）。 */
    const SNAPSHOT_FIELDS: Record<string, string> = {
      students: "students",
      teachers: "teachers",
      classrooms: "classrooms",
      lessons: "lessons",
      lesson_records: "lessonRecords",
      homework_records: "homeworkRecords",
      assessments: "assessments",
      transactions: "transactions",
      payments: "payments",
      courses: "courses",
      logs: "logs",
      inquiries: "inquiries",
      site_content: "siteContent",
    };
    for (const table of COUNTED_TABLES) {
      const value = snapshot[SNAPSHOT_FIELDS[table] ?? table];
      counts[table] = Array.isArray(value) ? value.length : typeof value === "object" && value !== null ? 1 : 0;
    }
    send(response, 200, {
      ok: true,
      service: "nexgenedu-server",
      /*
       * `stage` 原先写死成 `read-only` —— 而同一个进程的 `/api/call` 明明接受写入
       * （审计指出：读这一行的人会以为服务是只读的）。现在如实写阶段名。
       */
      stage: "本机单用户（读写都开着）",
      db: DB_PATH,
      schemaVersion: currentVersion(db),
      migration: { from: migration.from, to: migration.to, applied: migration.applied },
      /* 老 REST 已下线，这里列的是**当前真正存在的入口**。 */
      routes: [
        "POST /api/login",
        "POST /api/logout",
        "GET  /api/session",
        "POST /api/call",
        "GET  /api/status",
        "GET  /api/public/site",
        "GET|POST|PATCH|DELETE /api/accounts",
        "GET /api/holidays",
        "POST /api/holidays/refresh",
      ],
      storage: "sqlite(kv)：与浏览器共用同一份 api.ts 实现",
      snapshotBytes: snapshotSize(db, "nexgenedu.admin.db.v1"),
      /*
       * 备份状态放进探活：备份是"出事那天才想起来检查"的东西，所以平时也要看得见。
       * 只报**最近一份**的时间与份数 —— 判断"备份是不是停了"只要这两样。
       */
      backup: backupsDisabled()
        ? { enabled: false }
        : {
            enabled: true,
            dir: backupDir(),
            latest: latestBackup()?.name ?? null,
            latestAt: latestBackup()?.at.toISOString() ?? null,
          },
      /*
       * 写入口只有两个：`/api/call`（方法级权限在 callApi 里判）与那几条独立路由。
       * 老 REST 的写接口已下线（见路由里那段说明）。
       */
      writes: ["POST /api/call", "POST|PATCH|DELETE /api/accounts", "POST /api/holidays/refresh"],
      auth: { required: true, activeSessions: activeSessionCount() },
      counts,
      time: new Date().toISOString(),
    });
    return;
  }

  /*
   * ── 老 REST 接口：**已下线**（2026-09 审计）─────────────────────────────────
   *
   * 它们（`/api/students`、`/api/payments`、`/api/pricing`…）是"路线 A"留下的参考实现：
   * 读写的是**另一套规范化表**，而界面走 `/api/call` → `lib/backend/api.ts` → `kv` 快照。
   * 于是同一个 `.db` 文件里有两套互相看不见的库，实测后果：
   *
   *   - `GET /api/students` 返回 `[]`（规范化表是空的），而界面里明明有学生；
   *   - `POST /api/students` 返回 **201**，写进"界面永远不读的那套表"；
   *   - 老的删除护栏（注释自陈"之前就是因为删档案不连带清账，留下了 18 条没有主人的收费记录"）
   *     只挂在**这条路**上，而产品走的是另一条 ⇒ 那道护栏对机构而言是装饰；
   *   - `/api/status` 报的也是这套空表的条数。
   *
   * 现在**一律 410 Gone** 并指路 `/api/call`：既不留"写进去没人读"的假成功，
   * 也不留"读到空数据"的假失败。前端从第 5 步起就只走 `/api/call`，
   * 因此对机构零影响；`scripts/check-auth.mts` 里有两个方向断言盯着它（未登录 401、登录 410）。
   */
  if (LEGACY_REST_PATH.test(url.pathname)) {
    send(response, 410, {
      ok: false,
      error:
        `这个接口已经下线：${request.method ?? "GET"} ${url.pathname}。` +
        "它属于早期的参考实现（读写的是另一套表，与界面看到的数据不相通）。" +
        "请改用统一入口 POST /api/call（{ method, args }），方法清单见 docs/后台API约定.md。",
    });
    return;
  }

  /*
   * 其余 `/api/` 路径：**明确 404**，而不是含混的 403。
   *
   * 早先这里回一句"这个接口没有登记权限归属：…请补一行"，把**路径写错**说成了权限问题 ——
   * 排障的人会去翻权限表，而真正的原因是 URL 打错了（审计里那条）。
   */
  send(response, 404, { ok: false, error: `没有这个接口：${request.method ?? "GET"} ${url.pathname}` });
  } catch (cause) {
    /*
     * 最外层兜底：`url` 在这个作用域里拿不到（它在 try 里面构造），
     * 因此只用 `request.url` 的原文当上下文 —— 日志里够定位了。
     */
    const { status, payload } = httpError(cause, `${request.method ?? "?"} ${request.url ?? ""}`);
    send(response, status, payload);
  }
});

/*
 * 绑定地址：默认**只绑本机回环**。
 *
 * 早期是 `server.listen(PORT)` —— 那会监听**所有网卡**，同一个 WiFi 下的任何设备
 * 都能连上来。对这个系统的定位（单用户、本机使用）来说，那是不必要的暴露面：
 * 局域网里的设备不受 CORS 约束（CORS 是浏览器的规矩），于是令牌成了唯一防线。
 * 真要给别的设备用，显式设 `NEXGENEDU_HOST=0.0.0.0` —— 那是一个有意识的决定。
 */
const HOST = process.env.NEXGENEDU_HOST ?? "127.0.0.1";

/**
 * ── 单写者锁：同一个库只允许一个后端进程 ────────────────────────────────────
 *
 * 放在 `listen` 之前：拿不到锁就**直接退出**，绝不让第二个进程开始对外服务 ——
 * 一旦它开始接请求，两个进程就会各写一份快照，后落盘的整体覆盖前一份（静默丢数据）。
 * 详细理由见 `server/db-lock.mts` 顶部。
 */
const dbLock = acquireDbLock(DB_PATH, `监听 ${HOST}:${PORT}`);
if (!dbLock.ok) {
  console.error(`\n[启动失败] ${dbLock.reason}\n`);
  process.exit(1);
}

/** 准备登录凭证（口令从环境变量来，或首次启动时随机生成并落到 server/data/）。 */
const credential = prepareCredential();

server.listen(PORT, HOST, () => {
  console.log(`后端已启动：http://${HOST}:${PORT}/health（状态 /api/status 需登录）`);
  console.log(`数据库：${DB_PATH}（结构版本 v${currentVersion(db)}）`);
  if (dbLock.file !== "") {
    console.log(`[独占] 已持有单写者锁 ${dbLock.file.split("/").pop()}（同一个库不允许第二个后端进程）`);
  }
  console.log(
    "接口：POST /api/call（统一入口，方法级权限在服务端判）、GET /api/status、" +
      "GET|POST|DELETE /api/accounts、GET /api/holidays、POST /api/holidays/refresh" +
      "（老 REST 接口已下线：调用它们会得到 410 与指路，见使用手册 §15.6）",
  );
  /*
   * 凭证的来历必须说清楚：口令是"新生成"的时候**只打印这一次**。
   * 同时把文件位置说出来 —— 打印刷过去之后那里还能找回来（否则只能删库重来）。
   */
  console.log(`[登录] 账号：${credential.username}（口令来源：${credential.source}）`);
  if (credential.generatedPassword !== null) {
    if (credential.source === "旧格式已重新生成") {
      // 说明原因，否则用户会以为"我的口令怎么变了"（旧文件里只有哈希，本来就找不回来）
      console.log("[登录] 检测到旧格式凭证文件（里面只有哈希、口令无法找回），已重新生成一份。");
    }
    console.log(`[登录] 本次新生成的口令：${credential.generatedPassword}`);
    console.log(`[登录] 已存到 ${credentialFile()}（权限 0600，含明文，忘了可以直接看里面）`);
    console.log("[登录] 也可以自己指定：NEXGENEDU_ADMIN_PASSWORD=... npm run server");
  } else if (credential.source === "环境变量") {
    console.log("[登录] 口令取自环境变量 NEXGENEDU_ADMIN_PASSWORD（已同步写入凭证文件，");
    console.log("        所以下次不带这个环境变量启动，用的还是同一份口令）。");
  } else {
    console.log(`[登录] 口令在 ${credentialFile()} 里（文件里有明文，忘了就看它）。`);
  }
  /*
   * 账号与角色（第 7 步）**必须**在启动日志里出现：升级成多账号之后，
   * "现在到底有几个账号、各是什么角色"是运维第一眼要看的东西
   * （比如"我明明给王老师加了账号，怎么没生效"）。
   * 这里**不打印口令**（唯一会打印口令的是上面那条"本次新生成"的凭证 ——
   * 不打印就第一次都登不进去）；账号文件的位置与提醒一并打印，
   * 因为"加人、改角色"要动的是那个文件。
   */
  for (const line of accountBootstrapNote().split("\n")) console.log(line);
  scheduleBackups();
});

/*
 * ── 自动备份 ────────────────────────────────────────────────────────────────
 *
 * 「每天一份」靠两处触发，而不是靠人记得：
 *   1. 启动时补齐 —— 昨天关机、今天开机第一件事就是把今天的份备上；
 *   2. 每小时检查一次 —— 长期开着不关的机器（本机构就是）也能跨过零点备上。
 *
 * 判定口径只有一份（`backupIfNotToday`）：写在两处的话，早晚分叉成
 * "启动按 24 小时算、定时器按自然日算"，于是出现一天两份或者隔天漏一份。
 *
 * `NEXGENEDU_NO_BACKUP=1` 关闭它 —— 自检与逐页验收用的是**临时库**，
 * 备份它们既没意义、又会把测试数据混进真实备份目录（那种文件被误恢复就是事故）。
 */
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** 做一次"今天还没备就备一份"，并把结果（含清理了哪些）打印出来。 */
function backupRound(label: string): void {
  if (backupsDisabled()) return;
  try {
    const outcome = backupIfNotToday(db);
    if (outcome === null) {
      const latest = latestBackup();
      console.log(`[备份] 今天已有备份（${latest?.name ?? "?"}），本次不重复备。`);
      return;
    }
    console.log(
      `[备份] ${label}已备份：${outcome.file}（${(outcome.bytes / 1024).toFixed(0)} KB，` +
      `现有 ${outcome.total} 份）`,
    );
    // 删掉谁必须说得出来：静默删除备份是不可接受的
    for (const name of outcome.removed) console.log(`[备份] 按保留份数清理：${name}`);
  } catch (cause) {
    // 备份失败不能拖垮服务：库里还有数据，服务继续用，但必须把原因喊出来
    console.error(
      `[备份] 失败（服务继续运行，请手工处理）：${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function scheduleBackups(): void {
  if (backupsDisabled()) {
    console.log("[备份] 已按 NEXGENEDU_NO_BACKUP=1 关闭自动备份（自检/验收用的临时库）。");
    return;
  }
  console.log(`[备份] 目录：${backupDir()}（每天一份，保留份数见 NEXGENEDU_BACKUP_KEEP）`);
  backupRound("启动时");
  // unref：这个定时器不该成为进程退不掉的钉子（演练与测试会反复起停服务）
  setInterval(() => backupRound("定时检查："), BACKUP_CHECK_INTERVAL_MS).unref();
}

/** Ctrl+C 时先关服务再关数据库，避免留下 -wal/-shm 的中间状态，并放开单写者锁。 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      dbLock.release();
      process.exit(0);
    });
  });
}

/*
 * 其它退出路径也要放锁：不然每次异常退出都留一个陈旧锁，
 * 下次启动虽然能靠"PID 已不存在"判废，但那要多绕一圈（而且日志会吓人一跳）。
 */
process.on("exit", () => dbLock.release());
