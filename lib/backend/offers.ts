/**
 * 开放组合（`offers`）的**纯函数**：组合身份、矩阵、校验、批量勾选。
 *
 * 为什么不写在 `catalog.ts` 里：那一份是**维度表**（"可以有哪些维度"），
 * 这一份是**组合**（"本机构开哪些组合"）。两者的读者、校验规则、改动频率都不同 ——
 * 混在一起之后，改一次矩阵要重读一遍维度表那一整套约定。
 *
 * 三个读者（后台页、服务端闸门、以后要做的组合解析共用同一份实现）：
 *   1. `api.offers.save` 的闸门（`validateOffers`）；
 *   2. 后台「开放矩阵」页（`buildMatrix` / `applyDecision` 的批量动作）；
 *   3. AI 排课与诊断推荐（`resolveOffer`：这条组合到底开不开）。
 */
import type { Catalog, CatalogOffer } from "./types";

/** 一条组合的四个维度取值（`moduleId` 空串＝不细分到模块）。 */
export type OfferKey = {
  subjectId: string;
  moduleId: string;
  formatId: string;
  deliveryId: string;
};

/**
 * 组合的**确定性 id**：四个维度 id 拼起来。
 *
 * 与课程类型的种子同一个理由（可重复执行、不会造出重复行）：组合的身份就是那四个 id，
 * 因此"同一条组合两行"在结构上不可能出现，批量勾选也不必先查重。
 * 维度**改名不影响它**（id 不变）；删掉一个维度行会让引用它的组合变成悬空，
 * 由 `validateOffers` 拦下（那时机构要在矩阵里重新勾）。
 *
 * ⚠️ 这个字符串**只当键用，绝不反向解析**：学科 / 模块的 id 里本来就带 `·`
 * （`mod_语文·客观题`），按下标切分必然切错。要拿四个取值就从结构体上拿
 * （`OfferRow` / `OfferColumn` 里都存着）。
 */
export function offerKey(key: OfferKey): string {
  return `${key.subjectId}·${key.moduleId}·${key.formatId}·${key.deliveryId}`;
}

/** 组合行的 id（`off_` + 键）。 */
export function offerId(key: OfferKey): string {
  return `off_${offerKey(key)}`;
}

/** 一条组合的"是否开放"结论。`unset` ＝ 机构还没表过态（既不是开、也不是关）。 */
export type OfferDecision = "open" | "closed" | "unset";

/** 把一张组合表变成按 key 索引的 Map（矩阵与解析都先做这一件事）。 */
export function offersByKey(offers: readonly CatalogOffer[]): Map<string, CatalogOffer> {
  const map = new Map<string, CatalogOffer>();
  for (const offer of offers) {
    map.set(offerKey(offer), offer);
  }
  return map;
}

/** 问一条组合：开 / 明确关 / 没设置（AI 排课与诊断推荐的入口）。 */
export function resolveOffer(index: Map<string, CatalogOffer>, key: OfferKey): OfferDecision {
  const found = index.get(offerKey(key));
  if (found === undefined) return "unset";
  return found.open ? "open" : "closed";
}

/*
 * ── 矩阵 ─────────────────────────────────────────────────────────────────────
 *
 * 组合有四个维度，而表格只有两维，因此矩阵的形状是**定下来的**：
 *
 *   行 = 学科（含它自己的模块；`moduleId` 空串那一行表示"不细分模块"）
 *   列 = 班型 × 交付形态
 *
 * 不把班型与交付折成一个下拉（"先选班型再看交付"）：机构勾的时候心里想的是
 * "这门课这个班型能不能上网课"，两维同屏才看得出规律，也才好按列整片勾。
 */

/** 矩阵的一行：一个学科的一个模块（或"不细分模块"那一行）。 */
export type OfferRow = {
  subjectId: string;
  subjectName: string;
  /** 空串＝不细分模块。 */
  moduleId: string;
  /** 模块名；空串时页面上显示成「（不分模块）」。 */
  moduleName: string;
  /** 这一行的归属：用它来筛学段（模块自己的 `stageIds` 优先，见 `buildMatrix`）。 */
  stageIds: string[];
  /** 这个学科属于哪个分组（`parentIds[0]`；矩阵里按它分节，空串＝顶层）。 */
  groupId: string;
};

/** 矩阵的一列：一个班型 × 一种交付形态。 */
export type OfferColumn = {
  formatId: string;
  formatName: string;
  deliveryId: string;
  deliveryName: string;
};

export type OfferMatrix = { rows: OfferRow[]; columns: OfferColumn[] };

/**
 * 从维度表算出**全部可能的组合**（矩阵的行与列）。
 *
 * 三点刻意的地方：
 *
 *   1. **"不细分模块"是一行，不是一个缺省**：不指定模块的组合是合法的
 *      （"语文一对一"照样能开），诊断推荐才需要模块那一层。因此每个学科至少有这一行。
 *   2. **学段不进组合键**：同一条组合"同时在小学与初中开"在数据上是同一行 ——
 *      因为模块各自挂在学科下（小学语文的一年级 ≠ 初中语文的一年级），
 *      学段 + 学科 + 模块已经唯一确定了一门课。学段只用来**筛行**。
 *   3. **分组不出现**：它是个桶（"外语等级考试"），不是一个能开课的学科。
 */
