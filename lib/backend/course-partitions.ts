/**
 * 课程分区：**唯一一份**「栏目 → 子栏目」的层级与名字。
 *
 * ## 这个模块存在的理由
 *
 * 分区原先不存在 —— 它是从每门课的 `category` / `subgroup` 两个字符串**聚合**出来的。
 * 于是「小学课内」这个名字在 N 门课上各写了一份，改名要逐门改；分区也不能空着、不能排序。
 * 现在分区是 `Database.coursePartitions` 里的行（`CoursePartition`），课程只引用它的 id。
 *
 * ## 为什么是纯函数（不碰数据库）
 *
 * 同一棵树有**三个读者**，它们在三个不同的地方：
 *
 *   1. 后台课程库清单（浏览器里的 React 页面，拿的是 `courses.list` + `coursePartitions.list`）；
 *   2. 服务层的校验与排序（`api.ts` 里的写入口）；
 *   3. **网站构站**（`lib/site/backend-source.ts`，它读的是构站快照 `PublicSite`，
 *      连后端都不在场 —— 静态导出后跑在 GitHub Pages 上）。
 *
 * 三处各写一份分组逻辑，结果必然是"后台看着对、网站上不对"。因此分组、排序、
 * 层级判断全部收在这个模块里，输入输出都是普通对象，谁都能调。
 * 这里**刻意不 import 任何会读数据库 / 读 Markdown 的模块**（网站那侧不许依赖后端，
 * 见 `backend-source.ts` 的文件头），只 import 类型。
 *
 * ## 两级，且只有两级
 *
 * 网站课程页渲染的就是 `栏目 → 子栏目 → 卡片`，第三级页面画不出来（见 `types.ts`
 * 里 `CoursePartition` 的说明）。`validatePartition` 明确拒绝第三级，而不是"存得下就行"。
 */
import type { CoursePartition } from "./types";

/** 分区最多两级：一级＝栏目，二级＝子栏目。 */
export const MAX_PARTITION_DEPTH = 2;

/** 一级分区（网站上的「栏目」）。 */
export function topLevelPartitions(partitions: readonly CoursePartition[]): CoursePartition[] {
  return sortSiblings(partitions.filter((item) => item.parentId === ""));
}

/** 某个分区的下级分区（按 `order` 升序）。 */
export function childPartitions(
  partitions: readonly CoursePartition[],
  parentId: string,
): CoursePartition[] {
  return sortSiblings(partitions.filter((item) => item.parentId === parentId));
}

/**
 * 同级排序：`order` 升序，**同 order 时按名字**。
 *
 * 为什么要有个确定的第二判据：`order` 允许重复（人手工填的时候一定会撞上），
 * 而"谁在前面"如果取决于数组里谁先出现，同一份数据在两次渲染里就可能不一样
 * （清单按库里顺序、网站按快照顺序 —— 两处顺序不同正是要修掉的毛病之一）。
 */
