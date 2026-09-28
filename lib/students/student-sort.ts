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
 * ## 「年级」这一列按**教学顺序**排，不按拼音（这一列专用的第五档键）
 *
 * 机构原话（我问他"年级现在按拼音排、初二会排在初一前面，要不要改成教学顺序"）：
 * 「**按教学顺序排（推荐）**」。
 *
 * 拼音排法在学校里是**错的**，而且错得很隐蔽：`初二`(chū'èr) < `初一`(chū'yī)，
 * 于是升序列表上**二年级排在一年级前面**、高一排在高三后面（降序时正好反过来）——
 * 屏幕上"排好了"与"排错了"长得一模一样，老师只会觉得"这列看着别扭"，
 * 没人会去点一下表头再喊一声。所以这一列不看字怎么念，只看**它是哪一段**。
 *
 * 键 ＝ **（学段级别, 年级级别）** 两段（`lib/students/student-sort.ts` 里唯一的映射表
 * `GRADE_STAGES`，见下）：
 *
 * | 写法（举例） | 键 |
 * | --- | --- |
 * | `一年级` … `六年级`、`小学五年级`、`5年级` | （**小学**, 1…6） |
 * | `初一` / `七年级`、`初二` / `八年级`、`初三` / `九年级` | （**初中**, 1 / 2 / 3）—— 两套写法**同一段** |
 * | `高一` / `高中一年级`、`高二`、`高三` | （**高中**, 1…3） |
 * | `小学` / `初中` / `高中`（只写学段、没写年级） | 该学段**末尾**（它是"这个学段，但没细分"） |
 * | `小升初` / `初升高` / `学前` / `成人` / 以后的新词 | 认不出 → **所有学段之后**（同级内部按拼音） |
 * | `""` | **空值**：仍然恒在最后（与其它列同一条规则） |
 *
 * 学段之间是 **小学 < 初中 < 高中**。之所以把"学段"单列成一段而不是把十来个年级
 * 排成一长串：机构库里**同一件事有两套写法**（`初二` 与 `八年级`），
 * 而 `小学五年级`、`7年级` 这种带前缀 / 阿拉伯数字的写法也真实存在；
 * 两段键让"说得出它属于哪一段"的写法**自动**落到同一段里，不必为每一种写法各写一条规则。
 *
 * **认不出来的写法不猜、也不丢**：机构以后写一个新说法（`小升初`），列表里照样看得见、
 * 排在所有认得出的年级**之后**，只是排不进教学顺序 —— 它不会变成一个"看不见的"错误
 * （不许筛掉、不许猜成"大概是一年级"）。**以后机构多了一种写法，只改这一张表**
 * （`GRADE_STAGES` 里那一行加一个 `writes`），别的代码一行都不动。
 *
 * **只影响「年级」这一列**：姓名 / 报读科目 / 教材 / 来源 / 剩余课时 / 状态 / 家长
 * 那七列的键与规则**一个字都没改**（它们仍然按拼音 / 数值 / 显示串比，`numeric: true` 照旧）。
 *
 * 降序（这一列）：段内**倒过来**（高三 → … → 一年级），但**并列的仍保持登记顺序**
 * （`初一` 与 `七年级` 是同一段，谁先登记谁在前 —— 与"并列稳定"是同一条规则，
 * 因此整条降序**不等于**升序逐条倒置）；认不出的那一批在降序里排在**最前**
 * （它是"比高三还大"的那一档）、批内**按拼音反向**；**空值仍在最后**。
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
 * 而字符串比较的 `"10" < "2"` 是错的。五档各自对应一种比较方式，
 * 空值单独一档（它**不受方向影响**，见文件头）。
 *
 * 前四档是 v52 就有的；**第五档 `grade`** 是「E21 续」为「年级」那一列加的
 * （为什么不是 `text`：见文件头"年级按教学顺序排"那一节）。
 */
export type SortValue =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "time"; readonly at: number }
  | {
      readonly kind: "grade";
      /** 学段级别：`0` 小学 / `1` 初中 / `2` 高中；`GRADE_STAGES.length` ＝ **认不出**那一档。 */
      readonly stage: number;
      /** 年级级别：`1…n`；**纯学段** ＝ `n + 1`（本学段末尾）；**认不出** ＝ `0`。 */
      readonly level: number;
      /** 这一段认不认得出来（认得出的同段＝并列；认不出的同段内**按拼音**）。 */
      readonly known: boolean;
      /** 归一化之后的原字（去空白、全角数字折半角）—— 认不出的那一档按它比拼音。 */
      readonly text: string;
    };

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

