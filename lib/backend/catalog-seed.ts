/**
 * **课程类型分类的种子数据**（机构给的那份清单，逐条搬进来）。
 *
 * ## 这份文件是什么、不是什么
 *
 * 它是**维度**（学段 / 学科 / 内容模块 / 班型 / 交付形态）的初值，不是"课程清单"。
 * 里面**没有一条"课程"** —— 之所以这样，是因为机构那份清单铺开有 400 多条叶子，
 * 而它们全是下面这些维度的**乘积**：
 *
 *   学段 × 学科 × 内容模块 × 班型 × 交付形态
 *
 * 枚举法（一门课一条记录）在"加一个语种 / 加一级等级"时会让记录数翻倍，而且
 * AI 排课与诊断推荐只能靠"一个诊断项硬绑几门课"来对付。维度法的做法是：
 * **维度是数据，组合按需解析**（哪一条组合"开放"由机构在 P2 的矩阵里勾）。
 *
 * ## 转录时的三条判断（都不是我发明的，是从清单结构里读出来的）
 *
 * 1. **学科与学段解耦**：清单里写的是「小学语文 / 初中语文 / 高中语文」，但那是
 *    人手写树时把学段写进了名字。这里学科是「语文」，学段是它上面的维度 ——
 *    "小学语文" = 语文 × 小学（一条组合，不是一条学科记录）。
 * 2. **模块分三类**（`kind`）：`教材进度`（一年级…九年级教材 / 必修·选修）、
 *    `能力点`（客观题 / 阅读 / 文言文 / 作文 / 听力）、`语言等级`（CEFR-A1…B2 / N5…N1 / CET-4·6）。
 *    这不是分类癖：诊断推荐要区分"**跟上进度**"（教材进度）与"**补能力短板**"（能力点），
 *    而等级是"考什么证"。混在一起就没法按需筛选。
 * 3. **交付形态独立**：网课 / 网课+答疑 / 托管 / 全日托管 不是"班型"，也不该硬塞进
 *    学科里 —— 一门课可以"面授"，也可以"网课+答疑"，它们可以组合。
 *
 * ## 与机构原清单的三处差异（我按结构读出来的，若与原意不符请说）
 *
 *   - 「高中地理」在原清单里列了两次（生物后面又一次）：**按一次处理**（重复是笔误）；
 *   - 「一对二/一对三」在原清单里是一行：拆成两个班型 `一对二`、`一对三`
 *     （它们是两个不同的班级规模，价格系数也不同）；
 *   - 原清单里「网课+一对一针答疑」疑似漏字，按「网课+一对一针对性答疑」录入；
 *   - 意大利语 / 阿拉伯语只在「其他类型 → 外语等级考试」下出现（没有高中学科分支），
 *     因此它们的模块只有 CEFR 等级。
 *
 * ## id 是**确定性**的（`st_` / `subj_` / `mod_` / `fmt_` / `dlv_` 前缀 + 名字）
 *
 * 与其余实体用 `nextId()` 随机 id 不同：种子要**可重复执行**（重灌时认得出"这一条已经有了"），
 * 因此 id 由名字派生。名字改了 id 就变 —— 但那是"重新灌种子"的事，
 * 机构在后台改名走的是 `catalog.save`（id 不变，引用它的东西跟着走）。
 */
import type {
  Catalog,
  CatalogDelivery,
  CatalogFormat,
  CatalogModule,
  CatalogModuleKind,
  CatalogStage,
  CatalogSubject,
  CatalogSubjectKind,
} from "./types";

/** 一支种子（学科）在哪些学段开、下面有哪些模块。 */
type SubjectSeed = {
  name: string;
  kind: CatalogSubjectKind;
  /** 上级分组（例如「外语等级考试」下的「雅思」）；空串＝顶层。 */
  parent?: string;
  /** 这个学科在哪些学段开（空数组＝由分组或人工再定）。 */
  stages: string[];
  /** 模块（内容 / 能力 / 等级）。 */
  modules?: Array<{ name: string; kind: CatalogModuleKind; stages: string[] }>;
};

/** 学段（机构清单的第一层）。 */
const STAGES = ["小学", "初中", "高中", "大学", "其他类型"] as const;

/**
 * 班型（**唯一口径**）：以系统现行的那一套为准（`pricing.classTypes` 的五个班级类型），
 * 机构清单里那几种写法（一对一定制课 / 一对二 / 一对三小组课 / 一对多小班课 / 9 人以上大班课）
 * 都映射到它们。全系统按 **id** 引用班型，因此将来改名只改这里的 `name`。
 */
