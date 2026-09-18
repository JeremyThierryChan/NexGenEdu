import type { Enrollment, Payment } from "./types";

/**
 * 钱的规则。
 *
 * 全部是纯函数，集中在一个文件里，因为「金额怎么算」是最容易各处口径不一的地方：
 * 报课表单算一次、对账单算一次、退费再算一次，迟早会对不上。
 *
 * 三个金额概念（刻意分开）：
 *   - **标价**（listAmount）= 总课时 × 单价：机构挂牌价，用于展示与「优惠了多少」；
 *   - **约定应缴**（agreedAmount）= 与家长谈定的总额：可以低于标价（优惠），
 *     也可以高于实收（分期未付）；
 *   - **实收**（paidAmount）= 实际到账累计，由收款记录累加得出。
 *
 * 由此推出：优惠 = 标价 − 约定应缴；欠费 = 约定应缴 − 实收。
 */

/** 标价合计。 */
export function listAmount(enrollment: Enrollment): number {
  return round2(enrollment.totalLessons * enrollment.unitPrice);
}

/** 优惠金额（标价 − 约定应缴，不会为负）。 */
export function discountAmount(enrollment: Enrollment): number {
  return round2(Math.max(0, listAmount(enrollment) - enrollment.agreedAmount));
}

/** 欠费金额（约定应缴 − 实收，不会为负）。 */
export function outstandingAmount(enrollment: Enrollment): number {
  return round2(Math.max(0, enrollment.agreedAmount - enrollment.paidAmount));
}

/** 已上部分的标价（退费策略会用到）。 */
export function usedListAmount(enrollment: Enrollment): number {
  return round2(enrollment.usedLessons * enrollment.unitPrice);
}

/** 保留两位小数：金额一律按分收口，避免 0.1 + 0.2 这类浮点误差累积。 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 金额显示：`1,280.00`；整数金额不显示小数，读起来干净些。 */
export function formatMoney(value: number): string {
  const rounded = round2(value);
  const text = Number.isInteger(rounded)
    ? rounded.toLocaleString("zh-CN")
    : rounded.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `¥${text}`;
}

// ── 退费策略 ────────────────────────────────────────────────────────────

export type RefundInput = {
  totalLessons: number;
  usedLessons: number;
  agreedAmount: number;
  unitPrice: number;
};

export type RefundResult = {
  /** 应退金额（不会为负）。 */
  refund: number;
  /** 计算口径说明，直接显示给管理员看，避免「这个数字怎么来的」。 */
  formula: string;
};

export type RefundPolicy = {
  id: string;
  name: string;
  description: string;
  calculate(input: RefundInput): RefundResult;
};

/**
 * 退费策略。
 *
 * 默认是「按实付比例退」—— 最简单、最容易向家长解释，机构也最容易执行。
 * 另一条「追回已上课时的标价优惠」适合给过大折扣、又担心上完课就退的情况。
 *
 * 要换成你们实际的规则，只需要在这里加一条策略或改默认值：
 * 服务层与界面都从这个数组取，不各自实现。
 */
export const REFUND_POLICIES: RefundPolicy[] = [
  {
    id: "prorata",
    name: "按实付比例退（默认）",
    description: "未上的课时按实付单价退回；已上的课时按实付单价收取。对家长最直观。",
    calculate({ totalLessons, usedLessons, agreedAmount }) {
      if (totalLessons <= 0) return { refund: 0, formula: "总课时为 0，无可退" };
      const remaining = Math.max(0, totalLessons - usedLessons);
      const unitPaid = agreedAmount / totalLessons;
      return {
        refund: round2(unitPaid * remaining),
        formula: `实付 ${formatMoney(agreedAmount)} ÷ ${totalLessons} 节 × 剩余 ${remaining} 节`,
      };
    },
  },
  {
    id: "list-clawback",
    name: "追回已上课时的标价",
    description:
      "已上的课时按标价（原价）扣，剩余部分才退。适合给过较大折扣、需要防止「上完就退」的情况。",
    calculate({ totalLessons, usedLessons, agreedAmount, unitPrice }) {
      const used = Math.min(usedLessons, totalLessons);
      const clawback = round2(used * unitPrice);
      const refund = round2(Math.max(0, agreedAmount - clawback));
      return {
        refund,
        formula: `实付 ${formatMoney(agreedAmount)} − 已上 ${used} 节 × 标价 ${formatMoney(unitPrice)}`,
      };
    },
  },
];

export const DEFAULT_REFUND_POLICY_ID = "prorata";

export function findRefundPolicy(id: string): RefundPolicy {
  return REFUND_POLICIES.find((policy) => policy.id === id) ?? REFUND_POLICIES[0]!;
}

/** 按指定策略算退费。 */
export function calculateRefund(enrollment: Enrollment, policyId: string): RefundResult {
  const policy = findRefundPolicy(policyId);
  return policy.calculate({
    totalLessons: enrollment.totalLessons,
    usedLessons: enrollment.usedLessons,
    agreedAmount: enrollment.agreedAmount,
    unitPrice: enrollment.unitPrice,
  });
}

// ── 收款汇总 ────────────────────────────────────────────────────────────

export type PaymentSummary = {
  /** 收款合计（不含退款）。 */
  received: number;
  /** 退款合计（正数表示退出去多少）。 */
  refunded: number;
  /** 净收入 = 收款 − 退款。 */
  net: number;
  count: number;
  /** 按支付方式分组。 */
  byMethod: Array<{ method: string; amount: number; count: number }>;
};

/** 汇总一批收款记录（传入哪段时间就汇总哪段）。 */
export function summarizePayments(payments: Payment[]): PaymentSummary {
  let received = 0;
  let refunded = 0;
  const byMethod = new Map<string, { amount: number; count: number }>();

  for (const payment of payments) {
    if (payment.kind === "退款") {
      refunded = round2(refunded + payment.amount);
    } else {
      received = round2(received + payment.amount);
    }

    const current = byMethod.get(payment.method) ?? { amount: 0, count: 0 };
    byMethod.set(payment.method, {
      amount: round2(current.amount + (payment.kind === "退款" ? -payment.amount : payment.amount)),
      count: current.count + 1,
    });
  }

  return {
    received,
    refunded,
    net: round2(received - refunded),
    count: payments.length,
    byMethod: [...byMethod].map(([method, value]) => ({ method, ...value })),
  };
}

/** 某个自然月的区间（本地时区）：用于「本月收入」。 */
export function monthRange(anchor: Date): { from: Date; to: Date; label: string } {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from, to, label: `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月` };
}

/** 日期是否落在区间内（含首尾）。 */
export function withinRange(iso: string, from: Date, to: Date): boolean {
  const time = new Date(iso).getTime();
  return time >= from.getTime() && time <= to.getTime();
}
