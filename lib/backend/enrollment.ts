import type { Enrollment } from "./types";

/**
 * 报课与课时的计算规则。
 *
 * 为什么课时要**按科目**记，而不是给每个学生一个总数：
 * 学生报的是「初中数学 20 节」「初中物理 10 节」，退课也只退其中一科。
 * 一个总数在退课时算不清，也无法支撑「教师课表 / 教室占用」这些按科目聚合的视图。
 *
 * 这一层是纯函数：服务层与界面都用同一套口径，避免两处算法不一致。
 */

/** 仍在生效的报课（未退课）。 */
export function activeEnrollments(enrollments: Enrollment[]): Enrollment[] {
  return enrollments.filter((item) => item.status === "在读");
}

/** 某条报课的剩余课时；不会为负（退课/超扣都不会让数字变成负数）。 */
export function remainingOf(enrollment: Enrollment): number {
  return Math.max(0, enrollment.totalLessons - enrollment.usedLessons);
}

/** 一位学生的剩余课时合计（只看生效中的报课）。 */
export function remainingTotal(enrollments: Enrollment[]): number {
  return activeEnrollments(enrollments).reduce((sum, item) => sum + remainingOf(item), 0);
}

/** 按科目汇总剩余课时，例如 { 初中数学: 8, 初中物理: 3 }。 */
export function remainingBySubject(enrollments: Enrollment[]): Array<{ subject: string; remaining: number }> {
  const map = new Map<string, number>();
  for (const item of activeEnrollments(enrollments)) {
    const subject = item.subject.trim() === "" ? "未指定科目" : item.subject.trim();
    map.set(subject, (map.get(subject) ?? 0) + remainingOf(item));
  }
  return [...map].map(([subject, remaining]) => ({ subject, remaining }));
}

/**
 * 找一节课应该扣哪条报课。
 *
 * 规则：科目名一致且仍在生效。可能有多条（同一科目报了两次），
 * 取剩余课时最多的一条扣，避免先扣到快用完的那条而让「课时预警」乱跳。
 * 找不到就返回 null —— 服务层据此**不扣课时并如实上报**，而不是随便挑一条扣。
 */
export function enrollmentForLesson(
  enrollments: Enrollment[],
  subject: string,
): Enrollment | null {
  const candidates = activeEnrollments(enrollments).filter(
    (item) => item.subject.trim() === subject.trim(),
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((best, item) =>
    remainingOf(item) > remainingOf(best) ? item : best,
  );
}

/** 报课记录的一行历史，用于「续费 / 退课」留痕。 */
export function describeEnrollment(enrollment: Enrollment): string {
  const parts = [
    `${enrollment.totalLessons} 节`,
    `已上 ${enrollment.usedLessons} 节`,
    `剩 ${remainingOf(enrollment)} 节`,
  ];
  return parts.join(" · ");
}
