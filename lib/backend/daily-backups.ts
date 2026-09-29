/**
 * 「**每天自动备份**」的清单与恢复 —— **口径**在这里，**文件读写**在服务端。
 *
 * ## 先分清本项目里的三套「备份」（这是最容易搞混的一件事）
 *
 * | 名字 | 存在哪 | 谁在用 | 恢复方式 |
 * | --- | --- | --- | --- |
 * | **每天自动备份**（本文件） | 服务端机器上的**文件**：`server/backups/nexgenedu-<时间>.db`，默认留 90 份 | 服务端每小时检查、每天备一份；命令行 `npm run server:backup` | **本文件**：界面上「每天自动备份」那一块 |
 * | 导入前自动备份 | 数据库里（同一个 KeyValueStore，键 `…backup.v1`），滚动 5 份 | 整库导入前自动留一份 | `api.restoreBackup()`（「恢复导入前的数据」按钮） |
 * | 导出的 JSON | 浏览器下载目录里的文件 | 换机器 / 换数据库时搬运用 | `api.importDatabase(text)` |
 *
 * 三者的**用途不同**，因此恢复入口也不同 —— 不要把它们合并成一个"恢复"按钮：
 * 一个是从**服务端机器上的文件**回到某一天，一个是从**上一次导入前的状态**回退，
 * 一个是从**你手上那份文件**灌进来。前两者的区别尤其要紧：
 * 只有第一套能回答机构真正会问的那个问题 —— "**这周三的数据还在吗**"。
 *
 * ## 为什么这一层要单独存在（而不是把文件读写塞进 api.ts）
 *
 * `lib/backend/api.ts` 是**浏览器与 Node 共用**的一份实现（线上静态站那份后台也在加载它），
 * 因此它不能 import `node:fs` / `better-sqlite3`。所以把这件事拆成两半：
 *
 *   - **这里**：说清"一份备份长什么样、什么叫读得出、恢复前要看到什么"——
 *     纯函数与类型，浏览器里也能跑（界面要用它拼确认框）；
 *   - **服务端**（`server/daily-backup-files.mts`）：真正去 `server/backups/` 列文件、
 *     打开某一份读出整库快照、把**当前库**另存一份。它通过
 *     `api.ts` 的 `__useDailyBackupFiles()` 装进来，与 `__useStoreForTesting()` 是同一个做法。
 *
 * 于是"**在浏览器里点恢复**"这件事根本不可能发生：没装那份能力时 `available: false`，
 * 界面直接说明"这件事只有服务端能做"。
 *
 * ## 恢复的**安全底线**（写在代码里，不只是写在文档里）
 *
 *   1. **先另存、后替换**：恢复前把"当前库"另存一份备份，并把**它的名字**告诉用户 ——
 *      恢复错了还能回来。这条是整个功能里最重要的性质：**一次误点不能造成不可逆的损失**；
 *   2. **二次确认**：服务端要求显式确认（`confirmed: true`），界面上还要先让人看到
 *      "这份备份里有什么 / 库里现在有什么"的条数对照；
 *   3. **坏备份一个字都不写**：读不出 / 不是本项目的快照 / 版本比当前新 / 空文件 → 明确拒绝，
 *      拒绝时**连另存那一步都不做**（校验全部通过之后才动第一个字节）；
 *   4. **只走服务层**：读快照 → 校验 → 迁移 → 落盘（`persist`），**绝不**在服务运行期间
 *      用文件复制去替换 `nexgenedu.db`（WAL 会把它弄坏，见 `server/db-lock.mts` 与
 *      `docs/部署与发布.md` 第 7 节那套手工步骤为什么只能停机做）；
 *   5. **不碰登录凭据**：恢复的是**业务数据**，`server/data/accounts.json` 与
 *      `server/data/admin-credential.json` **一个字都不动** —— 否则机构会把自己锁在门外。
 */

/**
 * 一份备份文件在磁盘上的样子（服务端读出来的原始信息）。
 *
 * `at` 是从**文件名**解析出来的时间点（本地时间），**不是**文件的 mtime ——
 * 理由见 `server/backup.mts` 的 `BackupFile.at`：复制 / rsync / 从别处恢复都会改写 mtime，
 * 而"哪份更新"必须由备份自己的名字说了算（演练里正是这条被踩过）。
 */
