/**
 * 服务端认证的自检（第 6 步）。
 *
 * ## 为什么单独一个脚本
 *
 * `check.mts` 里那一节守的是**前端**（口令不在源码里、令牌存取、没有后端就拒绝登录）；
 * 而"未登录的请求是不是真的拿不到数据"只能在**真实服务端**上验 ——
 * 那是安全边界所在，也是唯一值得较真的地方。所以这里起一个临时服务端，
 * 用真实 HTTP 请求把它当外人来打：
 *
 *   1. 未登录时 `/api/call` 必须 401（**而且不能因为 401 就把数据做出来**）；
 *   2. 老 REST 接口（路线 A 的参考实现）同样必须 401 —— 只锁新门、忘了旧窗，
 *      等于没锁；
 *   3. 错口令被拒、正确口令换到令牌；
 *   4. 令牌能读数据、能写数据；
 *   5. **操作日志里的操作人来自会话**，而不是前端说了算（前端那个 setOperator
 *      曾经因为"同步方法经代理变成 Promise"而静默失效）；
 *   6. 退出登录后**同一个令牌立刻作废**（这是"退出"这个词的全部含义）；
 *   7. 伪造的令牌一样 401；
 *   8. `/health` 公开但只回最少信息，`/api/status` 未登录不给细节。
 *
 * 用法：`npm run check:auth`
 */

import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withTempServer } from "./temp-server.mts";
import { login, prepareCredential } from "../server/auth.mts";
import { createMemoryStore } from "../lib/backend/storage.ts";
import {
  __useConnectionStoreForTesting,
  backendBase,
  isLocalBase,
  autoDetectBackend,
  looksLikeBase,
  probeBackend,
  setBackendOverride,
} from "../lib/backend/connection.ts";

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === "" ? "" : `\n      ${detail}`}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `实际: ${JSON.stringify(actual)}\n      期望: ${JSON.stringify(expected)}`);
}

type Raw = { status: number; body: Record<string, unknown> };

