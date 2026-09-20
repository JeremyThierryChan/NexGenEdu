/**
 * **恢复演练**：证明备份真的能把系统救回来。
 *
 * ## 为什么必须做这件事
 *
 * `docs/后端开发方案.md` §6 写着一句话：**没演练过的备份不算备份**。
 * 备份最容易出的事故不是"忘了备"，而是"以为备了"：
 *   - 备份文件根本不存在（策略没触发）；
 *   - 备份文件是空的 / 损坏的（VACUUM INTO 失败但没人看）；
 *   - 备份是旧库的（备的时候指错了数据库文件）；
 *   - 备份文件有了，但**没人知道怎么恢复** —— 真出事时手忙脚乱，一边查文档一边丢数据。
 * 前三条只有"把备份文件拿去真的恢复一次"才能证伪；第四条只有把恢复步骤写成脚本才能消除。
 *
 * ## 演练步骤（每一步都在核对，不靠"应该没问题"）
 *
 *   1. 起一个**临时库**的服务端（用临时备份目录，绝不碰真实数据与真实备份）；
 *   2. 通过接口写入**可识别的**数据（学生 / 报课 / 收款 / 排课），记下条数与金额；
 *   3. 触发备份，得到备份文件；
 *   4. **先验备份本身**：它是一个能打开的 SQLite 库，而且里面的数据就是刚才写的那些
 *      —— 不验这一条，后面恢复成功也可能只是"恢复了个空库"；
 *   5. 停服务，**制造灾难**：把数据库文件删掉（连同 -wal/-shm）；
 *   6. 只靠备份文件恢复：把它复制回数据库路径；
 *   7. 重启服务，核对：数据条数一致、金额一致、课时与账本的不变式仍然成立；
 *   8. 收尾（停服务、删临时库与临时备份目录）。
 *
 * 任何一步不成立就**响亮地失败**并打印细节 —— 这份演练的价值全在"它敢说不行"。
 *
 * 用法：`npm run drill:restore`
 */

import { copyFileSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer, repoRoot } from "./temp-server.mts";
import { openDatabase } from "../server/db.mts";
import {
  backedUpToday,
  backupIfNotToday,
  listBackups,
  pruneBackups,
} from "../server/backup.mts";

/* ── 小工具 ──────────────────────────────────────────────────────────── */

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail === "" ? "" : `\n      ${detail}`}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `实际: ${JSON.stringify(actual)}\n      期望: ${JSON.stringify(expected)}`);
}

/**
 * 当前令牌（登录后设置）。
 *
 * 第 6 步之后所有 `/api/call` 都要登录，演练也必须先登进来 ——
 * 这顺带让"登录这条路"每次演练都被走一遍。
 */
let token = "";

async function login(base: string, username: string, password: string): Promise<void> {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = (await response.json()) as { ok?: boolean; token?: string; error?: string };
  if (payload.ok !== true || typeof payload.token !== "string") {
    throw new Error(`演练登录失败：${payload.error ?? `HTTP ${response.status}`}`);
  }
  token = payload.token;
}

