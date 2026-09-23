/**
 * 容量测量：**数据量 → 快照体积 / 读写耗时 / 内存**。
 *
 * ## 为什么需要它
 *
 * 这个后端的存储是**快照式**的（路线 B，见 docs/后端开发方案.md §5.3）：
 * 整库是 `kv` 表里的一份 JSON。这意味着一个关键性质 ——
 * **每一次写入都会把整库重新序列化并落盘一遍**，成本随"库的总行数"线性增长，
 * 而不是随"你改的那一行"。
 *
 * 于是"这台机器够不够用"这个问题没法靠感觉回答，只能量：
 * 学生数、排课数涨上去之后，写一次要多少毫秒、内存占多少、备份占多少磁盘。
 * 这个脚本就是那把尺子 —— 想知道自己什么时候该考虑迁到 SQL（路线 C），
 * 隔一段时间跑一次它，看数字就行。
 *
 * ## 怎么读结果
 *
 * | 列 | 含义 | 什么时候该警觉 |
 * | --- | --- | --- |
 * | `JSON快照` | 整库序列化后的大小 = 每次写入的搬运量 | 它同时决定**备份占多少磁盘**（保留份数 × 快照大小） |
 * | `序列化+落盘` | 一次写入的真实成本（不含任何人工延迟） | 超过 ~200ms 就该考虑路线 C 了 |
 * | `冷读(含解析)` | 进程刚起来第一次读（要把快照解析进内存） | 决定"后端启动后第一次点页面"的等待 |
 * | `热读` | 库已在内存中时的读 | 应当接近 0；若明显不为 0，说明有别的开销 |
 * | `写入一次` | 走完整业务方法的一次写入（含校验、记账、写日志） | 这是用户按一个按钮真正感受到的 |
 * | `内存RSS` | 进程常驻内存（含 Node 基线约 40–60MB） | 小机器（2GB）要留意 |
 *
 * ## 关于"人工延迟"
 *
 * `lib/backend/api.ts` 里有一个 `LATENCY_MS = 120` 的**模拟网络延迟**，
 * 它只在浏览器里生效（为了让加载态在开发时看得见），Node 里是 0 ——
 * 所以本脚本量的是**真实成本**，不含那 120ms。
 * （这一条的代价曾经很硬：服务端每个请求白等 120ms，`npm run check` 38 秒里 37 秒在 sleep。）
 *
 * ## 数据是合成的
 *
 * 用接近真实的形状造数据（每人 2 条报课、每周 1–2 节课、报课 history、课时流水、
 * 收款、日志按上限 500 条），但**不碰真实库**：跑在 `server/data/bench-capacity.db`，
 * 跑完删掉。学生/课时规模可以用参数改：
 *
 *   npm run bench:capacity                     # 默认跑 20 / 100 / 300 / 800 名学生
 *   npm run bench:capacity -- 50 200 500       # 自定义规模
 */

import { rmSync, statSync } from "node:fs";
import { openDatabase } from "../server/db.mts";
import { createSqliteStore } from "../server/kv-store.mts";
import { api, __useStoreForTesting, LOG_LIMIT } from "../lib/backend/api.ts";
import { CURRENT_VERSION } from "../lib/backend/version.ts";
import { materializeSiteCourses } from "../lib/backend/courses.ts";
import { catalogFromSeed } from "../lib/backend/catalog-seed.ts";
import { pricingConfigFromContent } from "../lib/backend/pricing.ts";

/** 测量用的临时库：与真实库同目录但名字不同，跑完即删。 */
const DB_PATH = "server/data/bench-capacity.db";
const KEY = "nexgenedu.admin.db.v1";

const iso = (dayOffset: number) => new Date(Date.now() + dayOffset * 86_400_000).toISOString();

/** 每位学生每年大约上多少节课（每周 1–2 节，取 50）。 */
const LESSONS_PER_STUDENT_PER_YEAR = 50;