/** 裸 HTTP 调用：刻意不用 api/remote 那一层 —— 这里要验的是**门外**能不能进来。 */
async function raw(
  base: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<Raw> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.token === undefined || options.token === null
        ? {}
        : { authorization: `Bearer ${options.token}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
}

const call = (base: string, token: string | null, method: string, args: unknown[] = []) =>
  raw(base, "/api/call", { method: "POST", token, body: { method, args } });

/*
 * ── 凭证文件必须真的能"找回口令"（代码与文档一致的护栏）────────────────────────
 *
 * 登录页与使用手册都写着"忘了口令就去 `server/data/admin-credential.json` 看"。
 * 而最初那份实现**只存了 salt + hash**：口令打印一次之后就没地方可看了 ——
 * 文档承诺的恢复路径并不存在，后果是**真锁死**（只能删凭证重来）。
 * 这一段就是钉住"承诺必须成立"：文件里得有明文、且拿它真的能登进去。
 */
function checkCredentialFile(): void {
  const dir = mkdtempSync(path.join(tmpdir(), "nexgenedu-cred-"));
  const savedDir = process.env.NEXGENEDU_DB_DIR;
  const savedPassword = process.env.NEXGENEDU_ADMIN_PASSWORD;
  // 走"首次启动"这条路：既没有凭证文件，也没有环境变量口令
  process.env.NEXGENEDU_DB_DIR = dir;
  delete process.env.NEXGENEDU_ADMIN_PASSWORD;

  try {
    const setup = prepareCredential();
    const file = path.join(dir, "admin-credential.json");
    check("首次启动会生成凭证文件", existsSync(file));
    const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    check("凭证文件里有明文口令（否则「忘了就去看」是句空话）",
      typeof stored.password === "string" && stored.password === setup.generatedPassword,
      `文件里的 password = ${String(stored.password)}，本次生成的是 ${String(setup.generatedPassword)}`);
    check("凭证文件同时保留 hash（校验用它，不靠明文比对）",
      typeof stored.hash === "string" && stored.hash !== stored.password);

    // 用文件里那串口令真的登一次（换一个干净进程，避免复用内存里的凭证）
    const probe = mkdtempSync(path.join(tmpdir(), "nexgenedu-cred2-"));
    process.env.NEXGENEDU_DB_DIR = probe;
    writeFileSync(path.join(probe, "admin-credential.json"), JSON.stringify(stored));
    const again = prepareCredential();
    check("重启后口令保持不变（不会每次启动都换）",
      again.generatedPassword === null && again.source === "已有凭证文件");
    const result = login(setup.username, setup.generatedPassword ?? "");
    check("用文件里那串口令能登录成功", result.ok === true);

    // 旧格式（没有明文）应当被重新生成，而不是让服务带着"谁也不知道的口令"继续跑
    const legacy = mkdtempSync(path.join(tmpdir(), "nexgenedu-cred3-"));
    process.env.NEXGENEDU_DB_DIR = legacy;
    writeFileSync(
      path.join(legacy, "admin-credential.json"),
      JSON.stringify({ username: "admin", salt: "aa", hash: "bb" }),
    );
    const healed = prepareCredential();
    check("旧格式凭证会被重新生成并告知原因",
      healed.generatedPassword !== null && healed.source === "旧格式已重新生成",
      `source = ${healed.source}`);
    const healedStored = JSON.parse(
      readFileSync(path.join(legacy, "admin-credential.json"), "utf8"),
    ) as Record<string, unknown>;
    check("重新生成后文件里带上了明文", healedStored.password === healed.generatedPassword);

    /*
     * 环境变量指定的口令也必须落进文件：否则"文件里那份"与"实际生效那份"会不一致，
     * 哪天不带环境变量启动就会突然换口令（真发生过，用户当场被挡在门外）。
     */
    const envDir = mkdtempSync(path.join(tmpdir(), "nexgenedu-cred4-"));
    process.env.NEXGENEDU_DB_DIR = envDir;
    process.env.NEXGENEDU_ADMIN_PASSWORD = "由环境变量指定的口令-abc123";
    const fromEnv = prepareCredential();
    check("用环境变量启动时来源标记正确",
      fromEnv.source === "环境变量" && fromEnv.generatedPassword === null);
    const envFile = path.join(envDir, "admin-credential.json");
    check("环境变量指定的口令被同步写进凭证文件（一份真相）", existsSync(envFile));
    const envStored = JSON.parse(readFileSync(envFile, "utf8")) as Record<string, unknown>;
    check("文件里的口令就是环境变量那个",
      envStored.password === "由环境变量指定的口令-abc123",
      `文件里是 ${String(envStored.password)}`);
    check("用环境变量那个口令能登录", login("admin", "由环境变量指定的口令-abc123").ok === true);
    // 再模拟"下次不带环境变量启动"：应当仍然用同一份口令，而不是回退成别的
    delete process.env.NEXGENEDU_ADMIN_PASSWORD;
    const restart = prepareCredential();
    check("下次不带环境变量启动，口令不变",
      restart.source === "已有凭证文件" && login("admin", "由环境变量指定的口令-abc123").ok === true,
      `source = ${restart.source}`);
    rmSync(envDir, { recursive: true, force: true });

    rmSync(probe, { recursive: true, force: true });
    rmSync(legacy, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (savedDir === undefined) delete process.env.NEXGENEDU_DB_DIR;
    else process.env.NEXGENEDU_DB_DIR = savedDir;
    if (savedPassword !== undefined) process.env.NEXGENEDU_ADMIN_PASSWORD = savedPassword;
  }
}

/*
 * ── 连接模块（后端地址从哪来、以及"到底连上没有"）────────────────────────────
 *
 * 这一段守两件事，都是这一天真实踩过的坑：
 *   1. **地址优先级**：界面手动指定 > 构建期环境变量 > 没有；
 *   2. **只认自报家门的服务**：端口上跑着别的程序时，不能判成"后端连上了"。
 *      （真事：3000 上是另一个 Next 项目，人却在那个页面上反复试口令。）
 */
async function checkConnectionModule(): Promise<void> {
  const memory = createMemoryStore();
  __useConnectionStoreForTesting(memory);
  const savedEnv = process.env.NEXT_PUBLIC_API_BASE;

  try {
    delete process.env.NEXT_PUBLIC_API_BASE;
    equal("没配任何地址时 backendBase 为空", backendBase(), "");
    setBackendOverride("http://localhost:4999/");
    equal("手动指定优先（并去掉末尾斜杠）", backendBase(), "http://localhost:4999");
    process.env.NEXT_PUBLIC_API_BASE = "http://localhost:4000";
    equal("手动指定压过构建期地址", backendBase(), "http://localhost:4000".replace("4000", "4999"));
    setBackendOverride(null);
    equal("清除手动指定后回到构建期地址", backendBase(), "http://localhost:4000");

    check("本机地址识别正确", isLocalBase("http://localhost:4000") && isLocalBase("http://127.0.0.1:4000"));
    check("非本机地址识别为非本机", !isLocalBase("http://192.168.1.9:4000"));
    check("地址格式校验", looksLikeBase("http://localhost:4000") && !looksLikeBase("localhost:4000"));

    // 探一个"不是本系统"的地址：必须明确说不是，而不是算成功
    const stranger = await probeBackend("http://127.0.0.1:9");
    check("探测无响应的地址 → 失败并给出原因",
      stranger.ok === false && stranger.reason.length > 0, JSON.stringify(stranger));
  } finally {
    setBackendOverride(null);
    if (savedEnv === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
    else process.env.NEXT_PUBLIC_API_BASE = savedEnv;
  }
}

console.log("=== 服务端认证自检（真实 HTTP，未登录者一律当外人）===");
console.log("\n[0.5] 后端地址与连接判定");
await checkConnectionModule();
console.log("[0] 凭证文件（「忘了口令去哪看」这条承诺是否成立）");
checkCredentialFile();

try {
  await withTempServer(async (base, info) => {
    console.log(`服务端：${base}（临时库 ${info.dbPath}）\n`);

    console.log("[1] 未登录");
    const anonymousCall = await call(base, null, "students.list");
    equal("未登录调 /api/call 返回 401", anonymousCall.status, 401);
    // 401 的响应体不能顺手把数据带出来（怕的是"报错但仍然返回内容"这类实现）
    check("401 响应里没有数据", anonymousCall.body.result === undefined,
      JSON.stringify(anonymousCall.body).slice(0, 200));
    equal("未登录调老接口 /api/students 也 401",
      (await raw(base, "/api/students", {})).status, 401);
    equal("未登录调老写接口 /api/payments 也 401",
      (await raw(base, "/api/payments", { method: "POST", body: {} })).status, 401);
    equal("未登录看 /api/status 也 401", (await raw(base, "/api/status")).status, 401);

    /*
     * ── 跨源预检（CORS）──
     *
     * 这一段守的是一个**只有浏览器才会撞上**的坑：登录之后每个请求都带
     * `Authorization`，而浏览器会为它先发 OPTIONS 预检；服务端若没在
     * `access-control-allow-headers` 里列出 `authorization`，浏览器就拦掉请求。
     * 症状是"密码明明对、登录后却被弹回登录页"，而 Node 里的测试全都不走 CORS，
     * 一条断言都不会红。所以这里直接断言响应头。
     */
    console.log("\n[1.5] 跨源预检（浏览器进后台要靠它）");
    const preflight = await fetch(`${base}/api/session`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    const allowHeaders = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    check("预检放行 localhost 来源", preflight.status === 204,
      `HTTP ${preflight.status}`);
    check("预检允许 authorization 头（漏了它，登录后会被弹回登录页）",
      allowHeaders.includes("authorization"),
      `access-control-allow-headers = ${allowHeaders}`);
    check("预检仍允许 content-type", allowHeaders.includes("content-type"));
    const evil = await fetch(`${base}/api/session`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    check("非本机来源拿不到 CORS 放行头（浏览器即拦截）",
      evil.headers.get("access-control-allow-origin") === null,
      `allow-origin = ${String(evil.headers.get("access-control-allow-origin"))}`);

    /*
     * 自动探测必须**跳过别人的服务**：先造一个"冒充后端"的服务（端口上跑着别的程序，
     * 这一天真的发生过），再让探测在它和我们真实后端之间选 —— 必须选对的那个。
     */
    console.log("\n[1.6] 自动探测只认本系统的后端");
    const stranger = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "some-other-app", db: "whatever.db" }));
    });
    const strangerPort: number = await new Promise((resolve) => {
      stranger.listen(0, "127.0.0.1", () => {
        const address = stranger.address();
        resolve(typeof address === "object" && address !== null ? address.port : 0);
      });
    });
    try {
      const strangerBase = `http://127.0.0.1:${strangerPort}`;
      const strangerProbe = await probeBackend(strangerBase);
      check("探测到别的服务时不算连上",
        strangerProbe.ok === false && strangerProbe.reason.includes("别的服务"),
        JSON.stringify(strangerProbe));
      const found = await autoDetectBackend([strangerBase, base]);
      equal("自动探测跳过别的服务、选中本系统后端", found?.base ?? null, base);
    } finally {
      stranger.close();
    }

    console.log("\n[2] 探活是公开的，但只说最少的话");
    const health = await raw(base, "/health");
    equal("/health 公开可访问", health.status, 200);
    check("/health 不泄露表结构", health.body.counts === undefined && health.body.routes === undefined,
      JSON.stringify(health.body).slice(0, 200));
    check("/health 会说明需要登录", health.body.authRequired === true);
    check("/health 报出库文件名（自检靠它确认连的是本进程）",
      String(health.body.db ?? "").includes(info.dbPath.split("/").pop() ?? ""),
      String(health.body.db));

    console.log("\n[3] 登录");
    equal("错口令被拒（401）",
      (await raw(base, "/api/login", {
        method: "POST",
        body: { username: info.username, password: "肯定不对" },
      })).status, 401);
    equal("错账号被拒（且与错口令同一句话，不告诉试探者账号是否存在）",
      (await raw(base, "/api/login", {
        method: "POST",
        body: { username: "不存在的账号", password: info.password },
      })).body.error,
      "账号或密码不正确。");
    const badToken = await raw(base, "/api/call", {
      method: "POST", token: "deadbeef".repeat(8), body: { method: "students.list", args: [] },
    });
    equal("伪造的令牌一样 401", badToken.status, 401);

    const loggedIn = await raw(base, "/api/login", {
      method: "POST",
      body: { username: info.username, password: info.password },
    });
    equal("正确口令登录成功", loggedIn.status, 200);
    const token = String(loggedIn.body.token ?? "");
    check("登录返回了令牌", token.length >= 32, `长度 ${token.length}`);
    check("响应里不回传口令", !JSON.stringify(loggedIn.body).includes(info.password));

    console.log("\n[4] 持令牌可以正常干活");
    const session = await raw(base, "/api/session", { token });
    equal("能问到「我是谁」", session.body.username, info.username);
    equal("能读数据", (await call(base, token, "students.list")).status, 200);

    const created = await call(base, token, "students.create", [{
      name: "认证自检同学", grade: "初二", guardian: "138-0000-0000",
      status: "在读", note: "", profile: {},
    }]);
    equal("能写数据", created.status, 200);

    console.log("\n[5] 操作人由会话决定（不是前端说了算）");
    const createdId = (created.body.result as { id?: string } | undefined)?.id ?? "";
    check("新建学生成功", createdId !== "");
    const logs = await call(base, token, "logs.list", [20]);
    const rows = (logs.body.result ?? []) as Array<{ entity?: string; action?: string; operator?: string }>;
    const newest = rows.find((row) => row.entity === "学生" && row.action === "新建");
    equal("新建学生留下的日志里操作人就是登录账号", newest?.operator, info.username);

    console.log("\n[6] 退出登录");
    equal("退出成功", (await raw(base, "/api/logout", { method: "POST", token })).status, 200);
    equal("退出后同一个令牌立刻失效（401）", (await call(base, token, "students.list")).status, 401);
    equal("退出后 /api/session 也是 401", (await raw(base, "/api/session", { token })).status, 401);

    console.log("\n[7] 老接口登录后可用，且操作人同样来自会话");
    const fresh = await raw(base, "/api/login", {
      method: "POST", body: { username: info.username, password: info.password },
    });
    const freshToken = String(fresh.body.token ?? "");
    equal("重新登录后老读接口可读", (await raw(base, "/api/students", { token: freshToken })).status, 200);

    /*
     * 老接口写的是**它自己那套 SQL 表**（路线 A 的参考实现，不在页面用的数据通路上，
     * 见 docs/后端开发方案.md §5.2.2），所以它的日志要去 `/api/logs`（读 SQL 的 logs 表）
     * 里看，而不是 `logs.list`（读 kv 快照里的那份）。
     *
     * 这条断言守的是一个真 bug：`writeLog` 原来把操作人**写死成 "admin"**，
     * 于是不管谁登录，走老接口的写入都记成 admin。
     */
    /*
     * 注意：老接口读写的是**它自己那套 SQL 表**，和 /api/call 走的 kv 快照不是同一份
     * 存储（见 docs/后端开发方案.md §5.2.2）。所以这里的学生必须也用**老接口**创建 ——
     * 拿 /api/call 建出来的 id 去喂老接口，只会得到 404（我第一版就是这么写的）。
     */
    const oldStudent = await raw(base, "/api/students", {
      method: "POST",
      token: freshToken,
      body: { name: "老接口自检同学", grade: "初二", guardian: "", status: "在读", note: "" },
    });
    equal("老接口能建学生", oldStudent.status, 201);
    const oldStudentId = String((oldStudent.body as { id?: string }).id ?? "");
    await raw(base, "/api/payments", {
      method: "POST",
      token: freshToken,
      body: { studentId: oldStudentId, amount: 100, kind: "收款", method: "微信", note: "认证自检" },
    });
    const sqlLogs = await raw(base, "/api/logs?limit=20", { token: freshToken });
    const paymentLog = (sqlLogs.body as unknown as Array<{ action?: string; operator?: string }>)
      .find?.((row) => row.action === "收款");
    equal("走老接口写入的日志也带会话操作人（不是写死的 admin）", paymentLog?.operator, info.username);
  });