/** 一次带令牌的请求（与页面走的是同一条路：POST /api/call）。 */
async function call(base: string, method: string, args: unknown[] = []): Promise<unknown> {
  const response = await fetch(`${base}/api/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ method, args }),
  });
  const payload = (await response.json()) as { ok?: boolean; result?: unknown; error?: string };
  if (payload.ok !== true) throw new Error(`调用 ${method} 失败：${payload.error ?? "未知错误"}`);
  return payload.result;
}

/** 读需要登录的状态页（备份状态在里面）。未登录时它会回 401，这也是一条断言。 */
async function status(base: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/api/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`读 /api/status 失败：HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

/** 删掉数据库文件本身（连同 WAL 文件）：模拟"文件没了"。 */
function destroyDatabase(dbPath: string): string[] {
  const removed: string[] = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = join(repoRoot, `${dbPath}${suffix}`);
    if (existsSync(file)) {
      rmSync(file);
      removed.push(`${dbPath}${suffix}`);
    }
  }
  return removed;
}

/** 把数据压成可比较的"指纹"：条数 + 金额 + 课时 + 账本，避免只比一个数字。 */
type Fingerprint = {
  students: number;
  classrooms: number;
  lessons: number;
  payments: number;
  /** 实收合计（元）。 */
  paidTotal: number;
  lessonTotal: number;
  usedTotal: number;
  /** 有效课时流水的条数与净额 —— 账本是"恢复了但账不对"最容易藏问题的地方。 */
  ledgerCount: number;
  ledgerDelta: number;
};

async function fingerprint(base: string): Promise<Fingerprint> {
  const students = (await call(base, "students.list")) as Array<{
    enrollments: Array<{ id: string; totalLessons: number; usedLessons: number; paidAmount: number }>;
  }>;
  const payments = (await call(base, "payments.list")) as Array<{ amount: number }>;
  const enrollments = students.flatMap((student) => student.enrollments);

  // 账本按报课逐条取：口径是「已用课时 = 有效上课流水」（见 docs/后端开发方案.md §5.2.2）
  const ledger: Array<{ delta: number; reversedAt: string }> = [];
  for (const enrollment of enrollments) {
    const rows = (await call(base, "transactions.listByEnrollment", [enrollment.id])) as typeof ledger;
    ledger.push(...rows.filter((row) => row.reversedAt === ""));
  }

  return {
    students: students.length,
    classrooms: ((await call(base, "classrooms.list")) as unknown[]).length,
    lessons: ((await call(base, "lessons.list")) as unknown[]).length,
    payments: payments.length,
    // 金额用「分」累加再折回元：浮点相加在演练里出误差会误导人
    paidTotal: Math.round(enrollments.reduce((sum, e) => sum + e.paidAmount * 100, 0)) / 100,
    lessonTotal: enrollments.reduce((sum, e) => sum + e.totalLessons, 0),
    usedTotal: enrollments.reduce((sum, e) => sum + e.usedLessons, 0),
    ledgerCount: ledger.length,
    ledgerDelta: ledger.reduce((sum, row) => sum + row.delta, 0),
  };
}

/** 直接从备份文件的快照里算指纹（不看它一眼就用它恢复，等于赌）。 */
function fingerprintOfSnapshot(snapshot: {
  students?: Array<{ enrollments?: Array<{ id: string; totalLessons: number; usedLessons: number; paidAmount: number }> }>;
  classrooms?: unknown[];
  lessons?: unknown[];
  payments?: unknown[];
  transactions?: Array<{ enrollmentId: string; delta: number; reversedAt: string }>;
}): Fingerprint {
  const enrollments = (snapshot.students ?? []).flatMap((s) => s.enrollments ?? []);
  const ledger = (snapshot.transactions ?? []).filter((row) => row.reversedAt === "");
  return {
    students: (snapshot.students ?? []).length,
    classrooms: (snapshot.classrooms ?? []).length,
    lessons: (snapshot.lessons ?? []).length,
    payments: (snapshot.payments ?? []).length,
    paidTotal: Math.round(enrollments.reduce((sum, e) => sum + e.paidAmount * 100, 0)) / 100,
    lessonTotal: enrollments.reduce((sum, e) => sum + e.totalLessons, 0),
    usedTotal: enrollments.reduce((sum, e) => sum + e.usedLessons, 0),
    ledgerCount: ledger.length,
    ledgerDelta: ledger.reduce((sum, row) => sum + row.delta, 0),
  };
}

/* ── 演练 ────────────────────────────────────────────────────────────── */

const stamp = `${Date.now()}`;
const dbPath = `server/data/drill-${stamp}.db`;
const backupDirPath = join(repoRoot, `server/data/drill-backups-${stamp}`);

// 让本进程的备份模块也指向临时目录：策略检查（保留份数、每天一份）要在隔离环境里做，
// 否则会去动真实备份目录里的东西
process.env.NEXGENEDU_BACKUP_DIR = backupDirPath;
process.env.NEXGENEDU_BACKUP_KEEP = "5";

console.log("=== 恢复演练：备份能不能真的把数据救回来 ===");
console.log(`临时库：${dbPath}`);
console.log(`临时备份目录：server/data/drill-backups-${stamp}\n`);

let handle: Awaited<ReturnType<typeof startServer>> | null = null;

try {
  /* 1. 起服务（临时库 + 临时备份目录，自动备份开着 —— 演练就是要验它） */
  console.log("[1/8] 起临时服务端");
  handle = await startServer({
    dbPath,
    env: { NEXGENEDU_BACKUP_DIR: backupDirPath, NEXGENEDU_BACKUP_KEEP: "5" },
  });
  console.log(`      ${handle.base}`);

  // 未登录时状态页必须是 401（备份目录、表结构这些细节不对门外的人讲）
  check("未登录读 /api/status 被拒", (await fetch(`${handle.base}/api/status`)).status === 401);

  await login(handle.base, handle.credentials.username, handle.credentials.password);
  const info = await status(handle.base);
  const backup = info.backup as { enabled?: boolean; latest?: string | null } | undefined;
  check("登录后能读到状态", info.ok === true);
  check("服务端报告自动备份已启用", backup?.enabled === true);
  // 启动那一刻就应该补上"今天的备份"：这正是"昨天关机、今天开机"的场景
  check("启动时已自动备份今天的份", typeof backup?.latest === "string" && backup.latest !== "",
    `latest = ${String(backup?.latest)}`);

  /* 2. 写入可识别的数据 */
  console.log("\n[2/8] 写入演练数据（学生 / 报课 / 收款 / 排课）");
  const student = (await call(handle.base, "students.create", [{
    name: "演练·张三", grade: "初二", guardian: "138-0000-0001",
    status: "在读", note: "恢复演练用", profile: {},
  }])) as { id: string };
  const classroom = (await call(handle.base, "classrooms.create", [{
    name: "演练教室", capacity: 6, kind: "上课用教室", note: "",
    availability: [{ id: "d-a1", weekdays: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00" }],
  }])) as { id: string };
  const teacher = (await call(handle.base, "teachers.create", [{
    name: "演练老师", subjects: ["数学"], role: "授课教师", phone: "", active: true,
  }])) as { id: string };

  const enrolled = (await call(handle.base, "students.enroll", [student.id, {
    subject: "数学", form: "一对一定制课", teacherId: teacher.id, lessons: 20,
    startedAt: new Date().toISOString(), note: "演练报课",
  }])) as { enrollments: Array<{ id: string }> };
  const enrollmentId = enrolled.enrollments[0]!.id;

  // 收款 3600 元：这个数就是"恢复后钱对不对"的判据
  await call(handle.base, "payments.record", [{
    studentId: student.id, enrollmentId, amount: 3600, kind: "收款",
    method: "微信", note: "演练收款",
  }]);
  await call(handle.base, "lessons.create", [{
    subject: "数学", form: "一对一定制课", teacherId: teacher.id, classroomId: classroom.id,
    studentIds: [student.id], startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    durationMinutes: 90, status: "已排", note: "演练排课", makeupForLessonId: "",
  }]);

  /*
   * 标记已上：这是**唯一**会产生课时流水的动作（报课只写报课记录与收款流水，
   * 详见 docs/后端开发方案.md §5.2.2 —— 我第一版演练就在这里想错了，以为报课会写一条）。
   * 让它进备份，恢复后要核对的就不只是"数据在不在"，而是"账还对得上吗"。
   */
  const lessons = (await call(handle.base, "lessons.list")) as Array<{ id: string }>;
  await call(handle.base, "lessons.markCompleted", [lessons[0]!.id]);

  const before = await fingerprint(handle.base);
  console.log(`      ${JSON.stringify(before)}`);
  equal("演练数据写入正确（20 节课、扣 1 节、3600 元）",
    [before.students, before.lessonTotal, before.usedTotal, before.paidTotal], [1, 20, 1, 3600]);
  equal("课时账本记的是「上课扣减」这一条", [before.ledgerCount, before.ledgerDelta], [1, -1]);

  /* 3. 备份 */
  console.log("\n[3/8] 备份（VACUUM INTO）");
  const cli = await import("node:child_process");
  const backupOutput = await new Promise<string>((resolve, reject) => {
    const child = cli.spawn(
      process.execPath,
      ["--experimental-strip-types", "--import", "./server/loader.mjs", "server/backup-cli.mts", "--force"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NEXGENEDU_DB: dbPath,
          NEXGENEDU_BACKUP_DIR: backupDirPath,
          NEXGENEDU_BACKUP_KEEP: "5",
        },
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { out += chunk.toString(); });
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
  });
  process.stdout.write(backupOutput.replace(/^/gm, "      "));
  const backups = listBackups(backupDirPath);
  check("备份文件已生成", backups.length > 0, `备份目录里有 ${backups.length} 个文件`);
  if (backups.length === 0) throw new Error("没有备份文件，后面的恢复无从谈起");
  const backupFile = backups[0]!;
  check("备份文件不是空的", backupFile.bytes > 0, `${backupFile.bytes} 字节`);

  /*
   * 备份策略：保留份数是**会删东西**的逻辑，必须有证据它删对了。
   * 三条要守的：① 超过保留份数时删最旧的；② 目录里不属于备份的文件一根手指都不碰；
   * ③ 同一天不重复备（否则"每天一份"会变成"每小时一份"）。
   */
  const stray = join(backupDirPath, "note.txt");
  writeFileSync(stray, "这不是备份，清理时不该被删");
  const strayDb = join(backupDirPath, "someone-elses-archive.db");
  writeFileSync(strayDb, "命名不合规则的文件也不该被删");
  for (const extra of ["2020-01-01-00-00-00", "2020-01-02-00-00-00", "2020-01-03-00-00-00"]) {
    writeFileSync(join(backupDirPath, `nexgenedu-${extra}.db`), "旧备份（只为验证清理规则）");
  }
  const pruned = pruneBackups(2, backupDirPath);
  equal("保留份数生效：只留最新的 2 份", listBackups(backupDirPath).length, 2);
  equal("被清理的是最旧的 3 份", pruned.removed.sort(),
    ["nexgenedu-2020-01-01-00-00-00.db", "nexgenedu-2020-01-02-00-00-00.db", "nexgenedu-2020-01-03-00-00-00.db"]);
  check("目录里不属于备份的文件不会被清理", existsSync(stray) && existsSync(strayDb));
  check("最新那份备份在清理中幸存", existsSync(backupFile.path));

  const liveDb = openDatabase(dbPath);
  try {
    check("判定「今天已备份」正确", backedUpToday(new Date(), backupDirPath));
    check("同一天不会重复备份", backupIfNotToday(liveDb) === null);
  } finally {
    liveDb.close();
  }

  /* 4. 先验备份本身：能打开、且里面就是刚才写的数据 */
  console.log("\n[4/8] 验证备份文件本身（不看它一眼就用它恢复，等于赌）");
  const backupDb = openDatabase(backupFile.path);
  let backupFingerprint: Fingerprint;
  try {
    const row = backupDb
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get("nexgenedu.admin.db.v1") as { value: string } | undefined;
    check("备份里能读出数据快照", typeof row?.value === "string" && row.value.length > 0);
    backupFingerprint = fingerprintOfSnapshot(JSON.parse(row?.value ?? "{}"));
  } finally {
    backupDb.close();
  }
  equal("备份内容与备份那一刻的数据一致（含课时账本）", backupFingerprint, before);

  /* 5. 停服务 + 制造灾难 */
  console.log("\n[5/8] 停服务，并制造灾难（删掉数据库文件）");
  await handle.stop();
  handle = null;
  const removedFiles = destroyDatabase(dbPath);
  check("数据库文件确实被删掉了", removedFiles.length > 0 && !existsSync(join(repoRoot, dbPath)),
    `删除了 ${removedFiles.join("、")}`);

  /* 6. 恢复：只靠备份文件 */
  console.log("\n[6/8] 用备份文件恢复");
  const restoredPath = join(repoRoot, dbPath);
  copyFileSync(backupFile.path, restoredPath);
  check("备份文件已复制回数据库路径", statSync(restoredPath).size > 0);

  /* 7. 重启并核对 */
  console.log("\n[7/8] 重启服务并核对数据");
  handle = await startServer({
    dbPath,
    env: { NEXGENEDU_BACKUP_DIR: backupDirPath, NEXGENEDU_BACKUP_KEEP: "5" },
  });
  /*
   * 重启后旧令牌必然失效（会话在服务端内存里，见 server/auth.mts 的取舍说明）。
   * 这一条也顺手证明了"重启即登出"这个行为确实成立。
   */
  const staleStatus = await fetch(`${handle.base}/api/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  check("重启后旧令牌失效（会话不落盘）", staleStatus.status === 401);
  await login(handle.base, handle.credentials.username, handle.credentials.password);
  const after = await fingerprint(handle.base);
  console.log(`      ${JSON.stringify(after)}`);
  equal("恢复后所有条数、金额与课时账本完全一致", after, before);
  const restoredStudents = (await call(handle.base, "students.list")) as Array<{ name: string }>;
  equal("恢复后演练学生还在", restoredStudents.map((s) => s.name), ["演练·张三"]);
  /*
   * 口径复核（§5.2.2）：剩余课时 = 总课时 − 已用课时，且**已用课时来自上课流水**。
   * 恢复后这两条要同时成立 —— "数据回来了但账不对"比没回来更可怕。
   */
  equal("恢复后剩余课时 = 总课时 − 已用课时", after.lessonTotal - after.usedTotal, 19);
} catch (cause) {
  failures += 1;
  console.error(`\n✗ 演练中断：${cause instanceof Error ? cause.message : String(cause)}`);
  if (handle !== null) console.error(`服务端输出：\n${handle.log()}`);
} finally {
  /* 8. 收尾 */
  console.log("\n[8/8] 收尾（停服务、删临时库与临时备份）");
  if (handle !== null) await handle.stop().catch(() => undefined);
  destroyDatabase(dbPath);
  if (existsSync(backupDirPath)) rmSync(backupDirPath, { recursive: true, force: true });
  const leftovers = readdirSync(join(repoRoot, "server/data")).filter((name) => name.startsWith("drill-"));
  check("临时文件已清理干净", leftovers.length === 0, `还剩：${leftovers.join("、")}`);
}

console.log(
  failures === 0
    ? "\n=== 恢复演练通过：备份文件可以独立把系统恢复回灾难前的状态 ==="
    : `\n=== 恢复演练失败：${failures} 项不成立（上面有细节）===`,
);
process.exit(failures === 0 ? 0 : 1);
