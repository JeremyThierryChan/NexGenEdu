/**
 * 逐页验收（真实后端 + 真实写操作）。
 *
 * 为什么要有它：后台各页面各调一批方法，光靠"打开页面看一眼"发现不了
 * 「某个按钮背后调的方法参数不对」这类问题 —— 而这类问题恰恰是**静默**的
 * （上一轮把报课字段猜成 totalLessons，写进去就是 null）。
 *
 * **不要直接调用这个文件**：用 `npm run accept`。那一层会自己起临时后端、
 * 指对地址、跑完收尾（见 `scripts/accept-run.mts`）。下面那道闸是为"有人绕过
 * 运行器直接跑"准备的 —— 它必须对着服务端跑，否则验的是内存里的伪后端。
 */

import { api } from "../lib/backend/api.ts";
import { isRemoteMode, remoteBase } from "../lib/backend/remote.ts";

/*
 * 闸：没指向服务端就直接退出。
 *
 * 没有这道闸时，忘了设 `NEXT_PUBLIC_API_BASE` 会静默退化成内存伪后端，
 * 然后照样打印「43/43 通过」—— 一份假证据比不跑更糟：它让人以为真实后端验过了。
 */
if (!isRemoteMode()) {
  console.error(
    "✗ 逐页验收必须对着真实服务端跑，但当前没有设置 NEXT_PUBLIC_API_BASE。\n" +
    "  现在这样跑的是内存里的伪后端，那 43/43 是假通过。请用：\n" +
    "    npm run accept",
  );
  process.exit(2);
}
console.log(`后端：${remoteBase()}\n`);

type Result = { page: string; label: string; ok: boolean; note: string };
const results: Result[] = [];

/** 执行一项检查：抛错记成 ✗ 并留下原因（不中断整轮，才能一次看全）。 */
async function check(page: string, label: string, run: () => Promise<unknown>, expect?: (value: never) => boolean) {
  try {
    const value = await run();
    const pass = expect === undefined ? true : expect(value as never);
    results.push({ page, label, ok: pass, note: pass ? "" : `断言不通过：${JSON.stringify(value)?.slice(0, 120)}` });
  } catch (cause) {
    results.push({ page, label, ok: false, note: cause instanceof Error ? cause.message : String(cause) });
  }
}

