import type {
  Assessment,
  HomeworkRecord,
  Lesson,
  LessonRecord,
  Student,
} from "./types";
import { activeEnrollments, remainingOf, remainingTotal } from "./enrollment";
import { formatMoney, outstandingAmount } from "./finance";
import { formatDayLabel } from "./format";

/**
 * 待跟进清单：把「需要主动联系家长」的情况自动挑出来，并生成可直接发送的话术。
 *
 * 为什么值得单独做一块：这些信号其实都躺在数据里（课时、欠费、作业、测评、出勤），
 * 但要靠人一样样去翻 —— 翻的结果通常是「想起来才看」。清单的价值是**不用想**。
 *
 * 三条设计原则：
 *   1. **规则与阈值集中**（FOLLOWUP_RULES），要调松紧只改一处；
 *   2. **话术是草稿**：带具体数字、可解释，但由人看过再发 —— 不给家长发机器味的话；
 *   3. **不猜**：数据不足（没有测评、没有作业记录）时**不产生条目**，
 *      而不是拿「没有记录」当「表现不好」。
 */

export const FOLLOWUP_RULES = {
  /** 剩余课时 ≤ 这个数就提醒续课；≤ 紧急线则标为紧急。 */
  lowLessons: 5,
  lowLessonsUrgent: 2,
  /** 明明有在读课时、却在未来这么多天内一节课都没排 → 可能在流失。 */
  staleLessonDays: 7,
  /** 最近几次作业里，「未交」达到这个数 → 作业异常。 */
  missedHomework: 2,
  /** 最近几次作业里，「未交 + 迟交」达到这个数 → 作业异常。 */
  unfinishedHomework: 3,
  /** 作业检查窗口：只看最近这么多次记录。 */
  homeworkWindow: 5,
  /** 最近几次出勤记录里，「旷课」达到这个数 → 出勤异常（更严重）。 */
  absentLessons: 1,
  /** 「请假」达到这个数 → 出勤异常。 */
  leaveLessons: 2,
  /** 出勤检查窗口。 */
  attendanceWindow: 5,
  /** 分数下降达到这个分值 → 提醒；否则只是关注。 */
  scoreDrop: 10,
} as const;

export type FollowUpKind =
  | "课时不足"
  | "欠费"
  | "作业异常"
  | "测评下滑"
  | "出勤异常"
  | "久未排课";

export type FollowUpSeverity = "紧急" | "提醒" | "关注";

export type FollowUpItem = {
  studentId: string;
  studentName: string;
  kind: FollowUpKind;
  severity: FollowUpSeverity;
  /** 一句话原因，带具体数字（管理员扫一眼就知道要说什么）。 */
  reason: string;
  /** 建议动作。 */
  action: string;
  /** 给家长的沟通话术草稿（可直接复制，但发之前请自己看一遍）。 */
  message: string;
};

export type FollowUpInput = {
  students: Student[];
  lessons: Lesson[];
  assessments: Assessment[];
  homeworks: HomeworkRecord[];
  lessonRecords: LessonRecord[];
  now: Date;
};

/** 严重度排序用（数字越小越靠前）。 */
const SEVERITY_ORDER: Record<FollowUpSeverity, number> = {
  紧急: 0,
  提醒: 1,
  关注: 2,
};

/**
 * 扫描全部数据，产出待跟进清单。
 *
 * 每位学生每类问题最多一条（同类先合并再生成话术），否则一个学生
 * 会刷出七八行，清单就没法用了。
 */
export function buildFollowUps(input: FollowUpInput): FollowUpItem[] {
  const items: FollowUpItem[] = [];

  for (const student of input.students) {
    if (student.status === "结课") continue;

    items.push(
      ...checkLowLessons(student),
      ...checkOutstanding(student),
      ...checkHomework(student, input.homeworks),
      ...checkAssessments(student, input.assessments),
      ...checkAttendance(student, input.lessonRecords, input.lessons),
      ...checkStaleLessons(student, input.lessons, input.now),
    );
  }

  return items.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return bySeverity !== 0 ? bySeverity : a.studentName.localeCompare(b.studentName, "zh-CN");
  });
}

/** 课时不足：挑剩余最少的那门课来说，不要笼统说「课时不多了」。 */
function checkLowLessons(student: Student): FollowUpItem[] {
  const active = activeEnrollments(student.enrollments);
  if (active.length === 0) return [];

  const weakest = active.reduce((min, item) => (remainingOf(item) < remainingOf(min) ? item : min));
  const remaining = remainingOf(weakest);
  if (remaining > FOLLOWUP_RULES.lowLessons) return [];

  const total = remainingTotal(student.enrollments);
  const severity: FollowUpSeverity =
    remaining <= FOLLOWUP_RULES.lowLessonsUrgent ? "紧急" : "提醒";

  return [
    {
      studentId: student.id,
      studentName: student.name,
      kind: "课时不足",
      severity,
      reason: `${weakest.subject} 只剩 ${remaining} 节（全部在读科目合计 ${total} 节）`,
      action: "联系家长续课，并确认原来的上课时段是否保留",
      message:
        `${student.name}家长您好，${weakest.subject}现在还剩 ${remaining} 节课` +
        `（已上 ${weakest.usedLessons} 节）。为了不打断现在的节奏，` +
        `建议这两天把续课安排上，原来的时段我先留着；需要的话我把课时明细发给您。`,
    },
  ];
}

