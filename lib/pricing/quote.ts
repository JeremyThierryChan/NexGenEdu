import type { ClassType, LessonDuration, StageCourse, SubjectOption } from "@/lib/data/pricing";

/**
 * 报价公式 —— 需要修改计价规则时，只改这个文件。
 *
 * 页面（app/(site)/quote/page.tsx 与 components/pricing/EstimateForm.tsx）
 * 与数据文件（data/site/pricing.md）都不含公式，它们只负责取值与显示。
 *
 * 计算顺序：
 *
 *   1. 课时价 = 基础价 × 科目系数 × 班级系数        （一对一 / 一对二 / 一对三 / 一对多）
 *      课时价 = 教师课时总费用 ÷ 班级人数            （班课）
 *   2. 若课时长于 1 小时，再乘时长乘数
 *   3. 手续费：1 节 +10%，其余不加收
 *      最终单价 = 课时价 × (1 + 手续费百分比)
 *   4. 正课总价 = 最终单价 × 节数
 *   5. 试课：试课结束后报课满 10 节则试课免费；否则按课程原价收 1 节试课费
 *      总价 = 正课总价 + 试课费
 */

/** 报 1 节时加收的手续费百分比。 */
const SINGLE_LESSON_FEE_PERCENT = 10;

/** 试课后报课达到该节数，试课免费。 */
const FREE_TRIAL_MIN_LESSONS = 10;

/** 报价输入：用户在选择区填写的内容。 */
export type QuoteInput = {
  /** 所选课程（含基础价）。 */
  course: StageCourse;
  /**
   * 所选科目（含科目系数）。
   * 部分阶段（出国考试 / 专业英语 / 成人兴趣）没有科目概念，此时传 null，科目系数按 1 计。
   */
  subject: SubjectOption | null;
  /** 所选班级类型。 */
  classType: ClassType;
  /** 所选每节课时长。 */
  duration: LessonDuration;
  /** 报课节数（用户手动输入）。 */
  lessons: number;
  /** 班课模式下由用户填写的班级人数。 */
  studentCount?: number;
  /** 班课模式下由用户填写的教师课时总费用。 */
  classCost?: number;
};

/** 计算过程中的一项明细，用于在页面上解释价格构成。 */
export type QuoteBreakdownItem = {
  label: string;
  value: string;
};

export type QuoteResult = {
  /** 是否计算成功；false 时 reason 说明原因。 */
  ok: boolean;
  reason?: string;
  /** 最终单价（元 / 节，已含时长与手续费）。 */
  unitPrice: number;
  /** 报课节数。 */
  lessons: number;
  /** 每节课时长（小时）。 */
  hours: number;
  /** 正课总价（元，不含试课费）。 */
  lessonsPrice: number;
  /** 试课费用（元）：满足条件为 0。 */
  trialFee: number;
  /** 试课是否免费。 */
  trialFree: boolean;
  /** 总价（元）= 正课总价 + 试课费。 */
  totalPrice: number;
  breakdown: QuoteBreakdownItem[];
};

/** 保留两位小数，避免浮点误差。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 金额显示：整数不带小数，非整数保留两位。 */
function money(value: number): string {
  return Number.isInteger(value) ? `¥${value}` : `¥${value.toFixed(2)}`;
}

/** 按节数判断手续费百分比：1 节加收，其余不加收。 */
export function feePercentFor(lessons: number): number {
  return lessons === 1 ? SINGLE_LESSON_FEE_PERCENT : 0;
}

/**
 * 试课是否免费。
 *
 * 规则：试课结束后报课达到 10 节及以上，则试课免费；
 * 否则按课程原价收取 1 节试课费用。
 */
export function isTrialFree(lessons: number): boolean {
  return lessons >= FREE_TRIAL_MIN_LESSONS;
}

/** 试课费用：免费时 0，否则按课程原价（不含班级系数、时长与手续费）计。 */
export function trialFeeFor(lessons: number, coursePrice: number | null): number {
  if (isTrialFree(lessons)) return 0;
  return coursePrice ?? 0;
}

