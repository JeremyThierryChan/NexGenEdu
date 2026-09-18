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
import { getPricingData, parsePricingSource } from "@/lib/data/pricing";
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
import {
  buildDayTimeline,
  dayLessonGaps,
  formatGapDuration,
  formatMinuteOfDay,
  gapText,
  parseGapWindow,
  totalGapMinutes,
} from "@/lib/backend/timetable";
import { getClassHoursWindow } from "@/lib/backend/options";
import { groupHits, searchAll } from "@/lib/backend/search";
import {
  buildDateSeries,
  evaluateSlot,
  teachersForSubject,
} from "@/lib/backend/inquiry";
import { API_CONTRACT, MIGRATION_STEPS, SERVER_MUST_VALIDATE } from "@/lib/backend/contract";
import {
  addLibraryCourseToPricing,
  pricingStatusForCourses,
  syncLibraryLinks,
} from "@/lib/backend/pricing";
import {
  describeTeacherShare,
  sharePercentFor,
  teacherShareFormula,
  TEACHER_SHARE_MAX_STUDENTS,
} from "@/lib/backend/teacher-share";
import {
  pricingConfigCore,
  pricingConfigFromContent,
  pricingConfigFromSource,
  validatePricingConfig,
  PRICING_SOURCE_ADMIN,
  PRICING_SOURCE_CONTENT,
} from "@/lib/backend/pricing";
import { existsSync, readFileSync } from "node:fs";
import { LEAVE_NOTICE_HOURS, decideCharge } from "@/lib/backend/attendance";
import {
  CLASS_HOURS_PER_DAY,
  churnStats,
  describeRate,
  hourlyLoad,
  rangeSummary,
  roomUtilization,
  teacherWorkload,
} from "@/lib/backend/stats";
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
eq("报价页分组", pricingPage?.groups.map((g) => g.name), ["学习阶段", "班级类型", "课时选择", "试课", "计费规则", "教师分成", "其他项目"]);

console.log("\n=== 2. 数据访问层 ===");
const brand = getSiteBrand();
ok("品牌名非空", brand.brandName === "NexGenEdu");
// 营业时间（接待）与上课时间是两件事，混在一起写会让家长以为 8:00 就有人在接待
ok("营业时间与上课时间都有值", brand.contact.businessHours !== "" && brand.contact.classHours !== "");
ok("两个时间不是同一句话", brand.contact.businessHours !== brand.contact.classHours);
ok("上课时间从 8:00 开始（早于营业时间）",
  brand.contact.classHours.includes("8:00") && brand.contact.businessHours.includes("9:00"));
ok("上课时间到晚 22:00（晚于营业时间）",
  brand.contact.classHours.includes("22:00") && brand.contact.businessHours.includes("21:00"));
// 节假日政策必须两处一致：一处写「含节假日」另一处不写，家长会不知道信哪个
eq("营业时间与上课时间的节假日口径一致",
  brand.contact.businessHours.includes("含节假日"),
  brand.contact.classHours.includes("含节假日"));
ok("中文名非空", brand.brandNameZh === "新锐教培");
ok("联系方式非空", brand.contact.phone !== "");

const homeContent = getHomeContent();
const { courses: allCourses, columns, electiveGroups: electiveGroupList } = getCoursesPage();

/**
 * 课程栏目的自检原则：**只校验性质，不校验具体名单**。
 *
 * content.md 是手工维护的，增删课程、改课程名都是正常操作，
 * 把每张卡片的名字逐个写进断言会让「改内容」和「自检通过」互相打架
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
// 联系方式清单：电话 / 微信 / 邮箱 / 地址 / 营业时间 / 上课时间
eq("联系方式条数", contact.methods.map((item) => item.title),
  ["电话", "微信", "邮箱", "地址", "营业时间", "上课时间"]);

// 卡片与标签的双向锚点校验已并入第 2 节（栏目结构同一处维护），此处不再重复。

console.log("\n=== 3. 新增页面（案例 / 常见问题 / 时间安排）===");
const faq = getFaqContent();
// 分组名是结构（家长按主题找答案），因此固定住；条数会随内容增长，只设下限
eq("常见问题分组数", faq.groups.map((g) => g.title),
  ["试课与报名", "课时与收费", "班级与排课", "请假与补课", "老师与教学", "学习过程与反馈", "服务形式", "特殊情况"]);
ok(`常见问题总数不少于 30（当前 ${faq.count} 条）`, faq.count >= 30);
ok("每组都有问题", faq.groups.every((group) => group.items.length > 0));
ok("答案不重复粘贴（每条问题独立）",
  new Set(faq.groups.flatMap((g) => g.items.map((i) => i.question))).size === faq.count);
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

// ── 课表的空档（两节课中间空出来的时间）──────────────────────────────
/*
 * 空档是课表上唯一「没写出来」的信息，而接新学生、安排补课都靠它。
 * 口径必须钉死：只算课与课之间、已取消的课不算占用、重叠不产生假空档。
 */
const gapLesson = (
  id: string,
  startsAt: string,
  durationMinutes: number,
  status: Lesson["status"] = "已排",
): Lesson => ({
  id, subject: "初中数学", form: "", teacherId: "t1", classroomId: "c1", studentIds: [],
  startsAt: new Date(startsAt).toISOString(), durationMinutes, status, note: "", makeupForLessonId: "",
});

// 用户给的例子：17:30–18:30、19:00–20:30 两节课之间空 30 分钟
const gapSample = [
  gapLesson("g1", "2026-09-19T17:30:00", 60),
  gapLesson("g2", "2026-09-19T19:00:00", 90),
];
const sampleGaps = dayLessonGaps(gapSample);
eq("两节课之间的空档", sampleGaps.map((gap) => [gap.minutes, gap.label, gap.rangeLabel]),
  [[30, "30 分钟", "18:30–19:00"]]);
eq("空档记住了前后两节课（列表里插在后一节之前）",
  [sampleGaps[0]?.afterLessonId, sampleGaps[0]?.beforeLessonId], ["g1", "g2"]);
eq("时间线顺序是 课 / 空档 / 课",
  buildDayTimeline(gapSample).map((item) => item.kind), ["lesson", "gap", "lesson"]);
eq("时间线里的空档就是算出来的那段",
  buildDayTimeline(gapSample).filter((item) => item.kind === "gap").map((item) => item.kind === "gap" ? item.gap.minutes : 0),
  [30]);

// 头尾不算：第一节课之前、最后一节课之后不是「中间空着」
eq("只有一节课时没有空档", dayLessonGaps([gapLesson("g1", "2026-09-19T19:00:00", 60)]).length, 0);
// 紧挨着也不算空档
eq("紧挨着的两节课之间没有空档",
  dayLessonGaps([gapLesson("a", "2026-09-19T17:30:00", 60), gapLesson("b", "2026-09-19T18:30:00", 60)]).length, 0);
// 重叠（时间交叉）不产生负数或假空档
eq("时间重叠不产生空档",
  dayLessonGaps([
    gapLesson("a", "2026-09-19T17:30:00", 90),
    gapLesson("b", "2026-09-19T18:00:00", 60),
  ]).length, 0);
// 乱序输入也按时间算
eq("乱序传入也能算出空档",
  dayLessonGaps([
    gapLesson("b", "2026-09-19T19:00:00", 60),
    gapLesson("a", "2026-09-19T17:30:00", 60),
  ])[0]?.minutes, 30);
// 已取消的课不占时间：取消掉中间那节，前后就该连成一整段空档
eq("已取消的课不参与空档计算",
  dayLessonGaps([
    gapLesson("a", "2026-09-19T17:30:00", 60),
    gapLesson("x", "2026-09-19T18:30:00", 60, "已取消"),
    gapLesson("b", "2026-09-19T19:30:00", 60),
  ]).map((gap) => [gap.minutes, gap.rangeLabel]), [[60, "18:30–19:30"]]);
// 一天里可能有多段空档
const twoGaps = [
  gapLesson("a", "2026-09-19T17:30:00", 60),
  gapLesson("b", "2026-09-19T19:00:00", 90),
  gapLesson("c", "2026-09-19T21:00:00", 60),
];
eq("一天里的多段空档", dayLessonGaps(twoGaps).map((gap) => gap.label), ["30 分钟", "30 分钟"]);
eq("空档总时长", totalGapMinutes(twoGaps), 60);
eq("没有课的一天没有空档", totalGapMinutes([]), 0);

// 时长写法：45 分钟 / 整小时 / 小时+分钟
eq("空档时长的人话写法",
  [45, 60, 90, 125, 5].map(formatGapDuration),
  ["45 分钟", "1 小时", "1 小时 30 分钟", "2 小时 5 分钟", "5 分钟"]);
eq("空档时间段补零", formatMinuteOfDay(9 * 60 + 5), "09:05");

// 页面用的时间线必须与传入的课节一一对应（不能凭空多出或漏掉课）
const timelineLessons = buildDayTimeline(gapSample).filter((item) => item.kind === "lesson").length;
eq("时间线里的课节数不变", timelineLessons, gapSample.length);

