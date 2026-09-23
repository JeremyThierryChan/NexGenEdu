/**
 * **后端公开数据 → 网站视图模型** 的唯一映射层。
 *
 * ## 为什么需要这个模块
 *
 * 宣传网站的内容有两条来源：
 *
 *   1. **模版**：`data/site/*.md`，由 `lib/data/site.ts` / `lib/data/pricing.ts` 解析；
 *   2. **后端**：构站那一刻 `scripts/sync-site-data.mjs` 取回来的公开数据快照
 *      （`data/site/.backend-snapshot.ts`，形状见 `lib/backend/public-site.ts`）。
 *
 * 两条路径的**出口必须是同一套视图模型**（`lib/types/site.ts` 的 `Teacher` /
 * `CourseColumn` / `Course` … 与 `lib/data/pricing.ts` 的 `PricingData`）：
 * 页面组件只认这些类型，因此「以后端为准」这件事不该让 `app/(site)/**` 改任何一行。
 * 本模块只做一件事：把快照里的字段**兜底、改名、分组、排序**成视图模型要的形状。
 *
 * ## `null` 的语义：这次用不了后端，请回落到模版
 *
 * 每个导出函数都可能返回 `null`，它的含义**不是「出错了」而是「请用模版」**：
 *
 *   - 没有快照（这次构站没连上后端）；
 *   - 后端还没导入过课程正文（`coursePage.subjects` 为空，或所有学科加起来一个小节都没有）
 *     —— 照后端渲染会在线上产出**空课程页**，比显示旧模版糟糕得多；
 *   - 这个函数负责的那一块本身是空的（没有在职教师 / 没有卡片 / 没有报价阶段）。
 *
 * 三件事**各函数各自判断**（谁需要哪块内容就查哪块），并且刻意**不做模块级缓存**：
 * 一旦缓存一个「这次能用后端」，某一块其实是空的就会漏判 —— 那正是上面那条
 * 「空课程页」事故的成因。
 *
 * ## 两条路径必须产出同样的结构
 *
 * `scripts/check.mts` 里有一组等价性断言：把模版内容灌进后端、再走本模块，
 * 结果必须与直接走 `lib/data/site.ts` / `lib/data/pricing.ts` 一致。
 * 因此本模块**刻意不读任何 Markdown、也不 import 会读 Markdown 的模块**：
 * 一旦依赖模版解析，两条路径就缠在一起，「等价」会变成自我印证，
 * 后端数据错了也测不出来（标题为空时宁可返回空标题，也不去模版里抄一份）。
 */

import { backendSiteSnapshot } from "@/data/site/.backend-snapshot";
import type { PublicCourse, PublicSite, PublicTeacher } from "@/lib/backend/public-site";
import type { SiteHeading, SiteSubject } from "@/lib/backend/types";
import type {
  ClassType,
  LessonDuration,
  OtherItem,
  PricingData,
  PricingRules,
  PricingStage,
  StageCourse,
  SubjectGroup,
  SubjectOption,
  TeacherShareRules,
  TrialLesson,
} from "@/lib/data/pricing";
import type {
  Course,
  CourseColumn,
  CourseColumnCard,
  CourseTag,
  ElectiveCourse,
  SectionHeading,
  Teacher,
} from "@/lib/types/site";

/*
 * 快照里各块的「单行」类型：直接从 `PublicSite` 取，不再从 `lib/backend/pricing.ts`
 * 引一份后端类型 —— 两份定义将来会漂，而快照的形状才是这里真正要吃的输入。
 */
type BackendPricing = PublicSite["pricing"];
type BackendPriceStage = BackendPricing["stages"][number];
type BackendPriceCourse = BackendPriceStage["courses"][number];
type BackendPriceSubject = BackendPricing["subjects"][number];
type BackendPricingLabels = PublicSite["siteContent"]["pricingPage"]["labels"];

/* ── 测试注入 ───────────────────────────────────────────────────────────── */

/**
 * 测试注入的快照。
 *
 * 与 `lib/backend/api.ts` 的 `__useStoreForTesting` 同一套路数：自检要构造
 * 「后端有数据 / 后端没有数据」两种情形，而构建时生成的那份快照（模块里的
 * `backendSiteSnapshot`）是常量，只好留一个可换的槽位。
 *
 * `undefined`（没注入过）与 `null`（注入"这次没有后端"）是**两回事**：
 * 注入 `null` 就是强制整站回落模版 —— 自检里最常见的用法正是"验证回落"，
 * 若把 `null` 当成"取消注入"，构建时恰好有快照的机器上这条用例就测不到了。
 */
