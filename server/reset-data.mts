/**
 * 清空业务数据（准备从零录入真实数据时用）。
 *
 * 用法：
 *   node --experimental-strip-types --import ./server/loader.mjs server/reset-data.mts --db
 *   node --experimental-strip-types --import ./server/loader.mjs server/reset-data.mts --empty-json <输出.json>
 *
 * **保留**：报价配置（pricing）—— 基础价、计费规则、教师分成是机构调过的设置，清掉可惜；
 *         网站内容镜像（site_content）—— 它本来就是 data/site/*.md 的只读副本。
 * **清空**：学生 / 教师 / 教室 / 排课 / 课堂记录 / 作业 / 测评 / 课时流水 / 收款 / 课程库 / 操作日志。
 *
 * 操作前自动 VACUUM INTO 备份；整批在一个事务里，失败全回滚。
 * 清空本身会留下一条日志（「谁在什么时候清空了数据」这件事本身也该留痕）。
 */

import { writeFileSync } from "node:fs";
import { backupTo, openDatabase } from "./db.mts";

/** 要清空的表（顺序无所谓：这里没有外键级联，全是独立表）。 */
const TABLES = [
  "students", "teachers", "classrooms", "lessons",
  "lesson_records", "homework_records", "assessments",
  "transactions", "payments", "courses", "logs",
];

const args = process.argv.slice(2);

if (args.includes("--db")) {
  const db = openDatabase();
  const before = Object.fromEntries(
    TABLES.map((table) => [table, (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n]),
  );
  const backup = backupTo(db);

  const run = db.transaction(() => {
    for (const table of TABLES) db.prepare(`DELETE FROM ${table}`).run();
    db.prepare(
      "INSERT INTO logs (id, at, operator, entity, action, target_id, summary) VALUES (?, ?, 'admin', '数据', '清空业务数据', '', ?)",
    ).run(
      `reset${Date.now().toString(36)}`,
      new Date().toISOString(),
      `清空业务数据（准备重新录入）：${TABLES.map((t) => `${t} ${before[t]}`).join("、")}`,
    );
  });
  run();

  console.log("[数据库] 清空完成：");
  for (const table of TABLES) {
    const after = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    console.log(`  ${table}: ${before[table]} → ${after}`);
  }
  const pricing = (db.prepare("SELECT COUNT(*) AS n FROM pricing").get() as { n: number }).n;
  console.log(`  保留：pricing ${pricing} 份（报价配置）`);
  console.log(`[数据库] 操作前备份：${backup}`);
  db.close();
}

const emptyIndex = args.indexOf("--empty-json");
if (emptyIndex !== -1) {
  const output = args[emptyIndex + 1];
  if (output === undefined) {
    console.error("用法：--empty-json <输出.json>");
    process.exit(2);
  }
  const db = openDatabase();
  const row = db.prepare("SELECT config FROM pricing WHERE id = 1").get() as { config: string } | undefined;
  const empty = {
    version: 12,
    students: [],
    teachers: [],
    classrooms: [],
    lessons: [],
    lessonRecords: [],
    homeworkRecords: [],
    assessments: [],
    transactions: [],
    payments: [],
    logs: [],
    inquiries: [],
    courses: [],
    // 报价配置保留：机构调过的价格与规则不该被"清空数据"顺手抹掉
    pricing: row === undefined ? null : (JSON.parse(row.config) as unknown),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(output, `${JSON.stringify(empty, null, 2)}\n`, "utf8");
  console.log(`[空库 JSON] 已写出：${output}（各业务表 0 条，报价配置保留）`);
  db.close();
}