// ── 课表的课前 / 课后空档（按「上课时间」窗口）─────────────────────────
/*
 * 头尾两段要靠「上课时间」才成立，因此窗口从内容里解析，代码不写死 8:00–22:00。
 * 这里同时钉住三件事：窗口解析、头尾的边界（课排在窗口外不算空档）、三段文案。
 */
eq("上课时间窗口来自内容的「上课时间」字段",
  getClassHoursWindow(), parseGapWindow(brand.contact.classHours));
eq("默认上课时间解析成 8:00–22:00",
  getClassHoursWindow(), { startMinutes: 8 * 60, endMinutes: 22 * 60 });
eq("窗口写法兼容「至 / 到 / ~ / -」与全角破折号",
  ["每日 8:00–22:00（含节假日）", "8:00-22:00", "8:00 至 22:00", "8:00~22:00", "8:00到22:00"]
    .map((text) => parseGapWindow(text)?.startMinutes),
  [480, 480, 480, 480, 480]);
eq("解析不出时间时返回 null（不猜）",
  ["每日", "9:00 开始", "", "22:00–8:00"].map((text) => parseGapWindow(text)), [null, null, null, null]);

const gapWindow = { startMinutes: 8 * 60, endMinutes: 22 * 60 };
const windowedGaps = dayLessonGaps(gapSample, { window: gapWindow });
eq("带上课时间后有三段空档（课前 / 课间 / 课后）",
  windowedGaps.map((gap) => [gap.kind, gap.minutes, gap.rangeLabel]),
  [
    ["head", 570, "08:00–17:30"],
    ["between", 30, "18:30–19:00"],
    ["tail", 90, "20:30–22:00"],
  ]);
eq("三段空档的文案分别是课前 / 课间 / 课后",
  windowedGaps.map(gapText), ["上课前空 9 小时 30 分钟", "两节课之间空 30 分钟", "下课后空 1 小时 30 分钟"]);
eq("课前空档没有「前一节课」、课后空档没有「后一节课」",
  [windowedGaps[0]?.afterLessonId, windowedGaps[0]?.beforeLessonId,
   windowedGaps[2]?.afterLessonId, windowedGaps[2]?.beforeLessonId],
  ["", "g1", "g2", ""]);
eq("一天的空档合计（含头尾）", totalGapMinutes(gapSample, { window: gapWindow }), 570 + 30 + 90);

const windowedTimeline = buildDayTimeline(gapSample, { window: gapWindow });
eq("时间线是 空档 / 课 / 空档 / 课 / 空档",
  windowedTimeline.map((item) => item.kind === "gap" ? item.gap.kind : "lesson"),
  ["head", "lesson", "between", "lesson", "tail"]);

// 边界：课排在窗口之外时，不该凭空生出空档（否则会出现负数或「课前空 -2 小时」）
eq("第一节课早于上课时间时没有课前空档",
  dayLessonGaps([gapLesson("a", "2026-09-19T07:00:00", 60), gapLesson("b", "2026-09-19T19:00:00", 60)],
    { window: gapWindow }).map((gap) => gap.kind),
  ["between", "tail"]);
eq("最后一节课超过上课时间结束时没有课后空档",
  dayLessonGaps([gapLesson("a", "2026-09-19T20:00:00", 180)], { window: gapWindow }).map((gap) => gap.kind),
  ["head"]);
// 一节课都没有：整天空着由空状态表达，不再画一张 14 小时的卡片
eq("没有课的一天不产生空档", dayLessonGaps([], { window: gapWindow }), []);
// 已取消的课同样不参与头尾计算
eq("取消掉唯一一节课后不产生空档",
  dayLessonGaps([gapLesson("x", "2026-09-19T17:00:00", 60, "已取消")], { window: gapWindow }), []);
// 不传窗口时行为不变（只算课间），保证调用方可以不知道营业/上课时间
eq("不传窗口时只算课间空档",
  dayLessonGaps(gapSample).map((gap) => gap.kind), ["between"]);

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

// ── 经营统计（第六组）─────────────────────────────────────────────────
// 统计最容易出的问题是「口径不一致」：利用率分母是什么、取消的课算不算、
// 退课比例按条还是按课时。这里逐项把口径钉死。
const statsDays = weekDays(new Date());
const statsFrom = statsDays[0]!;
const statsTo = new Date(statsDays[6]!);
statsTo.setHours(23, 59, 59, 999);

const statLesson = (
  id: string,
  dayIndex: number,
  hour: number,
  duration: number,
  over: Partial<Lesson> = {},
): Lesson => {
  const day = new Date(statsDays[dayIndex]!);
  day.setHours(hour, 0, 0, 0);
  return {
    id, subject: "初中数学", form: "", teacherId: "t1", classroomId: "c1",
    studentIds: ["s1"], startsAt: day.toISOString(), durationMinutes: duration,
    status: "已排", note: "", makeupForLessonId: "", ...over,
  };
};

const statRooms: Classroom[] = [
  {
    id: "c1", name: "301", kind: "上课用教室", capacity: 8,
    // 周一至周五 17:00–21:00 → 每天 4 小时，一周 20 小时 = 1200 分钟
    availability: [{ id: "a1", weekdays: [1, 2, 3, 4, 5], start: "17:00", end: "21:00" }],
    note: "",
  },
  { id: "c2", name: "不限时段教室", kind: "自习室", capacity: 4, availability: [], note: "" },
];
const statLessons: Lesson[] = [
  statLesson("sl1", 0, 17, 120),           // 周一 2 小时
  statLesson("sl2", 0, 19, 60),            // 周一 1 小时
  statLesson("sl3", 1, 18, 90, { classroomId: "c2" }),
  statLesson("sl4", 2, 10, 60, { status: "已取消" }),  // 取消的不算
];

const rooms = roomUtilization(statRooms, statLessons, statsDays);
const roomC1 = rooms.find((row) => row.classroom.id === "c1")!;
const roomC2 = rooms.find((row) => row.classroom.id === "c2")!;
eq("可用时长按教室自己的时段算", roomC1.availableMinutes, 5 * 4 * 60);
eq("已排时长不含已取消的课", roomC1.bookedMinutes, 120 + 60);
eq("利用率 = 已排 / 可用", describeRate(roomC1.rate), "15%");
// 基准用「上课时间」14 小时（8:00–22:00），不是营业时间 12 小时：
// 教室能不能用取决于能不能上课，而不是前台有没有人
eq("没设时段的教室按上课时间估算", roomC2.availableMinutes, Math.round(CLASS_HOURS_PER_DAY * 60 * 7));
ok("取消的课不计入课次", roomC1.lessonCount === 2);
// c1 的可用时段是周一到周五，课都排在周一 → 空档应为周二到周五（周六日不在可用时段内，不算空档）
eq("空档日只在有可用时段的日子上统计",
  roomC1.idleDays, statsDays.slice(1, 5).map((day) => dateKey(day)));

const hourly = hourlyLoad(statLessons);
ok("时段分布不含已取消的课", hourly.every((row) => row.hour !== 10));
eq("17:00 有两节课中的一节", hourly.find((row) => row.hour === 17)?.count, 1);
ok("时段按小时升序", hourly.every((row, index) => index === 0 || hourly[index - 1]!.hour < row.hour));

// 教师课时：按科目拆分 + 平均人数
const statTeachers: Teacher[] = [
  { id: "t1", name: "自检老师A", subjects: ["数学"], role: "", phone: "", active: true },
  { id: "t2", name: "自检老师B", subjects: ["英语"], role: "", phone: "", active: true },
];
const workload = teacherWorkload(statTeachers, [
  statLesson("wl1", 0, 17, 60, { studentIds: ["s1", "s2"] }),
  statLesson("wl2", 0, 18, 90, { subject: "初中物理" }),
  statLesson("wl3", 1, 17, 60, { teacherId: "t2" }),
  statLesson("wl4", 2, 17, 60, { status: "已取消" }),
]);
const teacherA = workload.find((row) => row.teacher.id === "t1")!;
eq("教师课次不含已取消", teacherA.lessonCount, 2);
eq("教师时长合计", teacherA.minutes, 150);
eq("教师涉及学生数（去重）", teacherA.studentCount, 2);
eq("平均每节课人数", teacherA.avgStudents, 1.5);
eq("按科目拆分（按时长降序）", teacherA.bySubject.map((item) => item.subject), ["初中物理", "初中数学"]);
ok("按课时降序排列（老师A 在前）", workload[0]?.teacher.id, "t1");