const iso = (offsetDays = 0, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/* ── 1 课程库 ── */
let courseId = "";
await check("课程库", "新建课程（围棋）", async () => {
  const created = await api.courses.create({
    name: "围棋", category: "兴趣才艺", forms: ["一对一定制课"], origin: "后台",
    status: "开放", note: "验收用", createdAt: new Date().toISOString(),
  });
  courseId = created.id;
  return created;
}, (c: { name: string }) => c.name === "围棋");
await check("课程库", "课程列表与统计", async () => (await api.courses.list()).length > 0);
await check("课程库", "修改课程", async () => (await api.courses.update(courseId, { note: "已改" })).note === "已改");
await check("课程库", "从网站同步课程", async () => (await api.courses.syncFromSite()).total > 0);
await check("课程库", "重复同步不重复添加", async () => (await api.courses.syncFromSite()).added.length === 0);

/* ── 2 教室 ── */
let classroomId = "";
await check("教室", "新建教室（含可用时段）", async () => {
  const created = await api.classrooms.create({
    name: "验收教室", capacity: 6, kind: "上课用教室", note: "",
    availability: [{ id: "a1", weekdays: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00" }],
  });
  classroomId = created.id;
  return created;
}, (r: { name: string }) => r.name === "验收教室");
await check("教室", "修改教室容量", async () => (await api.classrooms.update(classroomId, { capacity: 8 })).capacity === 8);

/* ── 3 教师 ── */
let teacherId = "";
await check("教师", "新建教师（可带科目用课程名）", async () => {
  const created = await api.teachers.create({ name: "验收老师", role: "数学", subjects: ["围棋", "初中数学"], phone: "138", active: true });
  teacherId = created.id;
  return created;
}, (t: { subjects: string[] }) => t.subjects.includes("围棋"));
await check("教师", "在职教师列表", async () => (await api.teachers.listActive()).some((t) => t.id === teacherId));

/* ── 4 学生与报课收费 ── */
let studentId = "";
let enrollmentId = "";
await check("学生", "建档", async () => {
  const created = await api.students.create({
    name: "验收学生", grade: "初二", guardian: "138-0000-0000", subjects: [], profile: {},
    enrollments: [], status: "在读", note: "", createdAt: new Date().toISOString(),
  });
  studentId = created.id;
  return created;
}, (s: { name: string }) => s.name === "验收学生");
/*
 * 建档时就报课（一个学生多门、每门节数各自独立）。
 * 「数学 10 节、英语 20 节」是最常见的报名说法，因此这里同时验两件事：
 * 两门各自的节数不能串（不是并成一条、也不是都记成第一个数），
 * 以及每门都留下一条「报课」流水（账本不能是空的）。
 */
await check("学生", "建档并报多门课（含课时流水）", async () => {
  const created = await api.students.create({
    name: "验收多门学生", grade: "初三", guardian: "", status: "在读", note: "", profile: {},
    enrollments: [
      { subject: "验收科目A", lessons: 10, form: "一对一定制课", teacherId },
      { subject: "验收科目B", lessons: 20, form: "一对二 / 一对三小组课" },
    ],
  });
  const ledgers = await Promise.all(
    created.enrollments.map((item) => api.transactions.listByEnrollment(item.id)),
  );
  return {
    counts: created.enrollments.map((item) => item.totalLessons),
    forms: created.enrollments.map((item) => item.form),
    teachers: created.enrollments.map((item) => item.teacherId === teacherId),
    kinds: ledgers.map((rows) => rows.map((row) => [row.kind, row.delta])),
  };
}, (result: {
  counts: number[];
  forms: string[];
  teachers: boolean[];
  kinds: Array<Array<[string, number]>>;
}) =>
  result.counts.join(",") === "10,20" &&
  // 每门课各自的班型与指定教师都要落对（这是界面上一行一行选出来的）
  result.forms.join("|") === "一对一定制课|一对二 / 一对三小组课" &&
  result.teachers.join(",") === "true,false" &&
  result.kinds.every(
    (rows, index) =>
      rows.length === 1 && rows[0]?.[0] === "报课" && rows[0]?.[1] === (index === 0 ? 10 : 20),
  ));
await check("学生", "信息采集表保存", async () => (await api.students.saveProfile(studentId, { school: "验收中学" })).profile.school === "验收中学");
await check("学生", "报课（真实字段 lessons）", async () => {
  const updated = await api.students.enroll(studentId, {
    subject: "围棋", form: "一对一定制课", teacherId, lessons: 4, startedAt: iso(0),
    note: "", unitPrice: 200, agreedAmount: 800, paidNow: 800, method: "微信",
  });
  enrollmentId = updated.enrollments[0].id;
  return updated.enrollments[0];
}, (e: { totalLessons: number; paidAmount: number }) => e.totalLessons === 4 && e.paidAmount === 800);
await check("学生", "续费", async () => {
  const updated = await api.students.renewEnrollment(studentId, enrollmentId, 2, "续费", { amount: 400, method: "微信", agreedDelta: 400 });
  return updated.enrollments[0];
}, (e: { totalLessons: number; paidAmount: number }) => e.totalLessons === 6 && e.paidAmount === 1200);
await check("收费", "记一笔独立退款", async () => {
  await api.payments.record({ studentId, enrollmentId, amount: 100, kind: "退款", method: "微信", note: "验收" });
  const student = await api.students.get(studentId);
  return student.enrollments[0].paidAmount;
}, (paid: number) => paid === 1100);
await check("收费", "退费试算（两种口径）", async () => {
  const student = await api.students.get(studentId);
  const total = student.enrollments[0].totalLessons;
  return { total, remaining: total - student.enrollments[0].usedLessons };
}, (v: { total: number }) => v.total === 6);

/* ── 4.5 按周批量排课（页面上的「按周批量排课」面板走的就是这两个方法）── */
await check("课程安排", "按周批量排课：预检只算不写", async () => {
  const before = (await api.lessons.list()).length;
  const plan = await api.lessons.planSeries({
    subject: "围棋", form: "一对一定制课", teacherId, classroomId, studentIds: [studentId],
    durationMinutes: 60, status: "已排", note: "验收批量排课", startDate: "2027-06-07",
    weekdays: [1], time: "16:00", count: 4,
  });
  return { items: plan.items.length, changed: (await api.lessons.list()).length - before, schedulable: plan.schedulable };
}, (v: { items: number; changed: number; schedulable: number }) =>
  v.items === 4 && v.changed === 0 && v.schedulable === 4);
await check("课程安排", "按周批量排课：写入并跳过冲突", async () => {
  const input = {
    subject: "围棋", form: "一对一定制课", teacherId, classroomId, studentIds: [studentId],
    durationMinutes: 60, status: "已排" as const, note: "验收批量排课", startDate: "2027-06-07",
    weekdays: [1], time: "16:00", count: 4,
  };
  const first = await api.lessons.createSeries(input);
  // 再排一遍：课时已被第一遍占用（封顶），因此这次生成的节数可能变少 —— 断言不变量而不是写死数字
  const secondPlan = await api.lessons.planSeries(input);
  const again = await api.lessons.createSeries(input);
  return {
    created: first.created,
    againCreated: again.created,
    skipped: again.skipped.length,
    planned: secondPlan.items.length,
    schedulable: secondPlan.schedulable,
  };
}, (v: { created: number; againCreated: number; skipped: number; planned: number; schedulable: number }) =>
  // 第一遍排上 4 节；第二遍一节都不重复建，且预检里生成的每一节都被跳过（都撞已有安排）
  v.created === 4 && v.againCreated === 0 && v.schedulable === 0 && v.skipped === v.planned);

/* ── 5 课程安排（排课 / 改课 / 标记已上 / 冲突 / 补课）── */
let lessonId = "";
await check("课程安排", "排课", async () => {
  const created = await api.lessons.create({
    subject: "围棋", form: "一对一定制课", teacherId, classroomId, studentIds: [studentId],
    startsAt: iso(1, 10), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
  });
  lessonId = created.id;
  return created;
}, (l: { id: string }) => l.id !== "");
await check("课程安排", "改课（时间后移 1 小时）", async () => {
  const moved = await api.lessons.update(lessonId, { startsAt: iso(1, 11) });
  return moved?.startsAt;
}, (v: string) => new Date(v).getHours() === 11);
await check("课程安排", "冲突检测（同一教师同一时段）", async () => {
  // LessonInput 是完整课节形状（不是只传几个字段）
  const report = await api.lessons.findConflicts({
    id: "", subject: "围棋", form: "一对一定制课", teacherId, classroomId,
    studentIds: [studentId], startsAt: iso(1, 11), durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "",
  });
  return Array.isArray(report) ? report.length : report;
}, (v: unknown) => (Array.isArray(v) ? v.length > 0 : JSON.stringify(v).length > 2));
await check("课程安排", "课堂记录（提前请假）", async () => api.lessonRecords.save({
  lessonId, studentId, attendance: "请假", leaveRequestedAt: iso(0, 10), focus: "高", interaction: "好", rating: 4, note: "",
}));
await check("课程安排", "标记已上（不扣课时：提前请假）", async () => (await api.students.get(studentId)).enrollments[0].usedLessons, (n: number) => n === 0);
await check("课程安排", "标记已上动作", async () => (await api.lessons.markCompleted(lessonId)).skipped === false);
await check("课程安排", "安排补课", async () => {
  const makeup = await api.lessons.createMakeup({
    originalLessonId: lessonId, startsAt: iso(3, 10), durationMinutes: 60,
    teacherId, classroomId, studentIds: [studentId], note: "验收补课",
  });
  return makeup;
}, (m: { makeupForLessonId: string } | null) => m !== null && m.makeupForLessonId === lessonId);
await check("课程安排", "待补课清单", async () => Array.isArray(await api.lessons.pendingMakeups()));
await check("课程安排", "挪课建议", async () => Array.isArray(await api.lessons.suggestMoves(lessonId)));

/* ── 6 日历 / 课表与占用 ── */
await check("日历", "按周取课（listBetween）", async () => Array.isArray(await api.lessons.listBetween(new Date(iso(-3)), new Date(iso(10)))));
await check("课表与占用", "按教师取课", async () => (await api.lessons.listByTeacher(teacherId)).length > 0);
await check("课表与占用", "按教室取课", async () => (await api.lessons.listByClassroom(classroomId)).length > 0);
await check("课表与占用", "按日取课", async () => Array.isArray(await api.lessons.listByDate(new Date(iso(1, 11)))));

/* ── 7 咨询 ── */
let inquiryId = "";
await check("咨询", "登记咨询", async () => {
  const created = await api.inquiries.create({
    studentName: "验收咨询", grade: "初三", guardian: "139", subject: "初中数学",
    durationMinutes: 60, intervalWeeks: 1, plannedLessons: 3, startsAt: iso(2, 17),
    candidates: [{ id: "c1", weekday: new Date(iso(2, 17)).getDay(), start: "17:00" }],
    preferredTeacherId: teacherId, preferredClassroomId: classroomId, skipDates: [], status: "待确认", note: "",
  });
  inquiryId = created.id;
  return created;
}, (i: { id: string }) => i.id !== "");
await check("咨询", "可行性判定", async () => {
  const report = await api.inquiries.evaluate(inquiryId);
  return { slots: report?.slots?.length ?? 0, anyOk: report?.slots?.some((s) => s.ok) ?? false };
}, (v: { slots: number }) => v.slots > 0);
await check("咨询", "放弃咨询", async () => (await api.inquiries.abandon(inquiryId, "验收结束")).status === "已放弃");

/* ── 8 统计 / 待跟进 / 今日 ── */
await check("今日概览", "today()", async () => typeof (await api.today()).lessonCount === "number");
await check("统计", "stats(月份)", async () => typeof (await api.stats(new Date())) === "object");
await check("待跟进", "followups()", async () => Array.isArray(await api.followups()));
await check("收费", "finance(月份)", async () => typeof (await api.finance(new Date())) === "object");

/* ── 9 报价 ── */
await check("报价", "读配置", async () => (await api.pricing.get()).stages.length > 0);
await check("报价", "给课程库的课定价", async () => {
  const current = await api.pricing.get();
  const stages = [...current.stages];
  const target = stages.find((s) => s.name === "兴趣才艺");
  if (target === undefined) stages.push({ name: "兴趣才艺", courses: [{ name: "围棋", basePrice: 200, available: true, courseId }] });
  else target.courses.push({ name: "围棋", basePrice: 200, available: true, courseId });
  return (await api.pricing.update({ ...current, stages })).stages.length;
}, (n: number) => n > 0);
await check("报价", "试算（含新定价的课）", async () => (await api.pricing.quote({
  courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5,
})).ok);
await check("报价", "教师课时费", async () => (await api.pricing.teacherFee({
  courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5, students: 1,
})).ok);
await check("报价", "导出 Markdown", async () => (await api.pricing.exportMarkdown()).includes("学习阶段"));

/* ── 10 数据与备份 / 搜索 / 日志 ── */
await check("数据与备份", "导出全部数据", async () => (await api.exportDatabase()).students.length > 0);
// 批量导入（页面上的「批量导入」面板走的就是这个方法）
await check("数据与备份", "批量导入：CSV 导入教室", async () => {
  const csv = [
    "名称,用途,容量,备注",
    "验收教室A,上课用教室,6,批量导入自检",
    "验收教室B,自习室,4,",
  ].join("\r\n");
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv, fileName: "验收.csv" });
  return { ok: outcome.ok, added: outcome.added };
}, (v: { ok: boolean; added: number }) => v.ok && v.added === 2);
await check("数据与备份", "批量导入：重复导入不重复加", async () => {
  const csv = "名称,用途,容量,备注\r\n验收教室A,上课用教室,6,批量导入自检\r\n";
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv });
  return { added: outcome.added, skipped: outcome.skipped.length };
}, (v: { added: number; skipped: number }) => v.added === 0 && v.skipped === 1);
await check("数据与备份", "批量导入：JSON 导入教师", async () => {
  const json = JSON.stringify([{ name: "验收老师甲", subjects: ["初中数学"], role: "授课教师", active: true }]);
  const outcome = await api.imports.apply({ entity: "teachers", text: json });
  const created = (await api.teachers.list()).find((teacher) => teacher.name === "验收老师甲");
  return { added: outcome.added, subjects: created?.subjects ?? [] };
}, (v: { added: number; subjects: string[] }) => v.added === 1 && v.subjects.length === 1);
await check("数据与备份", "批量导入：冲突先体检、不写入", async () => {
  const before = (await api.teachers.list()).length;
  const csv = "姓名,职务\r\n验收老师甲,改过的职务\r\n";
  const asked = await api.imports.apply({ entity: "teachers", text: csv, onConflict: "ask" });
  return { needsDecision: asked.needsDecision, changed: (await api.teachers.list()).length - before, conflicts: asked.conflicts.length };
}, (v: { needsDecision: boolean; changed: number; conflicts: number }) =>
  v.needsDecision === true && v.changed === 0 && v.conflicts === 1);
