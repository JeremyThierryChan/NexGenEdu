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
 *
 * ## 课程与分区（v18 起）
 *
 * 课程**属于一个分区**（`Course.partitionId` → `CoursePartition`），分区才是"名字的所在地"。
 * 于是这个文件里有两个方向的转换，各只有一处：
 *
 *   - **网站 → 库**（`coursesFromSite()`）：内容文件说的是**名字**
 *     （`栏目: 高中课内 · 子栏目: 七选三`），因此返回的 `SiteCourse` 带的是名字；
 *     `materializeSiteCourses()` 负责把名字换成 id，缺的分区顺手建出来。
 *   - **库 → 显示**（`courseOptions()` / `summarizeCourses()`）：拿 id 去分区表里换名字。
 *
 * 为什么不让 `Course` 里也留一份分区名字当缓存：那就又是"同一个事实写两处"，
 * 改名时裂成两个名字正是这一版要修掉的东西（见 `types.ts` 里 `Course.partitionId` 的说明）。
 */

import { getCourseColumnsFromTemplate, getCoursesPageFromTemplate } from "@/lib/data/site";
import { versionOf } from "./concurrency";
import { ensurePartitions, partitionPathLabel } from "./course-partitions";
import { nextId } from "./ids";
import type { Course, CourseOrigin, CoursePartition, CourseTag } from "./types";

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
 * 网站课程页里属于「选修课」的课程名。
 *
 * 选修课与学科课程的区别是**显式的**：学科有自己的学段小节（语文 → 小学/初中/高中语文），
 * 选修课只有一段介绍（成人英语口语、职场与商务英语）。导入时按这份名单定
 * `siteKind`，后台也能随时改。
 */
function siteElectives(): Map<string, string> {
  try {
    const items = new Map<string, string>();
    for (const group of getCoursesPageFromTemplate().electiveGroups) {
      // 值是该选修课的一段介绍（正文首段口径由网站那侧决定，这里原样存）
      for (const item of group.items) items.set(item.name, item.description);
    }
    return items;
  } catch {
    return new Map();
  }
}

/**
 * 网站内容里的**一门课**：分区还是**名字**（`category` / `subgroup`）。
 *
 * 为什么单独一个类型，而不是直接复用 `Course`：网站内容说的是名字
 * （`栏目: 高中课内 · 子栏目: 七选三`），库里存的是分区 id —— 两个世界的词汇不同。
 * 让 `coursesFromSite()` 直接返回带 id 的 `Course`，就必须在这里凭空造 id
 * （每调一次造一批新的，导入/同步/自检各处还会各不相同）。
 * 因此这里如实用名字，由 `materializeSiteCourses()` 一次性换成 id。
 */
export type SiteCourse = Omit<Course, "id" | "version" | "partitionId" | "order"> & {
  /** 栏目名（一级分区）。 */
  category: string;
  /** 子栏目名（二级分区）；空串＝直接挂在栏目上。 */
  subgroup: string;
  /** 在**本栏目本子栏目内**的顺序（内容文件里的出现顺序）。 */
  order: number;
};

/**
 * 把网站内容里的课程卡片转成 `SiteCourse`（分区仍是名字）。
 *
 * id 用卡片的路径（`course-site-<path>`）：**稳定且可重复**，因此
 * 「从网站同步」跑多少次都不会重复添加，也不会因为重新灌种子而变 id。
 * （这一步在 `materializeSiteCourses()` 里做，因为要连分区一起落定。）
 *
 * v15 起连同**卡片在网站上的全部字段**一起带进来（路径 / 子栏目 / 标签 / 顺序 /
 * 一句话介绍）：这些字段原先只存在于内容文件里，网站要"以库为准"就得先在库里。
 */
