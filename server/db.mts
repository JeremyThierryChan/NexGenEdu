/**
 * SQLite 连接（better-sqlite3）。
 *
 * 三个 PRAGMA 都是有理由的，不是抄来的：
 *   - WAL：读不阻塞写。导出/报表（读）与排课（写）会同时发生；
 *   - foreign_keys=ON：SQLite 默认**不**强制外键，必须显式打开；
 *   - busy_timeout：真有两个写同时进来时等一会儿，而不是立刻抛 SQLITE_BUSY
 *     （单机开发够用；将来多人并发要换成 Postgres，见 docs/后端开发方案.md）。
 *
 * 同步 API 是刻意选的：一个请求 = 一个事务，用 db.transaction() 包住
 * 「改数字 + 写流水 + 写日志」这类多表动作，不需要到处 await，也不会把事务边界写错。
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 数据目录：server/data/（不进 git），可用 NEXGENEDU_DB 覆盖。 */
export const DATA_DIR = process.env.NEXGENEDU_DB_DIR ?? path.join(HERE, "data");
export const DB_PATH = process.env.NEXGENEDU_DB ?? path.join(DATA_DIR, "nexgenedu.db");
/** 备份目录：server/backups/。 */
export const BACKUP_DIR = path.join(HERE, "backups");

export function openDatabase(file: string = DB_PATH): Database.Database {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** 在线备份（不用停服务）。VACUUM INTO 要求目标文件不存在。 */
export function backupTo(db: Database.Database, file?: string): string {
  const target = file ?? path.join(BACKUP_DIR, backupFileName(new Date()));
  /*
   * 建的是**目标文件所在目录**，不是默认备份目录。
   *
   * 这里踩过一次：原来写的是 `mkdirSync(BACKUP_DIR)`，于是把目标指到别的目录
   * （演练与测试要隔离到临时目录）时，VACUUM INTO 报 SQLITE_CANTOPEN 直接失败 ——
   * 而 `backupTo` 的参数签名明明允许传任意路径。收尾时服务起不来才发现。
   */
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) return target;
  db.prepare("VACUUM INTO ?").run(target);
  return target;
}

// ── 备份文件名规则（备份策略与迁移器共用，因此放在这一层）────────────────────
//
// 为什么命名要**共用同一个函数**：备份的"哪份最新""留几份"全靠文件名里的时间戳判断
// （理由见 server/backup.mts 的 BackupFile.at）。一旦有第二条代码路径能造出
// 命名风格不同的备份文件，排序与清理就会出错 —— 例如按 UTC 取名的备份
// 在本机看来"时间对不上"，清理时会先删掉真正的今天那份。

const BACKUP_NAME_PATTERN = /^nexgenedu-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.db$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地时间的 `YYYY-MM-DD`（"今天"这类判断都用它，不用 UTC）。 */
export function localDateKey(at: Date): string {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** 备份文件名里的时间戳部分（**本地时间**：本机使用时人对得上号）。 */
export function backupStamp(at: Date): string {
  return `${localDateKey(at)}-${pad2(at.getHours())}-${pad2(at.getMinutes())}-${pad2(at.getSeconds())}`;
}

/** 备份文件名：`nexgenedu-YYYY-MM-DD-HH-mm-ss.db`。 */
export function backupFileName(at: Date): string {
  return `nexgenedu-${backupStamp(at)}.db`;
}

/** 从备份文件名解析时间点（本地时间）；不符合命名规则返回 null。 */
export function backupTimeOfName(name: string): number | null {
  const matched = BACKUP_NAME_PATTERN.exec(name);
  if (matched === null) return null;
  const [, year, month, day, hour, minute, second] = matched;
  return new Date(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second),
  ).getTime();
}
