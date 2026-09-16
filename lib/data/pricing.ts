import { pricingSource } from "@/data/site/pricing";
import { parseDocument, type Group, type PageBlock } from "@/lib/data/content";

/**
 * 报价页数据：读取 data/site/pricing.md。
 *
 * 与 content.md 使用同一套结构（`## 分组` / `### 条目` / `#### 字段: 值`），
 * 单独成文件是因为报价选项与价格会独立调整。
 *
 * 字段值写「暂未开放」时视为不可选（页面上显示但禁选）。
 */

/** 表示「暂未开放」的标记，数据文件里直接写这个值。 */
const UNAVAILABLE = "暂未开放";

/** 学习阶段下的一个课程（含基础价，单位：元 / 课时）。 */
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

/** 其他项目（按学期 / 按期的独立产品）。 */
export type OtherItem = {
  name: string;
  /** 明细，例如「小学: 6000 / 学期 / 人」。 */
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
  /** 学习阶段（含各课程基础价）。 */
  stages: PricingStage[];
  /** 科目分组，与 stages 同名对应。 */
  subjectGroups: SubjectGroup[];
  classTypes: ClassType[];
  durations: LessonDuration[];
  trial: TrialLesson | null;
  otherItems: OtherItem[];
};

/** 字段值是否表示可选（「暂未开放」或缺失即不可选）。 */
function toAvailability(value: string | undefined): boolean {
  return value === undefined || value.trim() !== UNAVAILABLE;
}

/** 取分组内某个字段的值。 */
function groupField(group: Group, title: string): string | undefined {
  return group.items.find((item) => item.title === title)?.value;
}

/** 解析数字；不可解析时返回 fallback。 */
function toNumber(value: string | undefined, fallback: number | null = null): number | null {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 把分组里的字段条目解析成「选项」。
 *
 * 数据文件里选项的写法是 `#### 选项名: 值`：
 * 字段名即选项名，字段值即价格（或「暂未开放」）。
 */
function toOptions(group: Group): Array<{ name: string; value: string }> {
  return group.items.map((item) => ({ name: item.title, value: item.value }));
}

/** 解析学习阶段：阶段 → 课程 → 基础价。 */
function toStages(groups: Group[]): PricingStage[] {
  return groups.map((stage) => ({
    name: stage.name,
    courses: toOptions(stage).map((option) => {
      const available = toAvailability(option.value);
      return {
        name: option.name,
        price: available ? toNumber(option.value) : null,
        available,
      };
    }),
  })).map((stage) => ({
    ...stage,
    available: stage.courses.some((course) => course.available),
  }));
}

/** 解析科目分组。科目系数写成「<科目名>系数: 1.2」，未配置时按 1 计算。 */
function toSubjectGroups(groups: Group[]): SubjectGroup[] {
  return groups.map((group) => {
    const coefficientOf = (subjectName: string): number =>
      toNumber(groupField(group, `${subjectName}系数`), null) ??
      toNumber(groupField(group, "系数"), null) ??
      1;

    const subjects = toOptions(group)
      .filter((option) => !option.name.endsWith("系数") && option.name !== "系数")
      .map((option) => ({
        name: option.name,
        available: toAvailability(option.value),
        coefficient: coefficientOf(option.name),
      }));

    return { name: group.name, subjects };
  });
}

/** 解析班级类型。系数不是数字（如「按人数分摊」）时使用 cost-share 模式。 */
function toClassTypes(groups: Group[]): ClassType[] {
  return groups
    .map((group) => {
      const raw = groupField(group, "系数") ?? "";
      const coefficient = toNumber(raw, null);
      return {
        name: groupField(group, "名称") ?? group.name,
        available: toAvailability(raw),
        mode: coefficient === null ? ("cost-share" as const) : ("coefficient" as const),
        coefficient,
      };
    })
    .filter((item) => item.available);
}

/** 解析课时选择（每节课时长）。 */
function toDurations(groups: Group[]): LessonDuration[] {
  return groups.map((group) => {
    // 未配置乘数时按小时数计算
    const hours = toNumber(groupField(group, "小时"), 1) ?? 1;
    return {
      name: groupField(group, "名称") ?? group.name,
      hours,
      multiplier: toNumber(groupField(group, "乘数"), hours) ?? hours,
    };
  });
}

/** 解析试课（独立产品，取第一个分组）。 */
function toTrial(group: Group | undefined): TrialLesson | null {
  if (group === undefined) return null;
  return {
    name: groupField(group, "名称") ?? group.name,
    priceLabel: groupField(group, "价格") ?? "",
  };
}

/** 解析其他项目。 */
function toOtherItems(groups: Group[]): OtherItem[] {
  return groups.map((group) => ({
    name: groupField(group, "名称") ?? group.name,
    details: group.items
      .filter((item) => item.title !== "名称")
      .map((item) => ({ title: item.title, value: item.value })),
  }));
}

export function getPricingData(): PricingData {
  const page: PageBlock | undefined = parseDocument(pricingSource).pages.get("智能报价");
  if (page === undefined) {
    throw new Error("data/site/pricing.md 中缺少「## 页面: 智能报价」段落。");
  }

  const field = (key: string): string =>
    typeof page.data[key] === "string" ? (page.data[key] as string) : "";

  const named = (name: string): Group =>
    page.groups.find((group) => group.name === name) ?? {
      name,
      note: "",
      items: [],
      body: "",
      children: [],
    };

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
    stages: toStages(named("学习阶段").children),
    subjectGroups: toSubjectGroups(named("科目").children),
    classTypes: toClassTypes(named("班级类型").children),
    durations: toDurations(named("课时选择").children),
    trial: toTrial(named("试课").children[0]),
    otherItems: toOtherItems(named("其他项目").children),
  };
}