export function coursesFromSite(): SiteCourse[] {
  try {
    const electives = siteElectives();
    const courses: SiteCourse[] = [];
    for (const column of getCourseColumnsFromTemplate()) {
      for (const subgroup of column.subgroups) {
        subgroup.cards.forEach((card, index) => {
          const tags: CourseTag[] = card.tags.map((tag) => ({ label: tag.label, target: tag.target }));
          courses.push({
            name: card.title,
            category: column.title,
            subgroup: subgroup.title,
            forms: card.forms,
            origin: "网站",
            status: card.unavailable ? "暂未开放" : "开放",
            note: "",
            createdAt: "",
            path: card.path,
            tags,
            target: card.target,
            // 同一栏目同一子栏目内的相对顺序：数组下标就够，重新排序时改这个数字
            order: index + 1,
            /*
             * 选修课的一段介绍写在这里（学科卡片留空 —— 它们的介绍是学科正文）。
             * 这段文字在内容文件里属于课程页的选修分组的正文，而不是卡片行；
             * 但它的归属就是"这门选修课"，因此存到课程行上最省事、也只需要改一处。
             */
            intro: electives.get(card.title) ?? "",
            siteKind: electives.has(card.title) ? "选修" : "学科",
          });
        });
      }
    }
    return courses;
  } catch {
    // 内容被改坏时不要让后台打不开：返回空数组，机构仍可手工加课
    return [];
  }
}

/**
 * 把「名字版」的网站课程落成库里的记录：**补齐分区 + 换成 id**。
 *
 * 这是"网站说名字、库里存 id"这个转换的**唯一实现**，三个入口共用：
 * 空库起步（`initial.ts`）、示例数据（`seed.ts`）、点「从网站同步」（`api.courses.syncFromSite`）。
 * 三处各写一遍的直接后果是"空库里点同步多出一批分区"这种重复。
 *
 * 分区只增不改（见 `ensurePartitions`）：机构已经把某个分区改过名、排过序时，
 * 一次同步不会把这些冲掉 —— 认得出的（上级 + 名字相同）就复用。
 */
export function materializeSiteCourses(
  partitions: readonly CoursePartition[],
  site: readonly SiteCourse[] = coursesFromSite(),
): { partitions: CoursePartition[]; courses: Course[] } {
  const ensured = ensurePartitions(
    partitions,
    site.map((course) => ({ column: course.category, subgroup: course.subgroup })),
    () => nextId("cp"),
  );
  const courses: Course[] = site.map((course) => {
    const { category, subgroup, ...rest } = course;
    return {
      ...rest,
      // 网站同步进来的课程也是一条新记录：从第 1 版开始（乐观锁，见 concurrency.ts）
      version: 1,
      id: `course-site-${course.path}`,
      partitionId: ensured.idOf(category, subgroup),
    };
  });
  return { partitions: ensured.partitions, courses };
}

/**
 * 课程名集合：网站课程在前（保持内容里的顺序），后台新增的接在后面。
 *
 * `category` 给的是**分区名**（拿 id 换来的）：下拉里要按栏目分组显示，
 * 而调用方（学员/教师表单）拿到的必须是人看得懂的名字，不该自己去查分区表。
 */
export function courseOptions(
  stored: Course[],
  partitions: readonly CoursePartition[],
  site: readonly SiteCourse[] = coursesFromSite(),
): CourseOption[] {
  const seen = new Set<string>();
  const options: CourseOption[] = [];
  /** 库里的同一条课程（按名字认）：它的分区与来源才是**当前**的口径。 */
  const inLibrary = new Map<string, Course>();
  for (const course of stored) {
    const name = course.name.trim();
    if (name !== "") inLibrary.set(name, course);
  }

  /*
   * 顺序用网站内容的（保持内容文件里的阅读顺序），但**分区名以库为准**。
   *
   * 为什么必须这样：网站来源的课程在库里也有一条，两边的分区名字来源不同 ——
   * 内容文件说的是栏目名，库里说的是分区 id 换出来的名字。机构在后台把「小学课内」
   * 改成「小学学科」之后，若这里仍输出内容文件里的名字，那门课在下拉里会显示旧名字
   * （分组也跟着旧名字走），看起来像是改名没生效。自检有一条断言盯着这件事。
   */
  for (const course of site) {
    const name = course.name.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    const current = inLibrary.get(name);
    options.push({
      name,
      category: current === undefined ? course.category : partitionPathLabel(partitions, current.partitionId),
      origin: current?.origin ?? course.origin,
    });
  }
  for (const course of stored) {
    const name = course.name.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    options.push({ name, category: partitionPathLabel(partitions, course.partitionId), origin: course.origin });
  }
  return options;
}

