/**
 * **把课程挂到维度上**（纯函数）—— 课程台账与课程类型之间的那座桥。
 *
 * ## 为什么需要它
 *
 * 课程台账里的课是"枚举"出来的（`小学语文`、`初中数学`、`高考外语`…），
 * 而课程类型是一套维度（学段 × 学科 / 项目 × 内容模块 × 班型）。两者以前**没有任何联系**：
 * 同一门「小学语文」在两处各写一遍，改一处不会动另一处。
 *
 * 这一层给每门课算出"它对应哪几个学段、哪几个学科"，于是：
 *   - 台账可以**按维度分组**（学段 → 学科）而不是按手写的分区；
 *   - 组合开放（`offers`）与课程能对上（"这门课的组合开没开"）；
 *   - 以后的 AI 排课 / 诊断推荐可以按维度筛课程，不必逐门枚举。
 *
 * ## 两条口径
 *
 *   1. **按 id 引用，不是按名字**：`subjectIds` / `stageIds` 存的是课程类型里那些行的 id，
 *      所以机构给学科改名不影响挂在上面的课（与班型、模块同一套做法）。
 *   2. **对不上就说对不上**：`suggestCourseDimensions` 只做"能确定的那部分"，
 *      剩下的返回空数组，由页面列在「还没挂到维度上的课程」里让人手选 ——
 *      **不猜**。猜错的后果是排课与诊断按错的维度筛课，而页面上看起来一切正常。
 */
import type { Catalog, Course } from "./types";

/** 挂在一门课上的维度（都是课程类型里的行 id）。 */
export type CourseDimensions = {
  stageIds: string[];
  subjectIds: string[];
  /**
   * 内容模块（可选）：空数组＝这门课不细分到模块。
   *
   * 为什么课程也要能挂模块：一门"小学语文·一年级"的课与"小学语文·阅读"是两条不同的组合，
   * 诊断推荐要能说清"补的是哪一块"。而大多数课程卡片本来就是一个学科一张，因此允许空。
   */
  moduleIds: string[];
};

/** 建议结果（含"是怎么对上的"，页面上要能说清依据）。 */
export type CourseDimensionSuggestion = CourseDimensions & {
  /** 人话说明：`按学段前缀 + 学科名对上` / `按学科名对上` / `对不上，请手选`。 */
  how: string;
  /** 有没有挂上（`subjectIds` 非空就算挂上了：学段可以后补）。 */
  linked: boolean;
};

/**
 * 少数几张卡片的**显式对应表**（按名字）。
 *
 * 为什么要有它：这几张卡片的名字与维度表里的名字**不是同一套写法**，靠规则猜不出来：
 *
 *   - 「高考外语」是**一组学科**（高考可以考日 / 俄 / 德 / 法 / 西），维度表里没有"高考外语"
 *     这个学科 —— 对到那五个语种上，这张卡片继续是"一张卡片覆盖五个学科"；
 *   - 「3D建模 & 3D打印」与维度表里的「3D建模与3D打印」只差一个连接符；
 *   - 「职场与商务英语」就是维度表里的「商务英语」；
 *   - 「成人英语口语 / 成人零基础外语 / 出国语言备考 / 编程与信息素养 / 高中技术」在维度表里
 *     原本没有对应行（它们是从网站卡片同步进来的"枚举尾巴"）—— 迁移时已按卡片名补进了
 *     学科表，因此这里对的是同名行。
 *
 * 顺序即优先级；对不上时留空，由页面提示手选。
 */
const ALIASES: Record<string, { stages?: string[]; subjects: string[] }> = {
  高考外语: { stages: ["高中"], subjects: ["日语", "俄语", "德语", "法语", "西班牙语"] },
  "3D建模 & 3D打印": { subjects: ["3D建模与3D打印"] },
  职场与商务英语: { subjects: ["商务英语"] },
  成人英语口语: { stages: ["其他类型"], subjects: ["成人英语口语"] },
  成人零基础外语: { stages: ["其他类型"], subjects: ["成人零基础外语"] },
  出国语言备考: { stages: ["其他类型"], subjects: ["出国语言备考"] },
  编程与信息素养: { stages: ["其他类型"], subjects: ["编程与信息素养"] },
  高中技术: { stages: ["高中"], subjects: ["技术"] },
};

