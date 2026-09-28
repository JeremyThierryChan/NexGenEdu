/**
 * 学生列表的「按字段升降序排序」——**比较规则只有这一处实现**。
 *
 * 机构原话：「**在学生列表里每个字段都加一个可以按升降排序的功能**」。
 *
 * ## 为什么单独成一个文件（这是这一版最重要的一个取舍）
 *
 * 散在页面 JSX 里的 `sort((a, b) => …)` 有几条规则**没法靠人眼验**：中文要按拼音、
 * `学生2` 要排在 `学生10` 前面、空值要恒在最后、并列的要保持原来的顺序 ——
 * 这些"看起来排好了"与"其实排错了"在屏幕上**长得一模一样**。
 * 因此整块规则搬到这里，页面只调用；`scripts/check.mts` §52 逐条钉住它。
 * 它是**纯函数**（不看 DOM、不问网络、不读存储、不改入参），所以自检在 Node 里直接跑，
 * 不需要浏览器。
 *
 * ## 三态循环：升序 → 降序 → 取消
 *
 * 点同一个表头依次是 **升序 → 降序 → 取消**。第三档**不是可选项**：
 * 少了它，点过一次之后**再也回不到列表本来的顺序**，而那个顺序是机构自己的登记顺序
 * （`students.list()` 给的那一份）——「想看按年级排」不该变成「把默认顺序弄丢了」。
 * 换一列点时从**升序**重新开始（人的预期是"先给我从小到大看一遍"）。
 *
 * ## 空值一律排最后（升序、降序都在最后）
 *
 * `""`、`[]`、以及显示成「—」的那种（没报课 / 教材未填 / 来源未填）都是**还没补的东西**。
 * 升序把它们顶在最前 = **待补的信息占榜首**，每次打开列表第一行都是空白；
 * 降序它们又会挤到中间。因此空值**不参与方向翻转**，永远在最后 ——
 * 与仓库既有的「暂未开放一律往后排」（`lib/backend/availability-order.ts`）同一个取向：
 * 待补的东西不该占榜首。
 *
 * ## 稳定：并列的保持默认顺序
 *
 * 判据用"装饰 → 排序 → 还原"，把**原来的下标**显式写成 tiebreak，
 * 而不是靠 `Array#sort` 的稳定性：稳定性在这里是**语义**
 * （同一批人每次刷新、每次点都要一样），交给引擎实现就说不清了。
 *
 * ## 多值字段（报读科目 / 教材）按**显示出来的那一串**比
 *
 * 显示口径各只有一处（`subjectsSummary` / `textbookSummary`），这里**复用**它们，
 * 不另拼一份：另拼一份的下场是"屏幕上写着「数学·八年级教材」、排序却按模块 id 的字母排"，
 * 两种顺序对不上时没有任何断言看得出来。因此教材那一列需要 `catalog`
 * （没有它就没有显示串）—— 读不到课程类型时那一列在页面上显示 `…`，
 * 这时**整列当作没值**（全部并列 → 保持默认顺序），而不是拿 id 去猜一个顺序。
 *
 * ## 不排序 = 默认顺序逐条一致
 *
 * `sortStudents(students, null, …)` 返回**同序的一份拷贝**：加了排序之后，
 * 默认顺序与这一版之前**逐条相同**（不许因为"反正能排序"就把默认顺序改了）。
 *
 * ## 不持久化
 *
 * 这个模块不读也不写任何存储。排序是**当前这一屏的看法**、不是数据：
 * 页面把它放在组件 state 里，刷新就回到默认顺序（取舍写在页面那一处注释里）。
 */
import { remainingTotal, subjectsSummary } from "../backend/enrollment";
import { textbookSummary } from "../backend/textbooks";
import type { Catalog, Student } from "../backend/types";

