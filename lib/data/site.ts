import {
  getGroup,
  getPageBlock,
  pageArray,
  pageString,
  type Group,
  type PageBlock,
  type Section,
} from "@/lib/data/content";
import { COURSES_HREF } from "@/lib/site/featured-routes";
import {
  backendCourseColumns,
  backendCoursesPage,
  backendSnapshot,
  backendTeachersPage,
} from "@/lib/site/backend-source";
import type {
  AboutContent,
  ElectiveCourse,
  ContactContent,
  Course,
  CourseColumn,
  CourseColumnCard,
  CourseColumnPageData,
  CoursePageData,
  CourseStage,
  FormSubjectGroup,
  CourseTag,
  HomeContent,
  SectionHeading,
  SiteBrand,
  Teacher,
} from "@/lib/types/site";

/**
 * 数据访问层：页面获取内容的唯一入口。
 *
 * ## 两态取数：这里的每个函数只做一次选择
 *
 * ```ts
 * const snapshot = backendSnapshot();
 * if (snapshot !== null) return backendX(snapshot);   // 连上后端了 → 这一块用库里的
 * return getXFromTemplate();                          // 没连上 → 这一块用模版
 * ```
 *
 * **判据只有一个**：这次构站有没有拿到后端的公开数据（`backendSnapshot()`）。
 * 有就**整站**用后端（某一块为空就显示为空，不再回落）；没有就**整站**用模版。
 * 刻意不写 `backendX() ?? getXFromTemplate()`：那种写法让每一块各自决定，
 * 于是同一页会一半来自库、一半来自文件，而页面上看不出来
 * （详见 `lib/site/backend-source.ts` 的文件头）。
 *
 * 全部内容都来自单文件 data/site/content.md，按页面分段（见 lib/data/content.ts）。
 * 页面只能调用本文件的函数，不得直接读文件或解析 Markdown。
 * 未来接入 PostgreSQL / API 时替换本文件实现即可，页面调用方式不变。
 */

/**
 * 卡片没写 `· 路径:` 时的兜底。
 *
 * 正常情况都应该显式写 ASCII 路径（中文名直接进 URL 会遇到百分号编码问题，
 * 历史上「一对二 / 一对三小组课」就因此点进了报错页）。这里只保证路径不为空，
 * 并把「缺路径」暴露在自检里，而不是让页面悄悄消失。
 */
function slugifyFallback(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii !== "" ? ascii : `course-${Buffer.from(title).toString("hex").slice(0, 12)}`;
}

/** 页面短字段中拼出的区块标题。 */
function heading(page: PageBlock, prefix: string): SectionHeading {
  return {
    eyebrow: pageString(page, `${prefix}_eyebrow`),
    title: pageString(page, `${prefix}_title`),
    description: pageString(page, `${prefix}_description`),
  };
}

/** 不带前缀的页面标题（课程页 / 教师页直接用 eyebrow / title / description）。 */
function pageHeading(page: PageBlock): SectionHeading {
  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
  };
}