function sortSiblings(items: readonly CoursePartition[]): CoursePartition[] {
  return [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
}

/** 按 id 找分区；找不到返回 `undefined`（调用方决定怎么兜）。 */
export function findPartition(
  partitions: readonly CoursePartition[],
  id: string,
): CoursePartition | undefined {
  if (id === "") return undefined;
  return partitions.find((item) => item.id === id);
}

/**
 * 分区名；找不到（未归类 / 引用已失效）返回空串。
 *
 * 刻意不返回「未分类」这种兜底文字：那是**显示**的事，页面要显示成什么由页面决定
 * （后台清单显示「未归类」，网站直接不渲染这一区）。在这一层编一个名字，
 * 就会出现"网站上多出一个叫「未分类」的栏目"这种事。
 */
export function partitionName(partitions: readonly CoursePartition[], id: string): string {
  return findPartition(partitions, id)?.name ?? "";
}

/**
 * 一个分区在树里的位置：`column` 是一级（栏目），`leaf` 是它自己。
 *
 * 挂在二级时 `column` 是父分区；挂在一级时 `column` 与 `leaf` 是同一个。
 */
export function partitionPlace(
  partitions: readonly CoursePartition[],
  id: string,
): { column: CoursePartition | null; leaf: CoursePartition | null } {
  const leaf = findPartition(partitions, id);
  if (leaf === undefined) return { column: null, leaf: null };
  if (leaf.parentId === "") return { column: leaf, leaf };
  return { column: findPartition(partitions, leaf.parentId) ?? null, leaf };
}

/** 分区的层级：一级 = 1，二级 = 2；找不到或数据坏了返回 0。 */
export function partitionDepth(partitions: readonly CoursePartition[], id: string): number {
  const node = findPartition(partitions, id);
  if (node === undefined) return 0;
  return node.parentId === "" ? 1 : 2;
}

/** `id` 是不是 `maybeAncestorId` 的后代（防止把分区挂到自己的下级里）。 */
export function isDescendantOf(
  partitions: readonly CoursePartition[],
  id: string,
  maybeAncestorId: string,
): boolean {
  let cursor = findPartition(partitions, id);
  let guard = 0;
  while (cursor !== undefined && cursor.parentId !== "" && guard < MAX_PARTITION_DEPTH + 1) {
    if (cursor.parentId === maybeAncestorId) return true;
    cursor = findPartition(partitions, cursor.parentId);
    guard += 1;
  }
  return false;
}

/** 分区补默认值（`order` 缺失时排到最后，与课程 `order` 的口径一致）。 */
export function normalizePartition(input: Partial<CoursePartition>): CoursePartition {
  const order = Number(input.order);
  return {
    id: typeof input.id === "string" ? input.id : "",
    name: typeof input.name === "string" ? input.name.trim() : "",
    parentId: typeof input.parentId === "string" ? input.parentId : "",
    order: Number.isFinite(order) ? order : 999,
  };
}

/**
 * 校验一个分区（新建与修改都过这里）。
 *
 * 五条规则各自对应一次真实的误操作：
 *   - 名字为空 → 会出现一条点不到、也没法引用的分区；
 *   - 同级重名 → 清单里两个「高中课内」，课到底挂哪个说不清（网站也会渲染成两块）；
 *   - 上级不存在 → 挂在一个不存在的分区下，等于这一区谁也不显示；
 *   - 上级本身是二级 → **第三级**，网站渲染不出来；
 *   - 挂到自己下面 → 树成环，分组时会无限递归。
 */
export function validatePartition(
  input: { name: string; parentId: string },
  partitions: readonly CoursePartition[],
  editingId = "",
): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  const parentId = input.parentId.trim();

  if (name === "") problems.push("分区名不能为空。");

  if (parentId !== "") {
    const parent = findPartition(partitions, parentId);
    if (parent === undefined) {
      problems.push("上级分区不存在：请刷新页面重新选择。");
    } else if (parent.parentId !== "") {
      problems.push(
        `「${parent.name}」本身已经是子栏目了：分区只有两级（栏目 → 子栏目），不能再往下加一层` +
          "（网站的课程页只渲染两级，第三级存得下但看不到）。",
      );
    }
    if (editingId !== "" && (parentId === editingId || isDescendantOf(partitions, parentId, editingId))) {
      problems.push("不能把分区挂到它自己（或它的下级）下面 —— 那会绕成一个圈。");
    }
  }

  const duplicated = partitions.some(
    (item) =>
      item.id !== editingId &&
      item.parentId === parentId &&
      item.name.trim() === name &&
      name !== "",
  );
  if (duplicated) {
    const where = parentId === "" ? "栏目" : "同一栏目下";
    problems.push(`${where}已经有叫「${name}」的分区了：同级分区名不能重复。`);
  }
  return problems;
}

/**
 * 这个分区能不能删；不能删时给出理由（与课程 / 学员的删除护栏同一套做法）。
 *
 * 有课就不许删：那一区的课会变成**未归类**（`partitionId` 指向一条不存在的记录），
 * 网站上这一区整块消失、后台清单里它们掉进「未归类」—— 这是静默的数据错位，
 * 比"删不掉"糟糕得多。要删先把它下面的课移走（界面上就有「把本区课程移到…」）。
 */
export function partitionDeleteRefusal(
  partitions: readonly CoursePartition[],
  courseCount: (partitionId: string) => number,
  id: string,
): string {
  const node = findPartition(partitions, id);
  if (node === undefined) return "";
  const own = courseCount(node.id);
  if (own > 0) {
    return (
      `「${node.name}」下面还有 ${String(own)} 门课：请先把它们移到别的分区` +
      "（清单里每一区的标题旁就有「把本区课程移到…」），否则这些课会变成「未归类」。"
    );
  }
  const children = childPartitions(partitions, node.id);
  if (children.length > 0) {
    return (
      `「${node.name}」下面还有 ${String(children.length)} 个子栏目（${children
        .map((item) => item.name)
        .join("、")}）：请先把子栏目删掉或移走。`
    );
  }
  return "";
}

