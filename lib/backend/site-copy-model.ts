/**
 * 「页面文案块」的模型与读取口径：**纯函数**（不读数据库、不读 Markdown）。
 *
 * ## 为什么需要它
 *
 * 宣传网站上剩下的这些块形状完全一样，都是「短字段（键 → 值）+ 若干分组（分组标题 + 条目）」：
 *
 * | 块 | 内容文件 | 短字段例子 | 分组例子 |
 * | --- | --- | --- | --- |
 * | 品牌与联系方式 | `content.md` 的「全站」 | `phone` / `address` / `brand_name` | （无） |
 * | 首页 | `content.md` 的「首页」 | `trial_title` / `cta_label` | 首屏数据 / 教学特色 / 教室照片格位 |
 * | 关于 | `content.md` 的「关于」 | `philosophy_title` / `service_title` | 服务形式 / 教学理念 / 校区数据 / 校区介绍 |
 * | 联系我们 | `content.md` 的「联系我们」 | `route_title` / `disabled_action_label` | 联系方式清单 |
 * | 时间安排 | `schedule.md` | `notice` | 各时段分组 |
 *
 * 五块各写一套类型 + 各写一套后台表单，就是五份要同步维护的东西。因此它们共用一个模型
 * （`SiteCopyBlock`）与一个读取接口（`CopySource`）。
 *
 * ## 关键设计：**两种来源共用一个读取接口**
 *
 * 同一块的视图模型（`SiteBrand` / `HomeContent` / …）有**两条来源**：
 *   1. **模版**：`data/site/*.md` 解析出来的 `PageBlock`；
 *   2. **库**：`siteContent.copy[key]`（后台可编辑）。
 *
 * 两处各写一遍字段映射（`pageString(page, "phone")` 与 `field(block, "phone")`）必然会漂 ——
 * "改了一边的字段名，另一边还在读老名字"，而且**没有任何断言会发现**（两边都返回空串）。
 * 因此这里定一个极小的读取接口 `CopySource`，映射函数只认它：
 *
 *   `brandFrom(source)` / `homeFrom(source)` / … —— **一份映射，两种来源**。
 *
 * 于是"两条来源产出同一份页面数据"这件事从**需要断言**变成了**结构上不可能不同**。
 *
 * ## `blank`（没连后端）时怎么处理
 *
 * 与其余各块同一条规则（见 `lib/data/site.ts` 文件头）：
 * **短字段与分组标题是骨架（保留，来自模版）；分组里的条目是内容（清空）**。
 * 因此 `blankBlock()` 只清 `groups[].items`，保留 `fields` 与每个分组的标题与说明。
 */
import type { PageBlock, Section } from "@/lib/data/content";
import type { SiteCopyBlock, SiteCopyGroup, SiteCopyItem, SiteCopyKey } from "./types";

/** 五块的键（顺序就是后台「网站内容」页里的展示顺序）。 */
export const SITE_COPY_KEYS = ["brand", "home", "about", "contact", "schedule"] as const;

/** 每块对应的内容文件页面名（导入时用；见 `lib/backend/site-copy.ts`）。 */
export const SITE_COPY_PAGES: Record<SiteCopyKey, string> = {
  brand: "全站",
  home: "首页",
  about: "关于",
  contact: "联系我们",
  schedule: "课程时间安排",
};

/**
 * 每块**属于自己**的分组名（导入与校对都按它过滤）。
 *
 * 为什么需要：内容文件是按**页面**组织的，而一个页面里的分组未必都属于这一块文案 ——
 * 「全站」页里除了品牌短字段，还有「课程栏目」（那是课程库的分区数据，见
 * `getCourseColumnsFromTemplate()`）。不过滤的话，品牌那一块会凭空多出 32 条课程卡片条目，
 * 后台的表单里也会冒出一个叫「课程栏目」的分组 —— 那是"搬错了东西"。
 *
 * `"all"` 表示这一块的分组是**列举型**的（时间安排：工作日 / 周末 / 晚辅导 / 全日托），
 * 页面把每一组都渲染出来，因此全都要。
 */
export const SITE_COPY_GROUPS: Record<SiteCopyKey, readonly string[] | "all"> = {
  brand: [],
  home: ["首屏数据", "教学特色", "教室照片格位"],
  about: ["服务形式", "教学理念", "校区数据", "校区介绍"],
  contact: ["联系方式清单"],
  schedule: "all",
};

/** 每块在后台里的名字（表单标题用）。 */
export const SITE_COPY_LABELS: Record<SiteCopyKey, string> = {
  brand: "品牌与联系方式",
  home: "首页",
  about: "关于我们",
  contact: "联系我们",
  schedule: "课程时间安排",
};

