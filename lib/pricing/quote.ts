/**
 * 报价公式的**站点侧入口**（薄薄一层）。
 *
 * 公式本身已经搬到 `lib/backend/pricing.ts` —— 那里是「后端」：
 * 价格与规则是数据，后台可改，且前后台共用同一份实现。
 *
 * 这个文件保留下来只做一件事：把站点内容里的规则取出来，转发给后端公式。
 * 页面（EstimateForm / app/(site)/quote/page.tsx）继续 `import { calculateQuote }`
 * 即可，不需要知道规则从哪来。
 *
 * 为什么不干脆让页面直接调后端：宣传页是**静态导出**的，它在家长浏览器里运行，
 * 读不到管理员那台机器的 localStorage。因此宣传页用站点内容的规则，
 * 后台用库里的配置 —— 两边规则不同时，说明后台改了价但还没「导出上线」，
 * `npm run check` 会盯着这一点（同一份配置上前后台必须算出同一个价）。
 */

import {
  calculateQuote as calculateWithRules,
  feePercentFor as feePercentWithRules,
  isTrialFree as isTrialFreeWithRules,
  trialFeeFor as trialFeeWithRules,
  pricingConfigFromContent,
  FALLBACK_RULES,
  type PricingRules,
  type QuoteInput,
  type QuoteResult,
} from "@/lib/backend/pricing";

export type {
  QuoteBreakdownItem,
  QuoteInput,
  QuoteResult,
} from "@/lib/backend/pricing";

/**
 * 站点内容里的计费规则。
 *
 * 解析失败时不抛错，退回默认规则（1 节 +10%、满 10 节试课免费）：
 * 报价页是宣传站的主路径，不能因为内容里少写一段规则就打不开。
 */
let cachedRules: PricingRules | null = null;

function rules(): PricingRules {
  if (cachedRules === null) {
    try {
      cachedRules = pricingConfigFromContent().rules;
    } catch {
      cachedRules = FALLBACK_RULES;
    }
  }
  return cachedRules;
}



/** 按节数判断手续费百分比：1 节加收，其余不加收。 */
export function feePercentFor(lessons: number): number {
  return feePercentWithRules(lessons, rules());
}

/** 试课是否免费：报课达到门槛即免费。 */
export function isTrialFree(lessons: number): boolean {
  return isTrialFreeWithRules(lessons, rules());
}

/** 试课费用：免费时 0，否则按课程原价计。 */
export function trialFeeFor(lessons: number, coursePrice: number | null): number {
  return trialFeeWithRules(lessons, coursePrice, rules());
}

/** 计算报价（公式实现见 lib/backend/pricing.ts）。 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  return calculateWithRules(input, rules());
}