export type DailyBackupFile = {
  /** 文件名（不含目录），形如 `nexgenedu-2026-02-01-08-00-00-000.db`。 */
  name: string;
  bytes: number;
  /** 这份备份代表的时间点（ISO 字符串）。 */
  at: string;
};

/**
 * 服务端交给这一层的**文件能力**（浏览器里没有）。
 *
 * 三个方法刻意都是"要么给我结果、要么抛错"：`readSnapshot` 读不出时**抛错**而不是返回空串 ——
 * 一份读不出的备份必须是一句明确的拒绝理由，不能被当成"一份没有内容的备份"悄悄放过去。
 */
export type DailyBackupFileAccess = {
  /** 备份目录（给人看：界面上要显示它，运维要能一眼看到"备份存在哪"）。 */
  dir(): string;
  /** 列出每日备份（最新的在前）。 */
  list(): DailyBackupFile[];
  /** 读一份备份里的**整库快照**；读不出就抛错（文件不存在 / 不是本项目快照 / 空文件…）。 */
  readSnapshot(name: string): { text: string; at: string; bytes: number };
  /** 把**当前库**另存一份备份，返回新文件名。 */
  writeSnapshot(text: string): string;
};

/**
 * 清单里每一份的条数摘要（**读得出**才有）。
 *
 * 挑这几个数字是因为它们正好是机构判断"这份备份是不是我要的那一天"时真正会看的：
 * 学生 / 教师 / 教室 / 课程 / 课节 / 收款，再加课堂记录与课时流水（账本）。
 * 刻意**不带金额**：清单是"看一眼做决定"，金额那类数字要进确认框也要进操作日志，
 * 而日志会长期留在库里。
 */
export type DailyBackupCounts = {
  students: number;
  teachers: number;
  classrooms: number;
  courses: number;
  lessons: number;
  lessonRecords: number;
  payments: number;
  transactions: number;
};

/** 清单里的一行：文件信息 + 读得出的摘要（或**读不出的原因**）。 */
export type DailyBackupEntry = DailyBackupFile & {
  /** 读得出才有；读不出时是 `null`。 */
  counts: DailyBackupCounts | null;
  /**
   * 读不出摘要的原因（空串 = 读得出）。
   *
   * ⚠️ 读不出的那一份**必须显示出来**（界面上标红并禁用它的恢复按钮），
   * 不许"读不出就悄悄不显示"：目录里躺着一份坏备份，正是机构最该知道的事 ——
   * 他以为有 30 天的退路，实际可能只有 3 天。
   */
  problem: string;
};

/** 清单（界面「每天自动备份」那一块的唯一数据来源）。 */
export type DailyBackupList = {
  /** 这一层能不能用（浏览器里 / 没装服务端能力时是 false）。 */
  available: boolean;
  /** 不可用时的原因（一句人话，界面直接显示）。 */
  reason: string;
  /** 备份目录（不可用时是空串）。 */
  dir: string;
  /**
   * **库里现在**的条数。
   *
   * 与清单一起读回来（而不是让界面另外调几个接口去数）：确认框要做的是
   * "这份备份里有什么 / 库里现在有什么"的**对照**，两边必须来自同一时刻、同一份口径 ——
   * 分开取很容易出现"备份是 5 名学生、现在也是 5 名"这种看着一致、其实是两次读取的错觉。
   */
  current: DailyBackupCounts | null;
  /** 备份文件（最新的在前）。 */
  files: DailyBackupEntry[];
};

/**
 * 恢复的入参。
 *
 * `confirmed` **必须显式传 `true`**：这是服务端的第二道闸，与界面上的确认框是两回事 ——
 * 确认框是给人看的（挡住手滑），`confirmed` 是给**程序**看的（挡住"某个脚本顺手调了一下"）。
 * 少了它，一个 `confirmed` 拼错的调用会变成一次静默的整库替换。
 */
export type RestoreDailyBackupInput = { confirmed: boolean };