/** 一门课的名字里以哪个学段开头（「小学语文」→ 小学）。 */
function stagePrefixOf(name: string, catalog: Catalog): { stageId: string; rest: string } | null {
  // 从长到短匹配，免得"初中"被"初"这种半截名字抢先（现在没有，但规则要稳）
  const stages = [...catalog.stages].sort((a, b) => b.name.length - a.name.length);
  for (const stage of stages) {
    if (stage.name !== "" && name.startsWith(stage.name)) {
      return { stageId: stage.id, rest: name.slice(stage.name.length).trim() };
    }
  }
  return null;
}

/**
 * 给一门课算"它对应哪些维度"。
 *
 * 规则（按顺序试，第一个命中就用）：
 *   1. **显式对应表**（上面那张表里的几张卡片）；
 *   2. 名字里带学段前缀（「小学语文」）→ 学段 + 剩下的部分当学科名；
 *   3. 名字本身就是学科名（「雅思」）→ 学科 + 学科自己的学段；
 *   4. 都对不上 → 空，`linked: false`，页面列出来让人手选。
 *
 * 只返回**存在的行**：维度表里没有的学科名宁可算"没对上"，也不新造一个 id。
 */
export function suggestCourseDimensions(courseName: string, catalog: Catalog): CourseDimensionSuggestion {
  const name = courseName.trim();
  const subjectByName = new Map(catalog.subjects.map((subject) => [subject.name, subject] as const));
  const stageByName = new Map(catalog.stages.map((stage) => [stage.name, stage] as const));

  const fromStages = (names: readonly string[]): string[] =>
    names.map((stageName) => stageByName.get(stageName)?.id ?? "").filter((id) => id !== "");

  // ① 显式对应表
  const alias = ALIASES[name];
  if (alias !== undefined) {
    const subjects = alias.subjects
      .map((subjectName) => subjectByName.get(subjectName))
      .filter((subject) => subject !== undefined);
    if (subjects.length > 0) {
      const subjectStages = subjects.flatMap((subject) => subject.stageIds);
      const stageIds = alias.stages === undefined ? subjectStages : fromStages(alias.stages);
      return {
        stageIds: [...new Set(stageIds.length > 0 ? stageIds : subjectStages)],
        subjectIds: subjects.map((subject) => subject.id),
        moduleIds: [],
        how:
          subjects.length > 1
            ? `这张卡片覆盖 ${String(subjects.length)} 个学科（${subjects.map((s) => s.name).join("、")}）`
            : `按对应表对上「${subjects[0]?.name ?? ""}」`,
        linked: true,
      };
    }
  }

  // ② 学段前缀 + 学科名（「小学语文」）
  const prefixed = stagePrefixOf(name, catalog);
  if (prefixed !== null) {
    const subject = subjectByName.get(prefixed.rest);
    if (subject !== undefined) {
      return {
        stageIds: [prefixed.stageId],
        subjectIds: [subject.id],
        moduleIds: [],
        how: `按「学段 + 学科」对上（${prefixed.rest} × 该学段）`,
        linked: true,
      };
    }
  }

  // ③ 名字本身就是学科名（「雅思」「日语」）
  const direct = subjectByName.get(name);
  if (direct !== undefined) {
    return {
      stageIds: [...direct.stageIds],
      subjectIds: [direct.id],
      moduleIds: [],
      how: `按学科名对上「${direct.name}」`,
      linked: true,
    };
  }

  // ④ 对不上
  return {
    stageIds: [],
    subjectIds: [],
    moduleIds: [],
    how: "对不上（维度表里没有同名的学科 / 项目），请手选",
    linked: false,
  };
}

/**
 * 校验一门课挂的维度对不对（`courses.create` / `courses.update` 的闸门之一）。
 *
 * 规则与代价：
 *   - 引用的学段 / 学科 / 模块**必须存在**（悬空引用会让"这门课属于哪个学科"两说：
 *     台账里按维度分组时它会消失，而按学科筛课时它又会出现）；
 *   - 每个模块必须属于**这门课挂着的某个学科**（模块不跨学科复用）；
 *   - 如果有学段也有学科，两者**必须有交集**（"数学 × 大学"这种多半是选错了 ——
 *     维度表里数学不开在大学）。
 *
 * 允许空：还没挂上维度的课是合法状态（迁移对不上的那些就是），由台账里那一块列出来提示。
 */
