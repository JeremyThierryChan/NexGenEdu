import { readFileSync } from "node:fs";
import path from "node:path";
import { itemsIn, parseSections, type Section } from "@/lib/data/sections";
import { parseMarkdown, readArray, readString } from "@/lib/markdown";
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
 * 内容组织：每个可自定义部分对应 data/site 下一个完整的 .md 文件。
 *   site.md      全站品牌与联系方式
 *   home.md     首页全部内容
 *   courses.md  课程页全部内容
 *   teachers.md 教师页全部内容（含教师名单）
 *   about.md    关于我们全部内容
 *   contact.md  联系我们全部内容
 *
 * 页面只能调用本文件的函数，不得直接读文件或解析 Markdown。
 * 未来接入 PostgreSQL / API 时替换本文件实现即可，页面调用方式不变。
 *
 * 说明：这里使用同步读取（readFileSync）。数据量极小（6 个 Markdown 文件），
 * 且全部在构建期一次性读取，同步写法能让调用方（页面组件）保持简单。
 */

const DATA_ROOT = path.join(process.cwd(), "data", "site");

type Frontmatter = Record<string, string | string[]>;

/** 同步读取并解析一个数据文件。文件缺失时抛出明确错误，避免静默渲染空页面。 */
function loadFile(fileName: string): { data: Frontmatter; sections: Section[] } {
  const filePath = path.join(DATA_ROOT, fileName);
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`读取数据文件失败：data/site/${fileName}。请确认文件存在。`);
  }
  const { data, body } = parseMarkdown(source);
  return { data, sections: parseSections(body) };
}

/** 占位标记：显式写 placeholder: false 才认为内容已替换为真实内容。 */
function isPlaceholder(data: Frontmatter): boolean {
  return readString(data, "placeholder", "true") !== "false";
}

/** 取「## 名称 | 值」条目。 */
function items(sections: Section[], title: string): Array<{ title: string; value: string }> {
  return itemsIn(sections, title);
}

/** 组成区块标题。 */
function heading(data: Frontmatter, prefix: string): SectionHeading {
  return {
    eyebrow: readString(data, `${prefix}_eyebrow`),
    title: readString(data, `${prefix}_title`),
    description: readString(data, `${prefix}_description`),
  };
}

/**
 * 从教师小节的 `### 科目: 数学, 物理` 形式子条目中取值。
 * 字段写在 `### ` 子标题里，因此直接查子条目，不解析正文。
 */
function fieldFrom(section: Section, label: string): string {
  return section.children.find((child) => child.title === label)?.value ?? "";
}

