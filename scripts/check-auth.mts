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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { run, startServer, withTempServer } from "./temp-server.mts";
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

    /*
     * ── 单写者锁：同一个库不允许第二个后端进程 ──────────────────────────────
     *
     * 这条断言守的是**最坏的那种数据事故**：两个进程各持一份内存快照、各自整份落盘，
     * 后落盘的整体覆盖前一份 —— 静默丢数据，不报错、不留痕。
     * 所以第二个进程必须**启动就失败**，而不是"尽力兼容"。
     * 真实踩到过的现象：第二个进程连读快照都会读到撕裂的 JSON，所有数据接口 500。
     */
    console.log("[0.8] 单写者锁（同库第二个进程必须起不来）");
    const second = await run(
      process.execPath,
      ["--experimental-strip-types", "--import", "./server/loader.mjs", "server/index.mts"],
      {
        env: {
          NEXGENEDU_DB: info.dbPath,
          NEXGENEDU_NO_BACKUP: "1",
          NEXGENEDU_ADMIN_PASSWORD: "pw-second",
          PORT: String(info.port + 1),
        },
      },
    );
    equal("同一个库起第二个后端必须失败（退出码非 0）", second.code === 0, false);
    check("失败原因说清是「库被另一个进程占着」",
      second.output.includes("已经被另一个后端进程占着"), second.output.slice(-300));
    check("失败原因给出 PID（人知道该停哪个进程）",
      /PID \d+/.test(second.output), second.output.slice(-300));
    equal("第二个进程没有对外提供服务",
      (await fetch(`http://127.0.0.1:${info.port + 1}/health`).then(() => true).catch(() => false)), false);

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

    /*
     * ── [5.5] 乐观锁的**状态码**：冲突必须是 409，不能混进 400 ────────────────
     *
     * `check.mts` 那一节验的是"后提交的人会看到「刚被别人改过」"（两种后端都跑），
     * 但**状态码**只有在真实 HTTP 上才看得见 —— 内存实现里抛的是异常，没有状态码。
     *
     * 为什么值得单独钉一条：400 的意思是"你参数写错了"（改改表单再交就行），
     * 409 的意思是"这条记录被别人改过了"（该做的是刷新）。两者混在一起，
     * 前端就只能显示一句"参数不对"，而人看到的是"我什么都没改错啊" ——
     * 于是开始乱改表单，而真正该做的是刷新。
     *
     * 场景就是真的两个客户端：同一个版本号提交两次。
     */
    console.log("\n[5.5] 乐观锁冲突回 409（与 400 参数错分开）");
    const lockTeacher = await call(base, token, "teachers.create", [{
      name: "认证自检·乐观锁教师", subjects: [], role: "", phone: "", active: true,
      years: "", summary: "", bio: "", recommendation: "", order: 999,
      siteVisible: false, origin: "后台", kind: "教师",
    }]);
    equal("建一条用于冲突测试的教师", lockTeacher.status, 200);
    const lockId = (lockTeacher.body.result as { id?: string; version?: number } | undefined)?.id ?? "";
    const lockVersion = (lockTeacher.body.result as { version?: number } | undefined)?.version ?? 0;
    equal("新记录带来的版本是 1", lockVersion, 1);

    const firstWrite = await call(base, token, "teachers.update", [lockId, { summary: "甲写的" }, { expectedVersion: 1 }]);
    equal("第一个客户端带上版本提交：成功（200）", firstWrite.status, 200);
    equal("写入成功之后版本递增", (firstWrite.body.result as { version?: number } | undefined)?.version, 2);

    // 第二个客户端手上还是第 1 版（他打开表单时读到的）
    const secondWrite = await call(base, token, "teachers.update", [lockId, { summary: "乙写的" }, { expectedVersion: 1 }]);
    equal("第二个客户端用同一个版本提交：**409**（不是 400，也不是静默成功）", secondWrite.status, 409);
    check("409 的文案里说了「刚被别人改过」",
      String(secondWrite.body.error ?? "").includes("刚被别人改过"), String(secondWrite.body.error ?? ""));
    const afterConflict = await call(base, token, "teachers.get", [lockId]);
    equal("被拒的提交没有写进库（甲写的还在）",
      (afterConflict.body.result as { summary?: string } | undefined)?.summary, "甲写的");
    equal("被拒也不会推进版本",
      (afterConflict.body.result as { version?: number } | undefined)?.version, 2);

    // 刷新后再交就能成 —— 这才是"提示刷新"的意义
    const reloaded = await call(base, token, "teachers.get", [lockId]);
    const freshVersion = (reloaded.body.result as { version?: number } | undefined)?.version ?? 0;
    equal("刷新拿到新版本后提交：成功",
      (await call(base, token, "teachers.update", [lockId, { summary: "乙刷新后写的" }, { expectedVersion: freshVersion }])).status, 200);
    // 参数错仍然是 400（两种错误不能互相冒充）
    const anyCourse = ((await call(base, token, "courses.list")).body.result ?? []) as Array<{ id?: string }>;
    equal("参数错仍然回 400（没被冲突的 409 顶掉）",
      (await call(base, token, "courses.update", [String(anyCourse[0]?.id ?? ""), { name: "  " }])).status, 400);
    await call(base, token, "teachers.remove", [lockId]);

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

/*
 * ── 行级范围（Phase B）：普通教师只看自己的课与自己学生的课时余额 ──────────────────
 *
 * ## 为什么这一段必须在这里，而不能放进 `check.mts`
 *
 * 行级范围是**按会话**生效的：服务端在 `requireAuth` 里按账号的 `roles` + `teacherId`
 * 算出范围，再由服务层过滤返回值。`check.mts` 会跑两遍（内存 + HTTP），但两遍手上
 * 都只有**技术管理员**一个账号 —— 在 HTTP 那遍调 `api.setScope` 只影响那一次调用
 * （服务端在调方法前会按会话再设一次），所以"教师到底看到几行"在那儿验不了。
 * 判定与登记完整性放在 `check.mts`（纯函数，两端结论必须一样），**真实效果放在这里**：
 * 真起两个服务端进程、真写一份数据、真用教师账号登录、真去读别人的数据。
 *
 * ## 为什么起两个服务端
 *
 * 教师账号必须带上**真实的教师档案 id**（`teacherId`），而档案 id 是建数据时生成的
 * （`t_xxxxxx`），账号表又只在**服务端启动时**读一次。所以：
 *   ① 第一个进程（默认账号＝技术管理员）建教师 / 学生 / 报课 / 排课，读出档案 id；
 *   ② 停掉它，用**同一个库** + 一份写在环境变量里的账号表（`NEXGENEDU_ACCOUNTS_JSON`）
 *      再起一个 —— 这才验到"机构真加一条教师账号"会发生什么。
 * 顺便这条路径每次都把"账号表从环境变量来"这条路走一遍（与第 8 节同一套钩子）。
 */
