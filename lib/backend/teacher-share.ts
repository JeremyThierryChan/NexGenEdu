/**
 * 教师课时费（分成）规则。
 *
 * ## 规则原文与它的「人话版」
 *
 * 原始口径（机构给的公式）：
 *
 * ```
 * 教师课时费 = 小时数 × (课程单价 / 小时) × (0.4 + (学生人数 − 1) × 0.1)
 * ```
 *
 * 拆成人话，一共三句话：
 *
 *   1. **按人算比例**：第一名学生教师拿课程单价的 40%，此后每多一名学生加 10%
 *      （2 人 50%、3 人 60% … 8 人 110%）；
 *   2. **按小时算时长**：上 1.5 小时就乘 1.5，2 小时就乘 2；
 *   3. **适用范围**：课内课程里按系数计价的班型（一对一定制课 / 一对二 /
 *      一对三小组课 / 一对多小班课）。「9 人以上大班课不适用」 ——
 *      那类按「教师课时总费用 ÷ 班级人数」另议（见报价配置里的「按人数分摊」班型）。
 *
 * ## 「课程单价」按哪一档算（唯一需要机构自己定的一件事）
 *
 * 公式里的「课程单价」有两种合理口径，差得不小，因此做成可选（`priceBasis`）：
 *
 *   - `course`（标准单价，默认）：基础价 × 科目系数。班级系数是给家长的折扣，
 *     不跟着老师的分成走 —— 老师带同样的课，不该因为学生多报了折扣而降薪。
 *   - `seat`（班型课时价）：基础价 × 科目系数 × 班级系数，即家长每人实付的课时价。
 *
 * 两种口径后台都能一键切换并当场看到差多少，切换不会影响家长看到的报价。
 *
 * ## 为什么要有这个文件
 *
 * 这条规则原先只存在于口头/表格里，算课时费要拿计算器按一遍，还容易按错人数。
 * 公式一旦落到代码里就只有一份口径（`teacherFeeFor`），后台把它翻译成人话与
 * 一张人数对照表展示出来 —— 老师问「这个班多少钱」时直接看表，不用再推公式。
 */

import {
  DEFAULT_TEACHER_SHARE_RULES,
  type ClassPricingMode,
  type TeacherSharePriceBasis,
  type TeacherShareRules,
} from "@/lib/data/pricing";

export type { TeacherSharePriceBasis, TeacherShareRules };
export { DEFAULT_TEACHER_SHARE_RULES };

/** 课内小班课的人数上限：9 人及以上属于大班课，不走这条规则。 */
export const TEACHER_SHARE_MAX_STUDENTS = 8;

/** 课内课程的人数起点。 */
export const TEACHER_SHARE_MIN_STUDENTS = 1;

/** 保留两位小数。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 这条规则是否适用于某个班型。
 *
 * 判据是**计价方式**而不是班型名字：按系数计价的（一对一 … 一对多小班课）适用，
 * 按人数分摊的（9 人以上大班课）不适用。这样将来新增班型不用改这个函数。
 */
export function teacherShareAppliesTo(classType: { mode: ClassPricingMode }): boolean {
  return classType.mode === "coefficient";
}

/** 某个学生人数下的分成比例（百分比）。 */
export function sharePercentFor(students: number, rules: TeacherShareRules): number {
  const count = Math.max(TEACHER_SHARE_MIN_STUDENTS, Math.floor(students));
  return round2(rules.basePercent + (count - 1) * rules.stepPercent);
}


/**
 * 教师课时费。
 *
 * @param hours 上课小时数（1.5 小时就传 1.5）
 * @param hourlyPrice 课程单价 / 小时（口径见 `priceBasis`，由调用方算好传入）
 * @param students 学生人数
 */
export function teacherFeeFor(
  input: { hours: number; hourlyPrice: number; students: number },
  rules: TeacherShareRules,
): number {
  const hours = Number.isFinite(input.hours) ? input.hours : 0;
  const price = Number.isFinite(input.hourlyPrice) ? input.hourlyPrice : 0;
  return round2(hours * price * (sharePercentFor(input.students, rules) / 100));
}



/** 原始公式的形态（数字替换进去，便于与机构给的公式逐字对照）。 */
export function teacherShareFormula(rules: TeacherShareRules): string {
  const base = round2(rules.basePercent / 100);
  const step = round2(rules.stepPercent / 100);
  return `教师课时费 = 小时数 × (课程单价 / 小时) × (${base} + (学生人数 − 1) × ${step})`;
}

/** 「课程单价」口径的人话说明。 */
export function priceBasisText(basis: TeacherSharePriceBasis): string {
  return basis === "seat"
    ? "课程单价 = 基础价 × 科目系数 × 班级系数（家长每生实付的课时价）"
    : "课程单价 = 基础价 × 科目系数（课程标准单价，不含班级人数折扣）";
}

/**
 * 把规则翻译成人话（后台展示用）。
 *
 * 刻意用「哪些班型、按什么算、怎么加、不适用什么」的顺序写：
 * 老师问的是「我这个班怎么算」，不是想看公式。
 */
export function describeTeacherShare(rules: TeacherShareRules): string[] {
  const base = rules.basePercent;
  const step = rules.stepPercent;
  const second = round2(base + step);
  const max = sharePercentFor(TEACHER_SHARE_MAX_STUDENTS, rules);
  return [
    `适用于课内课程里「按系数计价」的班型：一对一定制课、一对二、一对三小组课、一对多小班课（1–${TEACHER_SHARE_MAX_STUDENTS} 人）。`,
    `9 人以上大班课不适用这条规则 —— 那类按「教师课时总费用 ÷ 班级人数」另议。`,
    `分成比例按人数算：第一名学生 ${base}%，每多一名学生加 ${step} 个百分点（2 人 ${second}%、3 人 ${round2(base + step * 2)}% … ${TEACHER_SHARE_MAX_STUDENTS} 人 ${max}%）。`,
    `时长按实际小时数算：1 小时乘 1，1.5 小时乘 1.5，2 小时乘 2。`,
    `${priceBasisText(rules.priceBasis)}。`,
    `金额四舍五入到分；比例不设上限，人数越多教师课时费越高。`,
  ];
}

