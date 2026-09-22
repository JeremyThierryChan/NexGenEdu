/**
 * **单写者锁**：同一个库文件，只允许一个后端进程。
 *
 * ## 为什么必须要有它
 *
 * 这份后端把整个库当作**一份 JSON 快照**存在 SQLite 的一个 kv 行里
 * （见 `kv-store.mts` 开头那段取舍说明）：每个进程在内存里持有一份库对象，
 * 改动之后**整份落盘**。于是两个进程盯同一个库文件时会发生两件坏事：
 *
 *   1. 读到的可能是**撕裂的 JSON**（我实测复现过：第二个进程读快照直接
 *      `Unexpected non-whitespace character after JSON` → 所有数据接口 500）；
 *   2. 更糟的是**静默丢数据** —— 两个进程各改各的，**后落盘的那份整体覆盖前一份**，
 *      前一个进程期间的改动无声消失。它不报错、不留痕，要到对账时才发现。
 *
 * 所以这里的做法是**拒绝启动**，而不是"尽力兼容"：宁可让人看到一句
 * "已经有一个后端在跑，先停掉它"，也不要让两个进程一起悄悄毁数据。
 * 这条纪律与项目里其它几处一致（宁可少排一节并说清楚、不要静默截断余额）。
 *
 * ## 什么情况下不管
 *
 * `:memory:`（内存库）不落盘、不存在共享，直接放行。临时库（自检/验收/演练用的
 * `NEXGENEDU_DB=/tmp/xxx.db`）各有各的路径，各自一把锁，互不影响。
 *
 * ## 陈旧锁怎么判
 *
 * 进程被 `kill -9` 时来不及删锁文件。因此锁文件里记下
 * **PID + 库路径 + 启动时间**，判定规则是：
 *   - 库路径不一致 → 不是同一份库，删掉重取（例如换了库文件）；
 *   - PID 已经不存在 → 陈旧锁，删掉重取；
 *   - PID 存在 → 认为它在跑，**拒绝启动**（附上 PID 与启动时间，方便人去停）。
 * 只凭 PID 会在"PID 被系统复用"时误判，因此同时写出启动时间与库路径，
 * 日志里把它们都打出来 —— 万一真误判了，人一眼能看出那个 PID 是不是我们的后端。
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

/** 锁文件内容。 */
type LockInfo = {
  pid: number;
  /** 库文件的绝对路径：换了库就当另一把锁，不会被旧锁挡住。 */
  dbPath: string;
  /** 本进程启动时间（ISO）：误判时用来对照。 */
  startedAt: string;
  /** 这个进程当时监听的地址（日志用，不参与判定）。 */
  note: string;
};

export type DbLockResult =
  | { ok: true; file: string; release: () => void }
  | { ok: false; reason: string };

/** 锁文件路径：与库文件同目录同名 + `.lock`。 */
export function lockFileFor(dbPath: string): string {
  return `${dbPath}.lock`;
}

/** 这个 PID 还活着吗（信号 0 只做存在性检查，不真的发信号）。 */
function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM = 进程存在但没权限发信号（也说明它活着）；ESRCH = 不存在
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(file: string): LockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number" || typeof parsed.dbPath !== "string") return null;
    return {
      pid: parsed.pid,
      dbPath: parsed.dbPath,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "（未知）",
      note: typeof parsed.note === "string" ? parsed.note : "",
    };
  } catch {
    // 内容坏了（写了一半就被杀）：当作陈旧锁处理，下面会删掉重取
    return null;
  }
}

/**
 * 取锁：成功返回 `{ ok: true, release }`，失败返回一句给人看的原因。
 *
 * `release` 必须挂到进程退出路径上（见 `index.mts`），否则每次 Ctrl+C
 * 都会留下一个陈旧锁 —— 虽然陈旧锁能自动判废，但那要多绕一圈（PID 检查），
 * 而"正常退出就该清干净"是更省事的规矩。
 */
export function acquireDbLock(dbPath: string, listenNote = ""): DbLockResult {
  if (dbPath === ":memory:") {
    return { ok: true, file: "", release: () => {} };
  }

  const file = lockFileFor(dbPath);
  const existing = existsSync(file) ? readLock(file) : null;

  if (existing !== null && existing.dbPath === dbPath && processAlive(existing.pid)) {
    return {
      ok: false,
      reason:
        `这个库已经被另一个后端进程占着：PID ${existing.pid}（启动于 ${existing.startedAt}` +
        `${existing.note === "" ? "" : `，${existing.note}`}）。\n` +
        "  两个进程同时写同一份快照会**静默丢数据**（后落盘的整体覆盖前一份），因此这里拒绝启动。\n" +
        `  处理办法：先停掉那个进程（在它的终端按 Ctrl+C，或 \`kill ${existing.pid}\`），再启动。\n` +
        `  如果确认那个 PID 不是本系统（PID 被复用），删掉锁文件再启动：${file}`,
    };
  }

  /*
   * 陈旧锁（或不属于这个库的锁）：**先删掉**再原子创建。
   *
   * 这一步是实测补上的：我第一版直接 `writeFileSync(..., { flag: "wx" })`，
   * 于是 `kill -9` 留下的陈旧锁永远挡着新进程 —— 而且报的还是"另一个进程正在启动"，
   * 因为 `wx` 撞上了那个陈旧文件。删掉之后 `wx` 才是真正的互斥点。
   */
  if (existsSync(file)) {
    const stillThere = readLock(file);
    if (stillThere !== null && stillThere.dbPath === dbPath && processAlive(stillThere.pid)) {
      // 这中间刚好又有一个进程把它接管了（极窄的竞态）：交给下面的 wx 去撞
    } else {
      rmSync(file, { force: true });
    }
  }

  const info: LockInfo = {
    pid: process.pid,
    dbPath,
    startedAt: new Date().toISOString(),
    note: listenNote,
  };
  /*
   * `flag: "wx"` = 文件已存在就失败。为什么不用"先检查再写"：
   * 两个进程同时启动时，两边都可能先看到"文件不存在"，然后各写各的 —— 锁就形同虚设。
   * 原子创建才是真正的互斥点。
   */
  try {
    writeFileSync(file, `${JSON.stringify(info, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      // 竞态：刚好有另一个进程也在启动。重新读一次它的信息（此刻它一定已经写好了）
      const racer = readLock(file);
      return {
        ok: false,
        reason:
          `另一个后端进程正在启动（PID ${racer?.pid ?? "未知"}），它已经占住了这个库。\n` +
          `  处理办法：等它起来后用那个进程，或先停掉它。锁文件：${file}`,
      };
    }
    throw cause;
  }

  return {
    ok: true,
    file,
    release: () => {
      // 只删"还是自己写的那把锁"：万一期间被别人接管过，不要误删别人的
      const current = readLock(file);
      if (current !== null && current.pid !== process.pid) return;
      rmSync(file, { force: true });
    },
  };
}