let injectedSnapshot: PublicSite | null | undefined;

/** 仅供自检使用：换掉当前快照（传 `null` = 强制"没有后端"）。页面代码不应调用它。 */
export function __useBackendSnapshotForTesting(snapshot: PublicSite | null): void {
  injectedSnapshot = snapshot;
}

/**
 * 当前的快照：测试注入优先，其次是构建时生成的模块，都没有就是 `null`。
 *
 * 注意每次调用都现算（没有缓存），见文件头「各函数各自判断」那段。
 */
export function backendSnapshot(): PublicSite | null {
  return injectedSnapshot === undefined ? backendSiteSnapshot : injectedSnapshot;
}

/* ── 小工具 ─────────────────────────────────────────────────────────────── */

/**
 * 字符串兜底。
 *
 * 类型上这些字段都是 `string`，但后端老数据（迁移前建的库、手工改过的 JSON）
 * 运行时可能是 `undefined` —— 网站不能因为一个字段缺失就整页崩掉，
 * 因此每个字符串字段都过一遍这里。
 */
function text(value: string | undefined): string {
  return value ?? "";
}

/** 显示顺序：非数字（字段缺失 / 老数据）排最后，与模版 `toTeacher` 的 999 兜底同一口径。 */
function sortOrder(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 999;
}

/**
 * 按 `order` 升序的**稳定**排序：同一个 order 保持快照里的原顺序。
 *
 * 为什么不直接 `items.sort(...)`：规范虽然从 ES2019 起要求稳定，但「同序号保持原顺序」
 * 是模版路径明确写下的约定（`getTeachersPage` 用 `Array#sort` + 文件顺序），
 * 这里把原下标显式带上，换引擎、换排序实现都不会悄悄变。
 */
function byOrder<T>(items: readonly T[], orderOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    // 差值算出 NaN（order 不是数字）时 `||` 会落到原下标，即"排最后且保持原顺序"
    .sort((a, b) => orderOf(a.item) - orderOf(b.item) || a.index - b.index)
    .map((entry) => entry.item);
}

/** 页面标题区：三项逐一兜底成空串（老数据可能缺字段）。 */
function toHeading(heading: SiteHeading | undefined): SectionHeading {
  return {
    eyebrow: text(heading?.eyebrow),
    title: text(heading?.title),
    description: text(heading?.description),
  };
}

/* ── 判定：这一块能不能用后端数据 ───────────────────────────────────────── */

/** 课程页正文（老库 / 空库可能整块是空的，读取时统一兜底成空数组）。 */
function courseSubjects(snapshot: PublicSite): SiteSubject[] {
  return snapshot.siteContent?.coursePage?.subjects ?? [];
}

/**
 * 课程页那一块能不能用后端数据；`null` = 回落到模版。
 *
 * 判定标准与 `lib/backend/site-content.ts` 的 `hasCoursePageContent()` 完全一致
 * （至少一个学科、且至少有一个小节），但**刻意不 import 它**：那个模块在顶层就
 * import 了 `lib/data/site.ts`（模版解析），引进来等于让"用后端数据"这条路径
 * 也把 Markdown 拉进构建里 —— 两条路径就缠上了。
 *
 * 为什么必须拦这一条：`scripts/sync-site-data.mjs` 在"后端还没有课程正文"时
 * 根本不会生成快照，但快照也可能是自检注入的、或同步之后后端被清空的；
 * 那时用后端数据会在线上产出**空白课程页**（家长看到的是"我们没有课程"）。
 */
function coursePageSource(): PublicSite | null {
  const snapshot = backendSnapshot();
  if (snapshot === null) return null;
  const ready = courseSubjects(snapshot).some((subject) => (subject.bands?.length ?? 0) > 0);
  return ready ? snapshot : null;
}

/**
 * 「小节锚点集合」= `coursePage.subjects[].bands[].id`。
 *
 * 后端存的 `band.id` 就是锚点名（导入时按小节标题「｜」之前那段算出来的，
 * 见 `lib/backend/site-content.ts` 的 `bandAnchor`），而卡片标签 `target` 指向的
 * 正是这些锚点 —— 卡片指向哪里要靠它判断。
 */
