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
  backupTimeOfStamp,
  backupStamp,
  backupTo,
  localDateKey,
} from "./db.mts";
/*
 * 上限的默认值与环境变量名写在 `lib/backend/daily-backups.ts`（口径那一层，界面也用它）：
 * 界面上要显示"保留 90 份 / 保留 10 份"，写死一个数字在页面上、
 * 另一个数字在这里，早晚会出现"界面说 90、实际留 90 天以外的另一个数"。
 */
import {
  DAILY_BACKUP_KEEP_DEFAULT,
  DAILY_BACKUP_KEEP_ENV,
  MIGRATE_SNAPSHOT_KEEP_DEFAULT,
  MIGRATE_SNAPSHOT_KEEP_ENV,
  type BackupKind,
} from "../lib/backend/daily-backups.ts";

/** 备份目录，可用 `NEXGENEDU_BACKUP_DIR` 覆盖（演练与测试要隔离到临时目录）。 */
export function backupDir(): string {
  const override = process.env.NEXGENEDU_BACKUP_DIR;
  return typeof override === "string" && override.trim() !== "" ? override : BACKUP_DIR;
}

/**
 * 保留份数上限，可用 `NEXGENEDU_BACKUP_KEEP` 覆盖。至少 1（否则等于不备份）。
 *
 * 默认 **90**（约三个月的每日备份，数值与 `lib/backend/daily-backups.ts` 的
 * `DAILY_BACKUP_KEEP_DEFAULT` 是同一个 —— 界面上写着"保留 90 份"，两处必须是同一个数）。
 * 库是 KB 级，90 份也就十几 MB，所以宁多勿少：
 * 保留窗口太短的话，"发现数据早就坏了"的时候，能回溯的那几天已经被清掉了。
 * 真正要防的是**无上限**（目录无声涨到几百份、几百 MB 里的几百个文件没人管）。
 *
 * ⚠️ 它只管**每日备份**（`nexgenedu-<时间戳>.db`）。升级前快照有自己的一条上限
 * （`migrationBackupKeep()`），两者**绝不许混算** —— 混算的后果是"一次升级把每日备份挤掉"。
 */
export function backupKeep(): number {
  const raw = Number.parseInt(process.env[DAILY_BACKUP_KEEP_ENV] ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1) return DAILY_BACKUP_KEEP_DEFAULT;
  return raw;
}

/**
 * **升级前快照**的保留份数上限，可用 `NEXGENEDU_MIGRATE_SNAPSHOT_KEEP` 覆盖，默认 **10**。
 *
 * 机构原话：「**也纳入界面 + 加上限**」。此前迁移快照**没有任何上限**（真实目录里攒到 99 份），
 * 而"没有人会去看的第 99 份"不是退路，是一堆没人敢删的文件。
 * 上限只管**迁移快照**（`nexgenedu-migrate-<时间戳>.db`），每日备份由 `backupKeep()` 管 ——
 * 两类各留各的，因此"某天升级了 3 次"不会顺手删掉当天的每日备份。
 */