export function buildMatrix(catalog: Catalog): OfferMatrix {
  const groupIds = new Set(catalog.subjects.flatMap((subject) => subject.parentIds));

  const rows: OfferRow[] = [];
  for (const subject of catalog.subjects) {
    if (groupIds.has(subject.id)) continue;

    const base = {
      subjectId: subject.id,
      subjectName: subject.name,
      stageIds: subject.stageIds,
      groupId: subject.parentIds[0] ?? "",
    };
    rows.push({ ...base, moduleId: "", moduleName: "" });

    for (const item of catalog.modules) {
      if (item.subjectId !== subject.id) continue;
      rows.push({
        ...base,
        moduleId: item.id,
        moduleName: item.name,
        // 模块自己的学段优先：语文的「客观题」只在初中与高中开，小学那一栏不该出现它
        stageIds: item.stageIds,
      });
    }
  }

  const columns: OfferColumn[] = [];
  for (const format of catalog.formats) {
    for (const delivery of catalog.deliveries) {
      columns.push({
        formatId: format.id,
        formatName: format.name,
        deliveryId: delivery.id,
        deliveryName: delivery.name,
      });
    }
  }

  return { rows, columns };
}

/** 批量勾选的目标：把一批组合设成同一个状态（`unset` ＝ 清除设置，退回"还没人想过"）。 */
export function applyDecision(
  offers: readonly CatalogOffer[],
  keys: readonly OfferKey[],
  decision: OfferDecision,
  now: string,
): CatalogOffer[] {
  const wanted = new Map(keys.map((key) => [offerKey(key), key]));
  const kept = offers.filter((offer) => !wanted.has(offerKey(offer)));
  if (decision === "unset") return kept;

  const existing = offersByKey(offers);
  const changed = [...wanted.values()].map((key) => ({
    id: offerId(key),
    ...key,
    open: decision === "open",
    note: existing.get(offerKey(key))?.note ?? "",
    updatedAt: now,
  }));
  return [...kept, ...changed];
}

/**
 * 校验整张组合表（`offers.save` 的闸门）。
 *
 * 规则与代价：
 *   - 四个引用**都必须指向存在的维度行**（悬空引用会让"这条组合到底开不开"两说：
 *     矩阵里它根本不显示，而解析时它又算"开放"）；
 *   - `moduleId` 必须属于那个 `subjectId`（跨学科挂会把 A 学科的模块算到 B 上）；
 *   - 同一条组合只能有一行（身份就是那四个 id，重复就是数据坏了）；
 *   - 行的 id 必须与四个 id 拼出来的那一份一致（对不上说明是手改过的行）。
 */
export function validateOffers(offers: readonly CatalogOffer[], catalog: Catalog): string[] {
  const problems: string[] = [];
  const subjectIds = new Set(catalog.subjects.map((item) => item.id));
  const formatIds = new Set(catalog.formats.map((item) => item.id));
  const deliveryIds = new Set(catalog.deliveries.map((item) => item.id));
  const modules = new Map(catalog.modules.map((item) => [item.id, item] as const));

  const seen = new Set<string>();
  for (const offer of offers) {
    const label = `组合「${offerKey(offer)}」`;
    if (offer.id.trim() === "") problems.push("有一条组合没有 id。");

    if (!subjectIds.has(offer.subjectId)) problems.push(`${label}引用了一个不存在的学科。`);
    if (!formatIds.has(offer.formatId)) problems.push(`${label}引用了一个不存在的班型。`);
    if (!deliveryIds.has(offer.deliveryId)) problems.push(`${label}引用了一个不存在的交付形态。`);

    if (offer.moduleId !== "") {
      const item = modules.get(offer.moduleId);
      if (item === undefined) problems.push(`${label}引用了一个不存在的内容模块。`);
      else if (item.subjectId !== offer.subjectId) {
        problems.push(`${label}的内容模块不属于它那个学科（模块不跨学科复用）。`);
      }
    }

    const key = offerKey(offer);
    if (seen.has(key)) problems.push(`${label}出现了两次：同一条组合只能有一行。`);
    seen.add(key);

    const expected = offerId(offer);
    if (offer.id.trim() !== "" && offer.id !== expected) {
      problems.push(`${label}的 id 与它那四个维度对不上（矩阵会找不到这一行）。`);
    }
  }

  return problems;
}

/** 组合表的规模（操作日志与后台那句"共几条"）。 */
export function offersSummary(offers: readonly CatalogOffer[]): string {
  const open = offers.filter((offer) => offer.open).length;
  return `开放 ${String(open)} 条 / 明确关闭 ${String(offers.length - open)} 条`;
}

/**
 * 一条维度行被删 / 改名之后，组合表要跟着做什么（给后台的"删除前警告"用）。
 *
 * 返回引用它的组合（含条数）：矩阵里那些格子会变成悬空，`offers.save` 会拦住它们，
 * 因此后台在删维度之前要能告诉人"这一删会牵动几条组合"。
 */
export function offersOfDimension(
  offers: readonly CatalogOffer[],
  dimension: "subject" | "module" | "format" | "delivery",
  id: string,
): CatalogOffer[] {
  const field =
    dimension === "subject"
      ? "subjectId"
      : dimension === "module"
        ? "moduleId"
        : dimension === "format"
          ? "formatId"
          : "deliveryId";
  return offers.filter((offer) => offer[field] === id);
}
