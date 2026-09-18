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
 * | 课程 | `basePrice` | **一对一、1 小时、报 2 节及以上**的价格（元 / 节），所有换算的基准 | 分阶段设定 |
 * | 科目 | `subject.coefficient` | 同一阶段内不同科目的师资/难度差异 | 1.0（不加价） |
 * | 班级 | `classType.coefficient` | 人越多每人越便宜 | 一对二 0.7、一对三 0.6、一对多 0.5 |
 * | 时长 | `duration.multiplier` | 一节课上多久 | 1 小时 1.0、1.5 小时 1.5、2 小时 2.0 |
 * | 手续费 | `rules.singleLessonFeePercent` | 只报 1 节时加收（一次课不划算） | 10% |
 * | 试课 | `rules.freeTrialMinLessons` | 报满多少节后试课免费，否则按原价收 1 节 | 10 节 |
 *
 * 两个例外，都不是「乘系数」：
 *
 *   - **班课（9-20 人）**：按「教师课时总费用 ÷ 班级人数」分摊，不用班级系数；
 *   - **试课费**：永远按**课程基础价原价**收，不带科目系数、班级系数、时长与手续费
 *     （试课是单独产品，不是正课的折扣价）。
 *
 * 计算顺序（改动这里等于改价，务必同步 `npm run check` 里的用例）：
 *
 *   1. 课时价 = 基础价 × 科目系数 × 班级系数       （班课：教师费用 ÷ 人数）
 *   2. 课时价 ×= 时长乘数
 *   3. 课时价 ×= (1 + 手续费百分比)
 *   4. 正课总价 = 课时价 × 节数
 *   5. 总价 = 正课总价 + 试课费
 */

import { pricingSource } from "@/data/site/pricing";
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
  type SubjectOption,
} from "@/lib/data/pricing";

export type { PricingRules };

/* ── 一、配置：后台可改的那份数据 ─────────────────────────────────────── */

/** 一门课程：名字 + 基础价（元 / 节）。 */
export type PricingCourse = {
  name: string;
  /** 基础价；null 表示暂未开放（不可选、不可报价）。 */
  basePrice: number | null;
  available: boolean;
};

/** 一个学习阶段（小学 / 初中阶段 / …）及其课程。 */
export type PricingStage = {
  name: string;
  courses: PricingCourse[];
};

/** 某阶段下的一个科目及其系数。 */
export type PricingSubject = {
  name: string;
  /** 所属阶段名；科目是分阶段定义的（小学的「英语」与高中的「英语」可以不同价）。 */
  stageName: string;
  coefficient: number;
};

/** 班级类型：系数模式 or 按人数分摊。 */
export type PricingClassType = {
  name: string;
  mode: ClassPricingMode;
  /** 系数模式下的系数；按人数分摊时为 null。 */
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
  stages: PricingStage[];
  subjects: PricingSubject[];
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

/** 计算过程中的一项明细，用于解释价格构成。 */
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

/** 试课费用：免费时 0，否则按课程原价（不含科目系数、班级系数、时长与手续费）计。 */
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
  rules: PricingRules,
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
 * 报价请求：页面只发「选了哪个课程 / 哪个科目 / 哪个班型 / 多少节」。
 *
 * 刻意不发价格：价格由服务端（这里是伪后端）自己查，
 * 否则前端改个数字就能改价，转真后端时这是必须堵住的口子。
 */
export type QuoteSelection = {
  courseName: string;
  /** 科目名；该阶段没有科目概念时省略。 */
  subjectName?: string;
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
  let stage: PricingStage | undefined;
  for (const item of config.stages) {
    const found = item.courses.find((entry) => entry.name === selection.courseName);
    if (found !== undefined) {
      course = found;
      stage = item;
      break;
    }
  }
  if (course === undefined || stage === undefined) {
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

  let subjectOption: SubjectOption | null = null;
  if (selection.subjectName !== undefined && selection.subjectName !== "") {
    const subject = config.subjects.find(
      (item) => item.stageName === stage.name && item.name === selection.subjectName,
    );
    if (subject === undefined) {
      return {
        ok: false,
        reason: `${stage.name}里没有科目「${selection.subjectName}」。`,
      };
    }
    subjectOption = { name: subject.name, available: true, coefficient: subject.coefficient };
  }

  return {
    ok: true,
    input: {
      course: { name: course.name, price: course.basePrice, available: course.available },
      subject: subjectOption,
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

  const subjectKeys = new Set<string>();
  for (const subject of config.subjects) {
    if (!Number.isFinite(subject.coefficient) || subject.coefficient <= 0) {
      problems.push(`科目「${subject.name}」的系数必须大于 0。`);
    }
    if (!config.stages.some((stage) => stage.name === subject.stageName)) {
      problems.push(`科目「${subject.name}」挂在不存在的学习阶段「${subject.stageName}」上。`);
    }
    const key = `${subject.stageName}/${subject.name}`;
    if (subjectKeys.has(key)) problems.push(`「${subject.stageName}」里的科目「${subject.name}」重复了。`);
    subjectKeys.add(key);
  }

  const classTypeNames = new Set<string>();
  for (const classType of config.classTypes) {
    if (classType.name.trim() === "") {
      problems.push("存在没有名字的班型。");
      continue;
    }
    if (classTypeNames.has(classType.name)) problems.push(`班型「${classType.name}」重复了。`);
    classTypeNames.add(classType.name);
    if (classType.mode === "coefficient") {
      if (!Number.isFinite(classType.coefficient) || (classType.coefficient ?? 0) <= 0) {
        problems.push(`班型「${classType.name}」的系数必须大于 0。`);
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
    stages: data.stages.map((stage) => ({
      name: stage.name,
      courses: stage.courses.map((course) => ({
        name: course.name,
        basePrice: course.price,
        available: course.available,
      })),
    })),
    subjects: data.subjectGroups.flatMap((group) =>
      group.subjects.map((subject) => ({
        name: subject.name,
        stageName: group.name,
        coefficient: subject.coefficient,
      })),
    ),
    classTypes: data.classTypes.map((classType) => ({
      name: classType.name,
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
    const subjects = config.subjects.filter((subject) => subject.stageName === stage.name);
    if (subjects.length > 0) {
      const text = subjects
        .map((subject) =>
          subject.coefficient === 1 ? subject.name : `${subject.name} ×${subject.coefficient}`,
        )
        .join("、");
      lines.push(`#### 科目: ${text}`, "");
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

/** 配置里与「钱」有关的可比较部分（导出回读校验用，忽略来源与时间）。 */
export function pricingConfigCore(config: PricingConfig): string {
  return JSON.stringify({
    rules: config.rules,
    stages: config.stages,
    subjects: config.subjects,
    classTypes: config.classTypes,
    durations: config.durations,
    trial: config.trial,
    otherItems: config.otherItems,
  });
}

/** 默认规则（老数据 / 兜底）。 */
export const FALLBACK_RULES: PricingRules = DEFAULT_PRICING_RULES;
