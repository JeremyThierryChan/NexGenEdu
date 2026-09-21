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

import { getCoursesPage } from "@/lib/data/site";
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
  try {
    labels = getPricingData().labels;
  } catch {
    // 报价内容坏了就留空：价格数字仍在 pricing 配置里，页面不会因此算不出价
  }

  try {
    const page = getCoursesPage();
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

  return { coursePage, pricingPage: { labels } };
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