function bandAnchors(snapshot: PublicSite): Set<string> {
  const anchors = new Set<string>();
  for (const subject of courseSubjects(snapshot)) {
    for (const band of subject.bands ?? []) {
      const id = text(band.id).trim();
      if (id !== "") anchors.add(id);
    }
  }
  return anchors;
}

/* ── 教师页 ─────────────────────────────────────────────────────────────── */

/**
 * 一条教师档案（后端行 → `Teacher`）。
 *
 *   - `id` 用姓名：模版路径里教师分组的 id 就是分组名（= 姓名），
 *     教师页的锚点（`#姓名`）与 `/courses/<卡片>` 里的教师匹配都按它走，改口径就是改链接；
 *   - `kind`：后端 `"AI"` → 站点 `"ai"`，其余（含 `"教师"`）都是 `"teacher"`。
 *     页面上据此把 AI 智能体与真人分开显示，映射漏了就会让家长以为智能体也授课；
 *   - 其余字段直接搬，但每个字符串都兜底 —— 后端老数据可能少字段。
 */
function toTeacher(teacher: PublicTeacher): Teacher {
  return {
    id: text(teacher.name),
    kind: text(teacher.kind) === "AI" ? "ai" : "teacher",
    name: text(teacher.name),
    role: text(teacher.role),
    // 空串科目会在页面上渲染成一枚空徽章，与模版 `splitList` 一样先滤掉
    subjects: (teacher.subjects ?? []).map((subject) => text(subject)).filter((subject) => subject !== ""),
    years: text(teacher.years),
    summary: text(teacher.summary),
    recommendation: text(teacher.recommendation),
    order: sortOrder(teacher.order),
    active: teacher.active === true,
    bio: text(teacher.bio),
  };
}

/**
 * 教师页（后端可用时）；不可用返回 `null`。
 *
 * 「不可用」= 没有快照，或一位能上台的教师都没有 —— 判据见下面的两个条件
 * （离职档案、机构内部老师都会让页面变成一个没有教师的教师页，那不如回落到模版）。
 *
 * `heading` 直接取 `teacherPage.heading`；它为空就**原样返回空标题**，
 * 不去读模版 —— 否则"标题来自文件、教师来自库"的半截状态又回来了，
 * 而那正是 `SiteContent.teacherPage` 被搬进后端要解决的事。
 */
export function backendTeachersPage(): { heading: SectionHeading; teachers: Teacher[] } | null {
  const snapshot = backendSnapshot();
  if (snapshot === null) return null;

  /*
   * 两个条件都要满足才上台：
   *   - `active`（在职）：离职教师保留档案但不在页面展示；
   *   - `siteVisible`（v16 起的显式开关）：机构内部老师（真名、没有简介）默认**不**展示 ——
   *     少了这一条，网站切到"以库为准"的当天，宣传页上就会多出几位内部老师。
   * 同 order 保持快照里的原顺序。
   */
  const teachers = byOrder(
    (snapshot.teachers ?? []).filter((teacher) => teacher.active === true && teacher.siteVisible === true),
    (teacher) => sortOrder(teacher.order),
  ).map(toTeacher);

  if (teachers.length === 0) return null;

  return {
    heading: toHeading(snapshot.siteContent?.teacherPage?.heading),
    teachers,
  };
}

/* ── 课程栏目（课程总览 / 首页共用） ─────────────────────────────────────── */

/**
 * 这张课程行是不是网站上的**卡片**。
 *
 * 两个条件缺一不可（与 `scripts/sync-site-data.mjs` 统计张数时同一口径）：
 * `siteKind !== "不展示"`（机构自建的课只用于排课/记课时）、`path !== ""`
 * （没有路径的卡片点进去就是 404）。
 */
function isSiteCard(course: PublicCourse): boolean {
  return course.siteKind !== "不展示" && text(course.path) !== "";
}

