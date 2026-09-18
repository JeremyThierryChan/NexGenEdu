import { pricingSource } from "@/data/site/pricing";
import { parseDocument, type PageBlock, type Section } from "@/lib/data/content";

/**
 * 报价页数据：读取 data/site/pricing.md。
 *
 * 与 content.md 使用同一套结构（标题层级即数据结构）：
 *
 *   ## 页面: 智能报价
 *   ## 学习阶段             ← 分组
 *   ### 小学                ← 阶段（分组下的子节）
 *   #### 课程: 小学课内: 150  ← 条目名「课程」，值为「课程名: 基础价」
 *   #### 科目: 语文、数学     ← 条目名「科目」，值为科目清单
 *
 * 字段值写「暂未开放」时视为不可选（页面上显示但禁选）。
 */

/**
 * 表示「暂未开放」的标记。
 *
 * 导出的原因：后台「导出报价配置」要写出同样的写法，
 * 两边各写一份字符串迟早会有一边写错（写成「未开放」就静默变成有价格了）。
 */
export const UNAVAILABLE_PRICE_LABEL = "暂未开放";

/** 学习阶段下的一个课程（含基础价，单位：元 / 节）。 */
export type StageCourse = {
  name: string;
  /** 基础价；不可选时为 null。 */
  price: number | null;
  available: boolean;
};

/** 学习阶段（小学 / 初中阶段 / …）。 */
export type PricingStage = {
  name: string;
  courses: StageCourse[];
  /** 该阶段是否至少有一个可选课程。 */
  available: boolean;
};

/** 某个阶段下可选的科目。 */
export type SubjectOption = {
  name: string;
  available: boolean;
  /** 科目系数，未配置时为 1。 */
  coefficient: number;
};

/** 科目分组：阶段 → 科目列表。 */
export type SubjectGroup = {
  name: string;
  subjects: SubjectOption[];
};

/** 班级类型的计价方式。 */
export type ClassPricingMode = "coefficient" | "cost-share";

/** 班级类型（一对一 / 一对二 / 班课…）。 */
export type ClassType = {
  name: string;
  available: boolean;
  mode: ClassPricingMode;
  /** coefficient 模式下的系数；cost-share 模式为 null。 */
  coefficient: number | null;
};

/** 每节课的时长选项。 */
export type LessonDuration = {
  name: string;
  /** 时长（小时）。 */
  hours: number;
  /** 价格乘数，1 小时为基准 1.0。 */
  multiplier: number;
};

/** 试课：独立的体验产品，不参与课时公式。 */
export type TrialLesson = {
  name: string;
  /** 价格显示文字，例如「免费」。 */
  priceLabel: string;
};

/**
 * 计费规则：公式里那两个「不该写死在代码里」的数字。
 *
 * 它们原本硬编码在 lib/pricing/quote.ts 里。放进内容 / 后台之后，
 * 调规则（例如手续费从 10% 改成 15%）不需要改代码、不需要重新构建。
 */
export type PricingRules = {
  /** 只报 1 节时加收的手续费百分比（报 2 节及以上不加收）。 */
  singleLessonFeePercent: number;
  /** 试课后报课达到该节数，试课免费。 */
  freeTrialMinLessons: number;
  /** 试课未达门槛时，是否按课程原价收 1 节试课费。 */
  chargeTrialWhenNotFree: boolean;
};

/** 其他项目（按学期 / 按期的独立产品）。 */
export type OtherItem = {
  name: string;
  details: Array<{ title: string; value: string }>;
};

export type PricingData = {
  labels: {
    result: string;
    submit: string;
    reset: string;
    unitPriceLabel: string;
    unit: string;
    totalLabel: string;
    formulaNote: string;
    calculatorTitle: string;
    calculatorHint: string;
    otherTitle: string;
    lessonsLabel: string;
    lessonsHint: string;
    durationLabel: string;
    classSizeLabel: string;
    classCostLabel: string;
    classCostHint: string;
  };
  stages: PricingStage[];
  subjectGroups: SubjectGroup[];
  classTypes: ClassType[];
  durations: LessonDuration[];
  /** 计费规则（手续费 / 试课免费门槛）。 */
  rules: PricingRules;
  trial: TrialLesson | null;
  otherItems: OtherItem[];
};