/**
 * 中文拼音序的比较器（全仓库唯一一处 `Intl.Collator`）。
 *
 * `zh-Hans-CN` + `numeric: true`：
 *   - 中文按**拼音**排（`陈` < `李` < `王` < `张`），不是按码位；
 *   - 带数字的写法按**每一段数字的数值**比：`学生2` 在 `学生10` 前面
 *     （`八年级`、手机号、`单元10` 这类写法都照着人念的顺序）；
 *   - 建一次、反复用：`Intl.Collator` 的构造不便宜，而列表每次重排都要用它。
 */
const COLLATOR = new Intl.Collator("zh-Hans-CN", { numeric: true });

/** 升序还是降序。 */
export type SortDirection = "asc" | "desc";

/**
 * 一个排序键。
 *
 * 为什么不是"直接给个字符串"：数字列（剩余课时）按**数值**比、日期列按**时间**比，
 * 而字符串比较的 `"10" < "2"` 是错的。四档各自对应一种比较方式，
 * 空值单独一档（它**不受方向影响**，见文件头）。
 */
export type SortValue =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "time"; readonly at: number };

/** 空值那一档（只造一次，免得每次比较都新建对象）。 */
const EMPTY: SortValue = { kind: "empty" };

/** 这一档是不是"没有值"。 */
export function isSortEmpty(value: SortValue): boolean {
  return value.kind === "empty";
}

/**
 * 文本键：去前后空白，**空的算"没有值"**（不是"一个空字符串"排在字母最前）。
 */
export function textValue(raw: string | null | undefined): SortValue {
  const text = (raw ?? "").trim();
  return text === "" ? EMPTY : { kind: "text", text };
}

/**
 * **显示口径已经是「—」**的那些字段（`textbookSummary` / `subjectsSummary`）。
 *
 * 「—」不是一个值，它是"这里还没填"的显示形态 —— 因此它也归到空值那一档，
 * 与 `""` 一样恒在最后（否则没报课的学生在升序时会排在"还没填"的榜首位置）。
 */
export function displayValue(shown: string): SortValue {
  const text = shown.trim();
  return text === "" || text === "—" ? EMPTY : { kind: "text", text };
}

/**
 * 数字键：按**数值**比（不是按字符串）。
 *
 * `NaN` / `Infinity` 归到空值：`a - b` 一旦算出 `NaN`，`sort` 的比较函数就再也说不清
 * 谁前谁后（顺序变成"看引擎实现"），因此这种值当作"没有值"处理 —— 排在最后，且**稳定**。
 */
export function numberValue(value: number): SortValue {
  return Number.isFinite(value) ? { kind: "number", value } : EMPTY;
}

/**
 * 日期键：按**时间**比（不是按字符串）。
 *
 * 为什么必须有这一档：ISO 串恰好按字符串比也对，可**人写的日期不是 ISO**
 * （`2026-9-2`）：按字符串比它排在 `2026-10-01` **之后**（`1` < `9`），
 * 按时间比才对（9 月 2 日在前）。解析不出来的当作没有值。
 *
 * ⚠️ 学生列表这九列里现在**没有日期列**（年龄/生日在采集表的详情里，不在列表上）。
 * 这一档不是为它准备的装饰：`sortByValues` 是导出给全仓库用的同一个比较器，
 * 台账 / 记录类列表上那一类列要按时间比时就调它，而规则（含"空值恒在最后"）
 * 不必在第二个地方再写一遍。§52 直接钉这一档的行为。
 */
export function timeValue(raw: string): SortValue {
  const at = Date.parse(raw);
  return Number.isNaN(at) ? EMPTY : { kind: "time", at };
}

/** 混档比较时（正常不会发生）用的文本形态：只为了让比较函数**全定义**，不会返回 NaN。 */
function asText(value: SortValue): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "number":
      return String(value.value);
    case "time":
      return new Date(value.at).toISOString();
    case "empty":
      return "";
  }
}

/**
 * 比两个排序键（**不含方向**）。
 *
 * 空值那一档在这里就已经分到后面：调用方翻方向时**不翻它**（见 `sortByValues`），
 * 因此"空值恒在最后"只在**一处**决定 —— 不必在十几处 `if (空) return 1` 里各写一遍。
 */
