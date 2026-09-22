/**
 * 记录级乐观锁：**同一条记录**的并发编辑防护。
 *
 * ## 要解决的问题（真实场景，不是假想）
 *
 * 后台的表单都是「**先读出来 → 人改 → 整份提交**」：信息采集表整份覆盖 `student.profile`，
 * 课程表单、教师表单整份覆盖那一条记录。两个人（或同一个人开两个标签页）同时编辑
 * **同一条**记录时，后提交的那个会把前一个人改的一整份**静默盖掉** ——
 * 对方看不到任何提示，只会在某天发现"我填的那几项怎么回去了"。
 *
 * 记录级 `version` 解决的就是这件事：每条记录带一个版本号（从 1 开始），
 * 写入口可以带上"我读到的是第几版"，与库里不一致就**拒绝**并让人刷新，
 * 而不是默默覆盖。
 *
 * ## 为什么是乐观锁，不是悲观锁（"打开表单就锁住这条记录"）
 *
 * 1. **本系统的真实使用形态是"偶发抢同一条"，不是"长时间持有"**。
 *    机构里两个人同时改同一条记录是少数情况；而表格编辑动辄十几分钟，
 *    悲观锁会让"张三打开表单去倒杯水，李四在这期间连备注都改不了"。
 * 2. **悲观锁需要"锁会过期/会被释放"的一整套机制**（关页面、断网、崩溃都会留下死锁），
 *    而这里的存储是**整库一份 JSON 快照**（见 `docs/后端开发方案.md` §5.3 路线 B），
 *    没有事务也没有按行锁 —— 想加锁只能自己造一套，那正是最容易做错的部分。
 * 3. **代价不对称**：乐观锁的代价是"偶尔让人刷新一次"，悲观锁的代价是
 *    "偶尔谁都改不了"，而在只有一两个人的机构里，前者便宜得多。
 *
 * ## 边界（说清楚，别以为它管得比实际多）
 *
 * - **只管同一条记录**：跨记录的事务性（"要么全成要么全不成"的多表动作）仍然只靠
 *   "一次整份落盘"这一层保证；
 * - **跨进程仍不在范围内**：两个后端进程同时写同一份快照会整体互相覆盖，
 *   这由启动时的单写者锁拒绝（`server/db-lock.mts`），不是这一层能解决的；
 * - **不传 `expectedVersion` 就完全不校验**（老调用方不受影响）——
 *   见 `assertVersion` 的注释里写的取舍。
 */

/**
 * 带记录级版本号的实体形状。
 *
 * 刻意用 `version?: number`（可选）而不是必填：**老数据与夹具**里的对象可能没有这个字段
 * （手改过的导出文件、"迁移只跑了一半"的库、自检里手写的 `Teacher[]` 字面量），
 * 而这类对象一旦被读到 `undefined`，比较就会变成 `undefined !== 3` 这种**假冲突**。
 * 因此读写一律经过 `versionOf()` 归一，而不是直接摸字段。
 */
export type MaybeVersioned = { version?: number };

/** 正式实体上的版本号类型（`Student` / `Teacher` / `Course` / `Lesson` / `Classroom` 用这个）。 */
export type Versioned = { version: number };

/**
 * 写入口的可选参数：带上"我读到的是哪一版"。
 *
 * 刻意做成**可选**而不是必填：老调用方（脚本、验收、内部业务动作）一行都不用改，
 * 语义是"我自己负责，不用你替我拦"。界面上的表单才需要传。
 */
export type WriteOptions = {
  /** 我读到的那条记录的版本号；不传＝不校验。 */
  expectedVersion?: number;
};

/**
 * 冲突提示里的固定说法。
 *
 * 为什么要有一个常量：自检要在**两种后端**上断言"错误里含这句"（内存实现抛的是
 * 这个类的实例，走 HTTP 时前端只拿到一句文字 —— 见 `lib/backend/remote.ts` 把
 * 服务端返回的 `error` 原文包成 `Error`）。断言只认文字，因此这句话必须**只有一处**，
 * 改错了就会两边不一致而没人发现。
 */
export const CONFLICT_PHRASE = "刚被别人改过";

/**
 * 版本冲突（可识别的冲突错误）。
 *
 * 与"参数写错了"必须分开：`server/index.mts` 按类型把它翻成 **HTTP 409**，
 * 与权限不足的 403、参数错误的 400 并列（做法完全一致 —— 不新造一套机制）。
 *
 * 为什么值得单独一个类而不是抛普通 Error：
 *   1. 接口层要靠类型判它（否则只能去匹配错误文字，那种做法改一个字就悄悄失效）；
 *   2. 将来界面若想"冲突时自动重新拉一次这条记录"，也要能认出它。
 */
