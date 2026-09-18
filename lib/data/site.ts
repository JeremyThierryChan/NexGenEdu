import {
  getGroup,
  getPageBlock,
  pageArray,
  pageString,
  type Group,
  type PageBlock,
  type Section,
} from "@/lib/data/content";
import type {
  AboutContent,
  ElectiveCourse,
  ContactContent,
  Course,
  CourseColumn,
  CourseColumnCard,
  CourseTag,
  HomeContent,
  SectionHeading,
  SiteBrand,
  Teacher,
} from "@/lib/types/site";

/**
 * 数据访问层：页面获取内容的唯一入口。
 *
 * 全部内容都来自单文件 data/site/content.md，按页面分段（见 lib/data/content.ts）。
 * 页面只能调用本文件的函数，不得直接读文件或解析 Markdown。
 * 未来接入 PostgreSQL / API 时替换本文件实现即可，页面调用方式不变。
 */

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
    },
  };
}

// ── 课程栏目（首页与课程页共用） ──────────────────────────────────────────

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
  const page = getPageBlock("全站");
  const columns: CourseColumn[] = [];

  for (const item of getGroup(page, "课程栏目").items) {
    // 先摘出「子栏目」再摘「栏目」：否则 /栏目:/ 会命中「子栏目:」里的同名片段
    const subgroupRaw = /子栏目\s*[:：]\s*([^·]+)/.exec(item.value)?.[1]?.trim() ?? "";
    const rest = item.value.replace(/子栏目\s*[:：][^·]*/, "");
    const columnTitle = /栏目\s*[:：]\s*([^·]+)/.exec(rest)?.[1]?.trim() ?? "";
    if (columnTitle === "") continue;

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
      tags,
      // 有标签时卡片本身指向第一个标签；无标签时指向与卡片同名的小节
      target: tags[0]?.target ?? title,
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
    // 课程栏目定义在「全站」段，首页与课程页共用，避免两处结构走偏
    courseColumns: getCourseColumns(),
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

export function getTeacherById(id: string): Teacher | null {
  return getTeachersPage().teachers.find((teacher) => teacher.id === id) ?? null;
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