/*
 * ── 权限闸门（按角色拦接口）────────────────────────────────────────────────
 *
 * 起一个**带三个账号**的临时服务端（技术管理员 / 财务管理员 / 普通教师），
 * 逐条验"这个角色能不能做这件事"。这一节存在的理由：
 *   - 前端把入口藏起来**不是**权限（直接调接口就绕过去了），所以必须有一条断言
 *     证明**服务端真的拒了**；
 *   - 角色判定最容易在"读"与"写"之间出偏差（我第一版就把普通教师挡在读列表之外、
 *     却让他能报课与收款 —— 两条都反了，只有真按角色跑一遍才看得出来）。
 */
console.log("\n[8] 权限闸门：按角色拦接口");
try {
  await withTempServer(
    async (base) => {
      const asRole = async (username: string, password: string) => {
        const login = await fetch(`${base}/api/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const body = (await login.json()) as { token?: string; roles?: string[] };
        return { token: body.token ?? "", roles: body.roles ?? [] };
      };
      /** 调一次接口，返回状态码（403 = 被权限闸门拦住）。 */
      const attempt = async (token: string, method: string) => {
        const response = await fetch(`${base}/api/call`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ method, args: [] }),
        });
        return response.status;
      };

      const admin = await asRole("技术甲", "pw-admin");
      const cashier = await asRole("财务甲", "pw-cashier");
      const teacher = await asRole("教师甲", "pw-teacher");

      equal("登录响应带回角色（技术管理员）", admin.roles, ["技术管理员"]);
      equal("登录响应带回角色（普通教师）", teacher.roles, ["普通教师"]);
      const sessionResponse = await fetch(`${base}/api/session`, {
        headers: { authorization: `Bearer ${teacher.token}` },
      });
      equal("会话接口回角色（前端靠它决定显示哪些导航）",
        ((await sessionResponse.json()) as { roles?: string[] }).roles, ["普通教师"]);

      /*
       * 「能」与「不能」的判据不同，这一点要说清楚：
       *   - **403 = 被权限闸门拦住**（我们要拒的就是它）；
       *   - 200 = 正常执行；**400 = 允许了，只是我这次没传参数**（自检只验权限，不造业务数据）。
       * 因此"能"的那几条断言 `!== 403`，而不是 `=== 200` ——
       * 我第一版写成 200，于是"财务能改价"因为没传参数回了 400 而误报成失败。
       */
      equal("教师能读学生列表（读宽）", await attempt(teacher.token, "students.list"), 200);
      equal("教师能读课程列表", await attempt(teacher.token, "courses.list"), 200);
      check("教师能标记已上（教学动作）", (await attempt(teacher.token, "lessons.markCompleted")) !== 403);
      equal("教师不能新建学生（写严）", await attempt(teacher.token, "students.create"), 403);
      equal("教师不能报课（那是招生 / 财务的活）", await attempt(teacher.token, "students.enroll"), 403);
      equal("教师不能记收款", await attempt(teacher.token, "payments.record"), 403);
      equal("教师不能改价", await attempt(teacher.token, "pricing.update"), 403);
      equal("教师不能看操作日志", await attempt(teacher.token, "logs.list"), 403);
      equal("教师不能导出整库", await attempt(teacher.token, "exportDatabase"), 403);

      // 财务管理员：钱与报课能用（机构确认①），运维仍然不行
      check("财务能报课（机构确认①：财务也要能报课）",
        (await attempt(cashier.token, "students.enroll")) !== 403);
      check("财务能记收款", (await attempt(cashier.token, "payments.record")) !== 403);
      check("财务能改价", (await attempt(cashier.token, "pricing.update")) !== 403);
      equal("财务不能运维（导出 / 日志是技术管理员的）",
        await attempt(cashier.token, "logs.list"), 403);

      // 技术管理员：全权限
      equal("技术管理员能看日志", await attempt(admin.token, "logs.list"), 200);
      equal("技术管理员能导出整库", await attempt(admin.token, "exportDatabase"), 200);

      // 没登记归属的接口：**关门**（默认开放是权限最危险的那种错）
      equal("没登记归属的接口一律拒绝", await attempt(admin.token, "不存在的.method"), 403);

      // 被拒的响应里不能顺手把数据带出来，而且要说清需要什么角色
      const denied = await fetch(`${base}/api/call`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${teacher.token}` },
        body: JSON.stringify({ method: "logs.list", args: [] }),
      });
      const deniedBody = (await denied.json()) as { result?: unknown; error?: string };
      check("403 响应里没有数据", deniedBody.result === undefined,
        JSON.stringify(deniedBody).slice(0, 120));
      check("403 说清了需要什么角色", (deniedBody.error ?? "").includes("技术管理员"),
        deniedBody.error ?? "");
    },
    {
      // 只读、不落盘：临时账号表由环境变量给（临时库 → 临时目录，绝不动真实账号与凭据）
      env: {
        NEXGENEDU_ACCOUNTS_JSON: JSON.stringify([
          { username: "技术甲", password: "pw-admin", roles: ["技术管理员"] },
          { username: "财务甲", password: "pw-cashier", roles: ["财务管理员"] },
          { username: "教师甲", password: "pw-teacher", roles: ["普通教师"] },
        ]),
      },
    },
  );
} catch (cause) {
  failures += 1;
  console.error(`\n✗ 权限闸门这一节中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

} catch (cause) {
  failures += 1;
  console.error(`\n✗ 自检中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

console.log(
  failures === 0
    ? "\n=== 服务端认证自检通过 ==="
    : `\n=== 服务端认证自检失败：${failures} 项不成立（上面有细节）===`,
);
process.exit(failures === 0 ? 0 : 1);