/* ── 年级：按**教学顺序**（机构：「按教学顺序排（推荐）」）──────────────────────
 *
 * 这一节是**全仓库唯一**一处"哪种年级写法属于哪一段"的实现（数据 + 这一小段解析），
 * 页面不认年级、别处也不许再写一份 `if (grade === "初二")` —— 两张表的下场是
 * "新建的学生排对了、导入进来的排错了"，而两种都在同一列上、肉眼分不出。
 */

/** 一个年级：`level` 是这一学段里的级别（1 起），`writes` 是机构会写的**全部写法**（不带学段前缀）。 */
type GradeSpec = {
  readonly level: number;
  readonly writes: readonly string[];
};

/** 一个学段：`name` 既是学段名、也是"只写学段"那种写法本身。 */
type GradeStageSpec = {
  readonly name: string;
  /** 这一学段的年级，**顺序＝教学顺序**（同级之间谁先写不影响：它们本来就是同一段）。 */
  readonly grades: readonly GradeSpec[];
};

/**
 * **年级 → 教学顺序** 的映射表（机构原话：「**按教学顺序排（推荐）**」）。
 *
 * 数组顺序 ＝ 学段的教学顺序：**小学 < 初中 < 高中**。
 * 每一行的 `grades` 顺序 ＝ 该学段内的年级顺序。
 *
 * 两套写法**刻意并排**（`初一` 与 `七年级` 都是 `level: 1`）—— 机构库里同一件事
 * 两种写法都有（`components/admin/StudentForm.tsx` 的候选里也是两套并排），
 * 它们是**同一个年级**，不是两个："初一"与"七年级"之间不该有先后。
 *
 * 数字**两种写法都认**（`5年级` 与 `五年级`）：全角数字先在 `normalizeGradeText`
 * 里折成半角，所以机构打成 `５年级` 也认得（他不会知道"全角"是什么）。
 *
 * ⚠️ **以后机构多了一种写法（例如写成「小二」「初二下」），只改这一张表**：
 * 在那个年级那一行的 `writes` 里加一个字符串就完事了 —— 解析、比较、页面、
 * 自检都不用动。**认不出来的写法**（`小升初` / `学前` / 以后的新词）落在表外 → 排在
 * **所有认得出的年级之后**（见 `gradeKeyOf`），列表里照样看得见，不会被筛掉、也不会被猜。
 */
export const GRADE_STAGES: readonly GradeStageSpec[] = [
  {
    name: "小学",
    grades: [
      { level: 1, writes: ["一年级", "1年级"] },
      { level: 2, writes: ["二年级", "2年级"] },
      { level: 3, writes: ["三年级", "3年级"] },
      { level: 4, writes: ["四年级", "4年级"] },
      { level: 5, writes: ["五年级", "5年级"] },
      { level: 6, writes: ["六年级", "6年级"] },
    ],
  },
  {
    name: "初中",
    // 初中部两种写法并存：`初一/初二/初三` 与 `七年级/八年级/九年级`（同一段）
    grades: [
      { level: 1, writes: ["一年级", "1年级", "七年级", "7年级", "初一"] },
      { level: 2, writes: ["二年级", "2年级", "八年级", "8年级", "初二"] },
      { level: 3, writes: ["三年级", "3年级", "九年级", "9年级", "初三"] },
    ],
  },
  {
    name: "高中",
    grades: [
      { level: 1, writes: ["一年级", "1年级", "高一"] },
      { level: 2, writes: ["二年级", "2年级", "高二"] },
      { level: 3, writes: ["三年级", "3年级", "高三"] },
    ],
  },
];

/**
 * 「认不出」那一档的学段级别 ＝ **学段表长度**（排在所有学段之后）。
 *
 * 不写死 `3`：以后表里再加一个学段（例如「大学」），"认不出的排最后"这一条**自动**继续成立。
 */
const UNKNOWN_GRADE_STAGE = GRADE_STAGES.length;

/**
 * 归一化：去掉**所有**空白、全角数字折成半角。
 *
 * 机构手打的是 `小学 五年级`、`７年级` 这种（全角、带空格）—— 它们与 `小学五年级`、`7年级`
 * 是同一件事，因此**在解析之前**先抹平，不是在每种写法里各写一条。
 */
