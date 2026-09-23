import { createKeyValueStore, type KeyValueStore } from "./storage";
import { createEmptyDatabase } from "./initial";
import { catalogFromSeed, catalogSeedSummary } from "./catalog-seed";
import { catalogSummary, validateCatalog } from "./catalog";
import { syncClassTypes } from "./class-types";
import { courseDimensionProblems, suggestCourseDimensions } from "./course-dimensions";
import { validateVacations } from "./calendar-plan";
import { danglingOffers, offerId, offersSummary, validateOffers, type OfferKey } from "./offers";
import {
  emptySiteContent,
  siteContentFromContent,
  validateSiteBlocks,
  validateSiteContent,
} from "./site-content";
import type { SiteContent } from "./types";
import { publicSite } from "./public-site";
import type { PublicSite } from "./public-site";
import { describeSeriesDate, generateSeriesDates } from "./recurrence";
import {
  applyImport,
  detectConflicts,
  ENTITY_SPECS,
  parseImport,
  summarizeImport,
  type Conflict,
  type ConflictStrategy,
  type ImportEntity,
  type ImportFormat,
  type ParsedImport,
} from "./import";
import { isWithinAvailability } from "./availability";
import { CURRENT_VERSION } from "./version";
import {
  assertVersion,
  bumpVersion,
  type WriteOptions,
} from "./concurrency";
import { createRemoteApi, isRemoteMode, remoteBase } from "./remote";
import { addTransaction, nowIso, reconcileCharge, recordPayment } from "./charges";
import { enrollmentForLesson, lessonBalance, remainingOf, remainingTotal } from "./enrollment";
/*
 * 低课时预警的阈值从「待跟进」那一份规则里取（`FOLLOWUP_RULES.lowLessons`）：
 * 界面上写着"阈值集中在 FOLLOWUP_RULES，改那一处即可"，那就必须真的只有那一处 ——
 * 早先概览与学生页各自写死一个 5，改了常量它们不会跟着动（审计抓到的那条）。
 */
import { FOLLOWUP_RULES } from "./followup";
import { countLessons } from "./lesson-stats";
import { decideCharge, isAbsent } from "./attendance";
import { databaseStats, validateImportedDatabase, type ImportOutcome } from "./backup";
import { buildFollowUps, type FollowUpItem } from "./followup";
import { searchAll } from "./search";
import {
  buildDateSeries,
  checkAssignment,
  evaluateSlot,
  minutesToTime,
  slotMinutes,
} from "./inquiry";
import type { FeasibilityReport } from "./inquiry";
import {
  churnStats,
  hourlyLoad,
  rangeSummary,
  roomUtilization,
  teacherWorkload,
  type ChurnStats,
  type RoomUtilization,
  type TeacherWorkload,
} from "./stats";
import { weekDays } from "./format";
/*
 * 行级范围的规则（谁是普通教师、哪些方法要过滤、哪些对教师关门）**只在 `lib/auth/roles.ts`**，
 * 这里只 import 常量与类型 —— 服务端闸门与这一层读的是同一份判定，不可能分叉。
 * 没有循环引用：roles.ts 只 import `contract.ts`（接口分组），而 contract.ts 不 import 任何实现。
 */
import { SCOPE_ALL, type SessionScope } from "@/lib/auth/roles";
import { DEFAULT_TEACHER_SHARE_RULES } from "@/lib/data/pricing";
import {
  PRICING_SOURCE_ADMIN,
  pricingConfigFromContent,
  syncLibraryLinks,
  teacherFeeForSelection,
  pricingConfigToMarkdown,
  quoteSelection,
  validatePricingConfig,
} from "./pricing";
import type {
  PricingConfig,
  QuoteResult,
  QuoteSelection,
  TeacherFeeResult,
  TeacherFeeSelection,
} from "./pricing";
export type {
  PricingConfig,
  QuoteResult,
  QuoteSelection,
  TeacherFeeResult,
  TeacherFeeSelection,
} from "./pricing";
export type { CourseOption, CourseSummary } from "./courses";
export type { ExportDataset, ExportFormat, ExportResult } from "./export";
export { EXPORT_DATASETS, EXPORT_FORMATS, FORMAT_META } from "./export";
import {
  REFUND_POLICIES,
  calculateRefund,
  findRefundPolicy,
  monthRange,
  outstandingAmount,
  round2,
  summarizePayments,
  withinRange,
  type PaymentSummary,
} from "./finance";
import type { StudentProfile } from "./student-profile";
import { getCourseColumnsFromTemplate } from "@/lib/data/site";
import { exportDataset as buildDatasetExport } from "./export";
import type { ExportRequest, ExportResult } from "./export";
import {
  canRemoveCourse,
  courseOptions,
  coursesFromSite,
  normalizeCourse,
  summarizeCourses,
  validateCourse,
} from "./courses";
import { extraCourseDimensions, extraCourses } from "./extra-courses";
import type { CourseOption, CourseSummary } from "./courses";
import { nextId } from "./ids";
import {
  applyPartitionOrder,
  normalizePartition,
  partitionDeleteRefusal,
  partitionName,
  validatePartition,
} from "./course-partitions";
import type {
  Assessment,
  Classroom,
  CoursePartition,
  SiteCase,
  SiteCasesPage,
  Catalog,
  CatalogStage,
  CatalogSubject,
  CatalogModule,
  CatalogFormat,
  CatalogOffer,
  VacationPeriod,
  SiteCopyBlock,
  SiteCopyGroup,
  SiteCopyItem,
  SiteCopyKey,
  SiteFaqGroup,
  SiteFaqItem,
  SiteFaqPage,
  SiteFeaturedCourse,
  SiteFeaturedPage,
  LessonTransaction,
  Payment,
  ClassroomAvailability,
  ClassroomKind,
  CompletionResult,
  HomeworkRecord,
  LessonRecord,
  NewAssessment,
  NewHomeworkRecord,
  NewLessonRecord,
  Inquiry,
  InquirySlot,
  InquiryStatus,
  NewInquiry,
  NewPayment,
  OperationLog,
  PaymentMethod,
  ConflictReport,
  Database,
  Enrollment,
  LessonInput,
  NewEnrollment,
  NewStudentEnrollment,
  EnrollmentEdit,
  EnrollmentEditScope,
  EnrollmentEditResult,
  Lesson,
  NewClassroom,
  NewLesson,
  NewStudent,
  NewTeacher,
  Student,
  Teacher,
  TodaySummary,
  SearchHit,
  Course,
  CourseOrigin,
  CourseStatus,
  CourseSiteKind,
} from "./types";

/*
 * 冲突错误在这里**对外再导出一次**：界面与将来的调用方只认 `lib/backend/api`
 * 这一个出口（与 `PricingConfig` / `ExportFormat` 那几个类型的做法一致）。
 * 服务端自己不从这里拿 —— 它直接 import `concurrency.ts`（少一层间接）。
 */
export { VersionConflictError } from "./concurrency";
export type { WriteOptions } from "./concurrency";

/**
 * 伪后端服务：后台页面的**唯一**数据入口。
 *
 * 设计目标是把「现在没有服务端」这件事挡在这一层里面：
 *
 * - 所有方法都是 `async`，签名与将来的 HTTP 接口一致
 *   （`list` / `get` / `create` / `update` / `remove`），
 *   页面上不会出现「同步读 localStorage」这种将来必须重写的写法；
 * - 数据以一份 JSON 快照存在键值存储里（浏览器里就是 localStorage），
 *   每次写入立即落盘，因此刷新、关掉浏览器再打开都还在；
 * - 将来接真后端时，只替换本文件的实现（改成 fetch 到你的服务），
 *   `types.ts` 的类型与所有页面代码不变。
 *
 * 明确的局限（不是 bug，是「纯前端」的边界）：
 * - 数据在**当前浏览器**里，换设备看不到；清缓存会丢；
 * - **同一条记录**的并发编辑有乐观锁保护（v17 起记录带 `version`，见
 *   `lib/backend/concurrency.ts`）：两个人同时改同一条时，后提交的会被**拒绝**并
 *   提示刷新，而不是静默覆盖先提交的。**跨记录**的并发（"要么全成要么全不成"的
 *   多表动作）与**跨进程**的并发仍不在范围内（后者由 `server/db-lock.mts`
 *   的单写者锁拒绝，不是这一层能解决的）。
 */

const STORAGE_KEY = "nexgenedu.admin.db.v1";

/** 「导入前」的备份键：导入是唯一能一次性毁掉全部数据的操作，留一颗后悔药。 */
const BACKUP_KEY = "nexgenedu.admin.db.backup.v1";

/**
 * 「导入前备份」改成**滚动保留最近几份**。
 *
 * ## 为什么（审计抓到的一条"后悔药只有一次"）
 *
 * 早先只有一个键：每次导入都把它覆盖掉。于是"选错文件 → 导入 → 发现不对 → 恢复"这一步
 * 只能走一次；再选错一次，那唯一一份备份也没了，`restoreBackup` 再也回不去。
 * 而整库导入是全系统破坏力最大的动作。
 *
 * 现在：每份备份一个键（带时间戳），另外用一个**索引键**记住它们（KeyValueStore 只有
 * read/write/remove，没有"列出所有键"的能力，所以必须自己维护一个索引）。
 * 保留最近 `BACKUP_SLOTS` 份，更老的删掉（删除用 `store.remove`，不会撑爆存储）。
 *
 * 兼容：老库里那个单键备份仍然认（`hasBackup` / `restoreBackup` 会先看索引、再看老键），
 * 下一次导入时会把它当成一份普通备份收进索引。
 */
const BACKUP_INDEX_KEY = "nexgenedu.admin.db.backups.v1";
/** 保留几份（含刚写的那一份）。 */
export const BACKUP_SLOTS = 5;

type BackupSlot = { key: string; at: string; summary: string };

function readBackupIndex(): BackupSlot[] {
  const raw = store.read(BACKUP_INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is BackupSlot => {
        if (typeof item !== "object" || item === null) return false;
        const slot = item as Record<string, unknown>;
        return typeof slot.key === "string" && typeof slot.at === "string" && slot.key !== "";
      })
      .map((slot) => ({ key: slot.key, at: slot.at, summary: typeof slot.summary === "string" ? slot.summary : "" }))
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

function writeBackupIndex(slots: BackupSlot[]): void {
  store.write(BACKUP_INDEX_KEY, JSON.stringify(slots));
}

/** 写一份"导入前备份"，并把超过保留份数的老备份删掉。返回这一份的说明。 */
function writeBackupSlot(summary: string): string {
  const at = nowIso();
  // 兼容：老库里那个单键备份先收进索引，免得被后来的轮换挤掉
  const legacy = store.read(BACKUP_KEY);
  let slots = readBackupIndex();
  if (legacy !== null && !slots.some((slot) => slot.key === BACKUP_KEY)) {
    slots = [...slots, { key: BACKUP_KEY, at, summary: "（升级前留下的那一份备份）" }];
  }
  store.write(BACKUP_KEY, JSON.stringify(load()));
  const merged = [{ key: BACKUP_KEY, at, summary }, ...slots.filter((slot) => slot.key !== BACKUP_KEY)]
    .sort((a, b) => b.at.localeCompare(a.at));
  const kept = merged.slice(0, BACKUP_SLOTS);
  for (const slot of merged.slice(BACKUP_SLOTS)) {
    if (slot.key !== BACKUP_KEY) store.remove(slot.key);
  }
  writeBackupIndex(kept);
  return at;
}

// 版本号与变更记录见 lib/backend/version.ts（seed 与迁移必须用同一个值）

/**
 * 模拟网络延迟，让加载态、按钮禁用等交互在开发时就暴露出来。
 *
 * **只在浏览器里生效**（`typeof window !== "undefined"`）—— 它存在的理由是让人看见
 * 加载态，而 Node 里跑的那些调用（服务端、自检、验收、演练）没有任何加载态要露出来，
 * 只有纯粹的浪费。实测这一条的成本很硬：服务端每个 `/api/call` 都会白等 120ms，
 * 而真实计算量在百人规模的库上只有几毫秒——**延迟主要是这个 sleep，不是设备**。
 * （`npm run check` 也受影响：38 秒里约 37 秒是在 sleep。）
 */
const LATENCY_MS = 120;

/** 是否在浏览器里运行（只有那种情况才需要"像有网络一样慢"）。 */
function inBrowser(): boolean {
  return typeof window !== "undefined";
}

let store: KeyValueStore = createKeyValueStore();
let cache: Database | null = null;

function delay(): Promise<void> {
  if (!inBrowser()) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}



/** 读取整库；首次访问时灌入示例数据。 */
function load(): Database {
  if (cache !== null) return cache;

  const raw = store.read(STORAGE_KEY);
  if (raw !== null) {
    /*
     * ## 有内容却读不出来时，**绝不能覆盖**（审计抓到的一条"整库清零"路径）
     *
     * 早先这里的写法是"读不出来就当首次访问"：`migrate()` 返回 null（版本比当前新、
     * 或某个分支卡住）或 JSON 解析失败时，直接 `createEmptyDatabase()` 并**落盘覆盖**
     * —— 一次读就把数据清空，而且不可逆。实测过的场景：一份结构正常、只是版本号
     * 写着 1 或 2 的库，读一次就变成空库（根因见 v2 分支那段注释）。
     *
     * 现在分三种情况，各自说清：
     *   1. 存储里**没有**内容 → 空库起步（正常，见 `initial.ts`）；
     *   2. 有内容且能迁移 → 迁移并（必要时）落盘；
     *   3. 有内容但解析/迁移失败 → **抛错、什么都不改**，让人用备份恢复。
     * 第 3 条是这次改动的全部意义：宁可整个后台打不开（并说清为什么），
     * 也不要静默把数据抹掉 —— 抹掉之后连"发生过什么"都查不到了。
     */
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(raw);
    } catch (cause) {
      throw new Error(
        `库里的数据不是合法 JSON（${cause instanceof Error ? cause.message : String(cause)}）。` +
          "**本次没有改动任何数据** —— 请用「数据与备份」里的导入、或用备份文件恢复，" +
          "或联系开发处理；不要清空数据库。",
      );
    }
    const version =
      typeof parsedJson === "object" && parsedJson !== null
        ? (parsedJson as { version?: unknown }).version
        : undefined;
    const parsed = migrate(parsedJson as Database);
    if (parsed !== null) {
      cache = parsed;
      // 迁移过就立刻落盘，避免每次打开都迁移一遍
      if (parsed.version !== version) persist(cache);
      return cache;
    }
    throw new Error(
      `库里的数据版本是 ${String(version)}，本版本（v${CURRENT_VERSION}）迁移不了它 —— ` +
        "这通常意味着数据来自更老的版本、或来自更新的版本。" +
        "**本次没有改动任何数据**：请用服务器备份（server/backups/）或导出的 JSON 恢复，" +
        "或联系开发处理；不要清空数据库。",
    );
  }

  // 空库起步，**不是**示例数据：见 lib/backend/initial.ts 的说明。
  // （这里早期灌的是 createSeedDatabase()，那会让员工一打开就看到 8 位不是自己录的学生。）
  cache = createEmptyDatabase();
  persist(cache);
  return cache;
}

/**
 * 老数据升级到当前结构版本。
 *
 * **分支必须按版本升序排列、逐级推进**：一次调用要把 v1 一路迁到当前版本。
 * 这里踩过一次坑：把「v3 → v4」的分支写在「v1 → v2」之前，于是 v1 数据
 * 迁到 v3 就停了（v3 分支已经执行过、不会再执行），migrate 返回 null，
 * 调用方直接把数据重新灌成了示例数据 —— 用户看到的是「我的数据没了」。
 *
 * 返回 null 表示这份数据没法用（版本比当前还新，或结构不认识）。
 *
 * ## 返回 null 之后调用方**不再**清库（2026-09 审计改的）
 *
 * 这段注释原先写的是"调用方会重新灌入示例数据" —— 那正是"我的数据没了"的成因：
 * 一次迁移失败就把整库换成一份新的。现在 `load()` 对"有内容但迁移不了"一律**抛错**、
 * 什么都不改（见那里的说明），`importDatabase` / `restoreBackup` 本来就会拦 null。
 */
/** 是否是 v2 及更早的学生结构（课时挂在学生身上的总数）。 */
function isLegacyStudent(student: Student): boolean {
  const legacy = student as unknown as {
    remainingLessons?: number;
    enrollments?: unknown;
  };
  return (
    typeof legacy.remainingLessons === "number" || !Array.isArray(legacy.enrollments)
  );
}