/** 恢复的结果。 */
export type RestoreDailyBackupResult =
  | {
      ok: true;
      /** 从哪一份恢复的（文件名）。 */
      file: string;
      /** 那一份代表的时间点（ISO）。 */
      at: string;
      /** **恢复前把当前库另存的那一份**的文件名 —— 界面必须把它告诉用户。 */
      preRestore: string;
      /** 恢复前的条数。 */
      before: DailyBackupCounts;
      /** 恢复后的条数（＝备份那一刻的条数）。 */
      after: DailyBackupCounts;
      /** 一句给用户看的话（含"现在用的是哪一天的数据""要回去就恢复哪一份"）。 */
      note: string;
    }
  | { ok: false; error: string };

/** 清单里那几个数字的中文写法（一处实现，界面与日志共用）。 */
const COUNT_LABELS: Array<{ key: keyof DailyBackupCounts; label: string; unit: string }> = [
  { key: "students", label: "学生", unit: "名" },
  { key: "teachers", label: "教师", unit: "位" },
  { key: "classrooms", label: "教室", unit: "间" },
  { key: "courses", label: "课程", unit: "门" },
  { key: "lessons", label: "课节", unit: "节" },
  { key: "lessonRecords", label: "课堂记录", unit: "条" },
  { key: "payments", label: "收款", unit: "条" },
  { key: "transactions", label: "课时流水", unit: "条" },
];

/**
 * 条数摘要 → 一行字（`学生 12 名、教师 3 位、…`）。
 *
 * 顺序固定（就是 `COUNT_LABELS` 的顺序）：两份摘要放上下两行做对照时，
 * 顺序一致才看得出"哪一项变了"。
 */
export function backupCountsText(counts: DailyBackupCounts): string {
  return COUNT_LABELS.map((item) => `${item.label} ${counts[item.key]} ${item.unit}`).join("、");
}

/** 文件大小 → 人话（备份都是 KB～几十 MB 这个量级）。 */
export function backupBytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 恢复前后的**条数对照**（`学生 12→5、教师 3→2、…`）—— 操作日志与成功提示都用这一句。
 *
 * 为什么日志里要写"多少条 → 多少条"而不是只写"已恢复"：事后回看这条日志的人要能判断
 * "那次恢复到底把什么换掉了"。数字是**唯一**能让人当场看出来的东西 ——
 * 一份"学生 12 名"的备份和一份"学生 5 名"的备份，只写"恢复了某某文件"是分不出来的。
 */
export function backupCountsDeltaText(before: DailyBackupCounts, after: DailyBackupCounts): string {
  return COUNT_LABELS.map((item) => {
    const from = before[item.key];
    const to = after[item.key];
    return from === to ? `${item.label} ${from}` : `${item.label} ${from}→${to}`;
  }).join("、");
}

/**
 * 时间点 → `2026-02-01 08:00:05`（**本地时间**）。
 *
 * 刻意不写"3 天前"这种相对说法：恢复这件事上人对**具体哪一天**才是有判断力的
 * （"那是改价之前的那天"），相对时间反而要多算一步。
 */
export function dailyBackupTimeText(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * 确认框里的**条数对照**（"这份备份里有什么 / 库里现在有什么"）。
 *
 * ## 为什么必须是纯函数、而且要有断言
 *
 * 整库导入那条路已经证明了这一条的价值：**没有数字对照的确认框等于没有确认**——
 * 人点"确定"的时候并不知道自己在换掉什么。而这段文字最容易"改着改着就少了一边"
 * （某次重构把它拼成一句话，看起来还挺好），所以它单独是一个函数，
 * `scripts/check.mts` 直接对着它断言（两边都在、顺序一致、读不出摘要时不许装作看得到数字）。
 *
 * `current` 为 `null`（当前库的条数还没读出来）时**如实说没读出来**，
 * 而不是留半边空白让人以为是 0。
 */
export function dailyBackupCompareText(
  entry: { name: string; at: string; counts: DailyBackupCounts | null; problem: string },
  current: DailyBackupCounts | null,
): string {
  const backupSide =
    entry.counts === null
      ? `这份备份（${entry.name}）**读不出摘要**：${entry.problem}\n`
      : `这份备份（${dailyBackupTimeText(entry.at)} 的 ${entry.name}）里：${backupCountsText(entry.counts)}\n`;
  const currentSide =
    current === null
      ? "库里现在：条数还没读出来（刷新这一页再试）\n"
      : `库里现在：${backupCountsText(current)}\n`;
  return backupSide + currentSide;
}