/** 造一份形状接近真实使用、规模可控的库。 */
function buildDatabase(studentCount: number, lessonsPerStudent: number): Record<string, unknown> {
  const teachers = Array.from({ length: 6 }, (_, index) => ({
    id: `t${index}`, name: `教师${index}`, subjects: ["数学"], role: "授课教师", phone: "", active: true,
  }));
  const classrooms = Array.from({ length: 4 }, (_, index) => ({
    id: `c${index}`, name: `${300 + index} 教室`, kind: "上课用教室", capacity: 8,
    availability: [{ id: `c${index}-a`, weekdays: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00" }],
    note: "",
  }));

  const students: unknown[] = [];
  const lessons: unknown[] = [];
  const transactions: unknown[] = [];
  const payments: unknown[] = [];

  for (let s = 0; s < studentCount; s += 1) {
    const subjects = ["数学", "英语"];
    const enrollments = subjects.map((subject, e) => {
      const id = `e${s}_${e}`;
      const totalLessons = 40;
      const usedLessons = (s + e) % 10; // 0–9，确定性生成（每次跑出的数字可比）
      for (let u = 0; u < usedLessons; u += 1) {
        transactions.push({
          id: `x${s}_${e}_${u}`, enrollmentId: id, studentId: `s${s}`, lessonId: "",
          kind: "上课", delta: -1, at: iso(-u), note: "", reversedAt: "",
        });
      }
      payments.push({
        id: `p${s}_${e}`, studentId: `s${s}`, enrollmentId: id, amount: totalLessons * 200,
        kind: "收款", method: "微信", at: iso(-90), note: "",
      });
      return {
        id, subject, form: "一对一定制课", teacherId: `t${e}`, totalLessons, usedLessons,
        unitPrice: 200, agreedAmount: totalLessons * 200, paidAmount: totalLessons * 200,
        status: "在读", startedAt: iso(-90), note: "",
        history: [
          { id: `h${s}_${e}_1`, kind: "报课", at: iso(-90), lessons: totalLessons, note: "", amount: totalLessons * 200, method: "微信" },
          { id: `h${s}_${e}_2`, kind: "上课", at: iso(-10), lessons: -usedLessons, note: "", amount: 0, method: "" },
        ],
      };
    });

    students.push({
      id: `s${s}`, name: `学生${s}`, grade: "初二", guardian: "13800000000",
      subjects, status: "在读", note: "", createdAt: iso(-120), enrollments, profile: {},
    });

    for (let l = 0; l < lessonsPerStudent; l += 1) {
      lessons.push({
        id: `l${s}_${l}`, subject: "数学", form: "一对一定制课", teacherId: `t${l % 6}`,
        classroomId: `c${l % 4}`, studentIds: [`s${s}`], startsAt: iso(-l), durationMinutes: 90,
        status: l % 5 === 0 ? "已排" : "已上", note: "", makeupForLessonId: "", createdAt: iso(-l),
      });
    }
  }

  const siteCourses = materializeSiteCourses([], undefined, catalogFromSeed());
  return {
    version: CURRENT_VERSION,
    students, teachers, classrooms, lessons,
    lessonRecords: [], homeworkRecords: [], assessments: [], transactions, payments,
    // 日志按真实上限截断：它不会无限涨，所以不会成为容量问题的来源
    logs: Array.from({ length: LOG_LIMIT }, (_, i) => ({
      id: `log${i}`, at: iso(-i), operator: "admin", entity: "学生", action: "修改",
      targetId: "s0", summary: "修改了基础字段",
    })),
    inquiries: [],
    // 课程与分区一起造（与空库起步同一处实现）：只给 courses 会让课程全部变成「未归类」
    courses: siteCourses.courses,
    coursePartitions: siteCourses.partitions,
    pricing: pricingConfigFromContent(),
    updatedAt: iso(0),
  };
}

const timeIt = async (run: () => unknown): Promise<number> => {
  const started = process.hrtime.bigint();
  await run();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

function removeTempDb(): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DB_PATH}${suffix}`, { force: true });
}

const args = process.argv.slice(2).map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
const scales = args.length > 0 ? args : [20, 100, 300, 800];

console.log("=== 容量测量（快照式存储：每次写入都重写整库）===");
console.log(`每位学生每年按 ${LESSONS_PER_STUDENT_PER_YEAR} 节课估算；数据为合成数据，不碰真实库\n`);
console.log("学生 |  排课 | JSON快照 |  库文件 | 序列化+落盘 | 冷读(含解析) | 热读 | 写入一次 | 内存RSS");
console.log("-----|-------|----------|---------|-------------|--------------|------|----------|--------");

for (const studentCount of scales) {
  const lessonsPerStudent = LESSONS_PER_STUDENT_PER_YEAR;
  removeTempDb();
  const db = openDatabase(DB_PATH);
  try {
    const store = createSqliteStore(db);
    const data = buildDatabase(studentCount, lessonsPerStudent);
    const json = JSON.stringify(data);
    const snapshotBytes = Buffer.byteLength(json);

    const writeMs = await timeIt(() => store.write(KEY, json));
    const fileBytes = statSync(DB_PATH).size;

    // 切到这份库上，量真实业务方法的成本
    __useStoreForTesting(store);
    const coldMs = await timeIt(() => api.students.list());
    const warmMs = await timeIt(() => api.students.list());
    const createMs = await timeIt(() =>
      // v31：校区必填 —— 容量探针也得带上校区，否则这里量到的是"被校验拒掉"的成本
      api.classrooms.create({ name: "容量探针", capacity: 1, kind: "上课用教室", campus: "容量自检", note: "", availability: [] }),
    );
    const rss = process.memoryUsage().rss / 1024 / 1024;

    const kb = (bytes: number) => (bytes / 1024 >= 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(0)}KB`);
    console.log(
      `${String(studentCount).padStart(4)} | ${String(studentCount * lessonsPerStudent).padStart(5)} | ` +
      `${kb(snapshotBytes).padStart(8)} | ${kb(Math.max(fileBytes, snapshotBytes)).padStart(7)} | ` +
      `${writeMs.toFixed(0).padStart(9)}ms | ${coldMs.toFixed(0).padStart(10)}ms | ${warmMs.toFixed(0).padStart(3)}ms | ` +
      `${createMs.toFixed(0).padStart(6)}ms | ${rss.toFixed(0).padStart(6)}MB`,
    );
  } finally {
    db.close();
    removeTempDb();
  }
}

console.log(
  "\n提示：`JSON快照` 同时决定备份占多少磁盘（保留份数 × 快照大小，默认保留 90 份）。\n" +
  "写入耗时随**整库行数**线性增长 —— 这是快照式存储的固有代价，见 docs/后端开发方案.md §5.3 路线 C。",
);
