/**
 * 「每天自动备份」的**文件能力**（只有服务端能做的事）。
 *
 * `lib/backend/daily-backups.ts` 里写清了这三套备份的区别与那五条安全底线；
 * 这一层只负责三件**碰文件**的事：
 *
 *   1. **列清单**：`server/backups/` 里符合命名规则的每日备份（最新的在前）；
 *   2. **读一份备份里的整库快照**：以**只读**方式打开那个 SQLite 文件，取出 kv 表里那份快照文本；
 *   3. **把当前库另存一份**：恢复前的那颗后悔药。
 *
 * ## 为什么读一份备份时**只读打开**
 *
 * 备份文件是这个系统里最后一道退路，任何"顺手写一下"都是不可接受的 ——
 * 包括 SQLite 自己可能做的 WAL 恢复与 journal 清理。因此：
 *   - 只用 `new Database(file, { readonly: true })`；
 *   - 只走 `SELECT`，不建表、不 pragma 写；
 *   - 读不出就**抛错**，把这一份原样留在目录里（坏掉的那一份必须让人看见，
 *     而不是被谁"顺手清理"掉 —— 那正是"以为有退路、其实没有"的成因）。
 *
 * ## 为什么另存一份是"用快照文本写一个新文件"，而不是 `VACUUM INTO`
 *
 * 这个系统的整库就是 kv 表里那一份 JSON 快照（`server/kv-store.mts` 的文件头写了为什么）。
 * 恢复走的是服务层那条路：读快照 → 校验 → 迁移 → 落盘。因此"当前库"到底是什么，
 * 唯一权威的来源就是**服务层内存里那一份**（也是刚刚被 `persist` 写进 kv 的那一份）。
 * 照它写文件，与服务运行在哪一种存储上都一致（自检里的内存后端没有 `.db` 文件可 VACUUM）。
 *
 * 写出来的文件是一个**正常的本系统数据库**：有 `kv` 表（快照）与 `schema_version` 表。
 * 少了 `schema_version` 也能跑（启动时的迁移器会把两张表补出来，`server/migrations/*.sql`
 * 全部是 `CREATE TABLE IF NOT EXISTS`），但把当前的结构版本一起写上更诚实 ——
 * 将来若出现一条非幂等的迁移，这个文件仍然能被正常打开与使用。
 *
 * ## 命名：**只有一处实现**
 *
 * 文件名一律由 `server/db.mts` 的 `backupFileName()` 生成（本地时间、精确到毫秒）。
 * 另存的那一份**刻意与每日备份同名同形**：它是"另一份完整的备份"，不是一种新东西 ——
 * 于是它自动满足三件事：出现在同一份清单里（用户看得见"我原来那份"）、
 * 能被同一套恢复逻辑再恢复回来（`name` 的判据完全一样）、按同一条保留份数规则被清理。
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { backupFileName, backupTimeOfName } from "./db.mts";
import { listBackups } from "./backup.mts";
import type {
  DailyBackupFile,
  DailyBackupFileAccess,
} from "../lib/backend/daily-backups.ts";

/**
 * 这份能力自己抛出的错误：区分"我们有意拒绝"与"SQLite 底层炸了"。
 *
 * 前者要把原因原样告诉用户（"不是本项目的备份""文件是空的"），
 * 后者统一翻译成"这份文件读不出来"—— 底层的 SQLite 原文（表名、页码）对机构没有意义。
 */
class BackupFileRefusal extends Error {}

export type NodeDailyBackupFilesOptions = {
  /** 备份目录（服务端用 `backupDir()`，因此 `NEXGENEDU_BACKUP_DIR` 一改就整体隔离）。 */
  dir: string;
  /** 整库快照在 kv 表里的键（`lib/backend/api.ts` 的 `SNAPSHOT_KEY`）。 */
  snapshotKey: string;
  /** 当前数据库的结构版本（写进另存那份的 `schema_version`）。 */
  schemaVersion: number;
  /** 取当前时间（测试要可控）；默认 `new Date()`。 */
  now?: () => Date;
};