/**
 * 同级重排：把 `ids` 按给定顺序重新编号（1、2、3…）。
 *
 * 为什么是"整份交顺序"而不是"上移一位 / 下移一位"两个方法：后者在两次点击之间
 * 别人插了一条时会移错位置，而且两个方法的实现要各自算一遍边界；整份交顺序
 * 只有一个语义 —— "这些同级分区，按这个顺序排"。
 */
export function applyPartitionOrder(
  partitions: readonly CoursePartition[],
  ids: readonly string[],
): CoursePartition[] {
  const rank = new Map<string, number>();
  ids.forEach((id, index) => rank.set(id, index + 1));
  return partitions.map((item) =>
    rank.has(item.id) ? { ...item, order: rank.get(item.id) ?? item.order } : item,
  );
}

/** 分组用的一次性输入：只要"属于哪一区"和"区内顺序"。 */
export type PartitionedItem = { partitionId: string; order: number };

/**
 * 分组的**唯一实现**：后台清单、网站课程页、导入导出核对全部走它。
 *
 * 输出的形状刻意与网站的 `CourseColumn` 对齐：一级分区 → 若干组，每组要么是某个二级分区，
 * 要么是 `subgroup: null`（**直接挂在一级分区上的课**，网站上不渲染子标题）。
 * 后台清单再往每组里塞"编辑按钮"这类东西，但**结构与顺序不再自己算一遍**。
 *
 * 两条排序口径：
 *   - 区之间的顺序 = 分区自己的 `order`（v18 起由机构调整，不再是"最小的课程 order"）；
 *   - 区内课的顺序 = 课程的 `order`，同 order 时保持传入顺序（稳定排序，与以前的观感一致）。
 */
export function groupByPartition<T extends PartitionedItem>(
  items: readonly T[],
  partitions: readonly CoursePartition[],
): Array<{ column: CoursePartition; groups: Array<{ subgroup: CoursePartition | null; items: T[] }> }> {
  const inColumn = (columnId: string): T[] =>
    items.filter((item) => {
      const place = partitionPlace(partitions, item.partitionId);
      return place.column?.id === columnId;
    });
  const sortItems = (list: T[]): T[] => [...list].sort((a, b) => a.order - b.order);

  return topLevelPartitions(partitions).map((column) => {
    const direct = sortItems(inColumn(column.id).filter((item) => item.partitionId === column.id));
    const groups: Array<{ subgroup: CoursePartition | null; items: T[] }> = [];
    // 「直接挂在一级分区上」那一组排在最前：它没有子标题，先渲染它 = 与网站一致
    if (direct.length > 0) groups.push({ subgroup: null, items: direct });
    /*
     * **空的子栏目也返回**（`items: []`）：机构要能"先把子栏目建好、再往里放课"，
     * 而后台清单正是唯一能看到它的地方（网站上空栏目不上网，见 `backendCourseColumns`）。
     * 消费者各自决定怎么处理空组：网站那侧跳过，清单里渲染成一个可以改名/删除的空块。
     */
    for (const child of childPartitions(partitions, column.id)) {
      const list = sortItems(inColumn(column.id).filter((item) => item.partitionId === child.id));
      groups.push({ subgroup: child, items: list });
    }
    return { column, groups };
  });
}

/**
 * 一门课**没有**有效分区时（未归类、或引用了一条已经不存在的分区）的归属说明。
 *
 * 分成两句而不是都叫「未归类」：前者是正常的中间状态（后台新建课程还没选分区），
 * 后者是**数据错位**（分区被删掉了、或恢复了半份备份），要让人看得出该去修。
 */
export function describeUnpartitioned(
  partitions: readonly CoursePartition[],
  partitionId: string,
): string {
  if (partitionId === "") return "未归类";
  const missing = findPartition(partitions, partitionId) === undefined;
  return missing ? `分区已失效（${partitionId}）` : "";
}

/**
 * 分区在界面 / 导出里的**唯一写法**：`栏目` 或 `栏目 / 子栏目`（未归类时为空串）。
 *
 * 为什么必须只有一处：同一门课的分区名会出现在四个地方 —— 课程库清单的分组标题、
 * 学员/教师表单里的科目下拉、导出的 CSV / Markdown、以及数据页那份清单。
 * 四处各拼一次的话，"导出来是 `高中课内 / 七选三`、下拉里是 `七选三`"这种事迟早发生，
 * 而那种不一致没有任何自检能发现（两边都"非空"）。
 */
