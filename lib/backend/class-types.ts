/**
 * 报价里的**班级类型**与课程类型里的**班型**对齐（纯函数）。
 *
 * ## 为什么需要这一层
 *
 * "班型"原先写在两个地方：`data/site/pricing.md` 的「班级类型」（每个班型一个系数）
 * 与特色课程树的二级课程名（后台下拉的候选）。v23 把班型收进了课程类型的维度表
 * （`catalog.formats`，全系统唯一口径），但**报价配置里仍然各自记着一份名字** ——
 * 机构在「课程类型」页把「大班课（9-20人）」改成别的写法，报价页与网站报价器上
 * 还是旧名字，而**这种不一致不会报错**（两边都显示得像正常的）。
 *
 * 因此：**名称与人数区间以维度表为准，报价只保留"这个班型多少钱"**。
 * 这一层就是在两边之间做这件事，只有一份实现，三个读者共用：
 *
 *   1. 服务层读报价（`api.pricing.get`）：返回的名称按维度表实时替换；
 *   2. 构站（`buildPublicSite`）：网站报价器上的名称同样来自维度表；
 *   3. 导出 Markdown（`api.pricing.exportMarkdown`）：写回 `data/site/pricing.md`
 *      时用维度表的名称，下一次构站（没连后端那份）不会漂回去。
 *
 * ## 对接的方式：先认 id，再认名字
 *
 * 每一行班级类型带 `formatId`（课程类型里的班型 id）。迁移会给老数据补上这个字段
 * （按名字对一次）；之后机构改班型名字**不影响这一行**（全系统按 id 引用）。
 * 只有 `formatId` 为空的旧行才按名字再对一次 —— 这是"名字只在对不上时当线索用"，
 * 而不是"用名字当身份"。
 *
 * ## 对不上的两种情形都要说出来（而不是安静地各显示一套）
 *
 *   - `orphans`：报价里有、维度表里没有（机构把那个班型删了/改名了）→
 *     这一行已经没有任何课会用到它，报价页要提示"去课程类型里看看"；
 *   - `unpriced`：维度表里有、报价里没有（新加的班型还没定系数）→
 *     家长问到它时**算不出价**，必须提示"还没有系数"。
 */

/** 报价里的一行班级类型（结构类型：报价配置与网站那一份共用这套字段）。 */
export type ClassTypeLike = {
  name: string;
  mode: "coefficient" | "cost-share";
  coefficient: number | null;
  /** 课程类型里的班型 id；空串＝还没对上。 */
  formatId?: string;
};

/** 维度表里这一层需要的东西（只取 id 与名字，避免依赖整个 `Catalog` 类型）。 */
export type FormatLike = { id: string; name: string };
export type CatalogFormatsLike = { formats: readonly FormatLike[] };

export type ClassTypeSync<T extends ClassTypeLike> = {
  /** 对齐之后的班级类型（名称以维度表为准；对不上的原样保留，绝不静默丢掉）。 */
  classTypes: T[];
  /** 报价里有、维度表里没有的班型名。 */
  orphans: string[];
  /** 维度表里有、报价里没有的班型名（还没有系数）。 */
  unpriced: string[];
};

/**
 * 把报价的班级类型对齐到维度表。
 *
 * 返回的是**新数组**（不改入参）：调用方可能是 `load()` 里那份缓存对象。
 */
export function syncClassTypes<T extends ClassTypeLike>(
  rows: readonly T[],
  catalog: CatalogFormatsLike,
): ClassTypeSync<T> {
  const byId = new Map(catalog.formats.map((format) => [format.id, format] as const));
  const byName = new Map(catalog.formats.map((format) => [format.name, format] as const));

  const orphans: string[] = [];
  const used = new Set<string>();

  const classTypes = rows.map((row) => {
    const byFormatId = row.formatId === undefined || row.formatId === "" ? undefined : byId.get(row.formatId);
    const matched = byFormatId ?? byName.get(row.name);
    if (matched === undefined) {
      orphans.push(row.name);
      return { ...row };
    }
    used.add(matched.id);
    return { ...row, formatId: matched.id, name: matched.name };
  });

  const unpriced = catalog.formats.filter((format) => !used.has(format.id)).map((format) => format.name);
  return { classTypes, orphans, unpriced };
}

/**
 * 给一行的名字找一个班型 id（迁移与"从内容文件初始化"时用）。
 *
 * 找不到返回空串：**不编一个 id 出来** —— 那一行会被 `syncClassTypes` 当成 `orphans`
 * 报出来，机构自己去课程类型里加那个班型（或把名字改回来）。
 */
export function formatIdByName(name: string, catalog: CatalogFormatsLike): string {
  const matched = catalog.formats.find((format) => format.name === name.trim());
  return matched?.id ?? "";
}

/**
 * 两种差异合成一句人话（报价页顶部提示与自检共用同一份措辞）。
 *
 * 没差异时返回空串 —— 调用方据此决定要不要渲染那一块（不要渲染一个空壳）。
 */
export function classTypeIssuesText(sync: Pick<ClassTypeSync<ClassTypeLike>, "orphans" | "unpriced">): string {
  const parts: string[] = [];
  if (sync.unpriced.length > 0) {
    parts.push(
      `课程类型里有 ${String(sync.unpriced.length)} 个班型还没有系数（${sync.unpriced.join("、")}）：` +
        "家长问到这些班型时算不出价，请在这里补上。",
    );
  }
  if (sync.orphans.length > 0) {
    parts.push(
      `这里还有 ${String(sync.orphans.length)} 个班型在课程类型里已经找不到了（${sync.orphans.join("、")}）：` +
        "它们不会再被任何课程用到，请到「课程类型」页确认是改名还是删除。",
    );
  }
  return parts.join(" ");
}
