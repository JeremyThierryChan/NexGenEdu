import { createKeyValueStore, type KeyValueStore } from "./storage";
import { createEmptyDatabase } from "./initial";
import { emptySiteContent } from "./site-content";
import { importSiteContent } from "./site-import";
import type { SiteContentImportReport } from "./site-import";
import { publicSite } from "./public-site";
import type { PublicSite } from "./public-site";
import { describeSeriesDate, generateSeriesDates } from "./recurrence";
import {
  applyImport,
  detectConflicts,
  ENTITY_SPECS,
  parseImport,
  siteImportRecords,
  summarizeImport,
  type Conflict,
  type ConflictStrategy,
  type ImportEntity,
  type ImportFormat,
  type ParsedImport,
  type SiteImportSource,
} from "./import";
import { isWithinAvailability } from "./availability";
import { CURRENT_VERSION } from "./version";
import { createRemoteApi, isRemoteMode, remoteBase } from "./remote";
import { addTransaction, nowIso, reconcileCharge, recordPayment } from "./charges";
import { enrollmentForLesson, remainingOf, remainingTotal } from "./enrollment";
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
  mergeSiteCourses,
  normalizeCourse,
  summarizeCourses,
  validateCourse,
} from "./courses";
import type { CourseOption, CourseSummary } from "./courses";
import type {
  Assessment,
  Classroom,
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
 * - 没有并发控制：两个标签页同时写会以最后写入的为准。
 */

const STORAGE_KEY = "nexgenedu.admin.db.v1";

/** 「导入前」的备份键：导入是唯一能一次性毁掉全部数据的操作，留一颗后悔药。 */
const BACKUP_KEY = "nexgenedu.admin.db.backup.v1";

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


/** 生成 id：时间戳 + 随机后缀，够用且不依赖自增（将来换服务端也无缝）。 */
function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 读取整库；首次访问时灌入示例数据。 */
function load(): Database {
  if (cache !== null) return cache;

  const raw = store.read(STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed = migrate(JSON.parse(raw) as Database);
      if (parsed !== null) {
        cache = parsed;
        // 迁移过就立刻落盘，避免每次打开都迁移一遍
        if (parsed.version !== JSON.parse(raw).version) persist(cache);
        return cache;
      }
    } catch {
      // 数据损坏：当作首次访问处理
    }
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
 * 返回 null 表示这份数据没法用（版本比当前还新，或结构不认识）——
 * 调用方会重新灌入示例数据，而不是带着缺字段的数据继续跑。
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
  if (db.version === 2 && db.students.some(isLegacyStudent)) {
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
     */
    db.courses = db.courses ?? coursesFromSite();
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
     * 借机去读外部的 Markdown —— 真要灌内容，跑 `npm run server:import-site`，
     * 或者在后台点「从网站导入」。这也让网站那侧的判定（有内容才用后端）能生效。
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
     * 因此默认全部关掉（网站这次构站仍显示原来的那几位，因为紧接着的
     * 「从网站导入内容」会把内容里那几位标上）；机构要放谁上去，在教师表单里勾一下。
     */
    db.teachers = db.teachers.map((teacher) => ({
      ...teacher,
      siteVisible: teacher.siteVisible ?? false,
    }));
    db.version = 16;
  }

  return db.version === CURRENT_VERSION ? db : null;
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
  for (const subject of after.subjects) {
    const previous = before.subjects.find(
      (item) => item.name === subject.name && item.stageName === subject.stageName,
    );
    if (previous !== undefined && previous.coefficient !== subject.coefficient) {
      parts.push(`「${subject.name}」科目系数 ${previous.coefficient} → ${subject.coefficient}`);
    }
  }
  for (const classType of after.classTypes) {
    const previous = before.classTypes.find((item) => item.name === classType.name);
    if (previous !== undefined && previous.coefficient !== classType.coefficient) {
      parts.push(`「${classType.name}」班级系数 ${previous.coefficient ?? "—"} → ${classType.coefficient ?? "—"}`);
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
  const { config, changes } = syncLibraryLinks(db.pricing, db.courses);
  if (changes.length === 0) return [];

  db.pricing = { ...config, source: PRICING_SOURCE_ADMIN, updatedAt: nowIso() };
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

/** 通用集合：把「取数组 → 改 → 存」的重复代码在一处。 */
function collection<T extends { id: string }>(
  pick: (db: Database) => T[],
  prefix: string,
  /** 日志里显示的对象类别（如「学生」）。传空串表示不记日志。 */
  label = "",
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

/** 日期键：YYYY-MM-DD（本地时区），用于按天分组。 */
export function dateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const studentCollection = collection<Student>((db) => db.students, "s", "学生");
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

/**
 * 某个学生在这节课上"超用"了课时（已用 > 购买）。
 *
 * 排课时已经按"课时够不够"拦了一道，但**仍可能发生**：
 * 排课时够、后来退课或手工调减课时、多人课里有学生中途退课…
 * 这时候必须**说出来**：静默超用等于白送课时，而"剩余课时显示 0"看不出欠了几节。
 */
export type OverusedLesson = {
  studentId: string;
  name: string;
  subject: string;
  /** 超用节数（正数）。 */
  over: number;
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
const lessonCollection = collection<Lesson>((db) => db.lessons, "l", "排课");

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
function normalizeNewEnrollments(items: NewStudentEnrollment[]): NewEnrollment[] {
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
      const wanted = normalizeNewEnrollments(enrollments ?? []);

      const student: Student = {
        ...rest,
        id: nextId("s"),
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

      const enrollment = addEnrollment(db, student, input);

      syncSubjects(student);
      writeLog(db, {
        entity: "报课",
        action: "报课",
        targetId: enrollment.id,
        summary: `${student.name} 报课「${enrollment.subject}」${enrollment.totalLessons} 节`,
      });
      persist(db);
      return clone(student);
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
       * 退款信息：金额由退费策略算出后传进来（服务层不自己挑策略 ——
       * 换策略是业务决策，应该由操作的人在界面上确认）。
       */
      refund?: { amount: number; method: PaymentMethod; policyName: string },
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      const enrollment = student?.enrollments.find((item) => item.id === enrollmentId);
      if (student === undefined || enrollment === undefined) return null;

      enrollment.status = "已退课";
      enrollment.endedAt = nowIso();
      enrollment.history.push({
        at: nowIso(),
        kind: "退课",
        lessons: 0,
        note:
          refund !== undefined && refund.amount > 0
            ? `${note.trim()}${note.trim() !== "" ? " · " : ""}按「${refund.policyName}」退款 ${refund.amount} 元`
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

      if (refund !== undefined && refund.amount > 0) {
        recordPayment(db, {
          studentId: student.id,
          enrollmentId: enrollment.id,
          amount: round2(refund.amount),
          kind: "退款",
          method: refund.method,
          at: nowIso(),
          note: `退课退款 · ${refund.policyName}`,
        });
      }

      syncSubjects(student);
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

      syncSubjects(student);
      persist(db);
      return clone(student);
    },

    /** 保存信息采集表（整份覆盖；调用方传完整对象）。 */
    async saveProfile(
      id: string,
      profile: StudentProfile,
    ): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === id);
      if (student === undefined) return null;
      student.profile = profile;
      writeLog(db, {
        entity: "学生",
        action: "填写采集表",
        targetId: student.id,
        summary: `更新「${student.name}」的信息采集表`,
      });
      persist(db);
      return clone(student);
    },

    async search(keyword: string): Promise<Student[]> {
      await delay();
      const text = keyword.trim().toLowerCase();
      if (text === "") return clone(load().students);
      return clone(
        load().students.filter((student) =>
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
   * 网站上的课程在首次访问与「从网站同步」时自动进来；机构自己加的课
   * （围棋、书法这类网站上还没有的）与它们平起平坐，都能排课、能记课时。
   *
   * 注意边界：这里加课程**不会**让宣传网站上多出一张卡片 —— 网站是静态内容。
   */
  courses: {
    ...collection<Course>((db) => db.courses, "course", "课程"),

    /**
     * 新建课程（先校验再落库）。
     *
     * 课程名是引用键（排课、教师科目、报课记录都按名字记），重名必须拦住：
     * 「数学」有两门课时，课时扣到哪一门就说不清了。
     */
    async create(input: Omit<Course, "id">): Promise<Course> {
      await delay();
      const db = load();
      const normalized = normalizeCourse(input);
      const problems = validateCourse(normalized, db.courses);
      if (problems.length > 0) throw new Error(problems.join("；"));

      const created: Course = { ...normalized, id: nextId("course") };
      db.courses.push(created);
      syncPricingWithCourses(db);
      writeLog(db, {
        entity: "课程",
        action: "新建",
        targetId: created.id,
        summary: `新建课程「${created.name}」（${created.category}${created.origin === "后台" ? " · 后台新增" : ""}）`,
      });
      persist(db);
      return clone(created);
    },

    /** 修改课程：改名同样要防重名；网站来源的课程也能改状态 / 班型 / 分类 / 备注 / 网站卡片字段。 */
    async update(id: string, patch: Partial<Omit<Course, "id">>): Promise<Course | null> {
      await delay();
      const db = load();
      const target = db.courses.find((item) => item.id === id);
      if (target === undefined) return null;

      const next = normalizeCourse({ ...target, ...patch });
      const problems = validateCourse(next, db.courses, id);
      if (problems.length > 0) throw new Error(problems.join("；"));

      Object.assign(target, next);
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
      return clone(courseOptions(load().courses));
    },

    /** 从网站内容同步新增的课程卡片（**只增不改**：不动机构在后台维护的信息）。 */
    async syncFromSite(): Promise<{ added: string[]; total: number }> {
      await delay();
      const db = load();
      const merged = mergeSiteCourses(db.courses);
      if (merged.added.length > 0) {
        db.courses = merged.courses;
        syncPricingWithCourses(db);
        writeLog(db, {
          entity: "课程",
          action: "同步",
          targetId: "",
          summary: `从网站同步了 ${merged.added.length} 门课程：${merged.added.join("、")}`,
        });
        persist(db);
      }
      return { added: merged.added, total: db.courses.length };
    },

    /** 课程库统计（列表页顶部）。 */
    async summary(): Promise<CourseSummary> {
      await delay();
      return clone(summarizeCourses(load().courses));
    },
  },

  teachers: {
    ...collection<Teacher>((db) => db.teachers, "t", "教师"),
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

  classrooms: collection<Classroom>((db) => db.classrooms, "c", "教室"),

  /** 收款流水（钱的账本）。 */
  payments: {
    ...collection<Payment>((db) => db.payments, "pay"),
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
    /** 按时间区间取（本月收入用）。 */
    listBetween: async (from: Date, to: Date): Promise<Payment[]> => {
      await delay();
      return clone(
        load()
          .payments.filter((item) => withinRange(item.at, from, to))
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
    await delay();
    const db = load();
    const days = weekDays(anchor);
    const from = days[0] ?? anchor;
    const to = days[6] ?? anchor;
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);

    const weekLessons = db.lessons.filter((lesson) => withinRange(lesson.startsAt, from, toEnd));

    return clone({
      from: from.toISOString(),
      to: toEnd.toISOString(),
      days: days.map((day) => dateKey(day)),
      rooms: roomUtilization(db.classrooms, weekLessons, days),
      hourly: hourlyLoad(weekLessons),
      teachers: teacherWorkload(db.teachers, weekLessons),
      churn: churnStats(db.students),
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

  /** 学生维度的欠费合计（列表里显示）。 */
  async outstandingByStudent(): Promise<Array<{ studentId: string; amount: number }>> {
    await delay();
    const db = load();
    return clone(
      db.students
        .map((student) => ({
          studentId: student.id,
          amount: round2(
            student.enrollments
              .filter((enrollment) => enrollment.status === "在读")
              .reduce((sum, enrollment) => sum + outstandingAmount(enrollment), 0),
          ),
        }))
        .filter((item) => item.amount > 0),
    );
  },

  /** 课时流水（只读；写入由报课 / 续费 / 上课 / 撤销等业务动作负责）。 */
  transactions: {
    listByStudent: async (studentId: string): Promise<LessonTransaction[]> => {
      await delay();
      return clone(
        load()
          .transactions.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.at.localeCompare(a.at)),
      );
    },
    listByEnrollment: async (enrollmentId: string): Promise<LessonTransaction[]> => {
      await delay();
      return clone(
        load()
          .transactions.filter((item) => item.enrollmentId === enrollmentId)
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
  lessonRecords: {
    ...collection<LessonRecord>((db) => db.lessonRecords, "lr"),
    listByLesson: async (lessonId: string): Promise<LessonRecord[]> => {
      await delay();
      return clone(load().lessonRecords.filter((item) => item.lessonId === lessonId));
    },
    listByStudent: async (studentId: string): Promise<LessonRecord[]> => {
      await delay();
      return clone(
        load()
          .lessonRecords.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      );
    },
    /** 按「课节 + 学生」写入；已存在则更新。 */
    async save(input: NewLessonRecord): Promise<LessonRecord> {
      await delay();
      const db = load();
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

  /** 作业记录（按次）。 */
  homework: {
    ...collection<HomeworkRecord>((db) => db.homeworkRecords, "hw", "作业记录"),
    listByStudent: async (studentId: string): Promise<HomeworkRecord[]> => {
      await delay();
      return clone(
        load()
          .homeworkRecords.filter((item) => item.studentId === studentId)
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
    ...collection<Assessment>((db) => db.assessments, "as", "测评"),
    listByStudent: async (studentId: string): Promise<Assessment[]> => {
      await delay();
      return clone(
        load()
          .assessments.filter((item) => item.studentId === studentId)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    },
    async add(input: NewAssessment): Promise<Assessment> {
      await delay();
      const db = load();
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
     */
    async update(id: string, patch: Partial<Omit<Lesson, "id">>): Promise<Lesson | null> {
      await delay();
      const db = load();
      const lesson = db.lessons.find((item) => item.id === id);
      if (lesson === undefined) return null;

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

      Object.assign(lesson, patch);

      if (wasCompleted && becomesNotCompleted) {
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
          }
        }
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
      await delay();
      const db = load();
      const lesson = db.lessons.find((item) => item.id === id);
      if (lesson === undefined) {
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
    /** 某一天的课，按开始时间升序。 */
    async listByDate(date: Date): Promise<Lesson[]> {
      await delay();
      const key = dateKey(date);
      return clone(
        load()
          .lessons.filter((lesson) => dateKey(lesson.startsAt) === key)
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
      await delay();
      const db = load();
      const original = db.lessons.find((item) => item.id === input.originalLessonId);
      if (original === undefined) return null;

      /*
       * 补课同样占用教师与教室、同样扣 1 节课时 —— 因此也过"课时够不够"这一关：
       * 课时不足时先续费，再排补课（否则补课本身又变成一笔欠账）。
       */
      const makeupStudents = input.studentIds.length > 0 ? input.studentIds : original.studentIds;
      const shortage = insufficientLessons(db, {
        subject: original.subject,
        studentIds: makeupStudents,
        count: 1,
      });
      if (shortage !== null) throw new Error(shortage.message);

      const created: Lesson = {
        id: nextId("l"),
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
      await delay();
      const db = load();
      const rows: Array<{ original: Lesson; student: Student; record: LessonRecord; reason: string }> = [];

      for (const record of db.lessonRecords) {
        if (!isAbsent(record)) continue;

        const original = db.lessons.find((item) => item.id === record.lessonId);
        if (original === undefined || original.status === "已取消") continue;

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
      await delay();
      return clone(
        load()
          .lessons.filter((lesson) => lesson.studentIds.includes(studentId))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 某个教师的课，按时间升序（教师详情用）。 */
    async listByTeacher(teacherId: string): Promise<Lesson[]> {
      await delay();
      return clone(
        load()
          .lessons.filter((lesson) => lesson.teacherId === teacherId)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 某个教室的课，按时间升序（教室占用用）。 */
    async listByClassroom(classroomId: string): Promise<Lesson[]> {
      await delay();
      return clone(
        load()
          .lessons.filter((lesson) => lesson.classroomId === classroomId)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
    /** 一段区间内的课（含首尾两天）。 */
    async listBetween(from: Date, to: Date): Promise<Lesson[]> {
      await delay();
      const fromKey = dateKey(from);
      const toKey = dateKey(to);
      return clone(
        load()
          .lessons.filter((lesson) => {
            const key = dateKey(lesson.startsAt);
            return key >= fromKey && key <= toKey;
          })
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      );
    },
  },

  /** 今日概览的汇总。 */
  async today(now: Date = new Date()): Promise<TodaySummary> {
    await delay();
    const db = load();
    const key = dateKey(now);
    const todays = db.lessons.filter((lesson) => dateKey(lesson.startsAt) === key);

    const classroomUsage = db.classrooms.map((classroom) => ({
      classroom,
      lessonCount: todays.filter((lesson) => lesson.classroomId === classroom.id).length,
    }));

    return clone({
      date: key,
      lessonCount: todays.length,
      teacherCount: new Set(todays.map((lesson) => lesson.teacherId)).size,
      totalMinutes: todays.reduce((total, lesson) => total + lesson.durationMinutes, 0),
      classroomUsage,
      lowLessonStudents: db.students
        .filter((student) => student.status !== "结课")
        .map((student) => ({ student, remainingLessons: remainingTotal(student.enrollments) }))
        // 没有任何在读报课的学生也算「需要跟进」，否则会从预警里消失
        .filter((item) => item.remainingLessons <= 5)
        .sort((a, b) => a.remainingLessons - b.remainingLessons),
      studentCount: db.students.length,
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

    // 备份当前数据（只保留最近一次，避免存储被备份撑满）
    store.write(BACKUP_KEY, JSON.stringify(load()));

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
    return store.read(BACKUP_KEY) !== null;
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

    /**
     * 批量导入（**从网站内容**）。
     *
     * 网站上现成有两份真实名单：教师团队与场地名。机构刚起步时不必手录一遍。
     * 走的是**同一套**判定与落库（`applyImport`），因此冲突处理、判重、日志与文件导入一致。
     * 只支持 `teachers` 与 `classrooms`：课程已有「从网站同步课程」，学生网站上没有。
     */
    async fromSite(input: {
      entity: SiteImportSource;
      onConflict?: ConflictStrategy | "ask";
      perRow?: Record<string, ConflictStrategy>;
    }): Promise<ImportReport> {
      await delay();
      const data = siteImportRecords(input.entity);
      const parsed: ParsedImport = {
        entity: input.entity,
        records: data.records,
        problems: [],
        headers: Object.keys(data.records[0] ?? {}),
        unknownHeaders: [],
        missingRequiredHeaders: [],
      };
      return runImport(load(), parsed, {
        strategy: input.onConflict ?? "skip",
        perRow: input.perRow,
        source: `网站内容（${data.description}）`,
        headers: parsed.headers,
        unknownHeaders: [],
        missingRequiredHeaders: [],
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
     * **把网站内容搬进库**（教师资料 / 课程卡片字段 / 课程正文 / 报价文案）。
     *
     * `write: false` 是体检：逐条列出"会补什么、会新增什么、跳过了什么"，
     * **一个字都不写**（在深拷贝上算，见 `lib/backend/site-import.ts`）。
     * 界面上先给人看这份清单，再用 `write: true` 落库。
     *
     * 默认**只补空、不覆盖**：机构在后台改过的内容不能被一次导入冲掉；
     * 确实要用内容文件整体替换时传 `overwrite: true`（课程正文那一段尤其要看清楚）。
     */
    async importFromContent(
      options: { write?: boolean; overwrite?: boolean } = {},
    ): Promise<SiteContentImportReport> {
      await delay();
      const db = load();
      const report = importSiteContent(db, {
        write: options.write === true,
        overwrite: options.overwrite === true,
      });
      if (report.written) {
        writeLog(db, {
          entity: "数据",
          action: "导入网站内容",
          targetId: "",
          summary: `从网站内容导入：${report.changes.slice(0, 3).join("；")}${
            report.changes.length > 3 ? ` 等 ${report.changes.length} 项` : ""
          }`,
        });
        persist(db);
      }
      return clone(report);
    },
  },

  pricing: {
    /** 当前报价配置。 */
    async get(): Promise<PricingConfig> {
      await delay();
      return clone(load().pricing);
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
      const before = db.pricing;
      db.pricing = {
        ...clone(input),
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
      db.pricing = pricingConfigFromContent();
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
      return quoteSelection(load().pricing, selection);
    },

    /**
     * 算教师课时费（分成）：教师拿多少、机构留多少。
     *
     * 规则只收「哪门课 / 哪个班型 / 几个学生 / 多久」，**比例与课时单价一律由
     * 服务端按配置算** —— 教师工资和报价一样，不能让前端传数字进来。
     */
    async teacherFee(selection: TeacherFeeSelection): Promise<TeacherFeeResult> {
      await delay();
      return teacherFeeForSelection(load().pricing, selection);
    },

    /** 导出成可直接替换 `data/site/pricing.md` 的 Markdown 片段。 */
    async exportMarkdown(): Promise<string> {
      await delay();
      return pricingConfigToMarkdown(load().pricing);
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
    await delay();
    const db = load();
    return clone(
      searchAll({
        keyword,
        students: db.students,
        teachers: db.teachers,
        classrooms: db.classrooms,
        lessons: db.lessons,
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

/** 批量导入的返回结构（文件导入与"从网站导入"共用）。 */
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
 * 抽出来是为了让"从文件导入"与"从网站导入"**只有数据来源不同**：
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
  PublicSite,
  SiteContentImportReport,
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
  SUBMISSION_OPTIONS,
} from "./types";
