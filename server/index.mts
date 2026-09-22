/**
 * 后端服务（开发阶段，第 3 步：只读接口）。
 *
 * 这一层只做两件事：
 *   1. 把数据库行转成页面用的 JSON 形状（camelCase、嵌套结构从 JSON 列解析回来）；
 *   2. 用最直白的路由把这几个只读接口暴露出来。
 *
 * 还没有的（下一步）：写接口（报课/收款/排课/标记已上…）、鉴权、CORS 或同源代理。
 *
 * 一个刻意的选择：**映射写在服务端，不写在 SQL 里**。用 `AS camelCase` 看着更短，
 * 但映射逻辑会散在每条查询里，将来改字段名要找十几处；集中在这里改一次就够。
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { openDatabase, DB_PATH } from "./db.mts";
import { acquireDbLock } from "./db-lock.mts";
import { createSqliteStore, snapshotSize } from "./kv-store.mts";
// 伪后端的**同一份实现**：服务端只是换了一个 KeyValueStore，业务口径一行都不用重写
import { api, __useStoreForTesting } from "../lib/backend/api.ts";
/*
 * 版本冲突的类型：接口层要靠**类型**把它翻成 409。
 * 不按错误文字匹配是有意的（见下面 /api/call 的错误分支）——
 * 那种做法改一个字就悄悄失效，而这正是"冲突被当成参数错误"的开始。
 */
import { VersionConflictError } from "../lib/backend/concurrency.ts";
import { createEmptyDatabase } from "../lib/backend/initial.ts";
import { createSeedDatabase } from "../lib/backend/seed.ts";
import { currentVersion, migrate } from "./migrate.mts";
// 备份策略（每天一份 + 保留份数）只在这一处实现，见 server/backup.mts
import { backupDir, backupIfNotToday, backupsDisabled, latestBackup } from "./backup.mts";
// 会话认证（第 6 步）：口令与令牌都在服务端，见 server/auth.mts
import {
  activeSessionCount,
  credentialFile,
  login,
  logout,
  prepareCredential,
  tokenFromHeader,
  verifyToken,
  type Session,
} from "./auth.mts";
// 多账号与角色（第 7 步）：账号表在 server/accounts.mts（口令与角色都在服务端）
import { accountBootstrapNote } from "./accounts.mts";
// 权限的"一份数据"：**方法级判定只有这一处**（见下面的闸门 —— 服务端只调用它，不自己推）
import { allowedRolesForMethod, canAccess, groupOfMethod, type Role } from "../lib/auth/roles.ts";
// 接口契约：分组只用来写错误文案（"运维与审计"），判定不经过它
import { API_CONTRACT } from "../lib/backend/contract.ts";
// 复用伪后端阶段的纯函数：课时记账与剩余课时的口径只能有一份
import { enrollmentForLesson, remainingTotal } from "../lib/backend/enrollment.ts";
// 金额与退费口径、请假扣课时规则：同样只复用伪后端阶段的纯函数
import { findRefundPolicy, round2 } from "../lib/backend/finance.ts";
import { decideCharge } from "../lib/backend/attendance.ts";
// 报价与课程库：口径同样只有一份（前台/后台/服务端共用）
import {
  pricingConfigFromContent,
  pricingConfigToMarkdown,
  quoteSelection,
  teacherFeeForSelection,
  validatePricingConfig,
  PRICING_SOURCE_ADMIN,
  PRICING_SOURCE_CONTENT,
  type PricingConfig,
} from "../lib/backend/pricing.ts";
import { mergeSiteCourses, summarizeCourses } from "../lib/backend/courses.ts";

const PORT = Number(process.env.PORT ?? 4000);

/** health 里统计的表（加表时同步加进来）。 */
const COUNTED_TABLES = [
  "students", "teachers", "classrooms", "lessons", "lesson_records", "homework_records",
  "assessments", "transactions", "payments", "courses", "logs", "inquiries", "site_content",
];

/** JSON 列解析：失败返回兜底值，而不是让整个接口 500。 */
function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

type Row = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));

/* ── 行 → 页面形状 ──────────────────────────────────────────────────── */

const toStudent = (row: Row) => ({
  id: str(row.id),
  name: str(row.name),
  grade: str(row.grade),
  guardian: str(row.guardian),
  status: str(row.status),
  note: str(row.note),
  createdAt: str(row.created_at),
  enrollments: parseJson(row.enrollments, [] as unknown[]),
  profile: parseJson(row.profile, {} as Record<string, unknown>),
});

const toTeacher = (row: Row) => ({
  id: str(row.id),
  name: str(row.name),
  role: str(row.role),
  subjects: parseJson(row.subjects, [] as string[]),
  phone: str(row.phone),
  active: num(row.active) === 1,
});

const toClassroom = (row: Row) => ({
  id: str(row.id),
  name: str(row.name),
  capacity: num(row.capacity),
  kind: str(row.kind),
  availability: parseJson(row.availability, [] as unknown[]),
  note: str(row.note),
});

const toLesson = (row: Row) => ({
  id: str(row.id),
  subject: str(row.subject),
  form: str(row.form),
  teacherId: str(row.teacher_id),
  classroomId: str(row.classroom_id),
  studentIds: parseJson(row.student_ids, [] as string[]),
  startsAt: str(row.starts_at),
  durationMinutes: num(row.duration_minutes),
  status: str(row.status),
  note: str(row.note),
  makeupForLessonId: str(row.makeup_for_lesson_id),
});

const toCourse = (row: Row) => ({
  id: str(row.id),
  name: str(row.name),
  category: str(row.category),
  forms: parseJson(row.forms, [] as string[]),
  origin: str(row.origin),
  status: str(row.status),
  note: str(row.note),
  createdAt: str(row.created_at),
});


const toLessonRecord = (row: Row) => ({
  id: str(row.id), lessonId: str(row.lesson_id), studentId: str(row.student_id),
  attendance: str(row.attendance), leaveRequestedAt: str(row.leave_requested_at),
  focus: str(row.focus), interaction: str(row.interaction), rating: num(row.rating),
  note: str(row.note), recordedAt: str(row.recorded_at),
});

const toHomework = (row: Row) => ({
  id: str(row.id), studentId: str(row.student_id), date: str(row.date), subject: str(row.subject),
  submission: str(row.submission), accuracy: str(row.accuracy), weakPoints: str(row.weak_points),
  note: str(row.note),
});

const toAssessment = (row: Row) => ({
  id: str(row.id), studentId: str(row.student_id), subject: str(row.subject), date: str(row.date),
  score: row.score === null ? null : num(row.score),
  previousScore: row.previous_score === null ? null : num(row.previous_score),
  weakPoints: str(row.weak_points), note: str(row.note),
});

const toPayment = (row: Row) => ({
  id: str(row.id), studentId: str(row.student_id), enrollmentId: str(row.enrollment_id),
  amount: num(row.amount), kind: str(row.kind), method: str(row.method), at: str(row.at),
  note: str(row.note),
});

const toTransaction = (row: Row) => ({
  id: str(row.id), studentId: str(row.student_id), enrollmentId: str(row.enrollment_id),
  subject: str(row.subject), delta: num(row.delta), kind: str(row.kind),
  lessonId: str(row.lesson_id), at: str(row.at), note: str(row.note),
  reversedAt: str(row.reversed_at),
});

const toInquiry = (row: Row) => ({
  id: str(row.id),
  studentName: str(row.student_name),
  grade: str(row.grade),
  guardian: str(row.guardian),
  subject: str(row.subject),
  durationMinutes: num(row.duration_minutes),
  intervalWeeks: num(row.interval_weeks),
  plannedLessons: num(row.planned_lessons),
  startsAt: str(row.starts_at),
  candidates: parseJson(row.candidates, [] as unknown[]),
  preferredTeacherId: str(row.preferred_teacher_id),
  preferredClassroomId: str(row.preferred_classroom_id),
  skipDates: parseJson(row.skip_dates, [] as string[]),
  status: str(row.status),
  note: str(row.note),
  scheduledLessonIds: parseJson(row.scheduled_lesson_ids, [] as string[]),
  createdAt: str(row.created_at),
});

const toLog = (row: Row) => ({
  id: str(row.id), at: str(row.at), operator: str(row.operator), entity: str(row.entity),
  action: str(row.action), targetId: str(row.target_id), summary: str(row.summary),
});

/* ── 小表的按视图取数（界面高频调用，做成查询参数而不是整表拉回前端过滤）── */

type ReadSpec = {
  path: string;
  /** 真实表名（**不从路径推导**：`homework` 的表叫 `homework_records`，推导会写错） */
  table: string;
  to: (row: Row) => unknown;
  /** 允许的过滤参数（camelCase）→ 列名。 */
  filters: Record<string, string>;
  order: string;
  limitParam?: string;
};

const READS: ReadSpec[] = [
  { path: "payments", table: "payments", to: toPayment, filters: { studentId: "student_id", enrollmentId: "enrollment_id" }, order: "at DESC" },
  { path: "transactions", table: "transactions", to: toTransaction, filters: { studentId: "student_id", enrollmentId: "enrollment_id", lessonId: "lesson_id" }, order: "at DESC" },
  { path: "lesson-records", table: "lesson_records", to: toLessonRecord, filters: { lessonId: "lesson_id", studentId: "student_id" }, order: "recorded_at DESC" },
  { path: "homework", table: "homework_records", to: toHomework, filters: { studentId: "student_id" }, order: "date DESC" },
  { path: "assessments", table: "assessments", to: toAssessment, filters: { studentId: "student_id" }, order: "date DESC" },
  { path: "logs", table: "logs", to: toLog, filters: { entity: "entity" }, order: "at DESC", limitParam: "limit" },
];