function migrate(db: Database): Database | null {
  if (db.version > CURRENT_VERSION) return null;

  if (db.version === 1) {
    // v1 的教室只有 name / capacity / note
    db.classrooms = db.classrooms.map((room) => ({
      ...room,
      kind: room.kind ?? "上课用教室",
      availability: room.availability ?? [],
    }));
    db.version = 2;
  }

  /*
   * v2 → v3 只在**确实是旧结构**时执行：判据是「有 remainingLessons 字段」
   * 或「没有 enrollments 数组」。只比较版本号是不够的 —— 曾因为 seed 写错版本
   * 让新数据被当成旧数据迁移，把报课记录压成了一条。数据迁移宁可少做不可做错。
   */
  /*
   * v2 → v3。
   *
   * ## 这里改过一次（2026-09 审计抓到的"整库清零"）
   *
   * 早先写成 `if (db.version === 2 && db.students.some(isLegacyStudent)) { … db.version = 3; }`
   * —— 也就是说**结构已经是新版、但版本号还写着 1 或 2** 时，分支体不执行、版本号**不推进**，
   * 后面每个 `if (db.version === N)` 全部跳过 → `migrate()` 返回 null →
   * 调用方（`load()`）把它当成"首次访问"，**整库被清空并落盘**。
   * 实测：一份 8 名学生 / 18 条收款的库，只因为版本号写着 2，读一次就变成 0/0，且不可逆。
   *
   * 那些守卫（`isLegacyStudent`）本意是"防止把新数据当旧数据迁错"，方向是对的；
   * 但"要不要做结构变换"与"版本号推进到哪"是**两件事**，混在一个条件里就会卡住。
   * 现在分开：变换按守卫决定，版本号**无条件推进**。
   */
  if (db.version === 2) {
    if (!db.students.some(isLegacyStudent)) {
      /*
       * 结构已经是 v3+ 的样子：什么都不用做，只把版本号补上（见上面的说明）。
       * 这种情况实测来自"老库的版本号没跟着结构走"（历史上 seed 写过旧版本号）。
       */
      db.version = 3;
    } else {
    /*
     * v2 的学生是 { subjects, remainingLessons }；v3 改为档案 + 按科目记账。
     * 折算规则：剩余课时变成一条「未指定科目」的报课记录（total = 剩余、used = 0），
     * 科目沿用原来的 subjects 列表 —— 一条总数无法拆成多科，因此不猜，
     * 让管理员在界面上按实际情况调整到具体科目。
     */
    db.students = db.students.map((legacy) => {
      // 已经是新结构的（理论上不该出现）原样返回，避免无谓改写
      if (!isLegacyStudent(legacy)) return legacy;

      const student = legacy as Student & {
        remainingLessons?: number;
        subjects?: string[];
      };
      const remaining = Math.max(0, Math.trunc(student.remainingLessons ?? 0));
      const subjects = student.subjects ?? [];

      const enrollments: Enrollment[] =
        remaining > 0 || subjects.length > 0
          ? [
              {
                id: `e_legacy_${student.id}`,
                subject: subjects.length === 1 ? (subjects[0] ?? "") : "未指定科目",
                form: "",
                teacherId: "",
                totalLessons: remaining,
                usedLessons: 0,
                unitPrice: 0,
                agreedAmount: 0,
                paidAmount: 0,
                startedAt: student.createdAt,
                endedAt: "",
                status: "在读",
                note: "由旧版「剩余课时」折算，请按实际情况调整科目与课时",
                history: [
                  {
                    at: nowIso(),
                    kind: "报课",
                    lessons: remaining,
                    note: "旧数据折算",
                  },
                ],
              },
            ]
          : [];

      // 旧的 remainingLessons 字段被报课记录取代，这里显式丢掉（不留在数据里）
      const { remainingLessons: _legacyLessons, ...rest } = student;
      void _legacyLessons;
      return {
        ...rest,
        profile: student.profile ?? {},
        enrollments,
        subjects: subjects.length > 0 ? subjects : enrollments.map((item) => item.subject),
      } as Student;
    });
    db.version = 3;
    }
  }

  if (db.version === 3) {
    // v3 → v4：新增动态追踪三张表（课堂记录 / 作业记录 / 阶段测评）
    db.lessonRecords = db.lessonRecords ?? [];
    db.homeworkRecords = db.homeworkRecords ?? [];
    db.assessments = db.assessments ?? [];
    db.version = 4;
  }

  if (db.version === 4) {
    /*
     * v4 → v5：课时流水从「报课记录里内嵌的 history」变成独立账本。
     *
     * 折算规则：history 每条变成一笔流水（报课/续费为正、退课为 0），
     * 并按 usedLessons 补出对应的「上课」流水 —— 两者相加必须与课时余额自洽，
     * 否则升级后对账数字会对不上。
     */
    db.transactions = db.transactions ?? [];

    for (const student of db.students) {
      for (const enrollment of student.enrollments) {
        for (const [index, item] of (enrollment.history ?? []).entries()) {
          db.transactions.push({
            id: `tx_mig_${enrollment.id}_${index}`,
            studentId: student.id,
            enrollmentId: enrollment.id,
            subject: enrollment.subject,
            delta: item.kind === "退课" ? 0 : item.lessons,
            kind: item.kind,
            lessonId: "",
            at: item.at,
            note: item.note,
            reversedAt: "",
          });
        }

        for (let index = 0; index < enrollment.usedLessons; index += 1) {
          db.transactions.push({
            id: `tx_mig_use_${enrollment.id}_${index}`,
            studentId: student.id,
            enrollmentId: enrollment.id,
            subject: enrollment.subject,
            delta: -1,
            kind: "上课",
            lessonId: "",
            at: enrollment.startedAt,
            note: "升级前的历史课时（未关联具体课节）",
            reversedAt: "",
          });
        }
      }
    }

    db.version = 5;
  }

  if (db.version === 5) {
    /*
     * v5 → v6：报课记录增加金额（标价单价 / 约定应缴 / 实收），新增收款流水表。
     *
     * 老数据里没有任何金额信息，因此**一律记 0 而不是猜**：
     * 猜一个单价会让「欠费清单」凭空冒出金额，比留空危险得多。
     * 管理员可以在界面上按实际情况补。
     */
    db.payments = db.payments ?? [];

    for (const student of db.students) {
      for (const enrollment of student.enrollments) {
        enrollment.unitPrice = enrollment.unitPrice ?? 0;
        enrollment.agreedAmount = enrollment.agreedAmount ?? 0;
        enrollment.paidAmount = enrollment.paidAmount ?? 0;
      }
    }

    db.version = 6;
  }

  if (db.version === 6) {
    // v6 → v7：课堂记录增加请假时间、课节增加补课关联。
    // 老记录没有请假时间 → 空串，按「临时缺课」处理（不默认成对机构有利的解释）
    db.lessonRecords = db.lessonRecords.map((record) => ({
      ...record,
      leaveRequestedAt: record.leaveRequestedAt ?? "",
    }));
    db.lessons = db.lessons.map((lesson) => ({
      ...lesson,
      makeupForLessonId: lesson.makeupForLessonId ?? "",
    }));
    db.version = 7;
  }

  if (db.version === 7) {
    // v7 → v8：新增操作日志表。老数据没有日志 → 空数组，不伪造历史记录
    db.logs = db.logs ?? [];
    db.version = 8;
  }

  if (db.version === 8) {
    // v8 → v9：新增咨询线索表（从空开始，不伪造历史咨询）
    db.inquiries = db.inquiries ?? [];
    db.version = 9;
  }

  if (db.version === 9) {
    /*
     * v9 → v10：报价配置进入数据库。
     *
     * 老库没有这份配置 → 用站点内容初始化（价格与迁移前完全一致，
     * 因此升级不会让任何一节课变价）。分支必须接在 v9 之后，
     * 顺序错了迁移链会断在这里、整库被当成坏数据重新灌种子。
     */
    db.pricing = db.pricing ?? pricingConfigFromContent();
    db.version = 10;
  }

  if (db.version === 10) {
    /*
     * v10 → v11：报价配置增加教师分成规则。
     *
     * v10 的库里没有这个字段，直接读会取到 undefined（算课时费时变成 NaN）。
     * 补成默认的 40% / +10% / 课程标准单价 —— 与内容文件里的口径一致。
     */
    db.pricing = {
      ...db.pricing,
      teacherShare: db.pricing.teacherShare ?? DEFAULT_TEACHER_SHARE_RULES,
    };
    db.version = 11;
  }

  if (db.version === 11) {
    /*
     * v11 → v12：新增课程库。老库没有课程表 → 用网站内容里的课程卡片灌入，
     * 与迁移前「科目候选来自网站内容」完全一致，因此升级不会让任何一节课的科目失效。
     *
     * 还要补上**报价里有、卡片上没有的那几门后台课**（`extraCourses()`）：
     * 升级上来的库如果只有网站卡片，报价页上那些课（中考冲刺 / 医学 / 成人旅游、出行…）
     * 在课程库里就不存在 —— 报课时选不到、也排不了课，与"以课程清单为准"正好相反。
     * 与空库起步、示例库用的是同一份定义。
     */
    db.courses = db.courses ?? [...coursesFromSite(), ...extraCourses()];
    db.version = 12;
  }

  if (db.version === 12) {
    /*
     * v12 → v13：教师档案增加"资料"字段（教龄 / 简介 / 详细介绍 / 来源 / 类型）。
     *
     * 老库没有这些字段 → 一律补空值与默认值，**不猜内容**：
     * 来源默认「后台」（老数据是机构自己录的），类型默认「教师」
     * （老库里不可能有 AI 档案，那时还没有这个概念）。
     */
    db.teachers = db.teachers.map((teacher) => ({
      ...teacher,
      years: teacher.years ?? "",
      summary: teacher.summary ?? "",
      bio: teacher.bio ?? "",
      origin: teacher.origin ?? "后台",
      kind: teacher.kind ?? "教师",
    }));
    db.version = 13;
  }

  if (db.version === 13) {
    /*
     * v13 → v14：教师档案增加**推荐理由**与**网站显示顺序**。
     *
     * 这两个字段原先只存在于网站文件（`data/site/content.md` 的教师段），
     * 后台看不见也改不了；网站要改成"以后端为准"就必须先把它们搬进来。
     *
     * 老数据一律补默认值、**不猜内容**：推荐理由留空（页面上不显示这一行），
     * 顺序按现有数组次序编号 —— 数组顺序就是机构原来的显示顺序，
     * 编成 1、2、3… 之后在后台调整顺序才是确定性的。
     */
    db.teachers = db.teachers.map((teacher, index) => ({
      ...teacher,
      recommendation: teacher.recommendation ?? "",
      order: typeof teacher.order === "number" ? teacher.order : index + 1,
    }));
    db.version = 14;
  }

  if (db.version === 14) {
    /*
     * v14 → v15：课程库补上「网站卡片」字段，并新建**网站课程正文**。
     *
     * 课程的新字段一律补默认值：老库里那些课程是给排课/报课用的台账，
     * 它们**不一定在网站上展示**，因此 `path` 留空、`siteKind` 记「不展示」——
     * 不能默认成"学科"，否则一次升级就会让网站多出一批没有正文的空卡片。
     *
     * 网站课程正文取**空结构**而不是拿网站文件来填：迁移是照着数据搬，不是
     * 借机去读外部的 Markdown —— 灌内容的时机是**建库**（`initial.ts`）与**导入备份**，
     * v32 起不再有运行期的入口（那两个按钮已删）。
     * 这也让网站那侧的判定（有内容才用后端）能生效。
     */
    // 补默认值走 normalizeCourse（与新建/修改同一处默认值，避免两套口径）
    db.siteContent = { ...emptySiteContent(), ...(db.siteContent ?? {}) };
    db.courses = db.courses.map((course) => normalizeCourse(course));
    /*
     * 顺手把 v14 的教师字段也再兜一遍。
     *
     * 这不是多余的：**一份声称自己是 v14 的文件，未必真有那两个字段** ——
     * 手改过的导出文件、以及"迁移脚本只跑了一半"的库都长这样，
     * 而缺字段的后果是网站在排序时读到 `undefined`（表现是"教师顺序乱掉"，
     * 而不是报错）。我自己的自检夹具就是这么造出来的，当场撞上了。
     */
    db.teachers = db.teachers.map((teacher, index) => ({
      ...teacher,
      recommendation: teacher.recommendation ?? "",
      order: typeof teacher.order === "number" ? teacher.order : index + 1,
    }));
    db.version = 15;
  }

  if (db.version === 15) {
    /*
     * v15 → v16：教师增加「是否在宣传网站展示」。
     *
     * 老数据**一律默认不展示**（包括 `origin: "网站"` 的那些）。
     *
     * 为什么连"网站来源"也不默认展示：`origin` 记的是"这条档案当初从哪来"，
     * 它不等于"现在该不该出现在宣传页上" —— 我第一版就是按来源默认的，
     * 结果真实库里有两位早已不在网站内容里的教师（历史上从网站导入过、后来内容改了名字）
     * 被标成"展示"，网站会多出两个人来。**迁移猜不出来机构想让谁上台**，
     * 因此默认全部关掉（当时紧接着还能点一次「从网站导入内容」把内容里那几位标上 ——
     * 那个入口 v32 已删，现在再遇到这种老库只能手工勾）；机构要放谁上去，在教师表单里勾一下。
     */
    db.teachers = db.teachers.map((teacher) => ({
      ...teacher,
      siteVisible: teacher.siteVisible ?? false,
    }));
    db.version = 16;
  }

  if (db.version === 16) {
    /*
     * v16 → v17：给五个实体的记录补**记录级版本号** `version`（乐观锁用）。
     *
     * ## 为什么默认是 1，而不是"按已有日志推一个更高的数"
     *
     * 版本号的含义是「**升级之后**这条记录被写过几次」—— 这是一条**从这一刻开始**的
     * 计数器，不是对历史的重建。上限只有一个：**猜**。
     *
     * 猜高（比如拿操作日志条数当次数）会立刻产生真实故障：机构手上那些"升级前导出的
     * JSON"里没有版本号，恢复/导入之后与库里的数字对不上，于是**每次保存都报冲突**，
     * 而人只能一直刷新、永远保存不上 —— 一个假冲突比没有锁还糟，因为它把正常操作也挡了。
     * 补 1 则保证"升级后第一次保存一定成功"，冲突只在**真的**有人先把这条记录改过之后才出现。
     *
     * ## 为什么不做成"缺失就当作不校验"
     *
     * 那等于给老数据开了一个永久后门：任何一份没有版本号的记录（老导出文件、
     * 手改过的夹具）都可以被静默覆盖，而这正是这次要修的问题。
     * 因此这里是**补齐**而不是留空 —— 与 v13/v14 那几个字段的纪律一致：补默认值，不猜内容。
     *
     * 只补这五类实体：信息采集表（学生）、课程表单、教师表单、教室表单、排课表单
     * 都是"先读出来 → 人改 → 整份提交"，因此都需要这层保护；
     * 其余实体为什么没有，写在 `types.ts` 里 `Student.version` 那一段的说明上。
     */
    db.students = db.students.map((student) => ({ ...student, version: student.version ?? 1 }));
    db.teachers = db.teachers.map((teacher) => ({ ...teacher, version: teacher.version ?? 1 }));
    db.classrooms = db.classrooms.map((room) => ({ ...room, version: room.version ?? 1 }));
    db.lessons = db.lessons.map((lesson) => ({ ...lesson, version: lesson.version ?? 1 }));
    db.courses = db.courses.map((course) => ({ ...course, version: course.version ?? 1 }));
    db.version = 17;
  }

  if (db.version === 17) {
    /*
     * v17 → v18：**课程分区成为真实数据**。
     *
     * 老库里分区不是数据 —— 它是每门课的 `category` / `subgroup` 两个字符串**聚合**出来的。
     * 这一版把它们变成 `coursePartitions` 里的行，课程改用 `partitionId` 引用。
     *
     * ## 分区怎么建、顺序怎么定（这一版最容易做错的地方）
     *
     * 顺序必须**与升级前网站的显示顺序逐项一致**，否则机构升级完会发现课程页的栏目重新排过，
     * 而他们什么也没改。升级前网站的顺序规则是（见 `backendCourseColumns()` 的注释）：
     *
     *   - 卡片先按 `order` 升序；
     *   - **栏目顺序 = 该栏目下最小的 `order`**（即"第一个出现的卡片"决定栏目位置）；
     *   - 子栏目同理（栏目内第一个出现的卡片决定子栏目的位置）。
     *
     * 因此这里不做"按名字排序"这种自认为更整齐的事，而是**照抄**那套顺序：先按
     * `(order, 原数组里的位置)` 把课程排一遍，然后按出现顺序给栏目与子栏目编 `order`。
     * 有自检断言盯着"迁移前后网站栏目结构一致"（`scripts/check.mts` 的分区一节）。
     *
     * ## 名字为空的行
     *
     * `category` 为空（后台新增、还没分类的课）→ `partitionId` 留空串＝未归类，
     * **不建分区**：建一个没有名字的分区只会让清单里多出一块点不到的空白区域。
     * `subgroup` 为空但有 `category` → 直接挂在栏目上（网站上不渲染子标题），与升级前一致。
     *
     * ## 最后必须把 category / subgroup 两个字段**删掉**
     *
     * 留着它们就等于"同一个事实写两处"：改名时分区表改了、课程行上的旧名字还在，
     * 于是下次有人按老字段分组就会裂出两个分区。这里是**搬完就拆桥**：
     * 数据已经在新结构里了，老字段没有任何读者（`Course` 类型里也删了）。
     */
    const legacy = db.courses.map((course, index) => ({
      course,
      category: String((course as { category?: unknown }).category ?? "").trim(),
      subgroup: String((course as { subgroup?: unknown }).subgroup ?? "").trim(),
      index,
    }));
    // 与网站一致的顺序：order 升序，同 order 保持原数组顺序（稳定）
    const ordered = [...legacy].sort((a, b) => a.course.order - b.course.order || a.index - b.index);

    const partitions: CoursePartition[] = [];
    const columnIds = new Map<string, string>();
    const subgroupIds = new Map<string, string>();
    for (const row of ordered) {
      if (row.category === "") continue;
      if (!columnIds.has(row.category)) {
        const created: CoursePartition = {
          id: nextId("cp"),
          name: row.category,
          parentId: "",
          order: columnIds.size + 1,
        };
        partitions.push(created);
        columnIds.set(row.category, created.id);
      }
      if (row.subgroup === "") continue;
      const key = `${row.category}\u0000${row.subgroup}`;
      if (subgroupIds.has(key)) continue;
      const columnId = columnIds.get(row.category) ?? "";
      const created: CoursePartition = {
        id: nextId("cp"),
        name: row.subgroup,
        parentId: columnId,
        // 子栏目的 order 只在同一栏目内比较，因此按"这一栏目里第几个出现的子栏目"编号
        order: partitions.filter((item) => item.parentId === columnId).length + 1,
      };
      partitions.push(created);
      subgroupIds.set(key, created.id);
    }

    db.coursePartitions = partitions;
    db.courses = legacy.map((row) => {
      const columnId = columnIds.get(row.category) ?? "";
      const partitionId =
        row.subgroup === "" ? columnId : (subgroupIds.get(`${row.category}\u0000${row.subgroup}`) ?? columnId);
      /*
       * 逐字段重建而不是 `{...row.course}` 再删两个键：删键的写法（`delete obj.category`）
       * 一不小心就会留下一个值为 `undefined` 的键，而 `undefined` 会跟着 JSON.stringify
       * 一起消失得无影无踪 —— 排查时看不到它，只会看到"这个字段怎么没了"。
       * 这里显式列出保留的字段，多一个字段没写上会在类型上直接报错。
       */
      const { category: _dropCategory, subgroup: _dropSubgroup, ...rest } = row.course as Course & {
        category?: unknown;
        subgroup?: unknown;
      };
      void _dropCategory;
      void _dropSubgroup;
      /*
       * **id 也在这里补上**。
       *
       * v12 那一步是把内容文件里的卡片按**名字**灌进来的（`coursesFromSite()`），
       * 那时没有 id —— 而台账里改名 / 删除 / 挪分区、报课与排课引用课程，全都按 id 走。
       * 修这一行之前的事实是：**从 v11 升上来的库，课程一条都没有 id**
       * （自检当时只数了条数，所以一直没被发现；补上断言之后当场现形）。
       *
       * id 与 `materializeSiteCourses()` 用同一套（`course-site-<卡片路径>`），
       * 于是"升级上来的库"与"新装的库"里同一门课的 id 完全一样 —— 备份 /
       * 导出 JSON 在两套库之间搬来搬去时不会认成两门课。
       */
      const path = String((rest as { path?: unknown }).path ?? "").trim();
      const id =
        String((rest as { id?: unknown }).id ?? "").trim() ||
        (path === "" ? nextId("course") : `course-site-${path}`);
      return normalizeCourse({ ...rest, id, partitionId });
    });
    db.version = 18;
  }

  if (db.version === 18) {
    /*
     * v18 → v19：**学生案例进库**。
     *
     * ## 为什么这一次要读内容文件灌初值（与 v15 那次相反）
     *
     * v15 把网站正文搬进库时，迁移刻意**只补空结构、不读外部 Markdown** ——
     * 因为那时空着是安全的：课程正文可以点一次「从网站导入内容」补上
     * （该入口 v32 已删；这条对照记的是当时的取舍，不是现在还能这么做）。
     * 这次搬的是**已经发布出去的案例**：空着就等于升级完 `/cases` 与首页那块案例区
     * 全部变空。那不是"诚实的空"，是事故。做法与 `createInitialDatabase()` 里
     * "课程库与报价配置来自网站内容"同一条既有纪律：**内容文件是初值的来源**。
     *
     * 只写 `casesPage` 这一块：其余块（课程正文 / 教师页标题 / 报价文案）一个字都不动。
     */
    db.siteContent = { ...emptySiteContent(), ...(db.siteContent ?? {}) };
    db.siteContent.casesPage = siteContentFromContent().casesPage;
    db.version = 19;
  }

  if (db.version === 19) {
    /*
     * v19 → v20：**特色课程进库**。
     *
     * 与 v19 的案例同一个理由与同一个做法：这是一块**已经发布出去的对外文案**
     * （`/courses` 底部那块 + 14 个 `/courses/featured/**` 页面），空着等于升级完
     * 那一整块内容消失 —— 因此迁移**从内容文件灌初值**，而不是留空等导入。
     * 只写 `featuredPage` 这一块，其余块一个字都不动。
     */
    db.siteContent = { ...emptySiteContent(), ...(db.siteContent ?? {}) };
    db.siteContent.featuredPage = siteContentFromContent().featuredPage;
    db.version = 20;
  }

  if (db.version === 20) {
    /*
     * v20 → v21：**常见问题进库**。
     *
     * 与 v19 / v20 同一个理由与做法：这是一块已经发布出去的对外文案（`/faq` 那一页），
     * 空着等于升级完它整页没有问答 —— 因此迁移**从内容文件灌初值**，只写 `faqPage` 这一块。
     */
    db.siteContent = { ...emptySiteContent(), ...(db.siteContent ?? {}) };
    db.siteContent.faqPage = siteContentFromContent().faqPage;
    db.version = 21;
  }

  if (db.version === 21) {
    /*
     * v21 → v22：**页面文案块进库**（品牌与联系方式 / 首页 / 关于 / 联系我们 / 时间安排）。
     *
     * 与 v19–v21 同一个理由与做法：这些是已经发布出去的文案，
     * 空着等于升级完之后首页、关于、联系我们、时间安排整页没有文字（那比"空列表"严重得多）。
     * 迁移从内容文件灌初值，只写 `copy` 这一块。
     */
    db.siteContent = { ...emptySiteContent(), ...(db.siteContent ?? {}) };
    db.siteContent.copy = siteContentFromContent().copy;
    db.version = 22;
  }

  if (db.version === 22) {
    /*
     * v22 → v23：**课程类型改为维度模型**。
     *
     * 老库里没有这张表 —— 从种子灌一份进去（机构给的那份分类清单），而不是留空：
     * 空着的话后台「课程类型」页一打开就是一片空白，而机构要的是"能把清单上的东西一条条改"。
     *
     * 种子用**确定性 id**（`st_小学` / `subj_语文` / `mod_语文·一年级`…），
     * 因此重复灌不会造出重复行（见 `catalog-seed.ts` 的文件头）。
     */
    db.catalog = catalogFromSeed();
    db.version = 23;
  }

  if (db.version === 23) {
    /*
     * v23 → v24：**开放组合**（`offers`：学科 × 内容模块 × 班型 × 交付形态）。
     *
     * 与 v23 不同，这一张**空表起步**：哪些组合开放是机构的经营决定，
     * 拼一份"看起来很像"的初值只会让人以为那是自己设的（矩阵上一眼看不出来）。
     * 空表的表现在矩阵里就是"还没人设过"—— 那正是要机构去看一眼的状态。
     */
    db.offers = [];
    db.version = 24;
  }

  if (db.version === 24) {
    /*
     * v24 → v25：**报价的班级类型挂到课程类型的班型上**（`formatId`）。
     *
     * 这一步只做一件事：按名字把每一行对上 `catalog.formats` 里的班型 id。
     * 对不上的（机构在报价里手写过别的名字、或那个班型已经被删）**留空串**，
     * 由 `syncClassTypes` 报成"报价里有、维度表里没有"——不编 id、不删行、不改系数。
     */
    db.pricing = {
      ...db.pricing,
      classTypes: syncClassTypes(db.pricing.classTypes, db.catalog).classTypes,
    };
    db.version = 25;
  }

  if (db.version === 25) {
    /*
     * v25 → v26：**删掉"交付形态"这一维**（机构更正）。
     *
     * 那一维（面授 / 网课 / 网课+答疑 / 托管 / 全日托管）是我加的，机构的口径是：
     * 「网课」「网课+答疑」「网课+一对一针对性答疑」「小学托管」…都是**独立的项目**，
     * 与按学段的课程没有组合关系 —— 它们本来就在 `subjects` 里（`kind: "项目"`）。
     *
     * 这一步做两件事：维度表里去掉 `deliveries`；组合表的 `deliveryId` 去掉并**合并重复**
     * （原来"语文·一对一·网课"与"语文·一对一·面授"是两条，现在它们是同一条）。
     * 合并规则：**有一条开放就算开放**（"我们开这条组合"是更强的表态），
     * 备注取第一个非空的，时间取较晚的那个 —— 确定性、可重复执行。
     */
    const { deliveries: _dropped, ...restCatalog } = db.catalog as Catalog & {
      deliveries?: unknown;
    };
    void _dropped;
    db.catalog = restCatalog;

    const merged = new Map<string, CatalogOffer>();
    for (const offer of db.offers as Array<CatalogOffer & { deliveryId?: string }>) {
      const key: OfferKey = {
        subjectId: offer.subjectId,
        moduleId: offer.moduleId,
        formatId: offer.formatId,
      };
      const id = offerId(key);
      const previous = merged.get(id);
      if (previous === undefined) {
        merged.set(id, {
          id,
          ...key,
          open: offer.open,
          note: offer.note ?? "",
          updatedAt: offer.updatedAt ?? "",
        });
        continue;
      }
      merged.set(id, {
        ...previous,
        open: previous.open || offer.open,
        note: previous.note !== "" ? previous.note : (offer.note ?? ""),
        updatedAt: previous.updatedAt > (offer.updatedAt ?? "") ? previous.updatedAt : (offer.updatedAt ?? ""),
      });
    }
    db.offers = [...merged.values()];
    db.version = 26;
  }

  if (db.version === 26) {
    /*
     * v26 → v27：**寒暑假段**（机构每年手动录入的假期起止，按学段）。
     *
     * 空表起步（不猜日期）：机构口径是"起止日期每次手动输入"，预置一段反而会让人
     * 以为那是系统算出来的。它决定"哪几天按假期作息（= 周末那一组时段）"，
     * 判定在 `lib/backend/calendar-plan.ts`。
     */
    db.vacations = [];
    db.version = 27;
  }

  if (db.version === 27) {
    /*
     * v27 → v28：**把课程挂到课程类型上**（`stageIds` / `subjectIds` / `moduleIds`）。
     *
     * 机构口径：「课程可以完全按照…不靠枚举的方式为主安排」—— 台账里的课是"枚举"出来的
     * （小学语文 / 高考外语…），而课程类型是维度；两者以前没有任何联系。
     *
     * 这一步只做**能确定的那部分**（`suggestCourseDimensions`：显式对应表 → 学段前缀 + 学科名 →
     * 学科名本身），**对不上的留空**，由台账里「还没挂到维度上的课程」那一块列出来让人手选。
     * 猜错的后果是排课与诊断按错的维度筛课，而页面上看起来一切正常。
     */
    db.courses = db.courses.map((course) => {
      /*
       * **已经挂过维度的课程不动**：这一步是"给老库补上"，不是"按名字重算一遍"。
       *
       * 为什么会遇到"已经挂过"的：`extraCourses()` 那几门后台课在 v12 那一步就
       * 带着维度进库了，而按名字猜不出它们的学科（「小学奥数」里没有学科名）。
       * 无条件覆盖的后果是：升级上来的库把这十二门课的学科全抹掉，
       * 而台账上只表现为"这几门课又变成未挂维度了"。
       */
      // 老库的课程行**没有**这三个字段（这一步就是来补它们的），因此要先兜成空数组
      const linked =
        (course.stageIds?.length ?? 0) > 0 || (course.subjectIds?.length ?? 0) > 0;
      if (linked) return normalizeCourse(course);
      /*
       * 先查「只在后台用的那几门课」的清单，再退回按名字猜：那份清单里的名字
       * （小学奥数 / 中考冲刺 / 特殊计划专项…）按名字是猜不出学科的，而它们的维度
       * 本来就写死在 `extra-courses.ts` 里 —— 不然升级上来的库会把它们列进
       * "还没挂到维度上的课程"，明明有确定答案却要人手点一遍。
       */
      const suggestion =
        extraCourseDimensions(course.name) ?? suggestCourseDimensions(course.name, db.catalog);
      return normalizeCourse({
        ...course,
        stageIds: suggestion.stageIds,
        subjectIds: suggestion.subjectIds,
        moduleIds: suggestion.moduleIds,
      });
    });
    db.version = 28;
  }

  if (db.version === 28) {
    /*
     * v28 → v29：**删掉「科目系数」这一维**（机构口径：「科目系数可以删除」）。
     *
     * 报价从 v10 起是四档相乘的：基础价 × 科目系数 × 人数系数（原叫班级系数）× 时长乘数。
     * 现在科目那一维整个不存在了 —— 网站报价器不再让家长选科目、公式里也没有那个乘法，
     * 因此这份配置里不该再留着那份科目表。
     *
     * **这一步不改变任何已算出的价**，所以可以放心地只删字段、不做任何换算：
     *   1. 那份科目表里的系数**全都是 1**（内容文件里一个 `科目 ×系数` 的写法都没有），
     *      ×1 乘不乘结果一样；
     *   2. **试课费**本来就按课程基础价原价收（不带任何系数），与科目无关；
     *   3. 教师课时费的「标准单价」口径以前是"基础价 × 科目系数"，系数为 1 时它就是
     *      基础价本身 —— 删掉之后算出来的课时费一分没变。
     *
     * 用 `delete` 而不是把它置成 `undefined`：留一个 `subjects: undefined` 的键，
     * "这份配置里到底还有没有科目"就变成一个要看序列化实现才知道的问题
     * （`JSON.stringify` 会把它丢掉，而内存里那份对象还带着这个键）。
     */
    delete (db.pricing as PricingConfig & { subjects?: unknown }).subjects;
    db.version = 29;
  }

  /*
   * 收尾归一：分区表**必须是一个数组**。
   *
   * 为什么在迁移链最后统一兜一次，而不是只在 v17 → v18 里做：
   * 一份"自称 v18"的文件未必真有这张表 —— 手改过的导出、只跑了一半的恢复、
   * 以及早期版本导出的 JSON 都长这样，而缺了它会让课程库整页打不开
   * （读 `db.coursePartitions.filter` 直接 TypeError）。与 v15 分支里
   * "顺手把 v14 的教师字段再兜一遍"是同一条纪律：**声称的版本号不是证据**。
   *
   * 兜成空数组（而不是"照课程名重建一批"）：名字已经不在课程行上了，重建只能**猜**，
   * 猜出一批机构没建过的分区比看见「分区已失效」糟糕得多 —— 后者会显示在清单里，
   * 人可以自己去重选分区。
   */
  db.coursePartitions = Array.isArray(db.coursePartitions)
    ? db.coursePartitions.map((item) => normalizePartition(item))
    : [];

  /*
   * 收尾归一：网站内容的**块也要补齐**。
   *
   * 与分区表同一条理由：一份"自称 v19"却缺 `casesPage` 的文件（手改过的导出、
   * 半份恢复、更早版本导出的 JSON）会让网站那侧读到 `undefined` ——
   * 表现是案例区整块消失，而且不报错。缺块一律补**空结构**（不猜内容）。
   */
  db.siteContent = { ...emptySiteContent(), ...(db.siteContent ?? {}) };

  /*
   * 收尾归一：**维度表必须存在**（与分区表、网站内容同一条纪律）。
   * 一份"自称 v23"却缺 `catalog` 的文件（手改过的导出、半份恢复）会让后台
   * 「课程类型」页整页打不开 —— 读 `db.catalog.stages.filter` 直接 TypeError。
   * 缺了就从种子补一份（确定性 id，不会与人工改过的行混在一起）。
   */
  if (db.catalog === undefined || !Array.isArray(db.catalog.stages)) db.catalog = catalogFromSeed();

  /*
   * 收尾归一：维度表里**不该再有 `deliveries`**（v26 删掉的那一维）。
   * 一份"自称 v26"却还带着它的文件（手改过的导出、半份恢复、更早版本导出的 JSON）
   * 会让矩阵多出一整片不存在的列，而页面不会报错 —— 因此在这一层统一抹掉。
   */
  delete (db.catalog as Catalog & { deliveries?: unknown }).deliveries;

  /*
   * 收尾归一：课程上的**维度引用必须是数组**（与分区表、维度表同一条纪律）。
   * 一份"自称 v28"却缺这三个字段的文件（手改过的导出、半份恢复）会让台账按维度分组时
   * 读到 `undefined` —— 表现是"这门课哪一组都不属于"（它就此从清单里消失），不报错。
   */
  db.courses = db.courses.map((course) => normalizeCourse(course));

  /*
   * 收尾归一：**寒暑假段必须是一个数组**（与分区表、维度表、组合表同一条纪律）：
   * 一份"自称 v27"却缺它的文件会让「日历」页读 `db.vacations.filter` 直接 TypeError。
   */
  if (!Array.isArray(db.vacations)) db.vacations = [];

  /*
   * 收尾归一：**组合表必须是一个数组**（与分区表、维度表同一条纪律）。
   * 一份"自称 v24"却缺 `offers` 的文件（手改过的导出、半份恢复）会让后台
   * 「开放矩阵」页读 `db.offers.filter` 直接 TypeError。缺了兜成空数组 ——
   * 空数组的含义是明确的（"还没设过"），而"照维度表铺满"是会覆盖机构决策的猜法。
   */
  if (!Array.isArray(db.offers)) db.offers = [];

  /*
   * 收尾归一：报价里**不该再有 `subjects`**（v29 删掉的那一维）。
   *
   * 与「维度表里不该再有 deliveries」同一条纪律：一份"自称 v29"却还带着它的文件
   * （手改过的导出、半份恢复、更早版本导出的 JSON）不会读错任何数 —— 但那个字段会随
   * 每次 `persist` 一直活下去，而它已经不是任何东西的输入了。在这一层统一抹掉。
   */
  delete (db.pricing as PricingConfig & { subjects?: unknown }).subjects;

  /*
   * 收尾归一：报价里的**班型名称以维度表为准**（与上面几条同一条纪律）。
   *
   * 为什么放在收尾而不是只留在 v25 那一步：班型的名字是会变的（机构在「课程类型」页改名），
   * 而"自称 v25"的库未必真对齐过 —— 手改过的导出、只跑了一半的恢复、以及**导入**都长这样。
   * 这里对齐的是读时视图（`cache`），下一次写入时落盘；名字对不上的行原样保留（由
   * `syncClassTypes` 报出来），因此这一步不会悄悄改价、也不会丢行。
   */
  db.pricing = {
    ...db.pricing,
    classTypes: syncClassTypes(db.pricing.classTypes, db.catalog).classTypes,
  };

  return db.version === CURRENT_VERSION ? db : null;
}

/**
 * 维度表归一：去空白、补默认值、**丢掉不认识的字段**。
 *
 * 与 `normalizeCourse` / `normalizePartition` 同一条纪律：调用方（后台表单、脚本、
 * 自检夹具）未必带全字段，缺了就在这一处补 —— 而不是让下游读到 `undefined`。
 */
function normalizeCatalog(input: Catalog): Catalog {
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const order = (value: unknown, fallback: number): number =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item !== "") : [];

  return {
    stages: (input.stages ?? []).map((stage, index) => ({
      id: text(stage.id),
      name: text(stage.name),
      order: order(stage.order, index + 1),
      note: text(stage.note),
    })),
    subjects: (input.subjects ?? []).map((subject, index) => ({
      id: text(subject.id),
      name: text(subject.name),
      kind: subject.kind === "语言" || subject.kind === "项目" ? subject.kind : "学科",
      parentIds: ids(subject.parentIds),
      order: order(subject.order, index + 1),
      stageIds: ids(subject.stageIds),
      note: text(subject.note),
    })),
    modules: (input.modules ?? []).map((item, index) => ({
      id: text(item.id),
      parentId: text(item.parentId),
      subjectId: text(item.subjectId),
      name: text(item.name),
      kind: item.kind === "能力点" || item.kind === "语言等级" ? item.kind : "教材进度",
      order: order(item.order, index + 1),
      stageIds: ids(item.stageIds),
    })),
    formats: (input.formats ?? []).map((format, index) => ({
      id: text(format.id),
      name: text(format.name),
      minSize: Number.isFinite(Number(format.minSize)) ? Number(format.minSize) : 1,
      maxSize: Number.isFinite(Number(format.maxSize)) ? Number(format.maxSize) : 1,
      mode: format.mode === "分摊" ? "分摊" : "系数",
      order: order(format.order, index + 1),
    })),
    seededAt: text(input.seededAt),
  };
}

/**
 * 组合表归一：去空白、补默认值、**丢掉不认识的字段**，并按四个维度 id 重算 `id`。
 *
 * 与 `normalizeCatalog` 同一条纪律。多出来的一步（重算 id）是刻意的：
 * `offers` 的身份就是那四个 id，因此 id **不是可自由填写的字段** ——
 * 交上来什么 id 都以四个维度为准，省得出现"id 与内容对不上"这种只能靠人眼发现的行。
 */
function normalizeOffers(input: readonly CatalogOffer[]): CatalogOffer[] {
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const seen = new Set<string>();

  const rows: CatalogOffer[] = [];
  for (const item of input ?? []) {
    const key = {
      subjectId: text(item.subjectId),
      moduleId: text(item.moduleId),
      formatId: text(item.formatId),
    };
    const id = offerId(key);
    // 交上来两条一样的组合时以后一条为准（而不是留着两行让校验去报重复）
    if (seen.has(id)) rows.splice(rows.findIndex((row) => row.id === id), 1);
    seen.add(id);
    rows.push({
      id,
      ...key,
      open: item.open !== false,
      note: text(item.note),
      updatedAt: text(item.updatedAt),
    });
  }
  return rows;
}

/**
 * 报价配置的一份**读时视图**：班级类型的名称与 id 对齐到课程类型。
 *
 * 为什么不落库（只在读的时候对齐）：机构改一个班型名字，报价这一份存的名字就过期了；
 * 而"两处存同一个名字"必然漂。这里的原则是**名字只有一个真源**（`catalog.formats`），
 * 报价那一份存的是"这个班型多少钱"，落库时也对齐（`pricing.update`），
 * 读的时候再对齐一次兜住导入 / 手改过的库。
 */
function withCatalogClassTypes(db: Database): PricingConfig {
  const sync = syncClassTypes(db.pricing.classTypes, db.catalog);
  return { ...clone(db.pricing), classTypes: sync.classTypes };
}

/**
 * 寒暑假段归一：去空白、补默认值、**丢掉不认识的字段**。
 *
 * 与 `normalizeOffers` 同一条纪律。`kind` 认不出来的按「其他」处理（不丢这一行 ——
 * 日期才是它的主体，名字与类别是给人看的）。
 */
function normalizeVacations(input: readonly VacationPeriod[]): VacationPeriod[] {
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const kinds: Array<VacationPeriod["kind"]> = ["寒假", "暑假", "其他"];

  return (input ?? []).map((item) => ({
    id: text(item.id),
    name: text(item.name),
    kind: kinds.includes(item.kind) ? item.kind : "其他",
    stageIds: Array.isArray(item.stageIds)
      ? item.stageIds.map((id) => String(id)).filter((id) => id !== "")
      : [],
    startDate: text(item.startDate),
    endDate: text(item.endDate),
    note: text(item.note),
  }));
}