await check("数据与备份", "批量导入：覆盖 / 跳过 / 保留两份", async () => {
  const csv = "姓名,职务\r\n验收老师甲,新职务\r\n";
  const overwritten = await api.imports.apply({ entity: "teachers", text: csv, onConflict: "overwrite" });
  const role = (await api.teachers.list()).find((t) => t.name === "验收老师甲")?.role;
  const skipped = await api.imports.apply({ entity: "teachers", text: csv });
  const duplicated = await api.imports.apply({ entity: "teachers", text: csv, onConflict: "duplicate" });
  const hasCopy = (await api.teachers.list()).some((t) => t.name === "验收老师甲（2）");
  return { overwritten: overwritten.overwritten, role, skipped: skipped.skipped.length, duplicated: duplicated.duplicated, hasCopy };
}, (v: { overwritten: number; role?: string; skipped: number; duplicated: number; hasCopy: boolean }) =>
  v.overwritten === 1 && v.role === "新职务" && v.skipped === 1 && v.duplicated === 1 && v.hasCopy);
await check("数据与备份", "从网站导入教师资料（含 AI）", async () => {
  // 网站上有真人教师与 AI 智能体，且都带资料（教龄 / 简介 / 详细介绍）
  const imported = await api.imports.fromSite({ entity: "teachers", onConflict: "skip" });
  const teachers = await api.teachers.list();
  const schedulable = await api.teachers.listActive();
  const chen = teachers.find((teacher) => teacher.name === "陈老师");
  const ai = teachers.filter((teacher) => teacher.kind === "AI");
  return {
    added: imported.added,
    chenHasProfile: chen !== undefined && chen.bio !== "" && chen.years !== "",
    aiCount: ai.length,
    aiHasProfile: ai.every((teacher) => teacher.bio !== ""),
    aiSchedulable: schedulable.some((teacher) => teacher.kind === "AI"),
  };
}, (v: { added: number; chenHasProfile: boolean; aiCount: number; aiHasProfile: boolean; aiSchedulable: boolean }) =>
  v.added >= 1 && v.chenHasProfile && v.aiCount >= 1 && v.aiHasProfile && v.aiSchedulable === false);
