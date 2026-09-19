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
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const target = file ?? path.join(BACKUP_DIR, `nexgenedu-${stamp}.db`);
  if (existsSync(target)) return target;
  db.prepare("VACUUM INTO ?").run(target);
  return target;
}