export class VersionConflictError extends Error {
  /** 库里**当前**的版本号（提示里要显示它，人才知道"别人已经改到第几版了"）。 */
  readonly currentVersion: number;
  /** 提交时带上的版本号（用户手上那一份）。 */
  readonly expectedVersion: number;

  /**
   * @param currentVersion 库里当前的版本
   * @param expectedVersion 调用方带上的版本
   * @param subject 这条记录是谁（写成「学生「张三」」这样的人话；留空时用「这条记录」）
   */
  constructor(currentVersion: number, expectedVersion: number, subject = "") {
    super(
      `${subject === "" ? "这条记录" : subject}${CONFLICT_PHRASE}` +
        `（当前版本 ${currentVersion}，你手上的是 ${expectedVersion}），请刷新后再提交。`,
    );
    this.name = "VersionConflictError";
    this.currentVersion = currentVersion;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * 读一条记录的版本号。
 *
 * 缺失或非法一律当 **1**（而不是 0 或 NaN）：与迁移给老数据补的口径一致。
 * 不能返回 0：0 会让"这条记录从来没被写过"与"记录坏了"混在一起，
 * 而且提示里出现「当前版本 0」会让人以为是自己看错了。
 */
export function versionOf(record: MaybeVersioned): number {
  const value = record.version;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 1;
  return Math.trunc(value);
}

/**
 * 写入前比一次版本：不一致就抛冲突。
 *
 * ## 取舍一：不传 `expectedVersion` 时**不校验**
 *
 * 这是"老调用方不受影响"的硬要求（自检有一条断言盯着）。代价是：写接口可以被
 * 有意绕过乐观锁 —— 但那是**服务端内部的脚本与业务动作**在用，
 * 它们的语义本来就是"我就是要改，别拦我"；界面上的表单全都传。
 *
 * ## 取舍二：传了但**不是正整数** → 按"参数错"抛，而不是说成冲突
 *
 * 传 `NaN` / `0` / 负数 / `1.5` 只可能是调用方算错了（页面上读到的一定是 ≥ 1 的整数）。
 * 这时候说"这条记录刚被别人改过"会把排障引到"谁改的"上面去，而真正的问题是
 * **那个数字从哪来的** —— 所以两条错误分开：
 *   - 版本号不合法 → 普通 Error（接口层回 **400 参数错**）；
 *   - 版本号合法但对不上 → `VersionConflictError`（接口层回 **409 冲突**）。
 *
 * 两条路都**不写库**（失败关闭）："宁可误拦，不要放过"这一条始终成立 ——
 * 放过的代价是静默覆盖别人的修改，拦住的代价只是让人看到一句提示。
 */
export function assertVersion(
  record: MaybeVersioned,
  expected: number | undefined,
  subject = "",
): void {
  if (expected === undefined) return;

  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error(
      `提交时带上的版本号不合法（${String(expected)}）` +
        (subject === "" ? "" : `：${subject}`) +
        "。这不是「被别人改过」，而是调用方算错了版本号；请刷新页面后重新提交。",
    );
  }

  const current = versionOf(record);
  if (expected !== current) throw new VersionConflictError(current, expected, subject);
}

/**
 * 版本号 +1，返回新值。写入口在**成功写入之后**调用。
 *
 * ## 为什么"没传 `expectedVersion` 也照常 +1"
 *
 * 因为版本号要始终代表**"这条记录被写过几次"**。如果只有带 `expectedVersion` 的写才 +1，
 * 那么同一个界面操作（点一次保存）会因为"是不是老代码调的"而让版本号跳或不跳 ——
 * 版本号就变成一个只有部分操作会推进的计数器，而"它到底代表什么"没人说得清。
 * 何况两处口径不一致最容易出的事故是：**老代码在改数据、界面上的版本号却纹丝不动**，
 * 于是乐观锁看起来工作正常、实际上漏了一整类写入。
 *
 * 代价是"没传版本的写入也会让别人手上的版本过期"（下次提交会看到冲突）。
 * 这是**有意接受**的：那条写入确实改了这份数据，别人读到的东西确实过期了 ——
 * 宁可让人刷新一次，也不要放过一次静默覆盖。
 */
export function bumpVersion(record: MaybeVersioned): number {
  const next = versionOf(record) + 1;
  /*
   * 参数类型故意是 `MaybeVersioned`（版本号可选）而不是 `Versioned`（必填）：
   * 调用方里有两类"版本号可能不在类型上"的记录 —— 批量导入那边的 `Record<string, unknown>`、
   * 以及"入参可能不带版本号"的 `{...target, ...patch}`。如果这里要求必填，
   * 那些地方就得各写一次类型断言（同一个收窄抄三遍，改一处忘一处）。
   * 收窄集中在这一行，写回的是**真正的数字**（`versionOf` 已把缺失归一成 1）。
   */
  (record as Versioned).version = next;
  return next;
}
