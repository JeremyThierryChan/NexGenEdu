/**
 * **把网站内容搬进数据库**（教师资料 / 课程卡片 / 课程正文 / 报价文案）。
 *
 * ## 为什么需要它
 *
 * 网站要改成"能连上后端就以后端为准"，前提是后端**先有那份内容**。
 * 老库升级上来时：教师没有推荐理由与顺序、课程行没有卡片字段、`siteContent` 是空的 ——
 * 网站那侧会判定"后端没有内容"而回落到模版。这个模块负责把它们补齐。
 *
 * ## 两条纪律
 *
 * 1. **体检（`write: false`）绝不改数据**：它在一份**深拷贝**上算出"会改什么"，
 *    因此"只算不写"是结构性的，不是"记得别写"。逐条改动也会返回给人看，
 *    免得"点一下按钮，数据悄悄变了一片"。
 * 2. **默认只补空、不覆盖**：库里已经有的内容（尤其是机构在后台改过的）不动；
 *    确实要用内容文件整体替换时才传 `overwrite`。两种语义都要有，否则
 *    "再导一次"要么永远补不上、要么把后台的修改冲光。
 *
 * ## 与 `imports.fromSite` 的分工
 *
 * `imports.fromSite` 是**逐行**导入（教师 / 教室的名字清单，走 CSV 那套判重与冲突策略）。
 * 本模块处理的是**结构化内容**（课程正文这种"一块一块"的数据）与**已有行的补字段**，
 * 两者形状不同，硬并成一个接口会让"冲突时选覆盖还是跳过"这种选项失去意义。
 */

import { coursesFromSite } from "./courses";
import { getTeachersPage } from "@/lib/data/site";
import { siteContentFromContent } from "./site-content";
import type { Course, CourseTag, Database, SiteBand, SiteSubject, Teacher } from "./types";

/** 网站内容里的教师资料（含 AI），按网站上的顺序。 */
export function siteTeachers(): Array<{
  name: string;
  role: string;
  subjects: string[];
  years: string;
  summary: string;
  bio: string;
  recommendation: string;
  order: number;
  kind: Teacher["kind"];
}> {
  try {
    return getTeachersPage()
      .teachers.map((teacher, index) => ({
        name: teacher.name,
        role: teacher.role,
        subjects: teacher.subjects,
        years: teacher.years ?? "",
        summary: teacher.summary ?? "",
        bio: teacher.bio ?? "",
        recommendation: teacher.recommendation ?? "",
        order: index + 1,
        kind: teacher.kind === "ai" ? ("AI" as const) : ("教师" as const),
      }));
  } catch {
    return [];
  }
}

/** 导入结果（体检与写入都会返回它；`written` 区分这两种情况）。 */
export type SiteContentImportReport = {
  /** 是否真的写入了。`false` 表示这是体检结果，库里一个字都没变。 */
  written: boolean;
  /** 逐条人话：「补了什么 / 新增了什么 / 跳过了什么」。 */
  changes: string[];
  counts: {
    teachersAdded: number;
    teachersFilled: number;
    coursesAdded: number;
    coursesFilled: number;
    subjectsWritten: number;
    bandsWritten: number;
    labelsFilled: number;
  };
};

/** 深拷贝（体检要在副本上算，不能碰真数据）。 */
function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 库里一条课程是不是"网站上的那张卡片"（按 id 或名字认）。 */
function findCourse(courses: Course[], site: Course): Course | undefined {
  return (
    courses.find((course) => course.id === site.id) ??
    courses.find((course) => course.name.trim() === site.name.trim())
  );
}

const SAME_TAGS = (a: CourseTag[], b: CourseTag[]) =>
  a.length === b.length && a.every((tag, index) => tag.label === b[index]?.label && tag.target === b[index]?.target);

/**
 * 把网站内容补进数据库。
 *
 * 传入 `write: false` 时只做体检：所有计算都发生在深拷贝上，真库一个字都不会变。
 */