/** 一个分组的读取结果（与 `SiteCopyGroup` 同形，便于两处共用映射函数）。 */
export type CopyGroupItems = {
  title: string;
  /** 分组下的说明（公开文案，会渲染；见 `SiteCopyGroup.description` 的说明）。 */
  description: string;
  items: Array<{ title: string; value: string; body: string }>;
};

/**
 * 页面文案的**读取接口**（模版与库两种来源都实现它）。
 *
 * 刻意只有三个方法：`field`（短字段）、`list`（用分隔符写的数组字段）、`group`（分组）。
 * 现有内容文件里用到的读取方式就这三种。
 */
export type CopySource = {
  /** 短字段；缺失或为空时返回 `fallback`（与模版 `pageString(page, key, fallback)` 同义）。 */
  field(key: string, fallback?: string): string;
  /**
   * 用分隔符写的数组字段（`keywords: a、b` / `trial_points: a | b`）。
   * `content.ts` 的解析已经把它们切成数组，因此这里直接给数组、不再切一次。
   */
  list(key: string): string[];
  /** 分组；不存在时返回一个空分组（标题为空、无条目）—— 调用方不用到处判空。 */
  group(name: string): CopyGroupItems;
  /**
   * **全部分组**（按页面上的顺序）。
   *
   * 有些块的分组是"列举型"的（时间安排：工作日排课 / 周末排课 / 晚辅导 / 全日托），
   * 页面不按名字取，而是把每一组都渲染出来 —— 那种块要的就是这个方法。
   */
  groups(): CopyGroupItems[];
};

const EMPTY_GROUP: CopyGroupItems = { title: "", description: "", items: [] };

/**
 * **模版**来源：把 `PageBlock`（Markdown 解析结果）适配成 `CopySource`。
 *
 * 只 import 类型（`import type`）：这个模块必须保持"纯"，网站那侧要能在不拉起
 * Markdown 解析的情况下用它（见 `lib/site/backend-source.ts` 的文件头那条纪律）。
 */
export function pageSource(page: PageBlock): CopySource {
  /* 短字段存成一个 `Record<string, string | string[]>`（见 `lib/data/content.ts` 的 `PageBlock`）。 */
  const raw = (key: string): string | string[] | undefined => page.data[key];
  return {
    field: (key, fallback = "") => {
      const value = raw(key);
      const text = typeof value === "string" ? value.trim() : "";
      return text === "" ? fallback : text;
    },
    /*
     * 数组字段的两种写法，**必须与重构之前的读法逐字一致**（否则页面上的字会变）：
     *   - `keywords:` 是一串 block list → 解析器已经给了数组，原样用（**不再二次切分**：
     *     数组元素里本来就可能有顿号，再切一次会把一条拆成两条）；
     *   - `trial_points: a，b | c | d` 是一行字符串，重构前用的是 `.split("|")`
     *     —— 竖线是它的分隔符，顿号只是条目内部的标点。
     * 我第一版把两者混成"一律按顿号/逗号切"，结果首页试课那一条的 ✓ 位置变了
     * （逐页 diff 才发现）。现在分两条路，各自照抄原来的读法。
     */
    list: (key) => {
      const value = raw(key);
      if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter((item) => item !== "");
      }
      const text = typeof value === "string" ? value : "";
      if (text === "") return [];
      return text.split(/[|｜]/).map((item) => item.trim()).filter((item) => item !== "");
    },
    group: (name) => {
      const found = page.groups.find((group) => group.name === name);
      return found === undefined ? EMPTY_GROUP : { title: found.name, description: found.note, items: sectionItems(found) };
    },
    groups: () =>
      page.groups.map((group) => ({ title: group.name, description: group.note, items: sectionItems(group) })),
  };
}

/** `Section` → 条目列表（模版路径的唯一一处转换）。 */
function sectionItems(section: Section): CopyGroupItems["items"] {
  return section.items.map((item) => ({ title: item.title, value: item.value, body: item.body ?? "" }));
}

/**
 * **库**来源：把 `SiteCopyBlock` 适配成同一个 `CopySource`。
 *
 * 值一律取自块里的 `fields`（键名就是内容文件里的字段名，导入时原样搬过来），
 * 因此后台改一个字段、网站那一处就跟着变，不需要在代码里再加一次映射。
 */
