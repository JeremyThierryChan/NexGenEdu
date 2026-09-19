/**
 * 钱与课时的记账核心（**从 lib/backend/api.ts 原样搬来**）。
 *
 * 为什么单独成模块：「收一笔钱」「按出勤对账扣课时」「记账同时同步报课记录的实收」
 * 这几件事，前台伪后端与服务端必须**共用同一份实现**。谁在服务端另写一套，
 * 「收了多少钱」与「还剩多少课时」迟早两边对不上 —— 这类错误只在期末对账时才暴露。
 *
 * 搬运原则：**逐字搬，不改进**。唯一改动：`nextId` 用本模块内的等价实现
 * （id 是不透明字符串），其余逻辑一字未动。
 */

import { decideCharge } from "./attendance";
import { enrollmentForLesson } from "./enrollment";
import { round2 } from "./finance";
import type { Database, Lesson, LessonTransaction, Payment } from "./types";

/** id 生成：与 api.ts 里同一形状（前缀 + 时间戳 + 随机后缀）。 */
function nextId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
/**
 * 记一笔课时流水。
 *
 * 所有课时变动都必须经这里：直接改 usedLessons 而不留流水，
 * 以后就没法回答「这些课时去哪了」。自检里有一条不变式校验两者的关系。
 */
export function addTransaction(
  db: Database,
  input: Omit<LessonTransaction, "id" | "at" | "reversedAt">,
): LessonTransaction {
  const created: LessonTransaction = {
    ...input,
    id: nextId("tx"),
    at: nowIso(),
    reversedAt: "",
  };
  db.transactions.push(created);
  return created;
}
/**
 * 记一笔收款 / 退款，并同步报课记录上的实收累计。
 *
 * 金额只允许通过这里改动：把 paidAmount 手工改来改去，
 * 「收了多少钱」这件事就再也对不上账了（自检会校验两者一致）。
 */
export function recordPayment(db: Database, input: Omit<Payment, "id">): Payment {
  const created: Payment = { ...input, id: nextId("pay") };
  db.payments.push(created);

  const enrollment = db.students
    .flatMap((student) => student.enrollments)
    .find((item) => item.id === input.enrollmentId);
  if (enrollment !== undefined) {
    enrollment.paidAmount = round2(
      Math.max(0, enrollment.paidAmount + (input.kind === "退款" ? -input.amount : input.amount)),
    );
  }

  return created;
}
/**
 * 按出勤事实对账：让这位学生这节课的扣减与「该不该扣」一致。
 *
 * 为什么需要「对账」而不是「扣一次就完事」：出勤是**会变的** ——
 * 老师先标了「到课」扣了课时，后来发现是提前请假；或者先标了请假、后来补录了
 * 请假时间。任何一次改动都可能让「已扣」与「应扣」不一致，
 * 而对账是唯一能保证两者最终一致的写法（增扣、退回都由它统一处理）。
 *
 * 幂等：反复调用不会重复扣。
 */
export function reconcileCharge(
  db: Database,
  lesson: Lesson,
  studentId: string,
): { changed: boolean; charged: boolean; reason: string } {
  const record = db.lessonRecords.find(
    (item) => item.lessonId === lesson.id && item.studentId === studentId,
  );
  const decision = decideCharge(lesson, record);

  const active = db.transactions.filter(
    (item) =>
      item.lessonId === lesson.id &&
      item.studentId === studentId &&
      item.kind === "上课" &&
      item.reversedAt === "",
  );
  const actual = active.length;
  const expected = decision.charge ? 1 : 0;

  if (actual === expected) return { changed: false, charged: decision.charge, reason: decision.reason };

  const student = db.students.find((item) => item.id === studentId);
  if (student === undefined) return { changed: false, charged: decision.charge, reason: decision.reason };

  if (expected > actual) {
    // 该扣但没扣：补扣（按科目找报课记录；找不到就如实跳过）
    const enrollment = enrollmentForLesson(student.enrollments, lesson.subject);
    if (enrollment === null) {
      return { changed: false, charged: decision.charge, reason: `${decision.reason}（没有对应报课记录，未扣）` };
    }
    enrollment.usedLessons += 1;
    addTransaction(db, {
      studentId,
      enrollmentId: enrollment.id,
      subject: enrollment.subject,
      delta: -1,
      kind: "上课",
      lessonId: lesson.id,
      note: decision.reason,
    });
    return { changed: true, charged: true, reason: decision.reason };
  }

  // 不该扣但扣了：按流水退回（撤销而不是删除，便于追溯）
  let toReverse = actual - expected;
  for (const transaction of [...active].reverse()) {
    if (toReverse <= 0) break;
    transaction.reversedAt = nowIso();
    const enrollment = student.enrollments.find((item) => item.id === transaction.enrollmentId);
    if (enrollment !== undefined) {
      enrollment.usedLessons = Math.max(0, enrollment.usedLessons - 1);
    }
    toReverse -= 1;
  }
  return { changed: true, charged: false, reason: decision.reason };
}
