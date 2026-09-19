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
      counts,
      time: new Date().toISOString(),
    });
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