const FORMATS: Array<Pick<CatalogFormat, "name" | "minSize" | "maxSize" | "mode">> = [
  { name: "一对一", minSize: 1, maxSize: 1, mode: "系数" },
  { name: "一对二", minSize: 2, maxSize: 2, mode: "系数" },
  { name: "一对三", minSize: 3, maxSize: 3, mode: "系数" },
  { name: "一对多（4-8）", minSize: 4, maxSize: 8, mode: "系数" },
  { name: "班课（9-20）", minSize: 9, maxSize: 20, mode: "分摊" },
];

/** 交付形态：怎么上，不是班型。 */
const DELIVERIES: Array<Pick<CatalogDelivery, "name" | "schedulable">> = [
  { name: "面授", schedulable: true },
  { name: "网课", schedulable: true },
  { name: "网课+答疑", schedulable: true },
  { name: "托管", schedulable: true },
  { name: "全日托管", schedulable: true },
];

const GRADES_PRIMARY = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"];
const GRADES_PRIMARY_ENGLISH = ["三年级", "四年级", "五年级", "六年级"];
const GRADES_JUNIOR = ["七年级教材", "八年级教材", "九年级教材"];
const ABILITY_CHINESE = ["客观题", "阅读", "文言文", "作文"];
const ABILITY_LANGUAGE = ["听力", "客观题", "作文"];
const SENIOR_TEXTBOOK = ["必修教材", "选修教材"];
const CEFR = ["CEFR-A1", "CEFR-A2", "CEFR-B1", "CEFR-B2"];
const JLPT = ["N5", "N4", "N3", "N2", "N1"];

/** 内容模块的构造小工具：同 kind、同学段的模块一把写出来。 */
const mod = (
  names: readonly string[],
  kind: CatalogModuleKind,
  stages: string[],
): Array<{ name: string; kind: CatalogModuleKind; stages: string[] }> =>
  names.map((name) => ({ name, kind, stages }));

/**
 * 学科与项目（机构清单的第二、三层）。
 *
 * 顺序就是后台与网站上的展示顺序（`order` 按下标生成）。
 */
