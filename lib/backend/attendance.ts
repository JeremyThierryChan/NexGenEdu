import type { Lesson, LessonRecord } from "./types";

/**
 * 请假与课时的规则。
 *
 * ## 规则（业务确认）
 *
 * **提前 24 小时请假不扣课时，临时缺课扣课时。**
 *
 * ## 为什么按「这次时间是否被占用」来判断
 *
 * 一句话口径：**一节课扣一次，扣的是「这次时间被占用」。** 把这条讲清楚，
 * 各种组合就都自洽了：
 *
 * | 情况 | 是否占用时间 | 扣课时 |
 * | --- | --- | --- |
 * | 到课 | 是 | 扣 1 |
 * | 提前 ≥24 小时请假 | 否（机构来得及另排） | 不扣 |
 * | 临时缺课 / 旷课 / 未记录请假时间 | 是 | 扣 1 |
 * | 补课 | 是（重新占用教师与教室） | 扣 1 |
 *
 * 于是：**提前请假 + 补课 = 扣 1 节**（等于正常上了课）；
 * **临时缺课 + 补课 = 扣 2 节**（缺课占了一次时间，补课又占一次）——
 * 这正是 24 小时规则存在的意义，也方便向家长解释。
 *
 * ## 没记录请假时间时怎么算
 *
 * 按**临时缺课**处理（扣课时），因为「没记录」不能默认成对机构有利的解释。
 * 界面上会提示「建议补录请假时间」—— 老师补上时间后，服务层会自动把课时
 * 调整回来（对账逻辑见 api.ts 的 reconcileCharge）。
 */

/** 提前多久请假算「提前」。 */
export const LEAVE_NOTICE_HOURS = 24;

export type ChargeDecision = {
  /** 是否扣课时。 */
  charge: boolean;
  /** 判断理由（直接显示给管理员，避免「为什么扣了」说不清）。 */
  reason: string;
};

/** 学生的出勤情况（没有课堂记录时按「到课」处理）。 */
export function attendanceOf(record: LessonRecord | undefined): LessonRecord["attendance"] {
  return record?.attendance ?? "到课";
}

/**
 * 这节课这位学生该不该扣课时。
 *
 * @param lesson 课节（需要 startsAt 来判断请假是否提前 24 小时）
 * @param record 该学生这节课的课堂记录；undefined 表示老师还没填
 */
export function decideCharge(
  lesson: Lesson,
  record: LessonRecord | undefined,
): ChargeDecision {
  const attendance = attendanceOf(record);

  if (attendance === "到课") {
    return { charge: true, reason: "到课，正常扣 1 节" };
  }

  if (attendance === "旷课") {
    return { charge: true, reason: "旷课，按占用时间扣 1 节" };
  }

  // 请假：看请假时间距离上课还有多久
  const requestedAt = record?.leaveRequestedAt ?? "";
  if (requestedAt === "") {
    return {
      charge: true,
      reason: `请假但未记录请假时间，按临时缺课扣 1 节（补录时间后会自动调整）`,
    };
  }

  const noticeMs = new Date(lesson.startsAt).getTime() - new Date(requestedAt).getTime();
  const noticeHours = noticeMs / 3_600_000;

  if (noticeHours >= LEAVE_NOTICE_HOURS) {
    return {
      charge: false,
      reason: `提前 ${formatHours(noticeHours)} 请假（≥ ${LEAVE_NOTICE_HOURS} 小时），不扣课时`,
    };
  }

  return {
    charge: true,
    reason: `临时请假（仅提前 ${formatHours(Math.max(0, noticeHours))}），按占用时间扣 1 节`,
  };
}

/** 小时数的可读格式：`26 小时` / `90 分钟`。 */
export function formatHours(hours: number): string {
  if (hours >= 1) {
    const value = Math.round(hours * 10) / 10;
    return `${value} 小时`;
  }
  return `${Math.round(hours * 60)} 分钟`;
}

/**
 * 待补课判定：这节课这位学生是否「缺了课且还没补」。
 *
 * 只看到课与否，不看是否扣课时 —— 提前请假（没扣课时）同样需要补，
 * 因为学生事实上没上到这节课。
 */
export function isAbsent(record: LessonRecord | undefined): boolean {
  const attendance = attendanceOf(record);
  return attendance === "请假" || attendance === "旷课";
}

/** 补课课节的标题后缀（列表里一眼看出这是补课）。 */
export function makeupLabel(original: Lesson | undefined): string {
  if (original === undefined) return "补课";
  const date = new Date(original.startsAt);
  return `补课 · 原课 ${date.getMonth() + 1}月${date.getDate()}日`;
}
