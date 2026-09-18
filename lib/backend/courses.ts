/**
 * 课程库：后台自己的课程台账。
 *
 * ## 为什么要有这个
 *
 * 科目候选原先**只来自网站内容**（课程页的卡片）。于是机构想排一门网站上还没有的课
 * ——围棋、书法、编程——就没得选，只能手打进文本框，名字一旦打歪（多了个空格、
 * 写成「围棋课」和「围棋」两种），统计、教师科目、报课记录就对不上了。
 *
 * 现在课程是**数据**：网站上的课程在首次访问时自动进来（`origin: "网站"`），
 * 机构自己加的课（`origin: "后台"`）与它们平起平坐 —— 都能排课、能记课时、
 * 能挂到教师名下。
 *
 * ## 边界（必须说清楚，否则会以为「加了课网站就有了」）
 *
 * 在后台加课程**不会**让宣传网站上多出一张卡片：网站是静态内容，上线要改
 * `data/site/content.md` 的课程栏目（见内容维护手册）。后台课程库解决的是
 * 「这门课要能排课、能记课时」，不是「这门课要在网站上展示」。
 *
 * 反向也成立：在内容文件里新增了课程卡片之后，到 `/admin/courses` 点一次
 * 「从网站同步」把它拉进课程库（`mergeSiteCourses`），否则它不会出现在科目候选里。
 */

import { getCourseColumns } from "@/lib/data/site";
import type { Course, CourseOrigin } from "./types";

/** 下拉里的一项。 */
export type CourseOption = {
  name: string;
  category: string;
  origin: CourseOrigin;
};

/** 课程库统计（列表页顶部用）。 */
export type CourseSummary = {
  total: number;
  open: number;
  unavailable: number;
  fromSite: number;
  fromAdmin: number;
  byCategory: Array<{ category: string; count: number }>;
};

/**
 * 把网站内容里的课程卡片转成课程库记录。
 *
 * id 用卡片的路径（`course-site-<path>`）：**稳定且可重复**，因此
 * 「从网站同步」跑多少次都不会重复添加，也不会因为重新灌种子而变 id。
 */
export function coursesFromSite(): Course[] {
  try {
    return getCourseColumns().flatMap((column) =>
      column.subgroups.flatMap((subgroup) =>
        subgroup.cards.map((card) => ({
          id: `course-site-${card.path}`,
          name: card.title,
          category: column.title,
          forms: card.forms,
          origin: "网站" as const,
          status: card.unavailable ? ("暂未开放" as const) : ("开放" as const),
          note: "",
          createdAt: "",
        })),
      ),
    );
  } catch {
    // 内容被改坏时不要让后台打不开：返回空数组，机构仍可手工加课
    return [];
  }
}

/** 课程名集合：网站课程在前（保持内容里的顺序），后台新增的接在后面。 */
export function courseOptions(stored: Course[], site: Course[] = coursesFromSite()): CourseOption[] {
  const seen = new Set<string>();
  const options: CourseOption[] = [];
  for (const course of [...site, ...stored]) {
    const name = course.name.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    options.push({ name, category: course.category, origin: course.origin });
  }
  return options;
}

/**
 * 校验一门课程（新建与改名都要过）。
 *
 * 课程名是**引用键**：排课、教师可带科目、报课记录都按名字记，
 * 因此重名必须拦住 —— 否则「数学」有两门课时，课时到底扣到哪一门就说不清了。
 */
export function validateCourse(
  input: { name: string; category: string },
  existing: Course[],
  editingId = "",
): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (name === "") problems.push("课程名不能为空。");
  if (input.category.trim() === "") {
    problems.push("分类不能为空（可以填网站栏目名，也可以自己写，例如「兴趣才艺」）。");
  }
  const duplicated = existing.some(
    (course) => course.id !== editingId && course.name.trim() === name && name !== "",
  );
  if (duplicated) {
    problems.push(`课程库里已经有「${name}」了：课程名不能重复（排课与教师科目都按名字引用它）。`);
  }
  return problems;
}

/**
 * 从网站同步：把内容里新增、课程库里还没有的课程卡片补进来。
 *
 * 只增不改：已存在的课程由机构在后台维护（改了状态、班型、备注都算机构的信息），
 * 同步不覆盖它们 —— 否则机构在后台改的东西会被一次同步冲掉。
 */
export function mergeSiteCourses(
  stored: Course[],
  site: Course[] = coursesFromSite(),
): { courses: Course[]; added: string[] } {
  const existingNames = new Set(stored.map((course) => course.name.trim()));
  const added: Course[] = [];
  for (const course of site) {
    if (existingNames.has(course.name.trim())) continue;
    existingNames.add(course.name.trim());
    added.push(course);
  }
  return { courses: [...stored, ...added], added: added.map((course) => course.name) };
}

/** 课程库统计。 */
export function summarizeCourses(courses: Course[]): CourseSummary {
  const byCategory = new Map<string, number>();
  for (const course of courses) {
    const category = course.category.trim() === "" ? "未分类" : course.category.trim();
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  return {
    total: courses.length,
    open: courses.filter((course) => course.status === "开放").length,
    unavailable: courses.filter((course) => course.status !== "开放").length,
    fromSite: courses.filter((course) => course.origin === "网站").length,
    fromAdmin: courses.filter((course) => course.origin === "后台").length,
    byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
  };
}

/**
 * 这门课能不能删。
 *
 * 网站来源的课程不让删：删了它，网站上那张卡片还在，下次「从网站同步」又会把它拉回来
 * ——与其让机构以为删掉了、过几天又冒出来，不如直接说清楚「它跟着网站走」。
 * 不想再排这门课就把它改成「暂未开放」。
 */
export function canRemoveCourse(course: Course): { ok: boolean; reason: string } {
  if (course.origin === "网站") {
    return {
      ok: false,
      reason: "这是网站上的课程，跟着内容文件走。不想再排它请改成「暂未开放」（删了下次同步还会回来）。",
    };
  }
  return { ok: true, reason: "" };
}