const SUBJECTS: SubjectSeed[] = [
  // ── 小学 ──
  { name: "语文", kind: "学科", stages: ["小学"], modules: mod(GRADES_PRIMARY, "教材进度", ["小学"]) },
  { name: "数学", kind: "学科", stages: ["小学"], modules: mod(GRADES_PRIMARY, "教材进度", ["小学"]) },
  { name: "英语", kind: "学科", stages: ["小学"], modules: mod(GRADES_PRIMARY_ENGLISH, "教材进度", ["小学"]) },
  { name: "科学", kind: "学科", stages: ["小学"], modules: mod(GRADES_PRIMARY_ENGLISH, "教材进度", ["小学"]) },

  // ── 初中 ──
  {
    name: "小升初预习班",
    kind: "项目",
    stages: ["初中"],
    modules: mod(["七年级教材"], "教材进度", ["初中"]),
  },
  { name: "语文", kind: "学科", stages: ["初中"], modules: mod(ABILITY_CHINESE, "能力点", ["初中"]) },
  { name: "数学", kind: "学科", stages: ["初中"], modules: mod(GRADES_JUNIOR, "教材进度", ["初中"]) },
  { name: "英语", kind: "学科", stages: ["初中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["初中"]) },
  { name: "科学", kind: "学科", stages: ["初中"], modules: mod(GRADES_JUNIOR, "教材进度", ["初中"]) },
  { name: "社会", kind: "学科", stages: ["初中"], modules: mod(GRADES_JUNIOR, "教材进度", ["初中"]) },

  // ── 高中 ──
  {
    name: "初升高预习班",
    kind: "项目",
    stages: ["高中"],
    modules: mod(["必修教材"], "教材进度", ["高中"]),
  },
  { name: "语文", kind: "学科", stages: ["高中"], modules: mod(ABILITY_CHINESE, "能力点", ["高中"]) },
  { name: "数学", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },
  { name: "英语", kind: "学科", stages: ["高中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["高中"]) },
  /*
   * 高考外语：日语 / 俄语 / 德语 / 法语 / 西班牙语 在高中这一支下按「听力 / 客观题 / 作文」分，
   * 与「其他类型 → 外语等级考试」下同一语种的 CEFR 等级**共用同一个学科**（见文件头的判断 1）。
   */
  { name: "日语", kind: "语言", stages: ["高中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["高中"]) },
  { name: "俄语", kind: "语言", stages: ["高中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["高中"]) },
  { name: "德语", kind: "语言", stages: ["高中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["高中"]) },
  { name: "法语", kind: "语言", stages: ["高中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["高中"]) },
  { name: "西班牙语", kind: "语言", stages: ["高中"], modules: mod(ABILITY_LANGUAGE, "能力点", ["高中"]) },
  { name: "政治", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },
  { name: "历史", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },
  { name: "地理", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },
  { name: "物理", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },
  { name: "化学", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },
  { name: "生物", kind: "学科", stages: ["高中"], modules: mod(SENIOR_TEXTBOOK, "教材进度", ["高中"]) },

  // ── 大学 ──
  {
    name: "英语",
    kind: "语言",
    stages: ["大学"],
    modules: mod(["CET-4", "CET-6"], "语言等级", ["大学"]),
  },

  // ── 其他类型 → 外语等级考试 ──
  { name: "雅思", kind: "语言", parent: "外语等级考试", stages: ["其他类型"] },
  { name: "托福", kind: "语言", parent: "外语等级考试", stages: ["其他类型"] },
  { name: "多邻国", kind: "语言", parent: "外语等级考试", stages: ["其他类型"] },
  { name: "剑桥英语证书", kind: "语言", parent: "外语等级考试", stages: ["其他类型"] },
  {
    name: "法语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(CEFR, "语言等级", ["其他类型"]),
  },
  {
    name: "德语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(CEFR, "语言等级", ["其他类型"]),
  },
  {
    name: "俄语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(CEFR, "语言等级", ["其他类型"]),
  },
  {
    name: "西班牙语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(CEFR, "语言等级", ["其他类型"]),
  },
  {
    name: "意大利语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(CEFR, "语言等级", ["其他类型"]),
  },
  {
    name: "阿拉伯语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(CEFR, "语言等级", ["其他类型"]),
  },
  {
    name: "日语",
    kind: "语言",
    parent: "外语等级考试",
    stages: ["其他类型"],
    modules: mod(JLPT, "语言等级", ["其他类型"]),
  },

  // ── 其他类型 → 专业外语 ──
  { name: "商务英语", kind: "语言", parent: "专业外语", stages: ["其他类型"] },
  { name: "体育英语", kind: "语言", parent: "专业外语", stages: ["其他类型"] },
  { name: "医学英语", kind: "语言", parent: "专业外语", stages: ["其他类型"] },

  // ── 其他类型 → 兴趣爱好 ──
  { name: "3D建模与3D打印", kind: "学科", stages: ["其他类型"] },

  // ── 其他类型 → 不分班型项目 ──
  { name: "网课", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
  { name: "网课+答疑", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
  { name: "网课+一对一针对性答疑", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
  { name: "小学托管", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
  { name: "初中托管", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
  { name: "学期全日托管", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
  { name: "假期全日托管", kind: "项目", parent: "不分班型项目", stages: ["其他类型"] },
];

/** 分组节点（机构清单里"外语等级考试 / 专业外语 / 不分班型项目"这三个中间层）。 */
const GROUPS: Array<{ name: string; stage: string }> = [
  { name: "外语等级考试", stage: "其他类型" },
  { name: "专业外语", stage: "其他类型" },
  { name: "不分班型项目", stage: "其他类型" },
];

/** 确定性 id：前缀 + 名字（种子可重复执行，见文件头）。 */
export const catalogId = (prefix: string, name: string): string => `${prefix}_${name.trim()}`;

/**
 * 把上面的紧凑写法**展开并合并**成库里的行（迁移、空库初始化、自检共用这一处）。
 *
 * ## 为什么要合并（这一条是这份种子的核心）
 *
 * 上面那份 `SUBJECTS` 是机构清单的**逐行转录**：清单里「小学语文 / 初中语文 / 高中语文」
 * 就是三行，因为人手写树时把学段写进了节点。但学段在这个模型里是**一个维度**，
 * 于是同一个名字在多个学段出现，必须合并成**一行学科 + 一个 `stageIds` 列表**：
 *
 *   - 不合并 → id 会重复（id 由名字派生），"语文"变成三条互不相干的学科，
 *     报价 / 排课 / 诊断引用的是学科 id，"小学的那条语文"与"初中的那条语文"就分家了；
 *   - 合并后 → 加一个学段只要勾一下，而不是再抄一遍学科（清单里加「小学科学」意味着
 *     是"科学 × 小学"，不是一门新学科）。
 *
 * 模块同理，而且合并范围是**整个学科**（不是单条 `SUBJECTS` 行）：
 * 语文的「客观题」在初中与高中各写了一遍 → 合成一行 `能力点`，`stageIds` 是 [初中, 高中]。
 *
 * `kind` 的取法（唯一一处需要判断的地方）：同一个名字在各学段可能被写成不同类别
 * （「英语」在小学 / 初中 / 高中是**学科**，在大学那一支写的是 **语言**（CET-4/6））。
 * 取"更宽的那个"：有 `学科` 就是 `学科`，否则有 `语言` 就是 `语言`，都没有才是 `项目`
 * —— 大学英语的"等级"这件事没有丢，它落在模块上（`语言等级`：CET-4 / CET-6）。
 */
export function catalogFromSeed(now: string = new Date().toISOString()): Catalog {
  const stages: CatalogStage[] = STAGES.map((name, index) => ({
    id: catalogId("st", name),
    name,
    order: index + 1,
    note: "",
  }));

  const formats: CatalogFormat[] = FORMATS.map((format, index) => ({
    id: catalogId("fmt", format.name),
    name: format.name,
    minSize: format.minSize,
    maxSize: format.maxSize,
    mode: format.mode,
    order: index + 1,
  }));

  const deliveries: CatalogDelivery[] = DELIVERIES.map((delivery, index) => ({
    id: catalogId("dlv", delivery.name),
    name: delivery.name,
    schedulable: delivery.schedulable,
    order: index + 1,
  }));

  /*
   * 学段的并集：按 `STAGES` 的固定顺序去重（同一份清单灌两次必须给出同一份结果，
   * 否则 `catalogFromSeed` 就不再是"可重复执行"的了）。
   */
  const unionStages = (lists: ReadonlyArray<readonly string[]>): string[] => {
    const wanted = new Set(lists.flat());
    return STAGES.filter((name) => wanted.has(name));
  };

  // 分组行（机构清单里那三个中间层）：它们自己不挂在上面的任何分组下
  const groups: CatalogSubject[] = GROUPS.map((group, index) => ({
    id: catalogId("subj", group.name),
    name: group.name,
    kind: "项目",
    parentIds: [],
    order: index + 1,
    stageIds: [catalogId("st", group.stage)],
    note: "",
  }));

  // 学科：按名字合并（清理见函数头）。`order` 取首次出现的顺序，分组排在前面。
  const mergedSubjects = new Map<string, { kinds: CatalogSubjectKind[]; stages: string[][]; parents: string[][] }>();
  for (const subject of SUBJECTS) {
    const current = mergedSubjects.get(subject.name) ?? { kinds: [], stages: [], parents: [] };
    current.kinds.push(subject.kind);
    current.stages.push(subject.stages);
    current.parents.push(subject.parent === undefined ? [] : [subject.parent]);
    mergedSubjects.set(subject.name, current);
  }

  const pickKind = (kinds: readonly CatalogSubjectKind[]): CatalogSubjectKind =>
    kinds.includes("学科") ? "学科" : kinds.includes("语言") ? "语言" : "项目";

  const subjects: CatalogSubject[] = [
    ...groups,
    ...[...mergedSubjects.entries()].map(([name, item], index) => ({
      id: catalogId("subj", name),
      name,
      kind: pickKind(item.kinds),
      parentIds: [...new Set(item.parents.flat())].map((parent) => catalogId("subj", parent)),
      order: groups.length + index + 1,
      stageIds: unionStages(item.stages).map((stage) => catalogId("st", stage)),
      note: "",
    })),
  ];

  /*
   * 模块：先按**学科名**把各学段的模块收在一起，再在学科内按模块名合并。
   * 两处都必须是并集 —— 只按单条 `SUBJECTS` 行合并的话，「客观题」会在
   * 初中与高中各留下一行，而它们的 id 是由"学科·模块"派生的，于是又是一个重复 id。
   */
  const moduleSeeds = new Map<string, Array<{ name: string; kind: CatalogModuleKind; stages: string[] }>>();
  for (const subject of SUBJECTS) {
    const list = moduleSeeds.get(subject.name) ?? [];
    list.push(...(subject.modules ?? []));
    moduleSeeds.set(subject.name, list);
  }

  const modules: CatalogModule[] = [];
  for (const subject of subjects) {
    const seeds = moduleSeeds.get(subject.name);
    if (seeds === undefined) continue;

    const byName = new Map<string, { kind: CatalogModuleKind; stages: string[][] }>();
    for (const item of seeds) {
      const current = byName.get(item.name) ?? { kind: item.kind, stages: [] };
      current.stages.push(item.stages);
      byName.set(item.name, current);
    }

    [...byName.entries()].forEach(([name, item], index) => {
      modules.push({
        id: catalogId("mod", `${subject.name}·${name}`),
        parentId: "",
        subjectId: subject.id,
        name,
        kind: item.kind,
        order: index + 1,
        stageIds: unionStages(item.stages).map((stage) => catalogId("st", stage)),
      });
    });
  }

  return { stages, subjects, modules, formats, deliveries, seededAt: now };
}

/** 种子里的规模（自检与日志用；让"搬了多少条"这件事可核对）。 */
export function catalogSeedSummary(): { stages: number; subjects: number; modules: number; formats: number; deliveries: number } {
  const catalog = catalogFromSeed();
  return {
    stages: catalog.stages.length,
    subjects: catalog.subjects.length,
    modules: catalog.modules.length,
    formats: catalog.formats.length,
    deliveries: catalog.deliveries.length,
  };
}
