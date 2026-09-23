/**
 * 网站内容的**入库/出库**（课程页正文）。
 *
 * ## 为什么需要这个模块
 *
 * 宣传网站的课程正文原先只存在于 `data/site/content.md`：后台看不见、改不了，
 * 于是「网站以后端为准」这件事无从谈起。v15 起这些正文进了数据库
 * （`db.siteContent.coursePage`），本模块负责两件事：
 *
 *   1. `siteContentFromContent()` —— 内容文件 → 库里的结构（首次初始化、导入、迁移用）；
 *   2. `emptySiteContent()` —— 空结构（老库补字段时用）。
 *
 * 反方向（库 → 文件）目前没有自动通道：两态口径下"没连后端就用模版"，
 * 因此不需要把库导回文件（早先那条 `npm run site:snapshot` 已经删掉）。
 *
 * ## 与 `courses` 表的分工
 *
 * 卡片（小学语文、雅思…）在 `courses` 表里；本模块只管**学科正文**
 * （语文 → 小学语文 / 初中语文 / 高中语文 那些段落）与选修课父分组名。
 * 一个学科是正文容器，一张卡片是入口，两者粒度不同 —— 硬合成一张表，
 * 导语与小节就要在每行里重复一份。
 */

import { getCoursesPageFromTemplate, getTeachersPageFromTemplate } from "@/lib/data/site";
import { getCasesContentFromTemplate } from "@/lib/data/pages";
import { getFeaturedContentFromTemplate } from "@/lib/data/featured";
import { getPricingData } from "@/lib/data/pricing";
import { coursesReferencingAnchor } from "./site-bands";
import { nextId } from "./ids";
import { FEATURED_MAX_DEPTH } from "./featured-tree";
import type {
  Course,
  SiteCase,
  SiteCasesPage,
  SiteFeaturedCourse,
  SiteFeaturedPage,
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

  return {
    coursePage,
    teacherPage: { heading: teacherHeading },
    pricingPage: { labels },
    casesPage: casesFromContent(),
    featuredPage: featuredFromContent(),
  };
}

/**
 * 特色课程（内容文件 → 库结构）。
 *
 * id 由服务生成（`feat_…`）：它只用来"认人"（日志、上下移、删除），
 * URL 用的是 `slug`（路径分段）—— 两者分开，改名才不会让网址失效。
 * 反复导入不会重复（导入侧按 `slug` 路径认已有的行，见 `site-import.ts`）。
 */
function featuredFromContent(): SiteFeaturedPage {
  const node = (course: {
    name: string;
    slug: string;
    fields: Array<{ title: string; value: string }>;
    body: string;
    children: unknown[];
  }): SiteFeaturedCourse => ({
    id: nextId("feat"),
    name: course.name,
    slug: course.slug,
    fields: course.fields.map((field) => ({ title: field.title, value: field.value })),
    body: course.body,
    children: (course.children as Parameters<typeof node>[0][]).map(node),
  });

  try {
    const page = getFeaturedContentFromTemplate();
    return {
      heading: {
        eyebrow: page.eyebrow,
        title: page.title,
        description: page.description,
      },
      notice: page.notice,
      courses: page.courses.map(node),
    };
  } catch {
    // 内容坏了就留空结构：后台照常能开，网站那侧显示"暂时没有特色课程"
    return { heading: { eyebrow: "", title: "", description: "" }, notice: "", courses: [] };
  }
}

/** 特色课程的空结构。 */
function emptyFeaturedPage(): SiteFeaturedPage {
  return { heading: { eyebrow: "", title: "", description: "" }, notice: "", courses: [] };
}

/**
 * 学生案例（内容文件 → 库结构）。
 *
 * id 用**案例标题**：与内容文件里的分组名一一对应，因此反复导入不会漂、
 * 后台改了标题也不会换 id（上移下移、日志都按 id 认人）。标题重复时后面那条加序号。
 */
function casesFromContent(): SiteCasesPage {
  try {
    const page = getCasesContentFromTemplate();
    const seen = new Set<string>();
    const cases: SiteCase[] = page.cases.map((item) => {
      const base = item.title.trim();
      let id = base;
      let suffix = 2;
      while (seen.has(id)) {
        id = `${base}（${String(suffix)}）`;
        suffix += 1;
      }
      seen.add(id);
      return {
        id,
        title: base,
        fields: item.fields.map((field) => ({ title: field.title, value: field.value })),
        story: item.story,
      };
    });
    return {
      heading: {
        eyebrow: page.eyebrow,
        title: page.title,
        description: page.description,
      },
      notice: page.notice,
      cases,
    };
  } catch {
    // 内容坏了就留空结构：后台照常能开，网站那侧会显示"暂时没有案例"
    return { heading: { eyebrow: "", title: "", description: "" }, notice: "", cases: [] };
  }
}