/** 把「数学, 物理」拆分为数组，支持中英文逗号与顿号。 */
function splitList(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** 从教师分组的 `#### 科目: 数学` 条目中取值。 */
function fieldFrom(group: Group, label: string): string {
  return group.items.find((item) => item.title === label)?.value ?? "";
}

/**
 * 取教师的自由介绍。
 *
 * 介绍文字写在所有 `#### 字段` 之后，因此会被并进最后一个字段的条目正文里。
 * 这里把分组正文与最后一个条目的正文拼起来，字段增减都不会影响取到介绍。
 */
function teacherBio(group: Group): string {
  const lastItem = group.items.at(-1);
  return [group.body, lastItem?.body ?? ""]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

// ── 全站品牌与联系方式 ────────────────────────────────────────────────────

export function getSiteBrand(): SiteBrand {
  const page = getPageBlock("全站");
  return {
    brandName: pageString(page, "brand_name"),
    brandNameZh: pageString(page, "brand_name_zh"),
    tagline: pageString(page, "tagline"),
    description: pageString(page, "description"),
    copyrightHolder: pageString(page, "copyright_holder"),
    keywords: pageArray(page, "keywords"),
    homeTitle: pageString(page, "home_title"),
    titleSuffix: pageString(page, "title_suffix"),
    contact: {
      phone: pageString(page, "phone"),
      wechat: pageString(page, "wechat"),
      email: pageString(page, "email"),
      address: pageString(page, "address"),
      businessHours: pageString(page, "business_hours"),
      classHours: pageString(page, "class_hours"),
    },
  };
}

// ── 课程栏目（首页与课程页共用） ──────────────────────────────────────────

/**
 * 课程页上真实存在的锚点集合：学科名 + 小节名（取「｜」之前）+ 选修课名。
 *
 * 用来决定「卡片标题点哪里」——卡片代表一门课，优先指向这门课自己的说明；
 * 只有当这门课没有独立说明（例如「高中物理」拆成了学考/选考两节）时，
 * 才退回到它的第一个标签。
 */
function courseSectionNames(): Set<string> {
  const page = getPageBlock("课程");
  const names = new Set<string>();
  for (const group of page.groups) {
    // 带「｜」子条目的分组是学科：分组名本身就是详情区的锚点
    if (group.children.some((child) => child.name.includes("｜"))) names.add(group.name);
    for (const child of group.children) {
      names.add((child.name.split("｜")[0] ?? child.name).trim());
    }
  }
  return names;
}

/**
 * 课程栏目结构：`栏目 → 子标题 → 卡片`。
 *
 * 数据格式（content.md「页面: 全站 → ### 课程栏目」）：
 *   `#### 卡片名 | 栏目: 高中课内 · 子栏目: 七选三 · 标签: 学考→高中物理学考、选考→高中物理选考`
 *
 * 三条约定：
 *   - 卡片名就是课程名，卡片与标签都指向课程页的小节；
 *   - 课程内部没有细分时**不写标签**，整张卡片即入口；
 *   - `子栏目` 只在栏目需要再分组时写（目前只有高中课内的 必考科目 / 外语 / 七选三）。
 */
export function getCourseColumns(): CourseColumn[] {
  /*
   * 两条来源二选一（见本文件头的「两态取数」）。构站时连得上后端，
   * `data/site/.backend-snapshot.ts` 里就有库里的课程卡片，这里直接映射成同一套
   * `CourseColumn` 结构；连不上（GitHub Pages 那种没有后端的环境）就解析 Markdown。
   * **返回结构完全一样**，因此页面组件一行都不用改，全站的下游（栏目页、卡片页、
   * 班型页）自动跟着切。
   */
  const snapshot = backendSnapshot();
  if (snapshot !== null) return backendCourseColumns(snapshot);
  return getCourseColumnsFromTemplate();
}

/**
 * 课程栏目（**只读模版**，不看后端快照）。
 *
 * 为什么要单独留一个"只读模版"的出口：`lib/backend/*` 里有一批代码属于
 * **「内容文件 → 数据库」这个方向**（课程库从网站同步、从网站导入教师与正文、
 * 示例数据夹具）。它们必须读模版，否则会绕成一个圈：库里的数据 → 构站快照 → 再点一次
 * "从网站同步"读到的却是快照（也就是库自己）。
 *
 * 这个圈不是理论问题：我第一版就是这样，结果**选修课的一句话介绍永远导不进去**
 * —— 因为导入时读到的那份"网站内容"，正是它自己要填的那份数据。
 */
export function getCourseColumnsFromTemplate(): CourseColumn[] {
  const page = getPageBlock("全站");
  const sections = courseSectionNames();
  const columns: CourseColumn[] = [];

  for (const item of getGroup(page, "课程栏目").items) {
    // 先摘出「子栏目」再摘「栏目」：否则 /栏目:/ 会命中「子栏目:」里的同名片段
    const subgroupRaw = /子栏目\s*[:：]\s*([^·]+)/.exec(item.value)?.[1]?.trim() ?? "";
    const rest = item.value.replace(/子栏目\s*[:：][^·]*/, "");
    const columnTitle = /栏目\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    if (columnTitle === "") continue;

    // 每张卡片一个独立页面，路径写在 `· 路径: <ascii>` 里
    const cardPath = /路径\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";

    // 「暂未开放」写在卡片行里，页面上显示成卡片右上角的标记
    const statusText = /状态\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    // 「班型」写的是「特色课程」里的班型名，用顿号分隔
    const formsText = /班型\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    const tagText = /标签\s*[:：]\s*(.+)$/.exec(rest)?.[1]?.trim() ?? "";
    const tags: CourseTag[] = tagText
      .split(/[、,，]/)
      .map((raw) => raw.trim())
      .filter((raw) => raw !== "")
      .map((raw) => {
        const [label = "", target] = raw.split(/→|->/).map((x) => x.trim());
        return { label, target: target !== undefined && target !== "" ? target : label };
      });

    const title = item.title.trim();
    const card: CourseColumnCard = {
      title,
      path: cardPath !== "" ? cardPath : slugifyFallback(title),
      unavailable: statusText === "暂未开放",
      forms: formsText
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== ""),
      tags,
      // 这门课自己有说明小节就指向它；否则退回到第一个标签（七选三这类没有总览小节）
      target: sections.has(title) ? title : (tags[0]?.target ?? title),
    };

    let column = columns.find((c) => c.title === columnTitle);
    if (column === undefined) {
      column = { title: columnTitle, subgroups: [] };
      columns.push(column);
    }

    let subgroup = column.subgroups.find((g) => g.title === subgroupRaw);
    if (subgroup === undefined) {
      subgroup = { title: subgroupRaw, cards: [] };
      column.subgroups.push(subgroup);
    }
    subgroup.cards.push(card);
  }

  return columns;
}

// ── 首页 ──────────────────────────────────────────────────────────────────

export function getHomeContent(): HomeContent {
  const page = getPageBlock("首页");
  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    subtitle: pageString(page, "subtitle"),
    primaryCta: {
      label: pageString(page, "primary_cta_label"),
      href: pageString(page, "primary_cta_href", "/courses"),
    },
    secondaryCta: {
      label: pageString(page, "secondary_cta_label"),
      href: pageString(page, "secondary_cta_href", "/contact"),
    },
    stats: getGroup(page, "首屏数据").items,
    features: getGroup(page, "教学特色").items,
    // 首页课程区按班型展示（页面直接读特色课程），这里不再返回学科栏目
    classrooms: getGroup(page, "教室照片格位").items,
    trial: {
      eyebrow: pageString(page, "trial_eyebrow"),
      title: pageString(page, "trial_title"),
      description: pageString(page, "trial_description"),
      points: pageString(page, "trial_points")
        .split("|")
        .map((item) => item.trim())
        .filter((item) => item !== ""),
      cta: {
        label: pageString(page, "trial_cta_label"),
        href: pageString(page, "trial_cta_href", "/quote"),
      },
    },
    cases: {
      eyebrow: pageString(page, "cases_eyebrow"),
      title: pageString(page, "cases_title"),
      description: pageString(page, "cases_description"),
      cta: {
        label: pageString(page, "cases_cta_label"),
        href: pageString(page, "cases_cta_href", "/cases"),
      },
    },
    cta: {
      title: pageString(page, "cta_title"),
      description: pageString(page, "cta_description"),
      label: pageString(page, "cta_label"),
      href: pageString(page, "cta_href", "/contact"),
    },
  };
}