export function importSiteContent(
  db: Database,
  options: { write: boolean; overwrite?: boolean },
): SiteContentImportReport {
  const overwrite = options.overwrite === true;
  const working: Database = options.write ? db : deepCopy(db);
  const changes: string[] = [];
  const counts = {
    teachersAdded: 0,
    teachersFilled: 0,
    coursesAdded: 0,
    coursesFilled: 0,
    subjectsWritten: 0,
    bandsWritten: 0,
    labelsFilled: 0,
  };

  /* ── 教师：没有就新增；有就补空字段（推荐理由 / 顺序 / 资料）── */
  for (const site of siteTeachers()) {
    const existing = working.teachers.find((teacher) => teacher.name.trim() === site.name.trim());
    if (existing === undefined) {
      working.teachers.push({
        id: `t_site_${working.teachers.length + 1}_${Date.now().toString(36)}`,
        name: site.name,
        subjects: site.subjects,
        role: site.role,
        phone: "",
        active: true,
        years: site.years,
        summary: site.summary,
        bio: site.bio,
        recommendation: site.recommendation,
        order: site.order,
        origin: "网站",
        kind: site.kind,
      });
      counts.teachersAdded += 1;
      changes.push(`新增教师「${site.name}」（网站上是第 ${site.order} 位）`);
      continue;
    }

    /*
     * 已有教师：**为空就补**；`overwrite` 时连机构改过的也按网站内容写回。
     *
     * 两种模式都要有：只补空是默认（不会冲掉机构的心血），覆盖是明确动作
     * （"内容文件是这份资料的出处，按它来"）。但**网站那边是空值就不动** ——
     * 否则一次覆盖会把机构填好的教龄、简介用空字符串抹掉。
     */
    const filled: string[] = [];
    if (site.years !== "" && (existing.years === "" || (overwrite && existing.years !== site.years))) {
      existing.years = site.years;
      filled.push("教龄");
    }
    if (site.summary !== "" && (existing.summary === "" || (overwrite && existing.summary !== site.summary))) {
      existing.summary = site.summary;
      filled.push("简介");
    }
    if (site.bio !== "" && (existing.bio === "" || (overwrite && existing.bio !== site.bio))) {
      existing.bio = site.bio;
      filled.push("详细介绍");
    }
    if (
      site.recommendation !== "" &&
      (existing.recommendation === "" || (overwrite && existing.recommendation !== site.recommendation))
    ) {
      existing.recommendation = site.recommendation;
      filled.push("推荐理由");
    }
    // 顺序：999 是"没排过"的默认值；覆盖模式下按网站的次序重排
    if (existing.order === 999 || (overwrite && existing.order !== site.order)) {
      existing.order = site.order;
      filled.push("顺序");
    }

    if (filled.length > 0) {
      counts.teachersFilled += 1;
      changes.push(`教师「${site.name}」${overwrite ? "按网站内容更新" : "补上"} ${filled.join(" / ")}`);
    }
  }

  /* ── 课程卡片：补网站字段（路径 / 子栏目 / 标签 / 顺序 / 形态），没有就新增 ── */
  for (const site of coursesFromSite()) {
    const existing = findCourse(working.courses, site);
    if (existing === undefined) {
      working.courses.push({ ...site });
      counts.coursesAdded += 1;
      changes.push(`新增课程卡片「${site.name}」（${site.category}）`);
      continue;
    }

    const filled: string[] = [];
    // 卡片字段属于"内容文件那一侧"，因此在**为空**时补、`overwrite` 时覆盖
    if (existing.path === "" || overwrite) { if (existing.path !== site.path) { existing.path = site.path; filled.push("路径"); } }
    if (existing.subgroup === "" || overwrite) { if (existing.subgroup !== site.subgroup) { existing.subgroup = site.subgroup; filled.push("子栏目"); } }
    if (existing.tags.length === 0 || overwrite) { if (!SAME_TAGS(existing.tags, site.tags)) { existing.tags = site.tags; filled.push("标签"); } }
    if (existing.target === "" || overwrite) { if (existing.target !== site.target) { existing.target = site.target; filled.push("点进哪一节"); } }
    if (existing.order === 999 || overwrite) { if (existing.order !== site.order) { existing.order = site.order; filled.push("顺序"); } }
    // 形态只有"不展示"才会被补：机构明确设成「学科/选修」的不动
    if (existing.siteKind === "不展示" || overwrite) {
      if (existing.siteKind !== site.siteKind) { existing.siteKind = site.siteKind; filled.push("网站形态"); }
    }

    if (filled.length > 0) {
      counts.coursesFilled += 1;
      changes.push(`课程「${site.name}」补上 ${filled.join(" / ")}`);
    }
  }

  /* ── 课程正文：库里没有就写入；已有则只在 `overwrite` 时替换 ── */
  const incoming = siteContentFromContent();
  const incomingBands = incoming.coursePage.subjects.reduce((sum, item) => sum + item.bands.length, 0);
  const hasLocal = working.siteContent.coursePage.subjects.some((item) => item.bands.length > 0);

  if (incoming.coursePage.subjects.length === 0) {
    changes.push("网站内容里没有课程正文：跳过（内容文件可能被改坏了）");
  } else if (!hasLocal || overwrite) {
    working.siteContent.coursePage = {
      heading: incoming.coursePage.heading,
      subjects: incoming.coursePage.subjects.map((subject: SiteSubject) => ({
        ...subject,
        bands: subject.bands.map((band: SiteBand) => ({ ...band })),
      })),
      electiveTitle: incoming.coursePage.electiveTitle,
    };
    counts.subjectsWritten = incoming.coursePage.subjects.length;
    counts.bandsWritten = incomingBands;
    changes.push(
      hasLocal
        ? `覆盖课程正文：${incoming.coursePage.subjects.length} 个学科、${incomingBands} 个小节`
        : `写入课程正文：${incoming.coursePage.subjects.length} 个学科、${incomingBands} 个小节`,
    );
  } else {
    changes.push(
      `库里已有课程正文（${working.siteContent.coursePage.subjects.length} 个学科）：未覆盖（要覆盖请勾选「用网站内容覆盖」）`,
    );
  }

  /* ── 报价页文案：同样补空 ── */
  const labelKeys = Object.keys(incoming.pricingPage.labels) as Array<keyof typeof incoming.pricingPage.labels>;
  const emptyLabels = labelKeys.filter((key) => working.siteContent.pricingPage.labels[key] === "");
  if (emptyLabels.length === labelKeys.length && labelKeys.length > 0 && overwrite) {
    working.siteContent.pricingPage.labels = { ...incoming.pricingPage.labels };
    counts.labelsFilled = labelKeys.length;
    changes.push("写入报价页文案（全部 16 项）");
  } else if (emptyLabels.length > 0) {
    for (const key of emptyLabels) working.siteContent.pricingPage.labels[key] = incoming.pricingPage.labels[key];
    counts.labelsFilled = emptyLabels.length;
    changes.push(`报价页文案补上 ${emptyLabels.length} 项空白`);
  }

  if (options.write) working.updatedAt = new Date().toISOString();

  return { written: options.write, changes, counts };
}
