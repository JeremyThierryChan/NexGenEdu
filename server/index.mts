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
    const rows =
      from !== null && to !== null
        ? (db
            .prepare("SELECT * FROM lessons WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at")
            .all(from, to) as Row[])
        : (db.prepare("SELECT * FROM lessons ORDER BY starts_at").all() as Row[]);
    return rows.map(toLesson);
  },

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
    handle: (db, match) => {
      const row = db.prepare("SELECT * FROM lessons WHERE id = ?").get(match[1] ?? "") as Row | undefined;
      if (row === undefined) return { status: 404, payload: { error: "没有这节课" } };
      const lesson = toLesson(row);
      if (lesson.status === "已上") return { status: 200, payload: { skipped: true, lesson } };

      const run = db.transaction(() => {
        for (const studentId of lesson.studentIds) {
          const student = loadStudent(db, studentId);
          if (student === null) continue;
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
      return { status: 200, payload: { skipped: false, lesson: toLesson(updated) } };
    },
  },
];

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

const db = openDatabase();
const migration = migrate(db);

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
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
  if (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE") {
    for (const route of WRITES) {
      const match = route.pattern.exec(url.pathname);
      if (match !== null && route.method === request.method) {
        void readBody(request)
          .then((body) => {
            const result = route.handle(db, match, body);
            send(response, result.status, result.payload);
          })
          .catch((cause: unknown) => {
            send(response, 500, { error: cause instanceof Error ? cause.message : "服务器内部错误" });
          });
        return;
      }
    }
    send(response, 404, { error: `还没有这个写接口：${request.method} ${url.pathname}` });
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
