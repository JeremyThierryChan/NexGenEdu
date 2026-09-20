/**
 * 临时服务端夹具：起一个**真实的服务端进程 + 临时 SQLite 库**，把它的地址交给调用方。
 *
 * ## 为什么需要它（两次真实的教训）
 *
 * 1. **端口被残留进程占着**：上一轮用 `npm run server &` 起服务、`kill $!` 收尾，
 *    但 `npm run` 会多套一层 shell，被杀掉的只是外层，真正的 node 服务继续占着端口。
 *    下一次运行的探活照样成功 —— 应答的却是**旧进程**，于是"验证了新代码"
 *    变成了假话：新进程其实 EADDRINUSE 直接退出了。所以这里
 *      · 用 `detached` 起、杀**整个进程组**；
 *      · 探活之后再核对 `/health` 报的库路径就是本次的临时库，对不上就报错；
 *      · 收尾后确认端口真的空出来了。
 * 2. **忘了指向服务端**：`createKeyValueStore()` 在 Node 里会退化成内存存储，
 *    因此"忘了设 `NEXT_PUBLIC_API_BASE`"不会报错，而是安静地测了伪后端，
 *    还照样打印全绿。凡是要验真实后端的脚本，都必须由这里**显式**把地址交过去。
 *
 * 临时库固定叫 `server/data/*-check-<port>.db`，取名带端口就不会和真实库
 * （`server/data/nexgenedu.db`）撞上；跑完即删，绝不碰真实数据。
 */

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "node:net";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 要一个真的没人用的端口：写死端口迟早撞上残留进程。 */
export function freePort(): Promise<number> {
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

export type RunResult = { code: number; output: string };

/** 跑一个命令并收全输出（失败原因都在输出里，不能只留最后几行）。 */
export function run(
  command: string,
  args: string[],
  options: { env?: Record<string, string> } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** 起服务端的参数（与 `npm run server` 同一份实现，只是换库与端口）。 */
const SERVER_ARGS = [
  "--experimental-strip-types",
  "--import",
  "./server/loader.mjs",
  "server/index.mts",
];

function removeDbFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = join(repoRoot, `${dbPath}${suffix}`);
    if (existsSync(file)) rmSync(file);
  }
}

export type ServerHandle = {
  base: string;
  port: number;
  dbPath: string;
  /** 服务端自己的输出（排查用；起不来时最先要看的就是它）。 */
  log: () => string;
  /**
   * 停掉服务并等它真的退出，然后确认端口空出来了。
   * 恢复演练（`scripts/drill-restore.mts`）要停服务再换回备份文件，这一步必须可靠。
   */
  stop: () => Promise<void>;
};

export type StartServerOptions = {
  /** 数据库文件（相对仓库根；调用方负责它是"临时库"，别指向真实库）。 */
  dbPath: string;
  /** 端口；不传就自动挑一个没人用的。 */
  port?: number;
  /** 额外的环境变量（例如指定备份目录）。 */
  env?: Record<string, string>;
  /** 就绪前等多久（默认 30 秒）。 */
  timeoutMs?: number;
};

/**
 * 起一个服务端进程并**核验它真的就绪**（演练要反复起停，所以单独抽出来）。
 *
 * 核验两件事，缺一不可：① `/health` 有应答；② 应答里的库路径就是本次要用的那个。
 * 第二条是踩出来的 —— 残留进程占着端口时，新进程会 EADDRINUSE 退出，而探活
 * 照样成功（应答的是旧进程），于是"验证了新代码"变成假话。
 */
export async function startServer(options: StartServerOptions): Promise<ServerHandle> {
  const port = options.port ?? (await freePort());
  const { dbPath } = options;
  const base = `http://127.0.0.1:${port}`;

  const server = spawn(process.execPath, SERVER_ARGS, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXGENEDU_DB: dbPath,
      PORT: String(port),
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // 组长：收尾时按进程组杀，杜绝残留
  });

  let log = "";
  server.stdout.on("data", (chunk) => { log += chunk.toString(); });
  server.stderr.on("data", (chunk) => { log += chunk.toString(); });

  const stop = async (): Promise<void> => {
    try {
      if (server.pid !== undefined) process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.once("close", () => { clearTimeout(timer); resolve(); });
    });
    const stillUp = await fetch(`${base}/health`).then(() => true).catch(() => false);
    if (stillUp) throw new Error(`服务端（端口 ${port}）没停干净，请检查残留进程。`);
  };

  const health = await waitForHealth(base, options.timeoutMs ?? 30_000).catch(() => null);
  if (health === null) {
    await stop().catch(() => undefined);
    removeDbFiles(dbPath);
    throw new Error(`服务端没起来（${base}/health 无应答）。它自己的输出：\n${log}`);
  }
  if (!String(health.db ?? "").includes(dbPath)) {
    await stop().catch(() => undefined);
    removeDbFiles(dbPath);
    throw new Error(
      `端口 ${port} 上应答的不是本次启动的服务（/health 报的库是 ${health.db}，` +
      `期望包含 ${dbPath}）。多半有残留进程占着端口，先清掉再跑。\n服务端输出：\n${log}`,
    );
  }

  return { base, port, dbPath, log: () => log, stop };
}

/**
 * 起一个**临时**服务端，把地址交给 `body`，跑完一定收尾（停服务、删临时库）。
 *
 * 临时库叫 `server/data/dual-check-<port>.db`：带端口就不会和真实库
 * （`server/data/nexgenedu.db`）撞上，也一眼看得出是测试产物。
 *
 * 自动备份对临时库没有意义，还会把测试数据混进真实备份目录
 * （那种文件被人当成真备份去恢复就是事故），因此默认关掉。
 */
export async function withTempServer<T>(
  // 形参刻意不叫 `use`：eslint 的 react-hooks 规则会把它当成 Hook 调用（误报）
  body: (base: string, info: { port: number; dbPath: string }) => Promise<T>,
  options: { env?: Record<string, string> } = {},
): Promise<T> {
  const port = await freePort();
  const dbPath = `server/data/dual-check-${port}.db`;

  // 端口被复用时可能残留同名库，先清掉：要的是**空库**这个起点
  removeDbFiles(dbPath);

  const handle = await startServer({
    dbPath,
    port,
    env: { NEXGENEDU_NO_BACKUP: "1", ...(options.env ?? {}) },
  });
  try {
    return await body(handle.base, { port, dbPath });
  } finally {
    await handle.stop();
    removeDbFiles(dbPath);
  }
}

/** 探活：等到 /health 真的应答，或超时（返回 null）。 */
async function waitForHealth(
  base: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return (await response.json()) as Record<string, unknown>;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}
