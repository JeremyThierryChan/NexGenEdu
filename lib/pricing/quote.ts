import type { PricingOption } from "@/lib/data/pricing";

/**
 * 报价公式 —— 需要修改报价规则时，只改这个文件。
 *
 * 页面（app/(site)/quote/page.tsx）与数据文件（data/site/pricing.md）都不含公式，
 * 它们只负责取值和显示，因此换公式不会影响它们。
 *
 * ⚠️ 当前公式是**临时占位实现**，仅用于把页面跑通，不代表真实定价规则。
 *    真实公式待确认后替换 calculateQuote 的实现即可，函数签名保持不变。
 */

/** 报价输入：三项下拉选择的结果。 */
export type QuoteInput = {
  subject: PricingOption;
  stage: PricingOption;
  classSize: PricingOption;
};

/** 计算过程中的一项明细，用于在页面上解释价格构成。 */
export type QuoteBreakdownItem = {
  label: string;
  value: string;
};

export type QuoteResult = {
  /** 单课时价格（元）。 */
  unitPrice: number;
  /** 价格构成说明。 */
  breakdown: QuoteBreakdownItem[];
};

/**
 * 由开班人数得到人数系数。
 *
 * 约定：pricing.md 里「开班人数」的 `基础价` 存的是**百分比**，
 * 例：100 = 原价，200 = 两倍，70 = 七折。
 *
 * 这是临时实现的一部分：若真实规则不是按百分比，改这里即可。
 */
function classSizeFactor(classSize: PricingOption): number {
  const percent = classSize.price > 0 ? classSize.price : 100;
  return percent / 100;
}

/**
 * 计算报价。
 *
 * 临时公式：单课时价 = (科目基础价 + 阶段加价) × 人数系数，结果取整到元。
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const subjectBase = input.subject.price;
  const stageExtra = input.stage.price;
  const factor = classSizeFactor(input.classSize);

  const unitPrice = Math.round((subjectBase + stageExtra) * factor);

  return {
    unitPrice,
    breakdown: [
      { label: `${input.subject.name} 基础价`, value: `¥${subjectBase}` },
      { label: `${input.stage.name} 阶段加价`, value: `+¥${stageExtra}` },
      {
        label: `${input.classSize.name} 人数系数`,
        value: `×${factor.toFixed(2)}`,
      },
    ],
  };
}
