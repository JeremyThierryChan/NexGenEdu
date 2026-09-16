import {
  getGroup,
  getPageBlock,
  pageArray,
  pageString,
  type Group,
  type PageBlock,
} from "@/lib/data/content";
import type {
  AboutContent,
  ContactContent,
  Course,
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
    courses: getGroup(page, "首页课程卡片").items,
    classrooms: getGroup(page, "教室照片格位").items,
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

export function getCoursesPage(): {
  heading: SectionHeading;
  courses: Course[];
} {
  const page = getPageBlock("课程");

  // 课程页的每个 `### 课程名` 分组就是一门课程。
  // 分组内的 `#### 学段｜一句话` 是该课程的学段小节（解析器已放进 children），
  // 分组 body 则是学段小节之前的导语。
  const courses = page.groups.map<Course>((group) => ({
    id: group.name,
    nameZh: group.name,
    lead: group.body.trim(),
    bands: group.children.map((child) => ({
      // Group 的字段名是 name；这里转成对外的 title
      title: child.name,
      content: child.body.trim(),
    })),
  }));

  return { heading: pageHeading(page), courses };
}

// ── 教师页 ────────────────────────────────────────────────────────────────

export function getTeachersPage(): {
  heading: SectionHeading;
  teachers: Teacher[];
} {
  const page = getPageBlock("教师");

  // 带有「科目」或「简介」条目的分组才算教师，其余分段自动排除。
  const teachers = page.groups
    .filter(
      (group) => fieldFrom(group, "科目") !== "" || fieldFrom(group, "简介") !== "",
    )
    .map<Teacher>((group) => ({
      id: group.name,
      name: group.name,
      role: fieldFrom(group, "职务"),
      subjects: splitList(fieldFrom(group, "科目")),
      years: fieldFrom(group, "教龄"),
      summary: fieldFrom(group, "简介"),
      bio: teacherBio(group),
    }));

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
