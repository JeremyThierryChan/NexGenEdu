import {
  getGroup,
  getPageBlock,
  parseDocument,
  pageString,
  type Group,
  type PageBlock,
  type Section,
} from "@/lib/data/content";
import { scheduleSource } from "@/data/site/schedule";
import { COURSES_HREF } from "@/lib/site/featured-routes";
import { unavailableLast, unavailableLastInGroups } from "@/lib/backend/availability-order";
import {
  backendCourseColumns,
  backendCoursesPage,
  backendSnapshot,
  backendTeachersPage,
  siteContentSource,
} from "@/lib/site/backend-source";
import {
  SITE_COPY_PAGES,
  blankSource,
  blockSource,
  pageSource,
  type CopySource,
} from "@/lib/backend/site-copy-model";
import type { SiteCopyKey } from "@/lib/backend/types";
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
  LabeledItem,
  SectionHeading,
  SiteBrand,
  Teacher,
} from "@/lib/types/site";

/**
 * 数据访问层：页面获取内容的唯一入口。
 *
 * ## 库里才有的那几块：连上后端就用库，连不上就**条目为空、骨架照常**
 *
 * 它们 = **教师 / 课程卡片 / 课程正文 / 报价 / 学生案例 / 特色课程 / 常见问题**
 * （只有库里才有的内容）。三个取值见 `siteContentSource()`：
 * `backend`（用库）/ `blank`（默认：没连上）/ `template`（显式要求模版，本地对照用）。
 *
 * **`blank` 到底空什么（机构先后给了两句，合起来才是完整口径）**：
 *
 *   1. 「需要用到后端数据的部分应该是空白的」→ **条目为空**，不拿模版顶上
 *      （那样分不清页面上看到的到底是库里的还是文件里的）；
 *   2. 「不能全空，得有分区标题」→ **骨架照常**：页面眉题 / 标题 / 说明、分区标题、
 *      页脚提示、报价页那些按钮文案都属于"页面长什么样"，来自模版；
 *      连不上后端时它们照常显示，只有底下的条目是空的（并在需要处显示一句空状态）。
 *
 * 一句话：**`blank` = 模版骨架 + 空条目**。两条边界都要守住 ——
 * 只守住第 1 条会得到"整页空白"（机构会以为坏了），只守住第 2 条就退回"拿模版当数据"。
 *
 * 刻意不写 `backendX() ?? getXFromTemplate()`：那让每一块各自决定，
 * 于是同一页会一半来自库、一半来自文件，而页面上看不出来。
 * 其余页面（首页文案 / 关于 / 联系 / FAQ / 课表 / 特色课程 / 品牌与联系方式）不在库里，
 * 永远来自 `data/site/*.md`，与后端连不连无关。
 *
 * 全部内容都来自单文件 data/site/content.md，按页面分段（见 lib/data/content.ts）。
 * 页面只能调用本文件的函数，不得直接读文件或解析 Markdown。
 * 未来接入 PostgreSQL / API 时替换本文件实现即可，页面调用方式不变。
 */

/**
 * 卡片没写 `· 路径:` 时的兜底。
 *
 * 正常情况都应该显式写 ASCII 路径（中文名直接进 URL 会遇到百分号编码问题，
 * 历史上「一对二」就因此点进了报错页）。这里只保证路径不为空，
 * 并把「缺路径」暴露在自检里，而不是让页面悄悄消失。
 */
function slugifyFallback(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii !== "" ? ascii : `course-${Buffer.from(title).toString("hex").slice(0, 12)}`;
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

/*
 * ── 页面文案块（品牌 / 首页 / 关于 / 联系我们 / 时间安排）────────────────────
 *
 * 这五块形状相同（短字段 + 分组），因此**只用一份读取接口** `CopySource`：
 *
 *   - 连上后端 → `blockSource(库里的那一块)`；
 *   - 显式 template → `pageSource(模版那一页)`；
 *   - 没连上（默认）→ `blankSource(模版那一份)`：**短字段与分组标题保留、组内条目清空**。
 *
 * 下面每个块的映射函数（`brandFrom` / `homeFrom` / …）只认 `CopySource`，
 * 因此"两条来源产出同一份页面数据"是**结构上成立**的，而不是靠断言去追。
 * 这也让"搬进库"这件事不会改变页面上的任何一个字 —— 映射只有一份。
 */
export function copySourceFor(key: SiteCopyKey): CopySource {
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) {
    return blockSource(snapshot.siteContent?.copy?.[key]);
  }
  const templateSource = pageSource(templatePageFor(key));
  return siteContentSource() === "template" ? templateSource : blankSource(templateSource);
}