/** 首页各区块的标题与跳转按钮。 */
export function getHomeSectionHeadings(): {
  features: SectionHeading;
  courses: SectionHeading;
  teachers: SectionHeading;
  classrooms: SectionHeading;
  coursesLink: { label: string; href: string };
  teachersLink: { label: string; href: string };
} {
  const page = getPageBlock("首页");
  return {
    features: heading(page, "features"),
    courses: heading(page, "courses"),
    teachers: heading(page, "teachers"),
    classrooms: heading(page, "classrooms"),
    coursesLink: {
      label: pageString(page, "courses_link_label"),
      href: pageString(page, "courses_link_href", "/courses"),
    },
    teachersLink: {
      label: pageString(page, "teachers_link_label"),
      href: pageString(page, "teachers_link_href", "/teachers"),
    },
  };
}

// ── 课程页 ────────────────────────────────────────────────────────────────

/**
 * 课程页内容。
 *
 * 数据文件里有两类分组，这里显式分开返回，避免把选修课的父分组
 * 也当成学科塞进学科网格：
 *   - 学科课程：`### 学科` → `#### 学段｜一句话`（含学段小节）
 *   - 选修课程：`### 成人课程与课外兴趣` → `#### 课程名` + 「状态」字段
 */
export function getCoursesPage(): {
  heading: SectionHeading;
  /** 学科课程（学科 → 学段小节），用于课程详情区。 */
  courses: Course[];
  /** 课程总览的栏目结构，与首页同源。 */
  columns: CourseColumn[];
  /** 选修类课程的父分组名称。 */
  electiveTitle: string;
  /** 选修课按栏目（外语 / 课外兴趣 / 成人课程）分组。 */
  electiveGroups: Array<{ title: string; items: ElectiveCourse[] }>;
} {
  // 同上：连上后端就用库里的学科正文与选修课，否则解析 Markdown（同一次构建里全站同源）
  const snapshot = backendSnapshot();
  if (snapshot !== null) return backendCoursesPage(snapshot);
  return getCoursesPageFromTemplate();
}