/**
 * 卡片点进哪个小节。
 *
 * 优先用课程行里的 `target`（后台能显式指定，例如卡片名与小节名不一致时）；
 * 为空才按模版口径推导 —— 这门课在小节锚点里有同名小节就用课程名，
 * 否则用第一个标签的 `target`，两者都没有就用课程名。
 *
 * 三条分支都必须给出**非空**目标：`target` 为空在页面上就是一张点不动的卡片
 * （模版路径的 `sections.has(title) ? title : tags[0]?.target ?? title` 是同一套规则）。
 */
function cardTarget(
  course: PublicCourse,
  anchors: ReadonlySet<string>,
  title: string,
  tags: readonly CourseTag[],
): string {
  const explicit = text(course.target).trim();
  if (explicit !== "") return explicit;
  if (anchors.has(title)) return title;
  const firstTag = tags[0];
  const tagTarget = firstTag === undefined ? "" : firstTag.target.trim();
  return tagTarget !== "" ? tagTarget : title;
}

/** 一条课程行 → 一张卡片。 */
function toCard(course: PublicCourse, anchors: ReadonlySet<string>): CourseColumnCard {
  // 与模版一致：卡片名去掉首尾空白（后端 normalizeCourse 已 trim，这里是二次保险）
  const title = text(course.name).trim();
  const tags: CourseTag[] = (course.tags ?? []).map((tag) => ({
    label: text(tag.label),
    target: text(tag.target),
  }));

  return {
    title,
    path: text(course.path),
    // 后端状态只有「开放 / 暂未开放」两种，只有明确的「开放」才算可选：
    // 状态缺失时按"暂未开放"处理 —— 少给一个可选项，比让家长选到一门其实开不了的课要好
    unavailable: text(course.status) !== "开放",
    forms: (course.forms ?? []).map((form) => text(form)).filter((form) => form !== ""),
    tags,
    target: cardTarget(course, anchors, title, tags),
  };
}

/**
 * 课程栏目（栏目 → 子栏目 → 卡片）；不可用返回 `null`。
 *
 * 排序规则与「为什么这样排」：
 *   - 先把卡片按 `order` 升序排好，**再按出现顺序分组**。于是「栏目首次出现的顺序」
 *     天然就是该栏目最小的 `order`（子栏目同理），不需要另记一遍最小值，
 *     也天然满足"同 order 保持快照原顺序"（稳定排序）；
 *   - 空子栏目的 `title` 是 `""`（页面上不渲染标题），与模版 `getCourseColumns()`
 *     的 `subgroupRaw` 一致 —— 不要在这里编一个"默认子栏目名"，那会让页面上多出一行标题。
 *
 * `null` 的判定：没有快照、后端没有课程正文（见 `coursePageSource`）、
 * 或一张能用的卡片都没有（返回空数组意味"后端有栏目，只是都空着"，
 * 页面会渲染出一个空骨架，所以一律 `null`）。
 */
export function backendCourseColumns(): CourseColumn[] | null {
  const snapshot = coursePageSource();
  if (snapshot === null) return null;

  const anchors = bandAnchors(snapshot);
  const cards = byOrder(
    (snapshot.courses ?? []).filter(isSiteCard),
    (course) => sortOrder(course.order),
  );

  const columns: CourseColumn[] = [];
  for (const course of cards) {
    const columnTitle = text(course.category).trim();
    // 没有栏目名的卡片放不进「栏目 → 子栏目 → 卡片」这棵树（模版路径同样会跳过这种行），
    // 硬塞会渲染出一个没有标题的栏目
    if (columnTitle === "") continue;

    const subgroupTitle = text(course.subgroup).trim();
    const card = toCard(course, anchors);

    let column = columns.find((entry) => entry.title === columnTitle);
    if (column === undefined) {
      column = { title: columnTitle, subgroups: [] };
      columns.push(column);
    }

    let subgroup = column.subgroups.find((entry) => entry.title === subgroupTitle);
    if (subgroup === undefined) {
      subgroup = { title: subgroupTitle, cards: [] };
      column.subgroups.push(subgroup);
    }
    subgroup.cards.push(card);
  }

  return columns.length > 0 ? columns : null;
}

/* ── 课程页 ─────────────────────────────────────────────────────────────── */