function persist(db: Database): void {
  db.updatedAt = nowIso();
  store.write(STORAGE_KEY, JSON.stringify(db));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 把学生的「报读科目」同步为在读报课的科目。
 *
 * subjects 是给人看的摘要（列表标签、搜索），因此不单独维护、只由报课推导，
 * 避免出现「退了课但科目列表还挂着」。
 */
function syncSubjects(student: Student): void {
  const subjects: string[] = [];
  for (const enrollment of student.enrollments) {
    if (enrollment.status !== "在读") continue;
    if (enrollment.subject.trim() !== "" && !subjects.includes(enrollment.subject)) {
      subjects.push(enrollment.subject);
    }
  }
  student.subjects = subjects;
}




/**
 * 操作日志的保留上限。
 *
 * 日志本身也占存储：无上限地涨下去，几年后一份 JSON 会大到导不出来。
 * 500 条足够回溯「最近发生了什么」，超出后丢最旧的。
 *
 * **导出**是为了让容量测量（`scripts/bench-capacity.mts`）引用这个真实值：
 * 那类脚本如果自己再写一个 500，"快照能长到多大"的结论就会随某天的改动失真 ——
 * 而这个项目一贯的做法是：口径只留一份，别靠"记得同步改两边"。
 */
export const LOG_LIMIT = 500;

/** 当前操作人（由后台外壳在登录后写入；纯前端只有 admin 一个账号）。 */
let operatorName = "admin";

/** 设置操作人。页面在登录后调用一次即可。 */
export function setOperator(name: string): void {
  operatorName = name.trim() === "" ? "admin" : name.trim();
}

/* ── 行级范围（Phase B）：普通教师只看自己的课与自己学生的课时余额 ────────────────
 *
 * ## 与 `setOperator` 是同一套机制（模块级状态 + 每请求重设）
 *
 * 规则本身**不在这个文件里**：谁是"普通教师"、哪些方法要过滤、哪些方法对教师关门，
 * 全在 `lib/auth/roles.ts`（`scopeForAccount` / `TEACHER_SCOPE_RULES`）。
 * 这里只做两件事：**接住**服务端按会话设置的范围，以及**按它过滤**返回值。
 *
 * ## 为什么必须是"每请求重设"，以及为什么服务端要在**调用前**再设一次
 *
 * 与操作人一样，它是模块级状态：某人设一次就管到下一次被覆盖。所以服务端
 * `requireAuth` 每个请求都按会话重设（`api.setScope(...)`），否则会出现
 * "教师 B 的请求拿到教师 A 的范围"这种串号。
 *
 * 更进一步：`/api/call` 在读完请求体（一次 `await`）之后、**真正调方法之前**又设了一次
 * （见 `server/index.mts`）。因为"设置范围"与"读请求体"之间隔着一次异步，
 * 并发时下一个请求可能已经把范围换掉了 —— 那会让 A 的请求用 B 的范围去过滤数据。
 * 在调用前用**同一个请求闭包里**算好的范围再设一次，中间没有任何 `await`，
 * 这段窗口就不存在了；而各方法在**方法体第一行**就把范围读进局部常量（`captureView()`），
 * 于是"过滤用的是哪个范围"从进方法那一刻起就定死了。
 *
 * （口径与边界写在 docs/后台API约定.md 的「行级范围」一节；
 *  `lib/auth/roles.ts` 的文件头写了三条判定规则与"默认关门"的理由。）
 */

/** 当前请求的行级范围。默认 `SCOPE_ALL`：脚本、自检、浏览器本地实现都不受限。 */
let scope: SessionScope = SCOPE_ALL;

/** 一次调用读到的范围快照（进方法第一行读，之后不会变）。 */
type ScopeView = { kind: "all" } | { kind: "own"; teacherId: string };

/**
 * 取本次调用的范围快照。
 *
 * 刻意**同步**读、且各方法在第一个 `await` 之前读：`scope` 是模块级状态，
 * 晚一步读就可能读到下一个请求设进去的值（见上面那段注释）。
 */
function captureView(): ScopeView {
  return scope.kind === "all" ? { kind: "all" } : { kind: "own", teacherId: scope.teacherId };
}

/**
 * 这个范围内的学生 id 集合；返回 `null` 表示**不限制**。
 *
 * 口径（`lib/auth/roles.ts` 文件头 ③）：**在我的课里出现过的学生**，排除已取消的课。
 * 没绑教师档案的账号（`teacherId === ""`）这里返回空集 —— 刻意**不**回退成
 * "teacherId 为空的课的学生"（那种课是"还没安排老师"的课，把它们的学生的档案
 * 交给一个没绑档案的教师账号，正好是最不该发生的那种多给）。
 */
function visibleStudentIds(view: ScopeView, db: Database): Set<string> | null {
  if (view.kind === "all") return null;
  const ids = new Set<string>();
  if (view.teacherId === "") return ids;
  for (const lesson of db.lessons) {
    if (lesson.teacherId !== view.teacherId) continue;
    if (lesson.status === "已取消") continue;
    for (const studentId of lesson.studentIds) ids.add(studentId);
  }
  return ids;
}

/**
 * 剥掉学生档案里的**金额字段**（单价 / 约定应缴 / 实收）。
 *
 * ## 为什么剥字段，而不是拒绝整个接口
 *
 * 机构确认的边界③是"普通教师能看到自己学生的**课时余额**"—— 家长最常问的
 * "还剩几节课"就在同一个对象上（`Student.enrollments`）。拒绝接口等于连课时也看不到，
 * 那就把机构要的功能一起关掉了；而只剥金额，教师拿到的正是"课时 + 学生信息"，
 * 一点钱都没有。
 *
 * ## 为什么置 0 而不是删键
 *
 * 前端与类型的口径是"这三个字段是数字"（`Enrollment`，见 types.ts）。
 * 删掉键会让界面算出 `undefined` / `¥NaN` —— 那比空白更糟（会显示给家长看）。
 * 置 0 与"这门课没有登记价格"是同一个既有语义（`unitPrice = 0` 的注释就是这么写的），
 * 界面上那几块金额自己会按 `agreedAmount > 0` 隐藏，欠费也算成 0。
 *
 * ⚠️ 返回的是**深拷贝**：`load()` 拿到的是内存里那份库，直接改字段会把数据改坏。
 */
function hideStudentMoney(student: Student): Student {
  const copy = clone(student);
  for (const enrollment of copy.enrollments) {
    enrollment.unitPrice = 0;
    enrollment.agreedAmount = 0;
    enrollment.paidAmount = 0;
  }
  return copy;
}

/** 按范围过滤学生（并剥金额）。`view` 是 `all` 时原样返回（不剥）。 */
function scopeStudents(view: ScopeView, db: Database, students: Student[]): Student[] {
  const ids = visibleStudentIds(view, db);
  if (ids === null) return students;
  return students.filter((student) => ids.has(student.id)).map(hideStudentMoney);
}

/**
 * 单个学生：范围外一律 `null`（**看不到**，不报 403 —— 口径见 roles.ts）。
 *
 * 与 `scopeStudents` 分开写是因为"单条"的语义不同：`students.get(别人的学生)`
 * 必须与"这个学生不存在"长得一模一样，否则"返回了 403 / 返回了空对象"本身
 * 就是在告诉人"这个 id 是存在的"。
 */
function scopeStudent(view: ScopeView, db: Database, student: Student): Student | null {
  const ids = visibleStudentIds(view, db);
  if (ids === null) return student;
  return ids.has(student.id) ? hideStudentMoney(student) : null;
}

/** 按范围过滤课（只留 `teacherId === 我` 的）。`view` 是 `all` 时原样返回。 */
function scopeLessons(view: ScopeView, lessons: Lesson[]): Lesson[] {
  if (view.kind === "all") return lessons;
  if (view.teacherId === "") return [];
  return lessons.filter((lesson) => lesson.teacherId === view.teacherId);
}

/** 这一行（学生）在这个范围里看不看得到。 */
function canSeeStudent(view: ScopeView, db: Database, studentId: string): boolean {
  const ids = visibleStudentIds(view, db);
  return ids === null || ids.has(studentId);
}

/** 这一行（课）在这个范围里看不看得到。 */
function canSeeLesson(view: ScopeView, lesson: Lesson | undefined): boolean {
  if (lesson === undefined) return false;
  if (view.kind === "all") return true;
  return view.teacherId !== "" && lesson.teacherId === view.teacherId;
}

/** 这一节课（按 id）看不看得到（课堂记录挂在课节上，需要按 id 判）。 */
function canSeeLessonId(view: ScopeView, db: Database, lessonId: string): boolean {
  if (view.kind === "all") return true;
  return canSeeLesson(view, db.lessons.find((item) => item.id === lessonId));
}

/** 按范围过滤"挂在课节上"的记录（课堂记录）。 */
function scopeLessonRecords(
  view: ScopeView,
  db: Database,
  records: LessonRecord[],
): LessonRecord[] {
  if (view.kind === "all") return records;
  return records.filter((record) => canSeeLessonId(view, db, record.lessonId));
}


/**
 * 写动作碰到范围外的数据时抛的话。
 *
 * 读接口的表现是"看不到"（空集 / `null`），写动作不能那样：**假装写成功比报错更坏** ——
 * 老师会以为"这节课我标了已上"，而课时扣在别人那边、或者压根没扣。
 * 所以写动作越界 = 拒绝并说清原因（接口层按 400 回，文案就是这句）。
 */
function outOfScopeError(what: string): Error {
  return new Error(
    `${what}不在你的名下：你的账号只能看 / 只能改自己带的学生与排课。` +
    "如果你确实需要处理它，请找技术管理员或在你的课上安排。",
  );
}

/**
 * 记一条操作日志。
 *
 * 由各业务方法自己调用（而不是给页面提供一个「记得写日志」的接口）——
 * 依赖调用方自觉的日志一定会漏。写在服务层，无论从哪个页面改数据都会留痕。
 */
function writeLog(
  db: Database,
  input: { entity: string; action: string; targetId: string; summary: string },
): void {
  db.logs.push({
    id: nextId("log"),
    at: nowIso(),
    operator: operatorName,
    entity: input.entity,
    action: input.action,
    targetId: input.targetId,
    summary: input.summary,
  });

  if (db.logs.length > LOG_LIMIT) {
    db.logs.splice(0, db.logs.length - LOG_LIMIT);
  }
}

/**
 * 学生这条记录被写过（报课 / 续费 / 退课 / 调整课时 / 收款…）：把版本推进一格。
 *
 * ## 为什么业务动作也要推版本，而不是只推"表单类的写"
 *
 * `version` 是**整条记录**的"代"（generation），不是字段级的。业务动作改的是这条记录
 * 的一部分（课时、金额），而所有写入口都是"整份覆盖 / 整份 patch"—— 服务端**判断不出**
 * 这次提交会不会盖掉对方改的那一部分，因此只能按"整条记录已经变了"来对待。
 *
 * 换个做法（给每个字段再挂一个版本号）能少报几次冲突，代价是：字段清单要手工维护、
 * 加一个字段就要记得加一次，漏了就是静默失效 —— 那种"看着有锁、其实漏了一类写入"
 * 的状态比偶发一次冲突危险得多。
 *
 * 一次用户动作只推一格（而不是每个字段各推一格）：版本号要能回答"这条记录被**用过**几次"，
 * 一次报课在数据里写了四五处，但人只做了一件事。
 */
function touchStudent(db: Database, studentId: string): void {
  const student = db.students.find((item) => item.id === studentId);
  if (student !== undefined) bumpVersion(student);
}

/** 导入日志的一句话摘要。 */
/**
 * 一句话说清这次改价改了什么。
 *
 * 日志要能回答「这个月价格是谁改的、改成多少了」——只写「修改了报价配置」
 * 等于没写：真出问题时得靠它回溯，所以这里把变动列出来。
 */
function describePricingChange(before: PricingConfig, after: PricingConfig): string {
  const parts: string[] = [];
  const priceLabel = (config: PricingConfig): string => {
    const total = config.stages.reduce((sum, stage) => sum + stage.courses.length, 0);
    return `课程 ${total} 门`;
  };
  for (const stage of after.stages) {
    const old = before.stages.find((item) => item.name === stage.name);
    for (const course of stage.courses) {
      const previous = old?.courses.find((item) => item.name === course.name);
      if (previous === undefined) {
        parts.push(`新增课程「${course.name}」`);
      } else if (previous.basePrice !== course.basePrice) {
        parts.push(
          `「${course.name}」${previous.basePrice ?? "未开放"} → ${course.basePrice ?? "未开放"}`,
        );
      }
    }
  }
  /*
   * 人数系数按**班型**比（`classType.coefficient` 就是人数系数）。
   * 这里曾经还有一段"科目系数 1.2 → 1.1"的日志 —— 科目那一维 v29 删掉了。
   */
  for (const classType of after.classTypes) {
    const previous = before.classTypes.find((item) => item.name === classType.name);
    if (previous !== undefined && previous.coefficient !== classType.coefficient) {
      parts.push(`「${classType.name}」人数系数 ${previous.coefficient ?? "—"} → ${classType.coefficient ?? "—"}`);
    }
  }
  if (before.rules.singleLessonFeePercent !== after.rules.singleLessonFeePercent) {
    parts.push(`手续费 ${before.rules.singleLessonFeePercent}% → ${after.rules.singleLessonFeePercent}%`);
  }
  if (before.rules.freeTrialMinLessons !== after.rules.freeTrialMinLessons) {
    parts.push(`试课免费门槛 ${before.rules.freeTrialMinLessons} 节 → ${after.rules.freeTrialMinLessons} 节`);
  }
  if (before.teacherShare.basePercent !== after.teacherShare.basePercent) {
    parts.push(`教师分成 ${before.teacherShare.basePercent}% → ${after.teacherShare.basePercent}%`);
  }
  if (before.teacherShare.stepPercent !== after.teacherShare.stepPercent) {
    parts.push(
      `每加一名学生 ${before.teacherShare.stepPercent} → ${after.teacherShare.stepPercent} 个百分点`,
    );
  }
  if (before.teacherShare.priceBasis !== after.teacherShare.priceBasis) {
    parts.push(
      `课程单价口径 ${before.teacherShare.priceBasis === "seat" ? "班型课时价" : "课程标准单价"} → ${after.teacherShare.priceBasis === "seat" ? "班型课时价" : "课程标准单价"}`,
    );
  }
  const changes = parts.length > 0 ? parts.join("；") : `未改动价格（${priceLabel(after)}）`;
  return `修改报价配置：${changes}`;
}

/**
 * 课程库改了之后，让报价配置跟着走（改名跟随、停开跟随、删除后置为暂未开放）。
 *
 * 放在服务层而不是页面里：改名发生在编辑课程的那一刻，页面可能根本没打开报价页 ——
 * 依赖页面自觉调用一定会漏，然后两边就悄悄分叉了（家长看到旧课名、或者报了已停开的课）。
 */
function syncPricingWithCourses(db: Database): string[] {
  const { config, changes, linkOnly } = syncLibraryLinks(db.pricing, db.courses);
  if (changes.length === 0) return [];

  /*
   * **只补关联时不动来源**：`source` 说的是"这份价是谁定的"（站点内容 / 后台修改）。
   * 认领一条 `courseId` 不是机构改过价 —— 一起标成"后台修改"之后，报价页上
   * "这份配置来自站点内容"就成了假话，而机构会据此以为有人动过价格。
   * 关联这件事仍然写日志（下面那一句），只是不改来源与修改时间。
   */
  db.pricing = linkOnly
    ? config
    : { ...config, source: PRICING_SOURCE_ADMIN, updatedAt: nowIso() };
  writeLog(db, {
    entity: "报价",
    action: "跟随课程库",
    targetId: "pricing",
    summary: changes.join("；"),
  });
  return changes;
}

function fileSummary(fromVersion: number, db: Database): string {
  return `v${fromVersion} → v${db.version}，${db.students.length} 名学生、${db.lessons.length} 节课`;
}

/** 从对象里挑一个能说清身份的字段，用于日志摘要。 */
function describeTarget(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["name", "subject", "title", "date"]) {
    const field = record[key];
    if (typeof field === "string" && field.trim() !== "") return `「${field.trim()}」`;
  }
  return "";
}

/**
 * **删除护栏**：返回一句拒绝理由，或 `null` 表示可以删。
 *
 * ## 为什么删除必须有这道闸
 *
 * 删除是**真删**（`splice`），而档案类记录被别的东西引用着：学生的收款、课时流水、
 * 测评、作业、排课名单；教师/教室的排课；排课的考勤记录与课时流水。
 * 删掉档案之后那些引用就变成**孤儿**：收款还在、本月收入还计着，但人已经没了；
 * 排课还在，但教师/教室那两栏是空的；考勤记录指向一节不存在的课。
 *
 * 这个坑踩过一次（`server/index.mts` 里那段注释自陈："之前就是因为删档案不连带清账，
 * 留下了 18 条没有主人的收费记录"），但当时的护栏写在**老 REST 接口**上，
 * 而界面走的是 `/api/call` —— 那道护栏对产品而言是装饰。
 * 因此现在把它放到**唯一的入口**（`collection.remove`）：两条路都会经过这里。
 *
 * ## 为什么是"拒绝"而不是"连带清理"
 *
 * 连带清理等于"删一个人顺手删掉他的收款记录"——那是在毁账。机构要的语义是
 * **有账就不许删**（机构确认）：想删就先走正常流程（退课结清、取消排课），
 * 或者把档案改成「暂停 / 结课」（那是软处理，数据都还在）。
 */
export type DeleteGuard<T> = (db: Database, item: T) => string | null;

/** 通用集合：把「取数组 → 改 → 存」的重复代码在一处。 */
function collection<T extends { id: string }>(
  pick: (db: Database) => T[],
  prefix: string,
  /** 日志里显示的对象类别（如「学生」）。传空串表示不记日志。 */
  label = "",
  /** 删除护栏（见 `DeleteGuard`）：返回理由就拒绝删除。 */
  guardDelete: DeleteGuard<T> | null = null,
) {
  return {
    async list(): Promise<T[]> {
      await delay();
      return clone(pick(load()));
    },
    async get(id: string): Promise<T | null> {
      await delay();
      return clone(pick(load()).find((item) => item.id === id) ?? null);
    },
    async create(input: Omit<T, "id">): Promise<T> {
      await delay();
      const db = load();
      const created = { ...input, id: nextId(prefix) } as T;
      pick(db).push(created);
      if (label !== "") {
        writeLog(db, {
          entity: label,
          action: "新建",
          targetId: created.id,
          summary: `新建${label}${describeTarget(created)}`,
        });
      }
      persist(db);
      return clone(created);
    },
    async update(id: string, patch: Partial<Omit<T, "id">>): Promise<T | null> {
      await delay();
      const db = load();
      const list = pick(db);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const updated = { ...list[index], ...patch } as T;
      list[index] = updated;
      if (label !== "") {
        writeLog(db, {
          entity: label,
          action: "修改",
          targetId: id,
          // 记下改了哪些字段：只说「修改了学生」等于没说
          summary: `修改${label}${describeTarget(updated)}（${Object.keys(patch).join("、")}）`,
        });
      }
      persist(db);
      return clone(updated);
    },
    async remove(id: string): Promise<boolean> {
      await delay();
      const db = load();
      const list = pick(db);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return false;
      /*
       * 护栏在**删之前**判：拒绝时抛错（不是静默返回 false）——
       * 界面上必须看到"为什么删不掉"，否则人会以为是自己没点到。
       */
      const item = list[index];
      const refusal = guardDelete === null || item === undefined ? null : guardDelete(db, item);
      if (refusal !== null) throw new Error(refusal);
      const [removed] = list.splice(index, 1);
      if (label !== "") {
        writeLog(db, {
          entity: label,
          action: "删除",
          targetId: id,
          summary: `删除${label}${describeTarget(removed as T)}`,
        });
      }
      persist(db);
      return true;
    },
  };
}

/**
 * **带乐观锁的通用集合**：与 `collection` 同一套取数组 → 改 → 存的写法，
 * 但记录带 `version`，并且 `update` 多接一个可选的 `expectedVersion`。
 *
 * ## 为什么另起一个工厂，而不是给 `collection` 加一个开关
 *
 * `create` / `update` 的**签名**是不一样的：带版本的实体里 `version` 与 `id` 同级
 * 由服务端管（新建入参必须排除它，否则"这条记录从第 7 版开始"这种数据迟早会出现）。
 * 用一个 `versioned?: boolean` 开关的话，返回类型会随这个布尔值变化 ——
 * 要么写成重载、要么写成一堆条件类型，读的人得先解一遍类型才敢改。
 * 两个工厂各自 30 行、一眼看得懂，比一个"聪明"的工厂便宜。
 *
 * `list` / `get` / `remove` 直接**复用** `collection` 的实现（`...base` 的三个方法）：
 * 这三件事与版本号无关，再写一遍就是两处要同步维护的口径。
 */
function versionedCollection<T extends { id: string; version: number }>(
  pick: (db: Database) => T[],
  prefix: string,
  label = "",
  guardDelete: DeleteGuard<T> | null = null,
) {
  const base = collection<T>(pick, prefix, label, guardDelete);
  return {
    list: base.list,
    get: base.get,
    remove: base.remove,

    async create(input: Omit<T, "id" | "version">): Promise<T> {
      await delay();
      const db = load();
      // 新记录一律从第 1 版开始（与迁移给老数据补的口径一致：见 migrate 的 v16 → v17）
      const created = { ...input, id: nextId(prefix), version: 1 } as T;
      pick(db).push(created);
      if (label !== "") {
        writeLog(db, {
          entity: label,
          action: "新建",
          targetId: created.id,
          summary: `新建${label}${describeTarget(created)}`,
        });
      }
      persist(db);
      return clone(created);
    },

    /**
     * 改一条记录（字段级 patch），可选带上"我读到的是哪一版"。
     *
     * 先比版本、再记日志、最后 +1：
     *   - 版本不一致 → 抛 `VersionConflictError`，**什么都不写**（连日志都不写：
     *     "有人试图覆盖别人的修改"不是数据改动，不该混进操作日志）；
     *   - 一致或没传 → 正常写入，并把版本推进一格。
     */
    async update(
      id: string,
      patch: Partial<Omit<T, "id" | "version">>,
      options: WriteOptions = {},
    ): Promise<T | null> {
      await delay();
      const db = load();
      const list = pick(db);
      const index = list.findIndex((item) => item.id === id);
      if (index === -1) return null;

      const current = list[index]!;
      assertVersion(current, options.expectedVersion, `${label}${describeTarget(current)}`);

      /*
       * `version: current.version` 是**故意显式盖回去**的：
       * 类型上 patch 已经排除了 `version`，但**运行时没有类型**（`/api/call` 的 args
       * 原样传给服务层；自己人调用时也可能把一整个对象当 patch 传进来 ——
       * TS 对"多余的属性"只在字面量上检查，`api.courses.update(id, wholeCourse)` 是能编过的）。
       * 不盖回去就等于"调用方可以自己定版本号"，乐观锁当场变成摆设。
       */
      const updated = { ...current, ...patch, version: current.version } as T;
      bumpVersion(updated);
      list[index] = updated;
      if (label !== "") {
        writeLog(db, {
          entity: label,
          action: "修改",
          targetId: id,
          // 记下改了哪些字段：只说「修改了学生」等于没说
          summary: `修改${label}${describeTarget(updated)}（${Object.keys(patch).join("、")}）`,
        });
      }
      persist(db);
      return clone(updated);
    },
  };
}

/** 日期键：YYYY-MM-DD（本地时区），用于按天分组。 */
/*
 * `dateKey` 从 `./format` 转发 —— 那里是它唯一的实现。
 *
 * 这里原先**逐字**又写了一份（`format.ts` 的注释甚至写着"与 api.ts 的 dateKey 口径一致"），
 * 而"两处保持一致"是句空话：真正的保证是**只有一处**。审计之后改成转发，
 * 因此 `api.ts` 与页面拿到的是同一个函数（对外形状没变，调用点一行都不用改）。
 */
export { dateKey } from "./format";
import { dateKey } from "./format";

/*
 * 学生与排课走**带乐观锁**的集合（v17 起）：信息采集表是整份覆盖 `profile`，
 * 排课表单是整份覆盖"这节课排给谁/什么时候"，两类都是最不能被静默盖掉的东西。
 * 咨询线索仍是普通集合：它是"还没落定的口头咨询"，改它不会毁掉别人的一份档案。
 */
// ── 删除护栏的具体口径 ────────────────────────────────────────────────────────
/*
 * 四类档案的护栏判据（都返回"拒绝理由"，`null` 表示可以删）：
 *
 *   学生：有收款 / 课时流水 / 考勤 / 测评 / 作业，或出现在任何一节课的名单里 → 拒绝。
 *         前五样是**历史**（删了就成无主账），排课是**将来**（先取消或删掉那些课）。
 *   教师：任何一节课挂在他名下 → 拒绝（建议改成「停用」，那是不丢历史的做法）。
 *   教室：任何一节课用它 → 拒绝（同上）。
 *   课程：任何一节课或任何一条报课用这个科目名 → 拒绝（建议改成「暂未开放」）。
 *   排课：已经扣过课时（有未撤销的「上课」流水）或已有考勤记录 → 拒绝
 *         （先撤销「已上」，否则课时被静默吃掉、流水指向一节不存在的课）。
 *
 * 每一条都把"该怎么办"写进理由里 —— 只说"不能删"是最让人恼火的拒绝方式。
 */
const studentDeleteRefusal: DeleteGuard<Student> = (db, student) => {
  const payments = db.payments.filter((item) => item.studentId === student.id);
  const money = round2(payments.reduce((sum, item) => sum + (item.kind === "退款" ? -item.amount : item.amount), 0));
  const transactions = db.transactions.filter((item) => item.studentId === student.id);
  const records = db.lessonRecords.filter((item) => item.studentId === student.id);
  const homework = db.homeworkRecords.filter((item) => item.studentId === student.id);
  const assessments = db.assessments.filter((item) => item.studentId === student.id);
  const lessons = db.lessons.filter((item) => item.studentIds.includes(student.id));

  const parts: string[] = [];
  if (payments.length > 0) parts.push(`${payments.length} 条收款记录（合计 ¥${money}）`);
  if (transactions.length > 0) parts.push(`${transactions.length} 条课时流水`);
  if (records.length > 0) parts.push(`${records.length} 条课堂记录`);
  if (assessments.length > 0) parts.push(`${assessments.length} 条阶段测评`);
  if (homework.length > 0) parts.push(`${homework.length} 条作业记录`);
  if (lessons.length > 0) parts.push(`${lessons.length} 节排课`);
  if (parts.length === 0) return null;

  return (
    `「${student.name}」名下还有 ${parts.join("、")}，不能直接删除 —— ` +
    "删掉之后这些记录会失去主人（钱还在账上、课还在课表上，但找不到人）。" +
    "请先结清并退课、取消或删掉 TA 的排课；如果只是不再来上课，" +
    "把状态改成「结课」或「暂停」更合适（数据都留着，随时能查）。"
  );
};

const teacherDeleteRefusal: DeleteGuard<Teacher> = (db, teacher) => {
  const lessons = db.lessons.filter((item) => item.teacherId === teacher.id);
  if (lessons.length === 0) return null;
  return (
    `「${teacher.name}」名下还有 ${lessons.length} 节排课，不能直接删除 —— ` +
    "删掉之后那些课查不到老师，课时费也没法核算。" +
    "离职请改成「停用」（在教师页那一行的开关上），历史记录与课时统计都留着。"
  );
};

const classroomDeleteRefusal: DeleteGuard<Classroom> = (db, classroom) => {
  const lessons = db.lessons.filter((item) => item.classroomId === classroom.id);
  if (lessons.length === 0) return null;
  return (
    `「${classroom.name}」还有 ${lessons.length} 节排课，不能直接删除 —— ` +
    "删掉之后那些课查不到教室，教室利用率也没法算。请先取消或改掉这些课，或者改成「停用」。"
  );
};

const courseDeleteRefusal: DeleteGuard<Course> = (db, course) => {
  const lessons = db.lessons.filter((item) => item.subject.trim() === course.name.trim());
  const enrollments = db.students.flatMap((student) => student.enrollments).filter((item) => item.subject.trim() === course.name.trim());
  if (lessons.length === 0 && enrollments.length === 0) return null;
  return (
    `「${course.name}」还被 ${enrollments.length} 条报课、${lessons.length} 节排课引用着，不能直接删除 —— ` +
    "删掉之后那些记录里的科目名就成了无主字符串。不再开的课请把状态改成「暂未开放」。"
  );
};

const lessonDeleteRefusal: DeleteGuard<Lesson> = (db, lesson) => {
  const charged = db.transactions.filter((item) => item.lessonId === lesson.id && item.reversedAt === "");
  const records = db.lessonRecords.filter((item) => item.lessonId === lesson.id);
  if (charged.length === 0 && records.length === 0) return null;
  const parts: string[] = [];
  if (charged.length > 0) parts.push(`${charged.length} 条未撤销的课时流水（已经扣过课时）`);
  if (records.length > 0) parts.push(`${records.length} 条课堂记录`);
  return (
    `这节课还有 ${parts.join("、")}，不能直接删除 —— ` +
    "删掉之后课时白扣了、考勤记录指向一节不存在的课。请先撤销「已上」（退回课时）并处理考勤记录。"
  );
};

const studentCollection = versionedCollection<Student>((db) => db.students, "s", "学生", studentDeleteRefusal);
const inquiryCollection = collection<Inquiry>((db) => db.inquiries, "iq", "咨询");

/** 按周批量排课的入参（见 lib/backend/recurrence.ts 与 lessons.planSeries）。 */
export type SeriesInput = {
  subject: string;
  form: string;
  teacherId: string;
  classroomId: string;
  studentIds: string[];
  durationMinutes: number;
  status: Lesson["status"];
  note: string;
  /** 起排日期（本地日期 `YYYY-MM-DD`）。 */
  startDate: string;
  /** 每周几（1 = 周一 … 7 = 周日）。 */
  weekdays: number[];
  /** 开始时间 `HH:mm`。 */
  time: string;
  /** 排多少节。 */
  count: number;
};

/** 计划里的一节：生成的日期时间 + 该节的冲突情况。 */
export type SeriesPlanItem = {
  startsAt: string;
  /** 「9月23日 周二 17:00」这样的人话。 */
  dayLabel: string;
  /** 无冲突才能排。 */
  ok: boolean;
  /** 冲突摘要（无冲突时为空串）。 */
  reason: string;
};

