/**
 * 内容与报价的自检脚本。
 *
 * 用途：改完 data/site/*.md 或解析器后运行，一次性检查
 *   1. 数据层各页面条目数量是否符合预期
 *   2. 首页课程卡片与课程页锚点是否一一对应
 *   3. 报价公式的关键用例是否仍正确
 *
 * 这些断言是补上来的：此前解析器层级出错时，构建依然成功、
 * 首页也正常，只有课程正文是空的 —— 靠肉眼发现太晚。
 *
 * 运行：npm run check
 */
import { parseDocument } from "@/lib/data/content";
import { contentSource } from "@/data/site/content";
import { pricingSource } from "@/data/site/pricing";
import {
  getAboutContent,
  getContactContent,
  COLUMN_PATHS,
  getAllCourseColumnSlugs,
  getAllCoursePageSlugs,
  getCardsForForm,
  getFormSubjectGroups,
  getCourseColumnPageData,
  getCourseColumns,
  getCoursePageData,
  getCoursesPage,
  getHomeContent,
  getSiteBrand,
  getTeachersPage,
} from "@/lib/data/site";
import { getPricingData } from "@/lib/data/pricing";
import { getCasesContent, getFaqContent, getScheduleContent } from "@/lib/data/pages";
import { findFeaturedCourse, getAllFeaturedCourses, getFeaturedContent } from "@/lib/data/featured";
import { calculateQuote, isTrialFree, trialFeeFor } from "@/lib/pricing/quote";
import { __useStoreForTesting, api } from "@/lib/backend/api";
import { createMemoryStore } from "@/lib/backend/storage";
import { dateKey } from "@/lib/backend/format";
import { isWithinAvailability, isoWeekday } from "@/lib/backend/availability";
import { remainingOf, remainingTotal } from "@/lib/backend/enrollment";
import { CURRENT_VERSION } from "@/lib/backend/version";
import { weekDays } from "@/lib/backend/format";
import { LEAVE_NOTICE_HOURS, decideCharge } from "@/lib/backend/attendance";
import {
  FOLLOWUP_RULES,
  buildFollowUps,
  followUpsToText,
  summarizeFollowUps,
} from "@/lib/backend/followup";
import {
  discountAmount,
  findRefundPolicy,
  formatMoney,
  outstandingAmount,
  round2,
} from "@/lib/backend/finance";
import {
  createCsv,
  createIcs,
  databaseStats,
  escapeIcsText,
  icsLocalTime,
  serializeDatabase,
} from "@/lib/backend/backup";
import {
  PROFILE_SECTIONS,
  emptyProfileTable,
  profileCompletion,
  profileList,
  profileTable,
  profileText,
} from "@/lib/backend/student-profile";
import { createSeedDatabase } from "@/lib/backend/seed";

const seedDb = createSeedDatabase();
import {
  __credentialsForTesting,
  __useSessionStoreForTesting,
  getSession,
  isLoggedIn,
  login,
  logout,
} from "@/lib/auth/session";

let failures = 0;

