/**
 * 迁移器：schema_version 表 + server/migrations/*.sql **按版本升序**执行。
 *
 * 纪律（每一条都对应伪后端阶段踩过的坑，见 PROJECT.md）：
 *   1. 升序执行，缺号就停下报错（曾经把分支写反，数据停在中间版本被当成坏数据）；
 *   2. **执行前自动备份**数据库文件（导入功能的三道保险就是这个思路）；
 *   3. 全部包在一个事务里：失败就整批回滚，不留半成品；
 *   4. 幂等：已应用的版本跳过，重复跑没有副作用。
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { backupTo, openDatabase, DB_PATH } from "./db.mts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(HERE, "migrations");

export type MigrationFile = { version: number; name: string; sql: string };

/** 读取迁移文件（`001_init.sql` → 版本 1）。文件名必须带数字前缀。 */
export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  const migrations = files.map((name) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(name);
    if (match === null) throw new Error(`迁移文件名必须形如 001_init.sql：${name}`);
    return {
      version: Number(match[1]),
      name: name,
      sql: readFileSync(path.join(dir, name), "utf8"),
    };
  });
  migrations.sort((a, b) => a.version - b.version);

  // 缺号 / 重号都要拦：跳着执行会让后面依赖前面结构的脚本静默失败
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `迁移版本不连续：期望 ${index + 1}，实际 ${migration.version}（${migration.name}）`,
      );
    }
  });
  return migrations;
}

function ensureVersionTable(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL,
    name TEXT NOT NULL
  )`);
}

export function currentVersion(db: Database.Database): number {
  ensureVersionTable(db);
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

export type MigrateResult = {
  from: number;
  to: number;
  applied: string[];
  backup: string;
  skipped: boolean;
};

/**
 * 跑到最新。没有任何待应用迁移时**不备份**（避免每次启动都堆一个文件）。
 */
export function migrate(db: Database.Database, options: { backup?: boolean } = {}): MigrateResult {
  const migrations = listMigrations();
  const from = currentVersion(db);
  const pending = migrations.filter((migration) => migration.version > from);
  const to = pending.at(-1)?.version ?? from;

  if (pending.length === 0) {
    return { from, to, applied: [], backup: "", skipped: true };
  }

  // 备份要发生在**事务之外**（VACUUM 不能在事务里跑）
  const backup = options.backup === false ? "" : backupTo(db);

  const apply = db.transaction((items: MigrationFile[]) => {
    ensureVersionTable(db);
    for (const migration of items) {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_version (version, applied_at, name) VALUES (?, ?, ?)").run(
        migration.version,
        new Date().toISOString(),
        migration.name,
      );
    }
  });
  apply(pending);

  return { from, to, applied: pending.map((migration) => migration.name), backup, skipped: false };
}

/** 命令行入口：`npm run server:migrate`。 */
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const db = openDatabase();
  const result = migrate(db);
  if (result.skipped) {
    console.log(`数据库已是最新（v${result.to}）：${DB_PATH}`);
  } else {
    console.log(`迁移完成：v${result.from} → v${result.to}`);
    console.log(`已应用：${result.applied.join("、")}`);
    console.log(`迁移前备份：${result.backup}`);
  }
  db.close();
}
