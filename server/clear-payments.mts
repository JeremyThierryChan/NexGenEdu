/**
 * 清空收费记录（准备完全迁移时用）。
 *
 * 用法：
 *   node --experimental-strip-types --import ./server/loader.mjs server/clear-payments.mts --db
 *   node --experimental-strip-types --import ./server/loader.mjs server/clear-payments.mts --json <导出的备份.json> <输出.json>
 *
 * **为什么必须同时把报课记录的实收归零**：实收 = 收款合计 − 退款合计，
 * 只删流水不改实收，账实立刻不符（报表不可信、自检会红）。
 * 因此两个入口都做同一件事：清空 payments + 所有报课记录 paidAmount = 0。
 *
 * 不动的：教师 / 教室 / 课程 / 学生档案 / 报课记录本身 / 课时流水 / 操作日志。
 * 操作日志**刻意保留**：它记的是「谁在什么时候做过什么」，删掉就等于抹掉历史。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { backupTo, openDatabase } from "./db.mts";

type Enrollment = { id: string; paidAmount?: number } & Record<string, unknown>;
type Student = { id: string; name: string; enrollments: Enrollment[] } & Record<string, unknown>;

/** 把每位学生的报课记录实收归零，返回改动的条数。 */
function zeroPaidAmounts(students: Student[]): number {
  let touched = 0;
  for (const student of students) {
    for (const enrollment of student.enrollments ?? []) {
      if ((enrollment.paidAmount ?? 0) !== 0) {
        enrollment.paidAmount = 0;
        touched += 1;
      }
    }
  }
  return touched;
}

const args = process.argv.slice(2);

if (args.includes("--db")) {
  const db = openDatabase();
  const before = (db.prepare("SELECT COUNT(*) AS n FROM payments").get() as { n: number }).n;
  const backup = backupTo(db);
  const students = (
    db.prepare("SELECT * FROM students").all() as Array<{ id: string; enrollments: string }>
  ).map((row) => ({ ...row, enrollments: JSON.parse(row.enrollments) as Enrollment[] }));

  let zeroed = 0;
  const run = db.transaction(() => {
    db.prepare("DELETE FROM payments").run();
    zeroed = zeroPaidAmounts(students as unknown as Student[]);
    for (const student of students) {
      db.prepare("UPDATE students SET enrollments = ? WHERE id = ?").run(
        JSON.stringify(student.enrollments),
        student.id,
      );
    }
    db.prepare(
      "INSERT INTO logs (id, at, operator, entity, action, target_id, summary) VALUES (?, ?, 'admin', '收费', '清空收费记录', '', ?)",
    ).run(
      `clear${Date.now().toString(36)}`,
      new Date().toISOString(),
      `清空收费记录 ${before} 条，${zeroed} 条报课记录的实收归零（准备完全迁移）`,
    );
  });
  run();

  const after = (db.prepare("SELECT COUNT(*) AS n FROM payments").get() as { n: number }).n;
  const nonZero = students.reduce(
    (sum, student) => sum + student.enrollments.filter((item) => (item.paidAmount ?? 0) !== 0).length,
    0,
  );
  console.log(`[数据库] 收费记录 ${before} → ${after} 条；实收归零的报课记录 ${zeroed} 条；剩余非零实收 ${nonZero} 条`);
  console.log(`[数据库] 操作前备份：${backup}`);
  db.close();
}

const jsonIndex = args.indexOf("--json");
if (jsonIndex !== -1) {
  const input = args[jsonIndex + 1];
  const output = args[jsonIndex + 2];
  if (input === undefined || output === undefined) {
    console.error("用法：--json <导出的备份.json> <输出.json>");
    process.exit(2);
  }
  const backup = JSON.parse(readFileSync(input, "utf8")) as {
    payments?: unknown[];
    students?: Student[];
  } & Record<string, unknown>;

  const paymentsBefore = Array.isArray(backup.payments) ? backup.payments.length : 0;
  const zeroed = zeroPaidAmounts(backup.students ?? []);
  backup.payments = [];
  writeFileSync(output, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  console.log(`[JSON] 收费记录 ${paymentsBefore} → 0 条；实收归零的报课记录 ${zeroed} 条`);
  console.log(`[JSON] 已写出：${output}`);
}
