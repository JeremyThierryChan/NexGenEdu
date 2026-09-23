import { catalogId } from "./catalog-seed";
import type { Course } from "./types";

/**
 * **报价里有、网站卡片上没有的那些课**（机构口径：不要删，建成课程库里的课）。
 *
 * ## 这一份是怎么来的
 *
 * 网站的报价页原先按「年级 / 备考档位」分档（七年级课本 220、八年级课本 260、
 * 高中必修 300、中考冲刺 350…），而课程库是按**学科**的（初中数学、高中物理、雅思…）。
 * 两套轴对不上，于是出现一个自相矛盾的中间态：**报价页上有 20 门"课程"，课程库里一门都没有**
 * （v25 那套"报价跟着课程库走"的打通机制因此完全空转 —— 名字对不上，谁也没认领谁）。
 *
 * 2026-09 机构定了三件事，把两边对齐（见 PROJECT.md 的 E9）：
 *
 *   1. 报价的**分组**换成课程类型的学段（小学 / 初中 / 高中 / 其他类型）；
 *   2. 报价里的**课程名以课程库为准**；
 *   3. 报价里有、课程库里没有的那些（小学奥数、中考冲刺、特殊计划专项、医学…）
 *      **建成课程库里的课**，不要从价目表上删掉。
 *
 * 这一份就是第 3 条的产物。
 *
 * ## 为什么它们 `siteKind: "不展示"`
 *
 * 网站的课程卡片不是"有一条课程行就出现"：每张卡片都要在课程正文里对应一段小节
 * （`scripts/check.mts` 有断言钉着「每张卡片都有页面数据」）。凭空多出十来张没有正文的卡片，
 * 课程页会变成一排点进去空白的条目 —— 那不是"以课程清单为准"，那是把网站弄花。
 *
 * 因此这十二门课是**只在后台用的课**：排得了课、报得了课、定得了价、台账里看得到、
 * 维度也挂好了；要上网站（加卡片 + 写正文）随时说一句，改一个字段的事
 * （`siteKind` 与 `path`）。
 *
 * ## 为什么放在 `initial.ts` 与 `seed.ts` **共用**
 *
 * 空的库与示例库都要有这几门课，否则新建一个库就会出现"报价里有 44 门课、
 * 课程库里只有 32 门"——正是这次要修掉的那个错位。两份各抄一遍必然会漂，
 * 所以只有这一处定义。
 *
 * ⚠️ 2026-09 起**判据是数据的、不是这份清单的**（见 `extraCourses` 的说明）：
 * 「报价里有 ∩ 网站卡片上没有」—— 机构删掉一门课、报价里那一行也跟着删之后，
 * 新建的库**不该把它再造回来**（机构原话：「课程报价里面删掉的课还是会出现」，
 * PROJECT.md 的 E14）。
 */

/** 一门"只在后台用"的课：名字、学段、学科、模块（`学科·模块名`）、状态。 */
type ExtraCourseSpec = {
  name: string;
  stage: string;
  subjects: string[];
  /** 写成 `学科·模块名`（模块 id 是"学科 + 模块名"派生的，见 `catalogId`）。 */
  modules: string[];
  status: Course["status"];
};

/**
 * 十二门课。
 *
 * 状态与「要不要上网」无关：**开放 / 暂未开放是"这门课现在收不收学生"**，
 * 与网站卡片是两件事（后台台账里两者都看得见）。
 * 这里的取值沿用旧报价页上的口径（当时写的「暂未开放」就仍是暂未开放）。
 */
const SPECS: readonly ExtraCourseSpec[] = [
  { name: "小学奥数", stage: "小学", subjects: ["数学"], modules: [], status: "开放" },
  { name: "小学英语竞赛", stage: "小学", subjects: ["英语"], modules: [], status: "开放" },
  {
    name: "小升初",
    stage: "初中",
    subjects: ["小升初预习班"],
    modules: ["小升初预习班·七年级教材"],
    status: "开放",
  },
  // 备考专项是**跨学科**的：学科挂上该学段的各科（台账里显示为"多学科卡片"），
  // 模块留空 —— 教材进度是"某一科的某一册"，一门覆盖五科的专项谈不上这个
  { name: "中考冲刺", stage: "初中", subjects: ["语文", "数学", "英语", "科学", "社会"], modules: [], status: "开放" },
  { name: "提前招专项", stage: "初中", subjects: ["语文", "数学", "英语", "科学", "社会"], modules: [], status: "开放" },
  {
    name: "高考冲刺",
    stage: "高中",
    subjects: ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "技术"],
    modules: [],
    status: "开放",
  },
  {
    name: "特殊计划专项",
    stage: "高中",
    subjects: ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "技术"],
    modules: [],
    status: "开放",
  },
  /*
   * 专业英语（旧报价里的「专业英语」一组）：医学 / 机械 / 贸易，当时就是暂未开放。
   *
   * 「机械」在 2026-09 由机构在后台改名为「**机械行业英语**」（报价那一行也跟着改了）——
   * 这里必须跟着改：报价的课程名与课程库的课程名是一一对应的（`npm run check` 第一节
   * 与第 41 节都钉着这条），名字不跟就会出现"报价里有、课程库里没有"那套老毛病。
   */
  { name: "医学专业英语", stage: "其他类型", subjects: ["专业外语"], modules: [], status: "暂未开放" },
  { name: "机械行业英语", stage: "其他类型", subjects: ["专业外语"], modules: [], status: "暂未开放" },
  { name: "贸易行业英语", stage: "其他类型", subjects: ["专业外语"], modules: [], status: "暂未开放" },
  { name: "成人旅游、出行", stage: "其他类型", subjects: ["成人英语口语"], modules: [], status: "开放" },
  { name: "跨国交友", stage: "其他类型", subjects: ["成人英语口语"], modules: [], status: "暂未开放" },
];

