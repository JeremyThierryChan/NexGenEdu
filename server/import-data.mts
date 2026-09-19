/**
 * 把「数据与备份」导出的 JSON 灌进 SQLite（一次性搬迁）。
 *
 * 三道保险（与页面上的导入功能同一套口径）：
 *   1. **校验**：先检查 JSON 结构与版本，不合格直接退出、不动现有数据；
 *   2. **备份**：导入前用 VACUUM INTO 自动备份数据库文件；
 *   3. **对账**：导入后逐表核对条数，与备份文件不一致就报错退出（退出码 1）。
 *
 * 全部导入在一个事务里：失败整批回滚，不会留下「导了一半」的库。
 * 用法：node --experimental-strip-types server/import-data.mts <备份.json>
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type Database from "better-sqlite3";
import { backupTo, openDatabase } from "./db.mts";
import { migrate } from "./migrate.mts";

const j = (value: unknown): string => JSON.stringify(value ?? null);

/** 备份文件里的一行：外部输入，字段名按备份格式，值类型未知。 */
type BackupRow = Record<string, unknown>;
/** 备份文件本身（只有我们用到的字段）。 */
type BackupFile = { version: number; updatedAt?: string; pricing?: Record<string, unknown> } & Record<
  string,
  unknown
>;

/** 表 → 行映射。键是备份里的数组名，值是「一行 JSON → SQL 参数」。 */
const TABLES: Record<string, { table: string; columns: string[]; row: (r: BackupRow) => unknown[] }> = {
  students: {
    table: "students",
    columns: ["id", "name", "grade", "guardian", "status", "note", "created_at", "enrollments", "profile"],
    row: (r) => [r.id, r.name, r.grade, r.guardian, r.status, r.note, r.createdAt, j(r.enrollments ?? []), j(r.profile ?? {})],
  },
  teachers: {
    table: "teachers",
    columns: ["id", "name", "role", "subjects", "phone", "active"],
    row: (r) => [r.id, r.name, r.role, j(r.subjects ?? []), r.phone, r.active ? 1 : 0],
  },
  classrooms: {
    table: "classrooms",
    columns: ["id", "name", "capacity", "kind", "availability", "note"],
    row: (r) => [r.id, r.name, r.capacity, r.kind, j(r.availability ?? []), r.note],
  },
  lessons: {
    table: "lessons",
    columns: ["id", "subject", "form", "teacher_id", "classroom_id", "student_ids", "starts_at", "duration_minutes", "status", "note", "makeup_for_lesson_id"],
    row: (r) => [r.id, r.subject, r.form, r.teacherId, r.classroomId, j(r.studentIds ?? []), r.startsAt, r.durationMinutes, r.status, r.note, r.makeupForLessonId ?? ""],
  },
  lessonRecords: {
    table: "lesson_records",
    columns: ["id", "lesson_id", "student_id", "attendance", "leave_requested_at", "focus", "interaction", "rating", "note", "recorded_at"],
    row: (r) => [r.id, r.lessonId, r.studentId, r.attendance, r.leaveRequestedAt ?? "", r.focus, r.interaction, r.rating, r.note, r.recordedAt],
  },
  homeworkRecords: {
    table: "homework_records",
    columns: ["id", "student_id", "date", "subject", "submission", "accuracy", "weak_points", "note"],
    row: (r) => [r.id, r.studentId, r.date, r.subject, r.submission, r.accuracy, r.weakPoints ?? "", r.note],
  },
  assessments: {
    table: "assessments",
    columns: ["id", "student_id", "subject", "date", "score", "previous_score", "weak_points", "note"],
    row: (r) => [r.id, r.studentId, r.subject, r.date, r.score ?? null, r.previousScore ?? null, r.weakPoints ?? "", r.note],
  },
  transactions: {
    table: "transactions",
    columns: ["id", "student_id", "enrollment_id", "subject", "delta", "kind", "lesson_id", "at", "note", "reversed_at"],
    row: (r) => [r.id, r.studentId, r.enrollmentId ?? "", r.subject ?? "", r.delta, r.kind, r.lessonId ?? "", r.at, r.note, r.reversedAt ?? ""],
  },
  payments: {
    table: "payments",
    columns: ["id", "student_id", "enrollment_id", "amount", "kind", "method", "at", "note"],
    row: (r) => [r.id, r.studentId ?? "", r.enrollmentId ?? "", r.amount, r.kind, r.method, r.at, r.note],
  },
  courses: {
    table: "courses",
    columns: ["id", "name", "category", "forms", "origin", "status", "note", "created_at"],
    row: (r) => [r.id, r.name, r.category, j(r.forms ?? []), r.origin, r.status, r.note ?? "", r.createdAt ?? ""],
  },
  logs: {
    table: "logs",
    columns: ["id", "at", "operator", "entity", "action", "target_id", "summary"],
    row: (r) => [r.id, r.at, r.operator, r.entity, r.action, r.targetId ?? "", r.summary],
  },
  inquiries: {
    table: "inquiries",
    columns: ["id", "student_name", "grade", "guardian", "subject", "duration_minutes", "interval_weeks", "planned_lessons", "starts_at", "candidates", "preferred_teacher_id", "preferred_classroom_id", "skip_dates", "status", "note", "scheduled_lesson_ids", "created_at"],
    row: (r) => [r.id, r.studentName, r.grade, r.guardian, r.subject, r.durationMinutes, r.intervalWeeks, r.plannedLessons, r.startsAt, j(r.candidates ?? []), r.preferredTeacherId ?? "", r.preferredClassroomId ?? "", j(r.skipDates ?? []), r.status, r.note ?? "", j(r.scheduledLessonIds ?? []), r.createdAt],
  },
};