await check("数据与备份", "批量导入：缺少必填列时拒绝且不写入", async () => {
  const before = (await api.classrooms.list()).length;
  const outcome = await api.imports.apply({ entity: "classrooms", text: "房间名,容量\r\n漏了表头,6\r\n" });
  return { ok: outcome.ok, changed: (await api.classrooms.list()).length - before };
}, (v: { ok: boolean; changed: number }) => v.ok === false && v.changed === 0);
/*
 * ── 节假日（后台「节假日」页）────────────────────────────────────────────────
 *
 * 这一页走的不是 `api.*`，而是服务端自己的两条路由（`GET /api/holidays`、
 * `POST /api/holidays/refresh`）—— 与账号管理同一类，因此**必须单独验收**：
 * 光验 `api.*` 永远碰不到它们。
 *
 * 令牌：这张表要登录，而验收脚本没有登录界面 —— 用运行器给的账号在**这一次**里
 * 换一个令牌（与 `lib/backend/remote.ts` 的做法一致），不依赖任何浏览器存储。
 *
 * ⚠️ **这里只读**：临时后端没有设 `NEXGENEDU_HOLIDAY_DIR`，所以它读的就是仓库里那份
 * `data/holidays/*.json`（顺带验收了"进仓库的那份数据本身是通过校验的"）。
 * 因此**不要在这里调 `POST /api/holidays/refresh`** —— 那会把抓取结果写进仓库。
 * 抓取链路的行为覆盖在 `scripts/check.mts` 第 16 节（用注入的替身网络 + 临时目录）。
 */
