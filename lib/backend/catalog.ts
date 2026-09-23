/**
 * 课程类型维度表的**校验与派生**（纯函数：不读数据库、不读写文件）。
 *
 * 为什么单独一个模块：同一份维度表有**三个读者** —— 服务层的写入口（校验）、
 * 后台的维护页（排序 / 树形展示）、以及以后要做的"组合解析"（AI 排课与诊断推荐）。
 * 三处各写一遍"哪个学科属于哪个学段、模块怎么分组"必然分叉，因此收在这里。
 */
import type {
  Catalog,
  CatalogFormat,
  CatalogModule,
  CatalogStage,
  CatalogSubject,
} from "./types";

/** 取某个上级分组下面的学科（按 `order` 排；同 order 按名字，保证顺序确定）。 */
export function childSubjects(catalog: Catalog, parentId: string): CatalogSubject[] {
  return catalog.subjects
    .filter((item) => item.parentIds.includes(parentId))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

/**
 * 顶层学科 / 项目（不属于任何分组）。
 *
 * 注意「不属于任何分组」与「在某个学段下显示」是两件事：`日语` 属于「外语等级考试」，
 * 但它在**高中**那一栏里要按顶层出现（那个分组本身只属于「其他类型」）。
 * 因此按学段取清单时用 `subjectsOfStage`，而不是只筛 `parentIds`。
 */
export function topSubjects(catalog: Catalog): CatalogSubject[] {
  return childSubjects(catalog, "");
}

/** 某个学段下开的学科 / 项目（按 `order` 排）。 */
export function subjectsOfStage(catalog: Catalog, stageId: string): CatalogSubject[] {
  return catalog.subjects
    .filter((item) => item.stageIds.includes(stageId))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

/**
 * 分组（清单里那三个中间层：外语等级考试 / 专业外语 / 不分班型项目）。
 *
 * 判据是"有没有别的学科挂在它下面"，而不是另设一个 `kind`：分组就是一个 `项目` 行，
 * 只是恰好被当成桶用了 —— 这样"把一个学科拖进分组"只是改 `parentIds`，不需要先建分组。
 */
export function catalogGroups(catalog: Catalog): CatalogSubject[] {
  const used = new Set(catalog.subjects.flatMap((item) => item.parentIds));
  return catalog.subjects
    .filter((item) => used.has(item.id))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

/**
 * 某个学段下，`groupId` 这一桶里该显示哪些学科（`groupId` 传空串＝顶层那一桶）。
 *
 * 规则（"分组是学段内的桶"）：分组本身属于这个学段时才按分组归拢；
 * 分组不属于这个学段（例如在高中那一栏看「外语等级考试」）时，
 * 它下面的学科**退回顶层**显示 —— 否则「日语」在高中那一整条就消失了，
 * 而"高考外语里有日语"正是机构清单里写着的。
 */
export function subjectsInGroup(catalog: Catalog, stageId: string, groupId: string): CatalogSubject[] {
  const inStage = subjectsOfStage(catalog, stageId);
  const groups = new Set(
    catalogGroups(catalog)
      .filter((group) => group.stageIds.includes(stageId))
      .map((group) => group.id),
  );

  if (groupId === "") {
    return inStage.filter((item) => !item.parentIds.some((id) => groups.has(id)));
  }
  if (!groups.has(groupId)) return [];
  return inStage.filter((item) => item.parentIds.includes(groupId));
}

/** 取某个学科下面的模块（不含子模块）。 */
export function subjectModules(catalog: Catalog, subjectId: string): CatalogModule[] {
  return catalog.modules
    .filter((item) => item.subjectId === subjectId && item.parentId === "")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

/** 某个模块的子模块。 */
export function childModules(catalog: Catalog, parentId: string): CatalogModule[] {
  return catalog.modules
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

/** 按 order 排好的学段 / 班型。 */
export const sortedStages = (catalog: Catalog): CatalogStage[] =>
  [...catalog.stages].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
export const sortedFormats = (catalog: Catalog): CatalogFormat[] =>
  [...catalog.formats].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));

/** 学科在哪些学段开（名字列表，按学段顺序）。 */
export function stageNamesOf(catalog: Catalog, stageIds: readonly string[]): string[] {
  const wanted = new Set(stageIds);
  return sortedStages(catalog)
    .filter((stage) => wanted.has(stage.id))
    .map((stage) => stage.name);
}

/**
 * 校验整份维度表（`catalog.save` 的闸门）。
 *
 * 规则与代价：
 *   - 名字不能为空、**同一层内**不能重名（重名会让后台的下拉出现两条一样的选项，
 *     而排课/报价引用的是 id，选错了没有任何提示）；
 *   - `stageIds` / `parentIds` / `parentId` **必须指向存在的行**（悬空引用会让筛选悄悄少一批）；
 *   - 学科分组只允许一层（清单里就是一层；允许两层会让"这个学科在哪个学段开"变得要往上找）；
 *   - 模块必须属于一个存在的学科，且只能挂在本学科下（跨学科挂会让"这个模块属于哪门课"两说）；
 *   - 班型人数区间要合法（`minSize >= 1`、`maxSize >= minSize`）；
 *   - **不能删到空**：学段与班型至少各留一条（否则"组合"这个概念就没了）。
 *
 * ## 重名的口径为什么是"同一层内"
 *
 * 学段之间、学科之间、班型之间是**同一层**：那些名字会同时出现在一个下拉里，重名没法选。
 * 模块与学科却是**两层**：两个学科各有一个「听力」，那是两条互为独立的模块
 * （模块不跨学科复用），名字相同不构成歧义；同理同一个学科下两个不同上级模块各有一个
 * 子模块叫「上册」也没关系。因此模块的重名判据是"同一个学科 + 同一个上级"。
 */
export function validateCatalog(catalog: Catalog): string[] {
  const problems: string[] = [];

  const checkNames = (rows: Array<{ id: string; name: string }>, label: string): void => {
    const seen = new Set<string>();
    for (const row of rows) {
      const name = row.name.trim();
      if (name === "") problems.push(`${label}有一项没有名字。`);
      if (seen.has(name)) problems.push(`${label}里「${name}」出现了两次：同类内名字不能重复。`);
      seen.add(name);
    }
  };

  /** id 里同一层内的重名（模块要按"学科 + 上级"分组后再判）。 */
  const checkKeys = (keys: readonly string[], label: string): void => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) problems.push(`${label}里「${key}」出现了两次：同一层内不能重复。`);
      seen.add(key);
    }
  };

  /*
   * id 必须落地且唯一。空 id 是**必须拦**的：`save` 是整份替换，一行空 id 保存进去之后
   * 就再也指不回它（`stageIds` / `parentIds` 全都会变成悬空）——而界面上的症状只是
   * "勾了学段却没生效"。id 由页面按下名字派生（`catalogId`），所以空 id 只会来自手写的请求。
   */
  const checkIds = (rows: Array<{ id: string; name: string }>, label: string): void => {
    for (const row of rows) {
      if (row.id.trim() === "") problems.push(`${label}「${row.name.trim() || "（没名字）"}」没有 id：保存后无法被引用。`);
    }
    checkKeys(rows.map((row) => row.id.trim()).filter((id) => id !== ""), `${label}的 id`);
  };

  if (catalog.stages.length === 0) problems.push("学段至少要有一个。");
  if (catalog.formats.length === 0) problems.push("班型至少要有一个。");
  checkNames(catalog.stages, "学段");
  checkNames(catalog.subjects, "学科 / 项目");
  checkNames(catalog.formats, "班型");
  checkIds(catalog.stages, "学段");
  checkIds(catalog.subjects, "学科 / 项目");
  checkIds(catalog.modules, "内容模块");
  checkIds(catalog.formats, "班型");
  checkKeys(
    catalog.modules.map((item) => {
      const parent = catalog.modules.find((candidate) => candidate.id === item.parentId);
      return `${item.subjectId}/${parent?.id ?? ""}/${item.name.trim()}`;
    }),
    "同一学科同一上级下的内容模块",
  );

  const stageIds = new Set(catalog.stages.map((item) => item.id));
  const subjectIds = new Set(catalog.subjects.map((item) => item.id));

  const missingStage = (ids: readonly string[]): string[] => ids.filter((id) => !stageIds.has(id));

  for (const subject of catalog.subjects) {
    for (const parentId of subject.parentIds) {
      if (!subjectIds.has(parentId)) {
        problems.push(`学科「${subject.name}」挂在一个不存在的分组上。`);
        continue;
      }
      const parent = catalog.subjects.find((item) => item.id === parentId);
      if (parent !== undefined && parent.parentIds.length > 0) {
        problems.push(`「${subject.name}」挂在「${parent.name}」下，而后者自己也在分组里：分组只允许一层。`);
      }
    }
    const bad = missingStage(subject.stageIds);
    if (bad.length > 0) problems.push(`学科「${subject.name}」引用了不存在的学段：${bad.join("、")}。`);
  }

  for (const item of catalog.modules) {
    const owner = catalog.modules.find((candidate) => candidate.id === item.parentId);
    if (!subjectIds.has(item.subjectId)) {
      problems.push(`模块「${item.name}」属于一个不存在的学科。`);
    }
    if (item.parentId !== "" && owner === undefined) {
      problems.push(`模块「${item.name}」挂在一个不存在的上级模块上。`);
    }
    if (owner !== undefined && owner.subjectId !== item.subjectId) {
      problems.push(`模块「${item.name}」挂在了别的学科的模块下面。`);
    }
    const bad = missingStage(item.stageIds);
    if (bad.length > 0) problems.push(`模块「${item.name}」引用了不存在的学段：${bad.join("、")}。`);
    // 自引用会让树形展示死循环
    if (item.parentId === item.id) problems.push(`模块「${item.name}」的上级是它自己。`);
  }

  for (const format of catalog.formats) {
    if (!Number.isFinite(format.minSize) || format.minSize < 1) {
      problems.push(`班型「${format.name}」的最少人数要大于 0。`);
    }
    if (!Number.isFinite(format.maxSize) || format.maxSize < format.minSize) {
      problems.push(`班型「${format.name}」的最多人数不能小于最少人数。`);
    }
  }

  return problems;
}

