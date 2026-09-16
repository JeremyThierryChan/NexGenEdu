import type { ClassType, PurchaseTier, StageCourse, SubjectOption } from "@/lib/data/pricing";

/**
 * 报价公式 —— 需要修改计价规则时，只改这个文件。
 *
 * 页面（app/(site)/quote/page.tsx 与 components/pricing/EstimateForm.tsx）
 * 与数据文件（data/site/pricing.md）都不含公式，它们只负责取值与显示。
 *
 * 当前实现的规则：
 *
 *   课时价 = 基础价 × 科目系数 × 班级系数        （一对一 / 一对二 / 一对三 / 一对多）
 *   课时价 = 教师课时总费用 ÷ 班级人数            （班课）
 *   最终单价 = 课时价 × (1 + 手续费百分比)
 *   合计费用 = 最终单价 × 计费节数
 */

/** 报价输入：用户在下拉框中的选择。 */
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
  /** 所选报课档位。 */
  tier: PurchaseTier;
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
  /** 最终单价（元 / 课时，已含手续费）。 */
  unitPrice: number;
  /** 计费节数。 */
  lessons: number;
  /** 合计费用（元）。 */
  totalPrice: number;
  /** 是否赠送试课。 */
  includesTrial: boolean;
  breakdown: QuoteBreakdownItem[];
};

/** 保留两位小数，避免浮点误差（例如 0.1 * 3）。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 金额显示：整数不带小数，非整数保留两位。 */
function money(value: number): string {
  return Number.isInteger(value) ? `¥${value}` : `¥${value.toFixed(2)}`;
}

/**
 * 计算课时价（不含手续费）。
 *
 * 分两种模式：
 *   - coefficient：各类一对一 / 小班，按班级系数打折
 *   - cost-share：班课，按「教师课时总费用 ÷ 班级人数」分摊
 */
function unitPriceBeforeFee(input: QuoteInput): { price: number } | { error: string } {
  const { course, subject, classType } = input;

  if (course.price === null) {
    return { error: "所选课程暂未开放，无法报价。" };
  }

  // 无科目分组时科目系数按 1（不参与加价）
  const subjectCoefficient = subject?.coefficient ?? 1;
  const base = course.price * subjectCoefficient;

  if (classType.mode === "cost-share") {
    const students = input.studentCount ?? 0;
    const cost = input.classCost ?? 0;
    if (students < 1) return { error: "班课需要填写班级人数（至少 1 人）。" };
    if (cost <= 0) return { error: "班课需要填写教师课时总费用。" };
    return { price: cost / students };
  }

  const coefficient = classType.coefficient ?? 1;
  return { price: base * coefficient };
}

/** 生成价格构成明细。 */
function buildBreakdown(
  input: QuoteInput,
  unitPrice: number,
  finalUnitPrice: number,
  totalPrice: number,
): QuoteBreakdownItem[] {
  const { course, subject, classType, tier } = input;
  const items: QuoteBreakdownItem[] = [
    { label: `${course.name} 基础价`, value: money(course.price ?? 0) },
  ];

  // 科目系数与默认值相同时不必展示，避免噪音
  if (subject !== null && subject.coefficient !== 1) {
    items.push({ label: `${subject.name} 科目系数`, value: `×${subject.coefficient}` });
  }

  if (classType.mode === "cost-share") {
    items.push({ label: "教师课时总费用", value: money(input.classCost ?? 0) });
    items.push({ label: "班级人数", value: `${input.studentCount ?? 0} 人` });
    items.push({ label: "课时价（费用 ÷ 人数）", value: money(unitPrice) });
  } else {
    items.push({
      label: `${classType.name} 班级系数`,
      value: `×${classType.coefficient ?? 1}`,
    });
  }

  if (tier.feePercent !== 0) {
    items.push({ label: `手续费 ${tier.feePercent}%`, value: `+${tier.feePercent}%` });
  }

  items.push({ label: "最终单价", value: money(finalUnitPrice) });
  items.push({ label: `${tier.lessons} 节合计`, value: money(totalPrice) });

  return items;
}

/** 计算报价。 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const base = unitPriceBeforeFee(input);

  if ("error" in base) {
    return {
      ok: false,
      reason: base.error,
      unitPrice: 0,
      lessons: input.tier.lessons,
      totalPrice: 0,
      includesTrial: input.tier.includesTrial,
      breakdown: [],
    };
  }

  const unitPrice = round2(base.price);
  const finalUnitPrice = round2(unitPrice * (1 + input.tier.feePercent / 100));
  const totalPrice = round2(finalUnitPrice * input.tier.lessons);

  return {
    ok: true,
    unitPrice: finalUnitPrice,
    lessons: input.tier.lessons,
    totalPrice,
    includesTrial: input.tier.includesTrial,
    breakdown: buildBreakdown(input, unitPrice, finalUnitPrice, totalPrice),
  };
}
