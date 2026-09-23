/**
 * 报价：计价模型、公式与规则 —— 报价的「后端」。
 *
 * ## 为什么报价要搬到后端
 *
 * 原先公式写在 `lib/pricing/quote.ts`（页面侧），规则（1 节 +10% 手续费、
 * 报满 10 节试课免费）直接硬编码在代码里。结果是：**调一次价要改代码、重新构建**，
 * 而且后台看不到家长会被报多少 —— 咨询时只能现场按计算器。
 *
 * 现在：
 *
 *   - 价格与规则是**数据**（`PricingConfig`），存在伪后端里，后台「报价」页可改；
 *   - 公式只有**一份实现**（本文件的 `calculateQuote`），前台报价页与后台试算器
 *     都调它 —— 两边算出不同的价格是最不能接受的事故；
 *   - 后台可以直接给家长试算，不用切到宣传页去点一遍。
 *
 * ## 基础价、系数分别是什么意思
 *
 * 报价 = 基础价 × 若干系数，每个系数各管一件事，互不重叠：
 *
 * | 维度 | 字段 | 含义 | 默认 |
 * | --- | --- | --- | --- |
 * | 课程 | `basePrice` | **每小时的价**（元 / 小时）：一对一、报 2 节及以上；再乘时长才是课单价 | 分阶段设定 |
 * | 人数 | `classType.coefficient` | **人数系数**：人越多每人越便宜 | 一对二 0.7、一对三 0.6、一对多 0.5 |
 * | 时长 | `duration.multiplier` | 一节课上多久 | 1 小时 1.0、1.5 小时 1.5、2 小时 2.0 |
 * | 手续费 | `rules.singleLessonFeePercent` | 只报 1 节时加收（一次课不划算） | 10% |
 * | 试课 | `rules.freeTrialMinLessons` | 报满多少节后试课免费，否则按原价收 1 节 | 10 节 |
 *
 * **科目这一维已经没有了**（机构口径：「科目系数可以删除」）：以前还有一列
 * `subject.coefficient`（同一阶段内不同科目的师资 / 难度差异），删掉它**不改变任何
 * 已算出的价** —— 那份表里的系数全是 1（×1 乘不乘一样），而试课费本来就按基础价原价收。
 *
 * 两个例外，都不是「乘系数」：
 *
 *   - **班课（9-20 人）**：按「教师课时总费用 ÷ 班级人数」分摊，不用人数系数；
 *   - **试课费**：永远按**课程基础价原价**收，不带人数系数、时长与手续费
 *     （试课是单独产品，不是正课的折扣价）。
 *
 * 计算顺序（改动这里等于改价，务必同步 `npm run check` 里的用例）：
 *
 *   1. 课时价 = 基础价 × 人数系数                （班课：教师费用 ÷ 人数）
 *   2. 课时价 ×= 时长乘数
 *   3. 课时价 ×= (1 + 手续费百分比)
 *   4. 正课总价 = 课时价 × 节数
 *   5. 总价 = 正课总价 + 试课费
 */

import { pricingSource } from "@/data/site/pricing";
import { catalogFromSeed } from "./catalog-seed";
import { formatIdByName } from "./class-types";
import {
  DEFAULT_PRICING_RULES,
  parsePricingSource,
  UNAVAILABLE_PRICE_LABEL,
  type ClassPricingMode,
  type ClassType,
  type LessonDuration,
  type PricingData,
  type PricingRules,
  type StageCourse,
} from "@/lib/data/pricing";

import {
  sharePercentFor,
  teacherFeeFor,
  teacherShareAppliesTo,
  type TeacherShareRules,
} from "./teacher-share";

export type { PricingRules, TeacherShareRules };

/* ── 一、配置：后台可改的那份数据 ─────────────────────────────────────── */

/**
 * 一门课程：名字 + 基础价（**元 / 小时**）。
 *
 * ⚠️ 单位是"每小时"，不是"每节课"：家长在报价页选的**每节课时长**（1 / 1.5 / 2 小时）
 * 是**再乘**上去的（`duration.multiplier`），算出来才是课单价（元 / 节）。
 * 这两个单位混着说会立刻误导人 —— 150 元/小时的课，1.5 小时一节就是 225 元/节，
 * 而不是"150 元的课被加了 50%"。
 */
export type PricingCourse = {
  name: string;
  /** 基础价（元 / 小时）；null 表示暂未开放（不可选、不可报价）。 */
  basePrice: number | null;
  available: boolean;
  /**
   * 关联到课程库的课程 id（后台「课程库」里那门课）。
   *
   * 有它才叫「打通」：课程库里改了名字这里跟着改、课程停了价也跟着停，
   * 而不是两边各留一个名字慢慢对不上。网站内容里没有这个概念（写进 Markdown 的就是
   * 名字 + 价格），所以导出/回读时这一项会被忽略 —— 见 `pricingConfigCore`。
   */
  courseId?: string;
};

/** 一个学习阶段（小学 / 初中 / 高中 / 其他类型 —— 与课程类型的学段同名，v37）及其课程。 */
export type PricingStage = {
  name: string;
  courses: PricingCourse[];
};

/**
 * 班型：系数模式 or 按人数分摊。
 *
 * 名字沿用 `PricingClassType`（改名会牵动契约与数据库形状，不值当），
 * 但这个类型表达的是**「班型 → 人数系数」这张表**：`coefficient` 就是**人数系数**
 * （人越多每人越便宜），与"班级"这个字眼无关。
 */
