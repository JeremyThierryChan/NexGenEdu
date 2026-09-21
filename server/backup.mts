/**
 * 备份策略：什么时候备份、备份存到哪、留几份。
 *
 * ## 为什么备份要有"策略"而不是一个 `VACUUM INTO`
 *
 * `db.mts` 里的 `backupTo()` 只解决"怎么备"；真出事的是另外三件事：
 *
 *   1. **没人记得备**：靠人每天手动复制文件，迟早会漏 —— 漏的那天正好是出事那天。
 *      所以要有"今天还没备份就自动备一份"的判定，挂在服务端启动与每小时检查上。
 *   2. **越备越多**：一天一份、加上手动备份，目录会无声地涨到几十上百 GB 里的几百个文件。
 *      所以要有保留份数（`keep`）与明确的清理日志。
 *   3. **不知道备份是新的还是旧的**：文件名必须能一眼看出时间，而且要能被程序
 *      按时间排序（`listBackups()` 给 /health 与命令行用）。
 *
 * ## 名字为什么用**本地时间**
 *
 * 早期用 `toISOString()` 取名，于是"9月19日 18:46 备的份"叫 `...-10-46-31.db`
 * （UTC）—— 本机使用时人对不上号，得先心算时差。这是一个**给本地单用户用的系统**，
 * 名字就按本地时间写，跟"今天的备份"这种说法一致。
 *
 * ## 保留份数为什么默认 90
 *
 * 本机构的库是 KB 级、每天一份，90 份 = 约三个月的回溯窗口，占用可以忽略。
 * 但**上限必须存在**：无上限的备份目录是那种"半年后发现磁盘满了却不知道谁干的"的问题。
 * 粗略的磁盘账：备份是整份复制，所以占用 ≈ **快照大小 × 保留份数**
 * （100 名学生约 1.6MB × 90 ≈ 150MB；800 名学生约 12.6MB × 90 ≈ 1.1GB，
 * 容量数字见 docs/后端开发方案.md §5.8）；数据大到备份占不下时，先调小这个份数。
 * 清理只删**本模块命名规则**下的文件 —— 你在 `server/backups/` 里放的其他东西
 * （手动导出的 JSON、迁移前快照、临时文件）一根手指都不碰。
 *
 * ## 一条纪律：**永远不要用"没看到数据"当删除依据**
 *
 * 加这个功能时我犯过一次错：写了个清理脚本，判据是"kv 表里没有行就当空文件删掉"，
 * 于是把 5 份**旧版（数据还在 SQL 表里、kv 尚未启用）**的备份当成空文件删了。
 * 教训不是"判据写细一点"，而是：**备份的删除只能走这一处（`pruneBackups`），
 * 且判据只能是"名字 + 份数"这种确定的东西**；不要临时写脚本按内容猜。
 * 数据在旧结构里，任何"按当前结构的字段判断有没有内容"的检查都必然误判。
 */

import type Database from "better-sqlite3";
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import {
  BACKUP_DIR,
  backupFileName,
  backupTimeOfName,
  backupTo,
  localDateKey,
} from "./db.mts";

/** 备份目录，可用 `NEXGENEDU_BACKUP_DIR` 覆盖（演练与测试要隔离到临时目录）。 */
export function backupDir(): string {
  const override = process.env.NEXGENEDU_BACKUP_DIR;
  return typeof override === "string" && override.trim() !== "" ? override : BACKUP_DIR;
}

/**
 * 保留份数上限，可用 `NEXGENEDU_BACKUP_KEEP` 覆盖。至少 1（否则等于不备份）。
 *
 * 默认 **90**（约三个月的每日备份）。库是 KB 级，90 份也就十几 MB，所以宁多勿少：
 * 保留窗口太短的话，"发现数据早就坏了"的时候，能回溯的那几天已经被清掉了。
 * 真正要防的是**无上限**（目录无声涨到几百份、几百 MB 里的几百个文件没人管）。
 */
export function backupKeep(): number {
  const raw = Number.parseInt(process.env.NEXGENEDU_BACKUP_KEEP ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1) return 90;
  return raw;
}

/**
 * 备份是否被整体关闭（`NEXGENEDU_NO_BACKUP=1`）。
 *
 * 自检与逐页验收起的是**临时库**，给它们备份没有任何意义，而且会写进真实备份目录。
 * 这不只是"目录变脏"：那些文件会满足"今天已经备份过"的判定，于是**真实库当天
 * 一份备份都不会有** —— 假备份挤掉真备份，是备份机制最坏的一种失效方式。
 *
 * 判定只有这一份实现（迁移器与定时器都用它），否则迟早出现"一处关了、另一处没关"。
 */
export function backupsDisabled(): boolean {
  return process.env.NEXGENEDU_NO_BACKUP === "1";
}

/**
 * 迁移前快照的命名前缀：`nexgenedu-migrate-<时间戳>.db`。
 *
 * 它**刻意不匹配**每日备份的命名规则，因此两件事都不参与：
 *   - 不算作"今天的每日备份"（迁移快照与每日备份是两回事，前者由结构变更触发）；
 *   - 不参与保留份数的清理（迁移一年也就几次，留着让人自己判断更安全）。
 * 这样"每天一份"的口径不会被一次迁移悄悄顶掉。
 */
