/**
 * **后端公开数据 → 网站视图模型** 的唯一映射层。
 *
 * ## 那五块内容：连上后端就用库，连不上就**空白**（不回落到模版）
 *
 * "那五块"= **教师页 / 课程卡片 / 课程正文 / 报价 / 学生案例** —— 它们是库里才有的内容。
 * 机构确认的口径是：**需要后端数据的地方，没连上后端就该是空的**
 *
 *   - `backend`：构站那一刻 `scripts/sync-site-data.mjs` 从后端取回了公开数据
 *     （`data/site/.backend-snapshot.ts`，形状见 `lib/backend/public-site.ts`）→ 那五块用库里的；
 *   - `blank`：没连上 → **那五块空白**（不是回落到模版：那样页面上看到的到底是库里的
 *     还是文件里的，谁也说不清 —— 而"分不清"正是这一版要消灭的东西）；
 *   - `template`：显式 `SITE_CONTENT_SOURCE=template` → 那五块用 `data/site/*.md`（本地对照用）。
 *
 * 判据只有一条：`siteContentSource()`。判定发生在 `lib/data/*.ts` 的取数函数里，
 * 每个函数一次 `switch`，没有 `?? 模版` 那种"每块各自决定"的写法。
 *
 * ## 其余页面（首页文案 / 关于 / 联系 / FAQ / 课表 / 特色课程 / 品牌与联系方式）
 *
 * ⚠️ **这句话在 v19–v22 之后就不再成立了，但仍然值得留着当历史**：
 * 那五块当时确实"只在模版里"，而这四版把它们**逐块搬进了库**
 * （v19 学生案例 · v20 特色课程 · v21 常见问题 · v22 页面文案块）。
 * 现在它们**和上面那五块同一口径**：连上后端就用库里的，连不上就空白，
 * 只有显式 `SITE_CONTENT_SOURCE=template` 才读 `data/site/*.md` ——
 * 判定同样只经过 `siteContentSource()`（`lib/data/pages.ts` / `lib/data/featured.ts` /
 * `lib/data/site.ts` 的 `copySourceFor`）。
 *
 * 因此现在**没有"永远来自模版"的页面**了：`data/site/*.md` 只剩两个身份 ——
 * 没连后端时的**骨架来源**（`blank`），以及**新装系统的初始数据**。

 * ## 为什么把"逐块回落"删掉（这是 2026-10 那次重构的核心）
 *
 * 以前这里的每个函数在"这一块后端没东西"时各自返回 `null`，由调用方 `?? 模版` 兜住。
 * 于是出现了三种状态（后端 / 仓库快照 / 模版）与**同一页里一半来自后端、一半来自模版**
 * 的混合页面 —— 机构看到的怪现象是"教师页是库里的、课程卡片却是文件里的"，
 * 而且没人能从页面上看出来。更糟的是"数据不全"伪装成"没连上"：
 * 后端连得好好的，只因为课程正文还没导入，整站就悄悄换成了模版。
 *
 * 现在口径是：
 *   - **连上就用**：快照在，就以后的为准 —— 某一块为空就**显示为空**
 *     （"我们没有课程"是真实状态，比偷偷换成另一份数据诚实）；
 *   - **连不上才换**：拿不到结构合法的公开数据 → 快照为 `null` → 整站模版；
 *   - **空不空不由这里判断**：`scripts/sync-site-data.mjs` 会在构站日志里
 *     逐块打印条数，哪一块是空的会明说 —— 让"空"发生在日志里，而不是在页面上变成另一种数据。
 *
 * 下面每个 `backendX(snapshot)` 都**显式接收快照**（自己不去取），
 * 这样"这一块到底走哪条路"在调用处一眼可见，也不可能出现"两块各走一条路"。
 *
 * ## 两条路径必须产出同样的结构
 *
 * `scripts/check.mts` 里有一组等价性断言：把模版内容灌进后端、再走本模块，
 * 结果必须与直接走 `lib/data/site.ts` / `lib/data/pricing.ts` 一致。
 * 因此本模块**刻意不读任何 Markdown、也不 import 会读 Markdown 的模块**：
 * 一旦依赖模版解析，两条路径就缠在一起，「等价」会变成自我印证，
 * 后端数据错了也测不出来（标题为空时宁可返回空标题，也不去模版里抄一份）。
 */