/**
 * 校验一门课程（新建与改名都要过）。
 *
 * 课程名是**引用键**：排课、教师可带科目、报课记录都按名字记，
 * 因此重名必须拦住 —— 否则「数学」有两门课时，课时到底扣到哪一门就说不清了。
 *
 * `partitionId` 只校验"填了就必须存在"：空串是允许的（＝未归类，后台先建课、之后再分区），
 * 但指向一条不存在的分区必须拒绝 —— 那正是"删掉一个有课的分区"会造成的错位，
 * 而现在删除已被护栏挡住，这条校验是第二道闸门（防的是恢复半份备份这类路径）。
 */
export function validateCourse(
  input: { name: string; partitionId: string },
  existing: Course[],
  partitions: readonly CoursePartition[],
  editingId = "",
): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (name === "") problems.push("课程名不能为空。");
  if (input.partitionId !== "" && !partitions.some((item) => item.id === input.partitionId)) {
    problems.push("选择的分区不存在（可能刚被删掉了）：请刷新页面重新选择，或先建一个分区。");
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
  site: Course[],
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

/**
 * 课程库统计。
 *
 * `byCategory` 按**分区**统计（名字取自分区表），并遵循两条显示口径：
 *   - 分区顺序 = 分区自己的 `order`（不是"哪一区先有课谁在前"）；
 *   - 未归类的课程单独列在最后，名字用 `describeUnpartitioned` ——
 *     它会把"还没选分区"与"分区引用已失效"分成两句，后者是数据错位，要让人看见。
 */
export function summarizeCourses(
  courses: Course[],
  partitions: readonly CoursePartition[],
): CourseSummary {
  const counts = new Map<string, number>();
  let unpartitioned = 0;
  for (const course of courses) {
    const id = course.partitionId.trim();
    if (id === "" || !partitions.some((item) => item.id === id)) {
      unpartitioned += 1;
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const ordered = [...partitions].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh"));
  const byCategory = ordered
    .filter((item) => (counts.get(item.id) ?? 0) > 0)
    .map((item) => ({ category: partitionPathLabel(partitions, item.id), count: counts.get(item.id) ?? 0 }));
  if (unpartitioned > 0) byCategory.push({ category: "未归类", count: unpartitioned });

  return {
    total: courses.length,
    open: courses.filter((course) => course.status === "开放").length,
    unavailable: courses.filter((course) => course.status !== "开放").length,
    fromSite: courses.filter((course) => course.origin === "网站").length,
    fromAdmin: courses.filter((course) => course.origin === "后台").length,
    byCategory,
  };
}

/**
 * 给课程补上 v15 的网站卡片字段的默认值。
 *
 * 为什么要在服务端兜：调用方不止一个 —— 后台表单、批量导入、脚本、自检。
 * 少一个字段（老调用方不会传）就会让网站那侧读到 `undefined`，
 * 表现是「卡片点不动 / 排序乱掉」这类难查的问题。默认值集中在这一处：
 *   - `path` 空串 = 网站上不展示这张卡片；
 *   - `siteKind` 记「不展示」= 只用于排课/记课时；
 *   - `order` 999 = 排在最后（比 0 更安全：0 会排到最前面，抢掉别人定的顺序）。
 *
 * v17 起顺带兜 `version`：**它必须在这里兜住**，因为 `{...target, ...patch}` 这种写法
 * 会让"没带版本的入参"把记录上的版本号覆盖成 `undefined` —— 那就等于把这一条记录的
 * 乐观锁悄悄关掉了（比较变成 `undefined !== 5`，每次保存都报假冲突）。
 * 用 `versionOf` 归一（缺失/非法一律当 1），口径与迁移、与集合的 update 完全一致。
 */
export function normalizeCourse(input: Omit<Course, "id" | "version"> | Course): Course {
  const course = input as Course;
  return {
    ...course,
    version: versionOf(course),
    path: typeof course.path === "string" ? course.path.trim() : "",
    partitionId: typeof course.partitionId === "string" ? course.partitionId : "",
    tags: Array.isArray(course.tags)
      ? course.tags.map((tag) => ({ label: String(tag.label ?? ""), target: String(tag.target ?? "") }))
      : [],
    target: typeof course.target === "string" ? course.target.trim() : "",
    order: Number.isFinite(Number(course.order)) ? Number(course.order) : 999,
    intro: typeof course.intro === "string" ? course.intro : "",
    siteKind:
      course.siteKind === "学科" || course.siteKind === "选修" ? course.siteKind : "不展示",
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
