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
import { currentVersion, migrate } from "./migrate.mts";
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

function writeLog(
  db: Database.Database,
  entry: { entity: string; action: string; targetId: string; summary: string },
): void {
  db.prepare(
    "INSERT INTO logs (id, at, operator, entity, action, target_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(nextId("log"), new Date().toISOString(), "admin", entry.entity, entry.action, entry.targetId, entry.summary);
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

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

const db = openDatabase();
const migration = migrate(db);

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  /*
   * 全局兜底：任何未预期的异常都要变成 500 响应，而不是让进程退出。
   * 这一条是踩出来的 —— 之前一个 SQL 表名写错，直接把整个服务打挂了（测试时报
   * ERR_EMPTY_RESPONSE / other side closed），那种故障在真机上就是"后台突然全打不开"。
   */
  try {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
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
      writes: WRITES.map((route) => `${route.method} ${route.pattern.source.replace(/\\//g, "/")}`),
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

server.listen(PORT, () => {
  console.log(`后端已启动：http://localhost:${PORT}/health`);
  console.log(`数据库：${DB_PATH}（结构版本 v${currentVersion(db)}）`);
  console.log(`只读接口：${Object.keys(ROUTES).join("、")}`);
});

/** Ctrl+C 时先关服务再关数据库，避免留下 -wal/-shm 的中间状态。 */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