/**
 * 选修课分组（成人英语口语 / 职场与商务英语 …）。
 *
 * 三件与模版路径对齐的事：
 *   - `id` 用课程名（模版里选修课的 id 就是 `#### 课程名` 的小节名）；
 *   - `group` 取课程行的 `category`；分组**标题**在它为空的退回选修父分组名
 *     （再没有就用「选修课程」）—— 模版对「栏目:」为空的选修课就是这么兜的，
 *     否则页面上会出现一个没有标题的分组；
 *   - 组的出现顺序 = 组内最小的 `order`（调用方已先按 order 排好，这里按出现顺序建组），
 *     组内同样按 `order`。
 */
function toElectiveGroups(
  courses: readonly PublicCourse[],
  electiveTitle: string,
): Array<{ title: string; items: ElectiveCourse[] }> {
  const fallbackTitle = electiveTitle !== "" ? electiveTitle : "选修课程";
  const groups: Array<{ title: string; items: ElectiveCourse[] }> = [];

  for (const course of courses) {
    const name = text(course.name);
    const group = text(course.category);
    const item: ElectiveCourse = {
      id: name,
      name,
      // 选修课只有一段介绍，后端把这段话存在课程行的 `intro` 里
      description: text(course.intro),
      group,
      available: text(course.status) === "开放",
    };

    const title = group !== "" ? group : fallbackTitle;
    const existing = groups.find((entry) => entry.title === title);
    if (existing !== undefined) existing.items.push(item);
    else groups.push({ title, items: [item] });
  }

  return groups;
}

/**
 * 课程页（学科 + 选修课 + 栏目）；不可用返回 `null`。
 *
 * 与 `lib/data/site.ts` 的 `getCoursesPage()` **同形状**，因此课程页组件一行都不用改：
 *   - 学科：`id` 用学科名（后端就是这么存的，与模版 `id: group.name` 同一口径）；
 *   - 小节：后端字段叫 `body`（正文），站点 `CourseBand` 叫 `content` —— 这里是**改名**
 *     而不是搬运，改名写漏一边，页面上就是"小节标题在、正文没了"；
 *   - 选修课是课程库里的行（`siteKind === "选修"`），与模版"选修课也是一个分组"的结果一致，
 *     但来源不同（模版里它写在正文里，后端里它是一行课程）；
 *   - `columns` 直接复用 `backendCourseColumns()`，取不到就用空数组：
 *     学科正文有、栏目数据坏掉时，页面该显示课程正文而不是整页回落模版。
 *
 * `orders`：学科按 `order` 升序（稳定）。站点 `Course` 类型里没有 order 字段，
 * 页面只能按数组顺序渲染，因此顺序信息必须在映射时就落到数组上
 * （后端导入时 order = 数组下标，因此这一步对导入数据是恒等的）。
 */
export function backendCoursesPage(): {
  heading: SectionHeading;
  courses: Course[];
  columns: CourseColumn[];
  electiveTitle: string;
  electiveGroups: Array<{ title: string; items: ElectiveCourse[] }>;
} | null {
  const snapshot = coursePageSource();
  if (snapshot === null) return null;

  const courses = byOrder(courseSubjects(snapshot), (subject) => sortOrder(subject.order)).map<Course>(
    (subject) => ({
      id: text(subject.name),
      nameZh: text(subject.name),
      unavailable: subject.unavailable === true,
      lead: text(subject.lead),
      bands: (subject.bands ?? []).map((band) => ({
        title: text(band.title),
        content: text(band.body),
      })),
    }),
  );

  if (courses.length === 0) return null;

  const electiveTitle = text(snapshot.siteContent?.coursePage?.electiveTitle);
  const electives = byOrder(
    (snapshot.courses ?? []).filter((course) => course.siteKind === "选修"),
    (course) => sortOrder(course.order),
  );

  return {
    heading: toHeading(snapshot.siteContent?.coursePage?.heading),
    courses,
    columns: backendCourseColumns() ?? [],
    electiveTitle,
    electiveGroups: toElectiveGroups(electives, electiveTitle),
  };
}

/* ── 报价页 ─────────────────────────────────────────────────────────────── */