export function importBackup(
  db: Database.Database,
  backup: BackupFile,
): { counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  const run = db.transaction(() => {
    for (const [key, spec] of Object.entries(TABLES)) {
      const rows = (Array.isArray(backup[key]) ? backup[key] : []) as BackupRow[];
      const placeholders = spec.columns.map(() => "?").join(", ");
      const statement = db.prepare(
        `INSERT OR REPLACE INTO ${spec.table} (${spec.columns.join(", ")}) VALUES (${placeholders})`,
      );
      for (const row of rows) statement.run(...spec.row(row));
      counts[spec.table] = rows.length;
    }
    // 报价配置是单行结构（不是数组），单独处理
    if (backup.pricing !== undefined && backup.pricing !== null) {
      const pricing = backup.pricing;
      db.prepare("INSERT OR REPLACE INTO pricing (id, config, source, updated_at) VALUES (1, ?, ?, ?)").run(
        j(pricing),
        typeof pricing.source === "string" ? pricing.source : "",
        typeof pricing.updatedAt === "string" ? pricing.updatedAt : (backup.updatedAt ?? ""),
      );
      counts.pricing = 1;
    }
  });
  run();
  return { counts };
}

/** 命令行入口。 */
if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  const file = process.argv[2];
  if (file === undefined) {
    console.error("用法：node --experimental-strip-types server/import-data.mts <备份.json>");
    process.exit(2);
  }

  const backup = JSON.parse(readFileSync(file, "utf8")) as BackupFile;
  if (typeof backup.version !== "number" || !Array.isArray(backup.students)) {
    console.error("这个文件不像「数据与备份」导出的 JSON：缺少 version 或 students。");
    process.exit(2);
  }

  const db = openDatabase();
  const migration = migrate(db);
  const backupFile = backupTo(db); // 保险②：导入前备份
  const { counts } = importBackup(db, backup);

  // 保险③：对账
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(TABLES)) {
    const expected = Array.isArray(backup[key]) ? backup[key].length : 0;
    const actual = (db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table}`).get() as { n: number }).n;
    if (actual !== expected) problems.push(`${spec.table}：期望 ${expected}，实际 ${actual}`);
  }
  const pricingRows = (db.prepare("SELECT COUNT(*) AS n FROM pricing").get() as { n: number }).n;
  if (pricingRows !== 1) problems.push(`pricing：期望 1，实际 ${pricingRows}`);

  console.log(`来源文件：${file}（结构版本 v${backup.version}）`);
  console.log(`数据库迁移：v${migration.from} → v${migration.to}${migration.skipped ? "（无需迁移）" : ""}`);
  console.log(`导入前备份：${backupFile}`);
  console.log("导入条数：", JSON.stringify(counts));
  if (problems.length > 0) {
    console.error("对账失败（数据已导入，请检查）：\n  " + problems.join("\n  "));
    db.close();
    process.exit(1);
  }
  console.log("对账通过：每张表的条数都与备份文件一致。");
  db.close();
}