/** 整份维度表的规模（后台与日志里那句"共几条"）。 */
export function catalogSummary(catalog: Catalog): string {
  return (
    `${String(catalog.stages.length)} 个学段 / ` +
    `${String(catalog.subjects.length)} 个学科项目 / ` +
    `${String(catalog.modules.length)} 个内容模块 / ` +
    `${String(catalog.formats.length)} 个班型`
  );
}

/**
 * 给**新加的行**补 id（保存前的最后一次扫描）。
 *
 * ## 为什么放在这里、而不是"新增时立刻生成"
 *
 * id 由名字派生（`catalogId`），而名字在草稿上是随时在改的。如果新增时就生成 id，
 * 那么"改名"这一步要么重算 id（把引用它的 `stageIds` / `parentIds` 一起指丢），
 * 要么不重算（于是 id 与名字不一致，`subj_语文` 变成挂在一个叫「语文2」的行上，
 * 以后靠 id 反推名字的代码就会给出错的答案）。**保存前统一补**把两个问题都绕开了：
 * 保存那一刻名字已经定了，id 就是那一刻名字的函数。
 *
 * 模块的 id 还带学科名（两个学科各有一个「听力」是两条模块），因此**不能**走上面那条
 * 通用填充 —— 先用 `mod_名字` 填一遍的话，下面按"学科·模块"的正规写法就再也轮不到
 * （id 已经不是空的了），于是两个学科的同名模块会在保存时撞成一个 id。
 * 这条是第 30 节自检抓出来的（断言先写、实现后补）。
 */
export function assignCatalogIds(catalog: Catalog, prefix: (kind: string, name: string) => string): void {
  const fill = (rows: Array<{ id: string; name: string }>, kind: string): void => {
    for (const row of rows) {
      if (row.id.trim() === "" && row.name.trim() !== "") row.id = prefix(kind, row.name);
    }
  };

  fill(catalog.stages, "st");
  fill(catalog.subjects, "subj");
  fill(catalog.formats, "fmt");

  for (const item of catalog.modules) {
    if (item.id.trim() !== "") continue;
    const subject = catalog.subjects.find((candidate) => candidate.id === item.subjectId);
    if (subject !== undefined && item.name.trim() !== "") {
      item.id = prefix("mod", `${subject.name}·${item.name}`);
    }
  }
}