/** 欠费：金额与账期一起说清楚，避免家长以为是催收。 */
function checkOutstanding(student: Student): FollowUpItem[] {
  const owed = activeEnrollments(student.enrollments).map((enrollment) => ({
    enrollment,
    amount: outstandingAmount(enrollment),
  }));
  const total = owed.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0) return [];

  const detail = owed
    .filter((item) => item.amount > 0)
    .map((item) => `${item.enrollment.subject} ${formatMoney(item.amount)}`)
    .join("、");

  return [
    {
      studentId: student.id,
      studentName: student.name,
      kind: "欠费",
      severity: "紧急",
      reason: `未收款合计 ${formatMoney(total)}（${detail}）`,
      action: "提醒家长补款；可提供课时与金额明细",
      message:
        `${student.name}家长您好，这边对账时看到还有一笔费用没结：${detail}。` +
        `方便的时候补一下就行，微信转账也可以，收据我这边出。` +
        `如果已经付过、是我这边漏记了，麻烦您告诉我，我马上更正。`,
    },
  ];
}

/** 作业异常：看最近几次作业的提交情况，并带上错题知识点。 */
function checkHomework(student: Student, homeworks: HomeworkRecord[]): FollowUpItem[] {
  const recent = homeworks
    .filter((item) => item.studentId === student.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, FOLLOWUP_RULES.homeworkWindow);
  if (recent.length === 0) return [];

  const missed = recent.filter((item) => item.submission === "未交").length;
  const unfinished = recent.filter((item) => item.submission !== "按时").length;
  if (missed < FOLLOWUP_RULES.missedHomework && unfinished < FOLLOWUP_RULES.unfinishedHomework) {
    return [];
  }

  const weak = recent
    .map((item) => item.weakPoints.trim())
    .filter((value) => value !== "")
    .slice(0, 3);

  return [
    {
      studentId: student.id,
      studentName: student.name,
      kind: "作业异常",
      severity: "提醒",
      reason: `最近 ${recent.length} 次作业：未交 ${missed} 次、迟交或未交 ${unfinished} 次`,
      action: "与家长沟通作业完成情况，并在课上补讲错题知识点",
      message:
        `${student.name}家长您好，最近 ${recent.length} 次作业里有 ${unfinished} 次没按时交` +
        `（其中 ${missed} 次未交）` +
        (weak.length > 0 ? `，错题主要集中在${weak.join("、")}` : "") +
        `。这块我们这周课上会重新过一遍，也麻烦您提醒他先完成作业再来上课 —— ` +
        `作业跟不上时，课上时间会被用来补作业，效果会打折。`,
    },
  ];
}

/** 测评下滑：按科目看最近一次与上一次的差值。 */
function checkAssessments(student: Student, assessments: Assessment[]): FollowUpItem[] {
  const own = assessments.filter((item) => item.studentId === student.id);
  if (own.length === 0) return [];

  // 按科目分组，取最近一次
  const latestBySubject = new Map<string, Assessment>();
  for (const record of [...own].sort((a, b) => a.date.localeCompare(b.date))) {
    latestBySubject.set(record.subject, record);
  }

  const drops = [...latestBySubject.values()]
    .filter((record) => record.previousScore !== null && record.score < record.previousScore)
    .map((record) => ({
      subject: record.subject,
      score: record.score,
      previous: record.previousScore ?? 0,
      drop: (record.previousScore ?? 0) - record.score,
      weakPoints: record.weakPoints,
    }))
    .sort((a, b) => b.drop - a.drop);

  if (drops.length === 0) return [];

  const worst = drops[0]!;
  const severity: FollowUpSeverity = worst.drop >= FOLLOWUP_RULES.scoreDrop ? "提醒" : "关注";
  const detail = drops
    .map((item) => `${item.subject} ${item.previous} → ${item.score}`)
    .join("、");

  return [
    {
      studentId: student.id,
      studentName: student.name,
      kind: "测评下滑",
      severity,
      reason: `${detail}（${worst.subject}下降 ${worst.drop} 分）`,
      action: "报名下一次阶段测评，课上针对薄弱点做专项",
      message:
        `${student.name}家长您好，最近一次测评${detail}` +
        (worst.weakPoints !== "" ? `，主要丢分在${worst.weakPoints}` : "") +
        `。我们会在接下来的课里针对这一点做专项训练，` +
        `下次课前发一份小测给您看效果。如果您在家也发现类似情况，随时告诉我。`,
    },
  ];
}