import { backendSiteSnapshot, backendSiteSource } from "@/data/site/.backend-snapshot";
import { deriveSlug } from "@/lib/backend/featured-tree";
import { groupByPartition, partitionPlace } from "@/lib/backend/course-partitions";
import type { CoursePartition } from "@/lib/backend/types";
import type {
  PublicCourse,
  PublicCoursePartition,
  PublicSite,
  PublicTeacher,
} from "@/lib/backend/public-site";
import type {
  SiteCase,
  SiteFaqGroup,
  SiteFaqItem,
  SiteFeaturedCourse,
  SiteHeading,
  SiteSubject,
} from "@/lib/backend/types";
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
  CaseItem,
  CasesContent,
  Course,
  CourseColumn,
  CourseDetail,
  FaqContent,
  FaqGroup,
  FeaturedContent,
  CourseColumnCard,
  CourseColumnSubgroup,
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

/**
 * 仅供自检使用：换掉当前快照。页面代码不应调用它。
 *
 *   - `null` = 强制"这次没连上后端"（那五块空白）；
 *   - `undefined` = **恢复"没注入过"**，也就是回到构建时生成的那一份真实取值 ——
 *     自检里专门有一条要验"默认（连不上）就是空白，不许被悄悄改成模版"，
 *     那条必须看真实取值，不能看注入值。
 */
export function __useBackendSnapshotForTesting(snapshot: PublicSite | null | undefined): void {
  injectedSnapshot = snapshot;
}

/**
 * 测试注入的**来源模式**（`backend` / `blank` / `template`）。
 *
 * 为什么需要一个单独的注入点：注入 `null` 快照现在只表示"没连上后端"（那五块**空白**），
 * 而自检里有**一大批**断言校验的是 `data/site/*.md` 的内容与结构（栏目、卡片、课程页、
 * 教师页、报价…）。那些断言要的是"模版那一份"，与"这次构站连没连后端"无关 ——
 * 让它们随构建环境（上一次同步时后端在不在）变红变绿，等于自检本身不可靠。
 */
let injectedSource: "backend" | "blank" | "template" | undefined;

/** 仅供自检使用：强制这次取数的来源模式（传 `undefined` 恢复真实取值）。 */
export function __useSiteContentSourceForTesting(
  source: "backend" | "blank" | "template" | undefined,
): void {
  injectedSource = source;
}

/**
 * 当前的快照：测试注入优先，其次是构建时生成的模块，都没有就是 `null`。
 *
 * 注意每次调用都现算（没有缓存），见文件头「各函数各自判断」那段。
 */
export function backendSnapshot(): PublicSite | null {
  return injectedSnapshot === undefined ? backendSiteSnapshot : injectedSnapshot;
}

/**
 * 这次构站"那五块内容"该怎么取。
 *
 *   - `backend` —— 连上了后端，用库里的数据；
 *   - `blank` —— **没连上：那五块空白**（机构确认的口径：需要后端数据的地方没连上就该是空的，
 *     而不是悄悄换成模版 —— 那样人分不清看到的到底是库里的还是文件里的）；
 *   - `template` —— 显式要求用 `data/site/*.md`（`SITE_CONTENT_SOURCE=template`，本地对照用）。
 *
 * 测试注入（`__useBackendSnapshotForTesting`）时：注入快照 = `backend`，注入 `null` = `blank`
 * —— 自检要构造的就是这两种情形。为什么不让"注入 null"表示 template：
 * 那样自检就测不到 `blank` 这条真实存在的分支（而它正是机构要的那个行为）。
 */
