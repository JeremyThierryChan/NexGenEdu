/**
 * 「每天自动备份」的**文件能力**（只有服务端能做的事）。
 *
 * `lib/backend/daily-backups.ts` 里写清了这两套备份的区别与那六条安全底线；
 * 这一层只负责几件**碰文件**的事：
 *
 *   1. **列清单**：`server/backups/` 里**两类**快照（每日备份 + 升级前快照，最新的在前），
 *      每一份带上它是哪一类；
 *   2. **读一份备份里的整库快照**：以**只读**方式打开那个 SQLite 文件，取出 kv 表里那份快照文本；
 *   3. **把当前库另存一份**：恢复前的那颗后悔药；
 *   4. **立刻备份一份**（`takeNow`）：走**每日备份那一套现成的实现**（`server/backup.mts`
 *      的 `takeBackup`：`VACUUM INTO` + 按保留份数清理），**不另写一份备份实现**。
 *
 * ## 两类快照在这里**只有一处判据**
 *
 * "这个文件名算不算一份备份、算哪一类"完全交给 `server/backup.mts` 的 `backupKindOfName()`
 * （命名规则的唯一实现）。这一层不写第二条前缀判断 —— 分成两处之后，
 * 迟早出现"清单里看得见它、恢复却说这不是备份"这种最难向机构解释的状态
 * （他从界面上明明看到了那一份，点下去却说"这不是本系统的备份文件名"）。
 *
 * ⚠️ **升级前快照的版本比当前旧是正常的**：它就是在升级前留的，恢复它 = 退回升级前，
 * 必须走迁移链升上来。因此这里的读快照只负责"读得出来"，版本判据在服务层
 * （"比当前新"才拒绝）—— 在这一层加一句"版本必须等于当前"会把这条路整个堵死。
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
 * 文件名一律由 `server/db.mts` 的 `backupFileName()` / `backupStamp()` 生成（本地时间、精确到毫秒）；
 * 迁移前快照的名字由 `server/backup.mts` 的 `migrationBackupName()` 生成（同一个时间戳、多一个前缀）。
 * 另存的那一份**刻意与每日备份同名同形**：它是"另一份完整的备份"，不是一种新东西 ——
 * 于是它自动满足三件事：出现在同一份清单里（用户看得见"我原来那份"）、
 * 能被同一套恢复逻辑再恢复回来（`name` 的判据完全一样）、按同一条保留份数规则被清理。
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { backupFileName, backupTimeOfName } from "./db.mts";
import {
  backupsDisabled,
  backupKeep,
  backupKindOfName,
  listBackupSnapshots,
  migrationBackupKeep,
  takeBackup,
} from "./backup.mts";
import type { BackupKind } from "../lib/backend/daily-backups.ts";
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
  /**
   * 当前数据库句柄 —— **只给 `takeNow()` 用**（"立刻备份一份"要走 `takeBackup(db)`）。
   *
   * 为什么是"给它一个句柄"而不是"给它一个回调"：`takeBackup` 是**备份生成的唯一实现**
   * （`server/backup.mts`），把句柄交给这一层、由这一层调它，就没有任何余地
   * 在别处再写一份"VACUUM INTO + 清理"。回调形式也可以，但那样"到底走的哪一份实现"
   * 就取决于注入方 —— 而注入方一旦随手写个 `writeSnapshot`，就悄悄多出了第二套口径。
   *
   * `null`（默认）时 `takeNow()` **明确抛错**，不返回一个"看着成功"的假结果：
   * 浏览器里、自检的内存那一遍都没有句柄，那种环境下"备一份"没有意义。
   */
  db?: Database.Database | null;
  /** 取当前时间（测试要可控）；默认 `new Date()`。 */
  now?: () => Date;
};