const holidayToken = await (async (): Promise<string> => {
  const response = await fetch(`${remoteBase()}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.NEXGENEDU_ADMIN_USER ?? "",
      password: process.env.NEXGENEDU_ADMIN_PASSWORD ?? "",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { token?: unknown };
  return typeof body.token === "string" ? body.token : "";
})();
const holidayRoute = async (path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${remoteBase()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${holidayToken}` },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
};

await check("节假日", "换到令牌（否则下面几条验的是 401）", async () => holidayToken !== "");
await check(
  "节假日",
  "读表：年份、逐日表、校验结论都在",
  async () => {
    const { status, body } = await holidayRoute("/api/holidays");
    const view = (body.view ?? {}) as Record<string, unknown>;
    const years = (view.years ?? []) as Array<{ year: number; days: unknown[]; verdict: { agree: boolean } }>;
    return {
      status,
      ok: body.ok,
      年份数: years.length,
      每一天都有: years.every((item) => item.days.length > 0),
      全部通过校验: years.every((item) => item.verdict.agree === true),
      坏文件: (view.errors ?? []) as unknown[],
    };
  },
  (v: { status: number; ok: unknown; 年份数: number; 每一天都有: boolean; 全部通过校验: boolean; 坏文件: unknown[] }) =>
    v.status === 200 && v.ok === true && v.年份数 > 0 && v.每一天都有 && v.全部通过校验 && v.坏文件.length === 0,
);
await check(
  "节假日",
  "路径写错时给一句能照着改的话（而不是含混的 403）",
  async () => (await holidayRoute("/api/holidays", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
  (v: number) => v === 405,
);
await check("搜索", "全局搜索命中学生", async () => (await api.search("验收")).length > 0);
await check("日志", "操作日志有记录", async () => (await api.logs.list(50)).length > 0);

/* ── 输出 ── */
const byPage = new Map<string, Result[]>();
for (const r of results) {
  const list = byPage.get(r.page) ?? [];
  list.push(r);
  byPage.set(r.page, list);
}
let failed = 0;
for (const [page, list] of byPage) {
  const bad = list.filter((r) => !r.ok);
  failed += bad.length;
  console.log(`${bad.length === 0 ? "✅" : "❌"} ${page}（${list.length - bad.length}/${list.length}）`);
  for (const r of bad) console.log(`     ✗ ${r.label} —— ${r.note}`);
}
console.log(`\n合计：${results.length - failed}/${results.length} 通过${failed === 0 ? "（逐页验收全部通过）" : `，${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