/** 出勤异常：旷课比请假严重，因此分开计数。 */
function checkAttendance(
  student: Student,
  lessonRecords: LessonRecord[],
  lessons: Lesson[],
): FollowUpItem[] {
  const own = lessonRecords
    .filter((item) => item.studentId === student.id)
    .map((item) => ({ record: item, lesson: lessons.find((lesson) => lesson.id === item.lessonId) }))
    .sort((a, b) => (b.lesson?.startsAt ?? "").localeCompare(a.lesson?.startsAt ?? ""))
    .slice(0, FOLLOWUP_RULES.attendanceWindow);
  if (own.length === 0) return [];

  const absent = own.filter((item) => item.record.attendance === "旷课").length;
  const leave = own.filter((item) => item.record.attendance === "请假").length;
  if (absent < FOLLOWUP_RULES.absentLessons && leave < FOLLOWUP_RULES.leaveLessons) return [];

  const parts: string[] = [];
  if (absent > 0) parts.push(`旷课 ${absent} 次`);
  if (leave > 0) parts.push(`请假 ${leave} 次`);

  return [
    {
      studentId: student.id,
      studentName: student.name,
      kind: "出勤异常",
      severity: absent >= FOLLOWUP_RULES.absentLessons ? "提醒" : "关注",
      reason: `最近 ${own.length} 次课：${parts.join("、")}`,
      action: "确认时间是否冲突，必要时固定调到另一个时段并安排补课",
      message:
        `${student.name}家长您好，最近 ${own.length} 次课有${parts.join("、")}。` +
        `如果是时间冲突，我们可以固定换到另一个时段；缺掉的内容我这边安排补课，` +
        `不用额外占课时。您看哪个时间段方便？`,
    },
  ];
}

/** 久未排课：有课时却排不上课，往往是要流失的前兆。 */
function checkStaleLessons(student: Student, lessons: Lesson[], now: Date): FollowUpItem[] {
  const active = activeEnrollments(student.enrollments);
  if (active.length === 0) return [];
  if (remainingTotal(student.enrollments) <= 0) return [];

  const horizon = now.getTime() + FOLLOWUP_RULES.staleLessonDays * 86_400_000;
  const upcoming = lessons.filter(
    (lesson) =>
      lesson.studentIds.includes(student.id) &&
      lesson.status !== "已取消" &&
      new Date(lesson.startsAt).getTime() >= now.getTime() &&
      new Date(lesson.startsAt).getTime() <= horizon,
  );
  if (upcoming.length > 0) return [];

  const subjects = active.map((item) => item.subject).join("、");

  return [
    {
      studentId: student.id,
      studentName: student.name,
      kind: "久未排课",
      severity: "关注",
      reason: `未来 ${FOLLOWUP_RULES.staleLessonDays} 天没有排课，但还有 ${remainingTotal(student.enrollments)} 节课`,
      action: "主动问一句是不是时间冲突，顺便把课排上",
      message:
        `${student.name}家长您好，${subjects}这边还有 ${remainingTotal(student.enrollments)} 节课，` +
        `但接下来 ${FOLLOWUP_RULES.staleLessonDays} 天还没安排上课。` +
        `是时间上有冲突吗？告诉我方便的时段，我来排；也可以先按原来的时间固定下来。`,
    },
  ];
}

/** 清单里各类问题的条数（页面顶部概览用）。 */
export function summarizeFollowUps(items: FollowUpItem[]): Array<{
  kind: FollowUpKind;
  count: number;
  urgent: number;
}> {
  const kinds: FollowUpKind[] = ["课时不足", "欠费", "作业异常", "测评下滑", "出勤异常", "久未排课"];
  return kinds.map((kind) => ({
    kind,
    count: items.filter((item) => item.kind === kind).length,
    urgent: items.filter((item) => item.kind === kind && item.severity === "紧急").length,
  }));
}

/** 把清单拼成一段可复制的文本（一次联系多位家长时用）。 */
export function followUpsToText(items: FollowUpItem[], date = new Date()): string {
  if (items.length === 0) return "今日待跟进清单：无。";

  const lines = [`待跟进清单（${formatDayLabel(date)}）`, ""];
  for (const item of items) {
    lines.push(`【${item.severity}】${item.studentName} · ${item.kind}`);
    lines.push(`原因：${item.reason}`);
    lines.push(`建议：${item.action}`);
    lines.push(item.message);
    lines.push("");
  }
  return lines.join("\n");
}