/** 课程页内容（**只读模版**，不看后端快照）—— 理由同 `getCourseColumnsFromTemplate`。 */
export function getCoursesPageFromTemplate(): {
  heading: SectionHeading;
  /** 学科课程（学科 → 学段小节），用于课程详情区。 */
  courses: Course[];
  /** 课程总览的栏目结构，与首页同源。 */
  columns: CourseColumn[];
  /** 选修类课程的父分组名称。 */
  electiveTitle: string;
  /** 选修课按栏目（外语 / 课外兴趣 / 成人课程）分组。 */
  electiveGroups: Array<{ title: string; items: ElectiveCourse[] }>;
} {
  const page = getPageBlock("课程");

  // 选修课分组的名称由数据文件决定，这里通过「子分组带状态字段」识别
  const isElectiveGroup = (group: Section): boolean =>
    group.children.length > 0 &&
    group.children.every((child) =>
      child.fields.some((field) => field.name === "状态"),
    );

  const subjectGroups = page.groups.filter((group) => !isElectiveGroup(group));
  const electiveGroup = page.groups.find(isElectiveGroup);

  const courses = subjectGroups.map<Course>((group) => ({
    id: group.name,
    nameZh: group.name,
    unavailable:
      group.fields.find((field) => field.name === "状态")?.value.trim() === "暂未开放",
    lead: group.body.trim(),
    bands: group.children.map((child) => ({
      // Group 的字段名是 name；这里转成对外的 title
      title: child.name,
      content: child.body.trim(),
    })),
  }));

  const electives = (electiveGroup?.children ?? []).map<ElectiveCourse>((child) => ({
    id: child.name,
    name: child.name,
    description: child.body.trim(),
    // 「栏目」把选修课分到外语 / 课外兴趣 / 成人课程
    group: child.fields.find((field) => field.name === "栏目")?.value.trim() ?? "",
    available:
      child.fields.find((field) => field.name === "状态")?.value.trim() !== "暂未开放",
  }));

  // 按「栏目」字段把选修课分组，并保持数据文件中的出现顺序
  const electiveGroups: Array<{ title: string; items: ElectiveCourse[] }> = [];
  for (const course of electives) {
    const title = course.group !== "" ? course.group : (electiveGroup?.name ?? "选修课程");
    const existing = electiveGroups.find((g) => g.title === title);
    if (existing !== undefined) existing.items.push(course);
    else electiveGroups.push({ title, items: [course] });
  }

  return {
    heading: pageHeading(page),
    courses,
    columns: getCourseColumns(),
    electiveTitle: electiveGroup?.name ?? "",
    electiveGroups,
  };
}