export type PricingClassType = {
  /**
   * 名称**以课程类型的维度表为准**（v25）：这里是快照，读的时候会被 `syncClassTypes`
   * 换成 `catalog.formats` 里那一份 —— 机构改了班型名，报价页与网站报价器跟着变。
   */
  name: string;
  /**
   * 课程类型里的班型 id（`fmt_…`）。空串＝还没对上（老数据 / 名字对不上），
   * 由 `syncClassTypes` 按名字再对一次并报出来。
   *
   * 为什么留着名字不直接删掉：它是**对不上时的线索**（人一眼能看出是哪一行），
   * 也是导出 Markdown 那一份的形状；而"身份"已经是这个 id。
   */
  formatId: string;
  mode: ClassPricingMode;
  /** 系数模式下的**人数系数**；按人数分摊时为 null。 */
  coefficient: number | null;
};

/** 每节课的时长选项。 */
export type PricingDuration = {
  name: string;
  hours: number;
  multiplier: number;
};

/** 其他项目（按学期 / 按期的独立产品，不参与课时公式）。 */
export type PricingOtherItem = {
  name: string;
  details: Array<{ title: string; value: string }>;
};

/** 试课（独立产品）。 */
export type PricingTrial = {
  name: string;
  priceLabel: string;
};

/** 报价配置：伪后端里的一份完整数据。 */
export type PricingConfig = {
  rules: PricingRules;
  /** 教师课时费（分成）规则：见 lib/backend/teacher-share.ts。 */
  teacherShare: TeacherShareRules;
  stages: PricingStage[];
  classTypes: PricingClassType[];
  durations: PricingDuration[];
  trial: PricingTrial | null;
  otherItems: PricingOtherItem[];
  /** 这份配置从哪来：站点内容 or 后台修改。 */
  source: string;
  /** 后台最后修改时间（ISO）；空串表示从未在后台改过。 */
  updatedAt: string;
};

/** 「从站点内容初始化」的标记。 */
export const PRICING_SOURCE_CONTENT = "站点内容（data/site/pricing.md）";

/** 「后台改过」的标记。 */
export const PRICING_SOURCE_ADMIN = "后台修改";

/* ── 二、公式 ───────────────────────────────────────────────────────── */

