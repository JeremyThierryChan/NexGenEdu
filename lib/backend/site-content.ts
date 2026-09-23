/**
 * 网站内容的**入库/出库**（课程页正文）。
 *
 * ## 为什么需要这个模块
 *
 * 宣传网站的课程正文原先只存在于 `data/site/content.md`：后台看不见、改不了，
 * 于是「网站以后端为准」这件事无从谈起。v15 起这些正文进了数据库
 * （`db.siteContent.coursePage`），本模块负责两件事：
 *
 *   1. `siteContentFromContent()` —— 内容文件 → 库里的结构（首次初始化、导入用）；
 *   2. 反向导出由 `siteContentToContent()` 提供（`npm run site:snapshot` 用），
 *      两个方向共用同一份字段映射，避免"导进去一套、导出来另一套"。
 *
 * ## 与 `courses` 表的分工
 *
 * 卡片（小学语文、雅思…）在 `courses` 表里；本模块只管**学科正文**
 * （语文 → 小学语文 / 初中语文 / 高中语文 那些段落）与选修课父分组名。
 * 一个学科是正文容器，一张卡片是入口，两者粒度不同 —— 硬合成一张表，
 * 导语与小节就要在每行里重复一份。
 */

import { getCoursesPageFromTemplate, getTeachersPageFromTemplate } from "@/lib/data/site";
import { getPricingData } from "@/lib/data/pricing";
import { coursesReferencingAnchor } from "./site-bands";
import type {
  Course,
  SiteContent,
  SiteCoursePage,
  SitePricingLabels,
  SiteSubject,
} from "./types";

/** 小节标题里「｜」之前的部分就是锚点名（与网站渲染的口径一致）。 */
function bandAnchor(title: string): string {
  return (title.split("｜")[0] ?? title).trim();
}

/**
 * 从网站内容读出课程页正文。
 *
 * 取不到内容（文件被改坏）时返回**空结构**而不是抛错：空库/后台不该因为
 * 网站文件坏掉就打不开；网站那侧看到「后端没有课程正文」会回落到模版（见 `lib/site/content-source.ts`）。
 */
export function siteContentFromContent(): SiteContent {
  let coursePage: SiteCoursePage = {
    heading: { eyebrow: "", title: "", description: "" },
    subjects: [],
    electiveTitle: "",
  };
  let labels: SitePricingLabels = emptyPricingLabels();
  let teacherHeading = { eyebrow: "", title: "", description: "" };
  try {
    labels = getPricingData().labels;
  } catch {
    // 报价内容坏了就留空：价格数字仍在 pricing 配置里，页面不会因此算不出价
  }

  try {
    const page = getCoursesPageFromTemplate();
    const subjects: SiteSubject[] = page.courses.map((course, index) => ({
      // id 用学科名：与网站侧的 `Course.id`（= 分组名）同一口径，重新导入也不会漂
      id: course.nameZh,
      name: course.nameZh,
      lead: course.lead,
      unavailable: course.unavailable,
      order: index + 1,
      bands: course.bands.map((band) => ({
        // 锚点即小节 id：卡片标签指向的就是它
        id: bandAnchor(band.title),
        title: band.title,
        body: band.content,
      })),
    }));

    coursePage = {
      heading: {
        eyebrow: page.heading.eyebrow,
        title: page.heading.title,
        description: page.heading.description,
      },
      subjects,
      electiveTitle: page.electiveTitle,
    };
  } catch {
    // 内容坏了就用空结构：后台照常能开，网站会回落到模版
  }

  try {
    const teachers = getTeachersPageFromTemplate().heading;
    teacherHeading = {
      eyebrow: teachers.eyebrow,
      title: teachers.title,
      description: teachers.description,
    };
  } catch {
    // 同上：内容坏了就留空，页面标题会回落到模版
  }

  return { coursePage, teacherPage: { heading: teacherHeading }, pricingPage: { labels } };
}

/** 报价页文案的空值（键必须齐全：页面上少一个键就是一个空按钮）。 */
function emptyPricingLabels(): SitePricingLabels {
  return {
    result: "",
    submit: "",
    reset: "",
    unitPriceLabel: "",
    unit: "",
    totalLabel: "",
    formulaNote: "",
    calculatorTitle: "",
    calculatorHint: "",
    otherTitle: "",
    lessonsLabel: "",
    lessonsHint: "",
    durationLabel: "",
    classSizeLabel: "",
    classCostLabel: "",
    classCostHint: "",
  };
}

/** 空结构（迁移老库、或后端还没导入过内容时用）。 */
export function emptySiteContent(): SiteContent {
  return {
    coursePage: {
      heading: { eyebrow: "", title: "", description: "" },
      subjects: [],
      electiveTitle: "",
    },
    teacherPage: { heading: { eyebrow: "", title: "", description: "" } },
    pricingPage: { labels: emptyPricingLabels() },
  };
}