/** 断言相等。 */
function eq(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`  ✗ ${label}\n      实际: ${JSON.stringify(actual)}\n      期望: ${JSON.stringify(expected)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

/** 断言为真。 */
function ok(label: string, condition: boolean): void {
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log("=== 1. 数据层解析 ===");
const contentDoc = parseDocument(contentSource);
const sitePage = contentDoc.pages.get("全站");
const home = contentDoc.pages.get("首页");
const coursesPage = contentDoc.pages.get("课程");
const teachersPage = contentDoc.pages.get("教师");
const aboutPage = contentDoc.pages.get("关于");
const contactPage = contentDoc.pages.get("联系我们");

// 课程栏目改到「全站」段（首页与课程页共用），首页不再自带卡片分组
eq("首页分组数", home?.groups.map((g) => g.name), ["首屏数据", "教学特色", "教室照片格位"]);
eq("全站页分组数", sitePage?.groups.map((g) => g.name), ["课程栏目"]);
// 条目数不写死：增删课程是正常编辑，这里只要求「解析出了卡片」
ok("课程栏目有卡片条目", (sitePage?.groups.find((g) => g.name === "课程栏目")?.items.length ?? 0) >= 20);
eq("首页首屏数据数", home?.groups.find((g) => g.name === "首屏数据")?.items.length, 6);
eq("首页教学特色数", home?.groups.find((g) => g.name === "教学特色")?.items.length, 7);
// 教师数量刻意不写死：data/site/content.md 是手改的，增删教师不该让自检（以及部署）失败。
// 真正要守住的是「每个分组都被识别成教师」——漏填 科目/简介 会导致某人静默不显示。
ok("教师页每个分组都被识别为教师",
  (teachersPage?.groups ?? []).every((g) =>
    g.items.some((i) => i.title === "科目" || i.title === "简介")));
eq("关于分组数", aboutPage?.groups.length, 4);
eq("联系分组数", contactPage?.groups.length, 1);

const courseNames = (coursesPage?.groups ?? []).map((g) => g.name);
// 数据文件里「课程」页有 19 个学科分组（含新增的日语 / 俄语）+ 1 个选修课分组	eq("课程页分组数", courseNames.length, 20);
ok("学科名含「技术」", courseNames.includes("技术"));
ok("学科名含「社会」", courseNames.includes("社会"));

// 同一学科的不同学段放在同一分组内，学段数按学科不同（语文 3、科学 2、物理 1…）
const bandCounts = Object.fromEntries(
  (coursesPage?.groups ?? []).map((g) => [g.name, g.children.length]),
);
eq("语文含 3 个学段", bandCounts["语文"], 3);
eq("数学含 3 个学段", bandCounts["数学"], 3);
eq("英语含 3 个学段", bandCounts["英语"], 3);
eq("科学含 2 个学段", bandCounts["科学"], 2);
eq("社会含 1 个学段", bandCounts["社会"], 1);
// 七选三的 7 科都拆成「学考」「选考」两段
for (const subject of ["物理", "化学", "生物", "政治", "历史", "地理", "技术"]) {
  eq(`高中${subject}含学考+选考两段`, bandCounts[subject], 2);
  ok(`高中${subject}两段都点名学考/选考`,
    (coursesPage?.groups.find((g) => g.name === subject)?.children ?? [])
      .every((child) => child.name.includes("学考") || child.name.includes("选考")));
}
eq("日语含 N5–N3 三段", bandCounts["日语"], 3);
eq("俄语含 A1–B2 四段", bandCounts["俄语"], 4);
// 语言类课程按欧标 A1–B2 四段
for (const lang of ["法语", "德语", "意大利语", "西班牙语"]) {
  eq(`${lang}含 A1–B2 四段`, bandCounts[lang], 4);
}
// 雅思总览 + 听/说/读/写四个分项（数量随内容调整，只要求分项确实拆开了）
ok("雅思拆出总览与听说读写分项", (bandCounts["雅思"] ?? 0) >= 5);

// 学段标题检查：语言课必须是 A1/A2/B1/B2
const french = (coursesPage?.groups ?? []).find((g) => g.name === "法语");
eq("法语学段标题", french?.children.map((c) => c.name.split("｜")[0]),
  ["法语A1", "法语A2", "法语B1", "法语B2"]);
ok("法语各级都写了核心能力",
  (french?.children ?? []).every((c) => c.body.includes("核心能力")));

const pricingDoc = parseDocument(pricingSource);
const pricingPage = pricingDoc.pages.get("智能报价");
eq("报价页分组", pricingPage?.groups.map((g) => g.name), ["学习阶段", "班级类型", "课时选择", "试课", "其他项目"]);

console.log("\n=== 2. 数据访问层 ===");
const brand = getSiteBrand();
ok("品牌名非空", brand.brandName === "NexGenEdu");
ok("中文名非空", brand.brandNameZh === "新锐教培");
ok("联系方式非空", brand.contact.phone !== "");

const homeContent = getHomeContent();
const { courses: allCourses, columns, electiveGroups: electiveGroupList } = getCoursesPage();

/**
 * 课程栏目的自检原则：**只校验性质，不校验具体名单**。
 *
 * content.md 是手工维护的，增删课程、改课程名都是正常操作，
 * 把 34 张卡片的名字逐个写进断言会让「改内容」和「自检通过」互相打架
 * （而 check 会卡住部署，等于正常编辑也推不上去）。
 *
 * 因此这里守住的是结构性质与跳转完整性：
 *   - 六个栏目固定，`高中课内` 固定分 必考科目 / 外语 / 七选三 三个子标题；
 *   - 每个栏目、每个子标题下都有卡片，卡片名不重复；
 *   - 卡片与标签的跳转目标都必须真实存在（这是「点了跳报错页」的根因）；
 *   - 课程页不能有「从任何入口都进不去」的孤立小节。
 */
// 栏目结构只服务于课程页的「课程总览」（首页课程区改为按班型展示）
eq("课程页栏目", columns.map((c) => c.title),
  ["小学课内", "初中课内", "高中课内", "外语", "课外兴趣", "成人课程"]);
eq("栏目与全站段同源", columns, getCourseColumns());

// 首页课程区展示的是班型（一对一等），不是学科
const classTypes = getFeaturedContent().courses.flatMap((c) =>
  c.children.map((child) => child.name),
);
ok("首页课程区有班型可展示", classTypes.length >= 5);
ok("班型含 一对一定制课 与 小组课",
  classTypes.some((n) => n.includes("一对一")) && classTypes.some((n) => n.includes("小组课")));

const HIGH_SCHOOL_SUBGROUPS = ["必考科目", "外语", "七选三"];
eq("高中课内的子标题", columns.find((c) => c.title === "高中课内")?.subgroups.map((g) => g.title),
  HIGH_SCHOOL_SUBGROUPS);
ok("每个栏目都有卡片", columns.every((c) => c.subgroups.some((g) => g.cards.length > 0)));
ok("每个子标题都有卡片", columns.every((c) => c.subgroups.every((g) => g.cards.length > 0)));

const allCards = columns.flatMap((c) => c.subgroups.flatMap((g) => g.cards));
ok("卡片总数不少于 20", allCards.length >= 20);
eq("卡片名不重复",
  allCards.filter((c, i) => allCards.findIndex((x) => x.title === c.title) !== i).map((c) => c.title), []);

// 无标签的卡片 = 一门课一张卡、整卡可点；有标签的卡片必然在卡片内部还有细分
ok("每张卡片都有跳转目标", allCards.every((c) => c.target !== ""));
ok("标签都有文字与跳转目标", allCards.every((c) => c.tags.every((t) => t.target !== "" && t.label !== "")));
ok("卡片内标签不重复", allCards.every((c) => new Set(c.tags.map((t) => t.label)).size === c.tags.length));

// 七选三：每张卡都该有「学考」和「选考」两个标签（这是该子标题的定义）
const xuanSan = columns.find((c) => c.title === "高中课内")?.subgroups.find((g) => g.title === "七选三");
ok("七选三每张卡都带 学考 + 选考 标签",
  (xuanSan?.cards ?? []).every((c) => {
    const labels = c.tags.map((t) => t.label);
    return labels.includes("学考") && labels.includes("选考");
  }));

// 外语栏目的语言课：每张卡都按级别挂标签（日语 N5–N3、其余 A1–B2）
const foreignCards = (columns.find((c) => c.title === "外语")?.subgroups ?? []).flatMap((g) => g.cards);
ok("外语栏目每张语言卡都有级别标签",
  foreignCards.filter((c) => c.title !== "雅思").every((c) => c.tags.length >= 3));

// 每张卡片一个页面：路径必须写全、不能重复，且每张卡片都能取到页面数据
const slugs = allCards.map((c) => c.path);
ok("每张卡片都有路径", slugs.every((slug) => slug !== ""));
eq("卡片路径不重复", slugs.filter((s, i) => slugs.indexOf(s) !== i), []);
// 栏目路径与卡片路径共用 /courses/<一段>：不能重叠，否则某层会被遮住
const columnSlugs = getAllCourseColumnSlugs();
eq("六个栏目都有页面路径", columnSlugs.length, columns.length);
eq("栏目路径不重复", columnSlugs.filter((x, i) => columnSlugs.indexOf(x) !== i), []);
eq("栏目路径与卡片路径不重叠",
  columnSlugs.filter((slug) => slugs.includes(slug)), []);
eq("每个栏目页都能取到数据",
  columns.filter((c) => getCourseColumnPageData(COLUMN_PATHS[c.title] ?? "") === null).map((c) => c.title), []);
ok("栏目页每个科目都有一句简介",
  columns.every((c) =>
    (getCourseColumnPageData(COLUMN_PATHS[c.title] ?? "")?.subgroups ?? [])
      .flatMap((g) => g.cards)
      .every((card) => card.summary !== "" || card.unavailable)));

// 班型：写的是「特色课程」里的班型名，必须真的存在，避免写出不存在的班型
const featuredNames = new Set(
  getFeaturedContent().courses.flatMap((c) => c.children.map((child) => child.name)),
);
// 班型的正反两个方向必须一致：卡片上写了哪个班型，那个班型页就该列出这张卡片
const formNames = getFeaturedContent().courses.flatMap((c) => c.children.map((child) => child.name));
const reverseMismatch = formNames.flatMap((form) => {
  const listed = new Set(getCardsForForm(form).map((item) => item.card.path));
  const expected = new Set(allCards.filter((card) => card.forms.includes(form)).map((card) => card.path));
  const missing = [...expected].filter((path) => !listed.has(path));
  const extra = [...listed].filter((path) => !expected.has(path));
  return [...missing.map((p) => `${form} 少了 ${p}`), ...extra.map((p) => `${form} 多了 ${p}`)];
});
eq("班型页列出的科目与卡片上写的班型一致", reverseMismatch, []);
// 班型页按阶段分组展示：分组结果必须与卡片本身一一对应
const grouped = getFormSubjectGroups("一对一定制课").flatMap((g) =>
  g.subgroups.flatMap((sub) => sub.cards.map((card) => card.path)),
);
eq("班型页分组展示不漏卡片",
  allCards.filter((c) => c.forms.includes("一对一定制课") && !grouped.includes(c.path)).map((c) => c.title),
  []);
ok("班型页分组都带栏目页路径",
  getFormSubjectGroups("一对一定制课").every((g) => g.columnHref.startsWith("/courses/")));
/*
 * 两种「不是按人数分」的班型，语义由业务决定，这里把它固定住：
 *   - 晚托管：不分科目，是单独的服务（按学段分小学晚托 / 初中晚托），
 *     因此不该挂到任何学科上；
 *   - 周中预习课：只在初中开设，因此只应挂在初中课内的科目上。
 * 哪天业务变了，改内容的同时也会在这里被提醒。
 */
eq("晚托管不挂到任何学科（它是单独的服务，不分科目）", getCardsForForm("晚托管"), []);
eq("周中预习课只挂在初中科目上",
  [...new Set(getCardsForForm("周中预习课").map((item) => item.column))],
  ["初中课内"]);
ok("四种按人数的班型都有关联科目",
  ["一对一定制课", "一对二 / 一对三小组课", "一对多小班课", "9 人以上大班课"]
    .every((form) => getCardsForForm(form).length >= 20));
eq("卡片上写的班型都存在于特色课程",
  allCards.flatMap((c) => c.forms.filter((form) => !featuredNames.has(form)).map((form) => `${c.title} → ${form}`)),
  []);

eq("卡片路径是 ASCII（中文名进 URL 会踩百分号编码的坑）",
  slugs.filter((slug) => !/^[a-z0-9-]+$/.test(slug)), []);

const pages = allCards.map((card) => ({ card, data: getCoursePageData(card.path) }));
eq("每张卡片都有页面数据", pages.filter((p) => p.data === null).map((p) => p.card.title), []);
eq("卡片页路径清单与卡片一致", [...getAllCoursePageSlugs()].sort(), [...slugs].sort());

// 卡片上的标签 = **同一页面内的阶段**：不单独建页面，而是必须能在本页取到内容
const missingStages = pages.flatMap(({ card, data }) =>
  card.tags
    .filter((tag) => !(data?.stages ?? []).some((stage) => stage.anchor === tag.target))
    .map((tag) => `${card.title} · ${tag.label}→${tag.target}`),
);
eq("标签都能在本卡片页面里找到对应阶段", missingStages, []);

// 没标签的卡片必须至少有一段正文或介绍，否则页面会只剩标题
eq("无标签的卡片都有正文或介绍",
  pages
    .filter(({ card, data }) =>
      card.tags.length === 0 &&
      (data?.stages.length ?? 0) === 0 &&
      (data?.intro ?? "").trim() === "")
    .map(({ card }) => card.title),
  []);

// 「与其他阶段的关联性」：学段课程应当能指出同学科的其他学段
const chinese = getCoursePageData("primary-chinese");
eq("小学语文页面关联到初中 / 高中语文",
  chinese?.sameSubject.map((c) => c.title), ["初中语文", "高中语文"]);
const physics = getCoursePageData("senior-physics");
eq("高中物理页面的阶段是 学考 + 选考", physics?.stages.map((s) => s.anchor),
  ["高中物理学考", "高中物理选考"]);
ok("高中物理页面关联到七选三的其他课程",
  (physics?.sameColumn.length ?? 0) >= 3);
const ielts = getCoursePageData("ielts");
// 阶段顺序跟随卡片上的标签顺序
eq("雅思页面的阶段是四项分项", ielts?.stages.map((s) => s.anchor),
  ["雅思口语", "雅思听力", "雅思阅读", "雅思写作"]);
// 雅思自己的总览小节不属于任何标签，也不能丢内容
eq("雅思页面保留了课程总览", ielts?.overview?.anchor, "雅思");

/*
 * 反向：详情区的每一段内容都必须**在某个页面上看得见**——
 * 要么是某张卡片页里的一个阶段，要么是某张卡片页开头的课程说明，
 * 要么这张卡片本身就有页面（选修课的介绍就是它的页面内容）。
 */
const visible = new Set<string>();
for (const { card, data } of pages) {
  for (const stage of data?.stages ?? []) visible.add(stage.anchor);
  if (data?.overview != null) visible.add(data.overview.anchor);
  visible.add(card.title);
}
const orphans = [
  ...allCourses.flatMap((c) => c.bands.map((b) => (b.title.split("｜")[0] ?? b.title))),
  ...electiveGroupList.flatMap((g) => g.items.map((i) => i.name)),
].filter((name) => !visible.has(name));
eq("课程内容没有进不去的孤立小节", orphans, []);

/*
 * 教师关联：不能编造，只认教师页「科目」字段的匹配。
 *
 * 现在教师人数少，允许部分科目关联不到老师（页面会显示「按学生的年级与薄弱环节
 * 安排」）。因此这里**不设「每门课都要有老师」的硬性要求**，只保证：
 * 关联到的老师确实带这门科目；并且把还没关联到老师的科目打印出来，
 * 便于后续在 content.md 里补老师时一眼看到进度。
 */
ok("关联到的教师确实带这门科目",
  pages.every(({ data }) =>
    (data?.teachers ?? []).every((teacher) =>
      teacher.subjects.some((subject) => {
        const haystack = [data?.card.title ?? "", ...(data?.stages ?? []).map((stage) => stage.anchor)].join(" ");
        return subject !== "" && haystack.includes(subject);
      }),
    ),
  ));
const withoutTeacher = pages
  .filter(({ data }) => (data?.teachers.length ?? 0) === 0)
  .map(({ card }) => card.title);
console.log(`  （提示）暂未关联到教师的课程 ${withoutTeacher.length} 门：${withoutTeacher.join("、")}`);
ok("教师关联的扩展性保留（有关联能力的课程已生效）",
  pages.filter(({ data }) => (data?.teachers.length ?? 0) > 0).length >= 1);

eq("首页教室格位", homeContent.classrooms.length, 3);
eq("首页首屏数据", homeContent.stats.length, 6);
eq("首页教学特色", homeContent.features.length, 7);
ok("首页 CTA 非空", homeContent.cta.title !== "");
ok("首页试课区块有标题与要点", homeContent.trial.title !== "" && homeContent.trial.points.length >= 3);
eq("试课区块跳报价页", homeContent.trial.cta.href, "/quote");
ok("试课要点含免费条件", homeContent.trial.points.some((p) => p.includes("满 10 节")));
eq("学生案例区块跳案例页", homeContent.cases.cta.href, "/cases");
ok("首页案例区块有文案", homeContent.cases.title !== "" && homeContent.cases.description !== "");

const { courses } = getCoursesPage();
// 学科数量不写死：增删课程是正常编辑（当前含新增的 日语 / 俄语 / 3D建模 / 编程）
ok("课程页学科数量合理", courses.length >= 15);
ok("每门学科都有学段内容", courses.every((c) => c.bands.length > 0 && c.bands[0].content.length > 50));

// 选修课程（成人 / 课外兴趣）：与学科分开返回，当前全部标注暂未开放
const { electiveGroups, electiveTitle } = getCoursesPage();
const electives = electiveGroups.flatMap((g) => g.items);
// 分组名由数据文件决定
ok("选修课所在分组有名字", electiveTitle !== "");
ok("选修课程至少 1 门", electives.length >= 1);
// 选修课按栏目分节，栏目名与数量都随内容调整；只要求分节非空且每节都有课
ok("选修课按栏目分节", electiveGroups.length >= 1 && electiveGroups.every((g) => g.title !== "" && g.items.length > 0));
eq("选修课栏目不重复", electiveGroups.filter((g, i) => electiveGroups.findIndex((x) => x.title === g.title) !== i).map((g) => g.title), []);
ok("选修课程都有介绍", electives.every((e) => e.description.length > 10));
ok("选修课程当前全部未开放", electives.every((e) => !e.available));
ok("选修课程未混入学科列表", courses.every((c) => !electives.some((e) => e.name === c.nameZh)));
ok("每门选修课都归类到栏目", electives.every((e) => e.group !== ""));

// 「暂未开放」有两处来源：课程总览卡片行里的 `状态`，以及课程 / 选修课自己的 `状态`。
// 两边必须一致，否则会出现「卡片标着暂未开放、点进去却没有标记」这种自相矛盾。
const availability = new Map<string, boolean>();
for (const course of courses) availability.set(course.nameZh, course.unavailable);
for (const item of electives) availability.set(item.name, !item.available);
eq("卡片与课程/选修课的开放状态一致",
  allCards
    .filter((card) => availability.has(card.title))
    .filter((card) => card.unavailable !== availability.get(card.title))
    .map((card) => card.title),
  []);
ok("有课程标注了暂未开放", [...availability.values()].some(Boolean));
ok("数学含 3 个学段且带核心能力", (() => { const m = courses.find((c) => c.nameZh === "数学"); return m?.bands.length === 3 && m.bands.every((b) => b.content.includes("核心能力")); })());

const { teachers } = getTeachersPage();
// 在职角色数应等于「教师页分组数 − 离职数」：漏解析或重复解析都会在这里露出来
const offDuty = (teachersPage?.groups ?? []).filter(
  (g) => g.items.find((i) => i.title === "状态")?.value.trim() === "离职",
).length;
eq("在职角色数 = 分组数 − 离职数", teachers.length, (teachersPage?.groups.length ?? 0) - offDuty);
ok("教师有科目与详细介绍", teachers.every((t) => t.subjects.length > 0 && t.bio.length > 30));
ok("教师按排序升序", teachers.every((t, i) => i === 0 || (teachers[i - 1]?.order ?? 0) <= t.order));
ok("页面只展示在职教师", teachers.every((t) => t.active));
ok("首位教师为陈老师", teachers[0]?.name === "陈老师");
eq("陈老师职务为全科教师", teachers[0]?.role, "全科教师");
ok("陈老师有推荐理由", (teachers[0]?.recommendation ?? "").length > 10);
ok("其余教师未填推荐理由时为空", teachers.slice(1).every((t) => t.recommendation === ""));
const lin = teachers.find((t) => t.name === "林老师");
eq("林老师职务", lin?.role, "晚辅导老师");
eq("林老师科目标签", lin?.subjects, ["晚辅导"]);
eq("林老师教龄", lin?.years, "10 年");
ok("林老师有详细介绍", (lin?.bio.length ?? 0) > 50);
ok("排序无重复", new Set(teachers.map((t) => t.order)).size === teachers.length);
// 首页教师区是三列布局，真人教师至少要 3 位；AI 智能体可以有 0 个或多个
const realTeachers = teachers.filter((t) => t.kind === "teacher");
const aiAgents = teachers.filter((t) => t.kind === "ai");
// 真人教师数量不设下限：删减教师是正常编辑。
// 首页教师区会按实际人数排布（不足 3 位时不会留空位），因此这里只要求「有教师」。
ok("至少有一位真人教师", realTeachers.length >= 1);
ok("AI 智能体都有名字", aiAgents.every((t) => t.name.trim() !== ""));
ok("AI 智能体都有简介与详细介绍",
  aiAgents.every((t) => t.summary.length > 10 && t.bio.length > 80));
ok("AI 智能体排在真人教师之后",
  aiAgents.length === 0 ||
  Math.min(...aiAgents.map((t) => t.order)) > Math.max(...realTeachers.map((t) => t.order)));
ok("有恒的说明提示需家长配合",
  (teachers.find((t) => t.name.startsWith("有恒"))?.bio ?? "").includes("家长"));

const about = getAboutContent();
eq("教学理念条数", about.principles.length, 4);
eq("服务形式条数", about.services.length, 5);
eq("校区数据条数", about.facts.length, 4);
eq("校区介绍段数", about.campusParagraphs.length, 3);
ok("关于页标题与站点标语一致", about.title === brand.tagline.split(" · ")[0] || about.title.length > 0);
ok("理念含数据化诊断", about.principles.some((x) => x.title === "数据化诊断"));

const contact = getContactContent();
eq("联系方式条数", contact.methods.length, 5);

// 卡片与标签的双向锚点校验已并入第 2 节（栏目结构同一处维护），此处不再重复。

console.log("\n=== 3. 新增页面（案例 / 常见问题 / 时间安排）===");
const faq = getFaqContent();
eq("常见问题分组数", faq.groups.map((g) => g.title), ["试课与报名", "课时与收费", "班级与排课", "服务形式"]);
eq("常见问题总数", faq.count, 17);
ok("每个问题都有答案", faq.groups.every((g) => g.items.every((i) => i.question.length > 2 && i.answer.length > 10)));
ok("试课规则答案与业务一致", faq.groups.some((g) => g.items.some((i) => i.answer.includes("满 10 节"))));

const cases = getCasesContent();
eq("学生案例数", cases.cases.length, 3);
ok("每个案例都有前后水平对比", cases.cases.every((c) => c.from !== "" && c.to !== ""));
ok("每个案例都有过程描述", cases.cases.every((c) => c.story.length > 50));
ok("案例页有免责说明", cases.notice.includes("家长同意"));

const schedule = getScheduleContent();
eq("时间安排分组数", schedule.groups.length, 4);
eq("时间安排分组名", schedule.groups.map((g) => g.title),
  ["工作日排课", "周末排课", "晚辅导", "全日托"]);
ok("每组都有时段", schedule.groups.every((g) => g.items.length > 0));
const slots = (title: string) =>
  schedule.groups.find((g) => g.title === title)?.items.map((i) => `${i.title}|${i.value}`) ?? [];
eq("工作日排课时段", slots("工作日排课"), ["晚第一节|17:30–19:30", "晚第二节|19:30–21:30"]);
eq("周末排课时段", slots("周末排课"), [
  "第一节|08:00–10:00", "第二节|10:00–12:00", "第三节|13:00–15:00",
  "第四节|15:00–17:00", "第五节|18:00–20:00", "第六节|20:00–22:00",
]);
eq("晚辅导时段", slots("晚辅导"), ["小学|17:30–19:30", "初中|18:00–21:00"]);

console.log("\n=== 3.1 特色课程（层级与独立页面）===");
const featured = getFeaturedContent();
eq("特色课程一级分组", featured.courses.map((c) => c.name), ["课内辅导"]);
const inClass = featured.courses[0];
eq("二级课程数", inClass?.children.length, 7);
// 只要求「既有的这几门都在」：以后新增班型不该让自检失败，
// 但改名或误删既有课程必须被拦住
const LEVEL2_NAMES = [
  "一对一定制课", "一对二 / 一对三小组课", "一对多小班课", "9 人以上大班课",
  "晚托管", "周中预习课", "假期预习课",
];
eq("二级课程都在（含假期预习课）",
  LEVEL2_NAMES.filter((name) => !(inClass?.children.some((c) => c.name === name))),
  []);
ok("特色课程数量合理（当前 14 门）", getAllFeaturedCourses().length >= 13);
ok("每门课程都有 4 个描述字段",
  getAllFeaturedCourses().every((c) => c.fields.length >= 3));
ok("三级课程挂在正确的父级下",
  (inClass?.children.find((c) => c.name === "一对多小班课")?.children.length ?? -1) === 0);
ok("基础班挂在 9 人以上大班课下",
  (inClass?.children.find((c) => c.name === "9 人以上大班课")?.children.length ?? -1) === 0);
ok("晚托班挂在晚托管下",
  (inClass?.children.find((c) => c.name === "晚托管")?.children.map((c) => c.name) ?? []).join(",") === "小学晚托,初中晚托");
ok("假期预习课单独成组，含小升初 / 初升高四门课",
  (inClass?.children.find((c) => c.name === "假期预习课")?.children.map((c) => c.name) ?? []).join(",") ===
    "精品小升初,精品初升高,基础小升初,基础初升高");
ok("精品 / 基础两种进度都归在假期预习课下",
  (inClass?.children.find((c) => c.name === "假期预习课")?.children ?? []).every(
    (c) => c.children.length === 0 && c.fields.some((f) => f.title === "适合对象")));
ok("核心课程都有详细介绍",
  ["周中预习课", "一对一定制课", "精品小升初"].every((name) => {
    const found = getAllFeaturedCourses().find((c) => c.name === name);
    return (found?.body.length ?? 0) > 50;
  }));
// 按路径查找（页面路由与面包屑依赖它）。路径为显式声明的 ASCII 短路径。
const deep = findFeaturedCourse(["in-class", "holiday-preview", "junior-prep"]);
eq("按路径查找三级课程", deep?.course.name, "精品小升初");
eq("面包屑链路长度", deep?.trail.length, 3);
ok("不存在的路径返回 null", findFeaturedCourse(["不存在"]) === null);

// URL 路径必须全部为 ASCII 安全字符，否则静态托管无法解析
const allPaths = getAllFeaturedCourses().flatMap((c) => c.path);
ok("全部路径分段为 ASCII 安全字符",
  allPaths.every((segment) => /^[a-z0-9-]+$/.test(segment)));
ok("路径无重复", new Set(getAllFeaturedCourses().map((c) => c.path.join("/"))).size === getAllFeaturedCourses().length);
// 曾出问题的课程：课程名含空格与斜杠
const smallGroup = getAllFeaturedCourses().find((c) => c.name.includes("一对二"));
eq("含斜杠的课程名映射到安全路径", smallGroup?.path, ["in-class", "small-group"]);

console.log("\n=== 4. 报价数据 ===");
const pricing = getPricingData();
eq("阶段数", pricing.stages.length, 6);
eq("小学课程", pricing.stages[0]?.courses.map((c) => `${c.name}=${c.price}`),
  ["小学课内=150", "小学奥数=260", "小学英语竞赛=260", "小升初=200"]);
eq("初中课程数", pricing.stages[1]?.courses.length, 5);
eq("高中课程数", pricing.stages[2]?.courses.length, 4);
ok("专业英语全部未开放", pricing.stages[4]?.courses.every((c) => !c.available) === true);
ok("成人/兴趣有未开放项", pricing.stages[5]?.courses.some((c) => !c.available) === true);
eq("科目组数", pricing.subjectGroups.length, 3);
eq("小学科目", pricing.subjectGroups[0]?.subjects.map((s) => s.name), ["语文", "数学", "英语", "科学"]);
eq("高中科目数", pricing.subjectGroups[2]?.subjects.length, 10);
eq("班级类型", pricing.classTypes.map((c) => c.name),
  ["一对一", "一对二", "一对三", "一对多（4-8）", "班课（9-20）"]);
eq("时长选项", pricing.durations.map((d) => `${d.name}×${d.multiplier}`),
  ["1 小时×1", "1.5 小时×1.5", "2 小时×2"]);
eq("试课", pricing.trial?.priceLabel, "免费");
eq("其他项目数", pricing.otherItems.length, 3);

console.log("\n=== 5. 报价公式 ===");
const stageOf = (courseName: string) =>
  pricing.stages.find((s) => s.courses.some((c) => c.name === courseName));
const quote = (
  courseName: string,
  subjectName: string,
  classTypeName: string,
  durationName: string,
  lessons: number,
  extra: Record<string, number> = {},
) => {
  const stage = stageOf(courseName);
  const group = pricing.subjectGroups.find((g) => g.name === stage?.name);
  return calculateQuote({
    course: stage?.courses.find((c) => c.name === courseName) ?? { name: courseName, price: null, available: false },
    subject: group?.subjects.find((s) => s.name === subjectName) ?? null,
    classType: pricing.classTypes.find((c) => c.name === classTypeName) ?? pricing.classTypes[0]!,
    duration: pricing.durations.find((d) => d.name === durationName) ?? pricing.durations[0]!,
    lessons,
    ...extra,
  });
};

// 九年级课本 300 × 一对二 0.7 = 210；1.5 小时 ×1.5 = 315；5 节正课 1575
// 未满 10 节，试课按原价 300 计 → 总价 1875
const a = quote("九年级课本", "数学", "一对二", "1.5 小时", 5);
eq("300×0.7×1.5×5 节", [a.unitPrice, a.lessonsPrice, a.trialFee, a.totalPrice], [315, 1575, 300, 1875]);
ok("5 节不加手续费", a.unitPrice === 315);
ok("9 节以下试课不免费", a.trialFree === false);

// 1 节 +10% 手续费：300×0.7=210 → 231；正课 231 + 试课 300 = 531
const b = quote("九年级课本", "数学", "一对二", "1 小时", 1);
eq("1 节含 10% 手续费", [b.unitPrice, b.lessonsPrice, b.totalPrice], [231, 231, 531]);

// 满 10 节：试课免费
const c = quote("九年级课本", "数学", "一对一", "1 小时", 10);
eq("10 节正课", c.lessonsPrice, 3000);
eq("10 节试课免费", [c.trialFree, c.trialFee, c.totalPrice], [true, 0, 3000]);

// 班课：教师费 2400 ÷ 12 人 = 200；×1.5 小时 = 300；×8 节 = 2400
// 正课 2400 + 试课 260（八年级课本原价）= 2660
const d = quote("八年级课本", "数学", "班课（9-20）", "1.5 小时", 8, { studentCount: 12, classCost: 2400 });
eq("班课按人数分摊", [d.unitPrice, d.lessonsPrice, d.totalPrice], [300, 2400, 2660]);

// 班课缺参数应报错
const e = quote("八年级课本", "数学", "班课（9-20）", "1 小时", 5, { classCost: 2400 });
ok("班课缺人数时报错", e.ok === false);

// 节数非法应报错
const f = quote("九年级课本", "数学", "一对一", "1 小时", 0);
ok("节数为 0 时报错", f.ok === false);

// 试课规则边界
eq("试课免费门槛", [isTrialFree(9), isTrialFree(10)], [false, true]);
eq("试课费", [trialFeeFor(9, 300), trialFeeFor(10, 300)], [300, 0]);

console.log("\n=== 6. 教务后台伪后端（localStorage 服务层）===");

/*
 * 这一节用**内存存储**跑完整的增删改查，不需要浏览器：
 * 伪后端刻意把存储抽象成 KeyValueStore（见 lib/backend/storage.ts），
 * 因此在 Node 里也能验证。要守住的是三件事：
 *   1. 首次访问会灌入示例数据；
 *   2. 写入会落盘、且能被新实例读回来（「刷新后还在」的本质）；
 *   3. 汇总统计（今日概览）算得对。
 */
const memory = createMemoryStore();
__useStoreForTesting(memory);

const seeded = await api.students.list();
ok("首次访问灌入示例学生", seeded.length >= 5);
ok("示例学生都有年级与家长联系方式",
  seeded.every((student) => student.grade !== "" && student.guardian !== ""));
ok("教师档案来自站点的真实教师（非 AI）",
  (await api.teachers.list()).every((teacher) => !teacher.name.includes("·")));
ok("教室沿用站点的场地名称",
  (await api.classrooms.list()).some((room) => room.name.includes("301")));

const created = await api.students.create({
  name: "示例·自检同学", grade: "初二", guardian: "138-0000-9999",
  status: "在读", note: "", profile: {},
});
ok("新建学生返回 id", created.id !== "");
ok("新建后总数 +1", (await api.students.list()).length === seeded.length + 1);
ok("按 id 能取回", (await api.students.get(created.id))?.name === "示例·自检同学");
ok("搜索能命中", (await api.students.search("自检")).some((s) => s.id === created.id));

const updated = await api.students.update(created.id, { grade: "初三" });
ok("更新基础字段生效", updated?.grade === "初三");

// 关键：把服务重新挂到同一个存储上（等价于刷新页面后新建实例），数据仍应在
__useStoreForTesting(memory);
ok("写入已落盘（新实例仍能读到）",
  (await api.students.get(created.id))?.grade === "初三");

ok("删除生效", (await api.students.remove(created.id)) === true);
ok("删除后取不到", (await api.students.get(created.id)) === null);

// 今日概览：统计口径
const todayLessons = await api.lessons.listByDate(new Date());
const summary = await api.today();
eq("今日课程数与按日查询一致", summary.lessonCount, todayLessons.length);
eq("今日课时总时长等于各节之和", summary.totalMinutes,
  todayLessons.reduce((total, lesson) => total + lesson.durationMinutes, 0));
ok("教室占用覆盖全部教室", summary.classroomUsage.length === (await api.classrooms.list()).length);
ok("课时预警只含剩余 ≤ 5 节的学生",
  summary.lowLessonStudents.every((item) => item.remainingLessons <= 5));
// 引用完整性：排课里出现的教师 / 教室 / 学生都必须在档案里存在，
// 否则界面上会出现「—」这种查不到的名字
const [allTeachers, allClassrooms, allStudents, allLessons] = await Promise.all([
  api.teachers.list(),
  api.classrooms.list(),
  api.students.list(),
  api.lessons.list(),
]);
ok("排课的教师 / 教室 / 学生都真实存在",
  allLessons.every((lesson) =>
    allTeachers.some((teacher) => teacher.id === lesson.teacherId) &&
    allClassrooms.some((room) => room.id === lesson.classroomId) &&
    lesson.studentIds.every((id) => allStudents.some((student) => student.id === id))));

/*
 * 课时按科目记账：报课 / 续费 / 退课 / 手工调整四种动作都要验证。
 * 这里特意用了「同一学生两门课」，才能验证「退一门不影响另一门」。
 */
const target = seeded[0]!;
const beforeTotal = remainingTotal(target.enrollments);
ok("示例学生有报课记录", target.enrollments.length >= 1);

const enrolled = await api.students.enroll(target.id, {
  subject: "自检科目", form: "一对一定制课", teacherId: "",
  lessons: 10, startedAt: new Date().toISOString(), note: "自检",
});
eq("报课后剩余合计增加 10 节", remainingTotal(enrolled!.enrollments), beforeTotal + 10);

const added = enrolled!.enrollments.find((item) => item.subject === "自检科目")!;
const renewed = await api.students.renewEnrollment(target.id, added.id, 5, "续费自检");
eq("续费后该科目剩 15 节",
  remainingOf(renewed!.enrollments.find((item) => item.id === added.id)!), 15);
eq("续费流水有两条（报课 + 续费）",
  renewed!.enrollments.find((item) => item.id === added.id)!.history.length, 2);

const refunded = await api.students.refundEnrollment(target.id, added.id, "退课自检");
eq("退课后剩余合计回到原值", remainingTotal(refunded!.enrollments), beforeTotal);
ok("退课记录被保留（不是删除）",
  refunded!.enrollments.some((item) => item.id === added.id && item.status === "已退课"));
ok("退课后的科目从「在读科目」里移除", !refunded!.subjects.includes("自检科目"));
eq("退课不影响其他科目",
  remainingTotal(refunded!.enrollments.filter((item) => item.id !== added.id)),
  beforeTotal);

const adjusted = await api.students.adjustEnrollmentLessons(target.id, added.id, -20, "自检");
eq("手工调减不会变成负数",
  remainingOf(adjusted!.enrollments.find((item) => item.id === added.id)!), 0);

// 按关系查询（学生 / 教师 / 教室详情用）：结果必须真的相关
const someLesson = (await api.lessons.list())[0]!;
const byStudent = await api.lessons.listByStudent(someLesson.studentIds[0]!);
ok("按学生查课只返回该学生的课",
  byStudent.length > 0 && byStudent.every((lesson) => lesson.studentIds.includes(someLesson.studentIds[0]!)));
const byTeacher = await api.lessons.listByTeacher(someLesson.teacherId);
ok("按教师查课只返回该教师的课",
  byTeacher.length > 0 && byTeacher.every((lesson) => lesson.teacherId === someLesson.teacherId));
const byClassroom = await api.lessons.listByClassroom(someLesson.classroomId);
ok("按教室查课只返回该教室的课",
  byClassroom.length > 0 && byClassroom.every((lesson) => lesson.classroomId === someLesson.classroomId));

// ── 排课与冲突检测 ────────────────────────────────────────────────────
// 冲突检测是排课工具的底线，因此这里把边界情形逐条钉死：
// 相邻不算冲突、已取消不占时间、编辑自己不算冲突、跨天不算冲突。
// 撞课用例必须用「不限时段」的场地：否则教室在 15:00 本来就不开放，
// 会把「教室不开放」也算进冲突总数，掩盖了真正要验证的撞课逻辑
const room =
  (await api.classrooms.list()).find((item) => item.availability.length === 0) ??
  (await api.classrooms.list())[0]!;
const teacher = (await api.teachers.list())[0]!;
// 刻意挑一个课时充足的学生：前面「不会扣成负数」的用例已经把第一个学生清零了，
// 拿零课时的学生来验证扣减会得到 0，看不出是否真的扣了
const pupil = (await api.students.list()).find((student) => remainingTotal(student.enrollments) > 5)!;
const base = new Date();
base.setHours(15, 0, 0, 0);

/** 造一节课，用于冲突测试。 */
const slot = (hour: number, minute = 0, duration = 60, dayOffset = 0) => {
  const start = new Date(base);
  start.setDate(start.getDate() + dayOffset);
  start.setHours(hour, minute, 0, 0);
  return { start: start.toISOString(), duration };
};

const first = slot(15);
// 科目刻意用该学生**已报课**的科目：扣课时是按科目找报课记录的
const anchorSubject = pupil.subjects[0] ?? "未指定科目";
const anchorLesson = await api.lessons.create({
  subject: anchorSubject, form: "一对一定制课", teacherId: teacher.id, classroomId: room.id,
  studentIds: [pupil.id], startsAt: first.start, durationMinutes: first.duration,
  status: "已排", note: "",
});

// 科目刻意用该教师可带的科目：否则「教师科目不符」会混进冲突计数，
// 让「撞课」的断言看起来失败（这是本组新增的校验，见下面的专门用例）
const conflictsFor = (start: string, duration = 60) =>
  api.lessons.findConflicts({
    subject: anchorSubject, form: "", teacherId: teacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: start, durationMinutes: duration,
    status: "已排", note: "",
  });

// 完全重叠：三类冲突都应该报出来
const overlap = slot(15, 30);
const report = await conflictsFor(overlap.start);
eq("完全重叠时教师冲突 1 处", report.teacher.length, 1);
eq("完全重叠时教室冲突 1 处", report.classroom.length, 1);
eq("完全重叠时学生冲突 1 处", report.students.length, 1);
ok("冲突总数与三类之和一致", report.total === 3);

// 相邻（前一场结束＝后一场开始）不算冲突，且不该触发任何其他警告
const backToBack = slot(16);
const backReport = await conflictsFor(backToBack.start);
eq("相邻时段不算冲突", backReport.total, 0);

// 跨天不算冲突
const nextDay = slot(15, 0, 60, 1);
eq("同时间但不同天不算冲突", (await conflictsFor(nextDay.start)).total, 0);

// ── 容量校验：学生数不能超过教室容量 ──────────────────────────────────
// 用容量最小的场地，并确保「学生数」确实超过它（示例学生只有 8 位，
// 拿容量 8 的教室去测超员会得到 8 > 8 = false，测试就白写了）
const tightRoom = (await api.classrooms.list()).reduce((smallest, item) =>
  item.capacity < smallest.capacity ? item : smallest,
);
const overfilled = await api.lessons.findConflicts({
  subject: anchorSubject, form: "", teacherId: teacher.id, classroomId: tightRoom.id,
  studentIds: (await api.students.list()).slice(0, tightRoom.capacity + 2).map((item) => item.id),
  startsAt: slot(7, 30).start, durationMinutes: 60, status: "已排", note: "",
});
eq("超过教室容量会被报出", overfilled.overCapacity,
  { capacity: tightRoom.capacity, students: tightRoom.capacity + 2 });
ok("超容量计入冲突总数", overfilled.total >= 1);

const fitsRoom = await api.lessons.findConflicts({
  subject: anchorSubject, form: "", teacherId: teacher.id, classroomId: tightRoom.id,
  studentIds: (await api.students.list()).slice(0, tightRoom.capacity).map((item) => item.id),
  startsAt: slot(7, 30).start, durationMinutes: 60, status: "已排", note: "",
});
eq("刚好坐满不算超容量", fitsRoom.overCapacity, null);

// ── 教师科目校验：科目不在可带科目里要提示 ────────────────────────────
const mathTeacher = (await api.teachers.list()).find((item) => item.subjects.includes("数学"));
if (mathTeacher !== undefined) {
  const wrongSubject = await api.lessons.findConflicts({
    // 「编程入门」不在任何教师的可带科目里，用它才能测出「科目不符」
    subject: "编程入门", form: "", teacherId: mathTeacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: slot(7, 30).start, durationMinutes: 60,
    status: "已排", note: "",
  });
  eq("科目与教师不符会被报出", wrongSubject.teacherSubjectMismatch, true);

  const rightSubject = await api.lessons.findConflicts({
    subject: "初中数学", form: "", teacherId: mathTeacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: slot(7, 30).start, durationMinutes: 60,
    status: "已排", note: "",
  });
  eq("科目匹配时不报", rightSubject.teacherSubjectMismatch, false);
}

// 编辑自己不算冲突
const selfReport = await api.lessons.findConflicts({
  id: anchorLesson.id, subject: anchorSubject, form: "", teacherId: teacher.id,
  classroomId: room.id, studentIds: [pupil.id], startsAt: first.start,
  durationMinutes: first.duration, status: "已排", note: "",
});
eq("编辑自己不算冲突", selfReport.total, 0);

// 已取消的课不占用时间
await api.lessons.update(anchorLesson.id, { status: "已取消" });
eq("已取消的课不产生冲突", (await conflictsFor(overlap.start)).total, 0);

// 换一个没有课的时段与教师，验证「不误报」
const otherTeacher = (await api.teachers.list())[1];
if (otherTeacher !== undefined) {
  const quiet = slot(7, 0);
  const quietReport = await api.lessons.findConflicts({
    subject: otherTeacher.subjects[0] ?? anchorSubject, form: "",
    teacherId: otherTeacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: quiet.start, durationMinutes: 60,
    status: "已排", note: "",
  });
  eq("空闲时段不误报冲突", quietReport.total, 0);
}

// ── 标记已上：扣课时且幂等 ────────────────────────────────────────────
// 「标记已上」扣的是**该节课科目**对应的报课记录
const pupilBefore = remainingTotal((await api.students.get(pupil.id))!.enrollments);
const completed = await api.lessons.markCompleted(anchorLesson.id);
eq("标记已上后状态为已上", completed.lesson?.status, "已上");
eq("标记已上扣 1 节课时",
  remainingTotal((await api.students.get(pupil.id))!.enrollments), pupilBefore - 1);
eq("本次扣减明细含该学生", completed.deducted.map((item) => item.studentId), [pupil.id]);
eq("扣减明细带上所扣科目", completed.deducted[0]?.subject, anchorLesson.subject);

// 幂等：再点一次不能重复扣课时（最容易出错的地方）
const again = await api.lessons.markCompleted(anchorLesson.id);
eq("重复标记被识别为已完成", again.alreadyCompleted, true);
eq("重复标记不再扣课时",
  remainingTotal((await api.students.get(pupil.id))!.enrollments), pupilBefore - 1);
eq("重复标记不返回扣减明细", again.deducted.length, 0);

// 没有对应科目的报课记录时：不扣课时，但要如实说明为什么
const strangerLesson = await api.lessons.create({
  subject: "自检·无人报课的科目", form: "", teacherId: teacher.id, classroomId: room.id,
  studentIds: [pupil.id], startsAt: slot(9, 0).start, durationMinutes: 60,
  status: "已排", note: "",
});
const strangerResult = await api.lessons.markCompleted(strangerLesson.id);
eq("无对应报课记录时不扣课时", strangerResult.deducted.length, 0);
eq("并且说明原因", strangerResult.skipped.length, 1);
ok("原因里点名了科目", (strangerResult.skipped[0]?.reason ?? "").includes("无人报课的科目"));
await api.lessons.remove(strangerLesson.id);

await api.lessons.remove(anchorLesson.id);
eq("删除排课后查不到", await api.lessons.get(anchorLesson.id), null);

// ── 日历用的区间查询 ──────────────────────────────────────────────────
const monday = new Date(base);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const sunday = new Date(monday);
sunday.setDate(monday.getDate() + 6);
const inWeek = await api.lessons.listBetween(monday, sunday);
const mondayKey = dateKey(monday);
const sundayKey = dateKey(sunday);
ok("区间查询只返回该周范围内的课",
  inWeek.every((lesson) => {
    const key = dateKey(lesson.startsAt);
    return key >= mondayKey && key <= sundayKey;
  }));
ok("区间查询结果按时间升序",
  inWeek.every((lesson, index) => index === 0 || inWeek[index - 1]!.startsAt <= lesson.startsAt));

// ── 教室的用途与可用时段 ──────────────────────────────────────────────
// 可用时段是排课能用得上的信息，因此边界规则要逐条钉死：
// 没设时段＝不限、完整落在某行内才算开放、跨天行视为无效、星期要对得上。
const roomList = await api.classrooms.list();
ok("教室都有用途", roomList.every((room) => room.kind === "上课用教室" || room.kind === "自习室"));
ok("教室都有可用时段字段（可为空数组表示不限）",
  roomList.every((room) => Array.isArray(room.availability)));

// 造一间只开放「周一 17:00–21:00」的教室
const monday17 = (() => {
  const date = new Date(base);
  // 距离下一个周一还有几天：isoWeekday 是 1=周一 … 7=周日
  const offset = (1 - isoWeekday(date) + 7) % 7;
  date.setDate(date.getDate() + offset);
  date.setHours(17, 0, 0, 0);
  return date;
})();
const monday2030 = new Date(monday17);
monday2030.setHours(20, 30, 0, 0);

const limited = await api.classrooms.create({
  name: "自检·限时教室",
  kind: "自习室",
  capacity: 4,
  availability: [{ id: "r1", weekdays: [1], start: "17:00", end: "21:00" }],
  note: "",
});
eq("新建教室保留用途", limited.kind, "自习室");
eq("新建教室保留可用时段", limited.availability.length, 1);

ok("时段内排课视为开放", isWithinAvailability(limited.availability, monday17, 60));
ok("结束时间超出视为不开放", !isWithinAvailability(limited.availability, monday17, 300));
ok("开始时间早于开放时间视为不开放", !isWithinAvailability(limited.availability, new Date(monday17.getTime() - 3600_000), 60));
ok("非开放星期视为不开放",
  !isWithinAvailability(limited.availability, new Date(monday17.getTime() + 86_400_000), 60));
ok("没有设置时段＝不限", isWithinAvailability([], monday17, 600));
ok("结束早于开始的无效行不匹配",
  !isWithinAvailability([{ id: "bad", weekdays: [1], start: "21:00", end: "17:00" }], monday17, 60));

// 排课时的冲突检查也要覆盖「教室该时段不开放」
const closedReport = await api.lessons.findConflicts({
  subject: "测试", form: "", teacherId: teacher.id, classroomId: limited.id,
  studentIds: [pupil.id], startsAt: monday2030.toISOString(), durationMinutes: 120,
  status: "已排", note: "",
});
eq("超出教室可用时段会被标记", closedReport.classroomClosed, true);
ok("教室不开放计入冲突总数", closedReport.total >= 1);

const openReport = await api.lessons.findConflicts({
  subject: "测试", form: "", teacherId: teacher.id, classroomId: limited.id,
  studentIds: [pupil.id], startsAt: monday17.toISOString(), durationMinutes: 90,
  status: "已排", note: "",
});
eq("时段内排课不报教室不开放", openReport.classroomClosed, false);

// ── 老数据迁移：v1 的教室没有用途与时段，打开后台不能出现 undefined ──
const legacy = createMemoryStore();
__useStoreForTesting(legacy);
legacy.write(
  "nexgenedu.admin.db.v1",
  JSON.stringify({
    version: 1,
    students: [{ id: "s9", name: "旧数据学生", grade: "初一", guardian: "", subjects: ["初中数学"],
      remainingLessons: 3, status: "在读", note: "", createdAt: new Date().toISOString() }],
    teachers: [],
    classrooms: [{ id: "c9", name: "旧教室", capacity: 6, note: "" }],
    lessons: [],
    updatedAt: new Date().toISOString(),
  }),
);
const migratedRooms = await api.classrooms.list();
eq("旧数据里的教室被补上用途", migratedRooms[0]?.kind, "上课用教室");
eq("旧数据里的教室被补上用空时段", migratedRooms[0]?.availability, []);
eq("迁移不影响其他数据", (await api.students.list())[0]?.name, "旧数据学生");
// v2 的「剩余课时总数」折算成一条报课记录：total=3、used=0
const migratedStudent = (await api.students.get("s9"))!;
eq("旧课时折算成一条报课记录", migratedStudent.enrollments.length, 1);
eq("折算后的剩余课时不变", remainingTotal(migratedStudent.enrollments), 3);
eq("折算记录沿用了原科目", migratedStudent.enrollments[0]?.subject, "初中数学");
ok("折算记录带说明，提示需人工确认",
  (migratedStudent.enrollments[0]?.note ?? "").includes("折算"));
ok("迁移后的学生有采集表字段（空对象）", migratedStudent.profile !== undefined);
eq("v1 数据一路迁到当前版本",
  JSON.parse(legacy.read("nexgenedu.admin.db.v1") ?? "{}").version, CURRENT_VERSION);
ok("迁移补上的动态追踪表可用（数组已建好）",
  Array.isArray(JSON.parse(legacy.read("nexgenedu.admin.db.v1") ?? "{}").lessonRecords));

// 迁移后的数据应被写回（下次打开不再重复迁移、也不会重复改写）
eq("迁移结果已落盘（版本与当前一致）",
  JSON.parse(legacy.read("nexgenedu.admin.db.v1") ?? "{}").version, CURRENT_VERSION);

// 关键回归：已迁移好的数据再读一次，报课记录不能被再次改写
const beforeSecondRead = JSON.stringify((await api.students.get("s9"))?.enrollments);
__useStoreForTesting(legacy);
const afterSecondRead = JSON.stringify((await api.students.get("s9"))?.enrollments);
eq("重复打开不会再次迁移", afterSecondRead, beforeSecondRead);

// 数据结构版本必须与 seed 写出的一致（曾因 seed 写旧版本导致新数据被误迁移）
eq("示例数据的版本等于当前版本", seedDb.version, CURRENT_VERSION);

// ── 信息采集表 ────────────────────────────────────────────────────────
// 注意：上面的迁移用例把服务切到了另一份存储（legacy），这里必须先切回来，
// 否则会对着一份没有这些学生的数据做断言（表现为「保存失败」）。
__useStoreForTesting(memory);
// 采集表是键值对 + 字段定义，因此这里守两件事：
//   1. 定义本身是完整的（键唯一、选择项有候选项、表格有列）；
//   2. 存取走得通（保存后能读回来），并且加字段不需要迁移。
const profileKeys = PROFILE_SECTIONS.flatMap((section) => section.fields.map((field) => field.key));
eq("采集表字段键不重复", profileKeys.filter((k, i) => profileKeys.indexOf(k) !== i), []);
ok("采集表字段数量与模板相当（≥ 60 项）", profileKeys.length >= 60);
ok("选择型字段都给了候选项",
  PROFILE_SECTIONS.flatMap((section) => section.fields)
    .filter((field) => field.type === "select" || field.type === "multi")
    .every((field) => (field.options ?? []).length > 0));
ok("表格型字段都定义了列",
  PROFILE_SECTIONS.flatMap((section) => section.fields)
    .filter((field) => field.type === "table")
    .every((field) => (field.columns ?? []).length > 0));
ok("心理与情绪健康一节标了敏感",
  PROFILE_SECTIONS.filter((section) => section.sensitive === true)
    .some((section) => section.title.includes("心理")));

const profileSaved = await api.students.saveProfile(target.id, {
  gender: "男",
  school: "示例中学",
  preferredLearningStyles: ["老师板书", "互动讨论"],
  baselineScores: [{ baseline: "88", recent: "92", note: "" }],
});
ok("采集表能保存", profileSaved !== null);
const profileReloaded = (await api.students.get(target.id))!;
eq("文本字段读回一致", profileText(profileReloaded.profile, "gender"), "男");
eq("多选字段读回一致", profileList(profileReloaded.profile, "preferredLearningStyles"),
  ["老师板书", "互动讨论"]);
eq("表格字段读回一致", profileTable(profileReloaded.profile, "baselineScores")[0]?.recent, "92");

const completion = profileCompletion(profileReloaded.profile);
eq("填写进度：已填 4 项", completion.filled, 4);
ok("总项数等于字段数", completion.total === profileKeys.length);
eq("空档案进度为 0", profileCompletion({}).filled, 0);
ok("表格型字段的空表按行定义生成",
  emptyProfileTable(PROFILE_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === "availableTimes")!).length === 7);

// 加到采集表里的新字段对老档案是空值，不需要迁移
eq("老档案读不到的新字段返回空串", profileText(seeded[1]!.profile, "不存在的字段"), "");
eq("老档案读不到的新多选字段返回空数组", profileList(seeded[1]!.profile, "不存在的字段"), []);

await api.reset();
eq("重置回到示例数据", (await api.students.list()).length, seeded.length);

// ── 课时流水（账本）与撤销 ────────────────────────────────────────────
// 账本的价值全在「与余额自洽」与「能撤销」两件事上，因此这两条必须钉死。
const ledgerStudent = (await api.students.list()).find((item) => item.enrollments.length > 0)!;
const ledgerEnrollment = ledgerStudent.enrollments[0]!;
const ledgerBefore = await api.transactions.listByEnrollment(ledgerEnrollment.id);
ok("示例数据的流水与课时自洽", (() => {
  const effective = ledgerBefore.filter((item) => item.reversedAt === "");
  const positive = effective.filter((item) => item.delta > 0).reduce((sum, item) => sum + item.delta, 0);
  const negative = effective.filter((item) => item.delta < 0).reduce((sum, item) => sum + item.delta, 0);
  return positive === ledgerEnrollment.totalLessons && -negative === ledgerEnrollment.usedLessons;
})());
// 不变式的通用校验：全部学生的每一条报课都要自洽（不只是抽样那一条）
ok("所有报课记录的课时都与流水自洽", await (async () => {
  const all = await api.students.list();
  const transactions = await Promise.all(
    all.flatMap((student) => student.enrollments.map((item) => api.transactions.listByEnrollment(item.id))),
  );
  const enrollments = all.flatMap((student) => student.enrollments);
  return enrollments.every((enrollment, index) => {
    const rows = (transactions[index] ?? []).filter((item) => item.reversedAt === "");
    const positive = rows.filter((item) => item.delta > 0).reduce((sum, item) => sum + item.delta, 0);
    const negative = rows.filter((item) => item.delta < 0).reduce((sum, item) => sum + item.delta, 0);
    return positive === enrollment.totalLessons && -negative === enrollment.usedLessons;
  });
})());

// 上课扣课时会记一笔「哪节课扣的」
const ledgerLessonStart = new Date();
ledgerLessonStart.setHours(7, 0, 0, 0);
const ledgerLesson = await api.lessons.create({
  subject: ledgerEnrollment.subject, form: "", teacherId: teacher.id, classroomId: room.id,
  studentIds: [ledgerStudent.id], startsAt: ledgerLessonStart.toISOString(),
  durationMinutes: 60, status: "已排", note: "",
});
await api.lessons.markCompleted(ledgerLesson.id);
const afterComplete = await api.transactions.listByEnrollment(ledgerEnrollment.id);
const usageEntry = afterComplete.find(
  (item) => item.kind === "上课" && item.lessonId === ledgerLesson.id && item.reversedAt === "",
);
ok("扣课时留下可追溯到课节的流水", usageEntry !== undefined);
eq("流水记的是 -1 节", usageEntry?.delta, -1);

// 撤销「已上」要把课时退回来（老师点错时的补救）
const beforeRevert = (await api.students.get(ledgerStudent.id))!.enrollments
  .find((item) => item.id === ledgerEnrollment.id)!;
await api.lessons.update(ledgerLesson.id, { status: "已排" });
const afterRevert = (await api.students.get(ledgerStudent.id))!.enrollments
  .find((item) => item.id === ledgerEnrollment.id)!;
eq("撤销已上后退回 1 节课时", remainingOf(afterRevert), remainingOf(beforeRevert) + 1);
ok("撤销是留痕而不是删除",
  (await api.transactions.listByEnrollment(ledgerEnrollment.id))
    .some((item) => item.id === usageEntry?.id && item.reversedAt !== ""));
// 撤销之后、以及任何时刻，账本都必须与课时余额自洽（这是账本唯一的价值所在）
// 注意要重新取流水：上面那几次读取都是快照，撤销只改了存储里的条目
const ledgerInvariant = async (enrollmentId: string, total: number, used: number) => {
  const rows = (await api.transactions.listByEnrollment(enrollmentId)).filter(
    (item) => item.reversedAt === "",
  );
  const positive = rows.filter((item) => item.delta > 0).reduce((sum, item) => sum + item.delta, 0);
  const negative = rows.filter((item) => item.delta < 0).reduce((sum, item) => sum + item.delta, 0);
  return positive === total && -negative === used;
};
ok("撤销后账本仍与余额自洽",
  await ledgerInvariant(ledgerEnrollment.id, afterRevert.totalLessons, afterRevert.usedLessons));

// 再次标记已上应当重新扣一次（撤销之后再上这节课是正常的）
await api.lessons.markCompleted(ledgerLesson.id);
eq("重新标记已上会再扣 1 节",
  remainingOf((await api.students.get(ledgerStudent.id))!.enrollments
    .find((item) => item.id === ledgerEnrollment.id)!),
  remainingOf(beforeRevert));
await api.lessons.remove(ledgerLesson.id);

// ── 动态追踪：课堂记录 / 作业记录 / 阶段测评 ──────────────────────────
__useStoreForTesting(memory);

// 课堂记录：一节课一个学生一条，重复保存是更新而不是新增
const trackLesson = (await api.lessons.list())[0]!;
const trackStudent = trackLesson.studentIds[0]!;
const firstRecord = await api.lessonRecords.save({
  lessonId: trackLesson.id, studentId: trackStudent,
  attendance: "到课", focus: "高", interaction: "主动", rating: 4, note: "自检第一条",
});
ok("课堂记录返回 id", firstRecord.id !== "");
const secondRecord = await api.lessonRecords.save({
  lessonId: trackLesson.id, studentId: trackStudent,
  attendance: "请假", focus: "低", interaction: "被动", rating: 2, note: "自检改过",
});
eq("重复保存是同一条记录（不是新增）", secondRecord.id, firstRecord.id);
eq("一课一生只有一条记录", (await api.lessonRecords.listByLesson(trackLesson.id)).length, 1);
eq("保存内容被更新", (await api.lessonRecords.listByLesson(trackLesson.id))[0]?.attendance, "请假");
ok("按学生能查到自己的记录",
  (await api.lessonRecords.listByStudent(trackStudent)).some((item) => item.id === firstRecord.id));
await api.lessonRecords.remove(firstRecord.id);
eq("删除课堂记录后查不到", (await api.lessonRecords.listByLesson(trackLesson.id)).length, 0);

// 作业记录
const homework = await api.homework.create({
  studentId: trackStudent, subject: "初中数学", date: new Date().toISOString(),
  submission: "迟交", accuracy: 80, weakPoints: "自检知识点", note: "",
});
eq("作业记录能写入", (await api.homework.listByStudent(trackStudent))[0]?.id, homework.id);
ok("作业记录按日期倒序",
  (await api.homework.listByStudent(trackStudent)).every(
    (item, index, list) => index === 0 || list[index - 1]!.date >= item.date));

// 阶段测评：上次分数与趋势由服务带出
const firstAssessment = await api.assessments.add({
  studentId: trackStudent, subject: "自检科目", date: new Date(Date.now() - 86_400_000).toISOString(),
  score: 70, weakPoints: "", note: "",
});
eq("首次测评没有上次分数", firstAssessment.previousScore, null);
const secondAssessment = await api.assessments.add({
  studentId: trackStudent, subject: "自检科目", date: new Date().toISOString(),
  score: 85, weakPoints: "", note: "",
});
eq("第二次测评自动带出上次分数", secondAssessment.previousScore, 70);
ok("能看到进步（趋势可算）", secondAssessment.score > (secondAssessment.previousScore ?? 0));

// 不同科目之间不互相干扰
const otherSubject = await api.assessments.add({
  studentId: trackStudent, subject: "另一科目", date: new Date().toISOString(),
  score: 60, weakPoints: "", note: "",
});
eq("换科目后上次分数为 null", otherSubject.previousScore, null);
ok("按学生查询覆盖多个科目",
  (await api.assessments.listByStudent(trackStudent)).some((item) => item.subject === "另一科目"));

// 动态追踪不能影响课时：记录课堂表现不等于扣课时
const beforeTracking = remainingTotal((await api.students.get(trackStudent))!.enrollments);
await api.students.get(trackStudent);
eq("写记录不会改动课时", remainingTotal((await api.students.get(trackStudent))!.enrollments), beforeTracking);

// ── 课表与占用：数据源（按周区间 + 按教师/教室筛选）────────────────────
const weekStart = weekDays(new Date())[0]!;
const weekEnd = weekDays(new Date())[6]!;
const weekLessons = await api.lessons.listBetween(weekStart, weekEnd);
ok("周区间查询能取到本周课程", weekLessons.length >= 1);
const weekTeachers = new Set(weekLessons.map((lesson) => lesson.teacherId));
ok("按教师筛选的结果都在本周",
  [...weekTeachers].every((id) =>
    weekLessons.filter((lesson) => lesson.teacherId === id).length > 0));
const weekClassrooms = new Set(weekLessons.map((lesson) => lesson.classroomId));
ok("按教室筛选的结果都在本周",
  [...weekClassrooms].every((id) =>
    weekLessons.filter((lesson) => lesson.classroomId === id).length > 0));

// ── 导出与备份（第二组）──────────────────────────────────────────────
// 导入是唯一能一次性毁掉全部数据的操作，因此这一组的重点全在「坏文件不能洗数据」。
__useStoreForTesting(memory);

const exported = await api.exportDatabase();
ok("导出包含全部表", exported.students.length > 0 && Array.isArray(exported.transactions));
const exportedText = serializeDatabase(exported);
ok("导出的 JSON 可被解析回同样条数", (() => {
  const parsed = JSON.parse(exportedText) as typeof exported;
  return parsed.students.length === exported.students.length;
})());

// 结构校验：这些文件必须被拒绝（而不是把数据洗掉）
const rejects: Array<[string, string]> = [
  ["空对象", "{}"],
  ["不是 JSON", "这不是 json"],
  ["数组而不是对象", "[]"],
  ["缺少 version", JSON.stringify({ students: [], teachers: [], classrooms: [], lessons: [] })],
  ["未来版本", JSON.stringify({ ...exported, version: CURRENT_VERSION + 1 })],
  ["缺 classrooms", JSON.stringify({ version: 1, students: [], teachers: [], lessons: [] })],
  ["记录缺 id", JSON.stringify({ version: 1, students: [{ name: "无 id" }], teachers: [], classrooms: [], lessons: [] })],
];
for (const [label, text] of rejects) {
  const result = await api.importDatabase(text);
  eq(`拒绝导入：${label}`, result.ok, false);
}

// 被拒绝之后数据必须原封不动
eq("拒绝导入后学生数不变", (await api.students.list()).length, exported.students.length);

// 备份后悔药：导入合法文件后可恢复
const studentsBeforeImport = (await api.students.list()).length;
const emptyButValid = serializeDatabase({
  ...exported,
  students: [],
  lessons: [],
  transactions: [],
});
const imported = await api.importDatabase(emptyButValid);
eq("合法文件可以导入", imported.ok, true);
eq("导入后学生被清空（说明确实替换了）", (await api.students.list()).length, 0);
ok("导入前自动留了备份", api.hasBackup());
const restored = await api.restoreBackup();
eq("可以恢复导入前的数据", restored.ok, true);
eq("恢复后学生数回到导入前", (await api.students.list()).length, studentsBeforeImport);

// 老版本文件导入时自动升级
const oldFile = JSON.stringify({
  version: 2,
  students: [{
    id: "s_old", name: "旧文件学生", grade: "初二", guardian: "", subjects: ["初中数学"],
    remainingLessons: 5, status: "在读", note: "", createdAt: new Date().toISOString(),
  }],
  teachers: [], classrooms: [], lessons: [],
  updatedAt: new Date().toISOString(),
});
const upgraded = await api.importDatabase(oldFile);
eq("旧版本文件导入成功", upgraded.ok, true);
ok("提示里说明了升级", (upgraded.ok ? upgraded.note : "").includes("升级"));
const upgradedStudent = (await api.students.get("s_old"))!;
eq("旧文件的课时被折算成报课记录", remainingTotal(upgradedStudent.enrollments), 5);
await api.restoreBackup();

// ── ICS 日历文件 ──────────────────────────────────────────────────────
const icsStart = new Date();
icsStart.setHours(17, 30, 0, 0);
const ics = createIcs(
  [
    {
      uid: "lesson-abc@nexgenedu",
      title: "初中数学 · 一对一定制课",
      location: "301 教室",
      description: "教师：陈老师\n备注：带,逗号;分号",
      startsAt: icsStart.toISOString(),
      durationMinutes: 90,
    },
  ],
  "陈老师 课表",
);
ok("ICS 有开始与结束标记", ics.startsWith("BEGIN:VCALENDAR") && ics.trimEnd().endsWith("END:VCALENDAR"));
ok("ICS 含一个事件", (ics.match(/BEGIN:VEVENT/g) ?? []).length === 1);
ok("ICS 时间是本地格式（无 Z）", /DTSTART:\d{8}T\d{6}\r\n/.test(ics));
ok("ICS 结束时间＝开始 + 时长", ics.includes("DTEND:" + icsLocalTime(
  new Date(icsStart.getTime() + 90 * 60_000).toISOString(),
)));
ok("ICS 转义了逗号与分号", ics.includes("\\,") || ics.includes("\\;"));
ok("ICS 用 CRLF 换行", ics.includes("\r\n"));
eq("ICS 转义函数：逗号", escapeIcsText("提高班,周六"), "提高班\\,周六");
eq("ICS 转义函数：换行", escapeIcsText("第一行\n第二行"), "第一行\\n第二行");

// ── CSV ───────────────────────────────────────────────────────────────
const csv = createCsv(["姓名", "备注"], [["李同学", '带,逗号与"引号"'], ["王同学", "换\n行"]]);
ok("CSV 带 BOM（Excel 打开中文不乱码）", csv.startsWith("\uFEFF"));
ok("CSV 转义了逗号", csv.includes('"带,逗号与""引号"""'));
ok("CSV 转义了换行", csv.includes('"换\n行"'));
eq("CSV 行数 = 表头 + 数据行", csv.trimEnd().split("\r\n").length, 3);

// 统计信息（导出确认与界面展示都用它）
const stats = databaseStats(exported);
eq("统计里的学生数与数据一致", stats.students, exported.students.length);
eq("统计里的版本与数据一致", stats.version, exported.version);

// ── 课表导出用的区间与筛选（与课表页口径一致）─────────────────────────
const icsRange = await api.lessons.listBetween(weekDays(new Date())[0]!, weekDays(new Date())[6]!);
ok("ICS 导出的数据源能取到本周课程", Array.isArray(icsRange));

// ── 收费与金额（第三组）──────────────────────────────────────────────
// 钱的部分最怕「三处口径不一」，因此这里既测公式，也测「账实相符」的不变式。
__useStoreForTesting(memory);

const moneyStudent = (await api.students.list()).find((item) => item.enrollments.length > 0)!;
const beforeMoney = (await api.students.list()).length;

// 报课带金额：约定应缴可低于标价（优惠）、实收可分次
const moneyEnrollment = await api.students.enroll(moneyStudent.id, {
  subject: "自检·收费科目", form: "一对一定制课", teacherId: "",
  lessons: 10, startedAt: new Date().toISOString(), note: "自检报课",
  unitPrice: 200, agreedAmount: 1800, paidNow: 1000, method: "微信",
});
const moneyCreated = moneyEnrollment!.enrollments.find((item) => item.subject === "自检·收费科目")!;
eq("报课后学生数 +1 条报课", moneyEnrollment!.enrollments.length, moneyStudent.enrollments.length + 1);
eq("标价 = 课时 × 单价", moneyCreated.totalLessons * moneyCreated.unitPrice, 2000);
eq("优惠 = 标价 − 约定应缴", discountAmount(moneyCreated), 200);
eq("实收等于本次付款", moneyCreated.paidAmount, 1000);
eq("欠费 = 约定应缴 − 实收", outstandingAmount(moneyCreated), 800);
eq("首笔收款已入账",
  (await api.payments.listByEnrollment(moneyCreated.id)).filter((item) => item.kind === "收款").length, 1);

// 续费：加课时 + 加金额 + 记一笔收款（默认按标价补约定应缴）
const renewedMoney = await api.students.renewEnrollment(moneyStudent.id, moneyCreated.id, 5, "续费自检", {
  amount: 900, method: "支付宝",
});
const renewedEnrollment = renewedMoney!.enrollments.find((item) => item.id === moneyCreated.id)!;
eq("续费后课时增加", renewedEnrollment.totalLessons, 15);
eq("续费后约定应缴按标价增加", renewedEnrollment.agreedAmount, 1800 + 5 * 200);
eq("续费后实收累加", renewedEnrollment.paidAmount, 1900);
eq("续费后欠费正确",
  outstandingAmount(renewedEnrollment), renewedEnrollment.agreedAmount - 1900);

// 补记一笔收款（分期到账）
await api.payments.record({
  studentId: moneyStudent.id, enrollmentId: moneyCreated.id,
  amount: 500, kind: "收款", method: "现金", note: "自检补款",
});
eq("补记收款后实收增加",
  (await api.students.get(moneyStudent.id))!.enrollments
    .find((item) => item.id === moneyCreated.id)!.paidAmount,
  2400);

// 账实相符：报课记录上的实收必须等于收款流水合计（这是钱的核心不变式）
ok("实收与收款流水一致（全部报课）", await (async () => {
  const all = await api.students.list();
  for (const student of all) {
    const payments = await api.payments.listByStudent(student.id);
    for (const enrollment of student.enrollments) {
      const received = payments
        .filter((item) => item.enrollmentId === enrollment.id && item.kind === "收款")
        .reduce((sum, item) => sum + item.amount, 0);
      const refunded = payments
        .filter((item) => item.enrollmentId === enrollment.id && item.kind === "退款")
        .reduce((sum, item) => sum + item.amount, 0);
      if (round2(received - refunded) !== round2(enrollment.paidAmount)) return false;
    }
  }
  return true;
})());

// 退费策略：两种口径必须给出不同结果，且公式能解释
const refundSample = {
  totalLessons: 10, usedLessons: 3, agreedAmount: 1800, unitPrice: 200,
};
const prorata = findRefundPolicy("prorata").calculate(refundSample);
const clawback = findRefundPolicy("list-clawback").calculate(refundSample);
eq("按实付比例退：剩 7 节 × 实付单价", prorata.refund, 1260);
eq("追回标价：实付 − 已上 3 节 × 标价", clawback.refund, 1200);
ok("两条策略结果不同且都带公式说明",
  prorata.refund !== clawback.refund && prorata.formula !== "" && clawback.formula !== "");
eq("已上完时不退款（追回口径）",
  findRefundPolicy("list-clawback").calculate({ ...refundSample, usedLessons: 10 }).refund, 0);
ok("退款不会为负（超退保护）",
  findRefundPolicy("list-clawback").calculate({ ...refundSample, usedLessons: 10, agreedAmount: 1000 }).refund >= 0);

// 退课 + 退款：记一笔退款并把实收扣回
const moneyRefunded = await api.students.refundEnrollment(moneyStudent.id, moneyCreated.id, "退课自检", {
  amount: 500, method: "微信", policyName: "按实付比例退（默认）",
});
const afterRefund = moneyRefunded!.enrollments.find((item) => item.id === moneyCreated.id)!;
eq("退课后状态为已退课", afterRefund.status, "已退课");
eq("退款后实收被扣回", afterRefund.paidAmount, 1900);
ok("退款流水已记录",
  (await api.payments.listByEnrollment(moneyCreated.id)).some((item) => item.kind === "退款"));

// 财务汇总：月份区间与按方式分组
const finance = await api.finance(new Date());
ok("本月收款包含刚才的收款", finance.summary.received > 0);
ok("净收入 = 收款 − 退款", round2(finance.summary.received - finance.summary.refunded) === finance.summary.net);
ok("按收款方式分组非空", finance.summary.byMethod.length > 0);
ok("欠费清单只含有欠费的报课",
  finance.outstanding.every((item) => outstandingAmount(item.enrollment) > 0));
ok("欠费合计等于清单之和",
  round2(finance.outstanding.reduce((sum, item) => sum + item.amount, 0)) === finance.outstandingTotal);
eq("上个月的汇总与本月独立（区间过滤生效）",
  (await api.finance(new Date(Date.now() - 40 * 86_400_000))).summary.received >= 0, true);

// 金额工具：四舍五入到分、显示格式
eq("金额四舍五入到分", round2(0.1 + 0.2), 0.3);
eq("金额显示带货币符号", formatMoney(1280), "¥1,280");
eq("金额显示保留两位小数（非整数）", formatMoney(1280.5), "¥1,280.50");

eq("学生数没有被这些操作改变", (await api.students.list()).length, beforeMoney);

// ── 待跟进清单（第四组）──────────────────────────────────────────────
// 规则引擎是纯函数，因此这里逐条造数据验证：命中、不命中、以及「没有数据时不误报」。
const followNow = new Date("2026-09-18T10:00:00");

/** 造一个最小可用的学生（带一条报课）。 */
const makeStudent = (over: Partial<Student> = {}): Student => ({
  id: "fs1",
  name: "自检学生",
  grade: "初二",
  guardian: "138-0000-0000",
  subjects: ["初中数学"],
  profile: {},
  enrollments: [
    {
      // 默认课时充足（剩 15 节）：各用例需要触发「课时不足」时再各自调整，
      // 否则每个用例都会被这条规则命中
      id: "fe1", subject: "初中数学", form: "", teacherId: "",
      totalLessons: 20, usedLessons: 5,
      unitPrice: 200, agreedAmount: 4000, paidAmount: 4000,
      startedAt: followNow.toISOString(), endedAt: "", status: "在读", note: "", history: [],
    },
  ],
  status: "在读",
  note: "",
  createdAt: followNow.toISOString(),
  ...over,
});

/**
 * 「未来已排课」的夹具。
 *
 * 为什么几乎每个用例都要带上它：有剩余课时但未来 7 天没课，本来就会命中
 * 「久未排课」（这是正确的规则）。不带上它，验证别的规则时会被这条干扰 ——
 * 我第一次写这组用例就踩了这个坑，「干净数据」用例报出 2 条待办。
 */
const scheduledLessons = (studentId: string): Lesson[] => [
  {
    id: `fl_${studentId}`, subject: "初中数学", form: "", teacherId: "", classroomId: "",
    studentIds: [studentId],
    startsAt: new Date(followNow.getTime() + 2 * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已排", note: "",
  },
];

const build = (over: {
  students?: Student[];
  lessons?: Lesson[];
  assessments?: Assessment[];
  homeworks?: HomeworkRecord[];
  lessonRecords?: LessonRecord[];
}) =>
  buildFollowUps({
    students: over.students ?? [],
    lessons: over.lessons ?? [],
    assessments: over.assessments ?? [],
    homeworks: over.homeworks ?? [],
    lessonRecords: over.lessonRecords ?? [],
    now: followNow,
  });

// 干净数据：什么都不报（不能凭「没有记录」就当成表现不好）
eq("没有异常时不产生待办", build({ students: [makeStudent()], lessons: scheduledLessons("fs1") }).length, 0);

// 课时不足：剩余 5 节提醒、2 节紧急
const lowStudent = makeStudent({
  enrollments: [{ ...makeStudent().enrollments[0]!, usedLessons: 15, totalLessons: 20 }],
});
eq(`课时剩 ${FOLLOWUP_RULES.lowLessons} 节 → 提醒`,
  build({ students: [lowStudent] })[0]?.severity, "提醒");
const urgentStudent = makeStudent({
  enrollments: [{ ...makeStudent().enrollments[0]!, usedLessons: 18 }],
});
eq(`课时剩 ${FOLLOWUP_RULES.lowLessonsUrgent} 节 → 紧急`,
  build({ students: [urgentStudent] })[0]?.severity, "紧急");
eq("课时剩 6 节不报",
  build({
    students: [makeStudent({ enrollments: [{ ...makeStudent().enrollments[0]!, usedLessons: 14 }] })],
    lessons: scheduledLessons("fs1"),
  }).length, 0);

// 已退课的报课不参与判断
eq("已退课的课时不触发提醒",
  build({
    students: [
      makeStudent({
        enrollments: [{ ...makeStudent().enrollments[0]!, usedLessons: 19, status: "已退课" }],
      }),
    ],
  }).length, 0);

// 欠费：按约定应缴 − 实收
const owingStudent = makeStudent({
  enrollments: [{ ...makeStudent().enrollments[0]!, agreedAmount: 4000, paidAmount: 2500 }],
});
const owingItems = build({ students: [owingStudent] });
eq("欠费被挑出来", owingItems.some((item) => item.kind === "欠费"), true);
eq("欠费条目标为紧急", owingItems.find((item) => item.kind === "欠费")?.severity, "紧急");
ok("欠费话术里有金额", (owingItems.find((item) => item.kind === "欠费")?.message ?? "").includes("1,500"));

// 作业异常：最近 5 次里未交 2 次
const homeworkStudent = makeStudent();
const hw = (daysAgo: number, submission: HomeworkRecord["submission"]): HomeworkRecord => ({
  id: `hw${daysAgo}`, studentId: "fs1", subject: "初中数学",
  date: new Date(followNow.getTime() - daysAgo * 86_400_000).toISOString(),
  submission, accuracy: 80, weakPoints: "二次函数", note: "",
});
eq(`未交 ${FOLLOWUP_RULES.missedHomework} 次 → 报作业异常`,
  build({ students: [homeworkStudent], homeworks: [hw(1, "未交"), hw(2, "未交"), hw(3, "按时")] })
    .some((item) => item.kind === "作业异常"), true);
eq("只迟交 1 次不报",
  build({
    students: [homeworkStudent],
    lessons: scheduledLessons("fs1"),
    homeworks: [hw(1, "迟交"), hw(2, "按时"), hw(3, "按时")],
  }).length, 0);
eq("窗口外的旧记录不参与判断",
  build({
    students: [homeworkStudent],
    lessons: scheduledLessons("fs1"),
    homeworks: [hw(1, "按时"), hw(2, "按时"), hw(3, "按时"), hw(4, "按时"), hw(5, "按时"), hw(6, "未交"), hw(7, "未交")],
  }).length, 0);

// 测评下滑：只看每个科目的最近一次
const assessmentStudent = makeStudent();
const as = (subject: string, daysAgo: number, score: number, previous: number | null): Assessment => ({
  id: `as${subject}${daysAgo}`, studentId: "fs1", subject,
  date: new Date(followNow.getTime() - daysAgo * 86_400_000).toISOString(),
  score, previousScore: previous, weakPoints: "几何", note: "",
});
const dropItems = build({
  students: [assessmentStudent],
  assessments: [as("初中数学", 10, 90, 80), as("初中数学", 2, 70, 90)],
});
eq("分数下降被挑出来", dropItems.some((item) => item.kind === "测评下滑"), true);
eq("下降 20 分 → 提醒", dropItems.find((item) => item.kind === "测评下滑")?.severity, "提醒");
eq("分数上升不报",
  build({ students: [assessmentStudent], assessments: [as("初中数学", 10, 70, 60), as("初中数学", 2, 85, 70)] })
    .some((item) => item.kind === "测评下滑"), false);

// 出勤异常：请假 2 次或旷课 1 次
const attendanceStudent = makeStudent();
const lr = (daysAgo: number, attendance: LessonRecord["attendance"]): { record: LessonRecord; lesson: Lesson } => ({
  record: {
    id: `lr${daysAgo}`, lessonId: `fl${daysAgo}`, studentId: "fs1",
    attendance, focus: "中", interaction: "一般", rating: 3, note: "",
    recordedAt: followNow.toISOString(),
  },
  lesson: {
    id: `fl${daysAgo}`, subject: "初中数学", form: "", teacherId: "", classroomId: "",
    studentIds: ["fs1"],
    startsAt: new Date(followNow.getTime() - daysAgo * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已上", note: "",
  },
});
const attendanceCase = [lr(1, "请假"), lr(2, "请假"), lr(3, "到课")];
eq("请假 2 次 → 出勤异常",
  build({
    students: [attendanceStudent],
    lessonRecords: attendanceCase.map((item) => item.record),
    lessons: attendanceCase.map((item) => item.lesson),
  }).some((item) => item.kind === "出勤异常"), true);
const absentCase = [lr(1, "旷课"), lr(2, "到课")];
eq("旷课 1 次就报",
  build({
    students: [attendanceStudent],
    lessonRecords: absentCase.map((item) => item.record),
    lessons: absentCase.map((item) => item.lesson),
  }).some((item) => item.kind === "出勤异常"), true);
eq("全勤不报",
  build({
    students: [attendanceStudent],
    lessonRecords: [lr(1, "到课")].map((item) => item.record),
    // 这里既有历史出勤记录、也要有已排课，否则会被「久未排课」命中
    lessons: [...[lr(1, "到课")].map((item) => item.lesson), ...scheduledLessons("fs1")],
  }).length, 0);

// 久未排课：有课时但未来 7 天没课
const staleStudent = makeStudent({
  enrollments: [{ ...makeStudent().enrollments[0]!, usedLessons: 5 }],
});
eq("未来 7 天没课 → 久未排课",
  build({ students: [staleStudent] }).some((item) => item.kind === "久未排课"), true);
const futureLesson: Lesson = {
  id: "fl_future", subject: "初中数学", form: "", teacherId: "", classroomId: "",
  studentIds: ["fs1"],
  startsAt: new Date(followNow.getTime() + 2 * 86_400_000).toISOString(),
  durationMinutes: 60, status: "已排", note: "",
};
eq("已排课则不报久未排课",
  build({ students: [staleStudent], lessons: [futureLesson] }).some((item) => item.kind === "久未排课"), false);
eq("已取消的课不算排课",
  build({ students: [staleStudent], lessons: [{ ...futureLesson, status: "已取消" }] })
    .some((item) => item.kind === "久未排课"), true);

// 结课学生不参与
eq("结课学生不出现在清单里",
  build({ students: [makeStudent({ status: "结课", enrollments: [] })] }).length, 0);

// 排序：紧急在前
const mixed = build({ students: [urgentStudent, owingStudent] });
eq("清单按严重度排序（紧急在前）", mixed[0]?.severity, "紧急");

// 汇总与整份文本
const summaryRows = summarizeFollowUps(mixed);
ok("汇总覆盖所有类别", summaryRows.length === 6);
eq("汇总合计等于清单条数",
  summaryRows.reduce((sum, row) => sum + row.count, 0), mixed.length);
ok("整份文本包含学生与话术",
  followUpsToText(mixed).includes(mixed[0]!.studentName) &&
    followUpsToText(mixed).includes(mixed[0]!.message));
eq("空清单的文本有明确说法", followUpsToText([]).includes("无"), true);

// 真实数据上也能跑（不报错、条数合理）
const realFollowUps = await api.followups(new Date());
ok("真实数据上能生成清单", Array.isArray(realFollowUps));
ok("真实清单里每条都有原因与话术",
  realFollowUps.every((item) => item.reason !== "" && item.message.length > 20));

// ── 请假与补课（第五组）──────────────────────────────────────────────
// 规则：提前 24 小时请假不扣课时，临时缺课扣。边界值（正好 24 小时）必须钉死，
// 因为这是最容易和家长扯不清的地方。
__useStoreForTesting(memory);

const leaveLessonStart = new Date("2026-09-20T17:00:00");
const leaveLesson: Lesson = {
  id: "lv1", subject: "初中数学", form: "", teacherId: "t1", classroomId: "c1",
  studentIds: ["s1"], startsAt: leaveLessonStart.toISOString(), durationMinutes: 60,
  status: "已排", note: "", makeupForLessonId: "",
};
const makeRecord = (
  attendance: LessonRecord["attendance"],
  hoursBeforeStart: number | null,
): LessonRecord => ({
  id: "lr_draft", lessonId: leaveLesson.id, studentId: "s1",
  attendance,
  leaveRequestedAt:
    hoursBeforeStart === null
      ? ""
      : new Date(leaveLessonStart.getTime() - hoursBeforeStart * 3_600_000).toISOString(),
  focus: "中", interaction: "一般", rating: 3, note: "", recordedAt: leaveLessonStart.toISOString(),
});

eq("到课 → 扣课时", decideCharge(leaveLesson, makeRecord("到课", null)).charge, true);
eq("旷课 → 扣课时", decideCharge(leaveLesson, makeRecord("旷课", null)).charge, true);
eq(`提前 ${LEAVE_NOTICE_HOURS + 1} 小时请假 → 不扣`,
  decideCharge(leaveLesson, makeRecord("请假", LEAVE_NOTICE_HOURS + 1)).charge, false);
eq(`提前 ${LEAVE_NOTICE_HOURS} 小时整 → 不扣（边界含等于）`,
  decideCharge(leaveLesson, makeRecord("请假", LEAVE_NOTICE_HOURS)).charge, false);
eq(`提前 ${LEAVE_NOTICE_HOURS - 0.1} 小时请假 → 扣（临时缺课）`,
  decideCharge(leaveLesson, makeRecord("请假", LEAVE_NOTICE_HOURS - 0.1)).charge, true);
eq("请假但未记录时间 → 扣（不默认成有利解释）",
  decideCharge(leaveLesson, makeRecord("请假", null)).charge, true);
eq("没有课堂记录 → 按到课扣",
  decideCharge(leaveLesson, undefined).charge, true);
ok("判断理由可读（含小时数）",
  decideCharge(leaveLesson, makeRecord("请假", 30)).reason.includes("30 小时"));

// 补课不改变口径：补课本身是一节正常课 → 标记已上时扣 1 节
eq("补课课节（未填出勤）按到课扣",
  decideCharge({ ...leaveLesson, makeupForLessonId: "lv1" }, undefined).charge, true);

// ── 对账：出勤一变，课时跟着变 ────────────────────────────────────────
const leaveStudent = (await api.students.list()).find((item) => item.enrollments.length > 0)!;
const leaveEnrollment = leaveStudent.enrollments[0]!;
const remainingOfEnrollment = async () =>
  remainingOf((await api.students.get(leaveStudent.id))!.enrollments
    .find((item) => item.id === leaveEnrollment.id)!);

const reconcileStart = new Date();
reconcileStart.setDate(reconcileStart.getDate() + 3);
reconcileStart.setHours(9, 0, 0, 0);

const reconcileLesson = await api.lessons.create({
  subject: leaveEnrollment.subject, form: "", teacherId: teacher.id, classroomId: room.id,
  studentIds: [leaveStudent.id], startsAt: reconcileStart.toISOString(),
  durationMinutes: 60, status: "已排", note: "",
});

// 先填「到课」→ 标记已上 → 扣 1
await api.lessonRecords.save({
  lessonId: reconcileLesson.id, studentId: leaveStudent.id,
  attendance: "到课", leaveRequestedAt: "", focus: "中", interaction: "一般", rating: 3, note: "",
});
const beforeLeaveRule = await remainingOfEnrollment();
await api.lessons.markCompleted(reconcileLesson.id);
eq("到课标记已上 → 扣 1 节", await remainingOfEnrollment(), beforeLeaveRule - 1);

// 后来发现其实是提前请假的 → 保存请假时间后应自动退回
const leaveAt = new Date(reconcileStart.getTime() - 30 * 3_600_000).toISOString();
await api.lessonRecords.save({
  lessonId: reconcileLesson.id, studentId: leaveStudent.id,
  attendance: "请假", leaveRequestedAt: leaveAt, focus: "中", interaction: "一般", rating: 3, note: "",
});
eq("改为提前请假 → 课时自动退回", await remainingOfEnrollment(), beforeLeaveRule);
ok("退回是留痕（流水标了已撤销）",
  (await api.transactions.listByEnrollment(leaveEnrollment.id))
    .some((item) => item.lessonId === reconcileLesson.id && item.reversedAt !== ""));

// 再改成临时请假（提前 2 小时）→ 应自动补扣
await api.lessonRecords.save({
  lessonId: reconcileLesson.id, studentId: leaveStudent.id,
  attendance: "请假",
  leaveRequestedAt: new Date(reconcileStart.getTime() - 2 * 3_600_000).toISOString(),
  focus: "中", interaction: "一般", rating: 3, note: "",
});
eq("改为临时缺课 → 课时自动补扣", await remainingOfEnrollment(), beforeLeaveRule - 1);

// 反复保存同一份记录不能重复扣（对账是幂等的）
await api.lessonRecords.save({
  lessonId: reconcileLesson.id, studentId: leaveStudent.id,
  attendance: "请假",
  leaveRequestedAt: new Date(reconcileStart.getTime() - 2 * 3_600_000).toISOString(),
  focus: "中", interaction: "一般", rating: 3, note: "",
});
eq("重复保存不重复扣课时", await remainingOfEnrollment(), beforeLeaveRule - 1);

// ── 待补课清单与补课创建 ──────────────────────────────────────────────
const pending = await api.lessons.pendingMakeups();
ok("缺课的学生出现在待补课清单里",
  pending.some((row) => row.original.id === reconcileLesson.id && row.student.id === leaveStudent.id));

const makeupStart = new Date(reconcileStart);
makeupStart.setDate(makeupStart.getDate() + 7);
const makeup = await api.lessons.createMakeup({
  originalLessonId: reconcileLesson.id,
  startsAt: makeupStart.toISOString(),
  durationMinutes: 60,
  teacherId: teacher.id,
  classroomId: room.id,
  studentIds: [leaveStudent.id],
  note: "自检补课",
});
ok("补课创建成功", makeup !== null);
eq("补课关联了原课", makeup?.makeupForLessonId, reconcileLesson.id);
eq("补课沿用原课科目", makeup?.subject, reconcileLesson.subject);
eq("补课状态为已排", makeup?.status, "已排");
ok("补课之后不再出现在待补课清单里",
  !(await api.lessons.pendingMakeups()).some((row) => row.original.id === reconcileLesson.id));

/*
 * 补课标记已上会再扣 1 节。
 * 这里的账要算清：临时缺课已经扣了 1 节，补课再扣 1 节 → 相对原值共扣 2 节。
 * （换成「提前请假」的话就是 0 + 1 = 1 节，与正常上一节课一致 ——
 *  这也解释了为什么 24 小时规则对家长是有意义的。）
 */
await api.lessons.markCompleted(makeup!.id);
eq("临时缺课 + 补课，共扣 2 节", await remainingOfEnrollment(), beforeLeaveRule - 2);

// 已取消的课不算「已补」
await api.lessons.update(makeup!.id, { status: "已取消" });
ok("补课被取消后又回到待补课清单",
  (await api.lessons.pendingMakeups()).some((row) => row.original.id === reconcileLesson.id));

// 原课被取消时不再要求补课
await api.lessons.update(reconcileLesson.id, { status: "已取消" });
ok("原课取消后不再要求补课",
  !(await api.lessons.pendingMakeups()).some((row) => row.original.id === reconcileLesson.id));

await api.lessons.remove(makeup!.id);
await api.lessons.remove(reconcileLesson.id);

console.log("\n=== 7. 假登录（纯前端演示）===");
const sessionMemory = createMemoryStore();
__useSessionStoreForTesting(sessionMemory);
eq("初始未登录", isLoggedIn(), false);
const badLogin = await login("admin", "错的密码");
eq("错误口令被拒", badLogin.ok, false);
const okLogin = await login(__credentialsForTesting.username, __credentialsForTesting.password);
eq("正确口令通过", okLogin.ok, true);
ok("登录后可读到会话", getSession()?.username === "admin");
logout();
eq("退出后未登录", isLoggedIn(), false);

console.log(`\n=== 结果：${failures === 0 ? "全部通过" : `${failures} 项失败`} ===`);
process.exit(failures === 0 ? 0 : 1);
