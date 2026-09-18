import { createKeyValueStore, type KeyValueStore } from "./storage";
import { createSeedDatabase } from "./seed";
import { isWithinAvailability } from "./availability";
import { CURRENT_VERSION } from "./version";
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
import {
  monthRange,
  outstandingAmount,
  round2,
  summarizePayments,
  withinRange,
  type PaymentSummary,
} from "./finance";
import type { StudentProfile } from "./student-profile";
import { getCourseColumns } from "@/lib/data/site";
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
  Lesson,
  NewClassroom,
  NewLesson,
  NewStudent,
  NewTeacher,
  Student,
  Teacher,
  TodaySummary,
  SearchHit,
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

/** 模拟网络延迟，让加载态、按钮禁用等交互在开发时就暴露出来。 */
const LATENCY_MS = 120;

let store: KeyValueStore = createKeyValueStore();
let cache: Database | null = null;

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

function nowIso(): string {
  return new Date().toISOString();
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

  cache = createSeedDatabase();
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
 * 记一笔课时流水。
 *
 * 所有课时变动都必须经这里：直接改 usedLessons 而不留流水，
 * 以后就没法回答「这些课时去哪了」。自检里有一条不变式校验两者的关系。
 */
function addTransaction(
  db: Database,
  input: Omit<LessonTransaction, "id" | "at" | "reversedAt">,
): LessonTransaction {
  const created: LessonTransaction = {
    ...input,
    id: nextId("tx"),
    at: nowIso(),
    reversedAt: "",
  };
  db.transactions.push(created);
  return created;
}

/**
 * 记一笔收款 / 退款，并同步报课记录上的实收累计。
 *
 * 金额只允许通过这里改动：把 paidAmount 手工改来改去，
 * 「收了多少钱」这件事就再也对不上账了（自检会校验两者一致）。
 */
function recordPayment(db: Database, input: Omit<Payment, "id">): Payment {
  const created: Payment = { ...input, id: nextId("pay") };
  db.payments.push(created);

  const enrollment = db.students
    .flatMap((student) => student.enrollments)
    .find((item) => item.id === input.enrollmentId);
  if (enrollment !== undefined) {
    enrollment.paidAmount = round2(
      Math.max(0, enrollment.paidAmount + (input.kind === "退款" ? -input.amount : input.amount)),
    );
  }

  return created;
}

/**
 * 按出勤事实对账：让这位学生这节课的扣减与「该不该扣」一致。
 *
 * 为什么需要「对账」而不是「扣一次就完事」：出勤是**会变的** ——
 * 老师先标了「到课」扣了课时，后来发现是提前请假；或者先标了请假、后来补录了
 * 请假时间。任何一次改动都可能让「已扣」与「应扣」不一致，
 * 而对账是唯一能保证两者最终一致的写法（增扣、退回都由它统一处理）。
 *
 * 幂等：反复调用不会重复扣。
 */
function reconcileCharge(
  db: Database,
  lesson: Lesson,
  studentId: string,
): { changed: boolean; charged: boolean; reason: string } {
  const record = db.lessonRecords.find(
    (item) => item.lessonId === lesson.id && item.studentId === studentId,
  );
  const decision = decideCharge(lesson, record);

  const active = db.transactions.filter(
    (item) =>
      item.lessonId === lesson.id &&
      item.studentId === studentId &&
      item.kind === "上课" &&
      item.reversedAt === "",
  );
  const actual = active.length;
  const expected = decision.charge ? 1 : 0;

  if (actual === expected) return { changed: false, charged: decision.charge, reason: decision.reason };

  const student = db.students.find((item) => item.id === studentId);
  if (student === undefined) return { changed: false, charged: decision.charge, reason: decision.reason };

  if (expected > actual) {
    // 该扣但没扣：补扣（按科目找报课记录；找不到就如实跳过）
    const enrollment = enrollmentForLesson(student.enrollments, lesson.subject);
    if (enrollment === null) {
      return { changed: false, charged: decision.charge, reason: `${decision.reason}（没有对应报课记录，未扣）` };
    }
    enrollment.usedLessons += 1;
    addTransaction(db, {
      studentId,
      enrollmentId: enrollment.id,
      subject: enrollment.subject,
      delta: -1,
      kind: "上课",
      lessonId: lesson.id,
      note: decision.reason,
    });
    return { changed: true, charged: true, reason: decision.reason };
  }

  // 不该扣但扣了：按流水退回（撤销而不是删除，便于追溯）
  let toReverse = actual - expected;
  for (const transaction of [...active].reverse()) {
    if (toReverse <= 0) break;
    transaction.reversedAt = nowIso();
    const enrollment = student.enrollments.find((item) => item.id === transaction.enrollmentId);
    if (enrollment !== undefined) {
      enrollment.usedLessons = Math.max(0, enrollment.usedLessons - 1);
    }
    toReverse -= 1;
  }
  return { changed: true, charged: false, reason: decision.reason };
}

/**
 * 操作日志的保留上限。
 *
 * 日志本身也占存储：无上限地涨下去，几年后一份 JSON 会大到导不出来。
 * 500 条足够回溯「最近发生了什么」，超出后丢最旧的。
 */
const LOG_LIMIT = 500;

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

export const api = {
  students: {
    ...studentCollection,
    /** 建档时间由服务生成；新建时不带报课记录（报课走 enroll()）。 */
    async create(input: NewStudent): Promise<Student> {
      const { subjects, ...rest } = input;
      return studentCollection.create({
        ...rest,
        subjects: subjects ?? [],
        profile: input.profile ?? {},
        enrollments: [],
        createdAt: new Date().toISOString(),
      });
    },
    /**
     * 报课：新开一条报课记录。
     *
     * 同科目同班型的在读记录不会被合并 —— 合并会掩盖「报了两次」的事实，
     * 续费请用 renewEnrollment()，那条会累加课时并留下流水。
     */
    async enroll(studentId: string, input: NewEnrollment): Promise<Student | null> {
      await delay();
      const db = load();
      const student = db.students.find((item) => item.id === studentId);
      if (student === undefined) return null;

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

      syncSubjects(student);
      writeLog(db, {
        entity: "报课",
        action: "报课",
        targetId: enrollment.id,
        summary: `${student.name} 报课「${enrollment.subject}」${lessons} 节`,
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

      enrollment.totalLessons = Math.max(0, enrollment.totalLessons + Math.trunc(delta));
      enrollment.history.push({
        at: nowIso(),
        kind: "续费",
        lessons: Math.trunc(delta),
        note: note.trim() === "" ? "手工调整" : note.trim(),
      });

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

  teachers: {
    ...collection<Teacher>((db) => db.teachers, "t", "教师"),
    /** 在职教师，排课下拉用。 */
    async listActive(): Promise<Teacher[]> {
      await delay();
      return clone(load().teachers.filter((teacher) => teacher.active));
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
    ...collection<Lesson>((db) => db.lessons, "l", "排课"),

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
      const db = load();

      const start = new Date(input.startsAt).getTime();
      const end = start + input.durationMinutes * 60_000;
      const overlaps = (lesson: Lesson) => {
        // 编辑自己时不算冲突；已取消的课不占用时间
        if (lesson.id === input.id || lesson.status === "已取消") return false;
        const otherStart = new Date(lesson.startsAt).getTime();
        const otherEnd = otherStart + lesson.durationMinutes * 60_000;
        // 相邻不算冲突（结束等于开始）
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

      // 同一节课既撞教师又撞教室时，students 里可能出现重复，这里去重
      const uniqueStudents = [
        ...new Map(students.map((item) => [`${item.studentId}-${item.lesson.id}`, item])).values(),
      ];

      // 教室在该时段是否开放：没设可用时段的教室视为不限，永远为 false
      const room = db.classrooms.find((item) => item.id === input.classroomId);
      const classroomClosed =
        room !== undefined &&
        !isWithinAvailability(room.availability, new Date(input.startsAt), input.durationMinutes);

      /*
       * 容量校验：学生数不能超过教室容量。
       * 这类问题不会「撞课」，但会把学生塞进坐不下的房间 —— 属于排课时就该拦住的事。
       */
      const overCapacity =
        room !== undefined && room.capacity > 0 && input.studentIds.length > room.capacity
          ? { capacity: room.capacity, students: input.studentIds.length }
          : null;

      /*
       * 教师科目校验：教师的「可带科目」里是否包含这节课的科目。
       * 匹配规则与前台教师卡片一致（科目名出现在课程名里，如「物理」命中「高中物理」）；
       * 教师没有登记科目时跳过 —— 没登记不等于不能带。
       */
      const assigned = db.teachers.find((item) => item.id === input.teacherId);
      const teacherSubjectMismatch =
        assigned !== undefined &&
        assigned.subjects.length > 0 &&
        !assigned.subjects.some((subject) => input.subject.includes(subject));

      return clone({
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
        return { lesson: null, deducted: [], skipped: [], alreadyCompleted: false };
      }

      const alreadyCompleted = lesson.status === "已上";
      const deducted: CompletionResult["deducted"] = [];
      const skipped: CompletionResult["skipped"] = [];

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

      return clone({ lesson, deducted, skipped, alreadyCompleted });
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

  /** 是否存在「导入前的备份」。 */
  hasBackup(): boolean {
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
  setOperator,

  /** 清空并重新灌入示例数据（开发与演示用）。 */
  async reset(): Promise<void> {
    await delay();
    cache = createSeedDatabase();
    writeLog(cache, {
      entity: "数据",
      action: "重置",
      targetId: "",
      summary: "重置为示例数据（原有数据已丢弃）",
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
        courses: getCourseColumns().flatMap((column) =>
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
export type BackendApi = typeof api;

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
  SUBMISSION_OPTIONS,
} from "./types";