export function compareSortValues(a: SortValue, b: SortValue): number {
  if (a.kind === "empty" || b.kind === "empty") {
    if (a.kind === b.kind) return 0;
    return a.kind === "empty" ? 1 : -1;
  }
  if (a.kind === "number" && b.kind === "number") return a.value - b.value;
  if (a.kind === "time" && b.kind === "time") return a.at - b.at;
  return COLLATOR.compare(asText(a), asText(b));
}

/**
 * 稳定排序：按 `valueOf` 给出的键排，并列的**保持默认顺序**。
 *
 * 两件事在这一处写死，别处不必再想：
 *   1. **空值恒在最后**（升序降序都一样）：`compareSortValues` 分出来的先后
 *      **不乘方向**；
 *   2. **不就地改入参**：`items.map(…)` 先造一份带下标的副本再排它 ——
 *      调用方手上那一份（页面里直接就是 `students`）一个字节都不动。
 */
export function sortByValues<T>(
  items: readonly T[],
  valueOf: (item: T) => SortValue,
  direction: SortDirection,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return items
    .map((item, index) => ({ item, index, value: valueOf(item) }))
    .sort((a, b) => {
      const byValue = compareSortValues(a.value, b.value);
      const ordered = isSortEmpty(a.value) || isSortEmpty(b.value) ? byValue : byValue * sign;
      // 并列 → 用**原来的下标**，这就是"稳定"的写法（不靠 Array#sort 的稳定性）
      return ordered !== 0 ? ordered : a.index - b.index;
    })
    .map((row) => row.item);
}

/**
 * 学生列表上**能排序的列**（顺序＝页面上表头的顺序）。
 *
 * 每一列写清三样：`field`（页面用它点、用它记当前排序）、`label`（表头文案，
 * 页面从这一份取，免得"表头改了字、排序键还是旧的"）、`valueOf`（排序键）。
 *
 * ⚠️ **最右边的「操作」列不在这里**：它不是字段，是两个按钮
 * （「编辑」（展开时写作「收起」）与「删除」），"按操作排序"没有含义。
 * 页面上那一格仍然是普通 `<th>`。
 */
export type StudentSortColumn = {
  readonly field: StudentSortField;
  /** 表头文案（`<th>` 只用这一份）。 */
  readonly label: string;
  /** 这一列的排序键；`catalog` 只有「教材」那一列用得上（见文件头）。 */
  readonly valueOf: (student: Student, catalog: Catalog | null) => SortValue;
};

/** 学生列表上**能排序的字段**（＝九列里的八个字段列，不含「操作」）。 */
export type StudentSortField =
  | "name"
  | "grade"
  | "subjects"
  | "textbooks"
  | "source"
  | "remaining"
  | "status"
  | "guardian";

/** 八个字段列（顺序＝表头顺序；页面照着渲染排序按钮）。 */
export const STUDENT_SORT_COLUMNS: readonly StudentSortColumn[] = [
  { field: "name", label: "姓名", valueOf: (student) => textValue(student.name) },
  { field: "grade", label: "年级", valueOf: (student) => textValue(student.grade) },
  {
    field: "subjects",
    label: "报读科目",
    // 多值：按**显示出来的那一串**比（显示口径只有 `subjectsSummary` 一处）
    valueOf: (student) => displayValue(subjectsSummary(student.subjects)),
  },
  {
    field: "textbooks",
    label: "教材",
    /*
     * 多值：按 `textbookSummary` 那一串比（`数学·八年级教材、物理·必修教材`）——
     * 与页面上那一格显示的是同一个函数算出来的，因此"排出来的顺序"与"看到的顺序"对得上。
     * 读不到课程类型时（页面上那一列显示 `…`）整列当作没值：全部并列 → 保持默认顺序。
     */
    valueOf: (student, catalog) =>
      catalog === null ? EMPTY : displayValue(textbookSummary(catalog, student.textbooks)),
  },
  { field: "source", label: "来源", valueOf: (student) => textValue(student.source) },
  {
    field: "remaining",
    label: "剩余课时",
    // 数字：**按数值**比（`10` 在 `9` 后面，不是按字符串的 `"10" < "9"`）
    valueOf: (student) => numberValue(remainingTotal(student.enrollments)),
  },
  { field: "status", label: "状态", valueOf: (student) => textValue(student.status) },
  { field: "guardian", label: "家长", valueOf: (student) => textValue(student.guardian) },
];