// ── 课程卡片页（每张卡片一个页面） ────────────────────────────────────────

/** 小节标题里「｜」之前的部分就是锚点名。 */
function stageAnchor(title: string): string {
  return (title.split("｜")[0] ?? title).trim();
}

/** 小节标题里「｜」之后的部分是导语。 */
function stageLead(title: string): string {
  const parts = title.split("｜");
  return parts.length > 1 ? (parts[1] ?? "").trim() : "";
}

/**
 * 课程页（详情）里所有可引用的小节索引。
 *
 * 卡片页要把「阶段」的内容渲染出来，而阶段内容存在「页面: 课程」段
 * （`### 学科` → `#### 小节｜一句话`），因此这里先建一张锚点索引。
 */
function courseStageIndex(): {
  bands: Map<string, { stage: CourseStage; group: string }>;
  subjects: Map<string, { lead: string; anchors: string[] }>;
  electives: Map<string, string>;
} {
  const { courses, electiveGroups } = getCoursesPage();
  const bands = new Map<string, { stage: CourseStage; group: string }>();
  const subjects = new Map<string, { lead: string; anchors: string[] }>();

  for (const course of courses) {
    const anchors: string[] = [];
    for (const band of course.bands) {
      const anchor = stageAnchor(band.title);
      anchors.push(anchor);
      bands.set(anchor, {
        stage: {
          anchor,
          title: band.title,
          lead: stageLead(band.title),
          body: band.content,
        },
        group: course.nameZh,
      });
    }
    subjects.set(course.nameZh, { lead: course.lead, anchors });
  }

  const electives = new Map<string, string>();
  for (const group of electiveGroups) {
    for (const item of group.items) electives.set(item.name, item.description);
  }

  return { bands, subjects, electives };
}

/**
 * 栏目的页面路径。
 *
 * 栏目名是**结构**（自检固定了六个），因此这里直接映射；
 * 一旦有人改了栏目名，自检会立刻报「栏目缺路径」，不会静默 404。
 */
export const COLUMN_PATHS: Record<string, string> = {
  小学课内: "primary",
  初中课内: "junior",
  高中课内: "senior",
  外语: "languages",
  课外兴趣: "interests",
  成人课程: "adults",
};

