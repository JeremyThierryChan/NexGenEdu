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
import type {
  SiteBand,
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
 * 这份网站内容是不是**有内容**。
 *
 * 判定标准刻意取"至少有一个学科且至少有一个小节"：只要有一个学科就能撑起
 * 课程页正文；一条都没有说明后端还没导入过内容 —— 此时网站必须回落到模版，
 * 否则线上会出现一个**空白课程页**（比显示旧模版糟糕得多）。
 */
export function hasCoursePageContent(content: SiteContent | undefined): boolean {
  if (content === undefined) return false;
  return content.coursePage.subjects.some((subject: SiteSubject) => subject.bands.length > 0);
}

/** 小节锚点（导出 / 校验时用）。 */
export function coursePageAnchors(content: SiteContent): string[] {
  return content.coursePage.subjects.flatMap((subject) => subject.bands.map((band: SiteBand) => band.id));
}

/**
 * 校验一份网站内容（后台要保存整份内容时用）。
 *
 * 返回问题清单；空数组表示可以用。刻意**不自动纠正**（比如给空名字补个默认名）：
 * 网站正文是给人看的，系统替人编一个名字，最后只会在页面上出现"未命名"这种东西。
 */
export function validateSiteContent(content: SiteContent): string[] {
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

  return problems;
}
