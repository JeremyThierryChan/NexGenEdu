/**
 * 同一套自检，对**两种后端**各跑一遍（内存 + HTTP）。
 *
 * ## 为什么这件事重要（docs/后端开发方案.md §5 第 7 步）
 *
 * 后端从"浏览器里的 localStorage"换成"本机的 Node + SQLite"时，做法是让服务端
 * 复用**同一份** `api.ts`（路线 B，见 §5.3），因此理论上口径只有一份、结果必须一样。
 * 但"理论上一样"不是证据 —— 这一轮就实际抓到过：`hasBackup()` / `setOperator()`
 * 是同步方法，经远端代理后**静默**变成 Promise，`if (api.hasBackup())` 恒为真。
 * 这种错误不报错、只答错，只有把同一套断言在两种后端上都跑一遍才会露出来。
 *
 * 所以这个脚本做三件事，顺序都不能省：
 *   1. 跑一遍内存后端（`npm run check`）—— 断言在这里全绿是前提；
 *   2. 起一个**临时库**的服务端（绝不碰 `server/data/nexgenedu.db`），
 *      探活确认是我们刚起的那个进程（端口被别人占着的话会连到旧进程上，
 *      于是"验证了新代码"变成假话 —— 这个坑上一轮真的踩到了）；
 *   3. 把 `NEXT_PUBLIC_API_BASE` 指向它，跑**同一份** check.mts。
 *
 * 两边都必须 0 失败才算通过。任何一边失败都原样打印那份输出，不做二次解释。
 *
 * 用法：
 *   npm run check:both
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 先要一个真的没人用的端口：写死端口会撞上上一轮没杀干净的进程。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** 跑一个命令，返回 { code, output }（输出要留全：失败原因都在里面）。 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** 探活：等到 /health 真的应答，或超时。 */
async function waitForHealth(base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return await response.json();
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

const checkArgs = ["--experimental-strip-types", "--import", "./server/loader.mjs", "scripts/check.mts"];

console.log("=== 第一遍：内存后端（服务层的本地存储实现）===");
const memoryRun = await run(process.execPath, checkArgs);
process.stdout.write(memoryRun.output);
if (memoryRun.code !== 0) {
  console.error("\n✗ 内存后端这一遍就没过 —— 先把它修绿，再谈「两种后端一致」。");
  process.exit(memoryRun.code);
}
console.log("✓ 内存后端：全部通过");

console.log("\n=== 第二遍：HTTP 后端（真实服务端 + 临时 SQLite 库）===");
const port = await freePort();
const dbPath = `server/data/dual-check-${port}.db`;
const base = `http://127.0.0.1:${port}`;

// 临时库可能上次残留（同名端口被复用），先清掉：要的是**空库**这个起点
for (const suffix of ["", "-wal", "-shm"]) {
  const file = join(root, `${dbPath}${suffix}`);
  if (existsSync(file)) rmSync(file);
}

const server = spawn(
  process.execPath,
  ["--experimental-strip-types", "--import", "./server/loader.mjs", "server/index.mts"],
  {
    cwd: root,
    env: { ...process.env, NEXGENEDU_DB: dbPath, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    /*
     * `detached` + 杀**进程组**：`npm run server` 会多套一层 shell，
     * 只 kill 那一层会留下真正的 node 服务继续占着端口 —— 上一轮就是这样：
     * 残留进程没死，下一次运行的探活照样成功（应答的是旧进程），
     * 于是"验证了新代码"变成了假话。这里直接杀整个进程组，杜绝这种情况。
     */
    detached: true,
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

let exitCode = 1;
try {
  const health = await waitForHealth(base);
  if (health === null) {
    console.error(`✗ 服务端没起来（${base}/health 无应答）。它自己的输出：\n${serverLog}`);
    process.exit(1);
  }
  /*
   * 确认这个端口上应答的**就是我们刚起的那个进程**。
   *
   * 为什么非要这一条：端口被上一轮的残留进程占着时，`spawn` 的新进程会
   * EADDRINUSE 退出，而探活照样成功（应答的是旧进程）—— 于是整遍"验证"实际
   * 验的是**旧代码**，结论却写着"新代码两种后端一致"。上一轮就是这么被骗过去的。
   * 库路径写在 /health 里，因此对得上才算数。
   */
  if (!String(health.db ?? "").includes(dbPath)) {
    console.error(
      `✗ 端口 ${port} 上应答的不是本次启动的服务（/health 报的库是 ${health.db}，` +
      `期望包含 ${dbPath}）。多半有残留进程占着端口，先清掉再跑。`,
    );
    console.error(`服务端输出：\n${serverLog}`);
    process.exit(1);
  }
  console.log(`✓ 服务端就绪：${base}（临时库 ${dbPath}，结构版本 v${health.schemaVersion}）`);

  const remoteRun = await run(process.execPath, checkArgs, {
    env: { NEXT_PUBLIC_API_BASE: base },
  });
  process.stdout.write(remoteRun.output);
  exitCode = remoteRun.code;

  if (remoteRun.code === 0) {
    console.log("\n✓ HTTP 后端：全部通过");
    console.log(
      "\n=== 两种后端（内存 / HTTP）跑的是同一份 check.mts，都全部通过 ===\n" +
      "这是「换后端没改口径」的证据：断言一条没改，只是把后端换成了真实服务端。",
    );
  } else {
    console.error(`\n✗ HTTP 后端未通过（退出码 ${remoteRun.code}）。`);
    console.error(`服务端输出（供排查）：\n${serverLog}`);
  }
} finally {
  // 杀整个进程组（`detached` 起的就是组长），并确认它真的退了
  try {
    if (server.pid !== undefined) process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    server.once("close", () => { clearTimeout(timer); resolve(); });
  });
  /*
   * 收尾后**确认端口真的空出来了**：没空就说明还留着一个服务在跑，
   * 下一次运行会被它骗过去（探活成功但应答的是旧进程）。宁可这里报错。
   */
  const stillUp = await fetch(`${base}/health`).then(() => true).catch(() => false);
  if (stillUp) {
    console.error(`✗ 临时服务（端口 ${port}）没被清理干净，请手动检查残留进程。`);
    exitCode = exitCode === 0 ? 1 : exitCode;
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = join(root, `${dbPath}${suffix}`);
    if (existsSync(file)) rmSync(file);
  }
}

process.exit(exitCode);