export function courseDimensionProblems(
  input: { name: string; stageIds?: string[]; subjectIds?: string[]; moduleIds?: string[] },
  catalog: Catalog,
): string[] {
  const problems: string[] = [];
  const stageIds = new Set(catalog.stages.map((item) => item.id));
  const subjects = new Map(catalog.subjects.map((item) => [item.id, item] as const));
  const modules = new Map(catalog.modules.map((item) => [item.id, item] as const));

  for (const id of input.stageIds ?? []) {
    if (!stageIds.has(id)) problems.push(`「${input.name}」挂了一个不存在的学段。`);
  }
  for (const id of input.subjectIds ?? []) {
    if (!subjects.has(id)) problems.push(`「${input.name}」挂了一个不存在的学科 / 项目。`);
  }
  for (const id of input.moduleIds ?? []) {
    const item = modules.get(id);
    if (item === undefined) {
      problems.push(`「${input.name}」挂了一个不存在的内容模块。`);
      continue;
    }
    if (!(input.subjectIds ?? []).includes(item.subjectId)) {
      problems.push(
        `「${input.name}」挂的模块「${item.name}」不属于它挂着的学科（模块不跨学科复用）。`,
      );
    }
  }

  const pickedStages = input.stageIds ?? [];
  const pickedSubjects = input.subjectIds ?? [];
  if (pickedStages.length > 0 && pickedSubjects.length > 0) {
    const owned = new Set(
      pickedSubjects.flatMap((id) => subjects.get(id)?.stageIds ?? []),
    );
    if (!pickedStages.some((id) => owned.has(id))) {
      const stageNames = pickedStages
        .map((id) => catalog.stages.find((stage) => stage.id === id)?.name ?? id)
        .join("、");
      const subjectNames = pickedSubjects
        .map((id) => subjects.get(id)?.name ?? id)
        .join("、");
      problems.push(
        `「${input.name}」的学段（${stageNames}）与学科（${subjectNames}）对不上：` +
          "这个学科不开在这些学段里，请核对一下。",
      );
    }
  }

  return problems;
}

/** 一门课挂上了没有（台账里"还没挂到维度上"那一块用它筛）。 */
export function isCourseLinked(course: Pick<Course, "subjectIds">): boolean {
  return (course.subjectIds ?? []).length > 0;
}

/**
 * 「这门课在开放矩阵里开没开」—— 课程状态与组合开放**各管一层**，这里把两层合起来说一句话。
 *
 * 机构口径（2026-09）：
 *   - **课程状态**（`Course.status`）＝这门课整体上不上网站 / 能不能被选；
 *   - **开放矩阵**（`offers`）＝这门课的某条组合（学科 × 模块 × 班型）能不能卖。
 *
 * 两层都要留，因此**谁也拦不住谁**，只能在页面上互相提示。这一函数就是那句提示：
 * 它拿不准的（课没挂维度、矩阵里没有这个学科的格子）**明说拿不准**，而不是硬给一个结论。
 */
export function opennessHint(
  course: Pick<Course, "name" | "status" | "stageIds" | "subjectIds" | "moduleIds">,
  offers: ReadonlyArray<{ subjectId: string; moduleId: string; formatId: string; open: boolean }>,
): { level: "ok" | "warn" | "unknown"; text: string } {
  if ((course.subjectIds ?? []).length === 0) {
    return { level: "unknown", text: "还没挂到学科上，看不出矩阵里开没开" };
  }
  const mine = offers.filter((offer) => (course.subjectIds ?? []).includes(offer.subjectId));
  if (mine.length === 0) {
    return {
      level: course.status === "开放" ? "warn" : "unknown",
      text:
        course.status === "开放"
          ? "这门课是「开放」，但开放矩阵里一条组合都没设过 —— 家长问到班型时没有依据"
          : "开放矩阵里还没设过这门课的组合",
    };
  }
  const open = mine.filter((offer) => offer.open).length;
  if (open === 0) {
    return {
      level: course.status === "开放" ? "warn" : "ok",
      text:
        course.status === "开放"
          ? "矩阵里这门课的组合**全都关着** —— 与「开放」这个状态矛盾，请核对"
          : "矩阵里这门课的组合都关着（与「暂未开放」一致）",
    };
  }
  return { level: "ok", text: `矩阵里开放着 ${String(open)} 条组合` };
}