/**
 * 公开数据里没有教师分成规则时的兜底值。
 *
 * 教师课时费是**内部成本口径**，后端公开数据故意不给（见 `lib/backend/public-site.ts`
 * 的 `PublicPricing` 注释）。宣传页的任何地方都不用 `teacherShare` —— 报价只用
 * 课程价 × 科目系数 × 班级系数 + 手续费，教师分成只在后台试算里出现 ——
 * 它在这里**只是因为 `PricingData` 的类型需要这个字段**。
 *
 * 取值与 `lib/data/pricing.ts` 的 `DEFAULT_TEACHER_SHARE_RULES` 一致
 * （40% 起、每加一名学生 +10%、按课程标准单价），也就是那条已公开的规则本身。
 * 为什么不直接 import 那个常量：`lib/data/pricing.ts` 在模块顶层 import 了
 * `data/site/pricing.ts`（模版 Markdown），引它会把模版内容拉进"用后端"这条路径，
 * 正是文件头说的那种缠绕；而这份值反正没人用来算钱。
 */
const PUBLIC_TEACHER_SHARE_FALLBACK: TeacherShareRules = {
  basePercent: 40,
  stepPercent: 10,
  priceBasis: "course",
};

/** 一门报价课程：后端 `basePrice` → 站点 `price`。 */
function toStageCourse(course: BackendPriceCourse): StageCourse {
  const price = course.basePrice;
  /*
   * 站点侧的不变式是「available 为真 ⇔ price 不是 null」（模版路径就是这么构造的：
   * `price: available ? toNumber(priceLabel) : null`）。
   * 后端理论上会出现「可用但价格没填」（例如刚与课程库建立关联、价还没录），
   * 照抄会让家长看到一个能选中、一报价就报「所选课程暂未开放」的选项 ——
   * 因此两个条件同时成立才算可选，缺一个就按不可用处理（宁可显示「暂未开放」）。
   */
  const available =
    course.available === true && typeof price === "number" && Number.isFinite(price);
  return { name: text(course.name), price: available ? price : null, available };
}

/**
 * 一个学习阶段。
 *
 * `available` = **至少有一门可选课程**（与模版 `courseEntries.some(...)` 同义）：
 * 页面上整阶段置灰，家长就不会点进去发现里面全是「暂未开放」。
 */
function toStage(stage: BackendPriceStage): PricingStage {
  const courses = (stage.courses ?? []).map(toStageCourse);
  return {
    name: text(stage.name),
    // 键序刻意与模版 `parsePricingSource` 写下的 `{ name, available, courses }` 一致：
    // 自检是拿 `JSON.stringify` 全文比两条路径的（见 scripts/check.mts），
    // 键序不同会被判成"不等价" —— 而这里唯一真正在意的只是"两边的对象长得一样"
    available: courses.some((course) => course.available),
    courses,
  };
}

/**
 * 阶段 + 科目 → 站点需要的「阶段分组」。
 *
 * 后端是**扁平**的一份 `subjects`（每行带 `stageName`），站点那边是
 * 「阶段名 + 科目列表」，因此这里按 `stages` 的顺序把科目收拢回各阶段：
 *
 *   - 分组顺序 = 阶段在 `stages` 里的顺序。报价页是「先选阶段、再选科目」的联动，
 *     两组顺序必须同源，否则会出现"阶段下拉里的顺序"与"科目分组的顺序"两种说法；
 *   - 组内保持后端的顺序（后台就是按这个顺序维护的，别在这里重排）；
 *   - 某阶段一个科目都没有（出国考试 / 专业英语 / 成人兴趣没有科目概念）→ 不产出这一组，
 *     模版路径同样是"没有 `#### 科目:` 就不产出分组"；
 *   - 挂在不存在的阶段上的科目会被丢掉：后端的 `validatePricingConfig` 不允许这种数据，
 *     真出现说明配置坏了，硬塞进某个阶段会把价格算错，不如不显示。
 */
function toSubjectGroups(
  stages: readonly PricingStage[],
  subjects: readonly BackendPriceSubject[],
): SubjectGroup[] {
  const groups: SubjectGroup[] = [];
  for (const stage of stages) {
    const options: SubjectOption[] = subjects
      .filter((subject) => text(subject.stageName) === stage.name)
      .map((subject) => ({
        name: text(subject.name),
        // 后端公开数据里没有「科目暂未开放」这个概念（不可用的科目直接不进配置），
        // 因此统一按可选处理；模版路径解析出来的科目也恒为 available: true
        available: true,
        // 系数缺失 / 非数字时按 1（不加价）：与模版 `parseSubject` 的兜底同一口径。
        // 让 ¥NaN 出现在家长面前是最糟的失败方式
        coefficient: Number.isFinite(subject.coefficient) ? subject.coefficient : 1,
      }));
    if (options.length > 0) groups.push({ name: stage.name, subjects: options });
  }
  return groups;
}

