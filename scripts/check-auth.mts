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

import { withTempServer } from "./temp-server.mts";

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

console.log("=== 服务端认证自检（真实 HTTP，未登录者一律当外人）===");

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

    console.log("\n[7] 老接口登录后可读（会话同样生效）");
    const fresh = await raw(base, "/api/login", {
      method: "POST", body: { username: info.username, password: info.password },
    });
    const freshToken = String(fresh.body.token ?? "");
    equal("重新登录后老接口可读", (await raw(base, "/api/students", { token: freshToken })).status, 200);
    // 老接口同样按会话记操作人：走旧入口也不能把"谁改的"丢掉
    await raw(base, "/api/payments", {
      method: "POST",
      token: freshToken,
      body: { studentId: createdId, amount: 100, kind: "收款", method: "微信", note: "认证自检" },
    });
    const afterOldRoute = await call(base, freshToken, "logs.list", [20]);
    const oldRouteLog = ((afterOldRoute.body.result ?? []) as Array<{ action?: string; operator?: string }>)
      .find((row) => row.action === "收款");
    equal("走老接口写入的日志也带操作人（不是默认值）", oldRouteLog?.operator, info.username);
  });
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