/** 造一个"服务端"的备份文件能力。 */
export function createNodeDailyBackupFiles(
  options: NodeDailyBackupFilesOptions,
): DailyBackupFileAccess {
  const now = options.now ?? (() => new Date());

  /** 把文件名解析成时间点（不符合命名规则 → 拒绝）。 */
  const timeOf = (name: string): { at: Date; file: string } => {
    const parsed = backupTimeOfName(name);
    if (parsed === null) {
      throw new BackupFileRefusal(
        `这不是本系统的备份文件名：${name}。` +
          "备份的名字形如 nexgenedu-2026-02-01-08-00-00-000.db —— " +
          "只有这种名字的文件才会出现在「每天自动备份」清单里（迁移前快照等其他文件不在此列）。",
      );
    }
    /*
     * 路径安全：命名规则决定了 `name` 里**不可能**有 `/` 或 `..`（正则只认数字与连字符），
     * 因此这里 join 出来的路径一定落在备份目录里面。这一条不是"顺手加的防御"：
     * 恢复的入参来自 HTTP 请求，允许它带路径就等于允许它读服务端机器上任意一个 SQLite 文件。
     */
    return { at: new Date(parsed), file: path.join(options.dir, name) };
  };

  return {
    dir: () => options.dir,

    list(): DailyBackupFile[] {
      // 只认符合命名规则的文件（目录里别人手动放的东西不参与排序与清理，见 server/backup.mts）
      return listBackups(options.dir).map((item) => ({
        name: item.name,
        bytes: item.bytes,
        at: item.at.toISOString(),
      }));
    },

    readSnapshot(name: string): { text: string; at: string; bytes: number } {
      const { at, file } = timeOf(name);
      if (!existsSync(file)) {
        throw new BackupFileRefusal(
          `这份备份不在了：${name}（可能已被保留份数清理掉，或被人手工挪走）。` +
            "刷新这一页看看现在有哪些份。",
        );
      }
      const size = statSync(file).size;
      if (size === 0) {
        throw new BackupFileRefusal(`这份备份是空文件（0 字节）：${name} —— 它里面没有任何数据。`);
      }

      let db: Database.Database;
      try {
        db = new Database(file, { readonly: true });
      } catch (cause) {
        throw new BackupFileRefusal(
          `这份文件打不开（不是 SQLite 数据库？）：${name}（${cause instanceof Error ? cause.message : String(cause)}）`,
        );
      }
      try {
        let row: { value?: unknown } | undefined;
        try {
          row = db
            .prepare("SELECT value FROM kv WHERE key = ?")
            .get(options.snapshotKey) as { value?: unknown } | undefined;
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          /*
           * 两种"读不出"要分开说：**根本不是一个数据库**（有人把别的文件改了名放进来说）
           * 与**是数据库但没有本项目的快照**（别人的 SQLite、或本项目早期某个残缺文件）。
           * 对用户来说这是两件事：前者"这份不是备份"，后者"这份备份是坏的"。
           */
          const notSqlite = /not a database|file is encrypted/i.test(detail);
          throw new BackupFileRefusal(
            notSqlite
              ? `这份文件不是 SQLite 数据库（很可能根本不是备份）：${name}`
              : `这份文件里没有本系统的数据快照：${name} —— ` +
                  `它可能是一个别的 SQLite 文件，不是本系统生成的备份（${detail}）。`,
          );
        }
        const text = row?.value;
        if (typeof text !== "string" || text.trim() === "") {
          throw new BackupFileRefusal(
            `这份备份里没有数据快照：${name}（像是备份生成到一半就失败了）。`,
          );
        }
        return { text, at: at.toISOString(), bytes: size };
      } finally {
        db.close();
      }
    },

    writeSnapshot(text: string): string {
      mkdirSync(options.dir, { recursive: true });
      const base = now();
      /*
       * 撞名就往后挪一毫秒，而不是覆盖。
       *
       * 名字必须**唯一**：`server/db.mts` 的 `backupTo()` 有一条踩出来的纪律 ——
       * "目标已存在时报错，绝不返回旧文件"，因为"你以为刚备了一份、拿到的却是旧的"
       * 要到出事那天才暴露。这里同理：绝不覆盖目录里已有的任何一份。
       */
      for (let offset = 0; offset < 1000; offset += 1) {
        const at = new Date(base.getTime() + offset);
        const name = backupFileName(at);
        const file = path.join(options.dir, name);
        if (existsSync(file)) continue;

        /*
         * ⚠️ 刻意**不用** `openDatabase()`：它会把 journal_mode 设成 **WAL**，
         * 于是备份文件会多出 `-wal` / `-shm` 两个旁文件 —— 而备份是**单文件**的东西
         * （拷走一份、发给自己、放 U 盘都是拿那一个文件）。带 WAL 的备份在只拷 `.db`
         * 时会丢内容，这种"备份看起来在、内容不全"的情况正是最难发现的那种坏。
         * 这里用默认的 journal（写完就并回主文件），因此目录里只有一份干净的 `.db`。
         */
        const db = new Database(file);
        try {
          db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
          db.exec(
            "CREATE TABLE IF NOT EXISTS schema_version (" +
              "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, name TEXT NOT NULL)",
          );
          db.prepare(
            "INSERT OR REPLACE INTO schema_version (version, applied_at, name) VALUES (?, ?, ?)",
          ).run(options.schemaVersion, at.toISOString(), "nexgenedu-快照（界面另存的备份）");
          db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(
            options.snapshotKey,
            text,
          );
        } finally {
          db.close();
        }
        return name;
      }
      throw new Error(
        `同一毫秒里已经有 1000 份备份了（${options.dir}）—— 先清理备份目录再恢复。`,
      );
    },
  };
}

/** 给临时脚本用：造一个一次性目录（绝不落在真实数据/备份目录里）。 */
export function tempBackupDir(prefix = "nexgenedu-daily-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}