/**
 * 计费规则（手续费 / 试课免费门槛）。
 *
 * 三个字段直接搬，数字与布尔都**不做兜底**：这是算钱的口径，后端
 * `validatePricingConfig` 在保存前已经拦过非法值，网站这侧另造一套默认值
 * 会让同一个价格有两种算法 —— 而"两边算出不同的价"是这份系统最不能接受的事故。
 */
function toRules(rules: PricingRules): PricingRules {
  return {
    singleLessonFeePercent: rules.singleLessonFeePercent,
    freeTrialMinLessons: rules.freeTrialMinLessons,
    chargeTrialWhenNotFree: rules.chargeTrialWhenNotFree,
  };
}

/** 试课（独立产品）；后端可能是 `null`，站点也接受 `null`。 */
function toTrial(trial: BackendPricing["trial"]): TrialLesson | null {
  return trial === null || trial === undefined
    ? null
    : { name: text(trial.name), priceLabel: text(trial.priceLabel) };
}

/**
 * 报价页文案（16 个短字段）。
 *
 * 键名与 `PricingData.labels` **同名同义**，逐个兜底成空串：
 * 少一个键在页面上就是一个空按钮 / 空标签，而空串至少还能看出"这行文案没配"。
 */
function toPricingLabels(labels: BackendPricingLabels | undefined): PricingData["labels"] {
  return {
    result: text(labels?.result),
    submit: text(labels?.submit),
    reset: text(labels?.reset),
    unitPriceLabel: text(labels?.unitPriceLabel),
    unit: text(labels?.unit),
    totalLabel: text(labels?.totalLabel),
    formulaNote: text(labels?.formulaNote),
    calculatorTitle: text(labels?.calculatorTitle),
    calculatorHint: text(labels?.calculatorHint),
    otherTitle: text(labels?.otherTitle),
    lessonsLabel: text(labels?.lessonsLabel),
    lessonsHint: text(labels?.lessonsHint),
    durationLabel: text(labels?.durationLabel),
    classSizeLabel: text(labels?.classSizeLabel),
    classCostLabel: text(labels?.classCostLabel),
    classCostHint: text(labels?.classCostHint),
  };
}

/**
 * 报价页数据；不可用返回 `null`。
 *
 * 「不可用」= 没有快照，或**一个报价阶段都没有**（那种配置下报价页会变成一个
 * 连阶段都选不了的空白表单，不如整体回落模版）。
 *
 * 刻意**不看课程正文**：报价来自 `pricing` 配置，与"后端有没有导入过课程页正文"
 * 无关 —— 后端刚建好、只配了价时，报价页用后端数据是**对的**。
 */
export function backendPricingData(): PricingData | null {
  const snapshot = backendSnapshot();
  if (snapshot === null) return null;

  const pricing = snapshot.pricing;
  const stages = (pricing.stages ?? []).map(toStage);
  if (stages.length === 0) return null;

  return {
    labels: toPricingLabels(snapshot.siteContent?.pricingPage?.labels),
    stages,
    subjectGroups: toSubjectGroups(stages, pricing.subjects ?? []),
    classTypes: (pricing.classTypes ?? []).map((item) => ({
      name: text(item.name),
      // 后端配置里只有在用的班型（不可用的班型在模版路径里也是被 filter 掉的），
      // 因此恒为可选
      available: true,
      mode: item.mode,
      coefficient: item.coefficient,
    })) satisfies ClassType[],
    durations: (pricing.durations ?? []).map((item) => ({
      name: text(item.name),
      hours: item.hours,
      multiplier: item.multiplier,
    })) satisfies LessonDuration[],
    rules: toRules(pricing.rules),
    teacherShare: PUBLIC_TEACHER_SHARE_FALLBACK,
    trial: toTrial(pricing.trial),
    otherItems: (pricing.otherItems ?? []).map((item) => ({
      name: text(item.name),
      details: (item.details ?? []).map((detail) => ({
        title: text(detail.title),
        value: text(detail.value),
      })),
    })) satisfies OtherItem[],
  };
}

/* ── 一句话说明（构建日志 / 排查） ───────────────────────────────────────── */

