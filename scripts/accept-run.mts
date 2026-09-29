/**
 * 逐页验收的运行器：**自己起临时后端**，再跑 `accept-check.mts`。
 *
 * ## 为什么要有这一层
 *
 * `accept-check.mts` 的整套价值在于"对着**真实后端**做真实写操作"。但它自己是
 * 一个普通脚本：忘了设 `NEXT_PUBLIC_API_BASE` 时，`createKeyValueStore()` 会在
 * Node 里退化成**内存存储**，于是它安静地测了伪后端，还照样打印
 * 「43/43 通过（逐页验收全部通过）」—— 这是一份**假证据**，比不跑更糟。
 *
 * 所以把"起服务 + 指对地址 + 收尾"都收进这一层，`npm run accept` 一条命令就能给出
 * 可信结论；`accept-check.mts` 里再留一道"没指向服务端就直接退出"的闸。
 *
 * 用法：`npm run accept`
 */

import { run, withTempServer } from "./temp-server.mts";

const ACCEPT_ARGS = [
  "--experimental-strip-types",
  "--import",
  "./server/loader.mjs",
  "scripts/accept-check.mts",
];

/*
 * 子进程的总时限。
 *
 * 正常一轮十几秒到几十秒（本机还同时跑着 dev 与真后端），所以 5 分钟是很宽的余量。
 * 它换来的是**这条命令一定会有结论**：套件里任何一处卡住（服务端转进死循环、
 * 请求永远不回……）都不再表现为"挂在那里、什么都不输出、也不退出"——
 * 那正是 2026-09-25 那次「`npm run accept` 永不结束」的样子，排查时完全没有抓手。
 * 到点会停掉子进程、把服务端日志尾部打出来，并以非零码退出。
 */
const CHILD_TIMEOUT_MS = Number(process.env.NEXGENEDU_ACCEPT_TIMEOUT_MS ?? 300_000);

/** 打印临时服务端日志的尾部（卡死/失败时最该看的证据）。 */
function printServerLogTail(log: string, lines: number): void {
  console.error(`\n── 临时服务端日志（尾部 ${lines} 行）──`);
  console.error(log.split("\n").slice(-lines).join("\n"));
}

console.log("=== 逐页验收（真实服务端 + 临时 SQLite 库，真实读写）===");
let exitCode = 1;
try {
  exitCode = await withTempServer(async (base, info) => {
    console.log(`✓ 服务端就绪：${base}（临时库 ${info.dbPath}，不碰真实数据）\n`);
    /*
     * `stream: true`：子进程的输出**边跑边打印**。
     *
     * 原先这里是"攒完整份再一次性 `process.stdout.write`"，于是这个一百多条断言的
     * 套件在终端上是**一声不吭地跑**：「卡在第 60 条」与「正在正常跑」看起来一模一样，
     * 排查只能靠临时库文件的 mtime、`lsof` 这种旁证去猜（2026-09-25 那次就是这样，
     * 结论一度还猜反了）。改成流式之后，停住的地方直接就是最后打印的那一行。
     *
     * 退出码与"完整输出"的用法一个字没改：输出照样整份收在 `result.output` 里，
     * 只是不再重复打印一遍。
     */
    const result = await run(process.execPath, ACCEPT_ARGS, {
      env: {
        NEXT_PUBLIC_API_BASE: base,
        // 第 6 步之后接口要登录：把本次测试账号交给验收脚本
        NEXGENEDU_ADMIN_USER: info.username,
        NEXGENEDU_ADMIN_PASSWORD: info.password,
        /*
         * 「每天自动备份」那一块（数据与备份页）：验收要造一份夹具备份、再点"恢复"。
         * 备份目录一律用**这次临时服务的一次性临时目录** ——
         * 验收绝不能碰 `server/backups/`（那里的每一份都是机构的真实退路）。
         */
        NEXGENEDU_BACKUP_DIR: info.backupDir,
      },
      stream: true,
      timeoutMs: CHILD_TIMEOUT_MS,
    });
    if (result.timedOut === true) {
      console.error(
        `\n✗ 验收脚本跑了 ${(CHILD_TIMEOUT_MS / 1000).toFixed(1)} 秒还没结束，已把它停掉。\n` +
          "  上面最后一行就是它停住的地方（流式输出，不再需要靠猜）。",
      );
      printServerLogTail(info.log(), 25);
    } else if (result.code !== 0) {
      // 失败时也把服务端那侧发生了什么带出来（它不会自己出现在验收脚本的输出里）
      printServerLogTail(info.log(), 15);
    }
    return result.code;
  },
  /*
   * ── 这一轮的临时服务**把备份开着**（`NEXGENEDU_NO_BACKUP=0`）────────────────────
   *
   * `temp-server.mts` 给所有临时服务的默认值是 `NEXGENEDU_NO_BACKUP=1`（"自检/验收起的是临时库，
   * 别往真实备份目录丢文件"）。而验收里有一条要验的正是**界面上的「立刻备份一份」按钮**
   * （机构原话：「加『立刻备份一份』按钮」）：那一按就是"生成一份备份文件"，
   * 备份被关掉时它会**明确拒绝**（这是对的行为），于是按钮永远验不到。
   *
   * 打开它安全吗？安全，而且只有这一处例外：这一轮的备份目录是 `withTempServer` 给的
   * **一次性临时目录**（`NEXGENEDU_BACKUP_DIR` 同时交给服务端与验收脚本），
   * 生成的文件随临时目录一起删掉 —— `server/backups/` 一个字节都不碰。
   * `backupsDisabled()` 只认 `"1"`，因此 `"0"` 等于打开。
   */
  { env: { NEXGENEDU_NO_BACKUP: "0" } });
} catch (cause) {
  console.error(`✗ 起临时服务端失败：${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
}

if (exitCode !== 0) {
  console.error("\n✗ 逐页验收未通过 —— 上面是它的完整输出。");
}
process.exit(exitCode);