/**
 * 删除护栏要看的两样东西（都不是"内容本身"，因此单独一个参数）。
 *
 * 为什么不把它们塞进 `SiteContent`：这两样是**库里的现状**（课程行、改之前的那一版正文），
 * 不是要保存的内容。混进内容对象里就会有人把它一起存进库，于是"护栏用的数据"变成
 * 内容的一部分，下一轮校验读到的是上一轮自己写的东西。
 */
export type SiteContentGuard = {
  /** 库里的课程卡片；用来判断"这个小节还有没有卡片指着它"。 */
  courses?: readonly Course[];
  /** 库里**当前**那一版正文：只有"原本有、这次没了"才算删除，见下面的规则。 */
  previous?: SiteContent;
};

/**
 * 校验一份网站内容（后台要保存整份内容时用）。
 *
 * 返回问题清单；空数组表示可以用。刻意**不自动纠正**（比如给空名字补个默认名）：
 * 网站正文是给人看的，系统替人编一个名字，最后只会在页面上出现"未命名"这种东西。
 *
 * ## 删除护栏：被卡片指着的小节不许消失（`guard` 传进来时才判）
 *
 * 这是唯一一条"要看库里别的表"的规则，因此**必须在服务端**（`site.saveContent`）判：
 * 前台拦住手滑靠的是同一份判定（课程表单的删除按钮会先说清是哪门课），
 * 但前台可以被绕过（直接调接口），而这条规则的失败形态是**网站上的卡片跳空** ——
 * 点「学考」跳到不存在的位置，页面上不报错、只停在页首，谁也不会发现。
 *
 * 判据是"**原本在、这次没了**"（拿 `previous` 比），而不是"库里的卡片指着它就必须存在"：
 * 卡片完全可以先于正文存在（先建卡片、再写正文是正常的顺序），
 * 按绝对值判会让那种正常情况连"保存一次现有内容"都被拒 —— 一个挡住正常操作的护栏
 * 比没有护栏更糟（人会去关掉它）。
 */
export function validateSiteContent(content: SiteContent, guard: SiteContentGuard = {}): string[] {
  const problems: string[] = [];
  const page = content.coursePage;

  if (page.subjects.length === 0) {
    problems.push("课程正文至少要有一个学科（否则网站课程页会没有内容，只能回落模版）。");
  }

  const subjectNames = new Set<string>();
  for (const subject of page.subjects) {
    const name = subject.name.trim();
    if (name === "") problems.push("学科名不能为空。");
    if (subjectNames.has(name)) problems.push(`学科「${name}」出现了两次：学科名要唯一（它是锚点与卡片关联的依据）。`);
    subjectNames.add(name);

    const anchors = new Set<string>();
    for (const band of subject.bands) {
      const title = band.title.trim();
      if (title === "") problems.push(`学科「${name}」有一个小节没有标题。`);
      if (band.id.trim() === "") {
        problems.push(`学科「${name}」的小节「${title}」缺少锚点 id。`);
      }
      if (anchors.has(band.id)) {
        problems.push(`学科「${name}」里小节锚点「${band.id}」重复了：卡片标签按锚点跳转，重了会跳到错的地方。`);
      }
      anchors.add(band.id);
    }
  }

  /*
   * 删除护栏（见函数头）：上一版里有、这一版没有了的锚点，只要还有卡片指着它，
   * 整份保存就被拒 —— 并且**点名那门课**：只说"这个锚点还在被引用"，
   * 人是找不到那门课的（21 个学科 / 60 多个小节 / 上百张卡片里翻标签）。
   */
  if (guard.previous !== undefined) {
    const kept = new Set(anchorsOf(content));
    const referenced = new Set<string>();
    for (const anchor of anchorsOf(guard.previous)) {
      if (kept.has(anchor)) continue;
      const courses = coursesReferencingAnchor(guard.courses ?? [], anchor);
      if (courses.length === 0) continue;
      // 同一个锚点只报一次（重复的锚点在上一版里可能是数据问题，那不是这条护栏的事）
      if (referenced.has(anchor)) continue;
      referenced.add(anchor);
      const names = courses.map((course) => `「${course.name}」`).join("、");
      problems.push(
        `不能删掉小节「${anchor}」（改名也一样）：课程 ${names} 的卡片靶点 / 标签还指着它，` +
          "删了它，网站上那张卡片点进去就会跳空。请先改掉那门课的标签 / 靶点，再回来删。",
      );
    }
  }

  return problems;
}

/** 一份内容里的全部小节锚点（去掉首尾空白、丢掉空串；护栏与重复检查用同一口径）。 */
function anchorsOf(content: SiteContent): string[] {
  return content.coursePage.subjects.flatMap((subject) =>
    subject.bands.map((band) => band.id.trim()).filter((id) => id !== ""),
  );
}