console.log("\n[9] 行级范围：普通教师只看自己的课与自己学生的课时余额");
try {
  const scopeDir = mkdtempSync(path.join(tmpdir(), "nexgenedu-scope-"));
  const scopeDbPath = path.join(scopeDir, "db-scope.sqlite");

  /** 播种：失败就抛 —— 空库上跑后面那些断言会"全绿"，那是假证据。 */
  const seed = async (
    base: string,
    token: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> => {
    const response = await call(base, token, method, args);
    if (response.status !== 200) {
      throw new Error(`播种 ${method} 失败：HTTP ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.result;
  };
  /** 登录并带回 scopeWarning（行级范围的提示就靠它）。 */
  const loginAs = async (
    base: string,
    username: string,
    password: string,
  ): Promise<{ token: string; roles: string[]; scopeWarning: string }> => {
    const response = await raw(base, "/api/login", { method: "POST", body: { username, password } });
    if (response.status !== 200) {
      throw new Error(`登录失败（${username}）：HTTP ${response.status} ${JSON.stringify(response.body)}`);
    }
    return {
      token: String(response.body.token ?? ""),
      roles: (response.body.roles ?? []) as string[],
      scopeWarning: String(response.body.scopeWarning ?? ""),
    };
  };
  /** 读一次结果（断言里用得最多的一步）。 */
  const read = async (base: string, token: string, method: string, args: unknown[] = []) => {
    const response = await call(base, token, method, args);
    return { status: response.status, result: response.body.result, error: response.body.error };
  };

  const SUBJECT = "初中数学";
  const FORMS = "一对一定制课";
  /** 今天的某个整点（`today` 的口径按本地日期分组，所以固定在今天）。 */
  const todayAt = (hour: number): string => {
    const date = new Date();
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const teacherBody = (name: string, order: number) => ({
    name, subjects: [SUBJECT], role: "", phone: "", active: true, years: "",
    summary: "", bio: "", recommendation: "", order, siteVisible: false,
    origin: "后台", kind: "教师",
  });

  let teacherAId = "";
  let teacherBId = "";
  let studentAId = "";
  let studentBId = "";
  let classroomId = "";
  let lessonAId = "";
  let lessonBId = "";
  let cancelledLessonId = "";

  /* ① 第一个进程：建数据（用它自己的默认账号＝技术管理员） */
  const first = await startServer({ dbPath: scopeDbPath });
  try {
    const admin = await loginAs(first.base, first.credentials.username, first.credentials.password);
    const teacherA = (await seed(first.base, admin.token, "teachers.create", [teacherBody("范围甲老师", 1)])) as { id: string };
    const teacherB = (await seed(first.base, admin.token, "teachers.create", [teacherBody("范围乙老师", 2)])) as { id: string };
    teacherAId = teacherA.id;
    teacherBId = teacherB.id;
    const classroom = (await seed(first.base, admin.token, "classrooms.create", [
      { name: "范围测试教室", kind: "上课用教室", capacity: 8, availability: [], note: "" },
    ])) as { id: string };
    classroomId = classroom.id;

    const studentA = (await seed(first.base, admin.token, "students.create", [
      { name: "范围甲同学", grade: "初二", guardian: "138-0000-0001", status: "在读", note: "", profile: {} },
    ])) as { id: string };
    const studentB = (await seed(first.base, admin.token, "students.create", [
      { name: "范围乙同学", grade: "初二", guardian: "138-0000-0002", status: "在读", note: "", profile: {} },
    ])) as { id: string };
    studentAId = studentA.id;
    studentBId = studentB.id;

    // 报课：**带上金额**（这样"教师那份金额被剥成 0"才是可验证的，而不是本来就没有钱）
    for (const studentId of [studentAId, studentBId]) {
      await seed(first.base, admin.token, "students.enroll", [
        studentId,
        {
          subject: SUBJECT, form: FORMS, teacherId: studentId === studentAId ? teacherAId : teacherBId,
          lessons: 10, startedAt: todayAt(0), note: "", unitPrice: 200, agreedAmount: 2000,
          paidNow: 1000, method: "微信",
        },
      ]);
    }

    const lesson = (
      teacherId: string, studentId: string, hour: number, status: string,
    ) => ({
      subject: SUBJECT, form: FORMS, teacherId, classroomId, studentIds: [studentId],
      startsAt: todayAt(hour), durationMinutes: 60, status, note: "", makeupForLessonId: "",
    });
    lessonAId = ((await seed(first.base, admin.token, "lessons.create", [
      lesson(teacherAId, studentAId, 9, "已排"),
    ])) as { id: string }).id;
    lessonBId = ((await seed(first.base, admin.token, "lessons.create", [
      lesson(teacherBId, studentBId, 10, "已排"),
    ])) as { id: string }).id;
    /*
     * 第三节课：**甲老师带、但已取消、学生是乙的学生**。
     * 它专门验"自己的学生 = 我的课（排除已取消）里出现过的学生"：
     * 这节课在 甲 的课表里（是他自己的课），但它上面的学生**不该**因此变成"他的学生"。
     */
    cancelledLessonId = ((await seed(first.base, admin.token, "lessons.create", [
      lesson(teacherAId, studentBId, 11, "已取消"),
    ])) as { id: string }).id;

    equal("播种完成：技术管理员看到 2 位学生", ((await read(first.base, admin.token, "students.list")).result as unknown[]).length, 2);
    equal("播种完成：技术管理员看到 3 节课", ((await read(first.base, admin.token, "lessons.list")).result as unknown[]).length, 3);
  } finally {
    await first.stop();
  }

  /* ② 第二个进程：同一个库 + 一份真实的账号表（含各种教师账号） */
  const scopeAccounts = [
    { username: "技术甲", password: "pw-admin", roles: ["技术管理员"] },
    { username: "财务甲", password: "pw-cashier", roles: ["财务管理员"] },
    { username: "招生甲", password: "pw-enroll", roles: ["招生老师"] },
    { username: "教师甲", password: "pw-teacher-a", roles: ["普通教师"], teacherId: teacherAId },
    { username: "教师乙", password: "pw-teacher-b", roles: ["普通教师"], teacherId: teacherBId },
    // 机构确认④：一个账号可兼任多个角色 → 不受行级范围限制
    { username: "兼任甲", password: "pw-teacher-cashier", roles: ["普通教师", "财务管理员"], teacherId: teacherAId },
    // 没绑教师档案 → 登录成功但范围为空
    { username: "没绑档", password: "pw-teacher-none", roles: ["普通教师"], teacherId: "" },
    // 绑错了（填成不存在的 id）→ 同样是空范围，提示里带上那个 id
    { username: "绑错档", password: "pw-teacher-bad", roles: ["普通教师"], teacherId: "t_不存在" },
  ];

  const second = await startServer({
    dbPath: scopeDbPath,
    env: { NEXGENEDU_ACCOUNTS_JSON: JSON.stringify(scopeAccounts) },
  });
  try {
    const admin = await loginAs(second.base, "技术甲", "pw-admin");
    const teacherA = await loginAs(second.base, "教师甲", "pw-teacher-a");
    const teacherB = await loginAs(second.base, "教师乙", "pw-teacher-b");
    const dual = await loginAs(second.base, "兼任甲", "pw-teacher-cashier");
    const unbound = await loginAs(second.base, "没绑档", "pw-teacher-none");
    const wrongId = await loginAs(second.base, "绑错档", "pw-teacher-bad");
    const cashier = await loginAs(second.base, "财务甲", "pw-cashier");
    const enroller = await loginAs(second.base, "招生甲", "pw-enroll");

    console.log("\n[9.1] 登录与范围提示（scopeWarning）");
    equal("教师账号有正确的 teacherId：登录成功且没有提示", teacherA.scopeWarning, "");
    equal("技术管理员没有范围提示（不受限制）", admin.scopeWarning, "");
    check("没绑 teacherId 的教师账号**照样登录成功**（不拒绝登录——那是数据配置问题，不是身份问题）",
      unbound.token.length >= 32);
    check("没绑 teacherId 的账号拿到一句说清原因的提示（提到 teacherId）",
      unbound.scopeWarning.includes("teacherId"), unbound.scopeWarning);
    check("teacherId 填错时提示里带上那个 id（人一眼能看出填错了什么）",
      wrongId.scopeWarning.includes("t_不存在"), wrongId.scopeWarning);
    const unboundSession = await raw(second.base, "/api/session", { token: unbound.token });
    equal("会话接口也带同一句提示（界面靠它显示）",
      String(unboundSession.body.scopeWarning ?? ""), unbound.scopeWarning);
    const teacherSession = await raw(second.base, "/api/session", { token: teacherA.token });
    equal("正常教师账号的会话提示为空", String(teacherSession.body.scopeWarning ?? ""), "");

    console.log("\n[9.2] 教师只看得到自己课上的学生（且没有金额）");
    const teacherStudents = (await read(second.base, teacherA.token, "students.list")).result as Array<{
      id: string; name: string;
      enrollments: Array<{ totalLessons: number; usedLessons: number; unitPrice: number; agreedAmount: number; paidAmount: number }>;
    }>;
    equal("学生列表只剩自己课上的那一位", teacherStudents.map((item) => item.id), [studentAId]);
    check("别人的学生不在列表里（连名字都不出现）",
      !JSON.stringify(teacherStudents).includes("范围乙同学"));
    const enrollment = teacherStudents[0]?.enrollments[0];
    check("**课时余额仍然看得到**（机构确认③：家长常问「还剩几节课」）",
      enrollment !== undefined && enrollment.totalLessons - enrollment.usedLessons === 10,
      JSON.stringify(enrollment));
    check("金额字段被剥掉：单价 / 约定应缴 / 实收都是 0",
      enrollment !== undefined &&
        enrollment.unitPrice === 0 && enrollment.agreedAmount === 0 && enrollment.paidAmount === 0,
      JSON.stringify(enrollment));
    const adminStudents = (await read(second.base, admin.token, "students.list")).result as Array<{
      id: string;
      enrollments: Array<{ unitPrice: number; agreedAmount: number; paidAmount: number }>;
    }>;
    const adminView = adminStudents.find((item) => item.id === studentAId);
    check("（对照）同一位学生在技术管理员那份里**有**金额 —— 说明 0 是剥出来的，不是本来没有钱",
      adminView?.enrollments[0]?.unitPrice === 200 &&
        adminView?.enrollments[0]?.agreedAmount === 2000 &&
        adminView?.enrollments[0]?.paidAmount === 1000,
      JSON.stringify(adminView?.enrollments[0]));

    const foreignStudent = await read(second.base, teacherA.token, "students.get", [studentBId]);
    equal("别人的学生：接口正常返回（200，不是 403）", foreignStudent.status, 200);
    equal("别人的学生：**当作不存在**（返回 null，不报错、也不说「存在但不是你的」）",
      foreignStudent.result, null);
    equal("自己的学生：拿得到", ((await read(second.base, teacherA.token, "students.get", [studentAId])).result as { id: string }).id, studentAId);
    const searched = (await read(second.base, teacherA.token, "students.search", ["范围"])).result as Array<{ id: string }>;
    const searchedAdmin = (await read(second.base, admin.token, "students.search", ["范围"])).result as Array<{ id: string }>;
    equal("搜索「范围」只搜到自己的学生", searched.map((item) => item.id), [studentAId]);
    equal("（对照）技术管理员搜同一个词能搜到两位", searchedAdmin.length, 2);
    equal("按学生导出（exportDataset）对教师仍然是 403（它属于运维，与今天一致）",
      (await call(second.base, teacherA.token, "exportDataset", [{ dataset: "students", ids: [], format: "csv" }])).status, 403);

    console.log("\n[9.3] 教师只看得到自己的课");
    const teacherLessons = (await read(second.base, teacherA.token, "lessons.list")).result as Array<{ id: string }>;
    const lessonIds = teacherLessons.map((item) => item.id).sort();
    equal("课表只剩自己的课（含自己那节已取消的课）",
      lessonIds, [cancelledLessonId, lessonAId].sort());
    check("别人的课不在里面", !lessonIds.includes(lessonBId));
    equal("别人的课：单条查不到（返回 null）",
      (await read(second.base, teacherA.token, "lessons.get", [lessonBId])).result, null);
    equal("别人的课表：`listByTeacher(别人)` 返回**空数组**（不是别人的课，也不是 403）",
      (await read(second.base, teacherA.token, "lessons.listByTeacher", [teacherBId])).result, []);
    equal("自己的课表：`listByTeacher(自己)` 拿得到",
      ((await read(second.base, teacherA.token, "lessons.listByTeacher", [teacherAId])).result as unknown[]).length, 2);
    equal("按学生查课：别人的学生 → 空数组",
      (await read(second.base, teacherA.token, "lessons.listByStudent", [studentBId])).result, []);
    equal("按日期查课：只算自己的",
      ((await read(second.base, teacherA.token, "lessons.listByDate", [new Date()])).result as unknown[]).length, 2);
    equal("按区间查课：只算自己的",
      ((await read(second.base, teacherA.token, "lessons.listBetween", [new Date(), new Date()])).result as unknown[]).length, 2);
    equal("（对照）技术管理员同一天看到 3 节",
      ((await read(second.base, admin.token, "lessons.listByDate", [new Date()])).result as unknown[]).length, 3);

    const markForeign = await read(second.base, teacherA.token, "lessons.markCompleted", [lessonBId]);
    equal("给别人的课「标记已上」：**当作不存在**（result.lesson 为 null，不报错）",
      (markForeign.result as { lesson: unknown }).lesson, null);
    equal("而且没有扣任何课时：那节课仍然是「已排」",
      ((await read(second.base, admin.token, "lessons.get", [lessonBId])).result as { status: string }).status, "已排");
    const markOwn = await read(second.base, teacherA.token, "lessons.markCompleted", [lessonAId]);
    equal("给自己课「标记已上」：正常执行",
      (markOwn.result as { lesson: { id: string } | null }).lesson?.id, lessonAId);
    equal("自己的课标完之后课时真的扣了 1 节（这条动作没被范围挡坏）",
      (((await read(second.base, teacherA.token, "students.get", [studentAId])).result as {
        enrollments: Array<{ usedLessons: number }>;
      }).enrollments[0]?.usedLessons), 1);
    equal("排课（批量排课）对教师是 403：那件事不归他",
      (await call(second.base, teacherA.token, "lessons.createSeries", [{ subject: SUBJECT }])).status, 403);
    equal("冲突检查对教师也是 403（结论里会点名别的教师与别的学生）",
      (await call(second.base, teacherA.token, "lessons.findConflicts", [{}])).status, 403);

    console.log("\n[9.4] 课时流水能看，钱看不到");
    const ledger = (await read(second.base, teacherA.token, "transactions.listByStudent", [studentAId])).result as unknown[];
    check("自己学生的课时流水看得到（报课那一条）", ledger.length >= 1, JSON.stringify(ledger).slice(0, 120));
    equal("别人学生的课时流水：空数组",
      (await read(second.base, teacherA.token, "transactions.listByStudent", [studentBId])).result, []);
    equal("收款记录（自己学生的）：403 —— 钱不归教师，这是整块业务而不是某一行",
      (await call(second.base, teacherA.token, "payments.listByStudent", [studentAId])).status, 403);
    for (const method of ["payments.list", "finance", "outstandingByStudent", "followups"]) {
      equal(`教师调 ${method} 一律 403`, (await call(second.base, teacherA.token, method)).status, 403);
    }
    equal("（对照）财务管理员看收款记录：正常",
      (await read(second.base, cashier.token, "payments.list")).status, 200);

    console.log("\n[9.5] 看板与搜索按我的口径重算");
    const todayMine = (await read(second.base, teacherA.token, "today")).result as {
      lessonCount: number; studentCount: number; teacherCount: number;
      lowLessonStudents: Array<{ student: { id: string } }>;
    };
    const todayAdmin = (await read(second.base, admin.token, "today")).result as {
      lessonCount: number; studentCount: number;
    };
    equal("今日概览的课次只算我的（含自己那节已取消的）", todayMine.lessonCount, 2);
    equal("今日概览的学生数只算我的", todayMine.studentCount, 1);
    equal("（对照）技术管理员的今日概览是全校口径", [todayAdmin.lessonCount, todayAdmin.studentCount], [3, 2]);
    check("低课时预警里只有我的学生",
      todayMine.lowLessonStudents.every((item) => item.student.id === studentAId));
    const statsMine = (await read(second.base, teacherA.token, "stats")).result as {
      teachers: Array<{ teacher: { id: string } }>;
      churn: { refundedAmount: number };
    };
    const statsAdmin = (await read(second.base, admin.token, "stats")).result as {
      teachers: Array<{ teacher: { id: string } }>;
    };
    equal("统计里的教师课时只算我自己那一条", statsMine.teachers.map((item) => item.teacher.id), [teacherAId]);
    equal("（对照）技术管理员的统计是全校两位教师", statsAdmin.teachers.length, 2);
    equal("退课金额（钱）对教师也是 0", statsMine.churn.refundedAmount, 0);
    const searchMine = (await read(second.base, teacherA.token, "search", ["范围乙"])).result as Array<{ kind: string }>;
    const searchAdmin = (await read(second.base, admin.token, "search", ["范围乙"])).result as Array<{ kind: string }>;
    equal("全局搜索搜不到别人的学生", searchMine.filter((hit) => hit.kind === "学生").length, 0);
    check("（对照）技术管理员搜同一个名字搜得到（搜索本身没坏）",
      searchAdmin.some((hit) => hit.kind === "学生"));

    console.log("\n[9.6] 兼任多角色不受限制；没绑 / 绑错 teacherId 是空范围");
    equal("兼任财务的教师账号：学生列表是全校口径（不受行级范围限制）",
      ((await read(second.base, dual.token, "students.list")).result as unknown[]).length, 2);
    check("兼任账号能拿到别人的学生（机构确认④：给了更高角色就按更高角色看）",
      (await read(second.base, dual.token, "students.get", [studentBId])).result !== null);
    equal("兼任账号能看收款记录",
      (await read(second.base, dual.token, "payments.list")).status, 200);
    equal("没绑 teacherId：学生列表为空", (await read(second.base, unbound.token, "students.list")).result, []);
    equal("没绑 teacherId：课表为空", (await read(second.base, unbound.token, "lessons.list")).result, []);
    equal("没绑 teacherId：连学生单条也是 null（不是报错，而是「什么都看不到」）",
      (await read(second.base, unbound.token, "students.get", [studentAId])).result, null);
    equal("没绑 teacherId：今日概览的学生数是 0",
      ((await read(second.base, unbound.token, "today")).result as { studentCount: number }).studentCount, 0);
    equal("teacherId 不存在（填错了）：同样是空范围",
      (await read(second.base, wrongId.token, "students.list")).result, []);
    equal("（对照）另一位教师看到的是**他自己**的学生",
      ((await read(second.base, teacherB.token, "students.list")).result as Array<{ id: string }>).map((item) => item.id),
      [studentBId]);
    check("而且那位教师的课表里没有甲老师的课（两位教师互不串号）",
      ((await read(second.base, teacherB.token, "lessons.list")).result as Array<{ id: string }>)
        .every((item) => item.id === lessonBId));

    console.log("\n[9.7] 老 REST 接口对教师整条关闭（管理员不受影响）");
    const teacherRest = await raw(second.base, "/api/students", { token: teacherA.token });
    equal("教师走老接口读学生：403（那条路没有范围过滤，只能整条关门）", teacherRest.status, 403);
    check("拒绝理由说清了「改走 /api/call」",
      String(teacherRest.body.error ?? "").includes("/api/call"), String(teacherRest.body.error ?? ""));
    equal("教师走老接口读排课：也 403", (await raw(second.base, "/api/lessons", { token: teacherA.token })).status, 403);
    equal("（对照）技术管理员走老接口照旧能读 —— 与今天完全一样",
      (await raw(second.base, "/api/students", { token: admin.token })).status, 200);
    equal("（回归）技术管理员的 /api/call 不受这条门影响",
      (await read(second.base, admin.token, "students.list")).status, 200);

    console.log("\n[9.8] 回归：技术 / 财务 / 招生与今天完全一致");
    equal("技术管理员看得到全部学生", ((await read(second.base, admin.token, "students.list")).result as unknown[]).length, 2);
    equal("技术管理员看得到全部排课", ((await read(second.base, admin.token, "lessons.list")).result as unknown[]).length, 3);
    equal("技术管理员能导出整库（运维权限没被范围层碰坏）",
      (await call(second.base, admin.token, "exportDatabase")).status, 200);
    equal("财务管理员看得到全部学生（钱的口径没被教师那层限制污染）",
      ((await read(second.base, cashier.token, "students.list")).result as unknown[]).length, 2);
    check("财务管理员的收款记录里**有金额**（没被剥字段）",
      ((await read(second.base, cashier.token, "payments.list")).result as Array<{ amount: number }>)
        .every((item) => item.amount > 0));
    equal("招生老师看得到全部排课", ((await read(second.base, enroller.token, "lessons.list")).result as unknown[]).length, 3);
    check("招生老师能报课（机构确认①的邻居：角色没变，仍然不是 403）",
      (await call(second.base, enroller.token, "students.enroll")).status !== 403);

    console.log("\n[9.9] 范围是「每请求重设」的：自己调 setScope 放不开，并发也不会串号");
    /*
     * 这两条守的是同一个机制的两面：
     *   ① 前端调 `setScope` 不作数 —— 服务端在调业务方法**之前**会按会话再设一次
     *      （`requireAuth` 里那次 + `/api/call` 调用前那次），所以"自己把范围改成 all"
     *      对下一个请求毫无影响；
     *   ② 交错请求不串号 —— 两位教师同时打请求时，A 的请求不会用上 B 的范围。
     *
     * 说清这两条断言的**强度**：它们是行为护栏（不会假报警：实现正确时永远成立），
     * 不是"漏掉某一行就必红"的变异测试 —— 因为范围在两个地方都会按会话重设
     * （闸门里一次、调用前一次），少一处时另一处仍然兜住。
     * "范围真的生效了"这件事由上面那些**成对**的断言守住（教师那边必须收窄、
     * 技术管理员那边必须照旧全量）：真把两处重设都去掉，红的就是那些对照断言
     * （实测过一遍：去掉两处之后本节 4 条不成立、并且会在后面中断）。
     */
    await call(second.base, teacherA.token, "setScope", [{ kind: "all", teacherId: "", warning: "" }]);
    equal("教师自己调 setScope(全放开) 之后，下一个请求仍然只看到自己的学生（前端说了不算）",
      ((await read(second.base, teacherA.token, "students.list")).result as Array<{ id: string }>)
        .map((item) => item.id), [studentAId]);
    const concurrent = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        read(second.base, index % 2 === 0 ? teacherA.token : teacherB.token, "students.list").then(
          (response) => ({
            index,
            expected: index % 2 === 0 ? studentAId : studentBId,
            ids: (response.result as Array<{ id: string }> | undefined)?.map((item) => item.id) ?? null,
          }),
        ),
      ),
    );
    equal("12 个并发请求交错：每一位教师拿到的都只有自己的学生（范围不串号）",
      concurrent.filter((item) => JSON.stringify(item.ids) !== JSON.stringify([item.expected])), []);
  } finally {
    await second.stop();
    rmSync(scopeDir, { recursive: true, force: true });
  }
} catch (cause) {
  failures += 1;
  console.error(`\n✗ 行级范围这一节中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

} catch (cause) {
  failures += 1;
  console.error(`\n✗ 自检中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

/*
 * ── 账号管理（后台「账号」页：加人 / 改角色 / 绑教师 / 重置口令 / 停用 / 删除）────────────
 *
 * ## 为什么这一节必须真的起服务端
 *
 * 账号表是**服务端进程里的一个文件**（与数据库同目录的 `accounts.json`），
 * 而这一节要守的性质全都是"只有真进程才看得见"的东西：
 *   - 未登录 401 / 非技术管理员 403（权限边界）；
 *   - 改完**落盘**了吗（读文件比对）、文件权限还是 0600 吗、格式还是人手工编辑的那种吗；
 *   - 新账号**马上能登录**吗（写完之后内存缓存有没有失效）—— 忘了失效的症状是
 *     "我明明加了账号，怎么登不上、重启一下就好了"，这类问题只有真登录一次才验得到；
 *   - 被拒的写操作**真的什么都没改**吗（前后读文件比对）。
 *
 * ## 为什么是两个服务端
 *
 * ① 第一个**不带** `NEXGENEDU_ACCOUNTS_JSON`（账号表由凭证迁移落在**临时目录**里）——
 *    只有这种形态才允许写：加人、改角色、重置口令、删除都在它上面真跑一遍；
 * ② 第二个**带上**那个环境变量（只读钩子）—— 写操作必须被拒，而且**不落盘**。
 *    这一条单独验，因为"钩子下还能写"会直接毁掉自检的可信度（改的其实是另一份账号表）。
 *
 * 两个都是 `withTempServer`（临时库 + 临时目录），跑完即删：**绝不碰真实账号表**。
 */
console.log("\n[10] 账号管理：只有技术管理员能改、写盘立刻生效、锁死保护");
try {
  /* ① 可写的那一个：加人 / 改角色 / 重置口令 / 删除全走一遍 */
  await withTempServer(async (base, info) => {
    /** 账号表就在临时数据库的旁边（`accountsFile()` 跟着 `credentialFile()` 走）。 */
    const accountsPath = path.join(path.dirname(info.dbPath), "accounts.json");
    const readTableText = (): string =>
      existsSync(accountsPath) ? readFileSync(accountsPath, "utf8") : "";
    const readEntries = (): Array<Record<string, unknown>> =>
      JSON.parse(readTableText()) as Array<Record<string, unknown>>;
    /** 按用户名取一条**原始条目**（"其它账号原样"这类断言靠它逐条比）。 */
    const entryOf = (username: string): unknown =>
      readEntries().find((item) => item.username === username) ?? null;

    /** 裸请求（要拿到**响应原文**：有一条断言是"响应文本里不出现 password/salt/hash"）。 */
    const accounts = async (
      options: { method?: string; token?: string | null; body?: unknown } = {},
    ): Promise<{ status: number; text: string; body: Record<string, unknown> }> => {
      const response = await fetch(`${base}/api/accounts`, {
        method: options.method ?? "GET",
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.token === undefined || options.token === null
            ? {}
            : { authorization: `Bearer ${options.token}` }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = {};
      }
      return { status: response.status, text, body };
    };
    /** 登录（失败直接抛错 —— 这一节里"应该能登录"的那些必须真能登）。 */
    const loginAs = async (username: string, password: string): Promise<string> => {
      const response = await raw(base, "/api/login", {
        method: "POST",
        body: { username, password },
      });
      if (response.status !== 200) {
        throw new Error(`登录 ${username} 失败：HTTP ${response.status} ${JSON.stringify(response.body)}`);
      }
      return String(response.body.token ?? "");
    };
    const loginStatus = async (username: string, password: string): Promise<number> =>
      (await raw(base, "/api/login", { method: "POST", body: { username, password } })).status;

    console.log("\n[10.1] 未登录：四条路由全是 401");
    equal("未登录读账号表 401", (await accounts()).status, 401);
    equal("未登录建账号 401",
      (await accounts({ method: "POST", body: { username: "谁" } })).status, 401);
    equal("未登录改账号 401",
      (await accounts({ method: "PATCH", body: { username: "谁" } })).status, 401);
    equal("未登录删账号 401",
      (await accounts({ method: "DELETE", body: { username: "谁" } })).status, 401);

    const adminToken = await loginAs(info.username, info.password);

    console.log("\n[10.2] 技术管理员读账号表：拿得到，但**绝不含口令与哈希**");
    const listed = await accounts({ token: adminToken });
    equal("读账号表成功", listed.status, 200);
    /*
     * 这三条是硬断言（直接查**响应原文**）：它们不是"字段看起来对了"，而是
     * "口令那几样东西根本没有出现在响应里" —— 一旦有人图省事把整个 Account 回给界面
     * （或把 salt / hash 塞进某个调试字段），这里立刻红。
     */
    check("响应里没有 password（字段名与明文都没有）", !listed.text.includes("password"),
      listed.text.slice(0, 200));
    check("响应里没有 salt", !listed.text.includes("salt"), listed.text.slice(0, 200));
    check("响应里没有 hash", !listed.text.includes("hash"), listed.text.slice(0, 200));
    const roster = (listed.body.accounts ?? []) as Array<{ username: string; roles: string[] }>;
    equal("列表里有那条迁移出来的技术管理员账号（角色对）",
      roster.find((item) => item.username === info.username)?.roles, ["技术管理员"]);
    equal("这份账号表不是只读的（没有 NEXGENEDU_ACCOUNTS_JSON）", listed.body.readOnly, false);
    check("列表告诉界面账号表文件在哪（手工改文件是备用做法）",
      String(listed.body.file ?? "").endsWith("accounts.json"), String(listed.body.file ?? ""));

    // 造一位教师：teacherId 的"存在性校验"要有真的教师档案才验得了
    const teacherId = String(((await call(base, adminToken, "teachers.create", [{
      name: "账号自检教师", subjects: [], role: "", phone: "", active: true, years: "",
      summary: "", bio: "", recommendation: "", order: 998, siteVisible: false, origin: "后台", kind: "教师",
    }])).body.result as { id?: string } | undefined)?.id ?? "");
    check("播种教师成功（下面用它验 teacherId 校验）", teacherId !== "", teacherId);

    console.log("\n[10.3] 新建：账号马上能用，文件是 0600，其余账号一字不动");
    const adminEntryBefore = entryOf(info.username);
    const textBefore = readTableText();
    check("（前置）迁移出来的账号表已落盘", textBefore !== "", textBefore.slice(0, 120));
    equal("（前置）写盘格式就是「手工编辑的那种」（2 空格缩进 + 末尾换行）",
      textBefore, `${JSON.stringify(JSON.parse(textBefore), null, 2)}\n`);

    const created = await accounts({
      method: "POST",
      token: adminToken,
      body: {
        username: "账号自检老师",
        password: "pw-manage-a1",
        roles: ["普通教师"],
        teacherId,
        note: "账号管理自检",
      },
    });
    equal("新建账号返回 201", created.status, 201);
    const createdRow = created.body.account as
      | { username: string; roles: string[]; teacherId: string; disabled: boolean }
      | undefined;
    equal("新建的账号形状对（角色 / 绑定教师 / 未停用）",
      [createdRow?.username, createdRow?.roles, createdRow?.teacherId, createdRow?.disabled],
      ["账号自检老师", ["普通教师"], teacherId, false]);
    check("新建的响应里不带明文口令", !created.text.includes("pw-manage-a1"), created.text);
    check("新建的响应里没有 password / salt / hash",
      !created.text.includes("password") && !created.text.includes("salt") && !created.text.includes("hash"),
      created.text);
    equal("绑了教师档案 → 没有范围警告", created.body.warnings, []);

    equal("账号表里真的多了这一条（落盘了）",
      readEntries().some((item) => item.username === "账号自检老师"), true);
    check("账号表文件权限仍然是 0600（里面有明文口令）",
      (statSync(accountsPath).mode & 0o777) === 0o600,
      `mode = ${(statSync(accountsPath).mode & 0o777).toString(8)}`);
    equal("**其它账号一个字都没动**（技术管理员那条前后完全一样）",
      entryOf(info.username), adminEntryBefore);

    /*
     * 关键断言：写完之后**不需要重启后端**就能登录。
     * 做法是服务端写盘成功之后清掉账号表的内存缓存（下一次读会重新读文件）。
     * 忘了清缓存的症状是"我明明加了账号，怎么登不上" —— 而重启一下就好了，
     * 所以那种 bug 在手工点页面时很容易被"重启试试"掩盖过去。
     */
    check("新账号**马上就能登录**（不需要重启后端：内存缓存已失效）",
      (await loginAs("账号自检老师", "pw-manage-a1")).length >= 32);

    const unbound = await accounts({
      method: "POST",
      token: adminToken,
      body: { username: "没绑档老师", password: "pw-manage-b2", roles: ["普通教师"], teacherId: "", note: "" },
    });
    equal("建一个不绑教师档案的普通教师账号：201", unbound.status, 201);
    const unboundWarnings = (unbound.body.warnings ?? []) as string[];
    check("没绑 teacherId 的普通教师账号拿到一句警告（解释他会看不到数据）",
      unboundWarnings.some((item) => item.includes("teacherId")), JSON.stringify(unboundWarnings));
    const unboundEntryBefore = entryOf("没绑档老师");

    console.log("\n[10.4] 普通教师调这四条路由：全部 403");
    const teacherToken = await loginAs("没绑档老师", "pw-manage-b2");
    const teacherGet = await accounts({ token: teacherToken });
    equal("普通教师读账号表 403", teacherGet.status, 403);
    check("403 里说清了需要什么角色（与其它权限错误同一套文案）",
      String(teacherGet.body.error ?? "").includes("技术管理员"), String(teacherGet.body.error ?? ""));
    check("403 的响应里没有账号数据（被拒时不能顺手把数据带出来）",
      teacherGet.body.accounts === undefined, teacherGet.text.slice(0, 160));
    equal("普通教师建账号 403",
      (await accounts({
        method: "POST", token: teacherToken,
        body: { username: "教师偷建的", password: "pw-manage-c3", roles: ["技术管理员"], teacherId: "" },
      })).status, 403);
    equal("普通教师改账号 403",
      (await accounts({
        method: "PATCH", token: teacherToken,
        body: { username: info.username, roles: ["普通教师"] },
      })).status, 403);
    equal("普通教师删账号 403",
      (await accounts({ method: "DELETE", token: teacherToken, body: { username: info.username } })).status, 403);
    equal("（这几次被拒也什么都没改：技术管理员那条前后一致）",
      entryOf(info.username), adminEntryBefore);

    console.log("\n[10.5] 改角色与绑定教师（只改这一条，别的账号原样）");
    const patched = await accounts({
      method: "PATCH",
      token: adminToken,
      body: { username: "账号自检老师", roles: ["财务管理员", "招生老师"], teacherId: "", note: "改成兼两个角色" },
    });
    equal("改角色成功（200）", patched.status, 200);
    const patchedRow = patched.body.account as { roles: string[]; teacherId: string; note: string } | undefined;
    equal("角色存下来时按 ROLES 的顺序排（文件是给人看的，稳定才好 diff）",
      patchedRow?.roles, ["财务管理员", "招生老师"]);
    equal("teacherId 与备注也改了", [patchedRow?.teacherId, patchedRow?.note], ["", "改成兼两个角色"]);
    equal("不再是普通教师 → 没有范围警告", patched.body.warnings, []);
    equal("（对照）另一位教师账号的条目一字未动（写盘只改被改的那一条）",
      entryOf("没绑档老师"), unboundEntryBefore);
    equal("（对照）技术管理员那条也没被牵连", entryOf(info.username), adminEntryBefore);

    console.log("\n[10.6] 重置口令：新口令真能登录、旧口令立刻失效");
    const reset = await accounts({
      method: "PATCH", token: adminToken,
      body: { username: "账号自检老师", password: "pw-manage-new2" },
    });
    equal("重置口令成功（200）", reset.status, 200);
    check("重置口令的响应里不含新口令", !reset.text.includes("pw-manage-new2"), reset.text);
    check("重置口令的响应里也没有 password / salt / hash",
      !reset.text.includes("password") && !reset.text.includes("salt") && !reset.text.includes("hash"),
      reset.text);
    check("用新口令能登录", (await loginAs("账号自检老师", "pw-manage-new2")).length >= 32);
    equal("用旧口令登不上了（401）", await loginStatus("账号自检老师", "pw-manage-a1"), 401);
    equal("账号表里存的是新口令的明文（找回用，与凭证文件同一约定）",
      readEntries().find((item) => item.username === "账号自检老师")?.password, "pw-manage-new2");

    console.log("\n[10.7] 锁死保护：最后一位技术管理员不能删 / 降级 / 停用（但换人是允许的）");
    /** 被拒的写操作前后要比对文件：**一个字都不能变**。 */
    const guardBefore = readTableText();
    const deleteAdmin = await accounts({
      method: "DELETE", token: adminToken, body: { username: info.username },
    });
    equal("删掉唯一的技术管理员：被拒（400）", deleteAdmin.status, 400);
    check("拒绝理由说清了原因（最后一位技术管理员 + 那样就锁死了）",
      String(deleteAdmin.body.error ?? "").includes("最后一位技术管理员"),
      String(deleteAdmin.body.error ?? ""));
    const demoteAdmin = await accounts({
      method: "PATCH", token: adminToken, body: { username: info.username, roles: ["普通教师"] },
    });
    equal("把唯一的技术管理员改成别的角色：被拒（400）", demoteAdmin.status, 400);
    check("降级被拒的理由里点名了技术管理员",
      String(demoteAdmin.body.error ?? "").includes("技术管理员"), String(demoteAdmin.body.error ?? ""));
    equal("停用唯一的技术管理员：也被拒（他登不进来，同样是锁死）",
      (await accounts({
        method: "PATCH", token: adminToken, body: { username: info.username, disabled: true },
      })).status, 400);
    equal("这三次被拒都没有改动账号表（前后读文件一致）", readTableText(), guardBefore);

    /*
     * 对照（这条很重要）：**不是一刀切地禁止动技术管理员**。
     * 真换人的做法就是"先给接任的人加上技术管理员，再删掉原来那位" ——
     * 如果连这也拦，那条安全线就成了没法正常换人的障碍（于是有人会去手工改文件绕过它）。
     */
    equal("（对照）给技术管理员**加**一个角色：允许（管理员数没减少）",
      (await accounts({
        method: "PATCH", token: adminToken, body: { username: info.username, roles: ["技术管理员", "财务管理员"] },
      })).status, 200);
    // 造两位"来接任的人"（用它们演一遍换人，不碰上面那位 admin）
    for (const name of ["旧技术", "新技术"]) {
      equal(`（对照）新建技术管理员「${name}」：允许`,
        (await accounts({
          method: "POST", token: adminToken,
          body: { username: name, password: `pw-${name}-d4`, roles: ["技术管理员"], teacherId: "", note: "" },
        })).status, 201);
    }
    equal("现在一共有三位技术管理员", readEntries().filter((item) => (
      Array.isArray(item.roles) && item.roles.includes("技术管理员")
    )).length, 3);
    equal("有接任的人之后，删掉旧的那位：允许（换人正是这么做的）",
      (await accounts({ method: "DELETE", token: adminToken, body: { username: "旧技术" } })).status, 200);
    equal("删掉一位之后还剩两位（不是全禁，也不是全放）", readEntries().filter((item) => (
      Array.isArray(item.roles) && item.roles.includes("技术管理员")
    )).length, 2);
    /*
     * 一条**与环境变量挂钩**的特殊情况：与 `NEXGENEDU_ADMIN_PASSWORD` 同名的那条账号删不掉。
     * 理由在 `server/accounts.mts`（那条路的语义是"没有同名账号就新建一条"，
     * 所以删掉之后下一次读账号表会把它**建回来**）。这里要钉住的是"拒绝的理由说得清"，
     * 而不是让人看到一句含混的失败（当初没这条判定时，删除会以 500"改动不可信"收场，
     * 人会以为账号表坏了）。
     */
    const deleteEnvAccount = await accounts({
      method: "DELETE", token: adminToken, body: { username: info.username },
    });
    equal("删掉与 NEXGENEDU_ADMIN_PASSWORD 同名的那条账号：明确拒绝（409，而不是含混的失败）",
      deleteEnvAccount.status, 409);
    check("拒绝理由说清了「会被环境变量重建」与怎么绕开",
      String(deleteEnvAccount.body.error ?? "").includes("NEXGENEDU_ADMIN_PASSWORD") &&
        String(deleteEnvAccount.body.error ?? "").includes("自动建回来"),
      String(deleteEnvAccount.body.error ?? ""));
    equal("（清理）删掉接任的那位：允许（此时 admin 还在位）",
      (await accounts({ method: "DELETE", token: adminToken, body: { username: "新技术" } })).status, 200);
    equal("（回到起点）技术管理员现在仍然只有 admin 一位",
      readEntries().filter((item) => Array.isArray(item.roles) && item.roles.includes("技术管理员")).length, 1);
    equal("清理：admin 的角色恢复成只有技术管理员",
      (await accounts({
        method: "PATCH", token: adminToken, body: { username: info.username, roles: ["技术管理员"] },
      })).status, 200);

    console.log("\n[10.8] 参数错与规则错：一律被拒，且账号表一字未动");
    const before = readTableText();
    const rejected = async (
      label: string,
      options: { method: string; body: unknown },
      expected: number,
      mustMention = "",
    ): Promise<void> => {
      const response = await accounts({ token: adminToken, ...options });
      equal(label, response.status, expected);
      if (mustMention !== "") {
        check(`${label}：理由里点名了「${mustMention}」`,
          String(response.body.error ?? "").includes(mustMention), String(response.body.error ?? ""));
      }
    };
    await rejected("重名（账号名不能重复）",
      { method: "POST", body: { username: "账号自检老师", password: "pw-manage-x9", roles: ["普通教师"], teacherId: "" } },
      400, "重名");
    await rejected("空口令",
      { method: "POST", body: { username: "空口令的", password: "", roles: ["普通教师"], teacherId: "" } }, 400, "口令");
    await rejected("口令太短（下限 8 位）",
      { method: "POST", body: { username: "短口令的", password: "1234567", roles: ["普通教师"], teacherId: "" } },
      400, "8 位");
    await rejected("不认识的角色（**拒绝**，而不是静默丢掉）",
      { method: "POST", body: { username: "怪角色的", password: "pw-manage-y8", roles: ["超级管理员"], teacherId: "" } },
      400, "超级管理员");
    await rejected("一个角色都不给",
      { method: "POST", body: { username: "没角色的", password: "pw-manage-z7", roles: [], teacherId: "" } }, 400);
    await rejected("teacherId 指向不存在的教师档案",
      { method: "POST", body: { username: "绑错档的", password: "pw-manage-w6", roles: ["普通教师"], teacherId: "t_不存在" } },
      400, "t_不存在");
    await rejected("改一个不存在的账号",
      { method: "PATCH", body: { username: "根本不存在", note: "改一下" } }, 404);
    await rejected("删一个不存在的账号",
      { method: "DELETE", body: { username: "根本不存在" } }, 404);
    await rejected("改账号却什么都没给（至少给一项）",
      { method: "PATCH", body: { username: "账号自检老师" } }, 400);
    /*
     * 类型写错也要报错，不能当"没给"：`disabled: "true"` 若被当成没给，
     * "停用"就会**悄悄没生效**（账号照样能登），而界面上还显示成功 —— 这种静默失败最难查。
     */
    await rejected("disabled 写成字符串（类型不对要报错，不能当没给）",
      { method: "PATCH", body: { username: "账号自检老师", disabled: "true" } }, 400, "disabled");
    await rejected("roles 不是字符串数组",
      { method: "PATCH", body: { username: "账号自检老师", roles: "财务管理员" } }, 400, "roles");
    equal("以上被拒的操作都没有改动账号表（前后读文件比对一致）", readTableText(), before);

    console.log("\n[10.9] 停用 / 启用");
    equal("停用「账号自检老师」成功",
      (await accounts({
        method: "PATCH", token: adminToken, body: { username: "账号自检老师", disabled: true },
      })).status, 200);
    const disabledLogin = await raw(base, "/api/login", {
      method: "POST", body: { username: "账号自检老师", password: "pw-manage-new2" },
    });
    equal("停用之后他登不进来（401）", disabledLogin.status, 401);
    check("而且说的是「已停用」而不是「口令不对」（只有口令正确的人才知道原因，不泄漏账号是否存在）",
      String(disabledLogin.body.error ?? "").includes("停用"), String(disabledLogin.body.error ?? ""));
    equal("启用回来成功",
      (await accounts({
        method: "PATCH", token: adminToken, body: { username: "账号自检老师", disabled: false },
      })).status, 200);
    check("启用之后又能登录了", (await loginAs("账号自检老师", "pw-manage-new2")).length >= 32);

    console.log("\n[10.10] 删除，以及操作日志留痕（口令不进日志）");
    equal("删掉「账号自检老师」",
      (await accounts({ method: "DELETE", token: adminToken, body: { username: "账号自检老师" } })).status, 200);
    equal("列表里没有它了",
      ((((await accounts({ token: adminToken })).body.accounts ?? []) as Array<{ username: string }>)
        .some((item) => item.username === "账号自检老师")), false);
    equal("删掉的账号登不进来（401）", await loginStatus("账号自检老师", "pw-manage-new2"), 401);
    equal("再删一次：404（没有这个账号）",
      (await accounts({ method: "DELETE", token: adminToken, body: { username: "账号自检老师" } })).status, 404);
    equal("清理：删掉「没绑档老师」",
      (await accounts({ method: "DELETE", token: adminToken, body: { username: "没绑档老师" } })).status, 200);
    equal("账号表回到只有 admin 一条（这一节没有留下测试账号）", readEntries().length, 1);

    /*
     * 留痕：走的是**服务端自己那套**日志（`writeLog` 写的 SQL `logs` 表，与老 REST 接口
     * 同一个通道），所以要去 `GET /api/logs` 看，而不是 `logs.list`（那个读的是 kv 快照里
     * "页面自己"那份日志）。断言两件事：① 记了这些操作、操作人来自会话；② 摘要里**没有口令**。
     */
    const logRows = (await raw(base, "/api/logs?entity=账号", { token: adminToken })).body as unknown as
      Array<{ action?: string; operator?: string; summary?: string }>;
    check("账号操作留下了日志（老 REST 的 /api/logs 里看得到）",
      Array.isArray(logRows) && logRows.length >= 4, JSON.stringify(logRows).slice(0, 200));
    const createLog = logRows.find(
      (row) => row.action === "新建" && String(row.summary ?? "").includes("账号自检老师"),
    );
    check("新建账号那条日志写清了「新建账号 X（角色…）」",
      createLog !== undefined && String(createLog.summary).includes("普通教师"), JSON.stringify(createLog));
    equal("日志里的操作人来自会话（不是前端说了算）", createLog?.operator, info.username);
    check("日志里有「重置口令」这一条，但**没有任何口令内容**",
      logRows.some((row) => row.action === "重置口令") &&
        logRows.every((row) => !JSON.stringify(row.summary ?? "").includes("pw-manage")),
      JSON.stringify(logRows.map((row) => row.summary)));
    check("日志里有「停用」「启用」与「删除」",
      ["停用", "启用", "删除"].every((action) => logRows.some((row) => row.action === action)),
      JSON.stringify(logRows.map((row) => row.action)));
  });

  /* ② 只读钩子（NEXGENEDU_ACCOUNTS_JSON）：读得到，写一律被拒，而且不落盘 */
  await withTempServer(
    async (base, info) => {
      const accountsPath = path.join(path.dirname(info.dbPath), "accounts.json");
      const request = async (
        method: string,
        token: string | null,
        body?: unknown,
      ): Promise<{ status: number; body: Record<string, unknown> }> => {
        const response = await fetch(`${base}/api/accounts`, {
          method,
          headers: {
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: response.status,
          body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
        };
      };
      const loginAs = async (username: string, password: string): Promise<string> => {
        const response = await raw(base, "/api/login", { method: "POST", body: { username, password } });
        return String(response.body.token ?? "");
      };

      const adminToken = await loginAs("技术甲", "pw-admin");
      const listed = await request("GET", adminToken);
      equal("只读钩子下**读**得到账号表（只看不改）", listed.status, 200);
      equal("界面能知道这份账号表是只读的", listed.body.readOnly, true);
      check("只读的原因写清了是环境变量提供的账号表",
        String(listed.body.readOnlyReason ?? "").includes("NEXGENEDU_ACCOUNTS_JSON") &&
          String(listed.body.readOnlyReason ?? "").includes("只读"),
        String(listed.body.readOnlyReason ?? ""));

      const writes: Array<[string, unknown]> = [
        ["POST", { username: "想加的", password: "pw-should-not-apply", roles: ["普通教师"], teacherId: "" }],
        ["PATCH", { username: "教师甲", roles: ["技术管理员"] }],
        ["DELETE", { username: "教师甲" }],
      ];
      for (const [method, body] of writes) {
        const response = await request(method, adminToken, body);
        equal(`只读钩子下 ${method} 被拒（409：再试也没用）`, response.status, 409);
        check(`只读钩子下 ${method} 的理由说清了「本次是环境变量提供的只读账号表」`,
          String(response.body.error ?? "").includes("只读") &&
            String(response.body.error ?? "").includes("NEXGENEDU_ACCOUNTS_JSON"),
          String(response.body.error ?? ""));
      }
      equal("只读钩子下**一个字都没有落到盘上**（不落盘是它的定义）", existsSync(accountsPath), false);
      equal("（对照）只读钩子下技术管理员读账号表仍然正常", (await request("GET", adminToken)).status, 200);
      equal("只读钩子下普通教师读账号表同样是 403",
        (await request("GET", await loginAs("教师甲", "pw-teacher"))).status, 403);
    },
    // 只读、不落盘的测试账号表（与 [8] 节同一套钩子）：临时库 → 临时目录，绝不碰真实账号
    {
      env: {
        NEXGENEDU_ACCOUNTS_JSON: JSON.stringify([
          { username: "技术甲", password: "pw-admin", roles: ["技术管理员"] },
          { username: "教师甲", password: "pw-teacher", roles: ["普通教师"], teacherId: "t_随便" },
        ]),
      },
    },
  );
} catch (cause) {
  failures += 1;
  console.error(`\n✗ 账号管理这一节中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

console.log("\n[11] 节假日表：登录即可看、只有技术管理员能抓、坏文件不许静默少一年");
try {
  /*
   * 这一节全部在**临时目录**里跑（`NEXGENEDU_HOLIDAY_DIR`）：抓取会写盘，
   * 若让它写到仓库的 `data/holidays/` 上，一次自检就能把机构的假日表换掉。
   * 顺便这也是"读盘校验"唯一测得准的方式：先手写一份好的、一份坏的文件，再看接口怎么回。
   */
  const temp = mkdtempSync(join(tmpdir(), "nexgenedu-holidays-"));
  const year = new Date().getFullYear();
  const goodYear = year - 1;
  const writeYearFile = (name: string, value: unknown): void => {
    writeFileSync(join(temp, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };
  const yearFile = (target: number, days: Array<{ date: string; name: string; kind: string }>): unknown => ({
    year: target,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sources: [
      { id: "apple", label: "Apple 日历", url: "https://example.invalid/a.ics", ok: true, days: days.length, fingerprint: "sha256:test", note: "" },
      { id: "gov", label: "国务院口径", url: "https://example.invalid/g.json", ok: true, days: days.length, fingerprint: "sha256:test2", note: "" },
    ],
    verdict: { agree: true, blocking: [], notes: ["测试数据"], notPublished: false },
    days,
  });

  writeYearFile(`${goodYear}.json`, yearFile(goodYear, [
    { date: `${goodYear}-01-01`, name: "元旦", kind: "放假" },
    { date: `${goodYear}-01-02`, name: "元旦", kind: "调休上班" },
  ]));
  // 坏文件：days 是空的（读盘校验必须拒绝，而不是当成"这一年没有假期"）
  writeYearFile(`${year}.json`, { ...(yearFile(year, []) as Record<string, unknown>) });
  // 一个文件名合规、内容根本不是 JSON 的文件
  writeFileSync(join(temp, "2099.json"), "{ 这不是 JSON", "utf8");

  await withTempServer(
    async (base, info) => {
      const request = async (
        path: string,
        options: { method?: string; token?: string | null; body?: unknown } = {},
      ): Promise<{ status: number; body: Record<string, unknown> }> => {
        const response = await fetch(`${base}${path}`, {
          method: options.method ?? "GET",
          headers: {
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...(options.token === undefined || options.token === null ? {} : { authorization: `Bearer ${options.token}` }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });
        const text = await response.text();
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          body = {};
        }
        return { status: response.status, body };
      };
      const view = (body: Record<string, unknown>): Record<string, unknown> =>
        (body.view ?? {}) as Record<string, unknown>;
      const yearsOf = (body: Record<string, unknown>): Array<Record<string, unknown>> =>
        ((view(body).years ?? []) as Array<Record<string, unknown>>);
      const loginAs = async (username: string, password: string): Promise<string> => {
        const response = await raw(base, "/api/login", { method: "POST", body: { username, password } });
        if (response.status !== 200) {
          throw new Error(`登录 ${username} 失败：HTTP ${response.status} ${JSON.stringify(response.body)}`);
        }
        return String(response.body.token ?? "");
      };
      const teacherId = String(((await call(base, await loginAs(info.username, info.password), "teachers.create", [{
        name: "节假日自检教师", subjects: [], role: "", phone: "", active: true, years: "",
        summary: "", bio: "", recommendation: "", order: 997, siteVisible: false, origin: "后台", kind: "教师",
      }])).body.result as { id?: string } | undefined)?.id ?? "");

      console.log("\n[11.1] 未登录：两条路由都是 401");
      equal("未登录读节假日表 401", (await request("/api/holidays")).status, 401);
      equal("未登录抓取 401", (await request("/api/holidays/refresh", { method: "POST", body: {} })).status, 401);

      const adminToken = await loginAs(info.username, info.password);

      console.log("\n[11.2] 技术管理员读表：读到的是临时目录里那份，且校验结论一起回");
      const listed = await request("/api/holidays", { token: adminToken });
      equal("读表成功", listed.status, 200);
      const years = yearsOf(listed.body);
      equal("有数据的年份就是刚才写进去的那一年", years.map((item) => item.year), [goodYear]);
      equal("那一年带了两天（放假 / 调休上班各一天）",
        (years[0]?.days as Array<{ date: string; kind: string }> | undefined)?.map((day) => day.kind),
        ["放假", "调休上班"]);
      check("回里带了数据目录（救人一命：知道文件在哪就能手工改）",
        String(view(listed.body).dir ?? "").includes("nexgenedu-holidays-"), String(view(listed.body).dir ?? ""));

      /*
       * 坏文件必须**显式报出来**：两条断言分别是"空 days 被拒绝"与"不是 JSON 被拒绝"。
       * 这是这一节最要紧的一组 —— 静默少一年，排课就会照着错的日历走。
       */
      const errors = ((view(listed.body).errors ?? []) as unknown[]).map((item) => String(item));
      equal("两个坏文件都被报出来（而不是当成没有假期）", errors.length, 2);
      check("其中一条说的是「没有任何一天的数据」", errors.some((line) => line.includes("没有任何一天")), errors.join(" / "));
      check("另一条说的是「不是合法 JSON」", errors.some((line) => line.includes("不是合法 JSON")), errors.join(" / "));

      console.log("\n[11.3] 权限：普通教师能看、不能抓");
      await request("/api/accounts", {
        method: "POST",
        token: adminToken,
        body: { username: "节假日自检老师", password: "pw-holiday-a1", roles: ["普通教师"], teacherId, note: "" },
      });
      const teacherToken = await loginAs("节假日自检老师", "pw-holiday-a1");
      equal("普通教师读节假日表：200（排课时要看哪天是假期）",
        (await request("/api/holidays", { token: teacherToken })).status, 200);
      const denied = await request("/api/holidays/refresh", { method: "POST", token: teacherToken, body: {} });
      equal("普通教师抓取：403", denied.status, 403);
      check("403 的文案说清了需要什么角色",
        String(denied.body.error ?? "").includes("技术管理员"), String(denied.body.error ?? ""));

      console.log("\n[11.4] 参数：年份写错回 400（而不是去抓一个不存在的年份）");
      equal("年份超范围 400",
        (await request("/api/holidays/refresh", { method: "POST", token: adminToken, body: { years: [20255] } })).status, 400);
      equal("年份不是整数 400",
        (await request("/api/holidays/refresh", { method: "POST", token: adminToken, body: { years: ["2026"] } })).status, 400);
      /*
       * 类型写错不许被当成"没给"：`years: "2026"` 若走成缺省值，就会悄悄变成
       * "抓今年与明年"，而请求看起来还是成功的（与账号管理里那条纪律同一条）。
       */
      const wrongType = await request("/api/holidays/refresh", {
        method: "POST",
        token: adminToken,
        body: { years: "2026" },
      });
      equal("years 不是数组 → 400（不当成没给）", wrongType.status, 400);
      check("400 的文案点明了要数组", String(wrongType.body.error ?? "").includes("数组"), String(wrongType.body.error ?? ""));
      equal("空数组 400",
        (await request("/api/holidays/refresh", { method: "POST", token: adminToken, body: { years: [] } })).status, 400);
      equal("一次超过 12 年 400",
        (await request("/api/holidays/refresh", {
          method: "POST",
          token: adminToken,
          body: { years: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022] },
        })).status, 400);

      console.log("\n[11.4.1] 测试钩子：夹具收尾入口只在该开的时候存在");
      /*
       * 自检要在两种后端上都能收尾夹具，因此服务端有一个"绕过删除护栏"的入口。
       * 它**默认不存在**（回 404），只有测试后端（`NEXGENEDU_TEST_HOOKS=1`）才有；
       * 这条断言钉的就是"默认关"这件事 —— 生产后端上它必须打不开。
       */
      const fixtureHook = await request("/api/test-hooks/remove-fixture", {
        method: "POST",
        token: adminToken,
        body: { entity: "students", id: "s_不存在" },
      });
      equal("测试后端开着钩子时，路由存在（这条库是临时库，摘一条不存在的记录回 removed:false）",
        [fixtureHook.status, fixtureHook.body.removed], [200, false]);

      console.log("\n[11.5] 抓取：**永远不会 500**，每年一个结局，且没通过校验就不写盘");
      /*
       * 这里刻意**不要求网络可用**：抓不到时服务端应当回 200 + 每年一个 `rejected`
       * （把"连不上"当成一次可解释的结果），而不是 500 —— 那种失败在界面上只剩一句
       * "服务器内部错误"，而人需要看到的是"哪个源没连上"。
       * 2100 年两个来源都不会有数据，因此**无论有没有网都不会写盘**。
       */
      const refreshed = await request("/api/holidays/refresh", {
        method: "POST",
        token: adminToken,
        body: { years: [2100] },
      });
      equal("抓取回 200（不是 500）", refreshed.status, 200);
      const results = (refreshed.body.results ?? []) as Array<{ year: number; status: string; written: boolean }>;
      equal("结果里就是那一年", results.map((item) => item.year), [2100]);
      check("结局是「还没有公布」或「没通过校验」二者之一（取决于本机能不能连上那两个来源）",
        results[0]?.status === "not-published" || results[0]?.status === "rejected", String(results[0]?.status));
      check("没有写盘（结局不是 written，且下面那条确认文件真的不存在）",
        results[0]?.status !== "written", String(results[0]?.status));
      equal("临时目录里没有被写进 2100.json", existsSync(join(temp, "2100.json")), false);
      equal("原来那一年还在（抓取没把已有数据弄丢）",
        yearsOf(refreshed.body).map((item) => item.year), [goodYear]);
    },
    { env: { NEXGENEDU_HOLIDAY_DIR: temp } },
  );
} catch (cause) {
  failures += 1;
  console.error(`\n✗ 节假日表这一节中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

console.log("\n[11.6] 测试钩子默认关：没有 NEXGENEDU_TEST_HOOKS=1 的后端上，它必须打不开");
try {
  await withTempServer(
    async (base, info) => {
      const loginResponse = await raw(base, "/api/login", {
        method: "POST",
        body: { username: info.username, password: info.password },
      });
      const token = String(loginResponse.body.token ?? "");
      const response = await fetch(`${base}/api/test-hooks/remove-fixture`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ entity: "students", id: "s_x" }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      equal("没有那个环境变量时：404（而不是 200）", response.status, 404);
      check("而且说清了这是测试专用入口",
        String(body.error ?? "").includes("NEXGENEDU_TEST_HOOKS"), String(body.error ?? ""));
    },
    { env: { NEXGENEDU_TEST_HOOKS: "" } },
  );
} catch (cause) {
  failures += 1;
  console.error(`\n✗ 测试钩子那一节中断：${cause instanceof Error ? cause.message : String(cause)}`);
}

console.log(
  failures === 0
    ? "\n=== 服务端认证自检通过 ==="
    : `\n=== 服务端认证自检失败：${failures} 项不成立（上面有细节）===`,
);
process.exit(failures === 0 ? 0 : 1);