/** 按过滤器拼 WHERE（只认白名单里的列，参数一律走占位符）。 */
function readRows(db: Database.Database, spec: ReadSpec, url: URL): unknown[] {
  const where: string[] = [];
  const values: string[] = [];
  for (const [param, column] of Object.entries(spec.filters)) {
    const value = url.searchParams.get(param);
    if (value !== null && value !== "") {
      where.push(`${column} = ?`);
      values.push(value);
    }
  }
  const limit = spec.limitParam === undefined ? null : Number(url.searchParams.get(spec.limitParam) ?? 0);
  const sql =
    `SELECT * FROM ${spec.table}` +
    (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY ${spec.order}` +
    (limit !== null && Number.isFinite(limit) && limit > 0 ? ` LIMIT ${Math.floor(limit)}` : "");
  return (db.prepare(sql).all(...values) as Row[]).map(spec.to);
}

/* ── 路由 ───────────────────────────────────────────────────────────── */

type Handler = (db: Database.Database, url: URL) => unknown;

/** 只读接口：路径 → 处理函数。加接口时在这里加一行。 */
const ROUTES: Record<string, Handler> = {
  "/api/students": (db) =>
    (db.prepare("SELECT * FROM students ORDER BY created_at").all() as Row[]).map(toStudent),
  "/api/teachers": (db) =>
    (db.prepare("SELECT * FROM teachers ORDER BY name").all() as Row[]).map(toTeacher),
  "/api/classrooms": (db) =>
    (db.prepare("SELECT * FROM classrooms ORDER BY name").all() as Row[]).map(toClassroom),
  "/api/courses": (db) =>
    (db.prepare("SELECT * FROM courses ORDER BY category, name").all() as Row[]).map(toCourse),

  /** 排课支持按区间过滤（`?from=ISO&to=ISO`），与页面的按天/按周口径一致。 */
  "/api/lessons": (db, url) => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const date = url.searchParams.get("date");
    const studentId = url.searchParams.get("studentId");
    const teacherId = url.searchParams.get("teacherId");
    const classroomId = url.searchParams.get("classroomId");

    const where: string[] = [];
    const values: string[] = [];
    if (date !== null && date !== "") {
      // 单日：按本地日历日切，与「今日概览」同一口径
      const start = new Date(`${date}T00:00:00`);
      where.push("starts_at >= ? AND starts_at < ?");
      values.push(start.toISOString(), new Date(start.getTime() + 86_400_000).toISOString());
    } else if (from !== null && to !== null) {
      where.push("starts_at >= ? AND starts_at < ?");
      values.push(from, to);
    }
    if (teacherId !== null && teacherId !== "") {
      where.push("teacher_id = ?");
      values.push(teacherId);
    }
    if (classroomId !== null && classroomId !== "") {
      where.push("classroom_id = ?");
      values.push(classroomId);
    }

    let rows = db
      .prepare(
        `SELECT * FROM lessons${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY starts_at`,
      )
      .all(...values) as Row[];

    // 学生筛选走 JSON 列：SQLite 的 json_each 比在 Node 里过滤更省事，也避免全表拉回
    if (studentId !== null && studentId !== "") {
      const ids = db
        .prepare(
          "SELECT DISTINCT l.id FROM lessons l, json_each(l.student_ids) je WHERE je.value = ?",
        )
        .all(studentId) as Array<{ id: string }>;
      const wanted = new Set(ids.map((item) => item.id));
      rows = rows.filter((row) => wanted.has(str(row.id)));
    }
    return rows.map(toLesson);
  },

  /** 单个学生（学生详情页）。 */
  "/api/students/get": (db, url) => {
    const id = url.searchParams.get("id") ?? "";
    const row = db.prepare("SELECT * FROM students WHERE id = ?").get(id) as Row | undefined;
    return row === undefined ? null : toStudent(row);
  },

  /** 咨询线索列表（按创建时间倒序，最近的在上）。 */
  "/api/inquiries": (db) =>
    (db.prepare("SELECT * FROM inquiries ORDER BY created_at DESC").all() as Row[]).map(toInquiry),

  /** 在职教师（排课下拉用）。 */
  "/api/teachers/active": (db) =>
    (db.prepare("SELECT * FROM teachers WHERE active = 1 ORDER BY name").all() as Row[]).map(toTeacher),

  /**
   * 今日概览：今天的课 + 每间教室今天几节。
   *
   * 口径与伪后端一致：一天按**本地日历日**算，已取消的课不计入教室占用。
   * 课时预警还没搬过来 —— 下一步接 `lib/backend/followup.ts` 的纯函数时会把阈值与理由一并带上，
   * 现在先不在这里写一个"看起来差不多"的版本（两套口径比一套慢更危险）。
   */
  "/api/today": (db, url) => {
    const day = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${day}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);

    const lessons = (
      db
        .prepare("SELECT * FROM lessons WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at")
        .all(start.toISOString(), end.toISOString()) as Row[]
    ).map(toLesson);

    const classrooms = (db.prepare("SELECT * FROM classrooms ORDER BY name").all() as Row[]).map(
      toClassroom,
    );
    const activeLessons = lessons.filter((lesson) => lesson.status !== "已取消");

    return {
      date: day,
      lessons,
      classroomUsage: classrooms.map((classroom) => ({
        classroom,
        lessonCount: activeLessons.filter((lesson) => lesson.classroomId === classroom.id).length,
      })),
    };
  },
};

/** 读请求体（只接受 JSON，超过 1MB 直接拒绝）。 */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 1_000_000) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

const nextId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/**
 * 当前请求的操作人（来自会话，见 `requireAuth`）。
 *
 * 这里原来是**写死的 "admin"** —— 于是走老 REST 接口的每一次写入，日志里的操作人
 * 都是"admin"，不管登录的是谁。单用户时看不出问题，等到真有两个账号，
 * "谁改的"这条线就断了，而且断得毫无提示。
 *
 * 用模块级变量是刻意的取舍（与 `api.ts` 的 `operatorName` 一致）：本系统定位是
 * 单用户本机使用，一个请求一个操作人足够。**多用户并发时要改成随请求一路传下去**
 * （那时它才会真的出错：A 的写入可能被记成 B 干的）。
 */
let currentOperator = "admin";

function writeLog(
  db: Database.Database,
  entry: { entity: string; action: string; targetId: string; summary: string },
): void {
  db.prepare(
    "INSERT INTO logs (id, at, operator, entity, action, target_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(nextId("log"), new Date().toISOString(), currentOperator, entry.entity, entry.action, entry.targetId, entry.summary);
}

/** 读一个学生（行 → 页面形状），找不到返回 null。 */
function loadStudent(db: Database.Database, id: string): ReturnType<typeof toStudent> | null {
  const row = db.prepare("SELECT * FROM students WHERE id = ?").get(id) as Row | undefined;
  return row === undefined ? null : toStudent(row);
}

type WriteResult = { status: number; payload: unknown };

/** 写接口：都要求 `一个请求 = 一个事务`，失败整批回滚。 */
const WRITES: Array<{
  method: string;
  pattern: RegExp;
  handle: (db: Database.Database, match: RegExpMatchArray, body: Record<string, unknown>) => WriteResult;
}> = [
  {
    method: "POST",
    pattern: /^\/api\/students$/,
    handle: (db, _match, body) => {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name === "") return { status: 400, payload: { error: "学生姓名必填" } };
      const id = nextId("s");
      const run = db.transaction(() => {
        db.prepare(
          "INSERT INTO students (id, name, grade, guardian, status, note, created_at, enrollments, profile) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}')",
        ).run(id, name, String(body.grade ?? ""), String(body.guardian ?? ""), String(body.status ?? "在读"), String(body.note ?? ""), new Date().toISOString());
        writeLog(db, { entity: "学生", action: "新建", targetId: id, summary: `新建学生「${name}」` });
      });
      run();
      return { status: 201, payload: loadStudent(db, id) };
    },
  },
  {
    /** 报课：报课记录 + 课时流水 + （可选）收款，必须是同一个事务。 */
    method: "POST",
    pattern: /^\/api\/students\/([^/]+)\/enroll$/,
    handle: (db, match, body) => {
      const student = loadStudent(db, match[1] ?? "");
      if (student === null) return { status: 404, payload: { error: "没有这个学生" } };

      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const totalLessons = Number(body.totalLessons ?? 0);
      if (subject === "") return { status: 400, payload: { error: "报课科目必填（取自课程库）" } };
      if (!Number.isFinite(totalLessons) || totalLessons < 1) {
        return { status: 400, payload: { error: "报课节数至少 1 节" } };
      }

      const enrollment = {
        id: nextId("e"),
        subject,
        form: String(body.form ?? ""),
        teacherId: String(body.teacherId ?? ""),
        totalLessons,
        usedLessons: 0,
        unitPrice: Number(body.unitPrice ?? 0),
        agreedAmount: Number(body.agreedAmount ?? 0),
        paidAmount: 0,
        startedAt: new Date().toISOString(),
        endedAt: "",
        status: "在读",
        note: String(body.note ?? ""),
        history: [{ at: new Date().toISOString(), kind: "报课", lessons: totalLessons, note: "" }],
      };
      const paidNow = Number(body.paidNow ?? 0);

      const run = db.transaction(() => {
        const enrollments = [...(student.enrollments as typeof enrollment[]), enrollment];
        db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(JSON.stringify(enrollments), student.id);

        // 课时流水（账本）：正数表示加课时
        db.prepare(
          "INSERT INTO transactions (id, student_id, enrollment_id, subject, delta, kind, lesson_id, at, note, reversed_at) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '')",
        ).run(nextId("tx"), student.id, enrollment.id, subject, totalLessons, "报课", new Date().toISOString(), "报课");

        if (paidNow > 0) {
          enrollment.paidAmount = paidNow;
          db.prepare(
            "INSERT INTO payments (id, student_id, enrollment_id, amount, kind, method, at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(nextId("p"), student.id, enrollment.id, paidNow, "收款", String(body.method ?? "微信"), new Date().toISOString(), "报课收款");
          db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(JSON.stringify(enrollments), student.id);
        }

        writeLog(db, {
          entity: "学生",
          action: "报课",
          targetId: student.id,
          summary: `「${student.name}」报课：${subject} ${totalLessons} 节${paidNow > 0 ? `，收款 ${paidNow} 元` : ""}`,
        });
      });
      run();

      const updated = loadStudent(db, student.id)!;
      return { status: 201, payload: updated };
    },
  },
  {
    /** 排课：建一节课。冲突检测还没搬过来（见文件顶部说明），先只做基本校验。 */
    method: "POST",
    pattern: /^\/api\/lessons$/,
    handle: (db, _match, body) => {
      const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
      if (startsAt === "" || Number.isNaN(new Date(startsAt).getTime())) {
        return { status: 400, payload: { error: "上课时间必填且必须是合法时间" } };
      }
      const id = nextId("l");
      db.prepare(
        "INSERT INTO lessons (id, subject, form, teacher_id, classroom_id, student_ids, starts_at, duration_minutes, status, note, makeup_for_lesson_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '已排', ?, '')",
      ).run(id, String(body.subject ?? ""), String(body.form ?? ""), String(body.teacherId ?? ""), String(body.classroomId ?? ""), JSON.stringify(body.studentIds ?? []), startsAt, Number(body.durationMinutes ?? 60), String(body.note ?? ""));
      writeLog(db, { entity: "排课", action: "新建", targetId: id, summary: `排课：${String(body.subject ?? "")}` });
      const row = db.prepare("SELECT * FROM lessons WHERE id = ?").get(id) as Row;
      return { status: 201, payload: toLesson(row) };
    },
  },
  {
    /** 标记已上：按出勤扣课时，**幂等**（重复点不重复扣），课时不足时报错而不是静默截断。 */
    method: "POST",
    pattern: /^\/api\/lessons\/([^/]+)\/complete$/,
    handle: (db, match, body) => {
      const row = db.prepare("SELECT * FROM lessons WHERE id = ?").get(match[1] ?? "") as Row | undefined;
      if (row === undefined) return { status: 404, payload: { error: "没有这节课" } };
      const lesson = toLesson(row);
      if (lesson.status === "已上") return { status: 200, payload: { skipped: true, lesson, decisions: [] } };

      // 考勤：请求体里可带每名学生的出勤与请假时间，由 decideCharge 决定扣不扣
      const records = new Map<string, { attendance: string; leaveRequestedAt: string }>();
      for (const raw of Array.isArray(body.records) ? body.records : []) {
        const record = raw as Record<string, unknown>;
        records.set(String(record.studentId ?? ""), {
          attendance: String(record.attendance ?? "到课"),
          leaveRequestedAt: String(record.leaveRequestedAt ?? ""),
        });
      }
      const decisions: Array<{ studentId: string; charge: boolean; reason: string }> = [];

      const run = db.transaction(() => {
        for (const studentId of lesson.studentIds) {
          const student = loadStudent(db, studentId);
          if (student === null) continue;

          // 复用请假规则：提前 24 小时请假不扣课时，临时缺课扣
          const record = records.get(studentId);
          const decision = decideCharge(
            lesson,
            record === undefined
              ? undefined
              : { attendance: record.attendance, leaveRequestedAt: record.leaveRequestedAt } as never,
          );
          decisions.push({ studentId, charge: decision.charge, reason: decision.reason });
          if (!decision.charge) continue;
          // 复用纯函数：这节课该扣哪一条报课记录（同科目在读、取剩余最多）
          const enrollment = enrollmentForLesson(student.enrollments, lesson.subject);
          if (enrollment === null) continue;
          const remaining = remainingTotal(student.enrollments.filter((item) => item.id === enrollment.id));
          if (remaining < 1) {
            throw new Error(`「${student.name}」${lesson.subject} 课时不足（剩 ${remaining} 节），不能标记已上`);
          }
          db.prepare(
            "INSERT INTO transactions (id, student_id, enrollment_id, subject, delta, kind, lesson_id, at, note, reversed_at) VALUES (?, ?, ?, ?, -1, '上课', ?, ?, '', '')",
          ).run(nextId("tx"), studentId, enrollment.id, lesson.subject, lesson.id, new Date().toISOString());

          /*
           * 课时流水与报课记录必须一起改：`remainingOf` 读的是 enrollment.usedLessons
           * （存字段），只写流水不增加 usedLessons 的话，剩余课时永远不减少 ——
           * 扣课时会变成"记了账但没扣钱"，而且课时不足的拦截永远不会触发。
           */
          const nextEnrollments = student.enrollments.map((item) =>
            item.id === enrollment.id ? { ...item, usedLessons: item.usedLessons + 1 } : item,
          );
          db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(
            JSON.stringify(nextEnrollments),
            studentId,
          );
        }
        db.prepare("UPDATE lessons SET status = '已上' WHERE id = ?").run(lesson.id);
        writeLog(db, { entity: "排课", action: "标记已上", targetId: lesson.id, summary: `标记已上：${lesson.subject}` });
      });

      try {
        run();
      } catch (cause) {
        return { status: 400, payload: { error: cause instanceof Error ? cause.message : "扣课时失败" } };
      }
      const updated = db.prepare("SELECT * FROM lessons WHERE id = ?").get(lesson.id) as Row;
      return { status: 200, payload: { skipped: false, lesson: toLesson(updated), decisions } };
    },
  },
  {
    /** 续费：课时累加到原报课记录 + 课时流水（+ 可选收款），同一事务。 */
    method: "POST",
    pattern: /^\/api\/students\/([^/]+)\/enrollments\/([^/]+)\/renew$/,
    handle: (db, match, body) => {
      const student = loadStudent(db, match[1] ?? "");
      if (student === null) return { status: 404, payload: { error: "没有这个学生" } };
      const target = (student.enrollments as Array<Record<string, unknown>>).find(
        (item) => item.id === match[2],
      );
      if (target === undefined) return { status: 404, payload: { error: "没有这条报课记录" } };

      const added = Number(body.added ?? 0);
      if (!Number.isFinite(added) || added < 1) return { status: 400, payload: { error: "续费节数至少 1 节" } };
      const paidNow = Number(body.paidNow ?? 0);
      const at = new Date().toISOString();

      const run = db.transaction(() => {
        const enrollments = (student.enrollments as Array<Record<string, unknown>>).map((item) =>
          item.id === target.id
            ? {
                ...item,
                totalLessons: Number(item.totalLessons ?? 0) + added,
                agreedAmount: Number(item.agreedAmount ?? 0) + Number(body.agreedAmount ?? 0),
                paidAmount: Number(item.paidAmount ?? 0) + Math.max(0, paidNow),
                history: [
                  ...((item.history as unknown[]) ?? []),
                  { at, kind: "续费", lessons: added, note: String(body.note ?? "") },
                ],
              }
            : item,
        );
        db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(JSON.stringify(enrollments), student.id);
        db.prepare(
          "INSERT INTO transactions (id, student_id, enrollment_id, subject, delta, kind, lesson_id, at, note, reversed_at) VALUES (?, ?, ?, ?, ?, '续费', '', ?, ?, '')",
        ).run(nextId("tx"), student.id, target.id, String(target.subject ?? ""), added, at, String(body.note ?? ""));
        if (paidNow > 0) {
          db.prepare(
            "INSERT INTO payments (id, student_id, enrollment_id, amount, kind, method, at, note) VALUES (?, ?, ?, ?, '收款', ?, ?, ?)",
          ).run(nextId("p"), student.id, target.id, paidNow, String(body.method ?? "微信"), at, "续费收款");
        }
        writeLog(db, { entity: "学生", action: "续费", targetId: student.id, summary: `「${student.name}」续费 ${added} 节（${String(target.subject ?? "")}）` });
      });
      run();
      return { status: 200, payload: loadStudent(db, student.id) };
    },
  },
  {
    /** 独立收款 / 退款：写一条流水并同步报课记录的实收（退款为负数冲减）。 */
    method: "POST",
    pattern: /^\/api\/payments$/,
    handle: (db, _match, body) => {
      const studentId = String(body.studentId ?? "");
      const student = loadStudent(db, studentId);
      if (student === null) return { status: 404, payload: { error: "没有这个学生" } };
      const amount = Number(body.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) return { status: 400, payload: { error: "金额必须大于 0" } };
      const kind = body.kind === "退款" ? "退款" : "收款";
      const enrollmentId = String(body.enrollmentId ?? "");
      const at = new Date().toISOString();
      const id = nextId("p");

      const run = db.transaction(() => {
        db.prepare(
          "INSERT INTO payments (id, student_id, enrollment_id, amount, kind, method, at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, studentId, enrollmentId, amount, kind, String(body.method ?? "微信"), at, String(body.note ?? ""));
        if (enrollmentId !== "") {
          const enrollments = (student.enrollments as Array<Record<string, unknown>>).map((item) =>
            item.id === enrollmentId
              ? {
                  ...item,
                  // 实收 = 收款合计 − 退款合计（不变式：账实相符）
                  paidAmount: round2(Number(item.paidAmount ?? 0) + (kind === "退款" ? -amount : amount)),
                }
              : item,
          );
          db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(JSON.stringify(enrollments), studentId);
        }
        writeLog(db, { entity: "收费", action: kind, targetId: studentId, summary: `「${student.name}」${kind} ${amount} 元` });
      });
      run();
      return { status: 201, payload: { id, kind, amount } };
    },
  },
  {
    /**
     * 退课：按选定口径算退费（复用 `finance.ts` 的 REFUND_POLICIES），
     * 置报课记录为已退课并写退款流水。金额一律由服务端算，不接受前端传来的退款额。
     */
    method: "POST",
    pattern: /^\/api\/students\/([^/]+)\/enrollments\/([^/]+)\/refund$/,
    handle: (db, match, body) => {
      const student = loadStudent(db, match[1] ?? "");
      if (student === null) return { status: 404, payload: { error: "没有这个学生" } };
      const target = (student.enrollments as Array<Record<string, unknown>>).find(
        (item) => item.id === match[2],
      );
      if (target === undefined) return { status: 404, payload: { error: "没有这条报课记录" } };
      if (String(target.endedAt ?? "") !== "") return { status: 400, payload: { error: "这条报课记录已经退课了" } };

      const policy = findRefundPolicy(String(body.policy ?? ""));
      const quote = policy.calculate({
        totalLessons: Number(target.totalLessons ?? 0),
        usedLessons: Number(target.usedLessons ?? 0),
        agreedAmount: Number(target.agreedAmount ?? 0),
        unitPrice: Number(target.unitPrice ?? 0),
      });
      const at = new Date().toISOString();

      const run = db.transaction(() => {
        const enrollments = (student.enrollments as Array<Record<string, unknown>>).map((item) =>
          item.id === target.id
            ? {
                ...item,
                endedAt: at,
                status: "已退课",
                history: [
                  ...((item.history as unknown[]) ?? []),
                  { at, kind: "退课", lessons: 0, note: `${policy.name}：${quote.formula}` },
                ],
              }
            : item,
        );
        db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(JSON.stringify(enrollments), student.id);
        if (quote.refund > 0) {
          db.prepare(
            "INSERT INTO payments (id, student_id, enrollment_id, amount, kind, method, at, note) VALUES (?, ?, ?, ?, '退款', ?, ?, ?)",
          ).run(nextId("p"), student.id, target.id, quote.refund, String(body.method ?? "原路退回"), at, `退课退款（${policy.name}）`);
        }
        writeLog(db, {
          entity: "学生",
          action: "退课",
          targetId: student.id,
          summary: `「${student.name}」退课（${String(target.subject ?? "")}），按「${policy.name}」退 ${quote.refund} 元：${quote.formula}`,
        });
      });
      run();
      return { status: 200, payload: { refund: quote.refund, formula: quote.formula, policy: policy.id, student: loadStudent(db, student.id) } };
    },
  },
];


/* ── 报价配置（界面调 6 个方法：读取 / 保存 / 试算 / 教师课时费 / 导出 / 恢复）── */

function loadPricing(db: Database.Database): PricingConfig {
  const row = db.prepare("SELECT config FROM pricing WHERE id = 1").get() as { config: string } | undefined;
  return row === undefined
    ? pricingConfigFromContent()
    : (JSON.parse(row.config) as PricingConfig);
}

/** 报价相关：路径 → 处理函数（读与写都在这里，口径全部来自 lib/backend/pricing.ts）。 */
const PRICING_ROUTES: Record<string, { method: string; handle: (db: Database.Database, body: Record<string, unknown>, url: URL) => WriteResult }> = {
  "/api/pricing": {
    method: "GET",
    handle: (db) => ({ status: 200, payload: loadPricing(db) }),
  },
  "/api/pricing/save": {
    method: "POST",
    handle: (db, body) => {
      const config = body as unknown as PricingConfig;
      // 服务端必须自己复核配置合法性：系数写成 0 会让所有报价变 0
      const problems = validatePricingConfig(config);
      if (problems.length > 0) return { status: 400, payload: { error: problems.join("；") } };
      db.prepare("INSERT OR REPLACE INTO pricing (id, config, source, updated_at) VALUES (1, ?, ?, ?)").run(
        JSON.stringify({ ...config, source: PRICING_SOURCE_ADMIN, updatedAt: new Date().toISOString() }),
        PRICING_SOURCE_ADMIN,
        new Date().toISOString(),
      );
      writeLog(db, { entity: "报价", action: "修改配置", targetId: "pricing", summary: "修改了报价配置" });
      return { status: 200, payload: loadPricing(db) };
    },
  },
  "/api/pricing/reset": {
    method: "POST",
    handle: (db) => {
      const config = pricingConfigFromContent();
      db.prepare("INSERT OR REPLACE INTO pricing (id, config, source, updated_at) VALUES (1, ?, ?, ?)").run(
        JSON.stringify(config), PRICING_SOURCE_CONTENT, "",
      );
      writeLog(db, { entity: "报价", action: "恢复默认", targetId: "pricing", summary: "报价配置恢复为站点内容" });
      return { status: 200, payload: loadPricing(db) };
    },
  },
  "/api/pricing/quote": {
    method: "POST",
    handle: (db, body) => ({
      status: 200,
      payload: quoteSelection(loadPricing(db), body as never),
    }),
  },
  "/api/pricing/teacher-fee": {
    method: "POST",
    handle: (db, body) => ({
      status: 200,
      payload: teacherFeeForSelection(loadPricing(db), body as never),
    }),
  },
  "/api/pricing/export-markdown": {
    method: "GET",
    handle: (db) => ({ status: 200, payload: { markdown: pricingConfigToMarkdown(loadPricing(db)) } }),
  },
  "/api/courses/summary": {
    method: "GET",
    handle: (db) => ({ status: 200, payload: summarizeCourses(courseRows(db)) }),
  },
  "/api/courses/sync-from-site": {
    method: "POST",
    handle: (db) => {
      const stored = courseRows(db);
      const merged = mergeSiteCourses(stored);
      /*
       * 注意：`merged.added` 是**课程名数组**（纯函数的契约就是返回名字，便于页面提示
       * "同步了哪几门"），不是课程对象 —— 这里要插入的是 `merged.courses` 里新增的那些。
       * 我第一版把它当对象用，结果插进去的是字符串，报 NOT NULL constraint failed: courses.name。
       */
      const storedIds = new Set(stored.map((course) => course.id));
      const toInsert = merged.courses.filter((course) => !storedIds.has(course.id));
      if (toInsert.length > 0) {
        const insert = db.prepare(
          "INSERT OR REPLACE INTO courses (id, name, category, forms, origin, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        const run = db.transaction(() => {
          for (const course of toInsert) {
            insert.run(course.id, course.name, course.category, JSON.stringify(course.forms), course.origin, course.status, course.note, course.createdAt);
          }
          writeLog(db, { entity: "课程", action: "同步", targetId: "", summary: `从网站同步了 ${toInsert.length} 门课程：${merged.added.join("、")}` });
        });
        run();
      }
      return { status: 200, payload: { added: merged.added, total: courseRows(db).length } };
    },
  },
};

/** 数据库里的课程行 → 课程库纯函数要的形状。 */
function courseRows(db: Database.Database): ReturnType<typeof toCourse>[] {
  return (db.prepare("SELECT * FROM courses ORDER BY category, name").all() as Row[]).map(toCourse);
}


  /** 作业与阶段测评：只记录，不动课时与钱（课堂记录会动课时，另行处理）。 */
  const recordRoutes: Record<string, { method: string; handle: (db: Database.Database, body: Record<string, unknown>) => WriteResult }> = {
    "/api/homework/create": {
      method: "POST",
      handle: (db, body) => {
        const id = nextId("hw");
        db.prepare(
          "INSERT INTO homework_records (id, student_id, date, subject, submission, accuracy, weak_points, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, String(body.studentId ?? ""), String(body.date ?? ""), String(body.subject ?? ""), String(body.submission ?? ""), String(body.accuracy ?? ""), String(body.weakPoints ?? ""), String(body.note ?? ""));
        writeLog(db, { entity: "作业", action: "新建", targetId: id, summary: `记录作业：${String(body.subject ?? "")}` });
        return { status: 201, payload: toHomework(db.prepare("SELECT * FROM homework_records WHERE id = ?").get(id) as Row) };
      },
    },
    "/api/assessments/add": {
      method: "POST",
      handle: (db, body) => {
        const id = nextId("as");
        db.prepare(
          "INSERT INTO assessments (id, student_id, subject, date, score, previous_score, weak_points, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, String(body.studentId ?? ""), String(body.subject ?? ""), String(body.date ?? ""), body.score === undefined || body.score === null ? null : Number(body.score), body.previousScore === undefined || body.previousScore === null ? null : Number(body.previousScore), String(body.weakPoints ?? ""), String(body.note ?? ""));
        writeLog(db, { entity: "测评", action: "新建", targetId: id, summary: `阶段测评：${String(body.subject ?? "")}` });
        return { status: 201, payload: toAssessment(db.prepare("SELECT * FROM assessments WHERE id = ?").get(id) as Row) };
      },
    },
    "/api/logs/clear": {
      method: "POST",
      handle: (db) => {
        const before = (db.prepare("SELECT COUNT(*) AS n FROM logs").get() as { n: number }).n;
        const run = db.transaction(() => {
          db.prepare("DELETE FROM logs").run();
          writeLog(db, { entity: "数据", action: "清空日志", targetId: "", summary: `清空了 ${before} 条操作日志` });
        });
        run();
        return { status: 200, payload: { cleared: before } };
      },
    },
  };

/* ── 通用增删改（教师 / 教室 / 课程 / 学生 / 排课）────────────────────── */

type CrudSpec = {
  path: string;
  table: string;
  /** 页面字段（camelCase）→ 数据库列（snake_case）。 */
  columns: Record<string, string>;
  /** 这些字段在数据库里是 JSON 文本。 */
  json: string[];
  /** 这些字段在数据库里是 0/1。 */
  bool: string[];
  to: (row: Row) => unknown;
  label: string;
  /** 删除前的护栏（返回 null 表示允许删）。 */
  guardDelete?: (db: Database.Database, id: string) => string | null;
};

const CRUD: CrudSpec[] = [
  {
    path: "teachers", table: "teachers", label: "教师",
    columns: { name: "name", role: "role", subjects: "subjects", phone: "phone", active: "active" },
    json: ["subjects"], bool: ["active"], to: toTeacher,
  },
  {
    path: "classrooms", table: "classrooms", label: "教室",
    columns: { name: "name", capacity: "capacity", kind: "kind", availability: "availability", note: "note" },
    json: ["availability"], bool: [], to: toClassroom,
  },
  {
    path: "courses", table: "courses", label: "课程",
    columns: { name: "name", category: "category", forms: "forms", origin: "origin", status: "status", note: "note", createdAt: "created_at" },
    json: ["forms"], bool: [], to: toCourse,
    // 网站来源的课程跟着内容文件走：删了下次同步又会回来，改成「暂未开放」才对
    guardDelete: (db, id) => {
      const row = db.prepare("SELECT name, origin FROM courses WHERE id = ?").get(id) as
        | { name: string; origin: string }
        | undefined;
      if (row === undefined) return null;
      return row.origin === "网站"
        ? `「${row.name}」是网站上的课程，跟着内容文件走：删了下次同步还会回来，请改成「暂未开放」。`
        : null;
    },
  },
  {
    path: "students", table: "students", label: "学生",
    columns: { name: "name", grade: "grade", guardian: "guardian", status: "status", note: "note", createdAt: "created_at", enrollments: "enrollments", profile: "profile" },
    json: ["enrollments", "profile"], bool: [], to: toStudent,
    /*
     * 护栏：**有账的学生不能直接删**。
     * 之前就是因为删档案不连带清账，留下了 18 条"没有主人"的收费记录。
     * 这里宁可拒绝删除并要求先处理账目 —— 账本不该被档案操作牵连。
     */
    guardDelete: (db, id) => {
      const payments = (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE student_id = ?").get(id) as { n: number }).n;
      const txs = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE student_id = ?").get(id) as { n: number }).n;
      if (payments === 0 && txs === 0) return null;
      return `这位学生还有 ${payments} 条收款记录、${txs} 条课时流水，不能直接删除。请先处理他的收款与课时（退课 / 退款会留痕），再删档案。`;
    },
  },
  {
    path: "inquiries", table: "inquiries", label: "咨询",
    columns: {
      studentName: "student_name", grade: "grade", guardian: "guardian", subject: "subject",
      durationMinutes: "duration_minutes", intervalWeeks: "interval_weeks",
      plannedLessons: "planned_lessons", startsAt: "starts_at", candidates: "candidates",
      preferredTeacherId: "preferred_teacher_id", preferredClassroomId: "preferred_classroom_id",
      skipDates: "skip_dates", status: "status", note: "note",
      scheduledLessonIds: "scheduled_lesson_ids", createdAt: "created_at",
    },
    json: ["candidates", "skipDates", "scheduledLessonIds"], bool: [], to: toInquiry,
  },
  {
    path: "lessons", table: "lessons", label: "排课",
    columns: { subject: "subject", form: "form", teacherId: "teacher_id", classroomId: "classroom_id", studentIds: "student_ids", startsAt: "starts_at", durationMinutes: "duration_minutes", status: "status", note: "note", makeupForLessonId: "makeup_for_lesson_id" },
    json: ["studentIds"], bool: [], to: toLesson,
    // 已上过的课课时已经扣了：删掉会让流水指向一节不存在的课，只能先撤销
    guardDelete: (db, id) => {
      const used = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE lesson_id = ?").get(id) as { n: number }).n;
      return used === 0 ? null : "这节课已经记过课时流水（扣过课时），不能删除：请先撤销这节课的课时记录。";
    },
  },
];

/** 路径 → CRUD 规格；同时给出 id（列表接口没有 id）。 */
function matchCrud(pathname: string): { spec: CrudSpec; id: string } | null {
  const match = /^\/api\/([a-z]+)(?:\/([^/]+))?$/.exec(pathname);
  if (match === null) return null;
  const spec = CRUD.find((item) => item.path === match[1]);
  return spec === undefined ? null : { spec, id: match[2] ?? "" };
}

function crudRow(db: Database.Database, spec: CrudSpec, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id) as Row | undefined;
}

/** 从请求体里挑出允许改的字段（只认表里有的列，避免脏字段直接进 SQL）。 */
function buildColumns(spec: CrudSpec, body: Record<string, unknown>): { columns: string[]; values: unknown[] } {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of Object.entries(spec.columns)) {
    if (!(field in body)) continue;
    const value = body[field];
    columns.push(column);
    if (spec.json.includes(field)) values.push(JSON.stringify(value ?? []));
    else if (spec.bool.includes(field)) values.push(value === true || value === 1 ? 1 : 0);
    else values.push(value as string | number);
  }
  return { columns, values };
}

function handleCrud(
  db: Database.Database,
  method: string,
  pathname: string,
  body: Record<string, unknown>,
): WriteResult | null {
  const matched = matchCrud(pathname);
  if (matched === null) return null;
  const { spec, id } = matched;

  if (method === "POST" && id === "") {
    // 学生与排课有专用接口（校验更严：姓名必填、时间必须合法），不要被通用新增抢走
    if (spec.path === "students" || spec.path === "lessons") return null;
    const { columns, values } = buildColumns(spec, body);
    if (columns.length === 0) return { status: 400, payload: { error: "没有可写入的字段" } };
    const newId = nextId(spec.path.slice(0, 2));
    const all = ["id", ...columns];
    const run = db.transaction(() => {
      db.prepare(`INSERT INTO ${spec.table} (${all.join(", ")}) VALUES (${all.map(() => "?").join(", ")})`).run(newId, ...values);
      writeLog(db, { entity: spec.label, action: "新建", targetId: newId, summary: `新建${spec.label}「${String(body.name ?? "")}」` });
    });
    try {
      run();
    } catch (cause) {
      return { status: 400, payload: { error: cause instanceof Error ? cause.message : "写入失败" } };
    }
    return { status: 201, payload: spec.to(crudRow(db, spec, newId)!) };
  }

  if (method === "PATCH" && id !== "") {
    const row = crudRow(db, spec, id);
    if (row === undefined) return { status: 404, payload: { error: `没有这条${spec.label}记录` } };
    const { columns, values } = buildColumns(spec, body);
    if (columns.length === 0) return { status: 400, payload: { error: "没有可更新的字段" } };
    const run = db.transaction(() => {
      db.prepare(`UPDATE ${spec.table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...values, id);
      writeLog(db, { entity: spec.label, action: "修改", targetId: id, summary: `修改${spec.label}（${columns.join("、")}）` });
    });
    try {
      run();
    } catch (cause) {
      return { status: 400, payload: { error: cause instanceof Error ? cause.message : "更新失败" } };
    }
    return { status: 200, payload: spec.to(crudRow(db, spec, id)!) };
  }

  if (method === "DELETE" && id !== "") {
    const row = crudRow(db, spec, id);
    if (row === undefined) return { status: 404, payload: { error: `没有这条${spec.label}记录` } };
    const reason = spec.guardDelete?.(db, id) ?? null;
    if (reason !== null) return { status: 400, payload: { error: reason } };
    const run = db.transaction(() => {
      db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`).run(id);
      writeLog(db, { entity: spec.label, action: "删除", targetId: id, summary: `删除${spec.label}` });
    });
    run();
    return { status: 200, payload: { deleted: true, id } };
  }

  return null;
}

/**
 * 允许的来源：本机开发（localhost / 127.0.0.1 的任意端口）。
 *
 * 开发期前端跑在 3000、后端跑在 4000，属跨源，浏览器会拦；
 * 只放开本机来源（而不是 `*`）：将来真放服务器上时再按域名收紧。
 */
function allowedOrigin(request: IncomingMessage): string {
  const origin = request.headers.origin ?? "";
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "";
}

let currentCors: Record<string, string> = {};

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...currentCors });
  response.end(JSON.stringify(payload, null, 2));
}

/**
 * 鉴权闸（`/api/` 下除公开入口外一律先过它）。
 *
 * 它管**登录**这件事（令牌 → 会话）。**权限**（这个角色能不能做这件事）在下一步：
 * `/api/call` 在 `callApi` 里判，老 REST 接口在 `requireRestPermission` 里判 ——
 * 两者共用 `permissionError` 一个判定函数（理由见上面那一节的开头）。
 *
 * 返回**会话**（而不是 true/false）：角色是权限判定的输入，直接往下传，
 * 而不是存进一个模块级变量 —— 模块级变量在多账号下会串：
 * `/api/call` 要先 `await` 读请求体，这期间另一个请求可能已经把它改掉了
 * （读写体是异步的，而"当前是谁"必须是这个请求自己的）。那就成了
 * "A 的调用拿着 B 的角色过闸门"，是权限里最不该有的那种错。
 */
function requireAuth(request: IncomingMessage, response: ServerResponse): Session | null {
  const session = verifyToken(tokenFromHeader(request.headers.authorization));
  if (session === null) {
    send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
    return null;
  }
  /*
   * 按会话记操作人，两套日志写入都要用它：
   *   - `api.setOperator` 影响走 kv 快照的那一套（页面用的）；
   *   - `currentOperator` 影响服务端自己写 SQL 的那一套（老 REST 接口用的）。
   * 少设哪一个，都会让"谁改的"在其中一条路上变成默认值。
   *
   * 这两处确实是模块级状态（与 api.ts 的 operatorName 一致），因此**每个请求**都要重设一次：
   * 这是"前端调 setOperator 也不能冒充别人"这条性质成立的前提（见权限闸门那一节）。
   */
  void api.setOperator(session.username);
  currentOperator = session.username;
  return session;
}



const db = openDatabase();
const migration = migrate(db);

/*
 * 路线 B 的核心一步：把 api.ts 的存储换成 SQLite 支持的实现。
 * 之后 `api` 上的 106 个方法全部可用，且**与浏览器里跑的是同一套逻辑**。
 */
const SNAPSHOT_KEY = "nexgenedu.admin.db.v1";
const serverStore = createSqliteStore(db);

/*
 * **空库起步**。
 *
 * 伪后端的 `load()` 在存储为空时会播种示例数据（实测：空存储调用 students.list 直接返回
 * 8 条示例学生）。机构已经把库清空、也明确要删掉示例数据，所以服务端在首次启动时
 * 写一份**空快照**进去：业务表全空，只保留课程库与报价配置 —— 这正是"重新一个一个录"要的起点。
 *
 * 这份定义现在与前端**共用同一个函数**（`createEmptyDatabase`）：早期是在这里手写一遍
 * 「把示例数据的各张表设成 []」，一旦 `Database` 加了新表，这里就会漏掉一张而
 * 悄悄把示例内容带进真实库 —— 口径写两遍的代价。
 *
 * 需要示例数据做演示时，设 NEXGENEDU_ALLOW_SEED=1 即可（走 `createSeedDatabase`）。
 */
if (serverStore.read(SNAPSHOT_KEY) === null) {
  // 示例数据只能**显式**要：默认空库。写成"默认灌示例、要空的再设变量"是本末倒置 ——
  // 忘了设变量的那位，会在真实库里看到 8 位不是自己录的学生。
  const withDemoData = process.env.NEXGENEDU_ALLOW_SEED === "1";
  serverStore.write(
    SNAPSHOT_KEY,
    JSON.stringify(withDemoData ? createSeedDatabase() : createEmptyDatabase()),
  );
  console.log(
    withDemoData
      ? "已写入示例数据快照（NEXGENEDU_ALLOW_SEED=1，仅供演示，别在上面录真实数据）"
      : "已写入空快照（业务表全空，保留课程库与报价配置）",
  );
}

__useStoreForTesting(serverStore);

/* ── 权限闸门（第 7 步：按角色拦接口）──────────────────────────────────── */

/**
 * 关于这一节的一句话总纲：**两道门的判定必须是同一套**。
 *
 * 后端对外有两个入口 —— 页面走的 `/api/call`，以及路线 A 留下的老 REST 接口
 * （`/api/students`、`/api/pricing`…）—— 而它们**读写同一份数据**。
 * 只给其中一个加权限，等于前门锁了、窗户开着。这不是假设：
 * 第 6 步加"要登录"时，第一次跑 `npm run check:auth` 就抓到了 `/api/students` 没挡
 * （新入口挡上了、老入口漏了），未登录的人照样把学生数据读走了。
 *
 * 所以做法是：**判定只有一个函数**（`permissionError`），两道门各自负责把
 * "我这是哪个接口"翻译成**方法名**，再交给它。翻译不过来的（没有登记归属）一律**拒绝**
 * —— 失败方向必须是关门。
 *
 * 而**"哪个角色能做哪个方法"这件事不在这个文件里**：它整份在 `lib/auth/roles.ts`
 * （`allowedRolesForMethod`，按"特例 → 只读宽 → 分组默认 → 没登记就关门"解析）。
 * 服务端**只调用、不复制** —— 复制一份解析逻辑就等于给自己造一个
 * "改了那边忘了这边"的机会，而权限上这种不一致等于静默放权。
 */

/**
 * 会话管道方法：不做业务、只把"当前是谁"交给服务层，因此不属于任何权限分组。
 *
 * 为什么要白名单：`setOperator` 在契约里归在"运维与审计"（它确实属于审计那一摊），
 * 可它是**每个请求开场时由服务端按会话调用**的（见 `requireAuth`）：
 * 少了它，操作日志里的操作人就会退回默认值。如果按 ops 拦，
 * 除技术管理员之外的任何人**连正常写数据都会失败** —— 而那和"他不能改数据"是两件事。
 *
 * 放行它安全吗？安全，而且理由要说清楚：操作人在**每个请求开头**都会被按会话重设一次，
 * 而一次 `/api/call` 只处理一个方法 —— 前端就算调 `setOperator("老板")`，
 * 影响的也只是它自己那一次调用，下一个请求立刻被改回会话里的那个人。
 * （这条依赖"每请求重设"，所以 `requireAuth` 里那一行不是可有可无的。）
 *
 * 白名单必须排在"查归属"**之前**：`setRoles` 这类方法在角色表里根本没登记，
 * 先查归属会把它们当成"没登记归属的接口"拒掉。
 */
const SESSION_PIPELINE_METHODS: ReadonlySet<string> = new Set(["setOperator", "setRoles"]);

/**
 * 分组 id → 分组的中文名（"运维与审计"），**只用来写错误文案**。
 *
 * 判定**不经过它**（判定完全在 `lib/auth/roles.ts`）：这里要的只是"让被拒的人看懂
 * 这件事叫什么"，所以标题去掉"七、"这种序号。取不到标题时就退回方法名本身。
 */
const GROUP_TITLES: ReadonlyMap<string, string> = new Map(
  API_CONTRACT.map((group) => [group.id, group.title.replace(/^[一二三四五六七八九十]+、/, "")]),
);

/** 角色列表变成人话（提示里要出现"你的角色是谁"，人才知道该找谁开权限）。 */
function roleText(roles: readonly Role[]): string {
  return roles.length === 0 ? "没有角色" : roles.join("、");
}

/**
 * 这一次调用该不该放行：`null` = 放行；字符串 = 拒绝（内容是给人看的话）。
 *
 * 两道门都只经过这一个函数，因此"同一个动作从哪个门进来"不会有两套结论。
 *
 * ## 判定完全交给 `lib/auth/roles.ts`，这里**不自己推**
 *
 * 调用 `allowedRolesForMethod(method)`，按它的 `Role[] | null` 分两种：
 *   - 拿到数组 → `canAccess(会话角色, 数组)`；有一个角色被允许就放行；
 *   - 拿到 `null` → 这个方法**没登记归属** → **关门**，并在错误里写清是哪个方法。
 *
 * 为什么**不**在这里用 `GROUP_ACCESS[分组]` 自己判：`API_CONTRACT` 的分组是
 * **接口分类，不总是权限边界** —— `crud` 里既有 `students.list`（读）也有
 * `students.remove`（删）；`actions` 里既有 `students.enroll`（招生 / 财务）
 * 也有 `lessons.markCompleted`（教师的核心动作）。同一个分组里两件事归不同角色，
 * 按分组判就必然两头都错（我第一版就是这么写的：普通教师**读不了任何列表**
 * ——连自己学生的课时都看不成，而报课、收款又对他开放）。
 *
 * `roles.ts` 里现在按"**特例 → 只读宽 → 分组默认 → 没登记就关门**"逐层解析，
 * 那是**唯一一份**判定数据，而且自检盯着它。服务端只调用它 ——
 * 在这里复制一份解析逻辑，就是给自己造一个"改了那边忘了这边"的机会，
 * 而权限上这种不一致等于静默放权。
 */
function permissionError(method: string, roles: readonly Role[]): string | null {
  // ① 会话管道方法放行（理由见 SESSION_PIPELINE_METHODS 的注释）
  if (SESSION_PIPELINE_METHODS.has(method)) return null;

  /*
   * ② 没登记归属就**拒绝**，不是放行。
   *
   * 这是整节里最重要的那个默认值：新增接口时忘了登记归属，结果必须是"用不了"，
   * 而不是"所有人都能用"（连技术管理员也不行 —— 否则"未登记"会变成一句空话，
   * 而真正需要的结果是"谁都用不了，于是有人去把它登记上"）。
   * 默认开放是权限系统里最危险的那种默认值：它不报错、不留痕，
   * 只会让一个"还没想清楚归谁"的新接口对所有人敞开。
   */
  const allowed = allowedRolesForMethod(method);
  if (allowed === null || allowed.length === 0) {
    return (
      `这个接口没有登记权限归属：${method}（一律拒绝）。` +
      "请在 lib/auth/roles.ts 里给它定角色 —— 方法级的 METHOD_ACCESS，或它所属分组的 GROUP_ACCESS。"
    );
  }

  // ③ 角色判定：角色集合里只要有一个被允许就放行（一个账号可兼任多个角色）
  if (canAccess(roles, allowed)) return null;

  const group = groupOfMethod(method);
  const title = (group === null ? undefined : GROUP_TITLES.get(group)) ?? method;
  return (
    `你的角色（${roleText(roles)}）不能做这件事：${title}。` +
    `这件事需要：${allowed.join(" 或 ")}。` +
    "分工见 docs/使用手册.md 的「谁能做什么」。"
  );
}

/**
 * 老 REST 接口 → **契约里的方法名**（拿到方法名后交给 `permissionError`，角色判定在 roles.ts）。
 *
 * 为什么要逐条列：这些路径**不是方法名**（`/api/today` 对应 `today`、
 * `/api/pricing/save` 对应 `pricing.update`、`/api/logs` 对应 `logs.list`…），
 * 没有"按规则推导"的可能，只能写下来。写在这里的好处是**看得完**：
 * 新增老接口时漏了一行，它会被下面的兜底拒绝掉，而不是悄悄对所有角色开放。
 * 顺序有讲究：**具体的在前、泛化的在后**（`/api/students/get` 必须排在 `/api/students` 前面）。
 */
const REST_CONTRACT_METHODS: ReadonlyArray<{
  http: string | "*";
  pattern: RegExp;
  /** 对应的契约方法名；null 表示"登录即可"的接口（见 note）。 */
  contract: string | null;
  note: string;
}> = [
  /*
   * 这两个不是业务接口，刻意"只要登录就放行"：
   *   - `/api/call` 是自己的一道门，它按**方法名**在 callApi 里判（见那里的闸门）；
   *   - `/api/status` 是服务状态（库路径、表条数、备份状态），登录了就说明是自己人，
   *     而且它不属于 `API_CONTRACT` 的任何分组（分组是按业务方法划的）。
   *     把它按 ops 拦会让"连上后端了吗"这类探活在非技术管理员那里变成 403，
   *     而那与权限无关 —— 会让排障时看到假故障。
   */
  { http: "POST", pattern: /^\/api\/call$/, contract: null, note: "统一调用入口：按方法名在 callApi 里判" },
  { http: "*", pattern: /^\/api\/status$/, contract: null, note: "服务状态：登录即可（不属于任何业务分组）" },

  /* 读接口（ROUTES / READS）：按它读的东西对应的方法名翻译 */
  { http: "GET", pattern: /^\/api\/students$/, contract: "students.list", note: "学生列表" },
  { http: "GET", pattern: /^\/api\/students\/get$/, contract: "students.get", note: "单个学生" },
  { http: "GET", pattern: /^\/api\/teachers$/, contract: "teachers.list", note: "教师列表" },
  { http: "GET", pattern: /^\/api\/teachers\/active$/, contract: "teachers.listActive", note: "在职教师（排课下拉）" },
  { http: "GET", pattern: /^\/api\/classrooms$/, contract: "classrooms.list", note: "教室列表" },
  { http: "GET", pattern: /^\/api\/courses$/, contract: "courses.list", note: "课程列表" },
  { http: "GET", pattern: /^\/api\/lessons$/, contract: "lessons.list", note: "排课列表" },
  { http: "GET", pattern: /^\/api\/inquiries$/, contract: "inquiries.list", note: "咨询列表" },
  { http: "GET", pattern: /^\/api\/today$/, contract: "today", note: "今日概览" },
  { http: "GET", pattern: /^\/api\/payments$/, contract: "payments.list", note: "收款记录" },
  { http: "GET", pattern: /^\/api\/transactions$/, contract: "transactions.listByStudent", note: "课时流水（按学生查）" },
  { http: "GET", pattern: /^\/api\/lesson-records$/, contract: "lessonRecords.list", note: "课堂记录" },
  { http: "GET", pattern: /^\/api\/homework$/, contract: "homework.list", note: "作业记录" },
  { http: "GET", pattern: /^\/api\/assessments$/, contract: "assessments.list", note: "阶段测评" },
  { http: "GET", pattern: /^\/api\/logs$/, contract: "logs.list", note: "操作日志" },

  /* 报价与课程库（PRICING_ROUTES）：读与写都在那一个表里，逐条对上方法名 */
  { http: "GET", pattern: /^\/api\/pricing$/, contract: "pricing.get", note: "读报价配置" },
  { http: "POST", pattern: /^\/api\/pricing\/save$/, contract: "pricing.update", note: "保存报价配置" },
  { http: "POST", pattern: /^\/api\/pricing\/reset$/, contract: "pricing.reset", note: "恢复默认报价" },
  { http: "POST", pattern: /^\/api\/pricing\/quote$/, contract: "pricing.quote", note: "试算报价" },
  { http: "POST", pattern: /^\/api\/pricing\/teacher-fee$/, contract: "pricing.teacherFee", note: "教师课时费" },
  { http: "GET", pattern: /^\/api\/pricing\/export-markdown$/, contract: "pricing.exportMarkdown", note: "导出报价 Markdown" },
  { http: "GET", pattern: /^\/api\/courses\/summary$/, contract: "courses.summary", note: "课程库汇总" },
  { http: "POST", pattern: /^\/api\/courses\/sync-from-site$/, contract: "courses.syncFromSite", note: "从网站同步课程" },

  /* 作业 / 测评 / 日志的专用写接口 */
  { http: "POST", pattern: /^\/api\/homework\/create$/, contract: "homework.create", note: "新建作业记录" },
  { http: "POST", pattern: /^\/api\/assessments\/add$/, contract: "assessments.add", note: "新增阶段测评" },
  { http: "POST", pattern: /^\/api\/logs\/clear$/, contract: "logs.clear", note: "清空操作日志" },
  { http: "DELETE", pattern: /^\/api\/homework\/[^/]+$/, contract: "homework.remove", note: "删除作业记录" },
  { http: "DELETE", pattern: /^\/api\/assessments\/[^/]+$/, contract: "assessments.remove", note: "删除阶段测评" },

  /* 业务动作（WRITES）：一个请求 = 一个事务的那些 */
  { http: "POST", pattern: /^\/api\/students\/[^/]+\/enroll$/, contract: "students.enroll", note: "报课" },
  { http: "POST", pattern: /^\/api\/lessons\/[^/]+\/complete$/, contract: "lessons.markCompleted", note: "标记已上" },
  { http: "POST", pattern: /^\/api\/students\/[^/]+\/enrollments\/[^/]+\/renew$/, contract: "students.renewEnrollment", note: "续费" },
  { http: "POST", pattern: /^\/api\/students\/[^/]+\/enrollments\/[^/]+\/refund$/, contract: "students.refundEnrollment", note: "退课退款" },
  { http: "GET", pattern: /^\/api\/students\/[^/]+\/enrollments\/[^/]+\/refund-quote$/, contract: "students.refundEnrollment", note: "退费试算（与退课同一件事的预览，不单独放宽）" },
  { http: "POST", pattern: /^\/api\/payments$/, contract: "payments.record", note: "收款 / 退款" },
];

/**
 * 通用增删改（`/api/teachers`、`/api/students/<id>`…）的资源名。
 *
 * 这些路径的形状和契约里的方法前缀**同名**（`students` → `students.create`），
 * 所以能按"资源 + 请求方法"推出来，不用在表里写 6 × 3 行
 * （那种表没人会去核对，而漏一行就是"这个资源可以对所有人开放"）。
 */
const REST_CRUD_RESOURCES = ["students", "teachers", "classrooms", "courses", "lessons", "inquiries"] as const;

/** 老 REST 的写方法 → 契约里的动作名（与 `handleCrud` 的行为一致：POST 建、PATCH 改、DELETE 删）。 */
const REST_CRUD_VERBS: Record<string, string> = { POST: "create", PATCH: "update", DELETE: "remove" };

/**
 * 老 REST 请求该按哪个契约方法判权限。
 *
 * 顺序原则：**具体的表在前、泛化的规则在后**。`/api/students/get` 必须先匹配到
 * `students.get`；将来加规则时也要照这个顺序想一遍，别让泛化规则把具体接口吃掉。
 */
type RestTarget =
  /** 登录即可（`/api/call` 与 `/api/status`，见表里的说明）。 */
  | { kind: "exempt" }
  | { kind: "contract"; method: string }
  /** 路径在这个文件里认不出来 —— 拒绝（理由见 `resolveRestContract` 末尾）。 */
  | { kind: "unregistered" };

function resolveRestContract(httpMethod: string, pathname: string): RestTarget {
  for (const entry of REST_CONTRACT_METHODS) {
    if (entry.http !== "*" && entry.http !== httpMethod) continue;
    if (entry.pattern.test(pathname)) {
      return entry.contract === null ? { kind: "exempt" } : { kind: "contract", method: entry.contract };
    }
  }
  const crudPath = /^\/api\/([a-z]+)(?:\/[^/]+)?$/.exec(pathname);
  const resource = crudPath?.[1] ?? "";
  const verb = REST_CRUD_VERBS[httpMethod];
  if (verb !== undefined && (REST_CRUD_RESOURCES as readonly string[]).includes(resource)) {
    return { kind: "contract", method: `${resource}.${verb}` };
  }
  /*
   * 认不出来的路径：**不是"放过去让它自己 404"**，而是拒掉。
   *
   * 理由与 `/api/call` 那边一样，但这里更隐蔽：老 REST 的路径表与处理分支是**两处**
   * （表在上面、分支在下面），将来加一个分支忘了加一行，这条兜底就是唯一还在拦它的东西。
   * 所以这里得出"没有归属"的结论，由调用方拒掉 —— 顺带把那句"请补一行"的提示带出去。
   */
  return { kind: "unregistered" };
}

/**
 * 老 REST 接口的**角色**闸门（登录闸门之后、任何处理之前跑一次）。
 *
 * 放在"一处"而不是每个分支里各写一遍：逐个分支加判断一定会漏，
 * 而漏掉的那一个就是"门锁了、窗户开着"。
 */
function requireRestPermission(
  httpMethod: string,
  pathname: string,
  session: Session,
  response: ServerResponse,
): boolean {
  const target = resolveRestContract(httpMethod, pathname);
  if (target.kind === "exempt") return true;
  const denied =
    target.kind === "unregistered"
      ? `这个接口没有登记权限归属：${httpMethod} ${pathname}。` +
        "如果是新加的老接口，请在 server/index.mts 的 REST_CONTRACT_METHODS 里补一行" +
        "（路径 → 契约方法名），也顺便确认一下路径有没有写错；没登记的接口一律拒绝。"
      : permissionError(target.method, session.roles);
  if (denied === null) return true;
  send(response, 403, { ok: false, error: denied });
  return false;
}

/** 还原远端代理显式标记的 Date（`{ __date: ISO }`），其余参数原样。 */
function decodeArg(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeArg);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.__date === "string") return new Date(record.__date);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decodeArg(item);
    return out;
  }
  return value;
}

/** 权限不足（与"参数不对"分开：接口层按它回 403，而不是 400）。 */
class PermissionDenied extends Error {}

/**
 * 通用分发：按 `api` 的真实形状逐级查表调用。
 *
 * 用「方法名 + 参数数组」而不是逐个写 REST 路由，是为了**不重复描述一遍接口**：
 * 契约已经在 contract.ts / docs/后台API约定.md 里，这里是机器照做。
 *
 * 第 7 步起，**权限闸门就在这里**（这个函数最前面）。为什么选这个位置：
 * 它是 `/api/call` 唯一的进门函数，任何"查到那个函数再调用"的路径都得从这里过。
 * 如果把闸门写在路由分支里（`url.pathname === "/api/call"` 那一处），
 * 将来多一个入口就多一处"要记得加闸门"的地方 —— 而"漏加一处"正是这一节要防的事。
 *
 * 角色是从**会话**传进来的（由 `requireAuth` 校验令牌得到），不是前端传的：
 * 前端说自己是什么角色不作数。
 */
async function callApi(method: string, args: unknown[], roles: readonly Role[]): Promise<unknown> {
  const denied = permissionError(method, roles);
  if (denied !== null) throw new PermissionDenied(denied);

  const parts = method.split(".");
  let target: unknown = api;
  for (const part of parts.slice(0, -1)) {
    if (typeof target !== "object" || target === null) throw new Error(`没有这个方法：${method}`);
    target = (target as Record<string, unknown>)[part];
  }
  if (typeof target !== "object" || target === null) throw new Error(`没有这个方法：${method}`);
  const name = parts[parts.length - 1] ?? "";
  const fn = (target as Record<string, unknown>)[name];
  if (typeof fn !== "function") throw new Error(`没有这个方法：${method}`);
  return await (fn as (...a: unknown[]) => unknown).apply(target, args);
}

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  /*
   * 全局兜底：任何未预期的异常都要变成 500 响应，而不是让进程退出。
   * 这一条是踩出来的 —— 之前一个 SQL 表名写错，直接把整个服务打挂了（测试时报
   * ERR_EMPTY_RESPONSE / other side closed），那种故障在真机上就是"后台突然全打不开"。
   */
  currentCors = (() => {
    const origin = allowedOrigin(request);
    return origin === ""
      ? {}
      : {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          /*
           * 必须显式列出 `authorization`：登录之后**每个**请求都带它，
           * 而它是一个"非简单头"，浏览器会先发预检来问"你允许这个头吗"。
           * 漏了它的后果非常隐蔽：登录本身能成功（只用 content-type），
           * 但登录后所有请求被浏览器拦掉 → `/api/session` 拿不到 → 界面把人**弹回登录页**，
           * 看起来就像"密码不对、登不进去"。而 Node 里的自检、验收、演练都不走 CORS，
           * 所以它们**永远查不出**这个问题 —— 只有浏览器会撞上。
           * （`check:auth` 现在会直接断言这条预检响应。）
           */
          "access-control-allow-headers": "content-type, authorization",
          /*
           * 预检结果的缓存时间**刻意短**（60 秒）。
           *
           * 原先是 600（10 分钟）。教训：我们自己在预检里漏了 `authorization` 时，
           * 改成正确的**也不会立刻生效** —— 浏览器把旧的"只允许 content-type"缓存住，
           * 期间每个带令牌的请求照样被拦，症状是"密码明明对、登录后一直被弹回登录页，
           * 怎么都不好"，而且改代码、重启服务端都看不出变化（因为浏览器压根没再问）。
           * 短缓存让这类修复一分钟内自己生效；预检本身很便宜，不值得为它省请求。
           */
          "access-control-max-age": "60",
        };
  })();

  try {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  // 预检请求直接回 204（浏览器在跨源 POST + JSON 前会先问一次）
  if (request.method === "OPTIONS") {
    response.writeHead(204, currentCors);
    response.end();
    return;
  }

  /*
   * ── 认证（第 6 步）────────────────────────────────────────────────────────
   *
   * 公开的只有四个：/health（探活）、/api/login（登录）、/api/logout（退出）、
   * /api/public/site（宣传网站构站时要读的公开内容，见下方）。
   * 其余一切（/api/call 与各 REST 接口）都要令牌。
   *
   * 为什么口令搬到服务端是必须的：早期登录是纯前端的，口令硬编码在
   * lib/auth/session.ts 里，而仓库是公开的 —— 那等于没有口令。
   *
   * 顺带说清楚一道**不是**防线的防线：CORS 只放开本机来源，但 CORS 是浏览器
   * 的规矩，`curl` 根本不看它。所以"能写数据的接口"必须靠令牌，不能靠 CORS。
   */
  const bearer = tokenFromHeader(request.headers.authorization);

  if (url.pathname === "/api/login" && request.method === "POST") {
    void readBody(request)
      .then(async (body) => {
        const result = login(String(body.username ?? ""), String(body.password ?? ""));
        if (!result.ok) {
          /*
           * 失败时刻意**慢一点**：本机使用时人不该感到延迟，但暴力试探的成本会明显上升。
           * 这一条不替代强口令，只是把"随手猜几百次"变成不划算。
           */
          await new Promise((resolve) => setTimeout(resolve, 400));
          send(response, 401, { ok: false, error: result.error });
          return;
        }
        send(response, 200, {
          ok: true,
          token: result.token,
          username: result.username,
          /*
           * 角色要回给前端：界面靠它决定"显示哪些入口"（服务端那边才是真的拦）。
           * 字段名就是 `roles`，且类型是 `Role[]` —— `/api/session` 用的是同一个字段，
           * 前端两处读的是同一份东西（`lib/auth/session.ts` 的 readRoles）。
           */
          roles: result.roles,
          expiresAt: result.expiresAt,
        });
      })
      .catch((cause: unknown) => send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" }));
    return;
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    logout(bearer);
    send(response, 200, { ok: true });
    return;
  }

  /*
   * 公开只读：宣传网站构站时取教师 / 课程 / 正文 / 报价（见 docs/技术架构.md §10.1）。
   *
   * 它必须放在**统一闸门之前** —— 构站的是 CI 或本机脚本，没有也不会去登录。
   * 返回内容由 `lib/backend/public-site.ts` 按字段白名单构造：
   * 教师电话、学生与家长信息、金额、日志都不在其中（自检有断言盯着）。
   *
   * 走的是同一个 `api.site.publicContent()`（与后台调用同一条实现），
   * 因此"网站上看到的"和"后台预览的"不可能两样。
   */
  if (url.pathname === "/api/public/site" && request.method === "GET") {
    void api.site
      .publicContent()
      .then((data) => send(response, 200, { ok: true, data }))
      .catch((cause: unknown) =>
        send(response, 500, {
          ok: false,
          error: cause instanceof Error ? cause.message : "服务器内部错误",
        }),
      );
    return;
  }

  if (url.pathname === "/api/session" && request.method === "GET") {
    const session = verifyToken(bearer);
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期。" });
      return;
    }
    /*
     * **已登录探活**：字段名必须是 `roles`、类型是 `Role[]`。
     *
     * 前端靠它决定显示哪些导航（`lib/auth/session.ts` 的 readRoles 只认
     * `lib/auth/roles.ts` 里那四个名字，认不出来就按"全角色"处理，
     * 免得"升级了服务端忘了升级前端"让后台突然变空）。
     * 它**不是**权限本身：藏起来的入口照样能被直接调接口试，
     * 真正说了算的是服务端的两道闸门。
     */
    send(response, 200, { ok: true, username: session.username, roles: session.roles });
    return;
  }

  /*
   * ── 统一闸门：/api/ 下除上面几个公开入口外，一律要登录 ──────────────────────
   *
   * 为什么放在**一处**而不是每个分支里各写一遍：逐个分支加鉴权一定会漏 ——
   * 这一版第一次跑 `npm run check:auth` 就抓到了：`/api/call` 与写的接口都挡上了，
   * 而**读接口 `/api/students` 忘了挡**，未登录直接 200 把学生数据交出去。
   * 那种漏法很隐蔽（"我明明加了鉴权"），所以改成结构性的：
   * 只要在 /api/ 下，默认就是关门状态，新加接口不需要谁记得加一行。
   *
   * 第 7 步在这条闸门后面又加了**一道**：下面那行 `requireRestPermission`
   * 管的是"这个角色能不能做这件事"。两道都要过：先证明你是谁，再证明你能做。
   */
  let session: Session | null = null;
  if (url.pathname.startsWith("/api/")) {
    session = requireAuth(request, response);
    if (session === null) return;
    if (!requireRestPermission(request.method ?? "GET", url.pathname, session, response)) return;
  }

  /** 通用调用：{ method: "students.list", args: [] }。第 5 步前端就切到这一个入口。 */
  if (url.pathname === "/api/call" && request.method === "POST") {
    /*
     * 会话在闸门那里已经校验过；这里再判一次 null 不是为了"应该不会发生"，
     * 而是为了让**权限判定永远有一个真实输入**：拿不到会话就拒绝，
     * 绝不出现"角色未知 → 当成没有限制"这种默认值。
     */
    if (session === null) {
      send(response, 401, { ok: false, error: "未登录或登录已过期，请先登录。" });
      return;
    }
    // 捕获成常量：下面读请求体是异步的，`session` 是 let，闭包里用它会被当成可能为 null
    const roles: readonly Role[] = session.roles;
    void readBody(request)
      .then(async (body) => {
        /*
         * 操作人由**会话**决定，不由前端传（第 6 步顺带修掉的一处静默错误）：
         * 早期前端调 `setOperator(name)` 把操作人告诉服务层，而它是同步方法、
         * 经远端代理会静默变成 Promise —— 于是操作日志里的操作人一直是默认值。
         * 现在每次请求都按令牌所属账号设置（上面的闸门做的），前端说什么都不作数。
         */
        const method = String(body.method ?? "");
        const args = Array.isArray(body.args) ? (body.args as unknown[]) : [];
        try {
          // 权限闸门在 callApi 里（method → roles.ts 的 allowedRolesForMethod），这里只负责把会话带过去
          const result = await callApi(method, args.map(decodeArg), roles);
          send(response, 200, { ok: true, result });
        } catch (cause) {
          /*
           * 权限不足回 **403**，与"参数写错了(400)"分开：
           * 403 是"你有身份、但这件事不归你"，排障时看一眼状态码就知道该找谁，
           * 而不是去翻请求参数。
           */
          if (cause instanceof PermissionDenied) {
            send(response, 403, { ok: false, error: cause.message });
            return;
          }
          /*
           * 版本冲突回 **409**（乐观锁，v17）。三种错误各有各的处理方式，因此不能混：
           *   - 400 参数错 → 改一改表单再提交（**大概率能成**）；
           *   - 403 权限不足 → 找管理员开权限（**再试多少次都没用**）；
           *   - 409 冲突 → 先把这条记录重新读一遍（**刷新后重提交就能成**）。
           * 把冲突混进 400 的后果很具体：前端只能显示一句"参数不对"，
           * 而人看到的是"我什么都没改错啊"，于是开始乱改表单 ——
           * 而真正该做的是刷新。文案与服务端抛出来的**原话**一致（含"刚被别人改过"），
           * 因此界面上不必再翻译一遍。
           *
           * 判定用 `instanceof` 而不是匹配错误文字：文字随时会被改得更啰嗦，
           * 而"改了文案 → 冲突悄悄退回 400"是没有任何检查会发现的那种退化。
           */
          if (cause instanceof VersionConflictError) {
            send(response, 409, { ok: false, error: cause.message });
            return;
          }
          send(response, 400, { ok: false, error: cause instanceof Error ? cause.message : "调用失败" });
        }
      })
      .catch((cause: unknown) => send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" }));
    return;
  }

  /*
   * 探活分成两个：
   *   - `/health`：**公开**，但只回最少的信息（服务名 + 库文件名）。
   *     自检与演练脚本靠它确认"起来的确实是本次这个进程"（对库文件名），
   *     所以它必须公开、必须能对出身份；
   *   - `/api/status`：**要登录**，回数据库路径、迁移、各表条数、备份状态这些细节。
   *     这些细节对运维有用，但没道理让同一个局域网里的人随便看。
   */
  if (url.pathname === "/health") {
    send(response, 200, {
      ok: true,
      service: "nexgenedu-server",
      db: DB_PATH.split("/").pop() ?? DB_PATH,
      authRequired: true,
    });
    return;
  }

  if (url.pathname === "/api/status") {
    const counts: Record<string, number> = {};
    for (const table of COUNTED_TABLES) {
      try {
        counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      } catch {
        counts[table] = -1; // -1 = 表还不存在（迁移没跑到那一步）
      }
    }
    send(response, 200, {
      ok: true,
      service: "nexgenedu-server",
      stage: "read-only",
      db: DB_PATH,
      schemaVersion: currentVersion(db),
      migration: { from: migration.from, to: migration.to, applied: migration.applied },
      routes: Object.keys(ROUTES),
      storage: "sqlite(kv)：与浏览器共用同一份 api.ts 实现",
      snapshotBytes: snapshotSize(db, "nexgenedu.admin.db.v1"),
      /*
       * 备份状态放进探活：备份是"出事那天才想起来检查"的东西，所以平时也要看得见。
       * 只报**最近一份**的时间与份数 —— 判断"备份是不是停了"只要这两样。
       */
      backup: backupsDisabled()
        ? { enabled: false }
        : {
            enabled: true,
            dir: backupDir(),
            latest: latestBackup()?.name ?? null,
            latestAt: latestBackup()?.at.toISOString() ?? null,
          },
      writes: WRITES.map((route) => `${route.method} ${route.pattern.source.replaceAll("\\/", "/")}`),
      auth: { required: true, activeSessions: activeSessionCount() },
      counts,
      time: new Date().toISOString(),
    });
    return;
  }

  // 写接口：方法 + 路径正则匹配；命中后在事务里执行
  // 报价与课程库（读 + 写都在这里）
  const pricingRoute = PRICING_ROUTES[url.pathname];
  if (pricingRoute !== undefined && request.method === pricingRoute.method) {
    void readBody(request)
      .then((body) => {
        const result = pricingRoute.handle(db, body, url);
        send(response, result.status, result.payload);
      })
      .catch((cause: unknown) => send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" }));
    return;
  }

  const deleteMatch = /^\/api\/(homework|assessments)\/([^/]+)$/.exec(url.pathname);
  if (deleteMatch !== null && request.method === "DELETE") {
    const table = deleteMatch[1] === "homework" ? "homework_records" : "assessments";
    const id = deleteMatch[2] ?? "";
    const info = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    writeLog(db, { entity: deleteMatch[1] === "homework" ? "作业" : "测评", action: "删除", targetId: id, summary: "删除记录" });
    send(response, info.changes > 0 ? 200 : 404, { deleted: info.changes > 0, id });
    return;
  }

  const recordRoute = recordRoutes[url.pathname];
  if (recordRoute !== undefined && request.method === recordRoute.method) {
    void readBody(request)
      .then((body) => {
        const result = recordRoute.handle(db, body);
        send(response, result.status, result.payload);
      })
      .catch((cause: unknown) => send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" }));
    return;
  }

  if (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE") {
    // 先看通用增删改（教师/教室/课程/学生/排课），它带护栏
    void readBody(request)
      .then((body) => {
        const result = handleCrud(db, request.method ?? "POST", url.pathname, body);
        if (result === null) {
          for (const route of WRITES) {
            const match = route.pattern.exec(url.pathname);
            if (match !== null && route.method === request.method) {
              const written = route.handle(db, match, body);
              send(response, written.status, written.payload);
              return;
            }
          }
          send(response, 404, { error: `还没有这个写接口：${request.method} ${url.pathname}` });
          return;
        }
        send(response, result.status, result.payload);
      })
      .catch((cause: unknown) => {
        send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" });
      });
    return;
  }


  /** 退费试算：只读，给出每种口径各退多少（页面在选择前要能看到差异）。 */
  const refundQuote = /^\/api\/students\/([^/]+)\/enrollments\/([^/]+)\/refund-quote$/.exec(url.pathname);
  if (refundQuote !== null) {
    const student = loadStudent(db, refundQuote[1] ?? "");
    const target = (student?.enrollments as Array<Record<string, unknown>> | undefined)?.find(
      (item) => item.id === refundQuote[2],
    );
    if (student === null || target === undefined) {
      send(response, 404, { error: "没有这条报课记录" });
      return;
    }
    const requested = url.searchParams.get("policy");
    const policies = (requested === null ? ["prorata", "list-clawback"] : [requested]).map((id) => {
      const policy = findRefundPolicy(id);
      const quote = policy.calculate({
        totalLessons: Number(target.totalLessons ?? 0),
        usedLessons: Number(target.usedLessons ?? 0),
        agreedAmount: Number(target.agreedAmount ?? 0),
        unitPrice: Number(target.unitPrice ?? 0),
      });
      return { id: policy.id, name: policy.name, refund: quote.refund, formula: quote.formula };
    });
    send(response, 200, { enrollmentId: target.id, policies });
    return;
  }

  const readSpec = READS.find((item) => url.pathname === `/api/${item.path}`);
  if (readSpec !== undefined) {
    try {
      send(response, 200, readRows(db, readSpec, url));
    } catch (cause) {
      send(response, 500, { error: cause instanceof Error ? cause.message : "查询失败" });
    }
    return;
  }

  const handler = ROUTES[url.pathname];
  if (handler === undefined) {
    send(response, 404, { error: `还没有这个接口：${url.pathname}` });
    return;
  }

  try {
    send(response, 200, handler(db, url));
  } catch (cause) {
    send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" });
  }
  } catch (cause) {
    send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" });
  }
});

/*
 * 绑定地址：默认**只绑本机回环**。
 *
 * 早期是 `server.listen(PORT)` —— 那会监听**所有网卡**，同一个 WiFi 下的任何设备
 * 都能连上来。对这个系统的定位（单用户、本机使用）来说，那是不必要的暴露面：
 * 局域网里的设备不受 CORS 约束（CORS 是浏览器的规矩），于是令牌成了唯一防线。
 * 真要给别的设备用，显式设 `NEXGENEDU_HOST=0.0.0.0` —— 那是一个有意识的决定。
 */
const HOST = process.env.NEXGENEDU_HOST ?? "127.0.0.1";

/**
 * ── 单写者锁：同一个库只允许一个后端进程 ────────────────────────────────────
 *
 * 放在 `listen` 之前：拿不到锁就**直接退出**，绝不让第二个进程开始对外服务 ——
 * 一旦它开始接请求，两个进程就会各写一份快照，后落盘的整体覆盖前一份（静默丢数据）。
 * 详细理由见 `server/db-lock.mts` 顶部。
 */
const dbLock = acquireDbLock(DB_PATH, `监听 ${HOST}:${PORT}`);
if (!dbLock.ok) {
  console.error(`\n[启动失败] ${dbLock.reason}\n`);
  process.exit(1);
}

/** 准备登录凭证（口令从环境变量来，或首次启动时随机生成并落到 server/data/）。 */
const credential = prepareCredential();

server.listen(PORT, HOST, () => {
  console.log(`后端已启动：http://${HOST}:${PORT}/health（状态 /api/status 需登录）`);
  console.log(`数据库：${DB_PATH}（结构版本 v${currentVersion(db)}）`);
  if (dbLock.file !== "") {
    console.log(`[独占] 已持有单写者锁 ${dbLock.file.split("/").pop()}（同一个库不允许第二个后端进程）`);
  }
  console.log(`只读接口：${Object.keys(ROUTES).join("、")}`);
  /*
   * 凭证的来历必须说清楚：口令是"新生成"的时候**只打印这一次**。
   * 同时把文件位置说出来 —— 打印刷过去之后那里还能找回来（否则只能删库重来）。
   */
  console.log(`[登录] 账号：${credential.username}（口令来源：${credential.source}）`);
  if (credential.generatedPassword !== null) {
    if (credential.source === "旧格式已重新生成") {
      // 说明原因，否则用户会以为"我的口令怎么变了"（旧文件里只有哈希，本来就找不回来）
      console.log("[登录] 检测到旧格式凭证文件（里面只有哈希、口令无法找回），已重新生成一份。");
    }
    console.log(`[登录] 本次新生成的口令：${credential.generatedPassword}`);
    console.log(`[登录] 已存到 ${credentialFile()}（权限 0600，含明文，忘了可以直接看里面）`);
    console.log("[登录] 也可以自己指定：NEXGENEDU_ADMIN_PASSWORD=... npm run server");
  } else if (credential.source === "环境变量") {
    console.log("[登录] 口令取自环境变量 NEXGENEDU_ADMIN_PASSWORD（已同步写入凭证文件，");
    console.log("        所以下次不带这个环境变量启动，用的还是同一份口令）。");
  } else {
    console.log(`[登录] 口令在 ${credentialFile()} 里（文件里有明文，忘了就看它）。`);
  }
  /*
   * 账号与角色（第 7 步）**必须**在启动日志里出现：升级成多账号之后，
   * "现在到底有几个账号、各是什么角色"是运维第一眼要看的东西
   * （比如"我明明给王老师加了账号，怎么没生效"）。
   * 这里**不打印口令**（唯一会打印口令的是上面那条"本次新生成"的凭证 ——
   * 不打印就第一次都登不进去）；账号文件的位置与提醒一并打印，
   * 因为"加人、改角色"要动的是那个文件。
   */
  for (const line of accountBootstrapNote().split("\n")) console.log(line);
  scheduleBackups();
});

/*
 * ── 自动备份 ────────────────────────────────────────────────────────────────
 *
 * 「每天一份」靠两处触发，而不是靠人记得：
 *   1. 启动时补齐 —— 昨天关机、今天开机第一件事就是把今天的份备上；
 *   2. 每小时检查一次 —— 长期开着不关的机器（本机构就是）也能跨过零点备上。
 *
 * 判定口径只有一份（`backupIfNotToday`）：写在两处的话，早晚分叉成
 * "启动按 24 小时算、定时器按自然日算"，于是出现一天两份或者隔天漏一份。
 *
 * `NEXGENEDU_NO_BACKUP=1` 关闭它 —— 自检与逐页验收用的是**临时库**，
 * 备份它们既没意义、又会把测试数据混进真实备份目录（那种文件被误恢复就是事故）。
 */
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** 做一次"今天还没备就备一份"，并把结果（含清理了哪些）打印出来。 */
function backupRound(label: string): void {
  if (backupsDisabled()) return;
  try {
    const outcome = backupIfNotToday(db);
    if (outcome === null) {
      const latest = latestBackup();
      console.log(`[备份] 今天已有备份（${latest?.name ?? "?"}），本次不重复备。`);
      return;
    }
    console.log(
      `[备份] ${label}已备份：${outcome.file}（${(outcome.bytes / 1024).toFixed(0)} KB，` +
      `现有 ${outcome.total} 份）`,
    );
    // 删掉谁必须说得出来：静默删除备份是不可接受的
    for (const name of outcome.removed) console.log(`[备份] 按保留份数清理：${name}`);
  } catch (cause) {
    // 备份失败不能拖垮服务：库里还有数据，服务继续用，但必须把原因喊出来
    console.error(
      `[备份] 失败（服务继续运行，请手工处理）：${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function scheduleBackups(): void {
  if (backupsDisabled()) {
    console.log("[备份] 已按 NEXGENEDU_NO_BACKUP=1 关闭自动备份（自检/验收用的临时库）。");
    return;
  }
  console.log(`[备份] 目录：${backupDir()}（每天一份，保留份数见 NEXGENEDU_BACKUP_KEEP）`);
  backupRound("启动时");
  // unref：这个定时器不该成为进程退不掉的钉子（演练与测试会反复起停服务）
  setInterval(() => backupRound("定时检查："), BACKUP_CHECK_INTERVAL_MS).unref();
}

/** Ctrl+C 时先关服务再关数据库，避免留下 -wal/-shm 的中间状态，并放开单写者锁。 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      dbLock.release();
      process.exit(0);
    });
  });
}

/*
 * 其它退出路径也要放锁：不然每次异常退出都留一个陈旧锁，
 * 下次启动虽然能靠"PID 已不存在"判废，但那要多绕一圈（而且日志会吓人一跳）。
 */
process.on("exit", () => dbLock.release());