/** 报价输入：页面选择区里的选择。 */
export type QuoteInput = {
  /** 所选课程（含基础价）。 */
  course: StageCourse;
  /** 所选班级类型（人数系数在这上面）。 */
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

/** 计算过程中的一项明细，用于解释价格构成。 */
export type QuoteBreakdownItem = {
  label: string;
  value: string;
};

export type QuoteResult = {
  /** 是否计算成功；false 时 reason 说明原因。 */
  ok: boolean;
  reason?: string;
  /**
   * 课单价（**元 / 节**）= 基础价（元/小时）× 每节课几小时 × 人数系数
   * （报 1 节时再含手续费）。别与基础价混淆：基础价是"每小时"的价。
   */
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
export function feePercentFor(lessons: number, rules: PricingRules): number {
  return lessons === 1 ? rules.singleLessonFeePercent : 0;
}

/**
 * 试课是否免费。
 *
 * 规则：试课结束后报课达到门槛（默认 10 节）及以上，则试课免费；
 * 否则按课程原价收取 1 节试课费用。
 */
export function isTrialFree(lessons: number, rules: PricingRules): boolean {
  return lessons >= rules.freeTrialMinLessons;
}

/** 试课费用：免费时 0，否则按课程原价（不含人数系数、时长与手续费）计。 */
export function trialFeeFor(
  lessons: number,
  coursePrice: number | null,
  rules: PricingRules,
): number {
  if (isTrialFree(lessons, rules)) return 0;
  if (!rules.chargeTrialWhenNotFree) return 0;
  return coursePrice ?? 0;
}

/**
 * 计算课时价（不含时长乘数与手续费）。
 *
 * 分两种模式：
 *   - coefficient：一对一 / 小班，按**人数系数**计价（基础价 × 人数系数）
 *   - cost-share：班课，按「教师课时总费用 ÷ 班级人数」分摊
 */
function baseUnitPrice(input: QuoteInput): { price: number } | { error: string } {
  const { course, classType } = input;

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

  return { price: course.price * (classType.coefficient ?? 1) };
}

/**
 * 生成价格构成明细。
 *
 * **时长那一行要摆出来**（"每节课 1.5 小时 ×1.5"）：基础价的单位是**元 / 小时**，
 * 而家长看到的课单价是**元 / 节** —— 中间就差这一次乘法。不写出来，
 * 「150 元的课怎么变成 225 元」就只能靠猜（早先这里有意省略，是把它当成内部换算了；
 * 单位写清楚之后，它反而是最需要交代的那一步）。
 * 时长恰好 1 小时（乘数 1）时不显示这一行：乘 1 什么都不用解释。
 */
function buildBreakdown(
  input: QuoteInput,
  rules: PricingRules,
  basePrice: number,
  finalUnitPrice: number,
  lessonsPrice: number,
): QuoteBreakdownItem[] {
  const { course, classType, lessons } = input;
  const items: QuoteBreakdownItem[] = [
    { label: `${course.name} 基础价（元/小时）`, value: money(course.price ?? 0) },
  ];

  if (input.duration.multiplier !== 1) {
    items.push({ label: `每节课 ${input.duration.hours} 小时`, value: `×${input.duration.multiplier}` });
  }

  if (classType.mode === "cost-share") {
    items.push({ label: "教师课时总费用", value: money(input.classCost ?? 0) });
    items.push({ label: "班级人数", value: `${input.studentCount ?? 0} 人` });
    items.push({ label: "课时价（费用 ÷ 人数）", value: money(basePrice) });
  } else {
    items.push({
      label: `${classType.name} 人数系数`,
      value: `×${classType.coefficient ?? 1}`,
    });
  }

  const fee = feePercentFor(lessons, rules);
  if (fee !== 0) {
    items.push({ label: `手续费 ${fee}%`, value: `+${fee}%` });
  }

  items.push({ label: "最终单价", value: money(finalUnitPrice) });
  items.push({ label: `${lessons} 节正课`, value: money(lessonsPrice) });

  return items;
}

/** 计算报价。规则由调用方传入：前台传站点内容的规则，后台传配置里的规则。 */
export function calculateQuote(input: QuoteInput, rules: PricingRules): QuoteResult {
  const lessons = Math.floor(input.lessons);
  const hours = input.duration.hours;
  const trialFree = isTrialFree(lessons, rules);

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
  const finalUnitPrice = round2(afterDuration * (1 + feePercentFor(lessons, rules) / 100));
  const lessonsPrice = round2(finalUnitPrice * lessons);

  // 试课：满门槛免费，否则按课程原价收 1 节
  const trialFee = round2(trialFeeFor(lessons, input.course.price, rules));
  const totalPrice = round2(lessonsPrice + trialFee);

  const breakdown = buildBreakdown(input, rules, base.price, finalUnitPrice, lessonsPrice);
  breakdown.push({
    label: trialFree
      ? `试课（报课满 ${rules.freeTrialMinLessons} 节，免费）`
      : "试课 1 节（按课程原价）",
    value: trialFree || !rules.chargeTrialWhenNotFree ? money(0) : money(trialFee),
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

/* ── 三、按名字报价（服务端形态）────────────────────────────────────── */

/**
 * 报价请求：页面只发「选了哪个课程 / 哪个班型 / 多少节」。
 *
 * 刻意不发价格：价格由服务端（这里是伪后端）自己查，
 * 否则前端改个数字就能改价，转真后端时这是必须堵住的口子。
 *
 * **没有科目**（机构口径：「科目系数可以删除」）：页面也不再让家长选科目，
 * 因此这里连 `subjectName` 这个字段都不该有 —— 老前端若还发它，会被忽略。
 */
export type QuoteSelection = {
  courseName: string;
  classTypeName: string;
  durationName: string;
  lessons: number;
  studentCount?: number;
  classCost?: number;
};

/** 把名字翻译成公式需要的对象；找不到就说明配置或选择有问题。 */
export function resolveSelection(
  config: PricingConfig,
  selection: QuoteSelection,
): { ok: true; input: QuoteInput } | { ok: false; reason: string } {
  let course: PricingCourse | undefined;
  for (const item of config.stages) {
    const found = item.courses.find((entry) => entry.name === selection.courseName);
    if (found !== undefined) {
      course = found;
      break;
    }
  }
  if (course === undefined) {
    return { ok: false, reason: `报价配置里没有课程「${selection.courseName}」。` };
  }

  const classType = config.classTypes.find((item) => item.name === selection.classTypeName);
  if (classType === undefined) {
    return { ok: false, reason: `报价配置里没有班型「${selection.classTypeName}」。` };
  }

  const duration = config.durations.find((item) => item.name === selection.durationName);
  if (duration === undefined) {
    return { ok: false, reason: `报价配置里没有时长「${selection.durationName}」。` };
  }

  return {
    ok: true,
    input: {
      course: { name: course.name, price: course.basePrice, available: course.available },
      classType: {
        name: classType.name,
        available: true,
        mode: classType.mode,
        coefficient: classType.coefficient,
      },
      duration: { name: duration.name, hours: duration.hours, multiplier: duration.multiplier },
      lessons: selection.lessons,
      studentCount: selection.studentCount,
      classCost: selection.classCost,
    },
  };
}

/** 按名字报价：解析失败时返回 ok:false（与页面上「暂未开放」等业务原因同一形态）。 */
export function quoteSelection(config: PricingConfig, selection: QuoteSelection): QuoteResult {
  const resolved = resolveSelection(config, selection);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      unitPrice: 0,
      lessons: Number.isFinite(selection.lessons) ? Math.max(0, Math.floor(selection.lessons)) : 0,
      hours: 0,
      lessonsPrice: 0,
      trialFee: 0,
      trialFree: false,
      totalPrice: 0,
      breakdown: [],
    };
  }
  return calculateQuote(resolved.input, config.rules);
}

/* ── 三之二、教师课时费（分成）试算 ─────────────────────────────────── */

/** 教师课时费试算请求：在报价选择之上再加「这个班有几个学生」。 */
export type TeacherFeeSelection = QuoteSelection & { students?: number };

/** 教师课时费试算结果（教师拿多少、机构留多少）。 */
export type TeacherFeeResult = {
  ok: boolean;
  reason?: string;
  /** 上课小时数。 */
  hours: number;
  students: number;
  /** 分成比例（百分比）。 */
  percent: number;
  /** 「课程单价 / 小时」：按所选口径算出的数。 */
  hourlyPrice: number;
  /** 家长每生每小时的课时价（含人数系数），用于算机构留存。 */
  seatHourlyPrice: number;
  /** 教师课时费。 */
  teacherFee: number;
  /** 本课时段家长侧总收入。 */
  revenue: number;
  /** 机构留存 = 收入 − 教师课时费。 */
  keepFee: number;
  breakdown: QuoteBreakdownItem[];
};

/**
 * 算教师课时费。
 *
 * 规则：`小时数 × 课程单价/小时 × (基准 + (人数 − 1) × 每加一名学生)`
 * （见 lib/backend/teacher-share.ts）。**大班课（9-20人）不适用** ——
 * 那类按「教师课时总费用 ÷ 班级人数」另议，因此这里直接返回原因而不是硬套公式。
 *
 * 人数一样由调用方给（试算时手填、将来排课时取学生名单的实际人数），
 * 比例与课时单价一律由这边的配置算，不接受外部传进来的比例。
 */
export function teacherFeeForSelection(
  config: PricingConfig,
  selection: TeacherFeeSelection,
): TeacherFeeResult {
  const hours = 0;
  const empty = (reason: string): TeacherFeeResult => ({
    ok: false,
    reason,
    hours,
    students: 0,
    percent: 0,
    hourlyPrice: 0,
    seatHourlyPrice: 0,
    teacherFee: 0,
    revenue: 0,
    keepFee: 0,
    breakdown: [],
  });

  const resolved = resolveSelection(config, selection);
  if (!resolved.ok) return empty(resolved.reason);
  const input = resolved.input;

  if (input.course.price === null) return empty("所选课程暂未开放，无法计算教师课时费。");
  if (!teacherShareAppliesTo(input.classType)) {
    return empty(
      "大班课（9-20人）不适用分成规则：那类按「教师课时总费用 ÷ 班级人数」另议。",
    );
  }

  const students = Math.max(1, Math.floor(selection.students ?? selection.studentCount ?? 1));
  /*
   * `priceBasis: "course"`（标准单价）现在**就是基础价本身** —— 以前还要乘一个
   * 科目系数，科目这一维删掉之后那个乘法也随之消失（系数全是 1，所以算出来的
   * 课时费一分没变）。
   */
  const courseHourly = round2(input.course.price);
  const seatHourly = round2(courseHourly * (input.classType.coefficient ?? 1));
  const hourlyPrice = config.teacherShare.priceBasis === "seat" ? seatHourly : courseHourly;
  const percent = sharePercentFor(students, config.teacherShare);
  const teacherFee = teacherFeeFor(
    { hours: input.duration.hours, hourlyPrice, students },
    config.teacherShare,
  );
  const revenue = round2(seatHourly * input.duration.hours * students);
  const keepFee = round2(revenue - teacherFee);

  return {
    ok: true,
    hours: input.duration.hours,
    students,
    percent,
    hourlyPrice,
    seatHourlyPrice: seatHourly,
    teacherFee,
    revenue,
    keepFee,
    breakdown: [
      {
        label: `课程单价 / 小时（${config.teacherShare.priceBasis === "seat" ? "班型课时价" : "课程标准单价"}）`,
        value: money(hourlyPrice),
      },
      {
        label: `${students} 人的分成比例`,
        value: `${percent}%（${config.teacherShare.basePercent}% + ${students - 1}×${config.teacherShare.stepPercent}%）`,
      },
      { label: "上课时长", value: `${input.duration.hours} 小时` },
      { label: "教师课时费", value: money(teacherFee) },
      {
        label: "家长侧本课时段合计",
        value: `${money(revenue)}（每生 ${money(seatHourly)} × ${students} 人 × ${input.duration.hours} 小时）`,
      },
      { label: "机构留存", value: money(keepFee) },
    ],
  };
}

/* ── 四、校验：服务端必须自己复核（不信前端传上来的配置）────────────── */

/**
 * 校验一份报价配置，返回全部问题（空数组 = 通过）。
 *
 * 为什么必须校验：这份配置是**算钱**的依据。系数写成 0 会让所有报价变 0，
 * 写成字符串会让价格变成 NaN，而这些都会安静地显示给家长。
 * 因此保存前拦住，而不是等家长看到 ¥NaN。
 */
export function validatePricingConfig(config: PricingConfig): string[] {
  const problems: string[] = [];

  const { rules } = config;
  if (
    !Number.isFinite(rules.singleLessonFeePercent) ||
    rules.singleLessonFeePercent < 0 ||
    rules.singleLessonFeePercent > 100
  ) {
    problems.push("手续费百分比必须在 0 到 100 之间。");
  }
  if (!Number.isInteger(rules.freeTrialMinLessons) || rules.freeTrialMinLessons < 1) {
    problems.push("试课免费门槛必须是不小于 1 的整数节。");
  }

  const { teacherShare } = config;
  if (
    !Number.isFinite(teacherShare.basePercent) ||
    teacherShare.basePercent < 0 ||
    teacherShare.basePercent > 500
  ) {
    problems.push("教师分成（第一名学生）的百分比必须在 0 到 500 之间。");
  }
  if (!Number.isFinite(teacherShare.stepPercent) || teacherShare.stepPercent < 0) {
    problems.push("教师分成每增加一名学生加的百分点必须是不小于 0 的数字。");
  }
  if (teacherShare.priceBasis !== "course" && teacherShare.priceBasis !== "seat") {
    problems.push("教师分成的「课程单价口径」只能是课程标准单价或班型课时价。");
  }

  if (config.stages.length === 0) problems.push("至少要有一个学习阶段。");
  if (config.classTypes.length === 0) problems.push("至少要有一个班型，否则无法报价。");
  if (config.durations.length === 0) problems.push("至少要有一个课时时长，否则无法报价。");

  const courseNames = new Set<string>();
  for (const stage of config.stages) {
    if (stage.name.trim() === "") problems.push("存在没有名字的学习阶段。");
    if (stage.courses.length === 0) problems.push(`「${stage.name}」阶段下没有任何课程。`);
    for (const course of stage.courses) {
      if (course.name.trim() === "") {
        problems.push(`「${stage.name}」阶段下存在没有名字的课程。`);
        continue;
      }
      if (courseNames.has(course.name)) {
        problems.push(`课程名「${course.name}」重复了：报价按名字查课程，重名会报错价。`);
      }
      courseNames.add(course.name);
      if (course.basePrice !== null && (!Number.isFinite(course.basePrice) || course.basePrice < 0)) {
        problems.push(`「${course.name}」的基础价必须是不小于 0 的数字。`);
      }
    }
  }

  const classTypeNames = new Set<string>();
  const classTypeFormatIds = new Set<string>();
  for (const classType of config.classTypes) {
    if (classType.name.trim() === "") {
      problems.push("存在没有名字的班型。");
      continue;
    }
    if (classTypeNames.has(classType.name)) problems.push(`班型「${classType.name}」重复了。`);
    classTypeNames.add(classType.name);
    /*
     * 班型 id 必须指向课程类型里存在的班型，且不能两条班级类型挂同一个班型 ——
     * 挂重了会出现"这个班型算哪一行系数"两说（而家长看到的价格只有一个）。
     */
    const formatId = classType.formatId ?? "";
    if (formatId !== "") {
      if (classTypeFormatIds.has(formatId)) {
        problems.push(`班型「${classType.name}」在报价里出现了两条（同一个班型只能有一行人数系数）。`);
      }
      classTypeFormatIds.add(formatId);
    }
    if (classType.mode === "coefficient") {
      if (!Number.isFinite(classType.coefficient) || (classType.coefficient ?? 0) <= 0) {
        problems.push(`班型「${classType.name}」的人数系数必须大于 0。`);
      }
    }
  }

  const durationNames = new Set<string>();
  for (const duration of config.durations) {
    if (duration.name.trim() === "") {
      problems.push("存在没有名字的时长选项。");
      continue;
    }
    if (durationNames.has(duration.name)) problems.push(`时长「${duration.name}」重复了。`);
    durationNames.add(duration.name);
    if (!Number.isFinite(duration.hours) || duration.hours <= 0) {
      problems.push(`时长「${duration.name}」的小时数必须大于 0。`);
    }
    if (!Number.isFinite(duration.multiplier) || duration.multiplier <= 0) {
      problems.push(`时长「${duration.name}」的乘数必须大于 0。`);
    }
  }

  return problems;
}

/* ── 五、与内容和后台之间的转换 ─────────────────────────────────────── */

/** 把站点内容（已解析）转成配置。 */
export function configFromPricingData(data: PricingData, source: string): PricingConfig {
  return {
    rules: data.rules,
    teacherShare: data.teacherShare,
    stages: data.stages.map((stage) => ({
      name: stage.name,
      courses: stage.courses.map((course) => ({
        name: course.name,
        basePrice: course.price,
        available: course.available,
      })),
    })),
    classTypes: data.classTypes.map((classType) => ({
      name: classType.name,
      /*
       * 站点内容里的班型名字**在这里就对一次维度表**（按名字）。
       * 对不上时留空串 —— 不编一个 id 出来：那一行会被 `syncClassTypes` 报成
       * "报价里有、维度表里没有"，机构去课程类型页确认是改名还是删除。
       */
      formatId: formatIdByName(classType.name, catalogFromSeed()),
      mode: classType.mode,
      coefficient: classType.coefficient,
    })),
    durations: data.durations.map((duration) => ({
      name: duration.name,
      hours: duration.hours,
      multiplier: duration.multiplier,
    })),
    trial:
      data.trial === null ? null : { name: data.trial.name, priceLabel: data.trial.priceLabel },
    otherItems: data.otherItems.map((item) => ({
      name: item.name,
      details: item.details.map((detail) => ({ title: detail.title, value: detail.value })),
    })),
    source,
    updatedAt: "",
  };
}

/** 站点内容里的报价配置（种子数据的来源）。 */
export function pricingConfigFromContent(): PricingConfig {
  return configFromPricingData(parsePricingSource(pricingSource), PRICING_SOURCE_CONTENT);
}

/** 从任意 Markdown 源码解析配置（后台导出的内容回读校验用）。 */
export function pricingConfigFromSource(source: string): PricingConfig {
  return configFromPricingData(parsePricingSource(source), PRICING_SOURCE_CONTENT);
}

/**
 * 导出成与 `data/site/pricing.md` 同构的 Markdown。
 *
 * 为什么需要导出：伪后端的数据只存在**管理员这台浏览器**里，家长看到的报价页
 * 读的是站点内容 —— 后台改的价格不会自己跑到宣传站上去。导出这段文本、
 * 替换 `data/site/pricing.md` 里「## 学习阶段」及其后的部分（页面文案字段不要动），
 * 才能把后台调好的价格真正上线。
 *
 * 输出刻意与内容文件格式一致，并且 `npm run check` 会把导出结果回读一遍，
 * 保证导出去的是**能用的内容**，而不是一段看起来像的文本。
 */
export function pricingConfigToMarkdown(config: PricingConfig): string {
  const lines: string[] = [];

  lines.push("## 学习阶段", "");
  for (const stage of config.stages) {
    lines.push(`### ${stage.name}`, "");
    for (const course of stage.courses) {
      const price =
        course.basePrice === null || !course.available
          ? UNAVAILABLE_PRICE_LABEL
          : String(course.basePrice);
      lines.push(`#### 课程: ${course.name}: ${price}`, "");
    }
  }

  lines.push("## 班级类型", "");
  for (const classType of config.classTypes) {
    lines.push(`### ${classType.name}`, "");
    lines.push(`#### 名称: ${classType.name}`, "");
    lines.push(
      `#### 系数: ${classType.mode === "cost-share" ? "按人数分摊" : String(classType.coefficient ?? 1)}`,
      "",
    );
  }

  lines.push("## 课时选择", "");
  for (const duration of config.durations) {
    lines.push(`### ${duration.name}`, "");
    lines.push(`#### 名称: ${duration.name}`, "");
    lines.push(`#### 小时: ${duration.hours}`, "");
    lines.push(`#### 乘数: ${duration.multiplier}`, "");
  }

  lines.push("## 计费规则", "");
  lines.push("### 手续费", "");
  lines.push("#### 名称: 手续费", "");
  lines.push(`#### 百分比: ${config.rules.singleLessonFeePercent}`, "");
  lines.push("### 试课免费门槛", "");
  lines.push("#### 名称: 试课免费门槛", "");
  lines.push(`#### 节数: ${config.rules.freeTrialMinLessons}`, "");
  lines.push("### 试课未达门槛", "");
  lines.push("#### 名称: 试课未达门槛", "");
  lines.push(`#### 收费: ${config.rules.chargeTrialWhenNotFree ? "是" : "否"}`, "");

  lines.push("## 教师分成", "");
  lines.push("### 基准分成", "");
  lines.push("#### 名称: 基准分成", "");
  lines.push(`#### 百分比: ${config.teacherShare.basePercent}`, "");
  lines.push("### 每增加一名学生", "");
  lines.push("#### 名称: 每增加一名学生", "");
  lines.push(`#### 百分比: ${config.teacherShare.stepPercent}`, "");
  lines.push("### 课程单价口径", "");
  lines.push("#### 名称: 课程单价口径", "");
  lines.push(`#### 取值: ${config.teacherShare.priceBasis === "seat" ? "班型" : "标准"}`, "");

  if (config.trial !== null) {
    lines.push("## 试课", "");
    lines.push(`### ${config.trial.name}`, "");
    lines.push(`#### 名称: ${config.trial.name}`, "");
    lines.push(`#### 价格: ${config.trial.priceLabel}`, "");
  }

  lines.push("## 其他项目", "");
  for (const item of config.otherItems) {
    lines.push(`### ${item.name}`, "");
    lines.push(`#### 名称: ${item.name}`, "");
    for (const detail of item.details) {
      if (detail.title === "名称") continue;
      lines.push(`#### ${detail.title}: ${detail.value}`, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * 配置里与「钱」有关的可比较部分（导出回读校验、以及"库里这份与内容文件一致吗"都要用它）。
 *
 * 忽略两样东西，理由是同一条：**它们在内容文件里根本没有写法**，是后台专属的**关联**
 * （不是钱的一部分）。比进去会让"明明一样"的两份配置永远不相等：
 *
 *   - `courseId`（课程 ↔ 课程库那条关联）：Markdown 只写「课程名: 价格」；
 *   - `classTypes[].formatId`（班型 ↔ 课程类型那条关联）：Markdown 只写「名称 / 系数」，
 *     而读的时候 `syncClassTypes` 会按名字再认一次。
 *
 * 其余（价格、开放状态、人数系数、时长、规则、分成、试课、其他项目）**一个不漏**：
 * 漏掉哪个，导出到内容文件时那个字段丢了都不会有人知道。
 */
export function pricingConfigCore(config: PricingConfig): string {
  return JSON.stringify({
    rules: config.rules,
    teacherShare: config.teacherShare,
    stages: config.stages.map((stage) => ({
      name: stage.name,
      courses: stage.courses.map((course) => ({
        name: course.name,
        basePrice: course.basePrice,
        available: course.available,
      })),
    })),
    classTypes: config.classTypes.map((classType) => ({
      name: classType.name,
      mode: classType.mode,
      coefficient: classType.coefficient,
    })),
    durations: config.durations,
    trial: config.trial,
    otherItems: config.otherItems,
  });
}

/** 默认规则（老数据 / 兜底）。 */
export const FALLBACK_RULES: PricingRules = DEFAULT_PRICING_RULES;

/* ── 六、课程库 ↔ 报价配置 的关联 ───────────────────────────────────── */

/**
 * 报价配置里一门课程的关联状态（课程库页面用来显示「已定价 / 未定价」）。
 *
 * ⚠️ 这里以前还有一个 `dangling`（注释写的是"关联已失效：课程库里没有这门课了，
 * 但配置里还留着名字"）—— 它**从来没被任何界面读过**，而且算出来恒等于 `!priced`
 * （"课程库里有这门课、但报价配置里没有它的行"）。2026-09 机构把口径改成
 * **"课程库里没有的课，报价配置里那一行直接删掉"**（见 `syncLibraryLinks` 与
 * `prunePricingOrphans`）之后，那个字段想表达的那种行**已经不可能存在**，
 * 于是整个删掉 —— 而不是留一个永远 false 的字段让人猜它为什么没用。
 * 要表达"这门课还没定价"，用 `priced`。
 */
export type LibraryPricingStatus = {
  courseId: string;
  name: string;
  /** 已在报价配置里的阶段名；未定价时为空串。 */
  stageName: string;
  /** 基础价；未定价或未开放时为 null。 */
  basePrice: number | null;
  /** 是否已经在报价配置里（含暂未开放）。 */
  priced: boolean;
};

/**
 * 报价配置里**课程库里已经不存在的行**（要删掉的那些）。
 *
 * ## 判据只有一条：这一行**挂过** `courseId`，而库里没有这个 id 了
 *
 * 刻意**不**按名字判：没挂过 id 的行（内容文件里手写的老课包名，例如早年的「九年级课本」）
 * 既不是"被删掉的课"，也不该由一次同步来替机构决定删它 —— 那种行原样留着。
 * 「挂过 id」才是"它确实对应过课程库里的一门课、而那门课现在没了"的证据。
 *
 * 为什么单独一个函数：它有两个调用者，判据必须只有一处 ——
 *   1. `syncLibraryLinks`（机构在台账里删了一门课的那一刻）；
 *   2. `api.ts` 迁移链末尾的**收尾归一**（老库 / 导入进来的库里的残行）。
 *
 * ## 为什么连"空掉的阶段"一起删
 *
 * 删掉一门课之后，它所在的阶段可能一门课都不剩（例如机构把某个学段下的课全删了）。
 * 而 `validatePricingConfig` 有一条硬规则：「X」阶段下没有任何课程 → **非法**。
 * 留着会把库带进一个"读得出来、但下一次保存报价必然被拒"的死角
 * （机构打开报价页会看到"这个阶段下没有任何课程"，而那一页并没有删阶段的操作）。
 * 因此空阶段跟着一起删，并把它写进变更说明。
 */
export function prunePricingOrphans(
  config: PricingConfig,
  courses: ReadonlyArray<{ id: string }>,
): {
  config: PricingConfig;
  /** 被删掉的行（阶段名 + 课程名，按原顺序）。 */
  dropped: Array<{ stage: string; name: string }>;
  /** 删完之后一门课都不剩、因此一起删掉的阶段名。 */
  droppedStages: string[];
} {
  const courseIds = new Set(courses.map((course) => course.id));
  const next = JSON.parse(JSON.stringify(config)) as PricingConfig;
  const dropped: Array<{ stage: string; name: string }> = [];
  const droppedStages: string[] = [];

  const stages: PricingStage[] = [];
  for (const stage of next.stages) {
    const kept = stage.courses.filter((course) => {
      const linkedTo = course.courseId ?? "";
      if (linkedTo === "" || courseIds.has(linkedTo)) return true;
      dropped.push({ stage: stage.name, name: course.name });
      return false;
    });
    if (kept.length === 0 && stage.courses.length > 0) droppedStages.push(stage.name);
    stages.push({ ...stage, courses: kept });
  }
  next.stages = stages.filter((stage) => stage.courses.length > 0);
  return { config: next, dropped, droppedStages };
}

/** 在配置里按 id 或名字找一门课程。 */
function findPricingCourse(
  config: PricingConfig,
  target: { courseId?: string; name: string },
): { stage: PricingStage; course: PricingCourse } | null {
  for (const stage of config.stages) {
    for (const course of stage.courses) {
      if (target.courseId !== undefined && target.courseId !== "" && course.courseId === target.courseId) {
        return { stage, course };
      }
      if (course.name === target.name) return { stage, course };
    }
  }
  return null;
}

/** 每个课程库课程的定价状态（课程库页面用）。 */
export function pricingStatusForCourses(
  config: PricingConfig,
  courses: Array<{ id: string; name: string }>,
): LibraryPricingStatus[] {
  return courses.map((course) => {
    const found = findPricingCourse(config, { courseId: course.id, name: course.name });
    return {
      courseId: course.id,
      name: course.name,
      stageName: found?.stage.name ?? "",
      basePrice: found?.course.basePrice ?? null,
      priced: found !== null,
    };
  });
}

/** 把课程库里的一门课加进报价配置（指定阶段与基础价）。 */
export function addLibraryCourseToPricing(
  config: PricingConfig,
  input: { courseId: string; name: string; stageName: string; basePrice: number; available?: boolean },
): { config: PricingConfig; createdStage: boolean } {
  const next = JSON.parse(JSON.stringify(config)) as PricingConfig;
  let stage = next.stages.find((item) => item.name === input.stageName);
  let createdStage = false;
  if (stage === undefined) {
    stage = { name: input.stageName, courses: [] };
    next.stages.push(stage);
    createdStage = true;
  }

  const existing = findPricingCourse(next, { courseId: input.courseId, name: input.name });
  if (existing !== null) {
    // 已经配过：只更新价格与关联，不重复添加
    existing.course.basePrice = input.basePrice;
    existing.course.available = input.available ?? true;
    existing.course.courseId = input.courseId;
    return { config: next, createdStage };
  }

  stage.courses.push({
    name: input.name,
    basePrice: input.basePrice,
    available: input.available ?? true,
    courseId: input.courseId,
  });
  return { config: next, createdStage };
}

/**
 * 让报价配置跟着课程库走（服务层在课程改名 / 改状态 / 删除后调用）。
 *
 * 做四件事，都是为了让两边不会悄悄分叉：
 *   1. **按名字认领**：配置里已经有一门同名课程（网站内容带过来的，没有 courseId）→ 补上关联；
 *   2. **改名跟随**：课程库改了名字，配置里也跟着改（否则家长看到的还是旧名字）；
 *   3. **停开跟随**：课程库里设为「暂未开放」→ 配置里也置为不可报价；重新开放则恢复；
 *   4. **删掉跟随**：课程库里**没有这门课了** → 配置里那一行**删掉**（连同空掉的阶段）。
 *
 * ## 第 4 件改过一次口径（2026-09，机构原话）
 *
 * > 「**课程报价里面删掉的课还是会出现**，这部分也要根据后台数据实时更新」
 *
 * 原先定的是「**不静默删除**：置成暂未开放、名字留着，让机构自己决定去留」
 * （当年 v25 那轮的口径，写进过不少断言与文档）。它的后果就是机构看到的那个：
 * 他们把「高考冲刺」「特殊计划专项」从课程库里删了，报价页上那两门课**还列着**
 * （显示"暂未开放"，家长选中它只会得到一句"暂未开放"）。而机构的口径早就说清了
 * 两次：「课程全都按照课程库里的来，课程库以外的全部都应该删掉」。因此改成**删掉**。
 *
 * 安全性来自另一道护栏：**真正还在被用的课本来就删不掉**
 * （`courseDeleteRefusal`：被报课 / 排课引用着 → 拒绝删除）。能删掉的课 =
 * 没有被任何单据引用，因此报价那一行也可以安全移除。
 *
 * 返回变更说明（服务层拿去写操作日志），没有变更时是空数组。
 */
export function syncLibraryLinks(
  config: PricingConfig,
  courses: Array<{ id: string; name: string; status: string }>,
): { config: PricingConfig; changes: string[]; linkOnly: boolean } {
  /*
   * `linkOnly`：这次同步**只补了关联**（没有改任何价格 / 名字 / 开放状态）。
   *
   * 为什么要单独告诉调用方：`syncPricingWithCourses` 会把配置的来源标成"后台修改"，
   * 而"补一条 `courseId`"不是机构改过价 —— 标成后台修改之后，报价页上那句
   * "这份配置来自站点内容"就变成了假话（自检里两条断言当场抓住了这件事：
   * 「种子报价配置来自站点内容」与「拒绝后库里的配置没被改动」）。
   * 关联本身仍然值得写日志（谁认领了谁），但它不该改变"这份价是谁定的"。
   *
   * ⚠️ 删掉残行**算**实质变更（`nonLinkChanges`）：那一行连同价格一起没了，
   * 机构看到的报价表少了一门课，这必须改变"这份配置的来源与修改时间"。
   */
  let nonLinkChanges = 0;
  const byId = new Map(courses.map((course) => [course.id, course]));
  const byName = new Map(courses.map((course) => [course.name, course]));
  const changes: string[] = [];

  /* ① 先删残行（课程库里已经没有的那些课）——判据见 `prunePricingOrphans`。 */
  const pruned = prunePricingOrphans(config, courses);
  const next = pruned.config;
  for (const row of pruned.dropped) {
    nonLinkChanges += 1;
    changes.push(`「${row.name}」在课程库里已不存在 → 报价配置里已删除这一行`);
  }
  for (const stageName of pruned.droppedStages) {
    changes.push(`「${stageName}」阶段下已经没有课程 → 一起删掉这一组`);
  }

  for (const stage of next.stages) {
    for (const course of stage.courses) {
      const linked = course.courseId !== undefined && course.courseId !== ""
        ? byId.get(course.courseId)
        : byName.get(course.name);

      if (linked === undefined) {
        /*
         * 走到这里说明这一行**从来没挂过课程库的课**（`courseId` 是空的）、名字也对不上
         * ——例如内容文件里手写的老课包名（早年的「九年级课本」）。
         * 它不是"被删掉的课"，也不该由一次同步来替机构决定删它，因此原样留着；
         * 真正要处理的那种（挂过 id、而 id 没了）已经在上面 `prunePricingOrphans` 里删掉了。
         */
        continue;
      }

      if (course.courseId !== linked.id) {
        course.courseId = linked.id;
        changes.push(`「${course.name}」与课程库建立关联`);
      }
      if (course.name !== linked.name) {
        changes.push(`课程名跟随课程库：「${course.name}」→「${linked.name}」`);
        course.name = linked.name;
        nonLinkChanges += 1;
      }
      const shouldBeAvailable = linked.status === "开放";
      if (course.available !== shouldBeAvailable && course.basePrice !== null) {
        course.available = shouldBeAvailable;
        nonLinkChanges += 1;
        changes.push(
          shouldBeAvailable
            ? `「${linked.name}」恢复为可报价`
            : `「${linked.name}」在课程库里设为暂未开放 → 报价配置同步停用`,
        );
      }
    }
  }

  return { config: next, changes, linkOnly: changes.length > 0 && nonLinkChanges === 0 };
}