export function siteContentSource(): "backend" | "blank" | "template" {
  // 有快照就是 backend（快照就是后端的公开数据）
  if (backendSnapshot() !== null) return "backend";
  // 没快照：自检注入的模式优先，其次是构建时生成的那份；注入过快照（= null）时按"空白"
  if (injectedSource !== undefined) return injectedSource;
  return injectedSnapshot === undefined ? backendSiteSource : "blank";
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

/* ── 读取快照里各块（老库 / 空库一律兜底成空数组，不在这里判断"空不空"） ──── */

/** 课程页正文（老库 / 空库可能整块是空的，读取时统一兜底成空数组）。 */
function courseSubjects(snapshot: PublicSite): SiteSubject[] {
  return snapshot.siteContent?.coursePage?.subjects ?? [];
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
 * 教师页（快照在就用它，**一位教师都没有也照返回**）。
 *
 * 两种情况都会让 `teachers` 为空，各自的原因都写在构站日志里（不在这里换成模版）：
 *   - `active`（在职）：离职教师保留档案但不在页面展示；
 *   - `siteVisible`（v16 起的显式开关）：机构内部老师默认**不**展示 ——
 *     少了这一条，网站切到"以库为准"的当天，宣传页上就会多出几位内部老师。
 *
 * `heading` 直接取 `teacherPage.heading`；它为空就**原样返回空标题**，
 * 不去读模版 —— 否则"标题来自文件、教师来自库"的半截状态又回来了，
 * 而那正是 `SiteContent.teacherPage` 被搬进后端要解决的事。
 */
export function backendTeachersPage(snapshot: PublicSite): {
  heading: SectionHeading;
  teachers: Teacher[];
} {
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
 * 快照里的分区表 → 纯数据的分区数组（**排序、层级都由它说了算**）。
 *
 * 快照可能来自旧版本的后端（`partitions` 缺失）—— 那种情况返回空数组，
 * 页面就只渲染出"未归类"的卡片而不是崩掉（构站脚本连的是本机后端，
 * 版本一定对得上；这条兜底是给"用一份旧快照构站"留的）。
 */
function snapshotPartitions(snapshot: PublicSite): CoursePartition[] {
  return (snapshot.partitions ?? []).map((item: PublicCoursePartition) => ({
    id: text(item.id),
    name: text(item.name),
    parentId: text(item.parentId),
    order: sortOrder(item.order),
  }));
}

/**
 * 课程栏目（栏目 → 子栏目 → 卡片）。
 *
 * ## 结构现在来自**分区表**，不再从卡片反推
 *
 * v18 以前这里是"先按 `order` 排卡片，再按出现顺序分组"——于是栏目顺序、子栏目顺序
 * 都是**副产物**（哪张卡片先出现谁就在前），机构想调顺序只能去改每张卡片的 `order`，
 * 而且后台看不到这个结构。现在结构是数据（`snapshot.partitions`），排序与层级都在分区上，
 * 后台与网站**共用同一个 `groupByPartition()`**（见 `lib/backend/course-partitions.ts`）。
 *
 * ## 三条仍然成立的口径
 *
 *   - **空栏目不上网**：机构可能先建好栏目再往里放课（后台清单里要看得到它），
 *     但网站上渲染一个空栏目只会让家长看到一块空区域。因此这里把没有卡片的栏目与
 *     子栏目**过滤掉**（子栏目全空的栏目也一并去掉）；
 *   - **没有子标题的那一组先渲染**：直接挂在栏目上的卡片 `subgroup === null`，
 *     它渲染成 `title: ""`（页面上不渲染标题）—— 不要在这里编一个"默认子栏目名"；
 *   - **一张卡片都没有就返回空数组**（页面渲染成"这块没有内容"），
 *     不再像以前那样返回 `null` 让调用方回落到模版 —— 那正是"半个页面来自文件"的来路。
 */
export function backendCourseColumns(snapshot: PublicSite): CourseColumn[] {
  const anchors = bandAnchors(snapshot);
  const partitions = snapshotPartitions(snapshot);
  if (partitions.length === 0) return [];

  const cards = (snapshot.courses ?? []).filter(isSiteCard);
  const columns: CourseColumn[] = [];
  for (const entry of groupByPartition(cards, partitions)) {
    const subgroups: CourseColumnSubgroup[] = [];
    for (const group of entry.groups) {
      const items = byOrder(group.items, (course) => sortOrder(course.order));
      // 空组（含"没有子标题"那一组）不渲染：见上面「空栏目不上网」
      if (items.length === 0) continue;
      subgroups.push({
        title: group.subgroup === null ? "" : text(group.subgroup.name).trim(),
        cards: items.map((course) => toCard(course, anchors)),
      });
    }
    if (subgroups.length === 0) continue;
    columns.push({ title: text(entry.column.name).trim(), subgroups });
  }

  return columns;
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
  partitions: readonly CoursePartition[],
): Array<{ title: string; items: ElectiveCourse[] }> {
  const fallbackTitle = electiveTitle !== "" ? electiveTitle : "选修课程";
  const groups: Array<{ title: string; items: ElectiveCourse[] }> = [];

  for (const course of courses) {
    const name = text(course.name);
    // 「栏目」＝分区表里那一区（它自己就是二级分区时，取它所属的一级栏目）
    const place = partitionPlace(partitions, text(course.partitionId));
    const group = place.column === null ? "" : text(place.column.name).trim();
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
 * 课程页（学科 + 选修课 + 栏目）。
 *
 * 与 `lib/data/site.ts` 的 `getCoursesPage()` **同形状**，因此课程页组件一行都不用改：
 *   - 学科：`id` 用学科名（后端就是这么存的，与模版 `id: group.name` 同一口径）；
 *   - 小节：后端字段叫 `body`（正文），站点 `CourseBand` 叫 `content` —— 这里是**改名**
 *     而不是搬运，改名写漏一边，页面上就是"小节标题在、正文没了"；
 *   - 选修课是课程库里的行（`siteKind === "选修"`），与模版"选修课也是一个分组"的结果一致，
 *     但来源不同（模版里它写在正文里，后端里它是一行课程）；
 *   - `columns` 直接复用 `backendCourseColumns(snapshot)`：同一份快照算出来的一棵树，
 *     不存在"正文有、栏目没有"这种需要各自兜底的状态。
 *
 * `orders`：学科按 `order` 升序（稳定）。站点 `Course` 类型里没有 order 字段，
 * 页面只能按数组顺序渲染，因此顺序信息必须在映射时就落到数组上
 * （后端导入时 order = 数组下标，因此这一步对导入数据是恒等的）。
 */
export function backendCoursesPage(snapshot: PublicSite): {
  heading: SectionHeading;
  courses: Course[];
  columns: CourseColumn[];
  electiveTitle: string;
  electiveGroups: Array<{ title: string; items: ElectiveCourse[] }>;
} {
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

  const electiveTitle = text(snapshot.siteContent?.coursePage?.electiveTitle);
  const electives = byOrder(
    (snapshot.courses ?? []).filter((course) => course.siteKind === "选修"),
    (course) => sortOrder(course.order),
  );

  return {
    heading: toHeading(snapshot.siteContent?.coursePage?.heading),
    courses,
    columns: backendCourseColumns(snapshot),
    electiveTitle,
    electiveGroups: toElectiveGroups(electives, electiveTitle, snapshotPartitions(snapshot)),
  };
}

/* ── 常见问题（`/faq`） ─────────────────────────────────────────────────── */

/**
 * 常见问题（库里的 `siteContent.faqPage` → 网站视图模型）。
 *
 * `count` 是问题总数（页面上那句"共 N 个问题"用它）：它必须**由这里算**，
 * 而不是让页面自己数 —— 数两遍就会出现"标题说 43、列出来 42"这种对不上的情况。
 */
export function backendFaqContent(snapshot: PublicSite): FaqContent {
  const page = snapshot.siteContent?.faqPage;
  const groups: FaqGroup[] = (page?.groups ?? []).map((group: SiteFaqGroup) => ({
    title: text(group.title),
    items: (group.items ?? []).map((item: SiteFaqItem) => ({
      question: text(item.question),
      answer: text(item.answer),
    })),
  }));
  return {
    eyebrow: text(page?.heading?.eyebrow),
    title: text(page?.heading?.title),
    description: text(page?.heading?.description),
    notice: text(page?.notice),
    groups,
    count: groups.reduce((sum, group) => sum + group.items.length, 0),
  };
}

/* ── 特色课程 ───────────────────────────────────────────────────────────── */

/**
 * 特色课程树（库里的 `siteContent.featuredPage` → 网站视图模型）。
 *
 * URL 路径由**每一级的 slug 拼出来**（`path` 字段），与模版路径同一含义 ——
 * 页面组件因此一行都不用改：查找、面包屑、`generateStaticParams` 都用 `path`。
 *
 * 两种"名字与路径不一致"的情况都在这里处理掉：
 *   - 库里没写 `slug`（后台新加的课程）→ 按名字派生（`deriveSlug`），与模版同一套规则；
 *   - 派生出空串（名字全是符号）→ 用 `course-<序号>` 兜底，宁可网址难看，也不要 `//` 那种
 *     "拼出来就 404"的路径。
 */
function toFeaturedCourses(
  courses: readonly SiteFeaturedCourse[],
  parentPath: readonly string[],
): CourseDetail[] {
  return courses.map((course, index) => {
    const declared = text(course.slug).trim();
    const derived = declared !== "" ? declared : deriveSlug(text(course.name));
    const segment = derived !== "" ? derived : `course-${String(index + 1)}`;
    const path = [...parentPath, segment];
    return {
      slug: segment,
      path,
      name: text(course.name),
      // 空值字段不渲染（与模版那条 `.filter(item => item.value !== "")` 同一口径）
      fields: (course.fields ?? [])
        .map((field) => ({ title: text(field.title), value: text(field.value) }))
        .filter((field) => field.value !== ""),
      body: text(course.body),
      children: toFeaturedCourses(course.children ?? [], path),
    };
  });
}

/**
 * 特色课程页（标题 + 提示 + 课程树）。
 *
 * 一条课程都没有时返回**空树**（页面显示空状态），不回模版 —— 三态口径见本文件开头。
 */
export function backendFeaturedContent(snapshot: PublicSite): FeaturedContent {
  const page = snapshot.siteContent?.featuredPage;
  return {
    eyebrow: text(page?.heading?.eyebrow),
    title: text(page?.heading?.title),
    description: text(page?.heading?.description),
    notice: text(page?.notice),
    courses: toFeaturedCourses(page?.courses ?? [], []),
  };
}

/* ── 学生案例（`/cases` 与首页那块） ─────────────────────────────────────── */

/**
 * 案例块：库里的 `siteContent.casesPage` → 网站视图模型。
 *
 * 三处口径与模版路径对齐（`lib/data/pages.ts` 的 `getCasesContentFromTemplate`）：
 *   - 字段值**空的丢掉**（模版那侧 `fields` 也是只留非空值：内容文件里没写的字段
 *     本来就不产出条目），否则页面上会出现一行"入学水平：（空）"；
 *   - `from` / `to` 取「入学水平 / 当前水平」两个字段（页顶的前后对比用它）；
 *   - `story` 原样搬（段落之间已经用空行分隔，渲染层按空行切段）。
 *
 * 一条案例都没有时返回**空数组**（页面显示"案例整理中"这类空状态），不回模版 ——
 * 两态口径见本文件头部：连上后端就以库为准，"暂时没有案例"是机构的真实状态。
 */
export function backendCasesContent(snapshot: PublicSite): CasesContent {
  const page = snapshot.siteContent?.casesPage;
  const field = (item: SiteCase | undefined, name: string): string =>
    (item?.fields ?? []).find((entry) => text(entry.title).trim() === name)?.value ?? "";

  const cases: CaseItem[] = (page?.cases ?? []).map((item: SiteCase) => ({
    id: text(item.id).trim() === "" ? text(item.title) : text(item.id),
    title: text(item.title),
    fields: (item.fields ?? [])
      .map((entry) => ({ title: text(entry.title), value: text(entry.value) }))
      // 值为空的字段不渲染（与模版那条 `.filter(item => item.value !== "")` 同一口径）
      .filter((entry) => entry.value !== ""),
    from: text(field(item, "入学水平")),
    to: text(field(item, "当前水平")),
    story: text(item.story),
  }));

  return {
    eyebrow: text(page?.heading?.eyebrow),
    title: text(page?.heading?.title),
    description: text(page?.heading?.description),
    notice: text(page?.notice),
    cases,
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
 *   - 某阶段一个科目都没有（「其他类型」那一组没有科目概念）→ 不产出这一组，
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
 * 报价页数据（快照在就用它，**一个阶段都没有也照返回**）。
 *
 * 空阶段列表意味着"报价还没配"，页面会显示成一份选不了阶段的表单 ——
 * 那是真实状态，构站日志里会明说这一块是空的；不再像以前那样整体回落模版
 * （那样机构会以为"价格已经按库里的走了"，其实看到的是文件里的旧价目）。
 *
 * 也刻意**不看课程正文**：报价来自 `pricing` 配置，与"后端有没有导入过课程页正文"无关。
 */
export function backendPricingData(snapshot: PublicSite): PricingData {
  const pricing = snapshot.pricing;
  const stages = (pricing.stages ?? []).map(toStage);

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

