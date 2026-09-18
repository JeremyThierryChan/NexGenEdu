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

/** 表示「暂未开放」的标记。 */
const UNAVAILABLE = "暂未开放";

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
  trial: TrialLesson | null;
  otherItems: OtherItem[];
};

/** 字段值是否表示可选（「暂未开放」或缺失即不可选）。 */
function toAvailability(value: string | undefined): boolean {
  return value === undefined || value.trim() !== UNAVAILABLE;
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

/** 解析其他项目。 */
function toOtherItems(sections: Section[]): OtherItem[] {
  return sections.map((section) => ({
    name: itemValue(section, "名称") ?? section.name,
    details: section.items
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

  const named = (name: string): Section =>
    page.groups.find((group) => group.name === name) ?? {
      name,
      note: "",
      fields: [],
      items: [],
      body: "",
      children: [],
    };

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
      for (const subjectName of entry.value.split(/[、,，|]/).map((x) => x.trim())) {
        if (subjectName !== "") {
          subjects.push({ name: subjectName, available: true, coefficient: 1 });
        }
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
    trial: toTrial(named("试课").children[0]),
    otherItems: toOtherItems(named("其他项目").children),
  };
}
