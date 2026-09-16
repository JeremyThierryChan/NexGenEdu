import { pricingSource } from "@/data/site/pricing";
import { parseDocument, type Group, type PageBlock } from "@/lib/data/content";

/**
 * 报价页面数据：读取 data/site/pricing.md。
 *
 * 与 content.md 使用同一套结构（## 页面 / ### 分组 / #### 名称: 值），
 * 单独成文件是因为报价选项与价格会独立调整，混在 content.md 里不好找。
 */

/** 一个可选项：科目 / 学习阶段 / 开班人数。 */
export type PricingOption = {
  /** 选项名称，直接显示在下拉菜单里。 */
  name: string;
  /** 价格数值，含义由用途决定（见 pricing.md 的字段说明）。 */
  price: number;
};

export type PricingOptions = {
  /** 分组标题，用于下拉框的 label。 */
  labels: {
    subject: string;
    stage: string;
    classSize: string;
    result: string;
    submit: string;
    reset: string;
  };
  subjects: PricingOption[];
  stages: PricingOption[];
  classSizes: PricingOption[];
  /** 公式说明，显示在结果区，提醒报价为估算。 */
  formulaNote: string;
};

/** 从分组中读取「名称 / 基础价」两个条目。缺基础价时按 0 处理。 */
function toOptions(groups: Group[]): PricingOption[] {
  const options: PricingOption[] = [];
  for (const group of groups) {
    const name = group.items.find((item) => item.title === "名称")?.value?.trim() ?? "";
    if (name === "") continue;
    const rawPrice = group.items.find((item) => item.title === "基础价")?.value ?? "";
    const price = Number.parseFloat(rawPrice);
    options.push({ name, price: Number.isFinite(price) ? price : 0 });
  }
  return options;
}

/**
 * 取某个分组的可选项。
 *
 * 分组可能是二层结构（`## 科目` → `### 科目：数学`），
 * 也可能直接就是条目列表，因此两种都支持。
 */
function optionGroups(page: PageBlock, name: string): Group[] {
  const parent = groupNamed(page, name);
  if (parent.children.length > 0) return parent.children;
  // 退一步：若分组本身没有子分组，就扫描所有分组找带「名称」条目的那些
  return page.groups.filter((group) =>
    group.items.some((item) => item.title === "名称"),
  );
}

/** 按分组的名称取该分组。 */
function groupNamed(page: PageBlock, name: string): Group {
  return (
    page.groups.find((group) => group.name === name) ?? {
      name,
      note: "",
      items: [],
      body: "",
      children: [],
    }
  );
}

export function getPricingOptions(): PricingOptions {
  const page = parseDocument(pricingSource).pages.get("智能报价");
  if (page === undefined) {
    throw new Error("data/site/pricing.md 中缺少「## 页面: 智能报价」段落。");
  }

  const field = (key: string): string =>
    typeof page.data[key] === "string" ? (page.data[key] as string) : "";

  return {
    labels: {
      subject: field("subject_title"),
      stage: field("stage_title"),
      classSize: field("class_size_title"),
      result: field("result_title"),
      submit: field("submit_label"),
      reset: field("reset_label"),
    },
    subjects: toOptions(optionGroups(page, "科目")),
    stages: toOptions(optionGroups(page, "学习阶段")),
    classSizes: toOptions(optionGroups(page, "开班人数")),
    formulaNote: field("formula_note"),
  };
}