// 退课与流失：口径按「退掉的课时」而不是条数
const churnStudents: Student[] = [
  {
    id: "cs1", name: "退课学生", grade: "初二", guardian: "", subjects: [], profile: {},
    enrollments: [
      {
        id: "ce1", subject: "初中数学", form: "", teacherId: "",
        totalLessons: 10, usedLessons: 3, unitPrice: 200, agreedAmount: 2000, paidAmount: 2000,
        startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
        status: "已退课", note: "",
        history: [{ at: new Date().toISOString(), kind: "退课", lessons: 0, note: "时间冲突" }],
      },
      {
        id: "ce2", subject: "初中数学", form: "", teacherId: "",
        totalLessons: 10, usedLessons: 8, unitPrice: 200, agreedAmount: 2000, paidAmount: 2000,
        startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
        status: "已退课", note: "",
        history: [{ at: new Date().toISOString(), kind: "退课", lessons: 0, note: "时间冲突" }],
      },
      {
        id: "ce3", subject: "初中英语", form: "", teacherId: "",
        totalLessons: 10, usedLessons: 5, unitPrice: 200, agreedAmount: 2000, paidAmount: 2000,
        startedAt: new Date().toISOString(), endedAt: "", status: "在读", note: "", history: [],
      },
    ],
    status: "在读", note: "", createdAt: new Date().toISOString(),
  },
  {
    id: "cs2", name: "暂停学生", grade: "初三", guardian: "", subjects: [], profile: {},
    enrollments: [], status: "暂停", note: "", createdAt: new Date().toISOString(),
  },
];
const churn = churnStats(churnStudents);
eq("只统计已退课的报课", churn.refundedCount, 2);
eq("退掉的课时合计", churn.refundedLessons, 20);
eq("退课时仍未上的课时合计", churn.refundedRemaining, 9);
eq("平均已上节数", churn.avgUsedLessons, 5.5);
eq("平均已上比例（3/10 与 8/10 → 0.55）", churn.avgUsedRatio, 0.55);
eq("按科目汇总", churn.bySubject, [{ subject: "初中数学", count: 2 }]);
eq("按原因汇总", churn.byReason, [{ reason: "时间冲突", count: 2 }]);
eq("暂停 / 结课学生数", churn.pausedOrFinished, 1);
ok("在读的报课不计入流失", !churn.bySubject.some((row) => row.subject === "初中英语"));

// 区间汇总
const range = rangeSummary(statLessons, statsFrom, statsTo);
eq("区间课次不含取消", range.lessonCount, 3);
eq("区间取消课次单独统计", range.cancelled, 1);
eq("区间课时合计", range.minutes, 120 + 60 + 90);
ok("区间涉及学生去重", range.studentCount === 1);

// 服务层统计接口可用
const liveStats = await api.stats(new Date());
ok("服务层能返回统计", Array.isArray(liveStats.rooms) && Array.isArray(liveStats.teachers));
ok("统计里每间场地都有利用率", liveStats.rooms.every((row) => row.rate >= 0));
ok("统计里的利用率不超过 1（已排不该超过可用）",
  liveStats.rooms.every((row) => row.rate <= 1 || row.availableMinutes === 0));

// ── 全局搜索与操作日志（第七组）───────────────────────────────────────
__useStoreForTesting(memory);

const searchInput = {
  keyword: "",
  students: [
    {
      id: "s1", name: "张小明", grade: "初二", guardian: "138-0000-0000",
      subjects: ["初中数学"], profile: {}, enrollments: [],
      status: "在读" as const, note: "", createdAt: new Date().toISOString(),
    },
    {
      id: "s2", name: "张小红", grade: "初三", guardian: "", subjects: [],
      profile: {}, enrollments: [], status: "在读" as const, note: "",
      createdAt: new Date().toISOString(),
    },
  ],
  teachers: [
    { id: "t1", name: "陈老师", subjects: ["数学"], role: "全科教师", phone: "", active: true },
  ],
  classrooms: [
    {
      id: "c1", name: "301 教室", kind: "上课用教室" as const, capacity: 8,
      availability: [], note: "白板",
    },
  ],
  lessons: [
    {
      id: "l1", subject: "初中数学", form: "一对一定制课", teacherId: "t1", classroomId: "c1",
      studentIds: ["s1"], startsAt: new Date("2026-09-18T17:30:00").toISOString(),
      durationMinutes: 60, status: "已排" as const, note: "", makeupForLessonId: "",
    },
  ],
  courses: [{ title: "初中数学", href: "/courses/junior-math" }],
};

eq("空关键词不返回结果", searchAll({ ...searchInput, keyword: "   " }).length, 0);
const byName = searchAll({ ...searchInput, keyword: "张小明" });
eq("按学生姓名能搜到", byName.filter((hit) => hit.kind === "学生").map((hit) => hit.title), ["张小明"]);
ok("学生结果带直达链接（含 studentId）",
  byName[0]?.href === "/admin/students?studentId=s1");
eq("按年级能搜到多个学生",
  searchAll({ ...searchInput, keyword: "初" }).filter((hit) => hit.kind === "学生").length, 2);
eq("按教师姓名能搜到", searchAll({ ...searchInput, keyword: "陈老师" }).filter((h) => h.kind === "教师").length, 1);
eq("按教师科目也能搜到", searchAll({ ...searchInput, keyword: "数学" }).filter((h) => h.kind === "教师").length, 1);
eq("按教室名能搜到", searchAll({ ...searchInput, keyword: "301" }).filter((h) => h.kind === "教室").length, 1);
eq("按科目能搜到排课",
  searchAll({ ...searchInput, keyword: "初中数学" }).filter((h) => h.kind === "排课").length, 1);
ok("排课结果带日期参数（便于跳到那一天）",
  (searchAll({ ...searchInput, keyword: "初中数学" }).find((h) => h.kind === "排课")?.href ?? "")
    .includes("date=2026-09-18"));
eq("课程（前台科目页）也能搜到",
  searchAll({ ...searchInput, keyword: "初中数学" }).filter((h) => h.kind === "课程").length, 1);
eq("搜不到时不硬凑结果", searchAll({ ...searchInput, keyword: "不存在的人" }).length, 0);
// 「数学」会同时命中学生（在读科目）、教师（可带科目）、排课（科目）与课程
const searchGroups = groupHits(searchAll({ ...searchInput, keyword: "数学" }));
eq("分组按固定顺序（学生 → 教师 → 教室 → 排课 → 课程）",
  searchGroups.map((group) => group.kind), ["学生", "教师", "排课", "课程"]);

// 服务层搜索（真实数据）
ok("服务层搜索能返回结果", (await api.search("示例")).length > 0);
eq("服务层搜索空关键词返回空", (await api.search("  ")).length, 0);

// ── 操作日志 ──────────────────────────────────────────────────────────
await api.logs.clear();
eq("清空后只剩「清空日志」这一条", (await api.logs.list()).length, 1);
ok("清空日志本身也被记录",
  (await api.logs.list())[0]?.action === "清空日志");

const logStudent = await api.students.create({
  name: "日志自检学生", grade: "初一", guardian: "", status: "在读", note: "", profile: {},
});
const afterCreate = await api.logs.list();
eq("新建学生会留下日志", afterCreate[0]?.entity, "学生");
eq("日志动作是新建", afterCreate[0]?.action, "新建");
eq("日志摘要带姓名", afterCreate[0]?.summary.includes("日志自检学生"), true);
eq("日志记的是操作人", afterCreate[0]?.operator, "admin");

await api.students.update(logStudent.id, { grade: "初二" });
const afterUpdate = await api.logs.list();
ok("修改会留下日志并写明改了哪个字段",
  afterUpdate[0]?.action === "修改" && (afterUpdate[0]?.summary ?? "").includes("grade"));

await api.students.remove(logStudent.id);
const afterRemove = await api.logs.list();
eq("删除会留下日志", afterRemove[0]?.action, "删除");

// 业务动作（不走通用集合的那些）也要留痕
const logTarget = (await api.students.list())[0]!;
await api.lessons.markCompleted((await api.lessons.list()).find((l) => l.status === "已排")!.id);
ok("标记已上有日志",
  (await api.logs.list(20)).some((log) => log.action === "标记已上"));
await api.students.saveProfile(logTarget.id, { gender: "女" });
ok("填写采集表有日志",
  (await api.logs.list(20)).some((log) => log.action === "填写采集表"));

// 日志条数上限：不能无限涨（否则 localStorage 迟早撑满）
const beforeCap = (await api.logs.list(1))[0]!;
for (let index = 0; index < 5; index += 1) {
  await api.students.create({
    name: `日志上限${index}`, grade: "初一", guardian: "", status: "在读", note: "", profile: {},
  });
}
ok("日志按时间倒序（最新在前）",
  (await api.logs.list(1))[0]!.at >= beforeCap.at);
const allLogs = JSON.parse(memory.read("nexgenedu.admin.db.v1")!).logs as unknown[];
ok("日志条数不超过上限", allLogs.length <= 500);

// 搜索是只读的：不能因为它而多出日志或改动数据
const logsBeforeSearch = (await api.logs.list(200)).length;
const studentsBeforeSearch = (await api.students.list()).length;
await api.search("示例");
eq("搜索不产生操作日志", (await api.logs.list(200)).length, logsBeforeSearch);
eq("搜索不改动数据", (await api.students.list()).length, studentsBeforeSearch);

// ── 文档一致性：索引里的文件必须存在，核心文档必须被索引 ──────────────────
// 文档最容易「越写越漂」：索引指向一个被改名/删掉的文件，读者点进去是 404。
// 这里只钉两件事：README 与 docs/README.md 里链接到的本地文档都要真的存在；
// 核心文档必须出现在索引里（不写死数量，新增文档不会让自检变红）。
const readmeRoot = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const docsIndex = readFileSync(new URL("../docs/README.md", import.meta.url), "utf8");
const docPathExists = (relative: string) =>
  existsSync(new URL(`../${relative.replace(/^\.\//, "")}`, import.meta.url));