/**
 * 计算课时价（不含时长乘数与手续费）。
 *
 * 分两种模式：
 *   - coefficient：一对一 / 小班，按班级系数计价
 *   - cost-share：班课，按「教师课时总费用 ÷ 班级人数」分摊
 */
function baseUnitPrice(input: QuoteInput): { price: number } | { error: string } {
  const { course, subject, classType } = input;

  if (course.price === null) {
    return { error: "所选课程暂未开放，无法报价。" };
  }

  if (classType.mode === "cost-share") {
    const students = input.studentCount ?? 0;
    const cost = input.classCost ?? 0;
    if (students < 1) return { error: "班课需要填写班级人数（至少 1 人）。" };
    if (cost <= 0) return { error: "班课需要填写教师课时总费用。" };
    return { price: cost / students };
  }

  // 无科目分组时科目系数按 1（不参与加价）
  const subjectCoefficient = subject?.coefficient ?? 1;
  return { price: course.price * subjectCoefficient * (classType.coefficient ?? 1) };
}

/**
 * 生成价格构成明细。
 *
 * 有意不展示时长乘数的换算过程：家长关心的是最终课单价与总价，
 * 中间换算是内部逻辑，摆出来反而增加理解成本。
 */
function buildBreakdown(
  input: QuoteInput,
  basePrice: number,
  finalUnitPrice: number,
  lessonsPrice: number,
): QuoteBreakdownItem[] {
  const { course, subject, classType, lessons } = input;
  const items: QuoteBreakdownItem[] = [
    { label: `${course.name} 基础价`, value: money(course.price ?? 0) },
  ];

  if (subject !== null && subject.coefficient !== 1) {
    items.push({ label: `${subject.name} 科目系数`, value: `×${subject.coefficient}` });
  }

  if (classType.mode === "cost-share") {
    items.push({ label: "教师课时总费用", value: money(input.classCost ?? 0) });
    items.push({ label: "班级人数", value: `${input.studentCount ?? 0} 人` });
    items.push({ label: "课时价（费用 ÷ 人数）", value: money(basePrice) });
  } else {
    items.push({
      label: `${classType.name} 班级系数`,
      value: `×${classType.coefficient ?? 1}`,
    });
  }

  const fee = feePercentFor(lessons);
  if (fee !== 0) {
    items.push({ label: `手续费 ${fee}%`, value: `+${fee}%` });
  }

  items.push({ label: "最终单价", value: money(finalUnitPrice) });
  items.push({ label: `${lessons} 节正课`, value: money(lessonsPrice) });

  return items;
}

/** 计算报价。 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const lessons = Math.floor(input.lessons);
  const hours = input.duration.hours;
  const trialFree = isTrialFree(lessons);

  const empty = (reason: string): QuoteResult => ({
    ok: false,
    reason,
    unitPrice: 0,
    lessons: lessons > 0 ? lessons : 0,
    hours,
    lessonsPrice: 0,
    trialFee: 0,
    trialFree,
    totalPrice: 0,
    breakdown: [],
  });

  if (!Number.isFinite(lessons) || lessons < 1) {
    return empty("请填写报课节数（至少 1 节）。");
  }

  const base = baseUnitPrice(input);
  if ("error" in base) return empty(base.error);

  const afterDuration = round2(base.price * input.duration.multiplier);
  const finalUnitPrice = round2(afterDuration * (1 + feePercentFor(lessons) / 100));
  const lessonsPrice = round2(finalUnitPrice * lessons);

  // 试课：满 10 节免费，否则按课程原价收 1 节
  const trialFee = round2(trialFeeFor(lessons, input.course.price));
  const totalPrice = round2(lessonsPrice + trialFee);

  const breakdown = buildBreakdown(input, base.price, finalUnitPrice, lessonsPrice);
  breakdown.push({
    label: trialFree ? "试课（报课满 10 节，免费）" : "试课 1 节（按课程原价）",
    value: trialFree ? money(0) : money(trialFee),
  });
  breakdown.push({ label: "总价", value: money(totalPrice) });

  return {
    ok: true,
    unitPrice: finalUnitPrice,
    lessons,
    hours,
    lessonsPrice,
    trialFee,
    trialFree,
    totalPrice,
    breakdown,
  };
}
