/**
 * 手动备份 + 查看备份清单。
 *
 * 服务端自己会每天备一份（见 `server/index.mts` 的 `scheduleBackups`），那为什么还要这个：
 *
 *   1. **要动数据之前先手动备一份**（导入、清理、批量改价）—— 自动的那份是今天的早上的，
 *      不是"你正要动手之前"的；
 *   2. **服务没开的时候也能备**：它直接开数据库文件，不需要后端在跑；
 *   3. **接系统级定时任务**：不想让"有没有备份"取决于后端进程开着没有，
 *      就用 cron / launchd 定时跑这个（用法写在 docs/使用手册.md）。
 *
 * 用法：
 *   npm run server:backup            # 备份一份，并按保留份数清理
 *   npm run server:backup -- --list  # 只看清单，不备份
 *   npm run server:backup -- --force # 忽略"今天已备份"，再备一份
 */

import { openDatabase, DB_PATH } from "./db.mts";
import { backupDir, backupKeep, listBackups, takeBackup, backedUpToday } from "./backup.mts";

const args = new Set(process.argv.slice(2));
const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

function printList(): void {
  const all = listBackups();
  console.log(`备份目录：${backupDir()}`);
  console.log(`保留份数：${backupKeep()}（可用 NEXGENEDU_BACKUP_KEEP 调整）`);
  if (all.length === 0) {
    console.log("（还没有任何备份）");
    return;
  }
  console.log(`现有 ${all.length} 份（最新的在前）：`);
  for (const item of all.slice(0, 10)) {
    console.log(`  ${item.name}  ${kb(item.bytes)}`);
  }
  if (all.length > 10) console.log(`  …另外 ${all.length - 10} 份`);
}

if (args.has("--list")) {
  printList();
} else {
  const db = openDatabase(DB_PATH);
  try {
    if (backedUpToday() && !args.has("--force")) {
      console.log("今天已经备份过了，本次不再重复备（要强行再备一份就加 --force）。");
      printList();
      process.exit(0);
    }
    const outcome = takeBackup(db);
    console.log(`已备份：${outcome.file}（${kb(outcome.bytes)}，数据库 ${DB_PATH}）`);
    for (const name of outcome.removed) console.log(`按保留份数清理：${name}`);
    console.log(`现有 ${outcome.total} 份。`);
  } finally {
    db.close();
  }
}