/** 造一个"服务端"的备份文件能力。 */
export function createNodeDailyBackupFiles(
  options: NodeDailyBackupFilesOptions,
): DailyBackupFileAccess {
  const now = options.now ?? (() => new Date());

  /**
   * 把文件名解析成时间点与类别（**两类都认**）；不符合任何命名规则 → 拒绝。
   *
   * 判据只有一处（`backupKindOfName`）：今天多认的那一类是"升级前快照"
   * （`nexgenedu-migrate-<时间戳>.db`），它此前是被这条判据**明确拒绝**的 ——
   * 机构看完清单后当场点了"也纳入界面 + 加上限"，于是这条路开了
   * （见 `lib/backend/daily-backups.ts` 的 `BackupKind`）。
   */
  const timeOf = (name: string): { at: Date; kind: BackupKind; file: string } => {
    const parsed = backupKindOfName(name);
    if (parsed === null) {
      throw new BackupFileRefusal(
        `这不是本系统的备份文件名：${name}。` +
          "备份的名字只有两种：每日备份 nexgenedu-2026-02-01-08-00-00-000.db、" +
          "升级前快照 nexgenedu-migrate-2026-02-01-08-00-00-000.db —— " +
          "只有这两种名字的文件才会出现在这份清单里（导出的 JSON、手工改过名的文件都不在此列）。",
      );
    }
    /*
     * 路径安全：命名规则决定了 `name` 里**不可能**有 `/` 或 `..`（正则只认数字与连字符），
     * 因此这里 join 出来的路径一定落在备份目录里面。这一条不是"顺手加的防御"：
     * 恢复的入参来自 HTTP 请求，允许它带路径就等于允许它读服务端机器上任意一个 SQLite 文件。
     * ⚠️ 加第二类名字时**这一条同样成立**（前缀是固定字符串 + 时间戳正则），
     * 但将来若再认一种"前缀里能带任意字符"的名字，必须重新审这一句。
     */
    return { at: parsed.at, kind: parsed.kind, file: path.join(options.dir, name) };
  };

  return {
    dir: () => options.dir,

    /*
     * 两类各留几份：**判定只有一处**（`server/backup.mts` 的两个 `*Keep()` 读的是
     * `NEXGENEDU_BACKUP_KEEP` / `NEXGENEDU_MIGRATE_SNAPSHOT_KEEP`）。
     * 界面据此显示"保留 90 份 / 保留 10 份"—— 它不写死数字，否则人把上限调小之后
     * 界面上那句"保留 10 份"会变成假话，而他正靠那句话判断"最早那份还能留多久"。
     */
    keep: () => ({ daily: backupKeep(), migrate: migrationBackupKeep() }),

    list(): DailyBackupFile[] {
      /*
       * 两类一起列（**最新的在前**），每一份带 `kind` —— 界面上靠它分栏标注。
       * 只认符合命名规则的文件（目录里别人手动放的东西不参与排序与清理，
       * 也不出现在清单里：见 server/backup.mts 的 `listBackupSnapshots`）。
       */
      return listBackupSnapshots(options.dir).map((item) => ({
        name: item.name,
        bytes: item.bytes,
        at: item.at.toISOString(),
        kind: item.kind,
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

    /**
     * **立刻备份一份每日备份**（界面上那颗按钮，机构原话：「**加"立刻备份一份"按钮**」）。
     *
     * ## 为什么它调的是 `takeBackup` 而不是 `writeSnapshot`
     *
     * 两者的区别不是风格，是"这一份算不算**每日备份**"：
     *   - `writeSnapshot` 是恢复前那颗后悔药：它写一个**恰好能装下当前快照的新文件**，
     *     名字看起来像每日备份（因此清单里看得见），但它**不参与保留份数清理**
     *     —— 每恢复一次就多一份、永远不被清，那不是每日备份的语义；
     *   - `takeBackup` 才是每日备份的**唯一实现**：`VACUUM INTO` 当前库（因此它是一份
     *     **完整的数据库**，含规范化表）→ 按 `NEXGENEDU_BACKUP_KEEP` 清理旧份 →
     *     返回新名字与被清掉的名单。
     *
     * 用后者意味着"立刻备份一份"与"服务端每天自动备一份"产出的东西**完全一样**
     * （同一套命名、同一处生成、同一处清理）。另写一份"看起来差不多"的实现，
     * 迟早出现"手动备的那份不被清理"或"手动备的那份不被清单认出来"这类静默分叉。
     *
     * ## 没有数据库句柄时**明确拒绝**
     *
     * 自检的内存那一遍、浏览器里都没有句柄。此时返回 { ok: false } 那种"看着像失败"没问题，
     * 但这里选择**抛错**：调用方（服务层）会把它翻成一句人话，而"静默返回一个空文件名"
     * 会被当成成功 —— 在备份这件事上，假的成功比明确的失败贵得多。
     */
    takeNow(): { file: string; at: string; bytes: number; removed: string[]; total: number } {
      const db = options.db;
      if (db === null || db === undefined) {
        throw new BackupFileRefusal(
          "这个环境里没有数据库句柄，因此「立刻备份一份」办不到" +
            "（它要对着**当前的这个库**做一次 VACUUM INTO）。" +
            "浏览器里读不到服务端的库，这件事只能在服务端上做。",
        );
      }
      /*
       * 备份被**整体关掉**（`NEXGENEDU_NO_BACKUP=1`）时也拒绝，理由不在这一层自己编、
       * 而是复用 `backupsDisabled()`（唯一一份判定，见 server/backup.mts 的文件头）：
       * 那个开关的语义就是"这台机器上不要生成备份文件"，而"人点了一下按钮"不是例外 ——
       * 半开半关的开关最危险的地方在于**没人说得清它到底关没关**。
       * 它的真实用途是"自检 / 验收起的临时服务不要往真实备份目录丢文件"，
       * 因此才需要这里也认它（否则点一下按钮就绕过去了）。
       */
      if (backupsDisabled()) {
        throw new BackupFileRefusal(
          "这台机器上的备份被整体关掉了（NEXGENEDU_NO_BACKUP=1），因此不能立刻备份一份。" +
            "备份恢复之后（去掉这个环境变量、重起后端）再点。",
        );
      }
      // 目录用**这份能力自己的** dir（与 list / readSnapshot / writeSnapshot 同一个目录）
      const outcome = takeBackup(db, now(), options.dir);
      /*
       * `at` 从**文件名**解析（不是 `now()`、也不是 mtime）：清单里显示的时间点同样是
       * 从文件名来的，两处口径必须一致 —— 否则刚备完那一下的提示会说一个时间、
       * 清单里那一行显示另一个时间，而人正靠对得上号来判断"是不是这一份"。
       */
      const parsed = backupTimeOfName(outcome.file);
      return {
        file: outcome.file,
        at: new Date(parsed ?? now().getTime()).toISOString(),
        bytes: outcome.bytes,
        removed: outcome.removed,
        total: outcome.total,
      };
    },
  };
}

/** 给临时脚本用：造一个一次性目录（绝不落在真实数据/备份目录里）。 */
export function tempBackupDir(prefix = "nexgenedu-daily-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}
