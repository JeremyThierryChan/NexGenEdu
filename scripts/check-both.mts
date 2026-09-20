/**
 * 同一套自检，对**两种后端**各跑一遍（内存 + HTTP）。
 *
 * ## 为什么这件事重要（docs/后端开发方案.md §5 第 7 步）
 *
 * 后端从"浏览器里的 localStorage"换成"本机的 Node + SQLite"时，做法是让服务端
 * 复用**同一份** `api.ts`（路线 B，见 §5.3），因此理论上口径只有一份、结果必须一样。
 * 但"理论上一样"不是证据 —— 第一次真的跑起来就抓到四处**静默**的差异：
 *
 *   - `hasBackup()` / `setOperator()` 是同步方法，经远端代理后变成 Promise：
 *     `if (api.hasBackup())` 恒为真（"有没有备份"永远答有）；
 *   - 自检依赖"首次访问自动灌示例学生"，而服务端是空库起步，于是断言对不上；
 *   - 老库升级那几段把数据写进**浏览器存储**再读回来，走服务端时读的是 SQLite，
 *     断言全绿却什么都没验（**假通过**）。
 *
 * 这些错误都不报错、只答错，只有把同一套断言在两种后端上都跑一遍才会露出来。
 * 所以这个脚本做三件事，顺序都不能省：
 *   1. 跑一遍内存后端（`npm run check`）—— 断言在这里全绿是前提；
 *   2. 起一个**临时库**的服务端（`scripts/temp-server.mts` 负责起服务、核验进程、收尾）；
 *   3. 把 `NEXT_PUBLIC_API_BASE` 指向它，跑**同一份** check.mts。
 *
 * 两边都必须 0 失败才算通过。任何一边失败都原样打印那份输出，不做二次解释。
 *
 * 用法：`npm run check:both`
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { run, repoRoot, withTempServer } from "./temp-server.mts";

/** 自检脚本自身只需要 Node 的类型剥离与 `@/` 别名解析。 */
const CHECK_ARGS = [
  "--experimental-strip-types",
  "--import",
  "./server/loader.mjs",
  "scripts/check.mts",
];

console.log("=== 第一遍：内存后端（服务层的本地存储实现）===");
const memoryRun = await run(process.execPath, CHECK_ARGS);
process.stdout.write(memoryRun.output);
if (memoryRun.code !== 0) {
  console.error("\n✗ 内存后端这一遍就没过 —— 先把它修绿，再谈「两种后端一致」。");
  process.exit(memoryRun.code);
}
console.log("✓ 内存后端：全部通过");

console.log("=== 第二遍：HTTP 后端（真实服务端 + 临时 SQLite 库）===");
/*
 * 回归护栏：临时服务**绝不许**往真实备份目录里写东西。
 *
 * 这一条是踩出来的：迁移器"执行前自动备份"写死了真实备份目录，于是每起一个临时服务
 * 都往 server/backups/ 丢一个空库备份。脏只是表面问题，真正的危险是那些文件会满足
 * "今天已经备份过"的判定 —— **真实库当天一份备份都不会有**，假备份挤掉真备份。
 * 所以这里在跑之前记下份数，跑完必须一模一样。
 */
const realBackupDir = join(repoRoot, "server/backups");
const backupsBefore = readdirSync(realBackupDir).sort().join("|");

let exitCode = 1;
try {
  exitCode = await withTempServer(async (base, info) => {
    console.log(`✓ 服务端就绪：${base}（临时库 ${info.dbPath}）`);
    const remoteRun = await run(process.execPath, CHECK_ARGS, {
      env: { NEXT_PUBLIC_API_BASE: base },
    });
    process.stdout.write(remoteRun.output);
    return remoteRun.code;
  });
} catch (cause) {
  console.error(`✗ 起临时服务端失败：${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(1);
}

const backupsAfter = readdirSync(realBackupDir).sort().join("|");
if (backupsAfter !== backupsBefore) {
  console.error(
    "\n✗ 临时服务动了真实备份目录（server/backups/）—— 这是必须修的问题：\n" +
    "  测试库的备份会满足「今天已备份」，让真实库当天没有备份。\n" +
    "  检查 migrate.mts / backup.mts 是否尊重 NEXGENEDU_NO_BACKUP 与 NEXGENEDU_BACKUP_DIR。",
  );
  process.exit(1);
}
console.log("✓ 真实备份目录未被临时服务改动");

if (exitCode === 0) {
  console.log("\n✓ HTTP 后端：全部通过");
  console.log(
    "\n=== 两种后端（内存 / HTTP）跑的是同一份 check.mts，都全部通过 ===\n" +
    "这是「换后端没改口径」的证据：断言一条没改，只是把后端换成了真实服务端。",
  );
} else {
  console.error("\n✗ HTTP 后端未通过 —— 上面是它的完整输出，差异就在里面。");
}
process.exit(exitCode);
