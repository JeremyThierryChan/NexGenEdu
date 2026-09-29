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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// path 用到了 mkdtempSync 的结果拼接（下面 withTempServer）
import path from "node:path";
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

export type RunResult = {
  code: number;
  output: string;
  /** 到了 `timeoutMs` 还没结束、被这里停掉了 —— 调用方要据此给一句人话报错。 */
  timedOut?: boolean;
};

/**
 * 跑一个命令并收全输出（失败原因都在输出里，不能只留最后几行）。
 *
 * `stream: true` 时**边跑边把输出转发到本进程的 stdout/stderr**（同时照样整份攒在
 * `output` 里，所以"拿完整输出做结论"的用法不受影响）。为什么需要它：逐页验收那种
 * 一百多条断言的套件原先要跑完才一次性吐字，于是"卡住了"和"还在跑"在终端上完全
 * 一样 —— 2026-09-25 排查那次，只能靠临时库文件的 mtime 和 `lsof` 去猜它停在哪。
 *
 * `timeoutMs` 是**最后一道**保障：到点 SIGTERM，再给 2 秒，还不退就 SIGKILL。
 * 没有它的话，被调用方一旦卡住（例如服务端转进了死循环、请求永远不回），
 * 这里就永远等不到 `close`，整个命令没有结论、也不退出。
 */
