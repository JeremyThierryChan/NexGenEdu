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
 * 空的库与示例库都要有这十二门课，否则新建一个库就会出现"报价里有 44 门课、
 * 课程库里只有 32 门"——正是这次要修掉的那个错位。两份各抄一遍必然会漂，
 * 所以只有这一处定义。
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
  { name: "医学", stage: "其他类型", subjects: ["专业外语"], modules: [], status: "暂未开放" },
  { name: "机械行业英语", stage: "其他类型", subjects: ["专业外语"], modules: [], status: "暂未开放" },
  { name: "贸易", stage: "其他类型", subjects: ["专业外语"], modules: [], status: "暂未开放" },
  { name: "成人旅游、出行", stage: "其他类型", subjects: ["成人英语口语"], modules: [], status: "开放" },
  { name: "跨国交友", stage: "其他类型", subjects: ["成人英语口语"], modules: [], status: "暂未开放" },
];

/** 与网站卡片一致的四种班型（后台课也照写，免得台账上这一栏是空的）。 */
const FORMS = ["一对一定制课", "一对二 / 一对三小组课", "一对多小班课", "9 人以上大班课"];

/** 这门课为什么在库里（写在 `note` 上，台账里一眼能看出来路）。 */
const NOTE = "旧报价里有、网站卡片上没有的课（2026-09 报价与课程清单对齐时建）";

/** 这十二门课的名字（自检与单据用它比对，不必再抄一份清单）。 */
export const EXTRA_COURSE_NAMES: readonly string[] = SPECS.map((spec) => spec.name);

/**
 * 这门课该挂哪些维度（**按名字查这份清单**）；不在这份清单里返回 `null`。
 *
 * 迁移要用它：老的库升上来时，维度是按名字猜的（`suggestCourseDimensions`），
 * 而这份清单里的名字猜不出学科 ——「小学奥数」里没有学科名，「中考冲刺」横跨五科。
 * 猜不出来的后果是：升级上来的库把这十二门课全列进"还没挂到维度上的课程"，
 * 而它们本来就在这份清单里写清楚了。
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

/**
 * 造出这十二门课。
 *
 * id 写成 `course-extra-<序号>`：**稳定且可读**（自检与夹具要靠它比对，
 * 随机 id 会让"同一份数据两次构造结果不同"，那样 `check` 就没法断"空库与示例库一致"）。
 */
export function extraCourses(): Course[] {
  return SPECS.map((spec, index) => ({
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
  }));
}