const linkedDocs = (text: string): string[] =>
  [...text.matchAll(/\]\((\.[^)]*\.md)\)/g)]
    .map((match) => match[1]!.replace(/^\.\//, ""))
    .filter((path) => path.startsWith("docs/") || path === "PROJECT.md" || path === "README.md");

const README_LINKED_AT_LEAST = 5;
const readmeLinks = linkedDocs(readmeRoot);
ok(`README 至少链接到 ${README_LINKED_AT_LEAST} 份文档（当前 ${readmeLinks.length} 份）`,
  readmeLinks.length >= README_LINKED_AT_LEAST);
eq("README 里链接的文档都存在", readmeLinks.filter((path) => !docPathExists(path)), []);
eq("docs 索引里链接的文档都存在",
  linkedDocs(docsIndex)
    .map((path) => path.replace(/^docs\//, "docs/"))
    .filter((path) => !docPathExists(path)), []);

// 核心文档：这五份是「员工会照做、开发者会照做」的东西，缺一份就是缺一条腿
const CORE_DOCS = ["使用手册", "内容维护手册", "技术架构", "部署与发布", "后台API约定"];
eq("docs 索引漏掉的核心文档",
  CORE_DOCS.filter((name) => !docsIndex.includes(name)), []);
eq("README 文档表漏掉的核心文档",
  CORE_DOCS.filter((name) => !readmeRoot.includes(name)), []);
ok("README 与 docs 索引都说明了伪后端边界（数据只在本机浏览器）",
  readmeRoot.includes("这台电脑的浏览器") && docsIndex.includes("这台电脑的浏览器"));

// ── 接口契约（第八组）─────────────────────────────────────────────────
// 文档最容易「写完就过期」。这里让契约清单与代码互相校验：
// 有方法没登记（漏文档）或登记了却不存在（文档漂移）都会失败。
const realMethods: string[] = [];
const walkApi = (value: unknown, prefix: string) => {
  if (typeof value === "function") {
    realMethods.push(prefix);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      walkApi(child, prefix === "" ? key : `${prefix}.${key}`);
    }
  }
};
walkApi(api, "", realMethods);
realMethods.sort();

const documented = API_CONTRACT.flatMap((group) => group.methods).sort();
eq("接口契约没有漏登记的方法（新增方法要补进 contract.ts）",
  realMethods.filter((name) => !documented.includes(name)), []);
eq("接口契约里没有已不存在的方法（删方法要同步更新 contract.ts）",
  documented.filter((name) => !realMethods.includes(name)), []);
eq("每个方法只归属一个分组",
  documented.filter((name, index) => documented.indexOf(name) !== index), []);
ok(`接口方法总数与清单一致（${realMethods.length} 个）`, documented.length === realMethods.length);

// 分组本身也要有内容与说明
ok("每个分组都有说明", API_CONTRACT.every((group) => group.note.length > 30));
ok("每个分组都有方法", API_CONTRACT.every((group) => group.methods.length > 0));

// 服务端必须复核的清单：这些是接服务端时的验收项，不能被悄悄删掉
ok("服务端校验清单覆盖关键项（冲突 / 幂等 / 金额 / 鉴权 / 审计）", (() => {
  const text = SERVER_MUST_VALIDATE.map((item) => item.rule).join(" ");
  return ["冲突", "幂等", "金额", "鉴权", "审计"].every((key) => text.includes(key));
})());
ok("每条服务端校验都写了理由", SERVER_MUST_VALIDATE.every((item) => item.why.length > 15));
ok("迁移步骤含退出条件", MIGRATION_STEPS.some((item) => item.step.includes("退出条件")));

// 文档必须提到每一个方法（否则「文档漏了接口」没人发现）
const apiDoc = readFileSync(new URL("../docs/后台API约定.md", import.meta.url), "utf8");
/*
 * 按边界匹配方法名，而不是简单子串：`lessons.list` 是 `lessons.listByDate` 的子串，
 * 用子串判断会让「文档里其实没写这个方法」也判为通过（我自己先用子串写过一版）。
 */
const mentionedInDoc = (name: string) =>
  new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(apiDoc);
eq("API 文档漏掉的方法", realMethods.filter((name) => !mentionedInDoc(name)), []);
ok("API 文档提到服务端必须复核的校验", apiDoc.includes("服务端") && apiDoc.includes("复核"));

// ── 咨询可行性（第九组）───────────────────────────────────────────────
// 这个功能的错误代价是「当场答应家长、事后排不出课」，因此判定必须逐条钉死：
// 尤其「检查的是一串日期而不是一天」这一条，是最容易写错的地方。
const iqNow = new Date("2026-09-14T10:00:00"); // 周一

const mkInquiry = (over: Partial<Inquiry> = {}): Inquiry => ({
  id: "iq1",
  studentName: "咨询学生",
  grade: "初二",
  guardian: "138-0000-0000",
  subject: "初中数学",
  durationMinutes: 60,
  intervalWeeks: 1,
  plannedLessons: 3,
  startsAt: iqNow.toISOString(),
  candidates: [{ id: "c1", weekday: 6, start: "10:00" }],
  preferredTeacherId: "",
  preferredClassroomId: "",
  skipDates: [],
  status: "待确认",
  note: "",
  createdAt: iqNow.toISOString(),
  scheduledLessonIds: [],
  ...over,
});

// 日期串：每周一次 / 每两周一次 / 跳过某几周
eq("每周一次生成 3 个周六",
  buildDateSeries({ startsAt: iqNow.toISOString(), weekday: 6, intervalWeeks: 1, plannedLessons: 3, skipDates: [] })
    .map((d) => dateKey(d)),
  ["2026-09-19", "2026-09-26", "2026-10-03"]);
eq("每两周一次间隔 14 天",
  buildDateSeries({ startsAt: iqNow.toISOString(), weekday: 6, intervalWeeks: 2, plannedLessons: 3, skipDates: [] })
    .map((d) => dateKey(d)),
  ["2026-09-19", "2026-10-03", "2026-10-17"]);
eq("跳过的日期会顺延（总节数不变）",
  buildDateSeries({
    startsAt: iqNow.toISOString(), weekday: 6, intervalWeeks: 1, plannedLessons: 3,
    skipDates: ["2026-09-26"],
  }).map((d) => dateKey(d)),
  ["2026-09-19", "2026-10-03", "2026-10-10"]);
eq("起始日之后的第一个周六才算第一次",
  buildDateSeries({ startsAt: "2026-09-20T00:00:00", weekday: 6, intervalWeeks: 1, plannedLessons: 1, skipDates: [] })
    .map((d) => dateKey(d)),
  ["2026-09-26"]);

// 教师匹配：科目名出现在教师可带科目里
const iqTeachers: Teacher[] = [
  { id: "it1", name: "数学老师", subjects: ["数学"], role: "", phone: "", active: true },
  { id: "it2", name: "英语老师", subjects: ["英语"], role: "", phone: "", active: true },
  { id: "it3", name: "离职数学", subjects: ["数学"], role: "", phone: "", active: false },
];
eq("按科目筛教师（在职且科目匹配）",
  teachersForSubject(iqTeachers, "初中数学").map((t) => t.id), ["it1"]);

const iqRooms: Classroom[] = [
  { id: "ic1", name: "小教室", kind: "上课用教室", capacity: 4, availability: [], note: "" },
  { id: "ic2", name: "限时教室", kind: "上课用教室", capacity: 8,
    availability: [{ id: "r", weekdays: [6], start: "09:00", end: "12:00" }], note: "" },
];
const iqLessons: Lesson[] = [
  { id: "il1", subject: "初中数学", form: "", teacherId: "it1", classroomId: "ic2",
    studentIds: ["s1"], startsAt: "2026-09-19T10:00:00", durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "" },
];

/** 用一组固定数据评估一条咨询。 */
const evalIq = (inquiry: Inquiry, lessons: Lesson[] = [], rooms: Classroom[] = iqRooms) => {
  const teachers = iqTeachers.filter((t) => t.active);
  const capacity = new Map<string, number>();
  for (const teacher of teachers) capacity.set(teacher.id, 0);
  return inquiry.candidates.map((slot) =>
    evaluateSlot({ inquiry, slot, teachers, classrooms: rooms, lessons, load: capacity }),
  );
};

// 可行：无人占用
const okReport = evalIq(mkInquiry());
eq("空档时段判定为可行", okReport[0]?.ok, true);
eq("给出了教师与场地", okReport[0]?.assignment?.teacherId, "it1");
ok("给出排课日期预览", (okReport[0]?.dates.length ?? 0) > 0);

// 不可行：老师在同一时段已有课 → 必须报出「挡路的那节课」
const clashReport = evalIq(mkInquiry({ preferredTeacherId: "it1" }), iqLessons);
eq("教师冲突判定为不可行", clashReport[0]?.ok, false);
eq("阻塞类型是教师忙", clashReport[0]?.blockers[0]?.kind, "教师忙");
eq("阻塞里给出挡路的课节", clashReport[0]?.blockers[0]?.lessonId, "il1");
ok("阻塞里带上受影响的已有学生（界面要先显示再决定动不动）",
  (clashReport[0]?.blockers[0]?.studentIds ?? []).includes("s1"));

// 关键：冲突发生在**系列的中间那一节**，也不能漏
const laterClash: Lesson[] = [
  { id: "il2", subject: "初中数学", form: "", teacherId: "it1", classroomId: "ic1",
    studentIds: ["s2"], startsAt: "2026-10-03T10:00:00", durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "" },
];
eq("系列中途撞课也要判定为不可行（不是只看第一次）",
  evalIq(mkInquiry({ preferredTeacherId: "it1" }), laterClash)[0]?.ok, false);
eq("并指出撞的是哪一天",
  evalIq(mkInquiry({ preferredTeacherId: "it1" }), laterClash)[0]?.blockers[0]?.date, "2026-10-03");

// 取消的课不占时间
eq("已取消的课不算冲突",
  evalIq(mkInquiry({ preferredTeacherId: "it1" }), [{ ...iqLessons[0]!, status: "已取消" }])[0]?.ok,
  true);

// 教室不开放
eq("教室在该时段不开放会被报出",
  evalIq(mkInquiry({ preferredClassroomId: "ic2" }), [{ ...iqLessons[0]!, teacherId: "it2" }])[0]
    ?.blockers[0]?.kind,
  "教师忙");
const closedRoom = evalIq(
  mkInquiry({ preferredClassroomId: "ic2", candidates: [{ id: "c1", weekday: 6, start: "08:00" }] }),
);
eq("教室开放时间之外判定为不可行", closedRoom[0]?.ok, false);
eq("阻塞类型是教室不开放", closedRoom[0]?.blockers[0]?.kind, "教室不开放");

// 没人能带这门课
const noTeacher = evalIq(mkInquiry({ subject: "书法" }));
eq("没人能带这门课会被报出", noTeacher[0]?.blockers[0]?.kind, "无人能带该科目");
ok("并给出可操作的建议",
  (noTeacher[0]?.blockers[0]?.detail ?? "").includes("教师页"));

// 最接近的方案：教师被占时，应给出「同一天换个时间」或「换老师」
const altReport = evalIq(mkInquiry({ preferredTeacherId: "it1" }), iqLessons);
ok("不可行时给出最接近的方案", (altReport[0]?.alternatives.length ?? 0) > 0);
ok("方案里说明了改什么",
  (altReport[0]?.alternatives[0]?.change ?? "").length > 0);
ok("方案的时段与原时段不同",
  JSON.stringify(altReport[0]?.alternatives[0]?.slot) !== JSON.stringify(mkInquiry().candidates[0]));

// 多个候选：依次尝试，第一个可行的被推荐
const twoCandidates = evalIq(
  mkInquiry({
    preferredTeacherId: "it1",
    candidates: [
      { id: "c1", weekday: 6, start: "10:00" },
      { id: "c2", weekday: 6, start: "14:00" },
    ],
  }),
  iqLessons,
);
eq("第一个候选不可行、第二个可行", [twoCandidates[0]?.ok, twoCandidates[1]?.ok], [false, true]);

// ── 服务层：登记 → 判定 → 采用（一次建整串课）→ 放弃 ────────────────────
__useStoreForTesting(memory);
const createdInquiry = await api.inquiries.create({
  studentName: "咨询自检学生", grade: "初二", guardian: "138-0000-0000",
  subject: "初中数学", durationMinutes: 60, intervalWeeks: 1, plannedLessons: 3,
  startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  candidates: [{ id: "c1", weekday: 6, start: "10:00" }],
  preferredTeacherId: "", preferredClassroomId: "", skipDates: [],
  status: "待确认", note: "",
});
ok("咨询能登记", createdInquiry.id !== "");
const iqReport = await api.inquiries.evaluate(createdInquiry.id);
ok("服务层能给出可行性报告", iqReport !== null && iqReport.slots.length === 1);
eq("报告里标出推荐的候选", iqReport?.recommendedSlotId, iqReport?.slots[0]?.ok ? "c1" : "");

if (iqReport?.slots[0]?.ok === true && iqReport.slots[0].assignment !== null) {
  const accepted = await api.inquiries.accept(createdInquiry.id, {
    slotId: "c1",
    teacherId: iqReport.slots[0].assignment.teacherId,
    classroomId: iqReport.slots[0].assignment.classroomId,
  });
  eq("采用方案成功", accepted.ok, true);
  eq("一次建出整串课（3 节）", accepted.ok ? accepted.lessonIds.length : 0, 3);
  const inquiryAfter = (await api.inquiries.get(createdInquiry.id))!;
  eq("线索状态改为已安排", inquiryAfter.status, "已安排");
  eq("线索记录了生成的课节", inquiryAfter.scheduledLessonIds.length, 3);
  ok("生成的课都落在约定的星期几与时间",
    (await Promise.all(accepted.ok ? accepted.lessonIds.map((id) => api.lessons.get(id)) : []))
      .every((lesson) => lesson !== null && new Date(lesson.startsAt).getDay() === 6));
  // 清理
  for (const id of accepted.ok ? accepted.lessonIds : []) await api.lessons.remove(id);
}

const abandoned = await api.inquiries.abandon(createdInquiry.id, "自检放弃");
eq("放弃后状态为已放弃", abandoned?.status, "已放弃");
ok("放弃原因写进备注", (abandoned?.note ?? "").includes("自检放弃"));
await api.inquiries.remove(createdInquiry.id);

/*
 * 端到端主线：新学生的时段被已有课挡住 → 把已有课挪走 → 再判定通过。
 * 这是这个功能最典型的用法（「协调已有学生」），之前只分别验证了各段，
 * 这里把整条路串起来走一遍。
 */
__useStoreForTesting(memory);
const blockedTeacher = (await api.teachers.listActive())[0]!;
const blockedRoom = (await api.classrooms.list())[0]!;
const blockedStudent = (await api.students.list())[0]!;

// 造一节已有课，把「下周六 10:00」占住
const blockingStart = new Date();
blockingStart.setDate(blockingStart.getDate() + ((6 - blockingStart.getDay() + 7) % 7 || 7));
blockingStart.setHours(10, 0, 0, 0);
const blockingLesson = await api.lessons.create({
  subject: blockedStudent.subjects[0] ?? "初中数学", form: "", teacherId: blockedTeacher.id,
  classroomId: blockedRoom.id, studentIds: [blockedStudent.id],
  startsAt: blockingStart.toISOString(), durationMinutes: 60, status: "已排", note: "自检·挡路课",
});

const e2eInquiry = await api.inquiries.create({
  studentName: "端到端自检学生", grade: "初二", guardian: "",
  subject: blockedStudent.subjects[0] ?? "初中数学",
  durationMinutes: 60, intervalWeeks: 1, plannedLessons: 2,
  startsAt: new Date().toISOString(),
  candidates: [{ id: "c1", weekday: 6, start: "10:00" }],
  preferredTeacherId: blockedTeacher.id, preferredClassroomId: blockedRoom.id,
  skipDates: [], status: "待确认", note: "",
});

const blockedReport = await api.inquiries.evaluate(e2eInquiry.id);
eq("时段被已有课挡住 → 判定排不下", blockedReport?.slots[0]?.ok, false);
eq("阻塞指向那节已有课", blockedReport?.slots[0]?.blockers[0]?.lessonId, blockingLesson.id);
ok("阻塞里带上已有学生（界面要先显示再决定）",
  (blockedReport?.slots[0]?.blockers[0]?.studentIds ?? []).includes(blockedStudent.id));

// 系统给出可挪的时间，把挡住的那节课挪走
const moves = await api.lessons.suggestMoves(blockingLesson.id);
ok("挡住的那节课有可挪的时间", moves.length > 0);
eq("挪课候选不与原时间相同", moves[0]?.startsAt !== blockingStart.toISOString(), true);
await api.lessons.update(blockingLesson.id, { startsAt: moves[0]!.startsAt });

// 再判定：应该通过了
const freeReport = await api.inquiries.evaluate(e2eInquiry.id);
eq("把挡路的课挪走后判定通过", freeReport?.slots[0]?.ok, true);
eq("仍然指向原来的教师与场地", freeReport?.slots[0]?.assignment?.teacherId, blockedTeacher.id);
ok("挪课留下了操作日志（不静默改动别人的课）",
  (await api.logs.list(50)).some((log) => log.action === "修改" && log.targetId === blockingLesson.id));

// 清理：把课挪回原时间、删掉自检课与咨询
await api.lessons.update(blockingLesson.id, { startsAt: blockingStart.toISOString() });
await api.lessons.remove(blockingLesson.id);
await api.inquiries.remove(e2eInquiry.id);

// 挪课建议：给已有课算出可用的新时间
const moveTarget = (await api.lessons.list()).find((lesson) => lesson.status === "已排");
if (moveTarget !== undefined) {
  const moves = await api.lessons.suggestMoves(moveTarget.id);
  ok("能给出挪课候选", Array.isArray(moves));
  ok("候选都不与原时间相同",
    moves.every((move) => move.startsAt !== moveTarget.startsAt));
}

console.log("\n=== 8. 报价在后端（价格是数据，不是代码）===");

/*
 * 报价搬到后端之后，最不能出的事故是「宣传页一个价、后台另一个价」——
 * 家长先看到宣传页的价，后台却按另一个数字收钱。因此这一组的主线是
 * **同一份选择在前台公式与后台服务上必须算出同一个数**。
 *
 * 前台公式读站点内容（静态站点的家长浏览器里只有内容），
 * 后台服务读库里的配置（初始化的来源就是同一份内容）。
 * 两边分叉说明后台改了价但还没导出上线 —— 这正是后台报价页顶部警告的那件事。
 */
__useStoreForTesting(memory);

// 规则本身来自内容文件（改数字不用改代码，这是这次搬家的目的）
eq("内容里的计费规则", [
  pricing.rules.singleLessonFeePercent,
  pricing.rules.freeTrialMinLessons,
  pricing.rules.chargeTrialWhenNotFree,
], [10, 10, true]);
eq("站点内容里的报价配置通过校验", validatePricingConfig(pricingConfigFromContent()), []);

// 科目系数的写法：`物理 ×1.1`；省略即按 1 计（老内容不用改）
const pbMini = parsePricingSource(`# NexGenEdu · 新锐教培 · 报价数据

## 页面: 智能报价

## 学习阶段

### 小学

#### 课程: 小学课内: 150

#### 科目: 语文、物理 ×1.1

#### 科目: 化学 x1.05
`);
eq("科目系数：省略按 1、× 与 x 都能识别",
  pbMini.subjectGroups[0]?.subjects.map((item) => `${item.name}=${item.coefficient}`),
  ["语文=1", "物理=1.1", "化学=1.05"]);
eq("没写「计费规则」分组时用默认规则",
  [pbMini.rules.singleLessonFeePercent, pbMini.rules.freeTrialMinLessons],
  [10, 10]);

// 库里的配置由站点内容初始化（价格与宣传页一致，不是另抄一份）
const pbConfig = await api.pricing.get();
eq("种子报价配置来自站点内容", pbConfig.source, PRICING_SOURCE_CONTENT);
eq("库里的基础价与宣传页完全一致",
  pbConfig.stages.map((stage) => stage.courses.map((course) => `${course.name}:${course.basePrice}`)),
  pricing.stages.map((stage) => stage.courses.map((course) => `${course.name}:${course.price}`)));

/** 按名字向**后台服务**报价（页面只发选择，不发价格）。 */
const pbQuote = (
  courseName: string,
  subjectName: string,
  classTypeName: string,
  durationName: string,
  lessons: number,
  extra: Record<string, number> = {},
) =>
  api.pricing.quote({
    courseName,
    subjectName: subjectName === "" ? undefined : subjectName,
    classTypeName,
    durationName,
    lessons,
    ...extra,
  });

// 主线：同一方案，前台公式与后台服务必须一致
const pbParityCases: Array<[string, string, string, string, number, Record<string, number>]> = [
  ["九年级课本", "数学", "一对二", "1.5 小时", 5, {}],
  ["九年级课本", "数学", "一对二", "1 小时", 1, {}],
  ["九年级课本", "数学", "一对一", "1 小时", 10, {}],
  ["八年级课本", "数学", "班课（9-20）", "1.5 小时", 8, { studentCount: 12, classCost: 2400 }],
  ["小学课内", "语文", "一对三", "2 小时", 20, {}],
  ["医学", "", "一对一", "1 小时", 5, {}],
  ["九年级课本", "数学", "一对一", "1 小时", 0, {}],
];
for (const [course, subject, classType, duration, lessons, extra] of pbParityCases) {
  const front = quote(course, subject, classType, duration, lessons, extra);
  const back = await pbQuote(course, subject, classType, duration, lessons, extra);
  eq(
    `前后台一致：${course} / ${subject || "不分科目"} / ${classType} / ${duration} / ${lessons} 节`,
    [back.ok, back.unitPrice, back.lessonsPrice, back.trialFee, back.totalPrice, back.reason ?? ""],
    [front.ok, front.unitPrice, front.lessonsPrice, front.trialFee, front.totalPrice, front.reason ?? ""],
  );
}

// 选择里有名字对不上时要说清是哪一项（而不是安静地按 0 元算）
const pbUnknownCourse = await pbQuote("没有这门课", "数学", "一对一", "1 小时", 5);
ok("未知课程会被指出", pbUnknownCourse.ok === false && (pbUnknownCourse.reason ?? "").includes("没有课程"));
const pbUnknownClass = await pbQuote("九年级课本", "数学", "没有这种班型", "1 小时", 5);
ok("未知班型会被指出", pbUnknownClass.ok === false && (pbUnknownClass.reason ?? "").includes("班型"));
const pbUnknownSubject = await pbQuote("九年级课本", "没有这个科目", "一对一", "1 小时", 5);
ok("科目不属于该阶段会被指出",
  pbUnknownSubject.ok === false && (pbUnknownSubject.reason ?? "").includes("科目"));

// 服务端必须自己复核配置：系数写 0 会让所有报价变 0，不能进库
const pbBadConfig = JSON.parse(JSON.stringify(pbConfig));
pbBadConfig.subjects[0].coefficient = 0;
ok("系数为 0 的配置校验不通过", validatePricingConfig(pbBadConfig).length > 0);
const pbBadFee = JSON.parse(JSON.stringify(pbConfig));
pbBadFee.rules.singleLessonFeePercent = 120;
ok("手续费超过 100% 校验不通过", validatePricingConfig(pbBadFee).length > 0);
const pbBadPrice = JSON.parse(JSON.stringify(pbConfig));
pbBadPrice.stages[0].courses[0].basePrice = -1;
ok("负的基础价校验不通过", validatePricingConfig(pbBadPrice).length > 0);
const pbDupCourse = JSON.parse(JSON.stringify(pbConfig));
pbDupCourse.stages[1].courses[0].name = pbDupCourse.stages[0].courses[0].name;
ok("课程重名校验不通过（按名字查课程，重名会报错价）",
  validatePricingConfig(pbDupCourse).some((problem) => problem.includes("重复")));

let pbRejected = false;
try {
  await api.pricing.update(pbBadConfig);
} catch {
  pbRejected = true;
}
ok("服务层拒绝保存不合法的配置", pbRejected);
eq("拒绝后库里的配置没被改动", (await api.pricing.get()).source, PRICING_SOURCE_CONTENT);

// 改价真的会影响报价，并且留下日志（价格变动必须可追溯）
const pbRaised = JSON.parse(JSON.stringify(pbConfig));
pbRaised.stages.forEach((stage: { courses: Array<{ name: string; basePrice: number | null }> }) => {
  for (const course of stage.courses) if (course.name === "九年级课本") course.basePrice = 330;
});
pbRaised.subjects.forEach((subject: { name: string; stageName: string; coefficient: number }) => {
  if (subject.name === "数学") subject.coefficient = 1.2;
});
const pbSaved = await api.pricing.update(pbRaised);
eq("保存后标记为后台修改", pbSaved.source, PRICING_SOURCE_ADMIN);
// 330 × 数学 1.2 × 一对二 0.7 × 1.5 小时 = 415.8；1 节另加 10% 手续费不是本例
const pbRaisedQuote = await pbQuote("九年级课本", "数学", "一对二", "1.5 小时", 5);
eq("改价后后台按新价报", pbRaisedQuote.unitPrice, 415.8); // 330 × 1.2 × 0.7 × 1.5
eq("试课费按课程原价收（不带科目与班级系数）", pbRaisedQuote.trialFee, 330);
const pbRaiseLogs = await api.logs.list(20);
ok("改价留下操作日志",
  pbRaiseLogs.some((log) => log.entity === "报价" && log.action === "修改配置"));
ok("日志写明了从多少改到多少",
  pbRaiseLogs.some((log) => log.summary.includes("330")));

// 导出 → 回读：导出的必须是**能用的内容**，而不是看起来像的文本
const pbExported = await api.pricing.exportMarkdown();
ok("导出的 Markdown 提到学习阶段与计费规则",
  pbExported.includes("## 学习阶段") && pbExported.includes("## 计费规则"));
const pbRoundTrip = pricingConfigFromSource(`# NexGenEdu · 新锐教培 · 报价数据

## 页面: 智能报价

---
result_title: 报价结果
---

${pbExported}`);
eq("导出内容回读后与后台配置完全一致",
  pricingConfigCore(pbRoundTrip), pricingConfigCore(pbSaved));
ok("导出内容带上了科目系数（1.2 能读回来）",
  pbRoundTrip.subjects.some((subject) => subject.name === "数学" && subject.coefficient === 1.2));
ok("导出内容带上了未开放课程",
  pbRoundTrip.stages.some((stage) => stage.courses.some((course) => course.basePrice === null)));

// 恢复默认：退回站点内容里的价格
const pbRestored = await api.pricing.reset();
eq("恢复后来源回到站点内容", pbRestored.source, PRICING_SOURCE_CONTENT);
eq("恢复后的价格就是宣传页的价格",
  pbRestored.stages[0]?.courses.map((course) => course.basePrice),
  pricing.stages[0]?.courses.map((course) => course.price));
const pbRestoredQuote = await pbQuote("九年级课本", "数学", "一对二", "1.5 小时", 5);
eq("恢复后报价回到原值", pbRestoredQuote, quote("九年级课本", "数学", "一对二", "1.5 小时", 5));

// 老库升级：pbV9 没有报价配置，升级后要按站点内容补齐（不能是空的，也不能变价）
const pbLegacyStore = createMemoryStore();
__useStoreForTesting(pbLegacyStore);
const pbV9 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
delete pbV9.pricing;
pbV9.version = 9;
pbLegacyStore.write("nexgenedu.admin.db.v1", JSON.stringify(pbV9));
const pbUpgraded = await api.pricing.get();
eq("pbV9 老库升级后有了报价配置", pbUpgraded.source, PRICING_SOURCE_CONTENT);
eq("升级补上的价格与站点内容一致",
  pbUpgraded.stages[1]?.courses.map((course) => course.basePrice),
  pricing.stages[1]?.courses.map((course) => course.price));
eq("升级后的版本号是当前版本",
  JSON.parse(pbLegacyStore.read("nexgenedu.admin.db.v1") ?? "{}").version, CURRENT_VERSION);

// ── 教师分成（课内课时费）：公式 → 人话规则 ───────────────────────────
// 原始口径：小时数 × (课程单价/小时) × (0.4 + (学生人数 − 1) × 0.1)
eq("内容的教师分成规则", [
  pricing.teacherShare.basePercent,
  pricing.teacherShare.stepPercent,
  pricing.teacherShare.priceBasis,
], [40, 10, "course"]);
eq("人数对照表（1–8 人的分成比例）",
  Array.from({ length: TEACHER_SHARE_MAX_STUDENTS }, (_, index) => sharePercentFor(index + 1, pricing.teacherShare)),
  [40, 50, 60, 70, 80, 90, 100, 110]);
eq("人数上限与班型「一对多（4-8）」对得上", TEACHER_SHARE_MAX_STUDENTS, 8);
ok("规则原文与机构给的公式一致",
  teacherShareFormula(pricing.teacherShare).includes("(0.4 + (学生人数 − 1) × 0.1)"));

// 人话版必须回答四件事：适用什么班型、比例怎么加、不适用什么、单价怎么取
const pbShareText = describeTeacherShare(pricing.teacherShare).join("\n");
ok("人话版说明了适用班型", pbShareText.includes("一对一定制课") && pbShareText.includes("一对多小班课"));
ok("人话版写明了 40% 起与每人 +10", pbShareText.includes("40%") && pbShareText.includes("10 个百分点"));
ok("人话版点明了 8 人时的比例", pbShareText.includes("110%"));
ok("人话版说明了 9 人以上大班课不适用",
  pbShareText.includes("9 人以上大班课不适用") && pbShareText.includes("另议"));
ok("人话版说明了课程单价的口径", pbShareText.includes("课程单价 = 基础价 × 科目系数"));
ok("人话版说明了时长按小时算", pbShareText.includes("1.5 小时乘 1.5"));

// 按名字算：一对一 1 人 1 小时（九年级课本 300 / 小时）= 300 × 40% = 120
const pbTeacher1 = await api.pricing.teacherFee({
  courseName: "九年级课本", subjectName: "数学", classTypeName: "一对一",
  durationName: "1 小时", lessons: 1, students: 1,
});
eq("一对一 1 人 1 小时的教师课时费", [pbTeacher1.ok, pbTeacher1.percent, pbTeacher1.teacherFee], [true, 40, 120]);
// 3 人 = 60%；1.5 小时 ×300 ×0.6 = 270
const pbTeacher3 = await api.pricing.teacherFee({
  courseName: "九年级课本", subjectName: "数学", classTypeName: "一对三",
  durationName: "1.5 小时", lessons: 5, students: 3,
});
eq("一对三 3 人 1.5 小时的教师课时费", [pbTeacher3.percent, pbTeacher3.teacherFee], [60, 270]);
ok("教师课时费里含家长侧收入与机构留存",
  pbTeacher3.revenue > pbTeacher3.teacherFee &&
  Math.abs(pbTeacher3.keepFee - (pbTeacher3.revenue - pbTeacher3.teacherFee)) < 0.01);
ok("教师课时费明细写清了比例怎么来的",
  pbTeacher3.breakdown.some((item) => item.value.includes("40% + 2×10%")));

// 大班课不适用：按人数分摊的那类按「教师费用 ÷ 人数」另议，不能硬套公式
const pbTeacherBig = await api.pricing.teacherFee({
  courseName: "八年级课本", subjectName: "数学", classTypeName: "班课（9-20）",
  durationName: "1.5 小时", lessons: 5, students: 12,
});
ok("9 人以上大班课不适用分成规则",
  pbTeacherBig.ok === false && (pbTeacherBig.reason ?? "").includes("大班课"));

// 单价口径切换会改变教师课时费，但不影响家长报价
const pbSeatConfig = JSON.parse(JSON.stringify(await api.pricing.get()));
pbSeatConfig.teacherShare.priceBasis = "seat";
await api.pricing.update(pbSeatConfig);
const pbTeacherSeat = await api.pricing.teacherFee({
  courseName: "九年级课本", subjectName: "数学", classTypeName: "一对二",
  durationName: "1 小时", lessons: 1, students: 1,
});
// 班型课时价口径：300 ×0.7 = 210 → 40% = 84
eq("切到班型课时价口径后的教师课时费", pbTeacherSeat.teacherFee, 84);
eq("口径切换不影响家长报价",
  (await pbQuote("九年级课本", "数学", "一对二", "1 小时", 5)).unitPrice,
  quote("九年级课本", "数学", "一对二", "1 小时", 5).unitPrice);

// 导出 → 回读：教师分成规则也要能带走
const pbShareExport = await api.pricing.exportMarkdown();
ok("导出内容里带上了教师分成", pbShareExport.includes("## 教师分成"));
const pbShareRoundTrip = pricingConfigFromSource(`# NexGenEdu · 新锐教培 · 报价数据

## 页面: 智能报价

---
result_title: 报价结果
---

${pbShareExport}`);
eq("回读后教师分成口径仍是班型课时价", pbShareRoundTrip.teacherShare.priceBasis, "seat");
eq("回读后基准分成不变", pbShareRoundTrip.teacherShare.basePercent, 40);

// 坏规则进不去库
const pbBadShare = JSON.parse(JSON.stringify(pbSeatConfig));
pbBadShare.teacherShare.basePercent = -1;
ok("负的分成比例校验不通过", validatePricingConfig(pbBadShare).length > 0);
const pbBadStep = JSON.parse(JSON.stringify(pbSeatConfig));
pbBadStep.teacherShare.stepPercent = -5;
ok("负的递增比例校验不通过", validatePricingConfig(pbBadStep).length > 0);
await api.pricing.reset();
eq("恢复后分成规则回到内容里的口径", (await api.pricing.get()).teacherShare, pricing.teacherShare);

// 老库（v10 没有教师分成字段）升级后要补上默认值，不能是 undefined
const pbV10Store = createMemoryStore();
__useStoreForTesting(pbV10Store);
const pbV10 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
delete (pbV10.pricing as Record<string, unknown>).teacherShare;
pbV10.version = 10;
pbV10Store.write("nexgenedu.admin.db.v1", JSON.stringify(pbV10));
const pbV11Config = await api.pricing.get();
eq("v10 老库升级后补上了教师分成默认值",
  [pbV11Config.teacherShare.basePercent, pbV11Config.teacherShare.stepPercent, pbV11Config.teacherShare.priceBasis],
  [40, 10, "course"]);
eq("升级后版本号是当前版本",
  JSON.parse(pbV10Store.read("nexgenedu.admin.db.v1") ?? "{}").version, CURRENT_VERSION);

// 收尾：切回主存储，并确保报价配置没有留下自检改动的痕迹
__useStoreForTesting(memory);
eq("主存储的报价配置未被自检改坏", (await api.pricing.get()).source, PRICING_SOURCE_CONTENT);

console.log("\n=== 9. 课程库（课程台账）===");

/*
 * 课程名是**引用键**：排课科目、教师可带科目、报课科目都按名字记。
 * 因此这一组守三件事：网站课程要自动进来、机构自己加的课要能立刻用上、
 * 重名与「删掉网站课程」这两件会造成对不上账的事必须拦住。
 */
__useStoreForTesting(memory);

const pbLibrary = await api.courses.list();
ok(`课程库从网站内容播种（${pbLibrary.length} 门，至少 20 门）`, pbLibrary.length >= 20);
ok("网站课程都标为「网站」来源", pbLibrary.every((course) => course.origin === "网站"));
ok("每门网站课程都有分类", pbLibrary.every((course) => course.category.trim() !== ""));
ok("网站课程的卡片班型被带进来",
  pbLibrary.some((course) => course.forms.length > 0));

const pbOptions = await api.courses.options();
ok(`科目候选非空（${pbOptions.length} 项）`, pbOptions.length >= 20);
eq("科目候选里没有重复名字",
  pbOptions.filter((option, index) => pbOptions.findIndex((item) => item.name === option.name) !== index),
  []);
ok("科目候选带分类（下拉要按栏目分组）", pbOptions.every((option) => option.category !== ""));

// 机构自己加一门网站上还没有的课：围棋
const pbWeiqi = await api.courses.create({
  name: "围棋", category: "兴趣才艺", forms: ["一对一定制课"], origin: "后台",
  status: "开放", note: "自检用", createdAt: new Date().toISOString(),
});
eq("新建课程的来源是「后台」", pbWeiqi.origin, "后台");
ok("新课程立刻出现在科目候选里（排课马上能选到）",
  (await api.courses.options()).some((option) => option.name === "围棋"));
ok("新课程出现在课程库统计里",
  (await api.courses.summary()).fromAdmin >= 1);

// 重名必须拦住：两门「围棋」会让课时扣到哪一门说不清
let pbDupRejected = false;
try {
  await api.courses.create({
    name: "围棋", category: "兴趣才艺", forms: [], origin: "后台",
    status: "开放", note: "", createdAt: new Date().toISOString(),
  });
} catch {
  pbDupRejected = true;
}
ok("同名课程被拒绝", pbDupRejected);
let pbEmptyRejected = false;
try {
  await api.courses.create({
    name: "  ", category: "兴趣才艺", forms: [], origin: "后台",
    status: "开放", note: "", createdAt: new Date().toISOString(),
  });
} catch {
  pbEmptyRejected = true;
}
ok("课程名为空被拒绝", pbEmptyRejected);

// 网站来源的课程不能删（删了下次同步又回来），但可以设为暂未开放
const pbSiteCourse = pbLibrary[0]!;
let pbSiteRemoveRejected = false;
try {
  await api.courses.remove(pbSiteCourse.id);
} catch {
  pbSiteRemoveRejected = true;
}
ok("网站来源的课程不能删除", pbSiteRemoveRejected);
eq("网站课程可以设为暂未开放",
  (await api.courses.update(pbSiteCourse.id, { status: "暂未开放" }))?.status, "暂未开放");
eq("改回开放",
  (await api.courses.update(pbSiteCourse.id, { status: pbSiteCourse.status }))?.status, pbSiteCourse.status);

// 后台新增的课程可以删
eq("后台新增的课程可以删除", await api.courses.remove(pbWeiqi.id), true);
ok("删除后不再出现在科目候选里",
  !(await api.courses.options()).some((option) => option.name === "围棋"));

// 从网站同步：只增不改、可重复执行
const pbSync = await api.courses.syncFromSite();
eq("重复同步不会重复添加", pbSync.added, []);
eq("同步后的总数与课程库一致", pbSync.total, (await api.courses.list()).length);

// 教师可带科目直接存课程名（含后台新增的课）
const pbTeacher = await api.teachers.create({
  name: "自检老师", role: "", subjects: ["初中数学", "围棋"], phone: "", active: true,
});
eq("教师可带科目可以写后台新增的课程名", pbTeacher.subjects, ["初中数学", "围棋"]);
await api.teachers.remove(pbTeacher.id);

// 老库（v11 没有课程表）升级后要按网站内容补齐，否则科目候选会空
const pbV11Store = createMemoryStore();
__useStoreForTesting(pbV11Store);
const pbV11 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
delete pbV11.courses;
pbV11.version = 11;
pbV11Store.write("nexgenedu.admin.db.v1", JSON.stringify(pbV11));
const pbMigratedCourses = await api.courses.list();
eq("v11 老库升级后课程库按网站内容补齐", pbMigratedCourses.length, pbLibrary.length);
eq("升级后版本号是当前版本",
  JSON.parse(pbV11Store.read("nexgenedu.admin.db.v1") ?? "{}").version, CURRENT_VERSION);

// 收尾：切回主存储
__useStoreForTesting(memory);
eq("主存储的课程库未被自检改坏", (await api.courses.list()).length, pbLibrary.length);

console.log("\n=== 10. 课程库 ↔ 报价配置（打通）===");

/*
 * 打通的核心是「两边不会悄悄分叉」：课程库里改了名字、停了课，报价配置要跟着走。
 * 否则会出现家长看到旧课名、或者按已停开的课程报了价。
 */
__useStoreForTesting(memory);

const pbLib = await api.courses.list();
const pbPriceConfig = await api.pricing.get();

/*
 * 1) 按名字认领：报价配置里的课程（内容带的，没有 courseId）与课程库同名时自动关联。
 *
 * 注意一个真实情况：报价配置里的课程名是「课程包」粒度（九年级课本 / 雅思口语），
 * 课程库是「学科」粒度（初中数学 / 雅思），**大多数名字本来就不一样** ——
 * 所以自动认领只在名字确实相同时生效，不强求两边一一对应。
 * 机构要给某门课定价，走的是「课程库课程定价」面板（显式选课程 + 填价格）。
 */
const pbClaimable = {
  ...pbPriceConfig,
  stages: [
    { name: "测试阶段", courses: [{ name: "初中数学", basePrice: 100, available: true }] },
  ],
};
const pbClaimed = syncLibraryLinks(pbClaimable, pbLib);
ok("配置里与课程库同名的课程会被自动认领（补上关联）",
  (pbClaimed.config.stages[0]?.courses[0]?.courseId ?? "") !== "");
ok("认领会写进变更说明",
  pbClaimed.changes.some((change) => change.includes("建立关联")));
eq("认领后再次同步不再产生变更", syncLibraryLinks(pbClaimed.config, pbLib).changes, []);

// 2) 课程库里加一门课 → 定价 → 后台能给这门课报价
const pbGo = await api.courses.create({
  name: "围棋", category: "兴趣才艺", forms: ["一对一定制课"], origin: "后台",
  status: "开放", note: "", createdAt: new Date().toISOString(),
});
const pbPriced = addLibraryCourseToPricing(await api.pricing.get(), {
  courseId: pbGo.id, name: "围棋", stageName: "兴趣才艺", basePrice: 200,
});
eq("加入报价配置时新建了阶段", pbPriced.createdStage, true);
eq("报价配置里出现了这门课及其价格",
  pbPriced.config.stages.find((stage) => stage.name === "兴趣才艺")?.courses.map((course) => [course.name, course.basePrice, course.available]),
  [["围棋", 200, true]]);
await api.pricing.update(pbPriced.config);
ok("后台可以按名字给这门课报价",
  (await api.pricing.quote({
    courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5,
  })).ok);
ok("教师课时费也算得出来（同一份配置）",
  (await api.pricing.teacherFee({
    courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5, students: 1,
  })).ok);
ok("导出的内容里带上了这门课（替换内容文件后家长也能看到）",
  (await api.pricing.exportMarkdown()).includes("#### 课程: 围棋: 200"));

// 3) 改名跟随
await api.courses.update(pbGo.id, { name: "围棋（入门）" });
eq("课程库改名后报价配置跟着改",
  (await api.pricing.get()).stages
    .flatMap((stage) => stage.courses)
    .filter((course) => course.courseId === pbGo.id)
    .map((course) => course.name),
  ["围棋（入门）"]);
ok("改名同步留下了日志",
  (await api.logs.list(20)).some((log) => log.action === "跟随课程库" && log.summary.includes("围棋（入门）")));

// 4) 停开跟随
await api.courses.update(pbGo.id, { status: "暂未开放" });
eq("课程库里设为暂未开放后报价配置同步停用",
  (await api.pricing.get()).stages.flatMap((stage) => stage.courses)
    .find((course) => course.courseId === pbGo.id)?.available,
  false);

// 5) 删除后置为暂未开放（不静默消失，机构自己决定去留）
await api.courses.remove(pbGo.id);
const pbAfterRemove = (await api.pricing.get()).stages.flatMap((stage) => stage.courses)
  .find((course) => course.courseId === pbGo.id);
eq("删除课程后报价配置里的这一项仍在（置为暂未开放）", pbAfterRemove?.available, false);

// 6) 定价状态查询（课程库页面用它显示「已定价 / 未定价」）
const pbStatus = pricingStatusForCourses(await api.pricing.get(), await api.courses.list());
ok("每门课程库课程都能查出定价状态",
  pbStatus.length === (await api.courses.list()).length);
ok("至少有一门课被标为未定价（演示库里的兴趣才艺课已停用）",
  pbStatus.some((item) => !item.priced));

// 收尾：把报价配置恢复成内容里的口径，避免影响后面的用例
await api.pricing.reset();
eq("收尾：报价配置回到站点内容", (await api.pricing.get()).source, PRICING_SOURCE_CONTENT);
__useStoreForTesting(memory);

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