/** 把「数学, 物理」拆分为数组，支持中英文逗号与顿号。 */
function splitList(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/**
 * 文档性小节（格式说明、待确认清单）不属于内容数据。
 * 用固定前缀识别并排除，避免它们被渲染成课程或教师。
 */
const DOC_SECTION_PREFIXES = ["待你确认", "待确认", "备注", "格式说明"];

function isDocSection(title: string): boolean {
  return DOC_SECTION_PREFIXES.some((prefix) => title.startsWith(prefix));
}

// ── 全站品牌 ──────────────────────────────────────────────────────────────

export function getSiteBrand(): SiteBrand {
  const { data } = loadFile("site.md");
  const placeholder = isPlaceholder(data);
  return {
    brandName: readString(data, "brand_name"),
    brandNameZh: readString(data, "brand_name_zh"),
    tagline: readString(data, "tagline"),
    description: readString(data, "description"),
    copyrightHolder: readString(data, "copyright_holder"),
    keywords: readArray(data, "keywords"),
    homeTitle: readString(data, "home_title"),
    titleSuffix: readString(data, "title_suffix"),
    contact: {
      phone: readString(data, "phone"),
      wechat: readString(data, "wechat"),
      email: readString(data, "email"),
      address: readString(data, "address"),
      businessHours: readString(data, "business_hours"),
      placeholder,
    },
    placeholder,
  };
}

// ── 首页 ──────────────────────────────────────────────────────────────────

export function getHomeContent(): HomeContent {
  const { data, sections } = loadFile("home.md");
  return {
    eyebrow: readString(data, "eyebrow"),
    title: readString(data, "title"),
    subtitle: readString(data, "subtitle"),
    primaryCta: {
      label: readString(data, "primary_cta_label"),
      href: readString(data, "primary_cta_href", "/courses"),
    },
    secondaryCta: {
      label: readString(data, "secondary_cta_label"),
      href: readString(data, "secondary_cta_href", "/contact"),
    },
    stats: items(sections, "首屏数据"),
    features: items(sections, "教学特色"),
    courses: items(sections, "首页课程卡片"),
    classrooms: items(sections, "教室照片格位"),
    cta: {
      title: readString(data, "cta_title"),
      description: readString(data, "cta_description"),
      label: readString(data, "cta_label"),
      href: readString(data, "cta_href", "/contact"),
    },
    placeholder: isPlaceholder(data),
  };
}

/** 首页各区块的标题（教学特色 / 课程 / 教师 / 教室）。 */
export function getHomeSectionHeadings(): {
  features: SectionHeading;
  courses: SectionHeading;
  teachers: SectionHeading;
  classrooms: SectionHeading;
  coursesLink: { label: string; href: string };
  teachersLink: { label: string; href: string };
} {
  const { data } = loadFile("home.md");
  return {
    features: heading(data, "features"),
    courses: heading(data, "courses"),
    teachers: heading(data, "teachers"),
    classrooms: heading(data, "classrooms"),
    coursesLink: {
      label: readString(data, "courses_link_label"),
      href: readString(data, "courses_link_href", "/courses"),
    },
    teachersLink: {
      label: readString(data, "teachers_link_label"),
      href: readString(data, "teachers_link_href", "/teachers"),
    },
  };
}

// ── 课程页 ────────────────────────────────────────────────────────────────

export function getCoursesPage(): {
  heading: SectionHeading;
  courses: Course[];
  placeholder: boolean;
} {
  const { data, sections } = loadFile("courses.md");
  const courses = sections
    .filter((section) => !isDocSection(section.title))
    .map<Course>((section) => ({
      // 以课程名作为稳定 id：课程名唯一，且未来接入数据库时可保留 slug 字段。
      id: section.title,
      nameZh: section.title,
      content: section.body,
      placeholder: isPlaceholder(data),
    }));

  return {
    heading: {
      eyebrow: readString(data, "eyebrow"),
      title: readString(data, "title"),
      description: readString(data, "description"),
    },
    courses,
    placeholder: isPlaceholder(data),
  };
}

// ── 教师页 ────────────────────────────────────────────────────────────────

/**
 * 取教师的自由介绍。
 *
 * 介绍文字写在所有 `### 字段` 之后，因此会被并进最后一个字段的正文里。
 * 这里把小节正文与「最后一个字段的正文」拼起来作为介绍，
 * 这样无论字段如何增减、介绍写在哪一段之后都能正确取到。
 */
function teacherBio(section: Section): string {
  const lastChild = section.children.at(-1);
  return [section.body, lastChild?.body ?? ""]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

function toTeacher(section: Section, placeholder: boolean): Teacher {
  return {
    id: section.title,
    name: section.title,
    role: fieldFrom(section, "职务"),
    subjects: splitList(fieldFrom(section, "科目")),
    years: fieldFrom(section, "教龄"),
    summary: fieldFrom(section, "简介"),
    bio: teacherBio(section),
    placeholder,
  };
}

export function getTeachersPage(): {
  heading: SectionHeading;
  teachers: Teacher[];
  placeholder: boolean;
} {
  const { data, sections } = loadFile("teachers.md");
  const placeholder = isPlaceholder(data);

  // 只把带有教师字段的小节视为教师，格式说明等段落会自动被排除。
  const teachers = sections
    .filter((section) => !isDocSection(section.title))
    .filter((section) => fieldFrom(section, "科目") !== "" || fieldFrom(section, "简介") !== "")
    .map((section) => toTeacher(section, placeholder));

  return {
    heading: {
      eyebrow: readString(data, "eyebrow"),
      title: readString(data, "title"),
      description: readString(data, "description"),
    },
    teachers,
    placeholder,
  };
}

export function getTeacherById(id: string): Teacher | null {
  const { teachers } = getTeachersPage();
  return teachers.find((teacher) => teacher.id === id) ?? null;
}

// ── 关于我们 ──────────────────────────────────────────────────────────────

export function getAboutContent(): AboutContent {
  const { data, sections } = loadFile("about.md");

  return {
    eyebrow: readString(data, "eyebrow"),
    title: readString(data, "title"),
    description: readString(data, "description"),
    philosophy: {
      eyebrow: "",
      title: readString(data, "philosophy_title"),
      description: readString(data, "philosophy_description"),
    },
    campusTitle: readString(data, "campus_title"),
    principles: items(sections, "教学理念"),
    facts: items(sections, "校区数据"),
    // 校区介绍：取每条的「值」，名称只用于作者辨识。
    campusParagraphs: items(sections, "校区介绍").map((item) => item.value),
    placeholder: isPlaceholder(data),
  };
}

// ── 联系我们 ──────────────────────────────────────────────────────────────

export function getContactContent(): ContactContent {
  const { data, sections } = loadFile("contact.md");
  return {
    eyebrow: readString(data, "eyebrow"),
    title: readString(data, "title"),
    description: readString(data, "description"),
    methods: items(sections, "联系方式清单"),
    routeTitle: readString(data, "route_title"),
    routeDescription: readString(data, "route_description"),
    routeParagraph: readString(data, "route_paragraph"),
    disabledActionLabel: readString(data, "disabled_action_label"),
    placeholder: isPlaceholder(data),
  };
}