/** 学生案例的空结构。 */
function emptyCasesPage(): SiteCasesPage {
  return { heading: { eyebrow: "", title: "", description: "" }, notice: "", cases: [] };
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
    casesPage: emptyCasesPage(),
    featuredPage: emptyFeaturedPage(),
  };
}

/**
 * 案例的校验（**与课程正文分开**，见 `validateSiteBlocks` 的说明）。
 *
 * 三条规则各自对应一次真实的误操作：
 *   - 标题为空 → 页面上出现一条点不开、也认不出的案例；
 *   - 标题重复 → 两条案例在页面上长得一样，改哪一条都说不清（id 是从标题来的）；
 *   - 字段没有名字 → 页面上渲染出一个只有值、没有标签的行。
 *
 * **允许一条案例都没有**：内容文件里就写着"不希望公开就把分组整段删掉，页面会自动适配"，
 * 因此"暂时没有案例"是合法状态（页面会显示一句"案例整理中"之类的话，不报错）。
 */
export function validateCasesPage(page: SiteCasesPage): string[] {
  const problems: string[] = [];
  const titles = new Set<string>();
  for (const item of page.cases) {
    const title = item.title.trim();
    if (title === "") problems.push("案例标题不能为空。");
    if (titles.has(title)) {
      problems.push(`案例「${title}」出现了两次：标题是案例的身份，重复了改哪一条都说不清。`);
    }
    titles.add(title);

    const names = new Set<string>();
    for (const field of item.fields) {
      const name = field.title.trim();
      if (name === "") problems.push(`案例「${title}」有一个字段没有名字（只有值）。`);
      if (names.has(name)) problems.push(`案例「${title}」的字段「${name}」重复了。`);
      names.add(name);
    }
  }
  return problems;
}

/**
 * **网站内容里「课程正文以外」那些块的校验**。
 *
 * 为什么不复用 `validateSiteContent`：那个函数的第一条是"课程正文至少要有一个学科"
 * （因为课程页是网站的主体，空着等于告诉家长"我们没有课程"）。而科目/案例这些块的保存
 * 与课程正文**不是同一次操作** —— 后台「网站内容」页保存案例时，把课程正文一起带上校验，
 * 就会出现"课程正文还没导入的空库里，连一条案例都存不进去"这种荒唐的连锁失败。
 * 两个入口各管各的块，校验也各管各的。
 */
export function validateSiteBlocks(blocks: {
  casesPage?: SiteCasesPage;
  featuredPage?: SiteFeaturedPage;
}): string[] {
  const problems: string[] = [];
  if (blocks.casesPage !== undefined) problems.push(...validateCasesPage(blocks.casesPage));
  if (blocks.featuredPage !== undefined) problems.push(...validateFeaturedPage(blocks.featuredPage));
  return problems;
}

/**
 * 特色课程的校验。
 *
 * 四条规则各自对应一次真实的误操作：
 *   - 课程名为空 → 页面上出现一条点不开、也认不出的课程；
 *   - **同级重名** → 两门同名课程在页面上长得一样，而且它们的 URL 分段会撞车
 *     （没写路径时路径由名字派生）；
 *   - 路径分段重复 → 两条不同的路径映射到同一个网址，其中一个页面会被另一个盖掉；
 *   - **超过三级** → 网站的导航与页面结构只做到三级（内容文件的标题层级也只到 `#####`），
 *     第四级存得下但没有任何入口能到达它。
 */
export function validateFeaturedPage(page: SiteFeaturedPage): string[] {
  const problems: string[] = [];

  const walk = (courses: readonly SiteFeaturedCourse[], depth: number, where: string): void => {
    const names = new Set<string>();
    const slugs = new Set<string>();
    for (const course of courses) {
      const name = course.name.trim();
      const label = name === "" ? "（未命名）" : name;
      if (name === "") problems.push(`${where}有一门课程没有名字。`);
      if (names.has(name)) {
        problems.push(`${where}有两门课程都叫「${name}」：同级课程名不能重复（它们的网址也会撞车）。`);
      }
      names.add(name);

      const slug = course.slug.trim();
      if (slug !== "" && slugs.has(slug)) {
        problems.push(`${where}的路径「${slug}」出现了两次：两条不同的课程会指向同一个网址。`);
      }
      if (slug !== "") slugs.add(slug);

      if (depth >= FEATURED_MAX_DEPTH && course.children.length > 0) {
        problems.push(
          `「${label}」下面还有子课程：特色课程最多 ${String(FEATURED_MAX_DEPTH)} 级` +
            `（一级 → 二级 → 三级），第四级在网站上没有入口。`,
        );
      }
      walk(course.children, depth + 1, `「${label}」下`);
    }
  };

  walk(page.courses, 1, "特色课程");
  return problems;
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