export const MIGRATION_BACKUP_PREFIX = "nexgenedu-migrate-";

export type BackupFile = {
  /** 文件名（不含目录）。 */
  name: string;
  /** 绝对路径。 */
  path: string;
  bytes: number;
  /**
   * **这份备份代表的时间点**（从文件名解析，用本地时间）。
   *
   * 刻意不用文件的 mtime：mtime 会被"复制/移动/rsync/从别处恢复"这类操作改写，
   * 于是"哪份更新"会随文件系统的搬运史而变。备份的**名字**才是它自己的时间戳。
   * 这是恢复演练逼出来的 —— 演练里放了几个名字是 2020 年、mtime 却是今天的文件，
   * 按 mtime 排序时它们成了"最新"，于是一次清理把两份真备份删了。
   */
  at: Date;
  /** 文件系统上的修改时间：只作诊断用，不参与排序与判断。 */
  mtime: Date;
};

/*
 * 文件名的规则与解析函数在 `server/db.mts`（`backupFileName` / `backupStamp` /
 * `backupTimeOfName` / `localDateKey`）：**命名必须只有一处实现**。
 * 一旦有第二条路径能造出命名风格不同的备份文件（例如按 UTC 取名），
 * "哪份最新""删哪份"就会算错 —— 清理时可能先删掉真正的今天那份。
 */

/**
 * 列出备份，**最新的在前**。
 *
 * 排序与"哪份最新"一律以**文件名里的时间戳**为准，不用 mtime（理由见 `BackupFile.at`）。
 * 同名的两份不可能存在，因此以名字为键的排序是确定的。
 *
 * 只看符合命名规则的文件：目录里若有别人手动放的东西（导出的 JSON、人工留档），
 * 不该被当成"备份"参与排序与清理，否则一次清理就会删掉不该删的。
 */
export function listBackups(dir: string = backupDir()): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const parsed = backupTimeOfName(name);
      if (parsed === null) return [];
      const file = path.join(dir, name);
      try {
        const info = statSync(file);
        return [{
          name,
          path: file,
          bytes: info.size,
          at: new Date(parsed),
          mtime: info.mtime,
        }];
      } catch {
        // 刚刚被删掉的文件：跳过，不要因为一次竞态让整个备份流程失败
        return [];
      }
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** 今天是否已经备份过。 */
export function backedUpToday(now: Date = new Date(), dir: string = backupDir()): boolean {
  const today = localDateKey(now);
  return listBackups(dir).some((item) => localDateKey(item.at) === today);
}

export type PruneResult = { removed: string[]; kept: number };

/**
 * 按保留份数清理旧备份（最新在前，留下 `keep` 份）。
 *
 * 只删符合命名规则的文件，且**永远至少留一份**。删掉谁要能说得出来，
 * 所以返回被删的文件名，由调用方打印 —— 静默删除备份是不可接受的。
 */
export function pruneBackups(
  keep: number = backupKeep(),
  dir: string = backupDir(),
): PruneResult {
  const all = listBackups(dir);
  const limit = Math.max(1, keep);
  const doomed = all.slice(limit);
  const removed: string[] = [];
  for (const item of doomed) {
    try {
      unlinkSync(item.path);
      removed.push(item.name);
    } catch {
      // 删不掉（权限/占用）不该让备份流程失败：留着比删掉安全
    }
  }
  return { removed, kept: Math.min(all.length, limit) };
}

export type BackupOutcome = {
  /** 本次是否真的备份了（"今天已经备过"时为 false）。 */
  taken: boolean;
  file: string;
  bytes: number;
  removed: string[];
  /** 现有备份份数。 */
  total: number;
};

/** 备份一份并清理旧份（保留份数见 `backupKeep()`）。 */
export function takeBackup(db: Database.Database, now: Date = new Date()): BackupOutcome {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  // 同一秒内重复调用时同名文件已存在，`backupTo` 会直接返回它 —— 不会覆盖，也不会报错
  /*
   * 文件名带毫秒（`backupFileName`）**并且**撞名时 `backupTo` 会报错，
   * 两者一起保证"我刚刚真的生成了一份新备份" —— 只靠"不覆盖"是不够的，
   * 那会悄悄把一份旧文件当成刚备的（见 server/db.mts 的 `backupTo` 注释）。
   */
  const file = backupTo(db, path.join(dir, backupFileName(now)));
  const info = statSync(file);
  const pruned = pruneBackups(backupKeep(), dir);
  return {
    taken: true,
    file: path.basename(file),
    bytes: info.size,
    removed: pruned.removed,
    total: listBackups(dir).length,
  };
}

/**
 * **今天还没备份就备一份**（服务端启动时与每小时检查时调用）。
 *
 * 返回 null 表示今天已经备份过、这次什么都不做 —— 调用方据此决定要不要打印。
 * "每天一次"这个口径只在这一处实现：写在两处的话，早晚会分叉成
 * "启动时按 24 小时算、定时器按自然日算"，于是出现一天两份或隔天漏一份。
 */
export function backupIfNotToday(
  db: Database.Database,
  now: Date = new Date(),
): BackupOutcome | null {
  if (backedUpToday(now)) return null;
  return takeBackup(db, now);
}

/** 供 /health 与命令行显示：最近一份备份的信息。 */
export function latestBackup(): BackupFile | null {
  return listBackups()[0] ?? null;
}