function normalizeGradeText(raw: string): string {
  return raw
    .replace(/\s+/g, "")
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

/** 某学段里，这个写法是几年级（不是这一学段的写法 → `null`）。 */
function gradeLevelOf(stage: GradeStageSpec, token: string): number | null {
  for (const grade of stage.grades) {
    if (grade.writes.includes(token)) return grade.level;
  }
  return null;
}

/** 一个年级键（`stage` / `level` / `known` 三样就是比较要用的全部信息）。 */
type GradeKey = {
  readonly stage: number;
  readonly level: number;
  readonly known: boolean;
};

/**
 * 认一段年级写法（已归一化）→ （学段级别, 年级级别）。
 *
 * 两条规则，都不猜：
 *   1. **带学段前缀**（`小学五年级` / `初中二年级`）：只在这个学段里找那个年级
 *      （`初中一年级` ＝ 初一）。**学段里没有这个年级**（`小学七年级`）＝ 自相矛盾 → 认不出
 *      （宁可排后面，也不把它猜成"小学七年级"或"初中七年级"）；
 *   2. **不带前缀**（`一年级` / `7年级` / `初二` / `高一`）：按学段的教学顺序**先到先得**。
 *      于是 `一年级…六年级` → 小学（机构的小学就是"一年级"那套叫法），
 *      `七年级` → 初中（小学没有七年级），`高一` → 高中。
 *
 * 只写学段（`小学`）→ 该学段**末尾**（`grades.length + 1`）：它是"这一学段，但没细分"，
 * 排在小学六年级**之后**、初中一年级**之前**才对 —— 它不是"空值"（学段是知道的）。
 *
 * 其余一律认不出 → 学段级别 `UNKNOWN_GRADE_STAGE`、级别 `0`，落在**所有年级之后**。
 */
function gradeKeyOf(text: string): GradeKey {
  for (let stage = 0; stage < GRADE_STAGES.length; stage += 1) {
    const spec = GRADE_STAGES[stage]!;
    if (!text.startsWith(spec.name)) continue;
    const rest = text.slice(spec.name.length);
    // 只写学段：本学段末尾
    if (rest === "") return { stage, level: spec.grades.length + 1, known: true };
    const level = gradeLevelOf(spec, rest);
    if (level !== null) return { stage, level, known: true };
    // 带前缀、但这一学段里没有这个年级（小学七年级）：自相矛盾 → 不猜
    return { stage: UNKNOWN_GRADE_STAGE, level: 0, known: false };
  }
  for (let stage = 0; stage < GRADE_STAGES.length; stage += 1) {
    const level = gradeLevelOf(GRADE_STAGES[stage]!, text);
    if (level !== null) return { stage, level, known: true };
  }
  return { stage: UNKNOWN_GRADE_STAGE, level: 0, known: false };
}

/**
 * 年级键：**（学段级别, 年级级别）**，**只给「年级」这一列用**（见文件头那一节）。
 *
 * 空串 / 全空白 → 空值那一档（仍然恒在最后）；认不出的写法 → 排在所有认得出的年级之后。
 */
export function gradeValue(raw: string | null | undefined): SortValue {
  const text = normalizeGradeText(raw ?? "");
  if (text === "") return EMPTY;
  const key = gradeKeyOf(text);
  return { kind: "grade", stage: key.stage, level: key.level, known: key.known, text };
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
    case "grade":
      return value.text;
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
  if (a.kind === "grade" && b.kind === "grade") {
    // 两段键：先学段（小学 < 初中 < 高中 ），再年级
    if (a.stage !== b.stage) return a.stage - b.stage;
    if (a.level !== b.level) return a.level - b.level;
    /*
     * 落到同一段：`初一` / `七年级` / `7年级` 是**同一个年级** → 并列，返回 0，
     * 由 `sortByValues` 的下标 tiebreak 保持登记顺序（不是按字面拼音再排一次 ——
     * 那等于说"七年级"和"初一"之间还有先后）。
     *
     * 认不出的那些都挤在最后一档（学段级别＝`GRADE_STAGES.length`），它们之间
     * **按拼音**：否则"小升初 / 成人"谁在前就只剩登记顺序说了算，而这一档本来就是
     * "系统认不出"的意思，不该再假装有教学顺序。
     */
    if (a.known && b.known) return 0;
    return COLLATOR.compare(a.text, b.text);
  }
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
  {
    field: "grade",
    label: "年级",
    /*
     * **八列里唯一一个不用 `textValue` 的**：年级按**教学顺序**排（小学一年级…高三），
     * 不按拼音 —— 拼音会把初二排到初一前面（见文件头那一节与 `GRADE_STAGES`）。
     * 其余七列的键与规则一个字没改。
     */
    valueOf: (student) => gradeValue(student.grade),
  },
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
