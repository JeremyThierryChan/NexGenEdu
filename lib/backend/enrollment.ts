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
/**
 * 一个学生的**课时余额**：合计 + 最少的那一门。
 *
 * ## 为什么要有它（审计抓到的"同一个问题四个答案"）
 *
 * "剩余课时不足"原先在四个地方各算一遍，而且**算法不一样**：
 *   - 今日概览：各科**合计**，含"一节课都没报"的学生，排除「结课」；
 *   - 待跟进：**剩余最少的那一门**，跳过「结课」与"没有在读报课"的学生；
 *   - 学生列表、学生详情：合计，阈值又各自写死一个 `5`。
 * 结果是同一个学生在两个页面上一个被预警、一个不被预警，而页面上那句
 * "阈值集中在 FOLLOWUP_RULES，改那一处即可"是假的（另外三处写死了 5）。
 *
 * 现在只有这一处算余额：**合计用于"总共还剩多少"，最少的那一门用于"还能排几节课"**
 * （排课受单科限制 —— 数学只剩 3 节，就排不了第 4 节数学课），两个数都带出来，
 * 由调用方决定说哪个，而不是各自再算一遍。
 */
export type LessonBalance = {
  /** 在读报课的合计剩余。 */
  total: number;
  /** 剩余最少的那一门（没有在读报课时为 `null`）。 */
  weakest: Enrollment | null;
  /** 那一门的剩余（没有在读报课时为 0）。 */
  weakestRemaining: number;
};

export function lessonBalance(enrollments: Enrollment[]): LessonBalance {
  const active = activeEnrollments(enrollments);
  let weakest: Enrollment | null = null;
  for (const enrollment of active) {
    if (weakest === null || remainingOf(enrollment) < remainingOf(weakest)) weakest = enrollment;
  }
  return {
    total: remainingTotal(enrollments),
    weakest,
    weakestRemaining: weakest === null ? 0 : remainingOf(weakest),
  };
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