export function migrationBackupKeep(): number {
  const raw = Number.parseInt(process.env[MIGRATE_SNAPSHOT_KEEP_ENV] ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1) return MIGRATE_SNAPSHOT_KEEP_DEFAULT;
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
 * 它**刻意不匹配**每日备份的命名规则（`backupTimeOfName` 不认它），因此：
 *   - 不算作"今天的每日备份"（迁移快照与每日备份是两回事，前者由结构变更触发）——
 *     这样"每天一份"的口径不会被一次迁移悄悄顶掉；
 *   - **不参与每日备份的清理**（`pruneBackups` 看不见它），
 *     它有自己的上限与清理（`pruneMigrationBackups`，默认留 10 份）。
 *
 * ## 它现在**出现在界面上**了（E22 续，机构：「也纳入界面 + 加上限」）
 *
 * 它是在结构升级**之前**自动留的那一份，回答的是"我要退回升级前"。
 * 机构看完清单后当场点了这一条：此前它只躺在目录里 —— 界面上看不见它，
 * 而**看不见的后悔药等于没有**（出问题时人不会知道目录里还有一份能退回去的东西）。
 * 它走的仍是**同一套**校验与恢复顺序（`dailyBackups.restore` 认这个名字）。
 */
export const MIGRATION_BACKUP_PREFIX = "nexgenedu-migrate-";

/**
 * 迁移前快照的文件名：`nexgenedu-migrate-<时间戳>.db`。
 *
 * 时间戳复用**每日备份那一个** `backupStamp()`（**命名只有一处实现**这条纪律）：
 * 一旦迁移快照用了另一种写法的名字，"哪份最新""删哪份"就会算错。
 */
export function migrationBackupName(at: Date): string {
  return `${MIGRATION_BACKUP_PREFIX}${backupStamp(at)}.db`;
}

/**
 * 从迁移前快照的文件名解析时间点；不是这个名字就返回 null。
 *
 * 解析复用每日备份那一条时间戳正则（`backupTimeOfStamp`）：把前缀摘掉之后，
 * 两种名字的**时间戳部分**必须是同一种写法 —— 否则同一个时间会被解析成两个不同的值。
 */
export function migrationBackupTimeOfName(name: string): number | null {
  if (!name.startsWith(MIGRATION_BACKUP_PREFIX)) return null;
  return backupTimeOfStamp(name.slice(MIGRATION_BACKUP_PREFIX.length, -".db".length));
}

/**
 * 认出目录里的一个文件名属于哪一类快照（认不出返回 null）。
 *
 * 两类名字都从这里判、**只有这一处**：清单（`listBackupSnapshots`）、清理、恢复入参校验
 * 走的都是它 —— 三处各写一遍前缀判断，就会出现"清单里看得见、恢复却说这不是备份"这种
 * 最难解释的状态（`daily-backup-files.mts` 的文件头对此有更长的说明）。
 */
export function backupKindOfName(
  name: string,
): { kind: BackupKind; at: Date; path: string } | null {
  const daily = backupTimeOfName(name);
  if (daily !== null) return { kind: "daily", at: new Date(daily), path: name };
  const migrate = migrationBackupTimeOfName(name);
  if (migrate !== null) return { kind: "migrate", at: new Date(migrate), path: name };
  return null;
}

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
  /** 「每日备份」还是「升级前快照」（见 `lib/backend/daily-backups.ts` 的 `BackupKind`）。 */
  kind: BackupKind;
};

/*
 * 文件名的规则与解析函数在 `server/db.mts`（`backupFileName` / `backupStamp` /
 * `backupTimeOfName` / `backupTimeOfStamp` / `localDateKey`）：**命名必须只有一处实现**。
 * 一旦有第二条路径能造出命名风格不同的备份文件（例如按 UTC 取名），
 * "哪份最新""删哪份"就会算错 —— 清理时可能先删掉真正的今天那份。
 */

/**
 * 列出备份目录里的**两类**快照，**最新的在前**（清单与界面用它）。
 *
 * 排序与"哪份最新"一律以**文件名里的时间戳**为准，不用 mtime（理由见 `BackupFile.at`）。
 * 同名的两份不可能存在，因此以名字为键的排序是确定的。
 *
 * 只看符合命名规则的文件：目录里若有别人手动放的东西（导出的 JSON、人工留档），
 * 不该被当成"备份"参与排序与清理，否则一次清理就会删掉不该删的。
 */
export function listBackupSnapshots(dir: string = backupDir()): BackupFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const parsed = backupKindOfName(name);
      if (parsed === null) return [];
      const file = path.join(dir, name);
      try {
        const info = statSync(file);
        return [{
          name,
          path: file,
          bytes: info.size,
          at: parsed.at,
          mtime: info.mtime,
          kind: parsed.kind,
        }];
      } catch {
        // 刚刚被删掉的文件：跳过，不要因为一次竞态让整个备份流程失败
        return [];
      }
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * 列出**每日备份**（最新的在前）—— 每日备份那一条线专看的清单。
 *
 * 与 `listBackupSnapshots()` 的关系是"它的一份子"：**备份的生成与清理**那条线
 * （`backedUpToday` / `pruneBackups` / `takeBackup` / `latestBackup` / `/health`）
 * 只关心每日备份，而"清掉一份迁移快照"绝不该被算成"今天已经备份过"。
 * 界面上那份清单用的是 `listBackupSnapshots()`（两类都要看见）。
 */
export function listBackups(dir: string = backupDir()): BackupFile[] {
  return listBackupSnapshots(dir).filter((item) => item.kind === "daily");
}