/** 取某一列的定义（`field` 是联合类型，因此正常查得到；查不到是代码写错了）。 */
export function studentSortColumn(field: StudentSortField): StudentSortColumn {
  const found = STUDENT_SORT_COLUMNS.find((column) => column.field === field);
  if (found === undefined) throw new Error(`没有这一列：${String(field)}`);
  return found;
}

/** 表头文案（页面不自己写一份字面量，见 `StudentSortColumn.label`）。 */
export function studentSortLabel(field: StudentSortField): string {
  return studentSortColumn(field).label;
}

/** 当前排序：`null` ＝ 没排序（**列表本来的顺序**）。 */
export type StudentSort = { readonly field: StudentSortField; readonly direction: SortDirection } | null;

/**
 * 排一批学生（页面在"筛完"之后调它 —— 排序作用在**当前这一批**上，不改变筛选结果）。
 *
 * 传入 `readonly Student[]` 且返回新数组：页面手上那一份（`students` / `visible`）不动，
 * 排序**不改数据**（§52 有反向断言：排来排去之后学生对象逐字节不变）。
 */
export function sortStudents(
  students: readonly Student[],
  sort: StudentSort,
  catalog: Catalog | null,
): Student[] {
  // 不排序：同序的一份拷贝（默认顺序与没有这个功能时**逐条一致**）
  if (sort === null) return [...students];
  const column = studentSortColumn(sort.field);
  return sortByValues(students, (student) => column.valueOf(student, catalog), sort.direction);
}

/**
 * 点一下表头之后是什么（三态循环，见文件头）：
 *
 * | 现在的状态 | 点这一列 | 点别的列 |
 * | --- | --- | --- |
 * | 没排序 | **升序** | **升序**（换列＝从头开始） |
 * | 这一列的升序 | **降序** | 那一列的升序 |
 * | 这一列的降序 | **取消**（回默认顺序） | 那一列的升序 |
 */
export function nextStudentSort(current: StudentSort, field: StudentSortField): StudentSort {
  if (current === null || current.field !== field) return { field, direction: "asc" };
  if (current.direction === "asc") return { field, direction: "desc" };
  return null;
}

/**
 * `<th>` 上的 `aria-sort`：当前列给 `ascending` / `descending`，
 * **其余列（含"没排序"）给 `undefined`** —— 这时 React 不会渲染这个属性，
 * 屏幕阅读器读到的是"这一列没排序"，而不是"这一列不支持排序"。
 */
export function studentSortAriaValue(
  sort: StudentSort,
  field: StudentSortField,
): "ascending" | "descending" | undefined {
  if (sort === null || sort.field !== field) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * 表头里的箭头：当前排序列给 ▲ / ▼，其余列给**空串**（不显示箭头）。
 *
 * ⚠️ 与"展开学生详情"那个 ▲/▼（在**姓名那一格里**，跟着 `openId` 走）是两件事：
 * 形状一样，含义完全不同。两者只是恰好挨在同一列上（按姓名排序时）——
 * 表头那个表示"这一列按什么方向排着"，格子里那个表示"这个学生的详情展开着没有"。
 * 屏幕阅读器不会混：表头那个在按钮里、方向由 `<th>` 的 `aria-sort` 说，
 * 格子那个在姓名按钮里，两者各自的按钮文案不同。
 */
export function studentSortIndicator(sort: StudentSort, field: StudentSortField): string {
  if (sort === null || sort.field !== field) return "";
  return sort.direction === "asc" ? "▲" : "▼";
}