/**
 * 与网站卡片一致的**五个班型**（后台课也照写，免得台账上这一栏是空的）。
 *
 * 2026-09 机构把班型统一成这五个、其余写法全部清空（见 PROJECT.md 的 E13），
 * 因此这里与 `catalog.formats`、与 42 张卡片的「班型」逐字同名 ——
 * 三处写法不一致时，卡片上的班型会在特色课程树里查不到（`npm run check` 有断言盯着）。
 */
const FORMS = ["一对一", "一对二", "一对三", "小班课（4-8人）", "大班课（9-20人）"];

/** 这门课为什么在库里（写在 `note` 上，台账里一眼能看出来路）。 */
const NOTE = "旧报价里有、网站卡片上没有的课（2026-09 报价与课程清单对齐时建）";

/** 这十二门课的名字（自检与单据用它比对，不必再抄一份清单）。 */
export const EXTRA_COURSE_NAMES: readonly string[] = SPECS.map((spec) => spec.name);

/**
 * 这门课该挂哪些维度（**按名字查这份清单**）；不在这份清单里返回 `null`。
 *
 * 两端都要用它：① 迁移时老库升上来，维度是按名字猜的（`suggestCourseDimensions`），
 * 而这份清单里的名字猜不出学科 ——「小学奥数」里没有学科名，「中考冲刺」横跨五科；
 * ② `materializeSiteCourses()`（空库 / 示例库）建网站卡片时同理。
 * 猜不出来的后果是：这些课全被列进"还没挂到维度上的课程"，而它们的口径本来就在
 * 这份清单里写清楚了 —— **判据只有这一处**。
 */
export function extraCourseDimensions(
  name: string,
): { stageIds: string[]; subjectIds: string[]; moduleIds: string[] } | null {
  const spec = SPECS.find((item) => item.name === name);
  if (spec === undefined) return null;
  return {
    stageIds: [catalogId("st", spec.stage)],
    subjectIds: spec.subjects.map((subject) => catalogId("subj", subject)),
    moduleIds: spec.modules.map((key) => catalogId("mod", key)),
  };
}

/** `course-extra-<序号>`：**稳定且可读**（自检与夹具要靠它比对；随机 id 会让"同一份数据两次构造结果不同"）。 */
function extraCourseOf(spec: ExtraCourseSpec, index: number): Course {
  return {
    id: `course-extra-${index + 1}`,
    version: 1,
    name: spec.name,
    // 没有分区：它们是后台课，网站课程页按分区渲染，与它们无关
    partitionId: "",
    forms: [...FORMS],
    origin: "后台",
    status: spec.status,
    note: NOTE,
    createdAt: "",
    path: "",
    tags: [],
    target: "",
    order: 100 + index,
    intro: "",
    siteKind: "不展示",
    stageIds: [catalogId("st", spec.stage)],
    subjectIds: spec.subjects.map((name) => catalogId("subj", name)),
    moduleIds: spec.modules.map((key) => catalogId("mod", key)),
  };
}

/**
 * 造出 `SPECS` 里**"报价里有、网站卡片上没有"的那些课**（建库 / 迁移用）。
 *
 * ## 判据就是这句话本身：`报价里有` ∩ `网站卡片上没有`
 *
 * 原先只按"卡片上有没有"过滤，靠一条**手工约定**让 `SPECS` 与报价清单保持一致
 * （文件头那段："这里必须跟着改……名字不跟就会出现「报价里有、课程库里没有」"）。
 * 那份约定在 2026-09 破了：机构把「高考冲刺」「特殊计划专项」从课程库里删掉，
 * 报价配置里那两行也跟着删了（`syncLibraryLinks` 的第 4 件），而 `SPECS` 是人写的、
 * 跟不上 —— 于是**新建一个库就会把那两门课再造回来**，正是机构抱怨的
 * 「删掉的课还是会出现」。因此第二个入参 `pricedNames` 是**必需**的：
 * 让"哪些课该存在"由**数据**决定，而不是由一份手工维护的代码清单决定。
 *
 * ### 两个入参都必需，刻意不给默认值
 *
 * 默认值在这里是**危险的方便**：漏传一次，被删掉的课就会在一台新机器上复活，
 * 而且没有任何报错（只会看到课程清单里多出两门"不该有的课"）。
 * 要完整清单请直接用 `EXTRA_COURSE_NAMES`（`SPECS` 本身）。
 *
 * ## 去重：`coveredNames` 那一半
 *
 * 那十二门课 2026-09 全部上过网站（见 PROJECT.md 的 E12），上网之后它们由
 * `materializeSiteCourses()` 从**网站卡片**这条路建出来 —— 这里若再补一遍就是
 * **同名两条**（示例库 56 门课、其中 12 门重名），而报价与台账都是**按名字认领**的，
 * 重名一定会认错一门。
 *
 * 清单本身仍然有用：`extraCourseDimensions()` 是这十二门课的维度口径
 * （迁移与建库都查它），机构哪天把某门课重新加回报价，它也会带着正确维度回来。
 */
export function extraCourses(
  coveredNames: readonly string[],
  pricedNames: readonly string[],
): Course[] {
  const covered = new Set(coveredNames.map((name) => name.trim()).filter((name) => name !== ""));
  const priced = new Set(pricedNames.map((name) => name.trim()).filter((name) => name !== ""));
  return SPECS.map((spec, index) => ({ spec, index }))
    .filter(({ spec }) => !covered.has(spec.name) && priced.has(spec.name))
    .map(({ spec, index }) => extraCourseOf(spec, index));
}