/** 今天是否已经备份过。 */
export function backedUpToday(now: Date = new Date(), dir: string = backupDir()): boolean {
  const today = localDateKey(now);
  return listBackups(dir).some((item) => localDateKey(item.at) === today);
}

export type PruneResult = { removed: string[]; kept: number };

/**
 * 按保留份数清理**旧每日备份**（最新在前，留下 `keep` 份）。
 *
 * 只删符合**每日备份**命名规则的文件，且**永远至少留一份**。删掉谁要能说得出来，
 * 所以返回被删的文件名，由调用方打印 —— 静默删除备份是不可接受的。
 *
 * 判据是"名字 + 类 + 份数"这种**确定**的东西（见文件头那条纪律）：
 * 它看不见迁移前快照（`listBackups()` 已经过滤掉了），因此
 * "升级那天的每日备份"不会被升级动作顺手删掉。
 */
export function pruneBackups(
  keep: number = backupKeep(),
  dir: string = backupDir(),
): PruneResult {
  return pruneNamed(listBackups(dir), keep);
}

/**
 * 按保留份数清理**最老的升级前快照**（默认留 10 份，`NEXGENEDU_MIGRATE_SNAPSHOT_KEEP`）。
 *
 * ## 什么时候调它：**生成一份新的迁移快照之后**（`server/migrate.mts` 里那一步）
 *
 * 不是每小时、也不是每次启动 —— 迁移快照只在结构升级时生成，清理就贴着生成那一步做，
 * 只有一处触发点（散落各处触发的话，早晚出现"某次启动顺手删了一批快照"，
 * 而那些快照是机构退回升级前唯一的凭据）。
 *
 * ## 三条不许违反的性质
 *
 *   1. **只删最老的**（`listBackupSnapshots()` 最新的在前，`slice(limit)` 就是最老的那几份）；
 *   2. **绝不碰每日备份**：候选只从 `kind === "migrate"` 里取 —— 这条与"每日备份的清理
 *      看不见迁移快照"是同一个纪律的两面；
 *   3. **删了谁要说出来**：返回被删的文件名，调用方必须打印 / 回复（静默删除备份不可接受）。
 */
export function pruneMigrationBackups(
  keep: number = migrationBackupKeep(),
  dir: string = backupDir(),
): PruneResult {
  const snapshots = listBackupSnapshots(dir).filter((item) => item.kind === "migrate");
  return pruneNamed(snapshots, keep);
}

/**
 * 清理的**唯一实现**（两个 `prune*` 都走它）。
 *
 * 为什么把它单独抽出来：清理是"删文件"这件事在这个项目里唯一被允许的形态，
 * 而"删哪些"必须由调用方用**确定的名字列表**给出（不是"按内容猜"）——
 * 文件头那条踩出来的纪律就是"永远不要用『没看到数据』当删除依据"。
 * 删不掉（权限 / 被占用）不该让备份流程失败：留着比删掉安全。
 */
function pruneNamed(candidates: BackupFile[], keep: number): PruneResult {
  const limit = Math.max(1, keep);
  const removed: string[] = [];
  for (const item of candidates.slice(limit)) {
    try {
      unlinkSync(item.path);
      removed.push(item.name);
    } catch {
      // 删不掉就留着：留着比删掉安全（调用方会把 removed 打印出来，因此人看得见实情）
    }
  }
  return { removed, kept: Math.min(candidates.length, limit) };
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

/**
 * 备份一份并清理旧份（保留份数见 `backupKeep()`）。
 *
 * `dir` 可以指定（默认 `backupDir()`）：**写进哪个目录、就按哪个目录的份数清理**，
 * 两者必须是同一个 —— 这是"立刻备份一份"那颗按钮要传 `dir` 的原因：
 * 它由 `server/daily-backup-files.mts` 调（那份能力自己就带着一个 `dir`，
 * 且那个 `dir` 在界面上是看得见的）。少了这个参数，文件能力会"列/读/另存"它的目录、
 * 却在生成时悄悄写到环境变量指的那个目录去 —— 那种分叉在测试里表现为
 * "备份生成了，但清单里没有"，在真实使用里则是"点了一下立刻备份，出来两份目录"。
 */
export function takeBackup(
  db: Database.Database,
  now: Date = new Date(),
  dir: string = backupDir(),
): BackupOutcome {
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