export type SeriesPlan = {
  items: SeriesPlanItem[];
  /** 能排的节数 / 被冲突挡掉的节数。 */
  schedulable: number;
  blocked: number;
  /** 该科目剩余课时（多人班课取剩余最少的那位）。 */
  remainingLessons: number;
  /** 已经排了但还没上的节数（同科目、且包含选中的学生）。 */
  alreadyScheduled: number;
  /** 建议节数 = 剩余课时 − 已排未上（不小于 0）。 */
  suggestedCount: number;
  /** 你填的节数（未封顶前）。 */
  requestedCount: number;
  /** 因**课时不足**被砍掉的节数（> 0 时界面必须说明，不能让"少排了"悄无声息）。 */
  cappedBy: number;
  /** 课时不足的说明（够用时为空串）。 */
  shortageMessage: string;
};


export type SeriesOutcome = {
  created: number;
  skipped: Array<{ startsAt: string; dayLabel: string; reason: string }>;
  /** 第一/最后一节的时间（给界面回显"排到了哪天"）。 */
  first: string;
  last: string;
  plan: SeriesPlan;
};

/**
 * **冲突判定核心**（同步、纯）。
 *
 * `lessons.findConflicts`（页面保存前提示）与**按周批量排课**（一次算一整串日期）
 * 都调它 —— 两处必须用**同一套**判定：各写一遍的话，预览说能排、写入时判成冲突
 * （或反过来）只是时间问题。判定规则与原来完全一致：
 * 相邻不算冲突、已取消不占时间、编辑自己不算冲突、没设时段的教室视为不限、
 * 教师没登记科目时不报科目不符。
 */
function conflictsFor(db: Database, input: LessonInput): ConflictReport {
  const start = new Date(input.startsAt).getTime();
  const end = start + input.durationMinutes * 60_000;
  const overlaps = (lesson: Lesson) => {
    if (lesson.id === input.id || lesson.status === "已取消") return false;
    const otherStart = new Date(lesson.startsAt).getTime();
    const otherEnd = otherStart + lesson.durationMinutes * 60_000;
    return start < otherEnd && otherStart < end;
  };

  const clashing = db.lessons.filter(overlaps);
  const teacher = clashing.filter((lesson) => lesson.teacherId === input.teacherId);
  const classroom = clashing.filter((lesson) => lesson.classroomId === input.classroomId);
  const students = clashing.flatMap((lesson) =>
    lesson.studentIds
      .filter((id) => input.studentIds.includes(id))
      .map((studentId) => ({ studentId, lesson })),
  );
  const uniqueStudents = [
    ...new Map(students.map((item) => [`${item.studentId}-${item.lesson.id}`, item])).values(),
  ];

  const room = db.classrooms.find((item) => item.id === input.classroomId);
  const classroomClosed =
    room !== undefined &&
    !isWithinAvailability(room.availability, new Date(input.startsAt), input.durationMinutes);

  const overCapacity =
    room !== undefined && room.capacity > 0 && input.studentIds.length > room.capacity
      ? { capacity: room.capacity, students: input.studentIds.length }
      : null;

  const assigned = db.teachers.find((item) => item.id === input.teacherId);
  const teacherSubjectMismatch =
    assigned !== undefined &&
    assigned.subjects.length > 0 &&
    !assigned.subjects.some((subject) => input.subject.includes(subject));

  return {
    teacher,
    classroom,
    students: uniqueStudents,
    classroomClosed,
    overCapacity,
    teacherSubjectMismatch,
    total:
      teacher.length +
      classroom.length +
      uniqueStudents.length +
      (classroomClosed ? 1 : 0) +
      (overCapacity !== null ? 1 : 0) +
      (teacherSubjectMismatch ? 1 : 0),
  };
}

/**
 * **课时不足的判定**（业务规则：**课时不够就不排课**）。
 *
 * 机构的口径是"宁可少排，也不要欠账" —— 欠着的课时事后很难收回来。
 * 因此排课（单节 / 批量 / 补课）之前一律先算一遍：这几位学生在这门科目上
 * **还剩几节可用**（剩余课时 − 已排未上），够不上要排的节数就不排。
 *
 * 返回 `null` 表示够；否则给出**差额与是谁不够**（界面与错误信息直接用这句话，
 * 而不是笼统说"课时不足"——要让人一眼知道该找谁续费）。
 *
 * 用**同一套科目匹配**（`enrollmentForLesson` 的口径：科目名相同），
 * 因此"报的是初中数学、排的是初中数学"才会算在一起，不会张冠李戴。
 */
function insufficientLessons(
  db: Database,
  input: {
    subject: string;
    studentIds: string[];
    count: number;
    /**
     * 复核**已有课节的修改**时把自己排除掉。
     *
     * 不排除的话会出现这种事：一节已经排好的课，只想改个备注/时间，
     * 复核时却把它自己也算成"已排 1 节"，于是「还能排 0 节 < 要排 1 节」被拒 ——
     * 明明什么都没多排，却被自己的影子挡住。
     */
    excludeLessonId?: string;
  },
): {
  message: string;
  /** 这门科目上"最多还能排几节"（取剩余最少的那位：班课按同一份课表走）。 */
  affordable: number;
  short: Array<{ studentId: string; name: string; remaining: number }>;
} | null {
  const { subject, studentIds, count, excludeLessonId } = input;

  /*
   * **没有学生就没有课时可欠**：直接放行。
   *
   * 这一条是补上的：原先 `studentIds` 为空时，逐人算剩余得到空集合，
   * 「还能排 0 节 < 要排 1 节」于是把课挡了下来，报错还是"课时不足："（名字是空的）——
   * 界面上排课至少要选一位学生，所以只有脚本与占位课会撞上，但那种报错根本没法排查。
   */
  if (studentIds.length === 0) return null;
  const perStudent = studentIds.map((studentId) => {
    const student = db.students.find((item) => item.id === studentId);
    const remaining = student === undefined ? 0 : remainingTotal(
      student.enrollments.filter((enrollment) => enrollment.subject.trim() === subject.trim()),
    );
    // 已经排了但还没上的课：那部分课时已经被"预定"，不能再排一遍
    const scheduled = db.lessons.filter(
      (lesson) =>
        lesson.id !== excludeLessonId &&
        lesson.status === "已排" &&
        lesson.subject.trim() === subject.trim() &&
        lesson.studentIds.includes(studentId),
    ).length;
    return {
      studentId,
      name: student?.name ?? "（学生已删除）",
      remaining: Math.max(0, remaining - scheduled),
    };
  });

  const affordable = perStudent.length === 0 ? 0 : Math.min(...perStudent.map((item) => item.remaining));
  if (affordable >= count) return null;

  const short = perStudent.filter((item) => item.remaining < count);
  const names = short.map((item) => `${item.name}（还能排 ${item.remaining} 节）`).join("、");
  return {
    affordable,
    short,
    message:
      count <= 1
        ? `课时不足：${names}。请先续费/报课，再排这一节。`
        : `课时不足：${names}。${subject}最多还能排 ${affordable} 节，先续费再加排。`,
  };
}

/** 冲突报告 → 一句人话（批量排课的预览里逐节显示）。 */
function describeConflicts(db: Database, report: ConflictReport): string {
  const parts: string[] = [];
  if (report.teacher.length > 0) {
    const name = db.teachers.find((item) => item.id === report.teacher[0]?.teacherId)?.name ?? "该教师";
    parts.push(`${name} 这个时段已有课`);
  }
  if (report.classroom.length > 0) {
    const name = db.classrooms.find((item) => item.id === report.classroom[0]?.classroomId)?.name ?? "该教室";
    parts.push(`${name} 这个时段已被占用`);
  }
  if (report.students.length > 0) {
    const names = report.students
      .map((item) => db.students.find((student) => student.id === item.studentId)?.name ?? "该学生")
      .filter((value, index, list) => list.indexOf(value) === index);
    parts.push(`${names.join("、")} 已有课`);
  }
  if (report.classroomClosed) parts.push("教室该时段不开放");
  if (report.overCapacity !== null) {
    parts.push(`超过教室容量（${report.overCapacity.students} 人 > ${report.overCapacity.capacity}）`);
  }
  if (report.teacherSubjectMismatch) parts.push("教师未登记这门科目");
  return parts.join("；");
}

/**
 * **按周批量排课 · 计划**（同步、纯、只算不写）。
 *
 * 从 `startDate` 起往后找，凡落在 `weekdays` 里的日期就生成一节，直到凑够 `count` 节。
 * 每节都跑一次 `conflictsFor`，因此预览里说的和写入时判的完全一致。
 */
function planSeries(db: Database, input: SeriesInput): SeriesPlan {
  /*
   * **课时不够就不排**：先算"这门科目最多还能排几节"（剩余课时 − 已排未上，
   * 多人班课取剩余最少的那位），再把节数**封顶**到这个数。
   * 封顶而不是整批拒绝：机构想排 20 节、账上只够 8 节时，
   * 先把能排的 8 节排上更实用；但**必须在预览里说清楚**少排了多少、谁不够。
   */
  const availability = insufficientLessons(db, {
    subject: input.subject,
    studentIds: input.studentIds,
    count: input.count,
  });
  const affordable = availability === null ? input.count : availability.affordable;
  const requestedCount = Math.max(0, Math.trunc(input.count));
  const effectiveCount = Math.min(requestedCount, affordable);

  const dates = generateSeriesDates({
    startDate: input.startDate,
    weekdays: input.weekdays,
    time: input.time,
    count: effectiveCount,
  });

  const items: SeriesPlanItem[] = dates.map((startsAt) => {
    const report = conflictsFor(db, {
      id: "",
      subject: input.subject,
      form: input.form,
      teacherId: input.teacherId,
      classroomId: input.classroomId,
      studentIds: input.studentIds,
      startsAt,
      durationMinutes: input.durationMinutes,
      status: input.status,
      note: input.note,
      makeupForLessonId: "",
    });
    const reason = describeConflicts(db, report);
    return {
      startsAt,
      dayLabel: describeSeriesDate(startsAt),
      ok: report.total === 0,
      reason,
    };
  });

  /*
   * 建议节数 = **该科目剩余课时 − 已排未上**。
   * 多人班课取**剩余最少的那位**：班课是按同一份课表走的，
   * 用最多的那位会把别人上不完的课时也排进去。
   */
  const remainingPerStudent = input.studentIds.map((studentId) => {
    const student = db.students.find((item) => item.id === studentId);
    if (student === undefined) return 0;
    return student.enrollments
      .filter((enrollment) => enrollment.status === "在读" && enrollment.subject === input.subject)
      .reduce((sum, enrollment) => sum + remainingOf(enrollment), 0);
  });
  const remainingLessons = remainingPerStudent.length === 0 ? 0 : Math.min(...remainingPerStudent);

  const alreadyScheduled = db.lessons.filter(
    (lesson) =>
      lesson.status === "已排" &&
      lesson.subject === input.subject &&
      lesson.studentIds.some((id) => input.studentIds.includes(id)),
  ).length;

  return {
    items,
    schedulable: items.filter((item) => item.ok).length,
    blocked: items.filter((item) => !item.ok).length,
    remainingLessons,
    alreadyScheduled,
    suggestedCount: Math.max(0, remainingLessons - alreadyScheduled),
    requestedCount,
    // 因课时不足被砍掉的节数（> 0 时界面必须明说）
    cappedBy: Math.max(0, requestedCount - effectiveCount),
    shortageMessage: availability === null ? "" : availability.message,
  };
}

/**
 * 排课的通用增删改。
 *
 * 单独存一份，是为了在 `lessons` 组里**覆盖 create**（排课要过"课时够不够"这一关），
 * 而覆盖之后仍然能调用通用实现（不像直接展开那样丢掉原方法）。
 */
const lessonCollection = versionedCollection<Lesson>((db) => db.lessons, "l", "排课", lessonDeleteRefusal);

/**
 * 把「建档时一并报课」的宽松入参补全成一条正式的报课入参。
 *
 * 表单上只问「科目 + 节数」，其余字段给默认值 —— **默认值集中在这里一处**，
 * 而不是散在界面里：界面日后多一个入口（比如批量导入也想报课），
 * 默认口径不会各写一份然后慢慢分叉。
 */
function normalizeNewEnrollment(input: NewStudentEnrollment): NewEnrollment {
  return {
    subject: input.subject.trim(),
    form: (input.form ?? "").trim(),
    teacherId: input.teacherId ?? "",
    lessons: Math.trunc(input.lessons),
    startedAt: input.startedAt ?? "",
    note: (input.note ?? "").trim(),
    unitPrice: input.unitPrice ?? 0,
    agreedAmount: input.agreedAmount ?? 0,
    paidNow: input.paidNow ?? 0,
    method: input.method ?? "微信",
  };
}

/**
 * 校验「建档时一并报课」的那几门课，并把它们补全。
 *
 * **先全部校验、再动数据**：报课数据有问题时不能留下半个学生 ——
 * 学生建好了、课时没记上，比干脆没建更麻烦（排课时会莫名其妙排不进去）。
 *
 * 同一门科目重复报会被拒（而不是悄悄合成一条）：重复通常是把「数学 10 节」
 * 填了两遍，合成会让账目对不上；确实是第二次报，应该走「续费」。
 */
function normalizeNewEnrollments(items: NewStudentEnrollment[], db: Database): NewEnrollment[] {
  const normalized = items.map(normalizeNewEnrollment);
  const seen = new Set<string>();
  for (const item of normalized) {
    if (item.subject === "") throw new Error("报课科目不能为空。");
    if (!Number.isFinite(item.lessons) || item.lessons <= 0) {
      throw new Error(`「${item.subject}」的课时数必须是大于 0 的整数。`);
    }
    if (seen.has(item.subject)) {
      throw new Error(`「${item.subject}」报了两次：同一门科目请合并成一条（第二次报请用「续费」）。`);
    }
    seen.add(item.subject);
    /*
     * 指定教师必须是档案里真实存在的人。
     *
     * 界面是下拉选的，正常不会错；但接口是可以被直接调的（脚本、将来的导入），
     * 而一个不存在的教师 id 会静默存下来 —— 之后报课面板上那一栏是空的、
     * 排课时也找不到人，属于"数据坏了但不报错"的那一类。
     */
    if (item.teacherId !== "" && !db.teachers.some((teacher) => teacher.id === item.teacherId)) {
      throw new Error(`「${item.subject}」指定的教师不存在：请重新选择（或改成「不指定」）。`);
    }
  }
  return normalized;
}

/**
 * 记一笔课时流水（**报课 / 续费 / 调整 / 退课的唯一入口**）。
 *
 * 为什么必须有这一步：界面上每条报课下面的「课时流水」读的是 `db.transactions`，
 * 只写 `enrollment.history` 的话，机构看到的是**空账本** ——
 * 「刚报了 20 节，流水里一笔都没有」，只能怀疑数据没存上。
 * 示例数据（`seed.ts`）本来就是「history 与流水两边都写」，新录入的应该同规矩。
 *
 * `delta` 记的是**实际生效**的节数，不是管理员填的数字：课时不会被调成负数，
 * 填「减 20 节、实际只剩 15 节」时流水要写 `-15`，否则「流水之和 = 剩余课时」
 * 这条不变式对不上（自检里有断言守着）。
 */
function addLessonTransaction(
  db: Database,
  enrollment: Enrollment,
  input: {
    studentId: string;
    delta: number;
    kind: LessonTransaction["kind"];
    note: string;
    lessonId?: string;
    at?: string;
  },
): LessonTransaction {
  const created = addTransaction(db, {
    studentId: input.studentId,
    enrollmentId: enrollment.id,
    subject: enrollment.subject,
    delta: input.delta,
    kind: input.kind,
    lessonId: input.lessonId ?? "",
    note: input.note,
  });
  // 报课当天到账的流水，时间用开课日期而不是「此刻」（补录历史时更贴近事实）
  if (input.at !== undefined && input.at !== "") created.at = input.at;
  return created;
}

/**
 * 造一条报课记录（`students.enroll` 与「建档时一并报课」共用）。
 *
 * 两处各写一份的话，「建档报的课」与「后来单独报的课」迟早会在某个字段上分叉
 * （一边记了课时流水、另一边忘了），对账时才发现两批数据不是一个形状。
 */
/**
 * 校验**单条**报课。
 *
 * ## 为什么要有它（审计抓到的"同一个动作两个口径"）
 *
 * 建档时报课走 `normalizeNewEnrollments`（空科目、课时 ≤ 0、同科目重复、不存在的教师全拦），
 * 注释还解释了为什么；但**后来单独补报课**走的是 `students.enroll` → `addEnrollment`，
 * 那条路上一条都不查。实测：`teacherId: "t_根本不存在"`、`subject: ""`、
 * 同一门科目报两次 —— 全都静默落库。于是"建档时报的第一门课是干净的，
 * 后来补报的课可以是脏的"，同一张表两种数据质量。
 *
 * 现在两处共用这一个函数：规则只有一份，`students.enroll` / `renewEnrollment` 都过它。
 */
function validateNewEnrollment(db: Database, input: NewEnrollment): void {
  const subject = input.subject.trim();
  if (subject === "") throw new Error("报课科目不能为空。");
  if (!Number.isFinite(input.lessons) || Math.trunc(input.lessons) <= 0) {
    throw new Error(`「${subject}」的课时数必须是大于 0 的整数。`);
  }
  if (input.teacherId !== "" && !db.teachers.some((teacher) => teacher.id === input.teacherId)) {
    throw new Error(`「${subject}」指定的教师不存在：请重新选择（或改成「不指定」）。`);
  }
}

function addEnrollment(db: Database, student: Student, input: NewEnrollment): Enrollment {
  const lessons = Math.max(0, Math.trunc(input.lessons));
  const enrollment: Enrollment = {
    id: nextId("e"),
    subject: input.subject.trim(),
    form: input.form.trim(),
    teacherId: input.teacherId,
    totalLessons: lessons,
    usedLessons: 0,
    unitPrice: round2(Math.max(0, input.unitPrice)),
    agreedAmount: round2(Math.max(0, input.agreedAmount)),
    paidAmount: 0,
    startedAt: input.startedAt !== "" ? input.startedAt : nowIso(),
    endedAt: "",
    status: "在读",
    note: input.note.trim(),
    // 成交即到账的可以留空；后面用「收款 / 退款」补记
    history: [{ at: nowIso(), kind: "报课", lessons, note: input.note.trim() }],
  };
  student.enrollments.push(enrollment);

  if (lessons > 0) {
    addLessonTransaction(db, enrollment, {
      studentId: student.id,
      delta: lessons,
      kind: "报课",
      note: input.note.trim() === "" ? "报课" : `报课 · ${input.note.trim()}`,
      at: enrollment.startedAt,
    });
  }

  /*
   * 首次实收：金额由收款记录承载，报课记录的 paidAmount 从收款记录累加。
   * 一次报课可能分期付款，因此这两件事必须分开记 ——
   * 把金额只存在报课记录上，就没法表达「报课时只付了一半」。
   */
  if (input.paidNow > 0) {
    recordPayment(db, {
      studentId: student.id,
      enrollmentId: enrollment.id,
      amount: round2(input.paidNow),
      kind: "收款",
      method: input.method,
      at: enrollment.startedAt,
      note: "报课收款",
    });
  }

  return enrollment;
}