export function partitionPathLabel(partitions: readonly CoursePartition[], id: string): string {
  const place = partitionPlace(partitions, id);
  if (place.column === null) return "";
  if (place.leaf === null || place.leaf.parentId === "") return place.column.name;
  return `${place.column.name} / ${place.leaf.name}`;
}

/**
 * 按「栏目 → 子栏目」的名字找分区，没有就**建一个**；返回补齐后的分区表与"这组名字 → id"的映射。
 *
 * 用在两个"从外面灌数据进来"的入口：`courses.syncFromSite`（从网站内容同步课程卡片）
 * 与 Excel 导入。它们的输入说的是**名字**（内容文件里写的是 `栏目: 高中课内 · 子栏目: 七选三`），
 * 而库里存的是 id —— 转换必须有且只有一处。
 *
 * 三个刻意的行为：
 *   - **只增不改**：已存在的分区按（上级 + 名字）认出来就用它，不动它的顺序与名字
 *     （机构可能已经把它改名、排到别的位置了，一次同步不该把这些冲掉）；
 *   - 新建的分区排在**同级最后**（`order` = 现有最大值 + 1），而不是抢到最前面；
 *   - 名字为空时**不建分区**（返回空 id）：内容文件里没写栏目的卡片本来就是"不上网站"，
 *     给它建一个空名字的分区只会让清单里多出一块没标题的区域。
 */
export function ensurePartitions(
  rows: readonly CoursePartition[],
  refs: ReadonlyArray<{ column: string; subgroup: string }>,
  makeId: () => string,
  onChange?: (created: CoursePartition) => void,
): { partitions: CoursePartition[]; idOf: (column: string, subgroup: string) => string } {
  const partitions = [...rows];

  const nextOrder = (parentId: string): number =>
    partitions
      .filter((item) => item.parentId === parentId)
      .reduce((max, item) => Math.max(max, item.order), 0) + 1;

  const ensure = (name: string, parentId: string): string => {
    const trimmed = name.trim();
    if (trimmed === "") return "";
    const existing = partitions.find(
      (item) => item.parentId === parentId && item.name.trim() === trimmed,
    );
    if (existing !== undefined) return existing.id;
    const created: CoursePartition = {
      id: makeId(),
      name: trimmed,
      parentId,
      order: nextOrder(parentId),
    };
    partitions.push(created);
    onChange?.(created);
    return created.id;
  };

  /*
   * 先把栏目建好，再建子栏目。
   *
   * 顺序在这里是**语义**而不是风格：子栏目需要父 id，而父 id 只有建好之后才知道。
   * 一边遍历一边建也能work（ensure 是幂等的），但两趟更清楚 —— 而且"先栏目后子栏目"
   * 正好也保证了新建栏目的 `order` 递增顺序与内容文件里的出现顺序一致。
   */
  const columns = new Map<string, string>();
  for (const ref of refs) {
    const name = ref.column.trim();
    if (columns.has(name)) continue;
    columns.set(name, name === "" ? "" : ensure(name, ""));
  }
  const subgroups = new Map<string, string>();
  for (const ref of refs) {
    const column = ref.column.trim();
    const subgroup = ref.subgroup.trim();
    if (column === "" || subgroup === "") continue;
    const key = `${column}\u0000${subgroup}`;
    if (subgroups.has(key)) continue;
    subgroups.set(key, ensure(subgroup, columns.get(column) ?? ""));
  }

  return {
    partitions,
    idOf: (column, subgroup) => {
      const columnId = columns.get(column.trim()) ?? "";
      if (subgroup.trim() === "") return columnId;
      return subgroups.get(`${column.trim()}\u0000${subgroup.trim()}`) ?? columnId;
    },
  };
}

/**
 * 把一个"分区路径"（栏目名 / 子栏目名）解析成 id，**不新建**。
 *
 * 用在读的方向：核对一份导出的课程表时，名字对不上就是"分区被删了/改了名"，
 * 那要如实报出来，而不是顺手建一个新分区把错误掩盖掉。
 */
export function resolvePartitionId(
  partitions: readonly CoursePartition[],
  column: string,
  subgroup = "",
): string {
  const columnNode = partitions.find(
    (item) => item.parentId === "" && item.name.trim() === column.trim(),
  );
  if (columnNode === undefined) return "";
  if (subgroup.trim() === "") return columnNode.id;
  return (
    partitions.find(
      (item) => item.parentId === columnNode.id && item.name.trim() === subgroup.trim(),
    )?.id ?? ""
  );
}