/**
 * 模版那一份在哪一页：`content.md` 里四块，**时间安排单独一个文件**（`schedule.md`）。
 *
 * 这一处曾经写错（把五块都当成 `content.md` 的页面去取），症状是"时间安排的分组全没了"，
 * 而自检里那几条"分组数 / 分组名 / 每组的时段"当场报红 —— 因此那几条断言值钱，
 * 它们盯的正是"块与文件对不对得上"。
 */
function templatePageFor(key: SiteCopyKey): PageBlock {
  const name = SITE_COPY_PAGES[key];
  if (key !== "schedule") return getPageBlock(name);
  const document = parseDocument(scheduleSource);
  const page = document.pages.get(name);
  return page ?? { name, data: {}, groups: [] };
}

// ── 全站品牌与联系方式 ────────────────────────────────────────────────────

export function getSiteBrand(): SiteBrand {
  return brandFrom(copySourceFor("brand"));
}

/**
 * 品牌与联系方式（**只认 `CopySource`**）：模版与库两处共用它。
 *
 * 这块**没有分组**（全是短字段），因此 `blank` 时它等于模版那一份 ——
 * 机构的电话与地址是"网站自己的身份"，不是"后端才有的一条数据"，空着只会让页脚看起来坏了。
 */
function brandFrom(source: CopySource): SiteBrand {
  return {
    brandName: source.field("brand_name"),
    brandNameZh: source.field("brand_name_zh"),
    tagline: source.field("tagline"),
    description: source.field("description"),
    copyrightHolder: source.field("copyright_holder"),
    keywords: source.list("keywords"),
    homeTitle: source.field("home_title"),
    titleSuffix: source.field("title_suffix"),
    contact: {
      phone: source.field("phone"),
      wechat: source.field("wechat"),
      email: source.field("email"),
      address: source.field("address"),
      businessHours: source.field("business_hours"),
      classHours: source.field("class_hours"),
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
   * 两条来源二选一（见本文件头的「三态取数」）。构站时连得上后端，
   * `data/site/.backend-snapshot.ts` 里就有库里的课程卡片，这里直接映射成同一套
   * `CourseColumn` 结构；连不上就**空数组**（机构口径）；显式
   * `SITE_CONTENT_SOURCE=template` 才解析 Markdown。**返回结构完全一样**，
   * 因此页面组件一行都不用改，全站的下游（栏目页、卡片页、班型页）自动跟着切。
   *
   * 「空」只表示**没有卡片**：栏目本身（标题、顺序）是**后端数据**，没连后端时也不存在，
   * 因此这里返回空数组、由页面把「课程总览」那一块渲染成空状态（标题照常有，见 §空态口径）。
   *
   * ## 「暂未开放」往后排（两条路径都排）
   *
   * 卡片在**同一个子栏目内**、暂未开放的排到最后 —— 排序规则只写在
   * `lib/backend/availability-order.ts` 一处，两条路径各调一次（这里是模版那条，
   * `backendCourseColumns` 是库里那条）。刻意排在这里（页面出口）而**不排进
   * `getCourseColumnsFromTemplate()`**：后者是"内容文件 → 数据"的原始解析，
   * `lib/backend/courses.ts` 建库、`site:diff` 对账都读它，往里加显示排序会把
   * 显示顺序写进数据（`npm run site:export -- --check` 会当场报不一致）。
   */
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendCourseColumns(snapshot);
  return siteContentSource() === "template" ? columnsWithUnavailableLast(getCourseColumnsFromTemplate()) : [];
}

/**
 * 课程栏目里的卡片「暂未开放」往后排（**显示**规则，判据与实现在
 * `lib/backend/availability-order.ts`）。
 *
 * 只动卡片在**本子栏目内**的位置：栏目顺序、子栏目顺序、以及"开放的那几张"之间的
 * 先后（机构在后台用 ↑↓ 排的）一律不变 —— 这是稳定排序，不是重新排一遍。
 * 一张卡片都不删：暂未开放的卡片在网站上加着「暂未开放」标记照旧显示，只是靠后。
 */
export function columnsWithUnavailableLast(columns: readonly CourseColumn[]): CourseColumn[] {
  return columns.map((column) => ({
    ...column,
    subgroups: column.subgroups.map((subgroup) => ({
      ...subgroup,
      cards: unavailableLast(subgroup.cards, (card) => card.unavailable),
    })),
  }));
}

/**
 * 课程栏目（**只读模版**，不看后端快照）。
 *
 * 为什么要单独留一个"只读模版"的出口：`lib/backend/*` 里有一批代码属于
 * **「内容文件 → 数据库」这个方向**（建库时的课程与正文初值、示例数据夹具）。
 * 它们必须读模版，否则会绕成一个圈：库里的数据 → 构站快照 → 建库时读到的却是快照
 * （也就是库自己）。
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
  return homeFrom(copySourceFor("home"));
}

/** 首页文案（**只认 `CopySource`**）：模版与库两处共用它，见 `copySourceFor` 的说明。 */
function homeFrom(source: CopySource): HomeContent {
  const groupItems = (name: string): LabeledItem[] =>
    source.group(name).items.map((item) => ({ title: item.title, value: item.value }));
  return {
    eyebrow: source.field("eyebrow"),
    title: source.field("title"),
    subtitle: source.field("subtitle"),
    primaryCta: {
      label: source.field("primary_cta_label"),
      href: source.field("primary_cta_href", "/courses"),
    },
    secondaryCta: {
      label: source.field("secondary_cta_label"),
      href: source.field("secondary_cta_href", "/contact"),
    },
    stats: groupItems("首屏数据"),
    features: groupItems("教学特色"),
    // 首页课程区按班型展示（页面直接读特色课程），这里不再返回学科栏目
    classrooms: groupItems("教室照片格位"),
    trial: {
      eyebrow: source.field("trial_eyebrow"),
      title: source.field("trial_title"),
      description: source.field("trial_description"),
      // 内容文件里写成一串「用竖线分隔」，库里存多行文本 —— `list()` 两种都认
      points: source.list("trial_points"),
      cta: {
        label: source.field("trial_cta_label"),
        href: source.field("trial_cta_href", "/quote"),
      },
    },
    cases: {
      eyebrow: source.field("cases_eyebrow"),
      title: source.field("cases_title"),
      description: source.field("cases_description"),
      cta: {
        label: source.field("cases_cta_label"),
        href: source.field("cases_cta_href", "/cases"),
      },
    },
    cta: {
      title: source.field("cta_title"),
      description: source.field("cta_description"),
      label: source.field("cta_label"),
      href: source.field("cta_href", "/contact"),
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
  return homeHeadingsFrom(copySourceFor("home"));
}

/** 首页各区块的标题（**只认 `CopySource`**）：短字段是骨架，因此在三种来源下都在。 */
function homeHeadingsFrom(source: CopySource): {
  features: SectionHeading;
  courses: SectionHeading;
  teachers: SectionHeading;
  classrooms: SectionHeading;
  coursesLink: { label: string; href: string };
  teachersLink: { label: string; href: string };
} {
  const section = (prefix: string): SectionHeading => ({
    eyebrow: source.field(`${prefix}_eyebrow`),
    title: source.field(`${prefix}_title`),
    description: source.field(`${prefix}_description`),
  });
  return {
    features: section("features"),
    courses: section("courses"),
    teachers: section("teachers"),
    classrooms: section("classrooms"),
    coursesLink: {
      label: source.field("courses_link_label"),
      href: source.field("courses_link_href", "/courses"),
    },
    teachersLink: {
      label: source.field("teachers_link_label"),
      href: source.field("teachers_link_href", "/teachers"),
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
  /*
   * 连上后端 → 库里的学科正文与选修课；显式 template → 模版那一份；
   * **没连上（默认）→ 骨架用模版、条目为空**：标题与说明是"页面长什么样"，属于网站骨架，
   * 空着会让人以为整页坏了（机构反馈过）；课程与栏目是**条目**，没连后端就没有。
   */
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendCoursesPage(snapshot);
  const frame = getCoursesPageFromTemplate();
  if (siteContentSource() === "template") return coursesPageWithUnavailableLast(frame);
  return {
    heading: frame.heading,
    courses: [],
    columns: [],
    electiveTitle: frame.electiveTitle,
    electiveGroups: [],
  };
}

/**
 * 课程页「暂未开放往后排」（**显示**规则，判据与实现在 `lib/backend/availability-order.ts`）。
 *
 * 两处要排，用的是同一个纯函数（与后端快照那条路、与 `getCourseColumns()` 完全一致）：
 *   - **学科列表**（`courses`）：整组标了「暂未开放」的学科排到最后（`Course.unavailable`）
 *     —— 注意 `/courses` 页 2026-09 起不再内联渲染这一份（课程详情改成"一张卡片一个页面"），
 *     但它是**同一份课程页数据**的一部分（卡片页的锚点索引读它），两条取数路径必须一致；
 *   - **选修课列表**：不可选的选修课排到**它所在栏目分组内**的最后（`ElectiveCourse.available`），
 *     分组本身（外语 / 课外兴趣 / 成人课程）的顺序来自分区表，不动；
 *   - 顺带把栏目树也过一遍（`columnsWithUnavailableLast`）—— 课程总览同一页要用。
 *
 * 只排序、不过滤：暂未开放的学科与选修课照旧列出（页面上灰掉 / 标注），只是靠后。
 */
export function coursesPageWithUnavailableLast(
  frame: ReturnType<typeof getCoursesPageFromTemplate>,
): ReturnType<typeof getCoursesPageFromTemplate> {
  return {
    ...frame,
    courses: unavailableLast(frame.courses, (course) => course.unavailable),
    columns: columnsWithUnavailableLast(frame.columns),
    electiveGroups: unavailableLastInGroups(
      frame.electiveGroups,
      (group) => group.items,
      (group, items) => ({ ...group, items }),
      (item) => !item.available,
    ),
  };
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
    /*
     * **必须显式读模版那一份**（`getCourseColumnsFromTemplate()`），不能写 `getCourseColumns()`：
     * 后者是"按这次构站的来源取数"的入口 —— 后端没连上时它返回空数组（那五块空白），
     * 于是"只读模版"这个出口会跟着变空，`lib/backend/site-content.ts` 那一批
     * 「内容文件 → 库」的路径（**建库初始化 / 老库迁移**）就**导不到任何卡片**了。
     */
    columns: getCourseColumnsFromTemplate(),
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
 * ## 2026-09 起：一门课 = 一段正文，页面里不再有并列阶段
 *
 * 机构要求「课程全都按照课程库里的来」。于是课程正文改成**一门课一个小节、段名就是课程名**，
 * 原来的级别 / 技能小节（高中物理的学考 / 选考、雅思的四项、日语的 N5–N3、A1–B2、
 * 3D 建模的三个软件…）不再各占一个锚点，而是**降级成那门课正文里的 `### 小标题`**。
 *
 * 因此「阶段」的取法简化成一条，但三条分支都保留着（老库 / 老数据仍可能命中前两条）：
 *   1. 卡片上的标签 = 同一页面内的一个阶段 —— 标签已经全部去掉，这条现在不会命中；
 *   2. 卡片名与某个**学科分组**同名时（雅思 → 分组「雅思」），用它名下全部小节；
 *   3. 否则取与卡片名同名的那个小节 —— 现在所有学科卡片走的都是这条。
 * 页面还要给出与其他课程的关联：同一学科的其他学段（小学语文 → 初中语文 / 高中语文），
 * 以及同栏目（同子栏目）的其他课程。
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

  /*
   * 简介按「学科导语 → 选修课介绍 → 小节导语 → 正文第一段」取。
   *
   * 最后一段兜底是 2026-09 加上的：课程页改成「以课程库为准」之后，一门课只有一个
   * 小节、段名就是课程名，**多段合并出来的课（高中物理 / 日语 / 3D建模…）没有单独
   * 可当导语的那半句**（它的小节标题就是课程名本身）—— 少了这一条，这些卡片页
   * 的开头会没有一句说明。`getCourseColumnPageData` 的 `summaryOf` 一直是这么兜的，
   * 两处口径本来就该一致。
   */
  const intro =
    index.subjects.get(card.title)?.lead ||
    index.electives.get(card.title) ||
    stages[0]?.lead ||
    firstParagraph(stages[0]?.body ?? "") ||
    "";

  /*
   * 「课程总览」（页面开头那段课程说明）只在卡片带标签的老结构下才有意义：
   * 那时「雅思」这张卡有个不对应任何标签的自家小节（雅思｜按目标分数提分），
   * 它既不是阶段也不该被丢掉，于是单独渲染成开头的说明。
   *
   * 标签已经全部去掉，那一段现在是**课程正文自己的开头**（段名就是课程名），
   * 因此 `overview` 恒为 null，页面上不会再重复渲染一遍。这条分支保留着：
   * 卡片页组件与类型都还认它，老库（还没重排的内容）也仍然走得通。
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
 * 判据是教师页的「科目」字段：只要教师的某个科目出现在卡片名或它的「阶段名」里，
 * 就认为这位教师可以带这门课（例如 陈老师 的「物理」命中「高中物理」，
 * 「英语」命中「高考外语」那一节的标题「高考英语｜阅读深度与写作高度」）。
 *
 * 「阶段名」在 2026-09 之后由两部分组成：小节锚点（现在就是课程名）**以及正文里的小标题**
 * —— 课程页改成「以课程库为准」之后，原来的级别 / 技能小节（学考 / 选考 / N5 / A1 /
 * 听力 / 高考英语…）不再各占一个锚点，而是降级成正文里的 `### 小标题`。它们在机构眼里
 * 仍然是「这门课有哪些阶段」，因此这里照旧把它们算进匹配范围，教师关联不会因为这次
 * 结构重排而悄悄少掉（否则「德语」这类科目就匹配不到任何课程了）。
 *
 * 刻意不做「猜」：科目对不上就不显示，页面会给出「以咨询确认为准」的说明，
 * 而不是硬塞一位老师上去。
 */
function teachersForCourse(card: CourseColumnCard, stages: CourseStage[]): Teacher[] {
  const haystack = [
    card.title,
    ...stages.map((stage) => stage.anchor),
    ...stages.flatMap((stage) => bodyHeadings(stage.body)),
  ].join(" ");
  return getTeachersPage().teachers.filter(
    (teacher) =>
      teacher.kind === "teacher" &&
      teacher.subjects.some((subject) => subject !== "" && haystack.includes(subject)),
  );
}

/** 正文里的小标题（`### 学考｜合格考基础`）—— 合并进正文后，它们就是这门课的「阶段名」。 */
export function bodyHeadings(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^#{2,4}\s+(.+)$/.exec(line.trim())?.[1]?.trim() ?? "")
    .filter((heading) => heading !== "");
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
  /*
   * 连上后端 → 库里的教师档案（含"是否在网站展示"的过滤）；显式 template → 模版那一份；
   * **没连上（默认）→ 标题用模版、教师列表为空**：教师页的标题（「负责的教师团队」）
   * 是页面骨架，空着会让家长以为这一页坏了（机构反馈过）。
   */
  const snapshot = backendSnapshot();
  if (siteContentSource() === "backend" && snapshot !== null) return backendTeachersPage(snapshot);
  const frame = getTeachersPageFromTemplate();
  if (siteContentSource() === "template") return frame;
  return { heading: frame.heading, teachers: [] };
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
  return aboutFrom(copySourceFor("about"));
}

/** 关于我们（**只认 `CopySource`**）：短字段与分组标题是骨架，分组条目是内容。 */
function aboutFrom(source: CopySource): AboutContent {
  const groupItems = (name: string): LabeledItem[] =>
    source.group(name).items.map((item) => ({ title: item.title, value: item.value }));
  return {
    eyebrow: source.field("eyebrow"),
    title: source.field("title"),
    description: source.field("description"),
    philosophy: {
      eyebrow: "",
      title: source.field("philosophy_title"),
      description: source.field("philosophy_description"),
    },
    serviceTitle: source.field("service_title"),
    services: groupItems("服务形式"),
    campusTitle: source.field("campus_title"),
    principles: groupItems("教学理念"),
    facts: groupItems("校区数据"),
    // 校区介绍：只显示每条的「值」，名称仅用于作者辨识。
    campusParagraphs: source.group("校区介绍").items.map((item) => item.value),
  };
}

// ── 联系我们 ──────────────────────────────────────────────────────────────

export function getContactContent(): ContactContent {
  return contactFrom(copySourceFor("contact"));
}

/** 联系我们（**只认 `CopySource`**）。 */
function contactFrom(source: CopySource): ContactContent {
  return {
    eyebrow: source.field("eyebrow"),
    title: source.field("title"),
    description: source.field("description"),
    methods: source.group("联系方式清单").items.map((item) => ({ title: item.title, value: item.value })),
    routeTitle: source.field("route_title"),
    routeDescription: source.field("route_description"),
    routeParagraph: source.field("route_paragraph"),
    disabledActionLabel: source.field("disabled_action_label"),
  };
}