/** 正文第一段，用作科目/卡片的一句话简介。 */
function firstParagraph(markdown: string): string {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    // 列表行（核心能力）不当作简介
    .find((part) => part !== "" && !part.startsWith("- "));
  return (paragraph ?? "").replace(/[*_`]/g, "");
}

/** 全部卡片页路径（静态导出用）。 */
export function getAllCoursePageSlugs(): string[] {
  return getCourseColumns().flatMap((column) =>
    column.subgroups.flatMap((subgroup) => subgroup.cards.map((card) => card.path)),
  );
}

/**
 * 一张卡片的页面数据。
 *
 * 页面结构由三条规则决定：
 *   1. 卡片上的每个标签 = **同一页面内的一个阶段**（如 高中物理 → 学考 / 选考），
 *      不为标签单独建页面；
 *   2. 卡片没有标签时，「阶段」就是这门课自己在详情里那一段；
 *   3. 页面还要给出与其他阶段的关联：同一学科的其他学段（小学语文 → 初中语文 /
 *      高中语文），以及同栏目（同子栏目）的其他课程。
 */
export function getCoursePageData(slug: string): CoursePageData | null {
  const columns = getCourseColumns();
  let found: { card: CourseColumnCard; column: string; subgroup: string } | null = null;
  let columnCards: CourseColumnCard[] = [];
  let subgroupCards: CourseColumnCard[] = [];

  for (const column of columns) {
    for (const subgroup of column.subgroups) {
      for (const card of subgroup.cards) {
        if (card.path !== slug) continue;
        found = { card, column: column.title, subgroup: subgroup.title };
        columnCards = column.subgroups.flatMap((item) => item.cards);
        subgroupCards = subgroup.cards;
      }
    }
  }
  if (found === null) return null;

  const { card, column, subgroup } = found;
  const index = courseStageIndex();

  // ── 本卡片的阶段 ──────────────────────────────────────────────────────
  const stages: CourseStage[] = [];
  if (card.tags.length > 0) {
    for (const tag of card.tags) {
      const hit = index.bands.get(tag.target);
      if (hit !== undefined) stages.push(hit.stage);
    }
  } else if (index.subjects.has(card.title)) {
    for (const anchor of index.subjects.get(card.title)?.anchors ?? []) {
      const hit = index.bands.get(anchor);
      if (hit !== undefined) stages.push(hit.stage);
    }
  } else {
    const hit = index.bands.get(card.title);
    if (hit !== undefined) stages.push(hit.stage);
  }

  const intro =
    index.subjects.get(card.title)?.lead ??
    index.electives.get(card.title) ??
    stages[0]?.lead ??
    "";

  /*
   * 卡片自己有总览小节时（如「雅思｜按目标分数提分」），它不对应任何标签，
   * 既不是阶段也不该被丢掉 —— 作为页面开头的「课程说明」渲染。
   */
  const ownSection = index.bands.get(card.title)?.stage ?? null;
  const overview = card.tags.length > 0 ? ownSection : null;

  // ── 同一学科的其他阶段 ────────────────────────────────────────────────
  const ownAnchors = new Set(stages.map((stage) => stage.anchor));
  const subjectNames = new Set<string>();
  if (index.subjects.has(card.title)) subjectNames.add(card.title);
  for (const stage of stages) {
    const hit = index.bands.get(stage.anchor);
    if (hit !== undefined) subjectNames.add(hit.group);
  }

  const otherAnchors = new Set<string>();
  for (const name of subjectNames) {
    for (const anchor of index.subjects.get(name)?.anchors ?? []) {
      if (!ownAnchors.has(anchor)) otherAnchors.add(anchor);
    }
  }
  const sameSubject = columns
    .flatMap((item) => item.subgroups.flatMap((group) => group.cards))
    .filter((item) => item.path !== slug && otherAnchors.has(item.title));

  // ── 同栏目（有子栏目时同子栏目）的其他课程 ────────────────────────────
  const siblings = subgroup !== "" ? subgroupCards : columnCards;
  const sameSubjectPaths = new Set(sameSubject.map((item) => item.path));
  const sameColumn = siblings.filter(
    (item) => item.path !== slug && !sameSubjectPaths.has(item.path),
  );

  return {
    card,
    column,
    subgroup,
    intro,
    overview,
    stages,
    sameSubject,
    sameColumn,
    forms: card.forms,
    teachers: teachersForCourse(card, stages),
  };
}

/**
 * 能带这门课的教师。
 *
 * 判据是教师页的「科目」字段：只要教师的某个科目出现在卡片名或它的阶段名里，
 * 就认为这位教师可以带这门课（例如 陈老师 的「物理」命中「高中物理」，
 * 「德语」命中「高考外语」的阶段「德语B2」）。
 *
 * 刻意不做「猜」：科目对不上就不显示，页面会给出「以咨询确认为准」的说明，
 * 而不是硬塞一位老师上去。
 */
function teachersForCourse(card: CourseColumnCard, stages: CourseStage[]): Teacher[] {
  const haystack = [card.title, ...stages.map((stage) => stage.anchor)].join(" ");
  return getTeachersPage().teachers.filter(
    (teacher) =>
      teacher.kind === "teacher" &&
      teacher.subjects.some((subject) => subject !== "" && haystack.includes(subject)),
  );
}

/** 栏目（学段）页：该栏目下各科目的简介。 */
export function getCourseColumnPageData(slug: string): CourseColumnPageData | null {
  const columns = getCourseColumns();
  const column = columns.find((item) => COLUMN_PATHS[item.title] === slug);
  if (column === undefined) return null;

  const index = courseStageIndex();

  /** 科目简介：学科导语 → 选修课介绍 → 第一个阶段正文的第一段。 */
  const summaryOf = (card: CourseColumnCard): string => {
    const subjectLead = firstParagraph(index.subjects.get(card.title)?.lead ?? "");
    if (subjectLead !== "") return subjectLead;

    const elective = index.electives.get(card.title);
    if (elective !== undefined && elective !== "") return elective;

    if (card.tags.length > 0) {
      const first = index.bands.get(card.tags[0]?.target ?? "");
      const text = firstParagraph(first?.stage.body ?? "");
      if (text !== "") return text;
    }

    const own = index.bands.get(card.title);
    const ownText = firstParagraph(own?.stage.body ?? "");
    if (ownText !== "") return ownText;

    return index.bands.get(card.title)?.stage.lead ?? "";
  };

  return {
    title: column.title,
    subgroups: column.subgroups.map((subgroup) => ({
      title: subgroup.title,
      cards: subgroup.cards.map((card) => ({ ...card, summary: summaryOf(card) })),
    })),
    otherColumns: columns
      .filter((item) => item.title !== column.title)
      .map((item) => ({ title: item.title, href: `/courses/${COLUMN_PATHS[item.title] ?? ""}` })),
  };
}

/**
 * 某个班型下开设了哪些课程（反向关联：班型页 → 学科）。
 *
 * 正向关系写在卡片行的 `· 班型:` 里，这里反向查回来，
 * 因此两者永远一致 —— 改卡片上的班型，班型页会跟着变，不需要两处维护。
 */
export function getCardsForForm(
  form: string,
): Array<{ card: CourseColumnCard; column: string; subgroup: string }> {
  return getCourseColumns().flatMap((column) =>
    column.subgroups.flatMap((subgroup) =>
      subgroup.cards
        .filter((card) => card.forms.includes(form))
        .map((card) => ({ card, column: column.title, subgroup: subgroup.title })),
    ),
  );
}

/**
 * 班型页里的「开设这个班型的科目」，按阶段分组。
 *
 * 页面用卡片网格展示，而卡片是横向铺开的 —— 32 门课平铺成一列会很长、
 * 不好找，因此这里按「栏目 → 子栏目」组织，页面只需照着渲染。
 */
export function getFormSubjectGroups(form: string): FormSubjectGroup[] {
  const groups: FormSubjectGroup[] = [];

  for (const column of getCourseColumns()) {
    const subgroups: FormSubjectGroup["subgroups"] = [];
    for (const subgroup of column.subgroups) {
      const cards = subgroup.cards.filter((card) => card.forms.includes(form));
      if (cards.length > 0) subgroups.push({ title: subgroup.title, cards });
    }
    if (subgroups.length === 0) continue;

    const path = COLUMN_PATHS[column.title];
    groups.push({
      column: column.title,
      columnHref: path !== undefined ? `/courses/${path}` : COURSES_HREF,
      subgroups,
    });
  }

  return groups;
}

/** 全部栏目页路径（静态导出用）。 */
export function getAllCourseColumnSlugs(): string[] {
  return getCourseColumns()
    .map((column) => COLUMN_PATHS[column.title])
    .filter((slug): slug is string => slug !== undefined && slug !== "");
}

// ── 教师页 ────────────────────────────────────────────────────────────────
/**
 * 把教师分组转成 Teacher。
 *
 * 支持两个管理用字段（不显示在页面上）：
 *   排序 —— 越小越靠前，未填时按 999 排在最后
 *   状态 —— 填「离职」表示保留资料但不在页面展示
 */
function toTeacher(section: Section): Teacher {
  const orderRaw = fieldFrom(section, "排序");
  const orderValue = Number.parseFloat(orderRaw);
  const status = fieldFrom(section, "状态");

  const kindRaw = fieldFrom(section, "类型");

  return {
    id: section.name,
    // 填「AI」即视为智能体；其余情况都是真人教师
    kind: kindRaw.trim().toUpperCase() === "AI" ? "ai" : "teacher",
    name: section.name,
    role: fieldFrom(section, "职务"),
    subjects: splitList(fieldFrom(section, "科目")),
    years: fieldFrom(section, "教龄"),
    summary: fieldFrom(section, "简介"),
    recommendation: fieldFrom(section, "推荐理由"),
    order: Number.isFinite(orderValue) ? orderValue : 999,
    active: status === "" || status === "在职",
    bio: teacherBio(section),
  };
}


export function getTeachersPage(): {
  heading: SectionHeading;
  teachers: Teacher[];
} {
  // 同上：连上后端就用库里的教师档案（含"是否在网站展示"的过滤），否则解析 Markdown
  const snapshot = backendSnapshot();
  if (snapshot !== null) return backendTeachersPage(snapshot);
  return getTeachersPageFromTemplate();
}

/** 教师页（**只读模版**，不看后端快照）—— 理由同 `getCourseColumnsFromTemplate`。 */
export function getTeachersPageFromTemplate(): {
  heading: SectionHeading;
  teachers: Teacher[];
} {
  const page = getPageBlock("教师");

  const teachers = page.groups
    // 带有「科目」或「简介」的分组才算教师，其余说明段落自动排除
    .filter(
      (group) => fieldFrom(group, "科目") !== "" || fieldFrom(group, "简介") !== "",
    )
    .map(toTeacher)
    // 离职教师保留资料但不在页面展示
    .filter((teacher) => teacher.active)
    // 按「排序」升序；未填写的排在最后，同序号保持文件顺序
    .sort((a, b) => a.order - b.order);

  return { heading: pageHeading(page), teachers };
}


// ── 关于我们 ──────────────────────────────────────────────────────────────

export function getAboutContent(): AboutContent {
  const page = getPageBlock("关于");
  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    philosophy: {
      eyebrow: "",
      title: pageString(page, "philosophy_title"),
      description: pageString(page, "philosophy_description"),
    },
    serviceTitle: pageString(page, "service_title"),
    services: getGroup(page, "服务形式").items,
    campusTitle: pageString(page, "campus_title"),
    principles: getGroup(page, "教学理念").items,
    facts: getGroup(page, "校区数据").items,
    // 校区介绍：只显示每条的「值」，名称仅用于作者辨识。
    campusParagraphs: getGroup(page, "校区介绍").items.map((item) => item.value),
  };
}

// ── 联系我们 ──────────────────────────────────────────────────────────────

export function getContactContent(): ContactContent {
  const page = getPageBlock("联系我们");
  return {
    eyebrow: pageString(page, "eyebrow"),
    title: pageString(page, "title"),
    description: pageString(page, "description"),
    methods: getGroup(page, "联系方式清单").items,
    routeTitle: pageString(page, "route_title"),
    routeDescription: pageString(page, "route_description"),
    routeParagraph: pageString(page, "route_paragraph"),
    disabledActionLabel: pageString(page, "disabled_action_label"),
  };
}