/** 字段值是否表示可选（「暂未开放」或缺失即不可选）。 */
function toAvailability(value: string | undefined): boolean {
  return value === undefined || value.trim() !== UNAVAILABLE_PRICE_LABEL;
}

/** 空节：内容里没有这个分组时用它兜底，避免到处判空。 */
function emptySection(name: string): Section {
  return { name, note: "", fields: [], items: [], body: "", children: [] };
}

/** 取节内某个条目名对应的第一个值。 */
function itemValue(section: Section, title: string): string | undefined {
  return section.items.find((item) => item.title === title)?.value;
}

/** 解析数字；不可解析时返回 fallback。 */
function toNumber(value: string | undefined, fallback: number | null = null): number | null {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 从「课程名: 基础价」里拆出课程名与价格文字。 */
function parseCourse(raw: string): { name: string; priceLabel: string } {
  const colon = raw.search(/[:：]/);
  if (colon === -1) return { name: raw.trim(), priceLabel: "" };
  return { name: raw.slice(0, colon).trim(), priceLabel: raw.slice(colon + 1).trim() };
}

/**
 * 解析一个科目项。
 *
 * 写法有两种，都支持：
 *
 *   - `语文`          → 系数 1（不加价，绝大多数科目的情况）
 *   - `物理 ×1.1`     → 系数 1.1（该科目单独加价）
 *
 * 用「×」而不是单独一列，是为了让内容文件继续像一份价目表 —— 科目多起来
 * 之后，一眼能看出哪个科目贵、贵多少。系数省略时按 1 计，老内容不用改。
 */
function parseSubject(token: string): SubjectOption | null {
  if (token === "") return null;
  const match = /^(.*?)\s*[×xX*]\s*([0-9]+(?:\.[0-9]+)?)$/.exec(token);
  if (match === null) return { name: token, available: true, coefficient: 1 };
  const name = (match[1] ?? "").trim();
  const coefficient = toNumber(match[2], 1) ?? 1;
  if (name === "") return null;
  return { name, available: true, coefficient };
}

/** 解析班级类型。系数不是数字（如「按人数分摊」）时使用 cost-share 模式。 */
function toClassTypes(sections: Section[]): ClassType[] {
  return sections
    .map((section) => {
      const raw = itemValue(section, "系数") ?? "";
      const coefficient = toNumber(raw, null);
      return {
        name: itemValue(section, "名称") ?? section.name,
        available: toAvailability(raw),
        mode: coefficient === null ? ("cost-share" as const) : ("coefficient" as const),
        coefficient,
      };
    })
    .filter((item) => item.available);
}

/** 解析课时选择（每节课时长）。 */
function toDurations(sections: Section[]): LessonDuration[] {
  return sections.map((section) => {
    // 未配置乘数时按小时数计算
    const hours = toNumber(itemValue(section, "小时"), 1) ?? 1;
    return {
      name: itemValue(section, "名称") ?? section.name,
      hours,
      multiplier: toNumber(itemValue(section, "乘数"), hours) ?? hours,
    };
  });
}

/** 解析试课（独立产品）。 */
function toTrial(section: Section | undefined): TrialLesson | null {
  if (section === undefined) return null;
  return {
    name: itemValue(section, "名称") ?? section.name,
    priceLabel: itemValue(section, "价格") ?? "",
  };
}

/** 未在内容里配置计费规则时的默认值（与站点原有规则一致）。 */
export const DEFAULT_PRICING_RULES: PricingRules = {
  singleLessonFeePercent: 10,
  freeTrialMinLessons: 10,
  chargeTrialWhenNotFree: true,
};

/**
 * 解析计费规则。
 *
 * 内容里没有这一组（老内容文件）时用默认值，因此加这一组是**向后兼容**的：
 * 不会因为少了一段就把报价页打不开。
 */
function toRules(sections: Section[]): PricingRules {
  const find = (name: string): Section | undefined =>
    sections.find((section) => section.name === name);
  const percent = toNumber(itemValue(find("手续费") ?? emptySection("手续费"), "百分比"), null);
  const threshold = toNumber(itemValue(find("试课免费门槛") ?? emptySection("试课免费门槛"), "节数"), null);
  const text = itemValue(find("试课未达门槛") ?? emptySection("试课未达门槛"), "收费");
  return {
    singleLessonFeePercent:
      percent !== null && percent >= 0 && percent <= 100 ? percent : DEFAULT_PRICING_RULES.singleLessonFeePercent,
    freeTrialMinLessons:
      threshold !== null && Number.isInteger(threshold) && threshold >= 1
        ? threshold
        : DEFAULT_PRICING_RULES.freeTrialMinLessons,
    chargeTrialWhenNotFree:
      text === undefined
        ? DEFAULT_PRICING_RULES.chargeTrialWhenNotFree
        : !["否", "不收费", "免费"].includes(text.trim()),
  };
}

/** 解析其他项目。 */
function toOtherItems(sections: Section[]): OtherItem[] {
  return sections.map((section) => ({
    name: itemValue(section, "名称") ?? section.name,
    details: section.items
      .filter((item) => item.title !== "名称")
      .map((item) => ({ title: item.title, value: item.value })),
  }));
}

/**
 * 解析一份报价内容（Markdown 源码）。
 *
 * 之所以接收源码而不是直接读 data/site/pricing.ts：
 *   - 后台「导出报价配置」生成的 Markdown 可以用这里回读校验（见 npm run check），
 *     保证导出的是**能用的内容**，而不是一段看起来像的文本；
 *   - 将来内容来自接口时，只要把源码传进来即可。
 */
export function parsePricingSource(source: string): PricingData {
  const page: PageBlock | undefined = parseDocument(source).pages.get("智能报价");
  if (page === undefined) {
    throw new Error("data/site/pricing.md 中缺少「## 页面: 智能报价」段落。");
  }

  const field = (key: string): string =>
    typeof page.data[key] === "string" ? (page.data[key] as string) : "";

  const named = (name: string): Section =>
    page.groups.find((group) => group.name === name) ?? emptySection(name);

  // 阶段与科目都写在 `## 学习阶段` 的子节里
  const stages: PricingStage[] = [];
  const subjectGroups: SubjectGroup[] = [];

  for (const stage of named("学习阶段").children) {
    const courseEntries = stage.items.filter((item) => item.title === "课程");
    const subjectEntries = stage.items.filter((item) => item.title === "科目");

    stages.push({
      name: stage.name,
      available: courseEntries.some(
        (item) => toAvailability(parseCourse(item.value).priceLabel),
      ),
      courses: courseEntries.map((item) => {
        const { name, priceLabel } = parseCourse(item.value);
        const available = toAvailability(priceLabel);
        return { name, price: available ? toNumber(priceLabel) : null, available };
      }),
    });

    const subjects: SubjectOption[] = [];
    for (const entry of subjectEntries) {
      for (const token of entry.value.split(/[、,，|]/).map((x) => x.trim())) {
        const subject = parseSubject(token);
        if (subject !== null) subjects.push(subject);
      }
    }
    if (subjects.length > 0) {
      subjectGroups.push({ name: stage.name, subjects });
    }
  }

  return {
    labels: {
      result: field("result_title"),
      submit: field("submit_label"),
      reset: field("reset_label"),
      unitPriceLabel: field("unit_price_label"),
      unit: field("unit_label"),
      totalLabel: field("total_label"),
      formulaNote: field("formula_note"),
      calculatorTitle: field("calculator_title"),
      calculatorHint: field("calculator_hint"),
      otherTitle: field("other_title"),
      lessonsLabel: field("lessons_label"),
      lessonsHint: field("lessons_hint"),
      durationLabel: field("duration_label"),
      classSizeLabel: field("class_size_label"),
      classCostLabel: field("class_cost_label"),
      classCostHint: field("class_cost_hint"),
    },
    stages,
    subjectGroups,
    classTypes: toClassTypes(named("班级类型").children),
    durations: toDurations(named("课时选择").children),
    rules: toRules(named("计费规则").children),
    trial: toTrial(named("试课").children[0]),
    otherItems: toOtherItems(named("其他项目").children),
  };
}

/**
 * 报价页数据（站点内容）。
 *
 * 页面与后台公式都从这里取，**只有一份**取值逻辑：
 * 后台改价用的是 lib/backend/pricing.ts 里的配置（首次由这份内容初始化）。
 */
export function getPricingData(): PricingData {
  return parsePricingSource(pricingSource);
}