export function blockSource(block: SiteCopyBlock | undefined): CopySource {
  const fields = block?.fields ?? [];
  const groups = block?.groups ?? [];
  const valueOf = (key: string): string => fields.find((item) => item.key === key)?.value ?? "";
  return {
    field: (key, fallback = "") => {
      const value = valueOf(key);
      return value === "" ? fallback : value;
    },
    /*
     * 数组字段：库里存的是**已经切好的多行文本**（后台一个字段一行），
     * 而不是内容文件里那串「用顿号/竖线分开」的写法 —— 两种写法都支持：
     * 先按换行切，只有一行时再按顿号 / 竖线切（兼容从内容文件原样导入的值）。
     */
    list: (key) => {
      const raw = valueOf(key).trim();
      if (raw === "") return [];
      const byLine = raw.split(/\n/).map((item) => item.trim()).filter((item) => item !== "");
      if (byLine.length > 1) return byLine;
      return raw.split(/[|｜]/).map((item) => item.trim()).filter((item) => item !== "");
    },
    group: (name) => {
      const found = groups.find((group) => group.title === name);
      return found === undefined ? EMPTY_GROUP : toItems(found);
    },
    groups: () => groups.map(toItems),
  };
}

/** `SiteCopyGroup` → 读取结果（库里那一份的唯一一处转换）。 */
function toItems(group: SiteCopyGroup): CopyGroupItems {
  return {
    title: group.title,
    description: group.description,
    items: group.items.map((item) => ({ title: item.title, value: item.value, body: item.body })),
  };
}

/**
 * `blank`（没连后端）时用的来源：**短字段与分组标题保留、组内条目清空**。
 *
 * 它包住**任意**一个 `CopySource`（模版那一份最常用），因此各块的映射函数一行都不用改 ——
 * "空态"这件事只在这一处定义（见 `lib/data/site.ts` 文件头的口径）。
 */
export function blankSource(base: CopySource): CopySource {
  return {
    field: base.field,
    list: base.list,
    group: (name) => {
      const group = base.group(name);
      return { title: group.title, description: group.description, items: [] };
    },
    groups: () =>
      base.groups().map((group) => ({ title: group.title, description: group.description, items: [] })),
  };
}

/** 空块（迁移与空库用）。 */
export function emptyCopyBlock(): SiteCopyBlock {
  return { fields: [], groups: [] };
}

/** 五块的空结构。 */
export function emptyCopy(key: SiteCopyKey): SiteCopyBlock {
  return { ...emptyCopyBlock(), key } as SiteCopyBlock & { key: SiteCopyKey };
}

/** 条目的空壳（后台新建时用；id 由服务端生成）。 */
export function newCopyItem(): SiteCopyItem {
  return { id: "", title: "", value: "", body: "" };
}

/** 分组的空壳。 */
export function newCopyGroup(): SiteCopyGroup {
  return { id: "", title: "", description: "", items: [newCopyItem()] };
}

/**
 * 校验一个文案块。
 *
 * 三条（都很轻，因为这些块是纯文案，写错字的代价远小于写错价格）：
 *   - 短字段的**键**不能为空、不能重复（重复的键只有第一个生效，另一个改了没反应 —— 最难查）；
 *   - 分组标题不能为空、不能重复（它是页面上的分区标题，重复会让两节看起来一样）；
 *   - 条目可以没有标题也可以没有值（有些条目就是一段话），但**标题与值不能同时为空**
 *     （那种条目在页面上是一个空行）。
 */
export function validateCopyBlock(block: SiteCopyBlock, where: string): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const field of block.fields) {
    const key = field.key.trim();
    if (key === "") problems.push(`${where}有一个字段没有名字。`);
    if (keys.has(key)) problems.push(`${where}的字段「${key}」出现了两次：重复的键只有第一个生效。`);
    keys.add(key);
  }

  const titles = new Set<string>();
  for (const group of block.groups) {
    const title = group.title.trim();
    if (title === "") problems.push(`${where}有一个分组没有标题。`);
    if (titles.has(title)) problems.push(`${where}的分组「${title}」出现了两次。`);
    titles.add(title);
    for (const item of group.items) {
      if (item.title.trim() === "" && item.value.trim() === "" && item.body.trim() === "") {
        problems.push(`${where}的分组「${title}」里有一条空条目（标题、值、正文都是空的）。`);
      }
    }
  }
  return problems;
}

/** 五块一起校验。 */
export function validateCopy(
  blocks: Partial<Record<SiteCopyKey, SiteCopyBlock>>,
): string[] {
  const problems: string[] = [];
  for (const key of SITE_COPY_KEYS) {
    const block = blocks[key];
    if (block !== undefined) problems.push(...validateCopyBlock(block, `「${SITE_COPY_LABELS[key]}」`));
  }
  return problems;
}