const localApi = {
  students: {
    ...studentCollection,

    /**
     * 学生列表。
     *
     * 普通教师只看到**自己课上的学生**，并且这些学生的档案里**没有金额**
     * （`hideStudentMoney`：单价 / 约定应缴 / 实收一律置 0）——
     * 机构确认的边界③是"教师能看自己学生的课时余额"，而余额与金额在同一个对象上，
     * 所以剥字段而不是拒绝整个接口（理由写在 `hideStudentMoney` 上面）。
     */
    async list(): Promise<Student[]> {
      const view = captureView();
      await delay();
      const db = load();
      return clone(scopeStudents(view, db, db.students));
    },

    /**
     * 单个学生。
     *
     * 不在你的范围里 → **`null`（当作不存在）**，不报错：口径是"行级越界＝看不到"，
     * 报 403 等于告诉对方"这个学生是存在的，只是不归你"（那本身就是泄漏）。
     */
    async get(id: string): Promise<Student | null> {
      const view = captureView();
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === id);
      if (student === undefined) return null;
      const visible = scopeStudent(view, db, student);
      return visible === null ? null : clone(visible);
    },
    /**
     * 建档（**可以同时报课**：一个学生报多门，每门节数各自独立）。
     *
     * 建档时间由服务生成；不传 `enrollments` 就是只建档（报课走 `enroll()`）。
     *
     * 「建档 + 报课」刻意做成**一次落盘、一条日志**：分两步做的话，
     * 中途失败会留下「有档案、没课时」的半成品，而那种学生在排课时
     * 会被"课时不足就不排课"挡下来，看半天不知道为什么。
     * 报课数据的校验也放在**落库之前**（见 `normalizeNewEnrollments`）。
     */
    async create(input: NewStudent): Promise<Student> {
      await delay();
      const db = load();
      const { subjects, enrollments, ...rest } = input;
      const wanted = normalizeNewEnrollments(enrollments ?? [], db);

      const student: Student = {
        ...rest,
        id: nextId("s"),
        version: 1,
        subjects: subjects ?? [],
        profile: input.profile ?? {},
        enrollments: [],
        createdAt: nowIso(),
      };
      db.students.push(student);

      for (const item of wanted) addEnrollment(db, student, item);

      // 报读科目由报课记录推导（`subjects` 不再单独维护一份）
      syncSubjects(student);

      writeLog(db, {
        entity: "学生",
        action: "新建",
        targetId: student.id,
        summary:
          `新建学生「${student.name}」` +
          (wanted.length === 0
            ? ""
            : `（报课：${wanted.map((item) => `${item.subject} ${item.lessons} 节`).join("、")}）`),
      });
      persist(db);
      return clone(student);
    },
    /**
     * 报课：新开一条报课记录。
     *
     * 同科目同班型的在读记录不会被合并 —— 合并会掩盖「报了两次」的事实，
     * 续费请用 renewEnrollment()，那条会累加课时并留下流水。
     *
     * 与「建档时一并报课」共用同一个 `addEnrollment`：两条入口造的报课记录
     * 必须是同一个形状，否则对账时才发现两批数据不一样。
     */
    async enroll(studentId: string, input: NewEnrollment): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      if (student === undefined) return null;

      // 与「建档时报课」同一套校验（见 `validateNewEnrollment` 的说明）
      validateNewEnrollment(db, input);
      const subject = input.subject.trim();
      const existing = student.enrollments.find((item) => item.subject.trim() === subject && item.status === "在读");
      if (existing !== undefined) {
        throw new Error(
          `「${subject}」已经有一条在读的报课（还剩 ${existing.totalLessons - existing.usedLessons} 节）：` +
            "同一门科目请用「续费」加课时，而不是再报一次 —— 否则课时会分成两条、余额看着对不上。",
        );
      }

      const enrollment = addEnrollment(db, student, input);

      syncSubjects(student);
      touchStudent(db, student.id);
      writeLog(db, {
        entity: "报课",
        action: "报课",
        targetId: enrollment.id,
        summary: `${student.name} 报课「${enrollment.subject}」${enrollment.totalLessons} 节`,
      });
      persist(db);
      return clone(student);
    },

    /**
     * **改报课**（班型 / 指定教师 / 单价 / 约定应缴 / 备注）。
     *
     * ## 影响范围像手机日历改日程
     *
     * `scope: "enrollment"` 只改这条记录；`scope: "future-lessons"` 连**后续还没上的**
     * 课一起改（换教师、换班型通常要这样）。两种范围都**绝不碰过去**：
     *   - `已上`的课不动（那是发生过的事实，改了它老师与课时都对不上）；
     *   - 时间已经过去的课也不动（哪怕状态还挂着"已排"——它多半是忘了标记，不是未来安排）。
     *
     * ## 逐节检查冲突，能改的改、有冲突的跳过并说明
     *
     * 换教师最常见的后果就是"新教师那个时段已经有课"。这里对**每一节**先用同一套
     * `conflictsFor` 判一次（与排课、批量排课同一个引擎），撞了就跳过并在结果里写清原因 ——
     * 与批量排课同一套纪律：宁可少改一节并说清楚，也不要造出一堆撞课的课表让人事后一节节查。
     *
     * ## 为什么不在这里改科目与课时
     *
     * 科目是"这节课扣哪条报课"的匹配键（见 `EnrollmentEdit` 的注释），
     * 课时只走「续费 / 调整」。这两件事动了，账本与已排的课会静默对不上。
     */
    async updateEnrollment(
      studentId: string,
      enrollmentId: string,
      patch: EnrollmentEdit,
      scope: EnrollmentEditScope = "future-lessons",
    ): Promise<EnrollmentEditResult> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) {
        return { student: null, changes: [], updatedLessons: [], skippedLessons: [], pastLessons: 0 };
      }

      // 指定教师必须是真实存在的人（与建档报课同一道校验）
      if (patch.teacherId !== undefined && patch.teacherId !== "") {
        if (!db.teachers.some((teacher) => teacher.id === patch.teacherId)) {
          throw new Error("指定的教师不存在：请重新选择（或改成「不指定」）。");
        }
      }
      for (const [label, value] of [
        ["单价", patch.unitPrice],
        ["约定应缴", patch.agreedAmount],
      ] as Array<[string, number | undefined]>) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
          throw new Error(`${label}不能是负数。`);
        }
      }

      const changes: string[] = [];
      /** 记下改动前后的值：日志与界面都要能回答"从什么改成了什么"。 */
      const record = (label: string, before: string, after: string) => {
        if (before === after) return;
        changes.push(`${label}：${before === "" ? "（空）" : before} → ${after === "" ? "（空）" : after}`);
      };

      if (patch.form !== undefined) {
        const next = patch.form.trim();
        record("班型", enrollment.form, next);
        enrollment.form = next;
      }
      if (patch.teacherId !== undefined) {
        const teacherName = (id: string) =>
          id === "" ? "不指定" : (db.teachers.find((teacher) => teacher.id === id)?.name ?? "（已删除）");
        record("指定教师", teacherName(enrollment.teacherId), teacherName(patch.teacherId));
        enrollment.teacherId = patch.teacherId;
      }
      if (patch.unitPrice !== undefined) {
        record("单价", String(enrollment.unitPrice), String(round2(Math.max(0, patch.unitPrice))));
        enrollment.unitPrice = round2(Math.max(0, patch.unitPrice));
      }
      if (patch.agreedAmount !== undefined) {
        record("约定应缴", String(enrollment.agreedAmount), String(round2(Math.max(0, patch.agreedAmount))));
        enrollment.agreedAmount = round2(Math.max(0, patch.agreedAmount));
      }
      if (patch.note !== undefined) {
        record("备注", enrollment.note, patch.note.trim());
        enrollment.note = patch.note.trim();
      }

      /*
       * 影响范围：只在"改班型 / 改指定教师"时才有意义 ——
       * 单价与约定应缴是账户上的数字，跟课表无关（课节上也不存这两个）。
       */
      const updatedLessons: Array<{ id: string; startsAt: string }> = [];
      const skippedLessons: Array<{ id: string; startsAt: string; reason: string }> = [];
      let pastLessons = 0;
      const touchesSchedule = patch.form !== undefined || patch.teacherId !== undefined;

      if (scope === "future-lessons" && touchesSchedule) {
        const now = Date.now();
        const related = db.lessons.filter(
          (lesson) =>
            lesson.subject.trim() === enrollment.subject.trim() &&
            lesson.studentIds.includes(studentId),
        );
        /*
         * `pastLessons` 的计数要**两样都算**：`已上`的，以及时间已过但状态还挂着
         * 「已排」的（多半是忘了标记）。只算后者的话，界面会漏报"还有一节上过的没动"，
         * 而那句话正是用来回答"为什么这节课没跟着改"的。
         */
        pastLessons = related.filter(
          (lesson) => lesson.status === "已上" || new Date(lesson.startsAt).getTime() <= now,
        ).length;

        // 真正可能被改的：还没上的、状态仍是「已排」的那些
        const candidates = related.filter(
          (lesson) => lesson.status === "已排" && new Date(lesson.startsAt).getTime() > now,
        );

        for (const lesson of candidates) {
          const next: LessonInput = {
            id: lesson.id,
            subject: lesson.subject,
            form: patch.form !== undefined ? patch.form.trim() : lesson.form,
            teacherId: patch.teacherId !== undefined ? patch.teacherId : lesson.teacherId,
            classroomId: lesson.classroomId,
            studentIds: lesson.studentIds,
            startsAt: lesson.startsAt,
            durationMinutes: lesson.durationMinutes,
            status: lesson.status,
            note: lesson.note,
            makeupForLessonId: lesson.makeupForLessonId,
          };
          const report = conflictsFor(db, next);
          if (report.total > 0) {
            skippedLessons.push({
              id: lesson.id,
              startsAt: lesson.startsAt,
              reason: describeConflicts(db, report),
            });
            continue;
          }
          lesson.form = next.form;
          lesson.teacherId = next.teacherId;
          /*
           * 跟着改掉的课节**也是被写过的记录**：把它们的版本推进一格。
           *
           * 少了这一步就会出现一个很隐蔽的静默覆盖：李四排课页上开着这节课的表单
           * （读到的版本还是旧的），张三改报课把这位老师换掉了，李四一保存 ——
           * 教师又变回去了，而他的表单上写的是"保存成功"。推一格之后李四会看到
           * "刚被别人改过，请刷新"，正好是我们要的效果。
           */
          bumpVersion(lesson);
          updatedLessons.push({ id: lesson.id, startsAt: lesson.startsAt });
        }
      }

      syncSubjects(student);
      touchStudent(db, student.id);
      writeLog(db, {
        entity: "报课",
        action: "改报课",
        targetId: enrollment.id,
        summary:
          `${student.name} 改报课「${enrollment.subject}」：${changes.length === 0 ? "（没有改动）" : changes.join("；")}` +
          (scope === "future-lessons"
            ? `；后续课节改 ${updatedLessons.length} 节、跳过 ${skippedLessons.length} 节、已过去 ${pastLessons} 节未动`
            : "；只改记录，课节未动"),
      });
      persist(db);

      return clone({
        student,
        changes,
        updatedLessons,
        skippedLessons,
        pastLessons,
      });
    },

    /** 续费：给某条报课累加课时，并留下流水。 */
    async renewEnrollment(
      studentId: string,
      enrollmentId: string,
      lessons: number,
      note = "",
      money?: { amount: number; method: PaymentMethod; agreedDelta?: number },
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;
      if (enrollment.status !== "在读") return clone(student);

      const added = Math.max(0, Math.trunc(lessons));
      enrollment.totalLessons += added;
      // 续费时约定应缴同步增加（不填则按标价补），否则欠费会算错
      enrollment.agreedAmount = round2(
        Math.max(0, enrollment.agreedAmount + (money?.agreedDelta ?? added * enrollment.unitPrice)),
      );
      enrollment.history.push({ at: nowIso(), kind: "续费", lessons: added, note: note.trim() });
      if (added > 0) {
        addLessonTransaction(db, enrollment, {
          studentId: student.id,
          delta: added,
          kind: "续费",
          note: note.trim() === "" ? "续费" : `续费 · ${note.trim()}`,
        });
      }

      const amount = round2(Math.max(0, money?.amount ?? 0));
      if (amount > 0) {
        recordPayment(db, {
          studentId: student.id,
          enrollmentId: enrollment.id,
          amount,
          kind: "收款",
          method: money?.method ?? "微信",
          at: nowIso(),
          note: note.trim() === "" ? "续费收款" : `续费收款 · ${note.trim()}`,
        });
      }

      syncSubjects(student);
      touchStudent(db, student.id);
      writeLog(db, {
        entity: "报课",
        action: "续费",
        targetId: enrollment.id,
        summary: `${student.name} 续费「${enrollment.subject}」${added} 节`,
      });
      persist(db);
      return clone(student);
    },

    /**
     * 退课：把报课记录置为已退课并记下日期。
     *
     * 采用「标记退课」而不是删除记录：剩余课时与历史必须留痕，
     * 否则以后对账时说不清「这些课时去哪了」。
     */
    async refundEnrollment(
      studentId: string,
      enrollmentId: string,
      note = "",
      /**
       * 退款信息。
       *
       * ## 金额**由服务端重算**（2026-09 审计改的一处真问题）
       *
       * 早先这里收的是前端算好的 `amount`，原样落账 —— 而 `lib/backend/finance.ts` 的
       * 退费策略只在浏览器里跑了一遍用来**预览**。实测：把 `amount` 写成 999999 也照收
       * （HTTP 200），于是任何能调 `/api/call` 的角色都能退任意金额。
       * 而同一仓库的老 REST 那条路的注释写着"金额一律由服务端算，不接受前端传来的退款额"
       * —— 护栏在没人走的那条路上，正是"信任模型两条路相反"。
       *
       * 现在：只认 `policyId`，金额服务端按策略重算；前端传的 `amount` 只用于**对账**
       * （它来自界面上的预览）。对不上就拒绝并要求刷新 —— 那说明期间这条报课被改过，
       * 照旧写入会退错钱，而"是界面过期了"这件事必须让人知道（与乐观锁同一套取舍）。
       */
      refund?: { policyId: string; method: PaymentMethod; amount?: number; policyName?: string },
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;

      /*
       * 服务端自己算一遍（唯一权威）。`calculateRefund` 是 `finance.ts` 里那份策略实现 ——
       * 界面调的是同一个函数（预览），因此两边口径天然一致。
       */
      const policy = findRefundPolicy(refund?.policyId ?? REFUND_POLICIES[0]!.id);
      const computed = calculateRefund(enrollment, policy.id);
      if (refund !== undefined && refund.amount !== undefined && round2(refund.amount) !== computed.refund) {
        throw new Error(
          `退款金额对不上：界面算的是 ¥${round2(refund.amount)}，服务端按「${policy.name}」重算是 ¥${computed.refund}` +
            `（${computed.formula}）。这条报课在你看这一页之后被改过 —— 请刷新这一页，重新确认退款金额。`,
        );
      }
      /*
       * 退款不能超过实收：`paidAmount` 是"实际到账累计"，退超了账本会变成负数
       * （`recordPayment` 里的钳位会把它压到 0，于是"实收"与账本永久分叉 —— 审计里那一条）。
       * 因此这里提前拒绝，让人先去核对该学生的收款流水。
       */
      if (computed.refund > round2(enrollment.paidAmount)) {
        throw new Error(
          `按「${policy.name}」应退 ¥${computed.refund}，而这条报课的实收只有 ¥${round2(enrollment.paidAmount)} —— ` +
            "退款不能超过实收。请先核对该学生的收款流水（收款可能是分期、也可能记在别的报课上）。",
        );
      }
      const refundAmount = computed.refund;

      enrollment.status = "已退课";
      enrollment.endedAt = nowIso();
      enrollment.history.push({
        at: nowIso(),
        kind: "退课",
        lessons: 0,
        note:
          refund !== undefined && refundAmount > 0
            ? `${note.trim()}${note.trim() !== "" ? " · " : ""}按「${policy.name}」退款 ${refundAmount} 元（${computed.formula}）`
            : note.trim(),
      });
      /*
       * 退课的流水记 **0 节**（与 v4→v5 迁移的折算规则一致）：
       * 退课只改状态、不减总课时，「剩余 = 总课时 − 已用」这条口径要保持。
       * 记成负数的话，「流水之和 = 剩余课时」当场就对不上了。
       */
      addLessonTransaction(db, enrollment, {
        studentId: student.id,
        delta: 0,
        kind: "退课",
        note: note.trim() === "" ? "退课" : `退课 · ${note.trim()}`,
      });

      if (refund !== undefined && refundAmount > 0) {
        const refunded = recordPayment(db, {
          studentId: student.id,
          enrollmentId: enrollment.id,
          amount: refundAmount,
          kind: "退款",
          method: refund.method,
          at: nowIso(),
          note: `退课退款 · ${policy.name}`,
        });
        // 钱必须留痕（与 payments.record 同一条纪律）
        writeLog(db, {
          entity: "收款",
          action: "退款",
          targetId: refunded.id,
          summary: `${student.name} 退课退款 ¥${refundAmount}（${refund.method}）· ${policy.name}：${computed.formula}`,
        });
      }

      syncSubjects(student);
      touchStudent(db, student.id);
      writeLog(db, {
        entity: "报课",
        action: "退课",
        targetId: enrollment.id,
        summary: `${student.name} 退课「${enrollment.subject}」${note.trim()}`.trim(),
      });
      persist(db);
      return clone(student);
    },

    /** 直接改一条报课的课时（补录 / 纠错用），同样留流水。 */
    async adjustEnrollmentLessons(
      studentId: string,
      enrollmentId: string,
      delta: number,
      note = "",
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;

      const before = enrollment.totalLessons;
      enrollment.totalLessons = Math.max(0, enrollment.totalLessons + Math.trunc(delta));
      enrollment.history.push({
        at: nowIso(),
        kind: "续费",
        lessons: Math.trunc(delta),
        note: note.trim() === "" ? "手工调整" : note.trim(),
      });
      /*
       * 流水记的是**实际生效**的节数（`after - before`），不是填进来的那个数：
       * 课时不会被调成负数，填「减 20 节、实际只剩 15 节」时流水必须是 -15，
       * 否则「流水之和 = 剩余课时」对不上账（差额就是被夹掉的那 5 节）。
       * 调整件数按「调整」记，与「续费」区分开 —— 续费是家长交钱买的，
       * 调整是后台改账，两者混在一起会看不出课时到底从哪来。
       */
      const effective = enrollment.totalLessons - before;
      if (effective !== 0) {
        addLessonTransaction(db, enrollment, {
          studentId: student.id,
          delta: effective,
          kind: "调整",
          note:
            (note.trim() === "" ? "手工调整" : note.trim()) +
            (effective !== Math.trunc(delta)
              ? `（申请 ${delta > 0 ? "+" : ""}${Math.trunc(delta)} 节，实际生效 ${effective > 0 ? "+" : ""}${effective} 节：课时不会变成负数）`
              : ""),
        });
      }

      /*
       * **改账必须留痕**（审计抓到的一处）：这里直接把购买课时改掉并写课时流水，
       * 但早先没有操作日志 —— "谁在什么时候把这条报课的课时从 4 改成 7"查不到，
       * 而它比改一个备注严重得多。
       */
      writeLog(db, {
        entity: "报课",
        action: "调整课时",
        targetId: enrollment.id,
        summary:
          `${student.name} 的「${enrollment.subject}」课时 ${before} → ${enrollment.totalLessons} 节` +
          `（${effective > 0 ? "+" : ""}${effective}）${note.trim() === "" ? "" : ` · ${note.trim()}`}`,
      });
      syncSubjects(student);
      touchStudent(db, student.id);
      persist(db);
      return clone(student);
    },

    /**
     * 保存信息采集表（整份覆盖；调用方传完整对象）。
     *
     * ## 这里是乐观锁最要紧的一处
     *
     * `student.profile` 是**整份替换**（不是逐字段合并）：两个人同时填同一张采集表时，
     * 后保存的那份会把前一个人填的**整块**盖掉 —— 症状是"我明明填过，怎么空了"，
     * 而且没有任何报错。因此这里比课程/教师表单更需要 `expectedVersion`。
     *
     * 参数刻意是**可选**的（`options?: WriteOptions`）：老调用方（脚本、验收、自检、
     * 将来别的内部入口）一行都不用改，行为与今天完全一样；界面上的表单一定传。
     */
    async saveProfile(
      id: string,
      profile: StudentProfile,
      options: WriteOptions = {},
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === id);
      if (student === undefined) return null;

      assertVersion(student, options.expectedVersion, `学生「${student.name}」`);

      student.profile = profile;
      bumpVersion(student);
      writeLog(db, {
        entity: "学生",
        action: "填写采集表",
        targetId: student.id,
        summary: `更新「${student.name}」的信息采集表`,
      });
      persist(db);
      return clone(student);
    },

    /**
     * 模糊搜索学生（姓名 / 年级 / 家长联系方式 / 在读科目）。
     *
     * **先按范围过滤、再匹配关键词**：反过来做（先搜全校、再过滤）虽然结果一样，
     * 但会让"搜到别人班的学生名字"这种事只取决于过滤那一步有没有被漏掉 ——
     * 而"先缩小范围"是默认关门那一侧的写法。
     */
    async search(keyword: string): Promise<Student[]> {
      const view = captureView();
      await delay();
      const db = load();
      const visible = scopeStudents(view, db, db.students);
      const text = keyword.trim().toLowerCase();
      if (text === "") return clone(visible);
      return clone(
        visible.filter((student) =>
          [student.name, student.grade, student.guardian, ...student.subjects]
            .join(" ")
            .toLowerCase()
            .includes(text),
        ),
      );
    },
  },

  /**
   * 课程库：后台的课程台账（排课科目、教师可带科目、报课科目都按名字引用它）。
   *
   * 网站上的课程在**建库时**进来（`initial.ts` → `materializeSiteCourses()`，v32 起
   * 不再有运行期的「从网站同步」入口）；机构自己加的课（围棋、书法这类网站上还没有的）
   * 与它们平起平坐，都能排课、能记课时。
   *
   * 注意边界：这里加课程**不会**让宣传网站上多出一张卡片 —— 网站是静态内容。
   */
  /*
   * ── 课程类型的维度表（v23）────────────────────────────────────────────────
   *
   * 只有两个方法：**读整份** + **存整份**。
   *
   * 为什么不做成"每张表各一套 CRUD"（学段/学科/模块/班型/交付 5×3 = 15 个方法）：
   * 后台那一页本来就是"打开 → 在这一份草稿上增删改排序 → 保存"，整份交上来最省事，
   * 也避免出现"改了三处、只有两处落库"那种半截状态。维度表很小（几百行），
   * 整份写的代价可以忽略；`validateCatalog` 会把悬空引用与重名一次说清。
   *
   * 权限刻意**没有单独分**（机构说"先不分维护角色"）：它落在 `crud` 这一组，
   * 与课程库写入同一档（技术管理员 / 财务管理员 / 招生老师），教师只读。
   */
  catalog: {
    /** 整份维度表（后台维护页与将来的组合解析都读它）。 */
    async list(): Promise<Catalog> {
      await delay();
      return clone(load().catalog);
    },

    /**
     * 存整份维度表（校验后整体替换）。
     *
     * 与"分区/课程"那类不同，这里**不做乐观锁**：维度表是配置（不是逐条编辑的业务记录），
     * 而整份替换本身已经是"我看到的这一份就是我要的"——两个人同时改会以后保存的为准，
     * 日志里记下规模变化，出问题看得出是哪一次改的。
     */
    async save(input: Catalog): Promise<Catalog> {
      await delay();
      const db = load();
      const normalized = normalizeCatalog(input);
      const problems = validateCatalog(normalized);
      if (problems.length > 0) throw new Error(problems.join("；"));

      const before = catalogSummary(db.catalog);
      const after = catalogSummary(normalized);
      /*
       * 删掉一个维度（学段 / 学科 / 模块 / 班型 / 交付形态）时，**引用它的开放组合会变成悬空**。
       *
       * 为什么在这里清掉而不是留给矩阵页去报错：悬空的组合**在矩阵里根本不显示**
       * （行或列已经不在维度表里），而 `offers.save` 会因为"引用了不存在的行"整份拒绝 ——
       * 机构会卡在"打开就报错、却找不到那一格去改"的死角里。
       * 因此删除维度（一个明确的、要确认的动作）的后果就是**一起清掉受影响的组合**，
       * 并把条数写进日志（"删了什么、连带清掉几条"都查得到）。
       *
       * 反过来，**读的时候不偷偷清**（见 `danglingOffers` 的注释）：组合的开放与否是经营决定，
       * 只有机构自己的删除动作才会连带影响它；从外部进来的不一致数据由矩阵页列出来让它自己处理。
       */
      const droppedOffers = danglingOffers(db.offers, normalized);
      db.catalog = normalized;
      if (droppedOffers.length > 0) {
        const droppedIds = new Set(droppedOffers.map((offer) => offer.id));
        db.offers = db.offers.filter((offer) => !droppedIds.has(offer.id));
        writeLog(db, {
          entity: "开放矩阵",
          action: "连带清除",
          targetId: "",
          summary: `删除维度让 ${String(droppedOffers.length)} 条开放组合失效，已一并清除`,
        });
      }
      /*
       * 班型改名 / 删除要**跟着走**：报价里那一份班级类型存的还是旧名字的话，
       * 库里就留下了一份过期数据（导出、导出的 Markdown、以及按名字查的地方都会用到它）。
       * 读的时候还有一层对齐兜底（导入、手改过的库），这一层是让**落库的状态本身就是对的**。
       */
      db.pricing = {
        ...db.pricing,
        classTypes: syncClassTypes(db.pricing.classTypes, db.catalog).classTypes,
      };
      writeLog(db, {
        entity: "课程类型",
        action: "保存",
        targetId: "",
        summary: `课程类型的维度表：${after}` + (before === after ? "（规模未变）" : `（原 ${before}）`),
      });
      persist(db);
      return clone(db.catalog);
    },

    /** 把维度表恢复成机构那份清单的种子（"改乱了想回到初值"用；会覆盖人工改动）。 */
    async resetToSeed(): Promise<Catalog> {
      await delay();
      const db = load();
      db.catalog = catalogFromSeed();
      const seed = catalogSeedSummary();
      writeLog(db, {
        entity: "课程类型",
        action: "恢复种子",
        targetId: "",
        summary:
          `课程类型的维度表恢复成种子：${String(seed.stages)} 个学段 / ` +
          `${String(seed.subjects)} 个学科项目 / ${String(seed.modules)} 个内容模块`,
      });
      persist(db);
      return clone(db.catalog);
    },
  },

  /**
   * **开放组合**（v24）：本机构开哪些"学科 × 内容模块 × 班型 × 交付形态"。
   *
   * 与 `catalog` 同一套做法（整份读、整份写），理由也一样：矩阵那一页是
   * "打开 → 在格子上勾 → 保存"，而**空表是合法的初值**（机构还没设过）。
   * 两个方法刻意只有这两个：
   *   - 批量勾选（整行 / 整列 / 整个学段）是**页面上的纯函数**（`applyDecision`），
   *     不必为每种批量动作加一个接口 —— 那会让"批量"的口径散在服务端好几处；
   *   - 单条勾选与批量勾选走的是同一条保存路径，因此不存在"单条能存、批量被拒"这种事。
   */
  offers: {
    /** 整张组合表（稀疏：只有机构表过态的才有行）。 */
    async list(): Promise<CatalogOffer[]> {
      await delay();
      return clone(load().offers);
    },

    /**
     * 存整张组合表（校验后整体替换）。
     *
     * 校验与维度表分开：`validateOffers` 管的是"引用还在不在、同一条组合有没有两行"
     * （`validateCatalog` 管维度表自己的自洽）。两者都要过 —— 但组合表**不**要求
     * 维度表本身合法（先改维度、再调组合是常态，反过来也一样）。
     */
    async save(input: readonly CatalogOffer[]): Promise<CatalogOffer[]> {
      await delay();
      const db = load();
      const normalized = normalizeOffers(input);
      const problems = validateOffers(normalized, db.catalog);
      if (problems.length > 0) throw new Error(problems.join("；"));

      const before = offersSummary(db.offers);
      const after = offersSummary(normalized);
      db.offers = normalized;
      writeLog(db, {
        entity: "开放矩阵",
        action: "保存",
        targetId: "",
        summary: `开放组合：${after}` + (before === after ? "（规模未变）" : `（原 ${before}）`),
      });
      persist(db);
      return clone(db.offers);
    },
  },

  /**
   * **寒暑假段**（v27）：哪几天按假期作息（= 周末那一组时段）。
   *
   * 与维度表同一套做法（整份读、整份写）：条数是个位数，页面上的操作就是
   * "加一段 / 改起止 / 删一段 → 保存"，整份替换最省事。
   */
  vacations: {
    /** 全部的寒暑假段。 */
    async list(): Promise<VacationPeriod[]> {
      await delay();
      return clone(load().vacations);
    },

    /** 存整份（校验后整体替换）。 */
    async save(input: readonly VacationPeriod[]): Promise<VacationPeriod[]> {
      await delay();
      const db = load();
      const normalized = normalizeVacations(input);
      const problems = validateVacations(normalized, db.catalog);
      if (problems.length > 0) throw new Error(problems.join("；"));

      db.vacations = normalized;
      writeLog(db, {
        entity: "寒暑假",
        action: "保存",
        targetId: "",
        summary:
          normalized.length === 0
            ? "寒暑假段：清空"
            : `寒暑假段：${String(normalized.length)} 段（${normalized
                .map((item) => `${item.name} ${item.startDate}–${item.endDate}`)
                .join("、")}）`,
      });
      persist(db);
      return clone(db.vacations);
    },
  },

  courses: {
    /*
     * 课程库：从带版本号的工厂里取需要的几个（`list` / `create` / `update` / `remove`）。
     * `courses.get` 全仓库零调用 —— 页面靠 `courses.list()` + 前端筛选（课程是几十条的量级），
     * 因此不再铺开（2026-09 审计后收的）。
     */
    list: versionedCollection<Course>((db) => db.courses, "course", "课程", courseDeleteRefusal).list,
    // `remove` 在下面自己实现（要先过 `canRemoveCourse`：网站来源的课不让删）

    /**
     * 新建课程（先校验再落库）。
     *
     * 课程名是引用键（排课、教师科目、报课记录都按名字记），重名必须拦住：
     * 「数学」有两门课时，课时扣到哪一门就说不清了。
     */
    async create(input: Omit<Course, "id" | "version">): Promise<Course> {
      await delay();
      const db = load();
      const normalized = normalizeCourse(input);
      const problems = [
        ...validateCourse(normalized, db.courses, db.coursePartitions),
        ...courseDimensionProblems(normalized, db.catalog),
      ];
      if (problems.length > 0) throw new Error(problems.join("；"));

      // 新记录从第 1 版开始；normalizeCourse 对没带版本的入参也会补 1，这里显式写出来
      const created: Course = { ...normalized, id: nextId("course"), version: 1 };
      db.courses.push(created);
      syncPricingWithCourses(db);
      const where = partitionName(db.coursePartitions, created.partitionId);
      writeLog(db, {
        entity: "课程",
        action: "新建",
        targetId: created.id,
        summary:
          `新建课程「${created.name}」` +
          `（${where === "" ? "未归类" : where}${created.origin === "后台" ? " · 后台新增" : ""}）`,
      });
      persist(db);
      return clone(created);
    },

    /**
     * 修改课程：改名同样要防重名；网站来源的课程也能改状态 / 班型 / 分区 / 备注 / 网站卡片字段。
     *
     * 课程表单是整份提交（名字 / 分区 / 班型 / 状态 / 备注 / 网站卡片字段一起交上来），
     * 因此这里接 `expectedVersion`：两个人同时编辑同一门课，后提交的会被拒绝并要求刷新。
     *
     * **先比版本、再校验参数**：版本不一致时，手上这份表单本来就是过期的 ——
     * 这时候去报"课程名重复"很可能只是过期的错觉（对方刚改了名字），
     * 让人先刷新再说，比让他去改一个不存在的重名问题有用。
     */
    async update(
      id: string,
      patch: Partial<Omit<Course, "id" | "version">>,
      options: WriteOptions = {},
    ): Promise<Course | null> {
      await delay();
      const db = load();
      const target = db.courses.find((item) => item.id === id);
      if (target === undefined) return null;

      assertVersion(target, options.expectedVersion, `课程「${target.name}」`);

      /*
       * `version: target.version`：与通用集合那一处同一个理由 ——
       * patch 在运行时不保证没有 version（类型只在字面量上挡得住多余的属性）。
       * normalizeCourse 会保留传进去的版本，因此必须在**进它之前**把版本钉住。
       */
      const next = normalizeCourse({ ...target, ...patch, version: target.version });
      const problems = [
        ...validateCourse(next, db.courses, db.coursePartitions, id),
        // 维度引用（v28）：挂错学科 / 模块会让"这门课属于哪"两说，必须在写之前拦住
        ...courseDimensionProblems(next, db.catalog),
      ];
      if (problems.length > 0) throw new Error(problems.join("；"));

      Object.assign(target, next);
      // next 是从 target 展开来的，version 还是旧值；写入成功之后才推一格
      bumpVersion(target);
      syncPricingWithCourses(db);
      writeLog(db, {
        entity: "课程",
        action: "修改",
        targetId: id,
        summary: `修改课程「${target.name}」（${Object.keys(patch).join("、")}）`,
      });
      persist(db);
      return clone(target);
    },

    /**
     * **把一批课移到某个分区**（课程库清单里的「移动」）。
     *
     * 为什么单独一个方法，而不是让界面循环调 `courses.update`：
     *   - 那会写 N 条日志（"移动 5 门课"变成 5 条互不相关的记录，事后看不出这是一次整理）；
     *   - 每门课都要带自己的 `expectedVersion`，界面得先把 N 门课的版本都读全 ——
     *     中间任何一门被改过，就会出现"移了一半"的状态。
     * 这里一次事务、一条日志、要么全成要么全不成。
     *
     * 返回真正移动了几门（已经在目标分区里的课不计入，也不写日志）。
     */
    async setPartition(ids: string[], partitionId: string): Promise<number> {
      await delay();
      const db = load();
      const target = partitionId.trim();
      if (target !== "" && !db.coursePartitions.some((item) => item.id === target)) {
        throw new Error("目标分区不存在（可能刚被删掉了）：请刷新页面重新选择。");
      }
      const wanted = new Set(ids);
      const moved: Course[] = [];
      for (const course of db.courses) {
        if (!wanted.has(course.id) || course.partitionId === target) continue;
        course.partitionId = target;
        bumpVersion(course);
        moved.push(course);
      }
      if (moved.length === 0) return 0;

      const where = partitionName(db.coursePartitions, target);
      writeLog(db, {
        entity: "课程",
        action: "移动分区",
        targetId: target,
        summary:
          `把 ${String(moved.length)} 门课移到「${where === "" ? "未归类" : where}」：` +
          moved.map((course) => course.name).join("、"),
      });
      persist(db);
      return moved.length;
    },

    /**
     * 删除课程。
     *
     * 网站来源的课程不让删（删了下次同步又会回来），改成「暂未开放」即可 ——
     * 理由写清楚，而不是给一个会自己复原的删除按钮。
     */
    async remove(id: string): Promise<boolean> {
      await delay();
      const db = load();
      const index = db.courses.findIndex((item) => item.id === id);
      if (index === -1) return false;

      const target = db.courses[index]!;
      const verdict = canRemoveCourse(target);
      if (!verdict.ok) throw new Error(verdict.reason);

      db.courses.splice(index, 1);
      syncPricingWithCourses(db);
      writeLog(db, {
        entity: "课程",
        action: "删除",
        targetId: id,
        summary: `删除课程「${target.name}」`,
      });
      persist(db);
      return true;
    },

    /** 科目候选：网站课程 + 后台新增（按内容顺序，后台的接在后面）。 */
    async options(): Promise<CourseOption[]> {
      await delay();
      const db = load();
      return clone(courseOptions(db.courses, db.coursePartitions));
    },

    /** 课程库统计（列表页顶部）。 */
    async summary(): Promise<CourseSummary> {
      await delay();
      const db = load();
      return clone(summarizeCourses(db.courses, db.coursePartitions));
    },
  },

  /*
   * ── 课程分区（栏目 → 子栏目）────────────────────────────────────────────
   *
   * 它是课程库里"结构那一半"：机构在这里建栏目、分子栏目、排序、改名，
   * 课程再挂到某一区上。网站课程页的栏目顺序直接读它（`publicSite()` → 构站快照）。
   *
   * 四条写方法各自只做一件事，为什么不合成一个 `save(wholeTree)`：
   * 分区是**小而碎的编辑**（改个名字、上移一位、新加一个子栏目），整份提交意味着
   * 每次改一个字都要把整棵树交上来 —— 两个人同时整理不同栏目时会互相覆盖，
   * 而这里根本不需要那种"整份表单"的保护（见 `types.ts` 版本号表里 `CoursePartition` 那一行）。
   */
  coursePartitions: {
    list: collection<CoursePartition>((db) => db.coursePartitions, "cp").list,

    /** 新建分区：一级（栏目）或二级（子栏目，传 `parentId`）。 */
    async create(input: { name: string; parentId?: string; order?: number }): Promise<CoursePartition> {
      await delay();
      const db = load();
      const parentId = (input.parentId ?? "").trim();
      const problems = validatePartition({ name: input.name, parentId }, db.coursePartitions);
      if (problems.length > 0) throw new Error(problems.join("；"));

      const siblings = db.coursePartitions.filter((item) => item.parentId === parentId);
      const created: CoursePartition = {
        id: nextId("cp"),
        name: input.name.trim(),
        parentId,
        // 不传顺序就排在同级最后：新建的分区跑不到最前面（那会让人以为自己把顺序弄乱了）
        order:
          Number.isFinite(Number(input.order)) && input.order !== undefined
            ? Number(input.order)
            : siblings.reduce((max, item) => Math.max(max, item.order), 0) + 1,
      };
      db.coursePartitions.push(created);
      writeLog(db, {
        entity: "课程分区",
        action: "新建",
        targetId: created.id,
        summary:
          `新建${parentId === "" ? "栏目" : "子栏目"}「${created.name}」` +
          (parentId === "" ? "" : `（挂在「${partitionName(db.coursePartitions, parentId)}」下）`),
      });
      persist(db);
      return clone(created);
    },

    /**
     * 改分区（名字 / 上级 / 顺序）。
     *
     * 改名的效果是"一处改、处处变"：课程引用的是 id，因此课程行的 `partitionId` 一个字都不用动
     * —— 这正是这一版把分区做成数据的目的（v17 及以前改名要逐门课改）。
     */
    async update(
      id: string,
      patch: Partial<Pick<CoursePartition, "name" | "parentId" | "order">>,
    ): Promise<CoursePartition | null> {
      await delay();
      const db = load();
      const target = db.coursePartitions.find((item) => item.id === id);
      if (target === undefined) return null;

      const name = patch.name === undefined ? target.name : patch.name.trim();
      const parentId = patch.parentId === undefined ? target.parentId : patch.parentId.trim();
      const problems = validatePartition({ name, parentId }, db.coursePartitions, id);
      if (problems.length > 0) throw new Error(problems.join("；"));

      const before = target.name;
      const beforeParent = target.parentId;
      target.name = name;
      target.parentId = parentId;
      if (patch.order !== undefined && Number.isFinite(Number(patch.order))) {
        target.order = Number(patch.order);
      }
      const changes: string[] = [];
      if (before !== name) changes.push(`名字 ${before} → ${name}`);
      if (beforeParent !== parentId) {
        changes.push(
          `上级 ${beforeParent === "" ? "（无，一级栏目）" : partitionName(db.coursePartitions, beforeParent)}` +
            ` → ${parentId === "" ? "（无，一级栏目）" : partitionName(db.coursePartitions, parentId)}`,
        );
      }
      writeLog(db, {
        entity: "课程分区",
        action: "修改",
        targetId: id,
        summary: `修改分区「${name}」${changes.length === 0 ? "（顺序）" : `（${changes.join("；")}）`}`,
      });
      persist(db);
      return clone(target);
    },

    /**
     * 同级重排：把这一组的 id 按给定顺序重新编号。
     *
     * 为什么不提供 `moveUp` / `moveDown` 两个方法：它们在两次点击之间被别人插了一条时
     * 会移错位置，而且各自要算一遍边界。整份交顺序只有一个语义，界面点 ↑↓ 时
     * 把交换后的整组顺序交上来即可。
     */
    async reorder(ids: string[]): Promise<CoursePartition[]> {
      await delay();
      const db = load();
      const known = ids.filter((id) => db.coursePartitions.some((item) => item.id === id));
      if (known.length === 0) return clone(db.coursePartitions);
      db.coursePartitions = applyPartitionOrder(db.coursePartitions, known);
      writeLog(db, {
        entity: "课程分区",
        action: "排序",
        targetId: "",
        summary: `调整分区顺序：${known.map((id) => partitionName(db.coursePartitions, id)).join(" → ")}`,
      });
      persist(db);
      return clone(db.coursePartitions);
    },

    /**
     * 删除分区（**有课 / 有子栏目就拒绝**，理由由 `partitionDeleteRefusal` 给出）。
     *
     * 与学员、课程同一条口径：删掉一个有课的分区不会报错，只会让那些课静默变成
     * 「分区已失效」—— 那比"删不掉"糟糕得多，因为它看起来像是数据自己坏了。
     */
    async remove(id: string): Promise<boolean> {
      await delay();
      const db = load();
      const index = db.coursePartitions.findIndex((item) => item.id === id);
      if (index === -1) return false;

      const refusal = partitionDeleteRefusal(
        db.coursePartitions,
        (partitionId) => db.courses.filter((course) => course.partitionId === partitionId).length,
        id,
      );
      if (refusal !== "") throw new Error(refusal);

      const [removed] = db.coursePartitions.splice(index, 1);
      writeLog(db, {
        entity: "课程分区",
        action: "删除",
        targetId: id,
        summary: `删除分区「${removed?.name ?? ""}」`,
      });
      persist(db);
      return true;
    },

  },

  /*
   * 教师与教室走**带乐观锁**的集合：两边的表单都是"读出来 → 人改 → 整份提交"，
   * 教师表单一次交上来十来个字段（资料 / 网站展示 / 顺序 / 可带科目…），
   * 教室表单连**可用时段**一起交上来 —— 而可用时段直接决定排课冲突判定，
   * 被别人静默盖掉就会出现"排了节不该排的课，却没人知道为什么"。
   */
  teachers: {
    ...versionedCollection<Teacher>((db) => db.teachers, "t", "教师", teacherDeleteRefusal),
    /**
     * 在职**教师**，排课下拉用。
     *
     * 刻意排除 `kind === "AI"`：AI 智能体（采苓等）是辅助工具，不授课 ——
     * 混进排课下拉会让人排出一节"由 AI 上"的课，那不是机构的经营方式。
     * 它们仍然留在教师档案里（机构要能看到这些工具在服务学生）。
     */
    async listActive(): Promise<Teacher[]> {
      await delay();
      return clone(
        load().teachers.filter((teacher) => teacher.active && teacher.kind !== "AI"),
      );
    },
  },

  classrooms: versionedCollection<Classroom>((db) => db.classrooms, "c", "教室", classroomDeleteRefusal),

  /**
   * 收款流水（钱的账本）：**只读 + 一条正规入口 `record`**。
   *
   * ## 为什么这里刻意不用通用集合（这是审计抓出来的一个真洞）
   *
   * 早先这里是 `...collection<Payment>((db) => db.payments, "pay")` —— 通用集合一次给出
   * `create` / `update` / `remove` 三个写方法，而它们：
   *
   *   1. **不写操作日志**（那个集合建的时候没给"日志标签"，而 `collection` 的约定是
   *      "标签为空串就不记日志"）—— 钱的动向一条都不留痕；
   *   2. **绕过金额不变式**：`recordPayment` 会同步改报课记录的"实收累计"，
   *      而通用集合的 `create` 只是把对象塞进数组。实测：塞一笔 ¥7000 之后
   *      收费页显示本月收入 ¥1,001,499，而那条报课的实收还停在 ¥1500 ——
   *      自检守着的那条「实收 = 收款 − 退款」当场不成立；
   *   3. 页面里**一处都没调用**（它们是工厂白送的），却对 `POST /api/call` 开放，
   *      技术/财务/招生三个角色都能调。
   *
   * 所以这里把读方法显式列出来，写入口只保留 `record`（它走 `recordPayment`
   * 同步实收、并且现在会写日志）。"少一条路 = 少一处不一致"。
   */
  payments: {
    async list(): Promise<Payment[]> {
      await delay();
      return clone(load().payments);
    },
    listByStudent: async (studentId: string): Promise<Payment[]> => {
      await delay();
      return clone(
        load()
          .payments.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.at.localeCompare(a.at)),
      );
    },
    listByEnrollment: async (enrollmentId: string): Promise<Payment[]> => {
      await delay();
      return clone(
        load()
          .payments.filter((item) => item.enrollmentId === enrollmentId)
          .sort((a, b) => b.at.localeCompare(a.at)),
      );
    },
    /** 单独补记一笔收款 / 退款（分期付款、补款、无课时的费用）。 */
    async record(input: {
      studentId: string;
      enrollmentId: string;
      amount: number;
      kind: Payment["kind"];
      method: PaymentMethod;
      note: string;
    }): Promise<Payment | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === input.studentId);
      if (student === undefined) return null;

      const created = recordPayment(db, {
        ...input,
        amount: round2(Math.max(0, input.amount)),
        at: nowIso(),
      });
      // 收款会改报课记录的"实收累计"，因此这条学生记录也被写过（见 touchStudent 的说明）
      touchStudent(db, student.id);
      /*
       * **钱必须留痕**（审计抓到的另一处）：`recordPayment` 只写收款表、不写操作日志，
       * 于是"谁在什么时候给谁记了多少钱"在日志里查不到，而 README 一直宣称
       * "收款/退款…每次改动留操作日志"。金额写进摘要 —— 只说"记了一笔收款"等于没说。
       */
      writeLog(db, {
        entity: "收款",
        action: created.kind === "退款" ? "退款" : "收款",
        targetId: created.id,
        summary: `${student.name} ${created.kind} ¥${created.amount}（${created.method}）${created.note === "" ? "" : ` · ${created.note}`}`,
      });
      persist(db);
      return clone(created);
    },
  },

  /**
   * 财务汇总：某个月的收款、退款、净收入、按支付方式，以及全部欠费。
   *
   * 欠费不分月份 —— 它是一笔「还没收到的钱」，跨月存在，
   * 按月切分反而会让 1 月欠的费在 2 月的报表里消失。
   */
  async finance(anchor: Date = new Date()): Promise<{
    month: string;
    summary: PaymentSummary;
    recent: Payment[];
    outstanding: Array<{ student: Student; enrollment: Enrollment; amount: number }>;
    outstandingTotal: number;
  }> {
    await delay();
    const db = load();
    const { from, to, label } = monthRange(anchor);
    const monthPayments = db.payments.filter((item) => withinRange(item.at, from, to));

    const outstanding = db.students.flatMap((student) =>
      student.enrollments
        .filter((enrollment) => enrollment.status === "在读")
        .map((enrollment) => ({ student, enrollment, amount: outstandingAmount(enrollment) }))
        .filter((item) => item.amount > 0),
    );

    return clone({
      month: label,
      summary: summarizePayments(monthPayments),
      recent: [...monthPayments].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      outstanding: outstanding.sort((a, b) => b.amount - a.amount),
      outstandingTotal: round2(outstanding.reduce((sum, item) => sum + item.amount, 0)),
    });
  },

  /**
   * 经营统计（教室利用率 / 教师课时 / 退课与流失）。
   *
   * 服务层只负责把数据与区间凑齐，算法在 lib/backend/stats.ts ——
   * 将来服务端实现时可以整体搬走，页面不用改。
   */
  async stats(anchor: Date = new Date()): Promise<{
    from: string;
    to: string;
    days: string[];
    rooms: RoomUtilization[];
    hourly: Array<{ hour: number; count: number; minutes: number }>;
    teachers: TeacherWorkload[];
    churn: ChurnStats;
    summary: ReturnType<typeof rangeSummary>;
  }> {
    const view = captureView();
    await delay();
    const db = load();
    const days = weekDays(anchor);
    const from = days[0] ?? anchor;
    const to = days[6] ?? anchor;
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);

    /*
     * 教师看统计时**只算自己的课**（口径与今日概览一致）：
     *   - `weekLessons` 先按范围收窄 → 教室利用率 / 时段分布 / 汇总都只反映我的课表；
     *   - 教师课时只算**我这一位**（传进去的教师名单收窄成我自己）——
     *     否则这一页会变成"全校老师的课时我都看得到"；
     *   - 退课与流失只算我的学生。
     *
     * 副作用要说清：教师看到的"教室利用率"会明显偏低（因为分母是整周的教室可用时段，
     * 分子只有我的课）。这不是 bug，是"只算我的课"这条口径的直接结果 ——
     * 机构要的口径就是"教师看自己的"。
     */
    const churn = churnStats(scopeStudents(view, db, db.students));
    const visibleLessons = scopeLessons(view, db.lessons);
    const weekLessons = visibleLessons.filter((lesson) => withinRange(lesson.startsAt, from, toEnd));
    const visibleTeachers =
      view.kind === "all" ? db.teachers : db.teachers.filter((teacher) => teacher.id === view.teacherId);

    return clone({
      from: from.toISOString(),
      to: toEnd.toISOString(),
      days: days.map((day) => dateKey(day)),
      rooms: roomUtilization(db.classrooms, weekLessons, days),
      hourly: hourlyLoad(weekLessons),
      teachers: teacherWorkload(visibleTeachers, weekLessons),
      /*
       * 退课金额（`refundedAmount`）是**钱**：教师的范围里不含金额，
       * 因此这一项与 `hideStudentMoney` 同一个口径 —— 置 0，而不是让它泄漏出去。
       */
      churn: view.kind === "all" ? churn : { ...churn, refundedAmount: 0 },
      summary: rangeSummary(weekLessons, from, toEnd),
    });
  },

  /**
   * 待跟进清单。
   *
   * 服务层只负责「把数据凑齐交给规则引擎」，规则本身在 lib/backend/followup.ts。
   * 这样将来服务端实现时可以整体搬到后端，页面不用改。
   */
  async followups(now: Date = new Date()): Promise<FollowUpItem[]> {
    await delay();
    const db = load();
    return clone(
      buildFollowUps({
        students: db.students,
        lessons: db.lessons,
        assessments: db.assessments,
        homeworks: db.homeworkRecords,
        lessonRecords: db.lessonRecords,
        now,
      }),
    );
  },


  /**
   * 课时流水（只读；写入由报课 / 续费 / 上课 / 撤销等业务动作负责）。
   *
   * 普通教师**只能查自己学生**的流水（机构确认③：家长问"还剩几节课"时，
   * 教师要看得到这个学生的课时是怎么来的）；别人的学生一律给空数组 ——
   * 空数组与"这个学生没有流水"是同一个样子，"看不到"不需要单独一种错误。
   * 流水里没有金额字段（`LessonTransaction` 只有节数与科目），因此不需要剥。
   */
  transactions: {
    listByStudent: async (studentId: string): Promise<LessonTransaction[]> => {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeStudent(view, db, studentId)) return [];
      return clone(
        db.transactions
          .filter((item) => item.studentId === studentId)
          .sort((a, b) => b.at.localeCompare(a.at)),
      );
    },
    listByEnrollment: async (enrollmentId: string): Promise<LessonTransaction[]> => {
      const view = captureView();
      await delay();
      const db = load();
      /*
       * 按"这条报课记录属于哪个学生"来判范围，而不是按 `enrollmentId` 本身：
       * 报课记录是学生档案里的数组元素（没有独立的学生字段），
       * 用 id 反查学生是唯一可靠的办法 —— 而查不到的都当作看不到。
       */
      const owner = db.students.find((student) =>
        student.enrollments.some((enrollment) => enrollment.id === enrollmentId),
      );
      if (owner === undefined || !canSeeStudent(view, db, owner.id)) return [];
      return clone(
        db.transactions
          .filter((item) => item.enrollmentId === enrollmentId)
          .sort((a, b) => b.at.localeCompare(a.at)),
      );
    },
  },

  /**
   * 课堂记录。
   *
   * 保存用 upsert 而不是 create：一节课一个学生只有一条记录，
   * 老师改完再保存不应该多出一条（这是最容易被写成「每次保存都新增」的地方）。
   */
  /**
   * 课堂记录（出勤 / 专注 / 互动）：**只读 + 一条正规入口 `save`**。
   *
   * ## 为什么删掉通用写方法（审计抓出来的一条"账对不上"）
   *
   * 早先这里是 `...collection<LessonRecord>((db) => db.lessonRecords, "lr")` ——
   * 工厂一次给出 `create` / `update` / `remove`，而它们：
   *
   *   1. 建集合时**没给日志标签** → 删除课堂记录**不留痕**（谁删的、为什么删，查不到）；
   *   2. **不重算课时**：`save` 会走 `reconcileCharge`（按出勤事实对账、该扣的扣、该退的退），
   *      而 `remove` 只是把记录抹掉 —— 课时仍然扣着，而下次对账会把"没有记录"当成**到课**，
   *      于是这节已经扣过的课在数据上变成"没有任何依据的一笔扣减"。
   *
   * 而且页面里一处都没调用过它们（界面上的出勤纠错走的是重新 `save`）。
   * 因此删掉三个写方法，只留 `save`：**纠错是改记录，不是删记录**。
   */
  lessonRecords: {
    /** 课堂记录列表：教师只看得到**自己课**上的记录。 */
    async list(): Promise<LessonRecord[]> {
      const view = captureView();
      await delay();
      const db = load();
      return clone(scopeLessonRecords(view, db, db.lessonRecords));
    },

    listByLesson: async (lessonId: string): Promise<LessonRecord[]> => {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeLessonId(view, db, lessonId)) return [];
      return clone(db.lessonRecords.filter((item) => item.lessonId === lessonId));
    },
    listByStudent: async (studentId: string): Promise<LessonRecord[]> => {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeStudent(view, db, studentId)) return [];
      return clone(
        db.lessonRecords
          .filter((item) => item.studentId === studentId)
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      );
    },
    /**
     * 按「课节 + 学生」写入；已存在则更新。
     *
     * 普通教师只能记录**自己课**上的出勤（机构确认的教学动作之一）。
     * 越界时不写、直接报错：课堂记录会**改课时账**（出勤变了课时跟着退 / 补），
     * 让它"静默成功"是最坏的结果 —— 老师会以为记上了，而账在别人那边。
     */
    async save(input: NewLessonRecord): Promise<LessonRecord> {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeLessonId(view, db, input.lessonId)) {
        throw outOfScopeError("这节课（或它上面的学生）");
      }
      /*
       * 名单里的学生也要在自己的范围里。已取消的课不算"我的课"（口径见 roles.ts ③），
       * 因此不能借"这节课挂在我名下"给范围外的学生写记录 —— 两处都判，方向是关门。
       */
      if (!canSeeStudent(view, db, input.studentId)) {
        throw outOfScopeError("这位学生");
      }
      const existing = db.lessonRecords.find(
        (item) => item.lessonId === input.lessonId && item.studentId === input.studentId,
      );

      if (existing !== undefined) {
        Object.assign(existing, input, { recordedAt: nowIso() });
      } else {
        db.lessonRecords.push({ ...input, id: nextId("lr"), recordedAt: nowIso() });
      }

      /*
       * 出勤一改，课时就要跟着变：先标「到课」扣了课时、后来发现是提前请假，
       * 这里会自动把课时退回去；反过来（改成旷课）会自动补扣。
       * 已上的课才需要处理 —— 没上完的课本来就没扣过。
       */
      const lesson = db.lessons.find((item) => item.id === input.lessonId);
      if (lesson !== undefined && lesson.status === "已上") {
        reconcileCharge(db, lesson, input.studentId);
        /*
         * 出勤改动会连着改课时账（上面那一步），因此这条学生记录也被写过。
         * 这里**不去看** reconcileCharge 的结果就一律推一格：它的返回值只说明
         * "这次扣没扣"，而我们要回答的是"这条记录变没变"—— 用调用方的判断去决定要不要推，
         * 漏一处就是一类静默失效（正是这次要修的问题）。多推一格的代价仅仅是
         * "别人手上那份学生档案显示过期"，而那本来就该让人刷新。
         */
        touchStudent(db, input.studentId);
      }

      writeLog(db, {
        entity: "排课",
        action: "课堂记录",
        targetId: input.lessonId,
        summary: `记录课堂表现：${input.attendance}${input.leaveRequestedAt !== "" ? "（含请假时间）" : ""}`,
      });
      persist(db);
      const saved = db.lessonRecords.find(
        (item) => item.lessonId === input.lessonId && item.studentId === input.studentId,
      )!;
      return clone(saved);
    },
  },

  /**
   * 作业记录（按次）。
   *
   * 普通教师只看得到自己学生的（作业是"某个学生的一次提交"，范围跟着学生走）。
   */
  homework: {
    /*
     * **只留真正被调用的那几个**（2026-09 审计后收的）。
     *
     * 作业记录原先用 `...collection(...)` 一次铺开五个方法，其中
     * `homework.list` / `homework.get` / `homework.update` 全仓库**一处都没调用**
     * （页面用 `listByStudent` 看一个人的、`create` 记一次、`remove` 删一条）——
     * 而死方法不是"没成本"：它们同样是接口面（可被 `/api/call` 调到），
     * 也让人误以为"作业记录还有别的地方在改"。
     * 这里改成从工厂里**只取需要的**（不重复实现）。
     */
    create: collection<HomeworkRecord>((db) => db.homeworkRecords, "hw", "作业记录").create,
    remove: collection<HomeworkRecord>((db) => db.homeworkRecords, "hw", "作业记录").remove,

    listByStudent: async (studentId: string): Promise<HomeworkRecord[]> => {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeStudent(view, db, studentId)) return [];
      return clone(
        db.homeworkRecords
          .filter((item) => item.studentId === studentId)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    },
  },

  /**
   * 阶段测评。
   *
   * create 时自动带出同科目上一次的分数作为 previousScore ——
   * 「趋势」是这条记录的核心信息，让页面自己去找上一条容易算错，
   * 也让「补录旧数据」时前后顺序对不上。
   */
  assessments: {
    /* 同上：只留被调用的（`add` 记一次测评、`remove` 删一条、`listByStudent` 看一个人的）。 */
    remove: collection<Assessment>((db) => db.assessments, "as", "测评").remove,

    listByStudent: async (studentId: string): Promise<Assessment[]> => {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeStudent(view, db, studentId)) return [];
      return clone(
        db.assessments
          .filter((item) => item.studentId === studentId)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    },
    /**
     * 记一次阶段测评（教师的核心教学动作之一）。
     *
     * 越界报错而不是静默成功：测评会带出"上一次分数"（`previousScore`），
     * 给别人的学生记一条，等于把别人的教学记录也改了。
     */
    async add(input: NewAssessment): Promise<Assessment> {
      const view = captureView();
      await delay();
      const db = load();
      if (!canSeeStudent(view, db, input.studentId)) {
        throw outOfScopeError("这位学生");
      }
      const previous = db.assessments
        .filter((item) => item.studentId === input.studentId && item.subject === input.subject)
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1);

      const created: Assessment = {
        ...input,
        id: nextId("as"),
        previousScore: previous?.score ?? null,
      };
      db.assessments.push(created);
      /*
       * 教学记录也要留痕（审计抓到的一处）：早先新增一条测评不写操作日志，
       * 而"谁在什么时候给学生记了一次测评"是家长会追问的事。
       */
      writeLog(db, {
        entity: "阶段测评",
        action: "新增",
        targetId: created.id,
        summary:
          `${db.students.find((item) => item.id === created.studentId)?.name ?? created.studentId} 的` +
          `「${created.subject}」测评 ${created.score} 分（${created.date}）`,
      });
      persist(db);
      return clone(created);
    },
  },

  lessons: {
    /*
     * 通用增删改（list / get / update / remove / create）先铺开，
     * 然后**覆盖 create**：排课必须过"课时够不够"这一关。
     */
    ...lessonCollection,

    /** 排课列表：普通教师只看到**自己带的课**（`lessons.list` 是全站课表，最需要收口的一个）。 */
    async list(): Promise<Lesson[]> {
      const view = captureView();
      await delay();
      return clone(scopeLessons(view, load().lessons));
    },

    /** 单节课：不是自己的课就当作不存在（返回 `null`，不报错；口径见 roles.ts）。 */
    async get(id: string): Promise<Lesson | null> {
      const view = captureView();
      await delay();
      const lesson = load().lessons.find((item) => item.id === id);
      if (lesson === undefined) return null;
      return canSeeLesson(view, lesson) ? clone(lesson) : null;
    },

    /**
     * 新建排课（**服务端复核课时**）。
     *
     * 机构的规则是「**课时不够就不排课**」—— 宁可少排一节，也不要欠账
     * （欠着的课时事后很难收回来）。因此在落库前先算一遍：这几位学生在这门科目上
     * 还剩几节可用（剩余课时 − 已排未上），不够就**明确拒绝并说清是谁不够**。
     *
     * 为什么不只在界面上拦：页面拦是体验，服务端拦才是保证 ——
     * 直接调接口、或将来有第二个入口时，界面那道门形同虚设。
     */
    async create(input: NewLesson): Promise<Lesson> {
      await delay();
      const db = load();
      const shortage = insufficientLessons(db, {
        subject: input.subject,
        studentIds: input.studentIds,
        count: 1,
      });
      if (shortage !== null) throw new Error(shortage.message);
      return lessonCollection.create(input);
    },

    /**
     * 更新课节。
     *
     * 这里多了一层业务规则：**状态从「已上」改成别的（回到已排 / 已取消）时，
     * 要按流水把课时退回去**。之前只改状态不退课时 —— 老师点错「标记已上」
     * 就白扣一节，而且没有痕迹可查。
     *
     * 退课时撤销的是「这节课对应的那些上课流水」（reversedAt 打上时间），
     * 而不是简单地把 usedLessons 减 1：一张报课记录可能被这节课扣过不止一次
     * （同一节课被反复标记的边界情形），按流水撤销才不会多退少退。
     *
     * `expectedVersion`（v17）：排课表单整份覆盖时间 / 教师 / 教室 / 学生，
     * 而"这节课排给谁、什么时候"是最不能被人静默改掉的东西 —— 后提交的会被拒绝。
     */
    async update(
      id: string,
      patch: Partial<Omit<Lesson, "id" | "version">>,
      options: WriteOptions = {},
    ): Promise<Lesson | null> {
      await delay();
      const db = load();
      const lesson = db.lessons.find((item) => item.id === id);
      if (lesson === undefined) return null;

      assertVersion(lesson, options.expectedVersion, `排课「${lesson.subject}」`);

      const wasCompleted = lesson.status === "已上";
      const becomesNotCompleted =
        patch.status !== undefined && patch.status !== "已上";

      /*
       * **改课也要过课时这一关**（不只是新建）。
       *
       * 不然「课时不足就不排课」有个现成的后门：新建被拦，就把旧课改成想排的
       * 科目/学生/状态 —— 一样是排了一节课，一样是欠账。这里按**改完之后的样子**
       * 复核（`{ ...lesson, ...patch }`），并把自己排除（见 `excludeLessonId`）。
       *
       * 只在改动**碰到课时三要素**（科目 / 学生 / 状态）时才查：纯粹改备注或改时间
       * 不该被拒 —— 否则历史遗留的欠账课连备注都改不了，那是拿规则为难人。
       */
      const touchesCredits =
        patch.subject !== undefined || patch.studentIds !== undefined || patch.status !== undefined;
      if (touchesCredits) {
        const after = { ...lesson, ...patch };
        if (after.status === "已排") {
          const shortage = insufficientLessons(db, {
            subject: after.subject,
            studentIds: after.studentIds,
            count: 1,
            excludeLessonId: id,
          });
          if (shortage !== null) throw new Error(shortage.message);
        }
      }

      /*
       * `{ version: currentVersion }`：patch 里若夹带了 version（运行时不看类型）就用记录
       * 自己的值盖回去 —— 否则"客户端可以自己定版本号"，乐观锁就成了摆设。
       */
      const currentVersion = lesson.version;
      Object.assign(lesson, patch, { version: currentVersion });
      // 改课就是一次写入：推进这条课节的版本（别人手上那份排课表单要过期）
      bumpVersion(lesson);

      if (wasCompleted && becomesNotCompleted) {
        /*
         * 撤销「已上」会把课时退回去 —— 这一步改的是**学生**那条记录的课时账，
         * 因此顺手把那些学生的版本也推进一格（与 markCompleted 同一个道理）。
         */
        const refunded = new Set<string>();
        for (const transaction of db.transactions) {
          if (
            transaction.lessonId !== id ||
            transaction.kind !== "上课" ||
            transaction.reversedAt !== ""
          ) {
            continue;
          }
          transaction.reversedAt = nowIso();
          const enrollment = db.students
            .flatMap((student) => student.enrollments)
            .find((item) => item.id === transaction.enrollmentId);
          if (enrollment !== undefined) {
            enrollment.usedLessons = Math.max(0, enrollment.usedLessons - 1);
            refunded.add(transaction.studentId);
          }
        }
        for (const studentId of refunded) touchStudent(db, studentId);
      }

      /*
       * 这个方法是**自定义覆盖**了通用集合的 update（为了处理课时撤销），
       * 因此不会自动记日志 —— 必须自己写，否则「把别人的课挪走」这种
       * 影响他人的改动会不留痕迹（自检里有一条断言专门盯着这点）。
       */
      writeLog(db, {
        entity: "排课",
        action: "修改",
        targetId: id,
        summary: `修改排课「${lesson.subject}」（${Object.keys(patch).join("、")}）`,
      });

      persist(db);
      return clone(lesson);
    },

    /**
     * 冲突检查：同一教师 / 同一教室 / 同一学生在时间上重叠。
     *
     * 刻意做成**独立查询**而不是塞进 create：页面需要在保存前就能提示
     * 「和哪节课冲突」，而不是提交后才被拒绝。注意真实服务端也必须
     * 再校验一次 —— 客户端检查只是体验，不是保证。
     */
    async findConflicts(input: LessonInput): Promise<ConflictReport> {
      await delay();
      return clone(conflictsFor(load(), input));
    },

    /**
     * **按周批量排课 · 预检**（只算不写）。
     *
     * 返回将要生成的每一节（日期时间 + 该节的冲突情况），以及"建议排几节"的依据：
     * 建议节数 = 该科目**剩余课时 − 已排未上**（多人班课取剩余最少的那位）。
     *
     * 与 `createSeries` 共用同一套冲突判定（`conflictsFor`），因此预览说能排的，
     * 写的时候就能排 —— 两份判定各写一遍的话，迟早会出现"预览说行、写入说不行"。
     *
     * 刻意与写入分成两个方法（而不是一个 `dryRun` 开关）：一个叫 create 的方法
     * 不该在没说明的情况下不写入 —— 这条教训在批量导入里吃过一次。
     */
    async planSeries(input: SeriesInput): Promise<SeriesPlan> {
      await delay();
      return clone(planSeries(load(), input));
    },

    /**
     * **按周批量排课 · 写入**。
     *
     * 逐节建课：**无冲突的才建，有冲突的跳过并逐条说明**。不提供"强行排"——
     * 把课塞进已被占用的时间，事后要一节节去查；宁可少排一节并说清楚原因。
     *
     * 一次落盘、只写一条日志（与批量导入同一纪律：日志上限 500 条，逐节写会冲掉历史）。
     */
    async createSeries(input: SeriesInput): Promise<SeriesOutcome> {
      await delay();
      const db = load();
      const plan = planSeries(db, input);

      const created: Lesson[] = [];
      const skipped: Array<{ startsAt: string; dayLabel: string; reason: string }> = [];

      for (const item of plan.items) {
        if (!item.ok) {
          skipped.push({ startsAt: item.startsAt, dayLabel: item.dayLabel, reason: item.reason });
          continue;
        }
        const lesson: Lesson = {
          id: nextId("l"),
          version: 1,
          subject: input.subject,
          form: input.form,
          teacherId: input.teacherId,
          classroomId: input.classroomId,
          studentIds: [...input.studentIds],
          startsAt: item.startsAt,
          durationMinutes: input.durationMinutes,
          status: input.status,
          note: input.note,
          makeupForLessonId: "",
        };
        db.lessons.push(lesson);
        created.push(lesson);
      }

      if (created.length > 0) {
        writeLog(db, {
          entity: "排课",
          action: "批量排课",
          targetId: "",
          summary:
            `批量排课「${input.subject}」新增 ${created.length} 节` +
            (skipped.length > 0 ? `（跳过 ${skipped.length} 节：与已有安排冲突）` : ""),
        });
        persist(db);
      }

      return clone({
        created: created.length,
        skipped,
        first: created[0]?.startsAt ?? "",
        last: created[created.length - 1]?.startsAt ?? "",
        plan,
      });
    },

    /**
     * 标记为「已上」并按课时扣减。
     *
     * 幂等：已经是「已上」的课再点一次不会重复扣课时 —— 这是最容易出错的地方，
     * 自检里专门有一条断言守住它。
     */
    async markCompleted(id: string): Promise<CompletionResult> {
      const view = captureView();
      await delay();
      const db = load();
      const lesson = db.lessons.find((item) => item.id === id);
      if (lesson === undefined) {
        return { lesson: null, deducted: [], skipped: [], alreadyCompleted: false, overused: [] };
      }
      /*
       * 范围外的课：**返回与"这节课不存在"完全一样的形状**（`lesson: null` + 空结果）。
       *
       * 这里的取舍值得写清楚：标记已上会**扣课时**，所以绝不能放它过去；
       * 但也**不能报错**（报错就是在回答"这节课存在，只是不归你"）。返回"空结果"
       * 既没扣任何课时，也没告诉对方任何新信息 —— 对调用方来说它跟"id 写错了"没有区别。
       */
      if (!canSeeLesson(view, lesson)) {
        return { lesson: null, deducted: [], skipped: [], alreadyCompleted: false, overused: [] };
      }

      const alreadyCompleted = lesson.status === "已上";
      const deducted: CompletionResult["deducted"] = [];
      const skipped: CompletionResult["skipped"] = [];
      // 兜底上报：扣完之后若"已用 > 购买"，必须说出来（排课时已拦一道，这里是第二道）
      const overused: CompletionResult["overused"] = [];

      if (!alreadyCompleted) {
        lesson.status = "已上";

        for (const studentId of lesson.studentIds) {
          const student = db.students.find((item) => item.id === studentId);
          if (student === undefined) {
            skipped.push({ studentId, reason: "学生档案不存在" });
            continue;
          }

          /*
           * 扣不扣课时按**出勤**决定（提前 24 小时请假不扣，见 attendance.ts），
           * 并且走对账逻辑而不是直接 -1：老师先填了出勤再标记已上、
           * 或先标记已上再改出勤，两种顺序都要落到同一个结果。
           */
          const outcome = reconcileCharge(db, lesson, studentId);
          if (!outcome.charged) {
            skipped.push({ studentId, reason: outcome.reason });
            continue;
          }

          const enrollment = enrollmentForLesson(student.enrollments, lesson.subject);
          if (enrollment === null) {
            skipped.push({
              studentId,
              reason: `没有「${lesson.subject}」的在读报课记录，未扣课时`,
            });
            continue;
          }

          deducted.push({
            studentId,
            subject: enrollment.subject,
            remainingLessons: remainingOf(enrollment),
          });
          if (enrollment.usedLessons > enrollment.totalLessons) {
            overused.push({
              studentId,
              name: student.name,
              subject: enrollment.subject,
              over: enrollment.usedLessons - enrollment.totalLessons,
            });
          }
        }

        persist(db);
      }

      if (!alreadyCompleted) {
        /*
         * 「标记已上」也是一次写入：课节的状态被改了、学生的课时账也被改了。
         * 两边的版本号都要推进 —— 否则"老师刚标了已上、另一个人那边的排课表单
         * 还开着旧的版本"，那个人一保存就会把这节课悄悄改回"已排"，课时也跟着退回来。
         *
         * 只在**真的写了**（`!alreadyCompleted`）时推：重复点"标记已上"是幂等的、
         * 什么都没改写，推版本会让别人白白看到一次冲突。
         */
        bumpVersion(lesson);
        for (const item of deducted) touchStudent(db, item.studentId);

        writeLog(db, {
          entity: "排课",
          action: "标记已上",
          targetId: lesson.id,
          summary: `标记已上：${lesson.subject}（扣 ${deducted.length} 人，跳过 ${skipped.length} 人）`,
        });
        persist(db);
      }

      return clone({ lesson, deducted, skipped, alreadyCompleted, overused });
    },
    /** 某一天的课，按开始时间升序（普通教师只看到自己那几节）。 */
    async listByDate(date: Date): Promise<Lesson[]> {
      const view = captureView();
      await delay();
      const key = dateKey(date);
      return clone(
        scopeLessons(view, load().lessons)
          .filter((lesson) => dateKey(lesson.startsAt) === key)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /**
     * 安排补课：以「被补的那节课」为模板建一节新课。
     *
     * 补课是一节**真实占用教师与教室**的课，因此：
     * - 走同一套冲突检查（由表单在保存前调用 findConflicts）；
     * - 标记已上时按正常规则扣 1 节 —— 提前请假的课没扣，补课时扣，
     *   两次加起来恰好等于正常上一节课（口径见 lib/backend/attendance.ts）。
     */
    async createMakeup(input: {
      originalLessonId: string;
      startsAt: string;
      durationMinutes: number;
      teacherId: string;
      classroomId: string;
      studentIds: string[];
      note: string;
    }): Promise<Lesson | null> {
      const view = captureView();
      await delay();
      const db = load();
      const original = db.lessons.find((item) => item.id === input.originalLessonId);
      if (original === undefined) return null;
      /*
       * 补课以"被补的那节课"为模板（科目 / 学生 / 默认教师都跟着它走），
       * 因此普通教师只能给**自己的课**安排补课；不在自己名下 → `null`（与"原课不存在"同形）。
       *
       * 另外还要逐个确认补课名单里的学生都是自己的（表单允许改名单）——
       * 少了这一条，教师就能借"补课"把别人的学生排进自己的课表。
       */
      if (!canSeeLesson(view, original)) return null;
      const makeupStudents = input.studentIds.length > 0 ? input.studentIds : original.studentIds;
      for (const studentId of makeupStudents) {
        if (!canSeeStudent(view, db, studentId)) return null;
      }

      /*
       * 补课同样占用教师与教室、同样扣 1 节课时 —— 因此也过"课时够不够"这一关：
       * 课时不足时先续费，再排补课（否则补课本身又变成一笔欠账）。
       */
      const shortage = insufficientLessons(db, {
        subject: original.subject,
        studentIds: makeupStudents,
        count: 1,
      });
      if (shortage !== null) throw new Error(shortage.message);

      const created: Lesson = {
        id: nextId("l"),
        version: 1,
        subject: original.subject,
        form: original.form,
        teacherId: input.teacherId !== "" ? input.teacherId : original.teacherId,
        classroomId: input.classroomId !== "" ? input.classroomId : original.classroomId,
        studentIds: input.studentIds.length > 0 ? input.studentIds : original.studentIds,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes > 0 ? input.durationMinutes : original.durationMinutes,
        status: "已排",
        note: input.note.trim() === "" ? "补课" : input.note.trim(),
        makeupForLessonId: original.id,
      };

      db.lessons.push(created);
      // 排一节课不留痕说不过去：补课同样是"排了一节课"，而且它关联着原课
      writeLog(db, {
        entity: "排课",
        action: "补课",
        targetId: created.id,
        summary:
          `${created.subject} 补课 ${created.startsAt.slice(0, 16).replace("T", " ")}` +
          `（为 ${original.startsAt.slice(0, 10)} 那节）· ${makeupStudents.length} 名学生`,
      });
      persist(db);
      return clone(created);
    },

    /**
     * 待补课清单：缺了课、且还没安排补课的学生。
     *
     * 判据是「原课上有请假/旷课的记录」+「之后没有以这节课为原课的补课」。
     * 提前请假（没扣课时）同样要补 —— 学生事实上没上到这节课。
     */
    async pendingMakeups(): Promise<
      Array<{ original: Lesson; student: Student; record: LessonRecord; reason: string }>
    > {
      const view = captureView();
      await delay();
      const db = load();
      const rows: Array<{ original: Lesson; student: Student; record: LessonRecord; reason: string }> = [];

      for (const record of db.lessonRecords) {
        if (!isAbsent(record)) continue;

        const original = db.lessons.find((item) => item.id === record.lessonId);
        if (original === undefined || original.status === "已取消") continue;
        // 普通教师只补**自己课**上缺的课（这不是自己的课，缺不缺不归我管）
        if (!canSeeLesson(view, original)) continue;

        // 已经补过了吗（该学生出现在以这节为原课的补课里）
        const covered = db.lessons.some(
          (lesson) =>
            lesson.makeupForLessonId === original.id &&
            lesson.studentIds.includes(record.studentId) &&
            lesson.status !== "已取消",
        );
        if (covered) continue;

        const student = db.students.find((item) => item.id === record.studentId);
        if (student === undefined) continue;

        rows.push({
          original,
          student,
          record,
          reason: decideCharge(original, record).reason,
        });
      }

      return clone(rows.sort((a, b) => a.original.startsAt.localeCompare(b.original.startsAt)));
    },

    /**
     * 某节已有课的可选新时间。
     *
     * 用于「协调已有学生」：这节课挡住了新学生，可以把它挪到哪几个时间？
     * 复用同一套判定（整串日期都可行），因此挪过去不会制造新冲突。
     */
    async suggestMoves(lessonId: string, max = 6): Promise<
      Array<{ startsAt: string; change: string }>
    > {
      await delay();
      const db = load();
      const lesson = db.lessons.find((item) => item.id === lessonId);
      if (lesson === undefined) return [];

      const results: Array<{ startsAt: string; change: string }> = [];
      const original = new Date(lesson.startsAt);
      const baseMinutes = original.getHours() * 60 + original.getMinutes();

      for (const delta of [60, -60, 30, -30, 120, -120, 180, -180, 1440, -1440]) {
        if (results.length >= max) break;
        const shifted = baseMinutes + delta;
        const dayShift = Math.floor(shifted / 1440);
        const minutes = ((shifted % 1440) + 1440) % 1440;
        if (shifted < 0) continue;

        const target = new Date(original);
        target.setDate(target.getDate() + dayShift);
        target.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
        if (target.getTime() === original.getTime()) continue;

        const slot: InquirySlot = {
          id: "move",
          weekday: target.getDay() === 0 ? 7 : target.getDay(),
          start: minutesToTime(minutes),
        };
        const dates = [target];

        const teacherOk =
          checkAssignment({
            dates,
            slot,
            durationMinutes: lesson.durationMinutes,
            blockingLessons: db.lessons.filter(
              (item) => item.id !== lesson.id && item.teacherId === lesson.teacherId,
            ),
          }).length === 0;
        if (!teacherOk) continue;

        const room = db.classrooms.find((item) => item.id === lesson.classroomId);
        const roomOk =
          checkAssignment({
            dates,
            slot,
            durationMinutes: lesson.durationMinutes,
            blockingLessons: db.lessons.filter(
              (item) => item.id !== lesson.id && item.classroomId === lesson.classroomId,
            ),
            classroom: room,
          }).length === 0;
        if (!roomOk) continue;

        results.push({
          startsAt: target.toISOString(),
          change:
            dayShift === 0
              ? `同一时段改到 ${minutesToTime(minutes)}`
              : `改到 ${target.getMonth() + 1}月${target.getDate()}日 ${minutesToTime(minutes)}`,
        });
      }

      return clone(results);
    },

    /** 某个学生的课，按时间升序（学生详情用）。 */
    async listByStudent(studentId: string): Promise<Lesson[]> {
      const view = captureView();
      await delay();
      const db = load();
      /*
       * 先判"这个学生是不是我的"，再取课 —— 与 `students.get` 同一个口径：
       * 别人的学生连"他有哪几节课"都不该看到（连空数组以外的东西都不给）。
       */
      if (!canSeeStudent(view, db, studentId)) return [];
      return clone(
        scopeLessons(view, db.lessons)
          .filter((lesson) => lesson.studentIds.includes(studentId))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /**
     * 某个教师的课，按时间升序（教师详情用）。
     *
     * 普通教师查**别人**（`teacherId !== 我`）时返回**空数组**，而不是别人的课表 ——
     * 这一条是"行级越界＝看不到"的直接体现：返回空数组与"这位老师没有课"长得一样，
     * 不构成"他在这个时段有没有空"的信息泄漏。
     */
    async listByTeacher(teacherId: string): Promise<Lesson[]> {
      const view = captureView();
      await delay();
      if (view.kind === "own" && (view.teacherId === "" || teacherId !== view.teacherId)) return [];
      return clone(
        load()
          .lessons.filter((lesson) => lesson.teacherId === teacherId)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 某个教室的课，按时间升序（教室占用用）：教师只看到自己在这个教室的课。 */
    async listByClassroom(classroomId: string): Promise<Lesson[]> {
      const view = captureView();
      await delay();
      return clone(
        scopeLessons(view, load().lessons)
          .filter((lesson) => lesson.classroomId === classroomId)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 一段区间内的课（含首尾两天）。普通教师只看到自己那几节。 */
    async listBetween(from: Date, to: Date): Promise<Lesson[]> {
      const view = captureView();
      await delay();
      const fromKey = dateKey(from);
      const toKey = dateKey(to);
      return clone(
        scopeLessons(view, load().lessons)
          .filter((lesson) => {
            const key = dateKey(lesson.startsAt);
            return key >= fromKey && key <= toKey;
          })
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
  },

  /** 今日概览的汇总。 */
  async today(now: Date = new Date()): Promise<TodaySummary> {
    const view = captureView();
    await delay();
    const db = load();
    const key = dateKey(now);
    /*
     * 今日概览按**我的口径**重算，而不是"把别人的课从总数里减掉"：
     * 课只算我的；教室占用只数我的课；低课时预警只列我的学生（且不含金额）。
     * `studentCount` 也跟着变成"我的学生数" —— 教师这一页上的每个数字
     * 都回答"我今天要做什么"，掺进全校的数就答不了这个问题了。
     */
    const todays = scopeLessons(view, db.lessons).filter((lesson) => dateKey(lesson.startsAt) === key);
    const myStudents = scopeStudents(view, db, db.students);

    const classroomUsage = db.classrooms.map((classroom) => ({
      classroom,
      lessonCount: todays.filter((lesson) => lesson.classroomId === classroom.id).length,
    }));

    const todayCounts = countLessons(todays);
    return clone({
      date: key,
      /*
       * 节数与课时**一律不计已取消的课**（`countLessons` 是唯一口径）：
       * 早先这里把取消的课也算进"今天 3 节课 · 4 小时"，而课程安排页、课表、统计
       * 都不算 —— 同一个词四个意思（审计抓到的那条）。取消的课单独给一个数，
       * 界面上显示成"另有 N 节已取消"，不藏起来。
       */
      lessonCount: todayCounts.active,
      cancelledLessonCount: todayCounts.cancelled,
      teacherCount: new Set(todays.filter((lesson) => lesson.status !== "已取消").map((lesson) => lesson.teacherId)).size,
      totalMinutes: todayCounts.activeMinutes,
      classroomUsage,
      /*
       * 低课时预警：与「待跟进」用**同一个函数、同一个阈值**（`lessonBalance` +
       * 待跟进的 `FOLLOWUP_RULES.lowLessons`）。
       *
       * 早先这里自己算合计、阈值写死 5，而待跟进算"最少的那一门"、阈值取常量 ——
       * 于是"数学 3 节 + 物理 4 节"的学生在待跟进里被标成课时不足，
       * 在概览与学生页却不预警；改了常量那三处也不会跟着动（审计抓到的那条）。
       *
       * 判据取**最少的那一门**（见 followup.ts 的说明：排课受单科限制）。
       * 与待跟进的唯一差别是"没有任何在读报课"的学生：这里**要**列出来
       * （那意味着这节课根本排不了，管理员得知道），待跟进里则跳过
       * （"一节课都没报"不是"该催续费"的场景）。这条差别是明确的、也有断言盯着。
       */
      lowLessonStudents: myStudents
        .filter((student) => student.status !== "结课")
        .map((student) => {
          const balance = lessonBalance(student.enrollments);
          return {
            student,
            remainingLessons: balance.weakestRemaining,
            totalRemaining: balance.total,
            weakSubject: balance.weakest?.subject ?? "",
          };
        })
        .filter((item) => item.remainingLessons <= FOLLOWUP_RULES.lowLessons)
        .sort((a, b) => a.remainingLessons - b.remainingLessons),
      studentCount: myStudents.length,
      /*
       * 在职教师数是**机构名册**上的数字（不涉及学生），教师本来就看得到教师页，
       * 因此这里不跟着范围变 —— 否则"学校里几位老师在带课"会显示成 1，
       * 而那个数字对教师是公开信息（教师页一直是四类角色都能进的）。
       */
      activeTeacherCount: db.teachers.filter((teacher) => teacher.active).length,
    });
  },

  /**
   * 导出整库（供下载备份）。
   *
   * 返回的是**深拷贝**：调用方改它不会影响存储里的数据。
   */
  /**
   * 按需导出：数据集 × 选中的行 × 格式（CSV / JSON / ICS / Markdown）。
   *
   * `ids` 为空表示**全选**；返回的 `count` 是实际导出条数、`total` 是该数据集总数 ——
   * 界面靠这两个数字说清「导了 12 条，共 40 条」，避免让人以为导全了。
   * 只读：导出不改任何数据。
   */
  async exportDataset(request: ExportRequest): Promise<ExportResult> {
    await delay();
    return buildDatasetExport(load(), request);
  },

  async exportDatabase(): Promise<Database> {
    await delay();
    return clone(load());
  },

  /**
   * 导入整库。
   *
   * 三道保险，因为「导入」是唯一能一次性毁掉全部数据的操作：
   *   1. 先做结构校验，不合格直接拒绝（不碰现有数据）；
   *   2. 导入前把当前数据存到备份键，随时可以「恢复导入前的数据」；
   *   3. 通过 migrate() 迁到当前版本，再整体替换。
   */
  async importDatabase(text: string): Promise<ImportOutcome> {
    await delay();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "文件不是合法的 JSON。" };
    }

    const validated = validateImportedDatabase(parsed);
    if (!validated.ok) return { ok: false, error: validated.error };

    // migrate() 是**原地修改**：先记下原始版本，否则下面比较版本时拿到的
    // 已经是升级后的值，「已升级」的提示永远不会出现（这里踩过一次）
    const fromVersion = validated.database.version;
    const migrated = migrate(validated.database);
    if (migrated === null) {
      return { ok: false, error: "文件的数据结构无法识别，已保持现状。" };
    }

    // 备份当前数据（滚动保留最近几份，见 `writeBackupSlot` 的说明）
    writeBackupSlot(`导入前（${fileSummary(load().version, load())}）`);

    cache = migrated;
    writeLog(cache, {
      entity: "数据",
      action: "导入",
      targetId: "",
      summary: `导入数据：${fileSummary(fromVersion, cache)}`,
    });
    persist(cache);

    const stats = databaseStats(cache);
    const note =
      fromVersion === stats.version
        ? `已导入 v${stats.version} 数据`
        : `已导入并升级 v${fromVersion} → v${stats.version}`;
    return { ok: true, stats, note };
  },

  /**
   * 是否存在「导入前的备份」。
   *
   * **必须是 async**（哪怕是同步就能算出来的）：远端代理会把每个方法包成
   * `fetch`，同步方法在这里会**静默**变成一个 Promise —— 调用方写
   * `if (api.hasBackup())` 永远为真（Promise 对象是 truthy），
   * 于是"有没有备份"永远答是。这类错误不会报错，只会答错，因此用
   * `api.ts` 底部的类型级断言把它挡在编译期：**api 上不允许存在同步方法**。
   */
  async hasBackup(): Promise<boolean> {
    return store.read(BACKUP_KEY) !== null || readBackupIndex().length > 0;
  },

  /**
   * 导入前备份的清单（最近的在最前）。
   *
   * 给界面用：让人看到"有几份、什么时候的"，而不是只有一个"有 / 无"。
   */
  async backupSlots(): Promise<Array<{ at: string; summary: string }>> {
    const slots = readBackupIndex();
    if (slots.length > 0) return clone(slots.map(({ at, summary }) => ({ at, summary })));
    const legacy = store.read(BACKUP_KEY);
    return legacy === null ? [] : [{ at: "", summary: "导入前的数据（升级前留下的那一份）" }];
  },

  /** 恢复导入前的数据（后悔药）。 */
  async restoreBackup(): Promise<ImportOutcome> {
    await delay();
    const raw = store.read(BACKUP_KEY);
    if (raw === null) return { ok: false, error: "没有可恢复的备份。" };

    try {
      const restored = migrate(JSON.parse(raw) as Database);
      if (restored === null) return { ok: false, error: "备份数据结构无法识别。" };
      cache = restored;
      writeLog(cache, {
        entity: "数据",
        action: "恢复备份",
        targetId: "",
        summary: "恢复导入前的数据",
      });
      persist(cache);
      return { ok: true, stats: databaseStats(cache), note: "已恢复导入前的数据" };
    } catch {
      return { ok: false, error: "备份已损坏，无法恢复。" };
    }
  },

  /** 设置操作人（登录后由后台外壳调用一次，用于操作日志）。 */
  async setOperator(name: string): Promise<void> {
    operatorName = name.trim() === "" ? "admin" : name.trim();
  },

  /**
   * 设置本次请求的**行级范围**（服务端在每个请求开头按会话调用，见 `requireAuth`）。
   *
   * 与 `setOperator` 是同一种方法：不做业务、不属于任何权限分组
   * （因此登记在服务端的"会话管道方法"白名单里），但**必须每请求重设** ——
   * 它是模块级状态，少设一次就会让下一个请求用上一个人的范围。
   *
   * 前端调它**不作数**：和操作人一样，服务端在调用业务方法之前会按会话再设一次，
   * 前端那一次只影响它自己那次调用（一次 `/api/call` 只处理一个方法）。
   *
   * 注意这里**没有 `await delay()`**（与 `setOperator` 一致）：赋值必须在下一次
   * 事件循环之前同步完成，否则"调用前设范围"那一步会变成异步，白设。
   */
  async setScope(next: SessionScope): Promise<void> {
    scope =
      next.kind === "own"
        ? { kind: "own", teacherId: next.teacherId.trim(), warning: next.warning }
        : SCOPE_ALL;
  },

  /**
   * **批量导入**（CSV / JSON）：学生 / 教师 / 教室 / 课程。
   *
   * 为什么做成一个方法而不是"界面循环调 create"：
   *   - **一次落盘**：整库是一份 JSON 快照，循环 1000 次新建就是 1000 次整库重写，
   *     又慢又会在中途失败时留下半截数据；这里改完统一 persist；
   *   - **一次日志**：日志上限 500 条，逐行写日志会把历史冲掉；
   *   - **口径一处**：判重、默认值、校验都在 `lib/backend/import.ts`，
   *     界面与服务端调的是同一份（页面也能用同一个纯函数做预览）。
   *
   * 只**新增**不覆盖：同名记录跳过并在 `skipped` 里逐条说明。
   * 报课/收款/课时**不在这里导入**（见 import.ts 顶部说明）。
   */
  imports: {
    /**
     * 批量导入（**从文件/文本**）。
     *
     * `onConflict`：
     *   - `"skip"`（**默认**）：同名跳过。默认值刻意选它 —— 一个叫 apply 的方法
     *     不该在没说明的情况下"只体检不写入"，那会让人以为导进去了；
     *   - `"overwrite"` / `"duplicate"`：覆盖 / 两条都留；
     *   - `"ask"`：**纯体检、从不写入**（没有冲突也不写），把冲突行连同"库里那条长什么样"
     *     一起返回，让人决定怎么处理（界面就是这么用的：先 ask，再按选择 apply）。
     * `perRow` 逐行覆盖全局策略（键是行号），让"大部分跳过、个别覆盖"这种真实需求可行。
     */
    async apply(input: {
      entity: ImportEntity;
      text: string;
      format?: ImportFormat;
      /** 文件名，只用于日志里说明"从哪来的"。 */
      fileName?: string;
      onConflict?: ConflictStrategy | "ask";
      perRow?: Record<string, ConflictStrategy>;
    }): Promise<ImportReport> {
      await delay();
      const entity = input.entity;
      const parsed = parseImport(entity, input.text, input.format);
      return runImport(load(), parsed, {
        strategy: input.onConflict ?? "skip",
        perRow: input.perRow,
        source: input.fileName ?? "",
        headers: parsed.headers,
        unknownHeaders: parsed.unknownHeaders,
        missingRequiredHeaders: parsed.missingRequiredHeaders,
      });
    },
  },

  /**
   * **清空全部业务数据**，回到空库状态（保留课程库与报价配置）。
   *
   * 早期它叫「重置为示例数据」：灌回 8 位示例学生。那在真实使用下是个陷阱 ——
   * 机构点一下就会把自己录的数据换成演示数据，而演示数据看起来"有内容"，
   * 很容易被误当成自己的数据继续用。现在它的语义与初始状态一致（`createEmptyDatabase`）。
   *
   * 注意它仍然**没有**自动备份：调用方要先自己导出或确认。真正给用户用的"从头来过"
   * 那条路在「数据与备份 → 导入空库」，那条路会先自动留一份备份。
   */
  async reset(): Promise<void> {
    await delay();
    cache = createEmptyDatabase();
    writeLog(cache, {
      entity: "数据",
      action: "清空",
      targetId: "",
      summary: "清空全部业务数据（原有数据已丢弃，课程库与报价配置保留）",
    });
    persist(cache);
  },

  /**
   * 操作日志（最近的在前）。
   *
   * 只提供读取：写入由各业务方法自己负责 —— 依赖调用方自觉写日志一定会漏。
   */
  logs: {
    async list(limit = 100): Promise<OperationLog[]> {
      await delay();
      return clone([...load().logs].reverse().slice(0, limit));
    },
    async clear(): Promise<number> {
      await delay();
      const db = load();
      const count = db.logs.length;
      db.logs = [];
      writeLog(db, {
        entity: "数据",
        action: "清空日志",
        targetId: "",
        summary: `清空了 ${count} 条操作日志`,
      });
      persist(db);
      return count;
    },
  },

  /**
   * 报价配置：改价、改系数、改规则，以及**给家长试算**。
   *
   * 为什么放在后台：价格是业务信息，不是代码。原先调价要改 `lib/pricing/quote.ts`
   * 再重新构建；现在改这里即可，而且咨询时能当场算给家长听。
   *
   * 必须知道的一件事：伪后端的数据只在**这台浏览器**里（localStorage）。
   * 家长看到的报价页读的是站点内容，因此后台改完价要「导出配置」，
   * 把导出内容替换进 `data/site/pricing.md` 才会真正上线 —— 详见导出的说明。
   */
  /**
   * 宣传网站要读的公开数据。
   *
   * 单独成一组（而不是塞进 teachers / courses）是因为它**不按"表"取数**，
   * 而是"构站需要的那一份整体"：教师 + 课程卡片 + 课程正文 + 报价。
   * 网站那侧一次请求拿全，构站流程里也就不存在"取了一半"的中间状态。
   */
  site: {
    /**
     * 公开只读内容（**匿名可用**，见 `lib/backend/public-site.ts` 的字段白名单）。
     *
     * 服务端把它挂在 `/api/public/site`（登录闸门之前）；后台自己也能调，
     * 用来预览"网站现在会显示成什么样"。
     */
    async publicContent(): Promise<PublicSite> {
      await delay();
      return clone(publicSite(load()));
    },

    /**
     * **保存网站内容**（课程页正文 / 教师页标题 / 报价页文案）。
     *
     * 整份覆盖（与「信息采集表」同一套做法）：调用方传完整对象，服务端校验后整体替换。
     * 为什么不做成"改一个小节"的细粒度接口：正文是一块一块的文字，页面上就是整块编辑的，
     * 细粒度接口只会多出十几个方法，而它们做的事都一样。
     *
     * 校验不通过**直接拒绝**（见 `validateSiteContent`）：不自动纠正 ——
     * 系统替人编一个学科名，最后只会在页面上出现"未命名"这种东西。
     *
     * 校验还连**库里的现状**一起看（`{courses, previous}`）：卡片指着的小节被删掉时要拦下来
     * （网站上那张卡片点进去会跳空）。这一条只看"传上来的内容"判不出来，因此必须落在这里 ——
     * 而这里就是服务端：`/api/call` 与内存后端走的是同一个方法（路线 B），
     * 所以前台拦一次、服务端也拦一次，不是两套口径。
     */
    async saveContent(input: SiteContent): Promise<SiteContent> {
      await delay();
      const db = load();
      const problems = validateSiteContent(input, {
        courses: db.courses,
        // "原本有、这次没了"才算删除：只拿传上来的内容比对，会把"卡片先于正文存在"也判成删除
        previous: db.siteContent,
      });
      if (problems.length > 0) throw new Error(problems.join("；"));

      const before = db.siteContent.coursePage;
      db.siteContent = {
        coursePage: {
          heading: { ...input.coursePage.heading },
          subjects: input.coursePage.subjects.map((subject) => ({
            ...subject,
            name: subject.name.trim(),
            bands: subject.bands.map((band) => ({ ...band, title: band.title.trim() })),
          })),
          electiveTitle: input.coursePage.electiveTitle.trim(),
        },
        teacherPage: { heading: { ...input.teacherPage.heading } },
        pricingPage: { labels: { ...input.pricingPage.labels } },
        /*
         * 学生案例**原样保留**（不从 `input` 取）。
         *
         * 这一条不是省事，是防覆盖：课程库页那份草稿里带着整个 `siteContent`
         * （它读的是公开数据的整份快照），如果照 input 写回，那么"在课程库页保存一次课程正文"
         * 就会把机构刚在「网站内容」页改好的案例冲回它读到的那一刻 —— 两个页面各改一块，
         * 谁也不该动对方那一块。案例的写入口只有 `site.saveBlocks`。
         */
        casesPage: db.siteContent.casesPage,
        // 特色课程同理：它由「网站内容」页维护，课程库页保存正文时不许把它冲回去
        featuredPage: db.siteContent.featuredPage,
        // 常见问题同理
        faqPage: db.siteContent.faqPage,
        // 页面文案块同理（五个块都由「网站内容」页维护）
        copy: db.siteContent.copy,
      };

      const after = db.siteContent.coursePage;
      const bands = after.subjects.reduce((sum, subject) => sum + subject.bands.length, 0);
      writeLog(db, {
        entity: "数据",
        action: "保存网站内容",
        targetId: "",
        summary:
          `网站内容：课程正文 ${after.subjects.length} 个学科 / ${bands} 个小节` +
          (after.subjects.length === before.subjects.length ? "（数量未变）" : `（原 ${before.subjects.length} 个学科）`),
      });
      persist(db);
      return clone(db.siteContent);
    },

    /**
     * **保存网站内容里「课程正文以外」的那些块**（目前只有学生案例）。
     *
     * ## 为什么与 `site.saveContent` 分开，而不是一个方法管全部
     *
     * 两块内容由**两个页面**维护、责任也不同：课程正文（学科 → 小节）在「课程库」页
     * （它和卡片靶点、报价在同一张表单里，技术上招生老师），而学生案例在「网站内容」页
     * （市场营销口径，招生老师也要改）。合成一个方法就有两个后果：
     *
     *   1. **权限没法分**：`site.saveContent` 是技术管理员专属（它改的是课程页主干），
     *      除非把案例也锁进那一档，否则只能放宽整个方法 —— 那等于顺手给了
     *      "改课程正文"的权限；
     *   2. **互相覆盖**：两个页面的草稿都带着整份 `siteContent`，谁先保存谁就把对方
     *      读到那一刻的旧值写回去。现在各写各的块：`saveContent` 原样保留案例，
     *      本方法原样保留课程正文 / 教师页 / 报价文案。
     *
     * ## 只校验、只写这次交上来的块
     *
     * 校验用 `validateSiteBlocks`（**不含**"课程正文至少要有一个学科"那条）——
     * 空库里课程正文还没导入时也必须能存案例，否则两个功能互相卡死。
     *
     * 返回**保存之后的整份网站内容**：页面拿它替换草稿（与 `site.saveContent` 一致），
     * 免得页面上留着一份"我自己的"旧值。
     */
    async saveBlocks(
      blocks: Partial<Pick<SiteContent, "casesPage" | "featuredPage" | "faqPage" | "copy">>,
    ): Promise<SiteContent> {
      await delay();
      const db = load();
      const problems = validateSiteBlocks(blocks);
      if (problems.length > 0) throw new Error(problems.join("；"));

      const beforeCases = db.siteContent.casesPage;
      if (blocks.casesPage !== undefined) {
        const incoming = blocks.casesPage;
        db.siteContent = {
          ...db.siteContent,
          casesPage: {
            heading: { ...incoming.heading },
            notice: incoming.notice.trim(),
            cases: incoming.cases.map((item) => ({
              // id 为空 = 新加的案例：这里才生成，页面不需要知道 id 怎么来
              id: item.id.trim() === "" ? nextId("case") : item.id.trim(),
              title: item.title.trim(),
              fields: item.fields.map((field) => ({
                title: field.title.trim(),
                value: field.value.trim(),
              })),
              story: item.story.trim(),
            })),
          },
        };
      }

      /*
       * 特色课程：整棵树一起保存（与案例同理）。
       * id 为空 = 新加的课程，这里才生成；`name` / `slug` 去空白，其余原样。
       */
      if (blocks.featuredPage !== undefined) {
        const incoming = blocks.featuredPage;
        const node = (course: SiteFeaturedCourse): SiteFeaturedCourse => ({
          id: course.id.trim() === "" ? nextId("feat") : course.id.trim(),
          name: course.name.trim(),
          slug: course.slug.trim(),
          fields: course.fields.map((field) => ({
            title: field.title.trim(),
            value: field.value.trim(),
          })),
          body: course.body.trim(),
          children: course.children.map(node),
        });
        db.siteContent = {
          ...db.siteContent,
          featuredPage: {
            heading: { ...incoming.heading },
            notice: incoming.notice.trim(),
            courses: incoming.courses.map(node),
          },
        };
      }

      /* 常见问题：整份分组一起保存（与案例 / 特色课程同理）。 */
      if (blocks.faqPage !== undefined) {
        const incoming = blocks.faqPage;
        db.siteContent = {
          ...db.siteContent,
          faqPage: {
            heading: { ...incoming.heading },
            notice: incoming.notice.trim(),
            groups: incoming.groups.map((group) => ({
              id: group.id.trim() === "" ? nextId("faqg") : group.id.trim(),
              title: group.title.trim(),
              items: group.items.map((item) => ({
                id: item.id.trim() === "" ? nextId("faq") : item.id.trim(),
                question: item.question.trim(),
                answer: item.answer.trim(),
              })),
            })),
          },
        };
      }

      /* 页面文案块：只写这次交上来的那几块（与案例 / 特色课程 / 常见问题同理）。 */
      if (blocks.copy !== undefined) {
        const next = { ...db.siteContent.copy };
        for (const [key, block] of Object.entries(blocks.copy)) {
          if (block === undefined) continue;
          next[key as keyof typeof next] = {
            fields: block.fields.map((field) => ({
              id: field.id.trim() === "" ? nextId("copyf") : field.id.trim(),
              key: field.key.trim(),
              value: field.value,
            })),
            groups: block.groups.map((group) => ({
              id: group.id.trim() === "" ? nextId("copyg") : group.id.trim(),
              title: group.title.trim(),
              description: group.description.trim(),
              items: group.items.map((item) => ({
                id: item.id.trim() === "" ? nextId("copyi") : item.id.trim(),
                title: item.title.trim(),
                value: item.value.trim(),
                body: item.body.trim(),
              })),
            })),
          };
        }
        db.siteContent = { ...db.siteContent, copy: next };
      }

      const after = db.siteContent.casesPage;
      const afterFeatured = db.siteContent.featuredPage;
      const featuredNodes = (() => {
        const count = (list: readonly SiteFeaturedCourse[]): number =>
          list.reduce((sum, item) => sum + 1 + count(item.children), 0);
        return count(afterFeatured.courses);
      })();
      writeLog(db, {
        entity: "数据",
        action: "保存网站内容",
        targetId: "",
        summary:
          `网站内容：学生案例 ${after.cases.length} 条 / 特色课程 ${featuredNodes} 门 / ` +
          `常见问题 ${String(db.siteContent.faqPage.groups.reduce((sum, group) => sum + group.items.length, 0))} 条 / ` +
          `页面文案 ${String(Object.keys(blocks.copy ?? {}).length)} 块` +
          (beforeCases.cases.length === after.cases.length ? "（案例数量未变）" : `（案例原 ${beforeCases.cases.length} 条）`),
      });
      persist(db);
      return clone(db.siteContent);
    },

  },

  pricing: {
    /**
     * 当前报价配置。
     *
     * **班型的名称以课程类型的维度表为准**（v25）：机构在「课程类型」页改了班型名，
     * 报价页与网站报价器跟着变 —— 两边各显示一套名字是"不会报错的那类错"，
     * 因此这一层读出来时就对齐（`syncClassTypes`，与构站、导出共用同一份实现）。
     */
    async get(): Promise<PricingConfig> {
      await delay();
      const db = load();
      return clone(withCatalogClassTypes(db));
    },

    /**
     * 保存报价配置。
     *
     * 校验在服务端这一侧做（`validatePricingConfig`）：系数写 0 会让所有报价变 0，
     * 写错类型会让价格变成 NaN —— 这些都会安静地显示给家长，必须在保存前拦住。
     */
    async update(input: PricingConfig): Promise<PricingConfig> {
      await delay();
      const problems = validatePricingConfig(input);
      if (problems.length > 0) {
        throw new Error(`报价配置不合法，未保存：${problems.join("；")}`);
      }
      const db = load();
      /*
       * 班型必须在课程类型里存在：不存在的话这一行系数**永远算不到**，而页面上
       * 看起来一切正常（只是家长问那个班型时没有价）。因此在这一层拦下并说清去哪改。
       */
      const unknown = input.classTypes.filter(
        (item) => (item.formatId ?? "") !== "" &&
          !db.catalog.formats.some((format) => format.id === item.formatId),
      );
      if (unknown.length > 0) {
        throw new Error(
          `报价里有班型在「课程类型」里已经不存在了：${unknown.map((item) => item.name).join("、")}。` +
            "请到「课程类型」页确认是改名还是删除，再回来改价。",
        );
      }

      const before = db.pricing;
      const sync = syncClassTypes(clone(input).classTypes, db.catalog);
      db.pricing = {
        ...clone(input),
        // 名称一律以维度表为准落库（否则库里会留着一份过期的名字，下一次导出就写回文件了）
        classTypes: sync.classTypes,
        source: PRICING_SOURCE_ADMIN,
        updatedAt: nowIso(),
      };
      writeLog(db, {
        entity: "报价",
        action: "修改配置",
        targetId: "pricing",
        summary: describePricingChange(before, db.pricing),
      });
      persist(db);
      return clone(db.pricing);
    },

    /** 恢复为站点内容里的价格（改乱了可以退回）。 */
    async reset(): Promise<PricingConfig> {
      await delay();
      const db = load();
      const before = db.pricing;
      db.pricing = { ...pricingConfigFromContent(), classTypes: withCatalogClassTypes(db).classTypes };
      writeLog(db, {
        entity: "报价",
        action: "恢复默认",
        targetId: "pricing",
        summary: `报价配置恢复为站点内容（原为${before.source}）`,
      });
      persist(db);
      return clone(db.pricing);
    },

    /**
     * 按选择试算报价（后台给家长算价、核对「这个方案多少钱」）。
     *
     * 只发选择、不发价格：价格一律由这边查，避免前端改个数字就改了价。
     */
    async quote(selection: QuoteSelection): Promise<QuoteResult> {
      await delay();
      // 用对齐后的配置试算：班型改名之后，页面发过来的是**新名字**，而库里那一份可能还没跟上
      return quoteSelection(withCatalogClassTypes(load()), selection);
    },

    /**
     * 算教师课时费（分成）：教师拿多少、机构留多少。
     *
     * 规则只收「哪门课 / 哪个班型 / 几个学生 / 多久」，**比例与课时单价一律由
     * 服务端按配置算** —— 教师工资和报价一样，不能让前端传数字进来。
     */
    async teacherFee(selection: TeacherFeeSelection): Promise<TeacherFeeResult> {
      await delay();
      // 同上：按班型名查的那两处必须用对齐后的配置
      return teacherFeeForSelection(withCatalogClassTypes(load()), selection);
    },

    /** 导出成可直接替换 `data/site/pricing.md` 的 Markdown 片段。 */
    async exportMarkdown(): Promise<string> {
      await delay();
      const db = load();
      /*
       * 导出的是要写回 `data/site/pricing.md` 的那一份 —— 班型名用维度表里的，
       * 否则"没连后端那一份"会把旧名字带回去，下一次构站又漂了。
       */
      return pricingConfigToMarkdown(withCatalogClassTypes(db));
    },
  },

  /**
   * 咨询线索：登记、判定可行性、采用方案（一次性建整串课）、放弃。
   *
   * 判定逻辑在 lib/backend/inquiry.ts（纯函数）。这里只负责凑数据与落库。
   */
  inquiries: {
    ...inquiryCollection,

    /** 登记咨询：创建时间与已排课节由服务生成。 */
    async create(input: NewInquiry): Promise<Inquiry> {
      return inquiryCollection.create({
        ...input,
        createdAt: nowIso(),
        scheduledLessonIds: [],
      });
    },

    /**
     * 判定这条咨询的可行性。
     *
     * 会把「每个候选时段能不能排下整串课」算出来，不可行时给最接近的方案。
     * 只看不改：真正落库要管理员点「采用」。
     */
    async evaluate(id: string): Promise<FeasibilityReport | null> {
      await delay();
      const db = load();
      const inquiry = db.inquiries.find((item) => item.id === id);
      if (inquiry === undefined) return null;

      // 注意别把这个局部变量叫 load：会遮蔽模块级的 load()（读数据库的那个）
      const loadByTeacher = new Map<string, number>();
      for (const row of teacherWorkload(db.teachers, db.lessons)) {
        loadByTeacher.set(row.teacher.id, row.minutes);
      }

      const slots = inquiry.candidates.map((slot) =>
        evaluateSlot({
          inquiry,
          slot,
          teachers: db.teachers,
          classrooms: db.classrooms,
          lessons: db.lessons,
          load: loadByTeacher,
        }),
      );

      return clone({
        inquiryId: inquiry.id,
        slots,
        recommendedSlotId: slots.find((slot) => slot.ok)?.slotId ?? "",
      });
    },

    /**
     * 采用某个方案：一次性把整串课建出来，并把线索标记为已安排。
     *
     * 建之前**再检查一次**：判定与实际落库之间可能已经有人排了别的课
     * （判定是「看」，落库是「改」，中间的时间差不能忽略）。
     */
    async accept(
      id: string,
      input: { slotId: string; teacherId: string; classroomId: string },
    ): Promise<{ ok: true; lessonIds: string[] } | { ok: false; error: string }> {
      await delay();
      const db = load();
      const inquiry = db.inquiries.find((item) => item.id === id);
      if (inquiry === undefined) return { ok: false, error: "咨询记录不存在。" };

      const slot = inquiry.candidates.find((item) => item.id === input.slotId);
      if (slot === undefined) return { ok: false, error: "候选时段不存在。" };

      const dates = buildDateSeries({
        startsAt: inquiry.startsAt,
        weekday: slot.weekday,
        intervalWeeks: inquiry.intervalWeeks,
        plannedLessons: inquiry.plannedLessons,
        skipDates: inquiry.skipDates,
      });

      const startMinutes = slotMinutes(slot);
      if (startMinutes === null) return { ok: false, error: "时间格式不对。" };

      const blockers = checkAssignment({
        dates,
        slot,
        durationMinutes: inquiry.durationMinutes,
        blockingLessons: db.lessons.filter((lesson) => lesson.teacherId === input.teacherId),
      });
      if (blockers.length > 0) {
        return { ok: false, error: `落库前复核发现冲突：${blockers[0]?.detail ?? ""}` };
      }
      const roomBlockers = checkAssignment({
        dates,
        slot,
        durationMinutes: inquiry.durationMinutes,
        blockingLessons: db.lessons.filter((lesson) => lesson.classroomId === input.classroomId),
        classroom: db.classrooms.find((room) => room.id === input.classroomId),
      });
      if (roomBlockers.length > 0) {
        return { ok: false, error: `落库前复核发现冲突：${roomBlockers[0]?.detail ?? ""}` };
      }

      const lessonIds: string[] = [];
      for (const date of dates) {
        const startsAt = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          Math.floor(startMinutes / 60),
          startMinutes % 60,
          0,
          0,
        );
        const lesson: Lesson = {
          id: nextId("l"),
          version: 1,
          subject: inquiry.subject,
          form: "",
          teacherId: input.teacherId,
          classroomId: input.classroomId,
          // 新学生此时还没有档案，先把姓名记在备注里；建档后再补学生名单
          studentIds: [],
          startsAt: startsAt.toISOString(),
          durationMinutes: inquiry.durationMinutes,
          status: "已排",
          note: `咨询安排 · ${inquiry.studentName}`,
          makeupForLessonId: "",
        };
        db.lessons.push(lesson);
        lessonIds.push(lesson.id);
      }

      inquiry.status = "已安排";
      inquiry.scheduledLessonIds = lessonIds;

      writeLog(db, {
        entity: "咨询",
        action: "安排",
        targetId: inquiry.id,
        summary: `${inquiry.studentName} 咨询已安排：${inquiry.subject} 共 ${lessonIds.length} 节`,
      });
      persist(db);
      return { ok: true, lessonIds };
    },

    /** 放弃这条咨询（记原因）。 */
    async abandon(id: string, reason: string): Promise<Inquiry | null> {
      await delay();
      const db = load();
      const inquiry = db.inquiries.find((item) => item.id === id);
      if (inquiry === undefined) return null;
      inquiry.status = "已放弃";
      inquiry.note = reason.trim() === "" ? inquiry.note : reason.trim();
      writeLog(db, {
        entity: "咨询",
        action: "放弃",
        targetId: inquiry.id,
        summary: `${inquiry.studentName} 咨询已放弃${reason.trim() !== "" ? `：${reason.trim()}` : ""}`,
      });
      persist(db);
      return clone(inquiry);
    },
  },

  /**
   * 全局搜索（学生 / 教师 / 教室 / 排课 / 课程）。
   *
   * 匹配规则在 lib/backend/search.ts；服务层负责把数据快照与课程列表凑齐。
   */
  async search(keyword: string): Promise<SearchHit[]> {
    const view = captureView();
    await delay();
    const db = load();
    /*
     * 全局搜索也要收口：搜索框在后台的**每一页**都有（顶栏），因此它是最容易
     * "教师随手一搜就搜到别人班学生"的地方。学生与排课按范围收窄；
     * 教师 / 教室 / 课程是参考数据（教师本来就看得到这几页），照旧全文匹配。
     */
    return clone(
      searchAll({
        keyword,
        students: scopeStudents(view, db, db.students),
        teachers: db.teachers,
        classrooms: db.classrooms,
        lessons: scopeLessons(view, db.lessons),
        courses: getCourseColumnsFromTemplate().flatMap((column) =>
          column.subgroups.flatMap((subgroup) =>
            subgroup.cards.map((card) => ({
              title: card.title,
              href: `/courses/${card.path}`,
            })),
          ),
        ),
      }),
    );
  },
};

/** 批量导入的返回结构（CSV / JSON 文件导入用）。 */
export type ImportReport = {
  /** 整体是否可用（必填列缺失时为 false，一份都不导）。 */
  ok: boolean;
  error?: string;
  /** 需要人工决定冲突（`onConflict: "ask"` 且确实有冲突时为 true，此时**什么都没写**）。 */
  needsDecision: boolean;
  summary: string;
  added: number;
  overwritten: number;
  duplicated: number;
  skipped: { line: number; reason: string }[];
  problems: { line: number; reason: string }[];
  conflicts: Conflict[];
  headers: string[];
  unknownHeaders: string[];
};

/**
 * 一次导入的公共后半段：**判定 → （必要时只报告）→ 落盘 → 写日志 → 返回报告**。
 *
 * 抽出来是为了让"体检"与"写入"两次调用**只有策略不同**：
 * 判重、冲突策略、后悔药、日志、落盘全在这一个函数里，两处不可能分叉。
 */
function runImport(
  db: Database,
  parsed: ParsedImport,
  options: {
    strategy: ConflictStrategy | "ask";
    perRow?: Record<string, ConflictStrategy>;
    source: string;
    headers: string[];
    unknownHeaders: string[];
    missingRequiredHeaders: string[];
  },
): ImportReport {
  const label = ENTITY_SPECS[parsed.entity].label;
  const base = {
    added: 0, overwritten: 0, duplicated: 0,
    skipped: [] as { line: number; reason: string }[],
    problems: parsed.problems,
    conflicts: [] as Conflict[],
    headers: options.headers,
    unknownHeaders: options.unknownHeaders,
  };

  if (options.missingRequiredHeaders.length > 0) {
    return {
      ...base,
      ok: false,
      needsDecision: false,
      error: `缺少必填列：${options.missingRequiredHeaders.join("、")}（请对照模板的表头）`,
      summary: "",
    };
  }

  /*
   * `ask` = **纯体检，从不写入**（哪怕一条冲突都没有）。
   *
   * 这一条踩过：最初写成"有冲突才返回、没冲突就顺手导进去"，于是界面的流程
   * （ask → 没冲突 → 再 apply）变成了"第一次已经写进去了，第二次全部同名跳过"，
   * 用户看到"跳过 N 条"而实际上那些数据刚被导进来 —— 报告与事实不符。
   * 体检就该只是体检：调用方拿到结论后再决定写不写。
   */
  if (options.strategy === "ask") {
    const conflicts = detectConflicts(db, parsed);
    return {
      ...base,
      ok: true,
      needsDecision: conflicts.length > 0,
      summary: conflicts.length > 0
        ? `${conflicts.length} 条与现有记录冲突，需要你决定怎么处理`
        : `检查完成：${parsed.records.length} 条都能导入（没有同名冲突）`,
      conflicts,
    };
  }

  // 留一颗后悔药（与整库导入同一套：只留最近一次）
  store.write(BACKUP_KEY, JSON.stringify(db));

  const outcome = applyImport(db, parsed, {
    strategy: options.strategy,
    perRow: options.perRow,
  });

  const conflictNote =
    outcome.overwritten > 0 || outcome.duplicated > 0 || outcome.skipped.length > 0
      ? `（覆盖 ${outcome.overwritten} · 保留两份 ${outcome.duplicated} · 跳过 ${outcome.skipped.length}）`
      : "";
  writeLog(db, {
    entity: label,
    action: "批量导入",
    targetId: "",
    summary:
      `批量导入${label} ${outcome.added} 条${conflictNote}` +
      // 分区是导入时顺带建出来的，日志里说清楚（否则"库里怎么多了一个栏目"查不到出处）
      (outcome.partitionsCreated > 0 ? `，新建分区 ${outcome.partitionsCreated} 个` : "") +
      (options.source === "" ? "" : `，来源 ${options.source}`),
  });
  persist(db);

  return {
    ...base,
    ok: true,
    needsDecision: false,
    summary: summarizeImport(outcome),
    added: outcome.added,
    overwritten: outcome.overwritten,
    duplicated: outcome.duplicated,
    skipped: outcome.skipped,
    conflicts: outcome.conflicts,
  };
}

/**
 * 仅供自检使用：把服务切到指定的存储实现（Node 里用内存存储）。
 * 页面代码不应调用它。
 */
/**
 * **只给自检 / 演示脚本的夹具收尾用**：不经过删除护栏，直接把一条记录摘掉。
 *
 * ## 为什么需要它（以及为什么它不挂在 `api` 上）
 *
 * 产品层的删除现在有护栏（有账就不许删，见 `DeleteGuard`）—— 那是给**机构**用的规矩。
 * 而自检为了给后面的断言腾地方，经常要收尾掉"刚刚造过账"的夹具：
 * 那种夹具按产品规矩本来就**删不掉**（账还在），于是自检会被自己的护栏挡住。
 *
 * 两条出路都不好：放宽护栏（把产品规矩改松）或者让自检绕过它（假装护栏不存在）。
 * 这里的取舍是：**护栏照旧严格**，给自检一个名字里就写着"这是夹具钩子"的入口，
 * 而且**刻意不挂在 `api` 对象上** —— 它不进契约、不进远端代理，页面看不到它，
 * 因此不会有任何产品代码误用它。
 *
 * 删掉一条夹具**不写操作日志**：它不是一次业务动作。
 */
/**
 * **服务端自己的操作**也要写进同一份操作日志（2026-09 审计后补的）。
 *
 * ## 为什么需要它
 *
 * 服务端有几件事不经过服务层：**账号管理**（加人 / 改角色 / 重置口令 / 停用 / 删除）与
 * **节假日抓取**。它们原先各自往 SQL 的 `logs` 表里写一条 —— 而界面上的「操作日志」
 * 读的是快照里那份（`logs.list`）。于是同一个 `.db` 文件里又有两套日志：
 * 账号操作在界面上**根本看不到**，而老 REST 的 `/api/logs`（唯一能读到它的入口）下线之后，
 * 那些记录就彻底没人能看了。
 *
 * 现在统一走这里：账号与节假日的操作写进**同一份**日志，界面上的操作日志里能看到
 * "谁在什么时候加了个账号 / 重置了谁的口令"。
 *
 * 操作人取当前请求会话设置的那一个（`setOperator`，每个请求开头由 `requireAuth` 设一次）——
 * 与业务日志同一个来源。
 */
export function __appendSystemLog(entry: {
  entity: string;
  action: string;
  targetId: string;
  summary: string;
}): void {
  const db = load();
  writeLog(db, entry);
  persist(db);
}

export function __removeFixture(entity: string, id: string): boolean {
  const db = load() as unknown as Record<string, unknown>;
  const list = db[entity];
  if (!Array.isArray(list)) return false;
  const index = (list as Array<{ id: string }>).findIndex((item) => item.id === id);
  if (index === -1) return false;
  (list as Array<{ id: string }>).splice(index, 1);
  persist(db as unknown as Database);
  return true;
}

export function __useStoreForTesting(backing: KeyValueStore): void {
  store = backing;
  cache = null;
}

/**
 * 伪后端的对外形状。
 *
 * 将来实现 HTTP 版时，只要满足这个类型，页面代码一行都不用改：
 *   const httpApi: BackendApi = { students: { list: () => fetch(…) … }, … };
 * 契约分组与「服务端必须复核的校验」见 lib/backend/contract.ts
 * 与 docs/后台API约定.md。
 */
/**
 * 对外导出的服务对象。
 *
 * **本机使用**（设置了 `NEXT_PUBLIC_API_BASE`）时导出的是**远端代理**：
 * 每个方法都打到后端的 `/api/call`，数据进 SQLite；
 * **未设置**（线上构建）时导出本地实现（localStorage），保持线上可用。
 *
 * 类型仍然是本地实现的形状，因此页面与类型都不用改 —— 这是"换后端只改一个文件"的落地。
 */
/*
 * 这里在**模块加载时**决定导出哪一份实现，因此"界面里改了后端地址"需要**刷新页面**才生效。
 * 这是刻意的取舍：`api` 的形状必须在页面代码里保持同步（106 个方法），
 * 做成"随时可换"会引入一层不必要的间接。
 * 连接状态指示器会明确提示"改完地址请刷新"。
 */
export const api: BackendApi = (isRemoteMode()
  ? createRemoteApi(localApi, remoteBase())
  : localApi) as BackendApi;

export type BackendApi = typeof localApi;

/**
 * 类型级断言：**`api` 上不允许出现同步方法**。
 *
 * 远端代理（`lib/backend/remote.ts`）把每个方法包成 `fetch`，因此它的返回值必然是
 * Promise。同步方法经代理后会**静默**变成 Promise，调用方一点错都收不到，
 * 只会拿到一个永远为真的对象 —— `if (api.hasBackup())` 从此恒真。
 * 这类"答错但不报错"的问题最难查，所以把它变成**编译错误**：
 *
 *   - 只要 `api` 的某个方法返回的不是 Promise，`NonAsyncApiMethods` 就不再是 `never`，
 *     于是下面这行的类型要求多出一个属性，而值是 `{}`，编译失败；
 *   - 报错信息里会直接点名是哪个方法（属性名就是方法路径），
 *     并且值的类型写着该怎么做。
 *
 * 加新方法时若写出同步版本，`npm run typecheck` 会立刻拦住，不需要谁记得这件事。
 */
type NonAsyncApiMethods<T = BackendApi, Prefix extends string = ""> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown
    ? ReturnType<T[K]> extends Promise<unknown>
      ? never
      : `${Prefix}${K & string}`
    : T[K] extends object
      ? NonAsyncApiMethods<T[K], `${Prefix}${K & string}.`>
      : never;
}[keyof T];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __apiMustBeFullyAsync: Record<
  NonAsyncApiMethods<BackendApi> & string,
  "api 上不允许有同步方法：远端代理会把它静默变成 Promise（恒为真），请改成 async 并返回 Promise"
> = {};

// 重新导出，便于页面只 import 这一处
export type {
  Assessment,
  ChurnStats,
  FeasibilityReport,
  Classroom,
  FollowUpItem,
  RoomUtilization,
  SearchHit,
  TeacherWorkload,
  LessonTransaction,
  Payment,
  ClassroomAvailability,
  ClassroomKind,
  CompletionResult,
  HomeworkRecord,
  LessonRecord,
  NewAssessment,
  NewHomeworkRecord,
  NewLessonRecord,
  Inquiry,
  InquirySlot,
  InquiryStatus,
  NewInquiry,
  NewPayment,
  OperationLog,
  PaymentMethod,
  Enrollment,
  NewEnrollment,
  NewStudentEnrollment,
  EnrollmentEdit,
  EnrollmentEditScope,
  EnrollmentEditResult,
  ConflictReport,
  Database,
  LessonInput,
  Lesson,
  NewClassroom,
  NewLesson,
  NewStudent,
  NewTeacher,
  Student,
  Teacher,
  TodaySummary,
  Course,
  CourseOrigin,
  CourseStatus,
  CourseSiteKind,
  CoursePartition,
  SiteCase,
  SiteCasesPage,
  Catalog,
  CatalogStage,
  CatalogSubject,
  CatalogModule,
  CatalogFormat,
  CatalogOffer,
  VacationPeriod,
  SiteFeaturedCourse,
  SiteFeaturedPage,
  SiteCopyBlock,
  SiteCopyGroup,
  SiteCopyItem,
  SiteCopyKey,
  SiteFaqGroup,
  SiteFaqItem,
  SiteFaqPage,
  PublicSite,
  SiteContent,
};
export {
  ATTENDANCE_OPTIONS,
  INQUIRY_STATUSES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  TRANSACTION_KINDS,
  CLASSROOM_KINDS,
  ENROLLMENT_STATUSES,
  FOCUS_OPTIONS,
  INTERACTION_OPTIONS,
  LESSON_STATUSES,
  STUDENT_STATUSES,
  COURSE_ORIGINS,
  COURSE_STATUSES,
  COURSE_SITE_KINDS,
  CATALOG_SUBJECT_KINDS,
  CATALOG_MODULE_KINDS,
  SUBMISSION_OPTIONS,
} from "./types";