export function run(
  command: string,
  args: string[],
  options: { env?: Record<string, string>; stream?: boolean; timeoutMs?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const collect = (chunk: Buffer, to: NodeJS.WriteStream): void => {
      const text = chunk.toString();
      output += text;
      if (options.stream === true) to.write(text);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, process.stderr));
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, options.timeoutMs);
    }
    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve(timedOut ? { code: code ?? 1, output, timedOut } : { code: code ?? 1, output });
    });
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
  /** 本次测试用的账号口令（脚本靠它登录，见下）。 */
  credentials: { username: string; password: string };
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
  /**
   * **备份目录**（**必填**）。设成 `NEXGENEDU_BACKUP_DIR`，于是这个临时服务写的每一份备份
   * （迁移前快照、每天一份、界面恢复前的另存）都落在那个目录里，绝不去动 `server/backups/`。
   *
   * ## 为什么它是必填、而且还要在运行时再挡一道
   *
   * 临时服务要写备份这件事是**一定会发生**的（起一个空库服务就要跑一遍迁移 → 一份迁移前快照），
   * 因此默认值必须是"能隔离"的那个 —— 早先它是 `backupDir?: string`（可省），
   * 于是 `scripts/check-auth.mts` 里那两处 `startServer({ dbPath })` **真的**把迁移前快照
   * 写进了真实的 `server/backups/`：机器上那 99 份 `nexgenedu-migrate-*.db` 里的一大批
   * 就是这么来的（每次跑一遍权限自检丢一份空快照进去）。
   *
   * 那时它只是"脏"（旧代码从不删迁移前快照）。而 E22 续 给迁移前快照加了**保留份数上限**
   * 之后，同一个路径就变成了**会删东西的**：一次 `npm run check:auth` 就能把真实备份目录里
   * 超出 10 份的迁移前快照全清掉（2026-09-29 真发生过：89 份空快照被清，
   * 详见 PROJECT.md 的「E22 续」）。因此这一版把它改成**必填**（编译期就报错），
   * 并在下面**再挡一道运行时的门**（`backupDir` 不许是真实的 `server/backups`）——
   * "忘了隔离"的失败方向必须是**起不来**，而不是"悄悄动了机构的东西"。
   */
  backupDir: string;
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
  /*
   * 认证（第 6 步）之后，测试脚本也得能登录。
   *
   * 做法：起服务时**指定一个已知口令**（随机生成，只活到本次进程），
   * 脚本再用它调 /api/login 换令牌。这样测试既不需要知道真实口令，
   * 也不会去碰真实凭证文件 —— 而且顺带把"登录这条路"每次运行都走了一遍。
   */
  const credentials = {
    username: "admin",
    password: `test-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  };

  /*
   * 运行时那道门：临时服务的备份目录**绝不许**是真实的 `server/backups/`。
   *
   * 判据是"路径相等"（规范化之后），不是"以 tmpdir 开头"：`scripts/drill-restore.mts`
   * 用的是 `server/data/drill-backups-<时间戳>`（同样是与真实目录分开的一次性目录），
   * 那种用法是正确的，不该被拦。要拦的只有**真实的那个目录**。
   *
   * 为什么宁可在这里让整个脚本起不来：写错一个参数就动到机构的退路，代价无法接受；
   * 而"起不来"会立刻被人看见并修好。
   */
  const resolvedBackup = path.resolve(options.backupDir);
  const realBackup = path.resolve(repoRoot, "server/backups");
  if (resolvedBackup === realBackup) {
    throw new Error(
      "临时服务端的备份目录不能是真实的 server/backups/ —— " +
        "临时服务要跑迁移，于是会往那个目录里写一份迁移前快照，并按 E22 续 的保留上限" +
        "**删掉超出份数的最老几份**（2026-09-29 就是这么清掉 89 份的）。" +
        "请传一个一次性目录（`mkdtempSync(join(tmpdir(), " +
        '"nexgenedu-…-"));`），见 scripts/temp-server.mts 的 withTempServer。',
    );
  }

  const server = spawn(process.execPath, SERVER_ARGS, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEXGENEDU_DB: dbPath,
      PORT: String(port),
      NEXGENEDU_ADMIN_USER: credentials.username,
      NEXGENEDU_ADMIN_PASSWORD: credentials.password,
      NEXGENEDU_BACKUP_DIR: options.backupDir,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // 组长：收尾时按进程组杀，杜绝残留
  });

  let log = "";
  server.stdout.on("data", (chunk) => { log += chunk.toString(); });
  server.stderr.on("data", (chunk) => { log += chunk.toString(); });

  /**
   * 端口上还有人在应答吗。
   *
   * 必须带超时：**卡死的服务端"连得上、不回话"**，没有超时的 `fetch` 会让收尾也
   * 永远等下去（2026-09-25 那次服务端被一个死循环转住，`/health` 就是这种表现）。
   * 判据分成三种，缺一不可：
   *   - 有应答 → 还活着；
   *   - `ECONNREFUSED` → 端口没人监听，真停了；
   *   - 超时 / 说不清 → **当它还在**（宁可多报一次"没停干净"，也不要谎报已停）。
   */
  const probe = async (): Promise<"alive" | "stopped"> => {
    try {
      await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      return "alive";
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      if (name === "TimeoutError" || name === "AbortError") return "alive";
      const code = (cause as { cause?: { code?: string } }).cause?.code;
      return code === "ECONNREFUSED" ? "stopped" : "alive";
    }
  };

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (server.pid !== undefined) process.kill(-server.pid, signal);
      else server.kill(signal);
    } catch {
      try {
        server.kill(signal);
      } catch {
        // 已经不在了
      }
    }
  };

  const waitClose = async (ms: number): Promise<void> => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      server.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const stop = async (): Promise<void> => {
    signalGroup("SIGTERM");
    await waitClose(3000);
    if ((await probe()) === "stopped") return;
    /*
     * 还活着就上 SIGKILL。
     *
     * 为什么非要有这一步：`index.mts` 的 SIGTERM 处理函数要先 `server.close()`，
     * 而**事件循环一旦被卡住（转进了死循环），那个回调根本没有机会运行** ——
     * 进程收到 SIGTERM 却退不掉。2026-09-25 那次就是这样：临时服务一直占着端口与
     * 单写者锁，收尾命令等不到它，工具链从此挂在那里。SIGKILL 不给它机会。
     */
    signalGroup("SIGKILL");
    await waitClose(3000);
    if ((await probe()) === "alive") {
      throw new Error(`服务端（端口 ${port}）没停干净，请检查残留进程。`);
    }
  };

  const health = await waitForHealth(base, options.timeoutMs ?? 30_000).catch(() => null);
  if (health === null) {
    await stop().catch(() => undefined);
    removeDbFiles(dbPath);
    throw new Error(`服务端没起来（${base}/health 无应答）。它自己的输出：\n${log}`);
  }
  /*
   * 比的是**文件名**而不是完整路径：/health 是公开接口，刻意只回库文件名
   * （不回目录、不回表结构、不回各表条数 —— 那些要登录才给，见 /api/status）。
   * 靠文件名认身份已经足够：临时库名里带端口，撞不上真实库。
   */
  const expectedName = dbPath.split("/").pop() ?? dbPath;
  if (String(health.db ?? "") !== expectedName) {
    await stop().catch(() => undefined);
    removeDbFiles(dbPath);
    throw new Error(
      `端口 ${port} 上应答的不是本次启动的服务（/health 报的库是 ${health.db}，` +
      `期望 ${expectedName}）。多半有残留进程占着端口，先清掉再跑。\n服务端输出：\n${log}`,
    );
  }

  return { base, port, dbPath, credentials, log: () => log, stop };
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
  body: (
    base: string,
    info: {
      port: number;
      dbPath: string;
      /**
       * **这次临时服务的备份目录**（一次性临时目录里的 `backups/`，跑完即删）。
       *
       * 交给 `body` 是因为「每天自动备份」那一块（清单 / 恢复）要**测试进程与服务端
       * 看同一个目录**：服务端用它写"恢复前的另存"，测试进程要造一份夹具备份、
       * 还要在恢复之后去数目录里是不是真的多了一份。把两端指向同一个临时目录，
       * 才是"绝不碰 server/backups/"这句话的落地方式。
       */
      backupDir: string;
      username: string;
      password: string;
      /**
       * 临时服务端自己的输出（排查用）。
       *
       * 交给 `body` 是因为**失败时最该看的就是它**：服务端那侧出了什么事，
       * 只有这份日志说得清。以前它只在"服务起不来"那条路径上被打印，
       * 而"起来了、但请求不回"这种卡死恰恰不是那条路径 —— 日志就永远没人看得到。
       */
      log: () => string;
    },
  ) => Promise<T>,
  options: { env?: Record<string, string> } = {},
): Promise<T> {
  const port = await freePort();
  /*
   * 数据库与**凭证**都放进一次性临时目录。
   *
   * 为什么不是放在 `server/data/` 下（哪怕名字带端口）：
   * 凭证文件是"与数据库同目录"的（见 server/auth.mts 的 credentialFile），
   * 临时库若落在真实目录里，就会**把机构真实的口令覆盖成测试口令** ——
   * 真发生过一次：跑完自检之后机构登不进去了。临时目录跑完整个删掉，从根上避免。
   *
   * 库文件名仍带端口：`/health` 只回文件名，自检靠它确认"应答的是本次这个进程"。
   */
  const dir = mkdtempSync(path.join(tmpdir(), "nexgenedu-check-"));
  const dbPath = path.join(dir, `db-${port}.sqlite`);
  /*
   * 备份目录也放进同一个一次性临时目录。
   *
   * 原先不设它 → 临时服务的**迁移前快照**会写进真实的 `server/backups/`
   * （每起一个临时服务就丢一个空库备份进去）。脏只是表面问题，真正的危险是
   * 那些文件会满足「今天已经备份过」的判定，于是**真实库当天一份备份都没有** ——
   * 假备份挤掉真备份，是备份机制最坏的一种失效方式。
   * 现在从环境变量这一层就隔离开（`scripts/check-both.mts` 跑完还会再对一次目录，双保险）。
   */
  const backupDir = path.join(dir, "backups");

  const handle = await startServer({
    dbPath,
    port,
    backupDir,
    /*
     * `NEXGENEDU_TEST_HOOKS=1`：打开"夹具收尾"入口（`/api/test-hooks/remove-fixture`）。
     *
     * 为什么必须开：自检要在**两种后端**上跑同一套断言（`npm run check:both`），
     * 而产品层的删除有护栏（有账就不许删）—— 夹具造的正是"有账"的数据，
     * 因此需要一条只能由测试后端提供的收尾入口。生产后端不设这个变量，该路径回 404。
     */
    env: { NEXGENEDU_NO_BACKUP: "1", NEXGENEDU_TEST_HOOKS: "1", ...(options.env ?? {}) },
  });
  try {
    return await body(handle.base, {
      port,
      dbPath,
      backupDir,
      username: handle.credentials.username,
      password: handle.credentials.password,
      log: handle.log,
    });
  } finally {
    await handle.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 探活：等到 /health 真的应答，或超时（返回 null）。
 *
 * 每次请求都带超时（2 秒）：不带的话，"端口上有人监听但不回话"会让这一次 `fetch`
 * 永远不返回 —— 那样下面那个 `deadline` 只是看着像超时，实际永远轮不到判断，
 * 调用方（`startServer`）也就永远不返回。
 */
async function waitForHealth(
  base: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return (await response.json()) as Record<string, unknown>;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}
