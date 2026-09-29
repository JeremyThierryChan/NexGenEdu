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
import {
  backupDir,
  backupsDisabled,
  migrationBackupKeep,
  migrationBackupName,
  pruneMigrationBackups,
} from "./backup.mts";

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
  /**
   * 这次顺手清掉的**最老的升级前快照**（保留份数上限 `NEXGENEDU_MIGRATE_SNAPSHOT_KEEP`，默认 10）。
   *
   * 为什么把它放进返回值而不只是打印一行：清理是"删文件"这件事里唯一被允许的形态，
   * 而**删了谁必须能说得出来**（静默删除备份是不可接受的）。放回返回值，
   * 自检与命令行都能对着它断言 —— 否则"清理确实按份数只删最老的"就只能靠人读代码相信。
   */
  snapshotRemoved: string[];
  /** 清理之后还剩几份升级前快照。 */
  snapshotsKept: number;
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
    return {
      from,
      to,
      applied: [],
      backup: "",
      // 没生成新快照就不清理：清理的触发点**只有一个**（生成一份新的迁移快照之后），
      // 理由见 server/backup.mts 的 `pruneMigrationBackups`
      snapshotRemoved: [],
      snapshotsKept: 0,
      skipped: true,
    };
  }

  /*
   * 备份要发生在**事务之外**（VACUUM 不能在事务里跑）。
   *
   * 两道闸都不是可有可无的：
   *   - `backupsDisabled()`（`NEXGENEDU_NO_BACKUP=1`）：自检/验收起的是**临时库**，
   *     给它们备份毫无意义，而且会写进**真实备份目录**（曾经的 bug：每次起一个临时服务
   *     都会往 server/backups/ 丢一个空库备份）。后果不只是脏：那些文件会满足
   *     "今天已备份"的判定，于是**真实库当天可能一份备份都没有** —— 假备份挤掉真备份。
   *   - `backupDir()`：备份目录必须能被覆盖（演练与测试要隔离到临时目录）。
   */
  const backup = options.backup === false || backupsDisabled()
    ? ""
    : backupTo(db, path.join(backupDir(), migrationBackupName(new Date())));

  /*
   * ── 升级前快照的**保留份数上限**（E22 续，机构：「也纳入界面 + 加上限」）──────────
   *
   * 生成在同一处、清理就在**紧挨着的这一处**：不放到每小时检查、也不放到服务启动里。
   * 散落各处触发的话，早晚出现"某次启动顺手删了一批升级前快照"—— 而它们是机构
   * "升级出问题我自己能退"的唯一凭据。
   *
   * `backupsDisabled()` 时 `backup` 是空串（临时服务不生成快照），那时也**不清理**：
   * 一个不生成快照的运行不该顺手删掉别人（真实目录）的快照 —— 那正是自检最不能做的事。
   *
   * ⚠️ **这一句"删东西"的代码是 2026-09-29 一次真事故的现场**（见 PROJECT.md 的「E22 续」）：
   * 当时 `scripts/check-auth.mts` 里有两处临时服务**忘了给备份目录**，
   * 于是它们跑迁移时既往真实的 `server/backups/` 写空快照、又**顺着这句把超出 10 份的清了 89 份**。
   * 现在的防护是三层的：①临时服务的 `backupDir` 是**必填参数**（编译期挡住"忘了给"）；
   * ②传真实目录会**起不来**（`scripts/temp-server.mts` 的运行时那道门）；
   * ③自检 §54 有两条回归护栏（含"真的拿真实目录去起一次、断言起不来"）。
   * **别把这三条拆掉任何一条** —— 拆掉之后，"清理"会重新变成一条能悄悄动机构目录的路。
   */
  const pruned = backup === "" ? { removed: [], kept: 0 } : pruneMigrationBackups();

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

  return {
    from,
    to,
    applied: pending.map((migration) => migration.name),
    backup,
    snapshotRemoved: pruned.removed,
    snapshotsKept: pruned.kept,
    skipped: false,
  };
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
    console.log(`迁移前快照：${result.backup}`);
    /*
     * 清理要**打印出来**（静默删除备份是不可接受的）：清了几份、清了哪几个名字、
     * 现在还留几份。上限用 `NEXGENEDU_MIGRATE_SNAPSHOT_KEEP` 调，默认 10
     * （`migrationBackupKeep()`，与界面显示的是同一个数）。
     */
    if (result.snapshotRemoved.length > 0) {
      console.log(
        `已清理最老的 ${result.snapshotRemoved.length} 份升级前快照` +
          `（上限 ${migrationBackupKeep()} 份，用 NEXGENEDU_MIGRATE_SNAPSHOT_KEEP 调）：`,
      );
      for (const name of result.snapshotRemoved) console.log(`  - ${name}`);
    }
    console.log(`升级前快照现有 ${result.snapshotsKept} 份（目录：${backupDir()}）`);
  }
  db.close();
}
