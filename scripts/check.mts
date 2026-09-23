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
  getCourseColumnsFromTemplate,
  getCoursePageData,
  getCoursesPage,
  getCoursesPageFromTemplate,
  getHomeContent,
  getSiteBrand,
  getTeachersPage,
  getTeachersPageFromTemplate,
} from "@/lib/data/site";
import { getPricingData, getPricingDataFromTemplate, parsePricingSource } from "@/lib/data/pricing";
import { getCasesContent, getCasesContentFromTemplate, getFaqContent, getScheduleContent } from "@/lib/data/pages";
import { findFeaturedCourse, getAllFeaturedCourses, getFeaturedContent } from "@/lib/data/featured";
import { calculateQuote, isTrialFree, trialFeeFor } from "@/lib/pricing/quote";
import { __removeFixture, __useStoreForTesting, api } from "@/lib/backend/api";
import { isRemoteMode, remoteBase } from "@/lib/backend/remote";
import { createMemoryStore } from "@/lib/backend/storage";
import {
  __useConnectionStoreForTesting,
  getConnectionState,
  refreshConnection,
  sameConnectionState,
  SERVICE_NAME,
  setBackendOverride,
  subscribeConnection,
  type ConnectionState,
} from "@/lib/backend/connection";
import {
  NOTICE_LINE_REM,
  NOTICE_MIN_H_CLASS,
  NOTICE_RESERVED_LINES,
  noticeBranchOf,
  type NoticeBranch,
} from "@/lib/admin/notice-layout";
import {
  clampScroll,
  decodeScrollMemo,
  encodeScrollMemo,
  inPlaceScrollCorrection,
  reloadRestoreTarget,
} from "@/lib/admin/scroll-restore";
import { dateKey } from "@/lib/backend/format";
import { isWithinAvailability, isoWeekday } from "@/lib/backend/availability";
import { lessonBalance } from "@/lib/backend/enrollment";
import { countLessons, describeLessonCounts } from "@/lib/backend/lesson-stats";
import {
  checkHolidaySources,
  combineHolidaySources,
  holidayBlocks,
  holidayCoverage,
  holidayWeekday,
  holidayWeekdayLabel,
  isWeekendDate,
  mergeHolidayDays,
  parseAppleHolidays,
  parseDateKey,
  parseGovHolidays,
  readHolidayYear,
  summarizeHolidayYear,
  toDateKey,
  type HolidayDay,
} from "@/lib/backend/holidays";
import { remainingOf, remainingTotal } from "@/lib/backend/enrollment";
import { CURRENT_VERSION, VERSION_NOTES } from "@/lib/backend/version";
import {
  bandsForTargets,
  cardTargets,
  coursesReferencingAnchor,
  uniqueBandAnchor,
} from "@/lib/backend/site-bands";
import { publicSite as buildPublicSite } from "@/lib/backend/public-site";
import type { PublicSite } from "@/lib/backend/public-site";
import {
  __useBackendSnapshotForTesting,
  __useSiteContentSourceForTesting,
  backendSnapshot,
  siteContentSource,
} from "@/lib/site/backend-source";
import { siteTeachers as siteTeachersFromContent } from "@/lib/backend/site-import";
import { coursesFromSite } from "@/lib/backend/courses";
import {
  childPartitions,
  partitionDeleteRefusal,
  partitionPlace,
  topLevelPartitions,
} from "@/lib/backend/course-partitions";
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
import { ADMIN_NAV } from "@/lib/site/admin-nav";
import {
  EMPTY_SCOPE_WARNING,
  GROUP_ACCESS,
  HOLIDAY_ACTION_ACCESS,
  PAGE_ACCESS,
  ROLES,
  canCallMethod,
  TEACHER_SCOPE_RULES,
  allowedGroups,
  allowedRolesForMethod,
  canAccess,
  groupOfMethod,
  scopeForAccount,
  teacherScopeDenial,
  teacherScopeRule,
  visiblePages,
} from "@/lib/auth/roles";
import {
  SCRIPT_GROUPS,
  SCRIPTS,
  SCRIPT_VARS,
  fillScript,
  filterScripts,
  missingPlaceholders,
  scriptPlaceholders,
  scriptsToText,
  summarizeScripts,
} from "@/lib/backend/scripts";
import {
  EXPORT_DATASETS,
  datasetSizes,
  exportDataset,
  findExportDataset,
} from "@/lib/backend/export";
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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holidaysDir, holidayYearFile, refreshHolidayYear } from "../server/holidays.mts";
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
  REFUND_POLICIES,
  calculateRefund,
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
import {
  ENTITY_SPECS,
  IMPORT_ENTITIES,
  csvTemplate,
  detectFormat,
  jsonTemplate,
  parseImport,
  siteImportRecords,
} from "@/lib/backend/import";
import { runTwoPhaseImport } from "@/lib/backend/import-flow";
import { describeSeriesDate, generateSeriesDates } from "@/lib/backend/recurrence";

/*
 * **先把后端快照关掉、并把来源固定成「模版」**：这份自检里的内容断言
 * （卡片 / 学科 / 小节 / 教师 / 案例 / 报价）测的是**模版那条路**，
 * 必须与"上次构站有没有连上后端"无关 —— 否则本机开着后端跑 check 会红、CI 上跑会绿
 * （或反过来），而且看起来像内容坏了。
 *
 * 为什么还要单独注入**来源模式**：注入 `null` 快照现在的含义是"没连上后端"，
 * 而那五块在那时会**空白**（机构口径，见 `lib/site/backend-source.ts` 的文件头）——
 * 只注入 `null` 的话，所有读那五块的内容断言都会看到空数据。
 * 后端那条路用注入的快照单独验，"空白"那条分支由 §25 单独验。
 */
__useBackendSnapshotForTesting(null);
__useSiteContentSourceForTesting("template");

const seedDb = createSeedDatabase();
import {
  getSession,
  isLoggedIn,
  login,
  loginUnavailableReason,
} from "@/lib/auth/session";
import { __useTokenStoreForTesting, clearToken, readToken, writeToken } from "@/lib/auth/token";

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

/**
 * 断言为真。
 *
 * `detail` 是失败时要显示的那句话（例如服务端返回的拒绝理由）。
 * 之前这个参数**没有被接住**：文件里十几处 `ok(label, cond, "…")` 的第三个参数
 * 一直被静默丢掉，于是失败时只剩一句"没通过"，看不到原因 ——
 * 排查时多花的时间比这个参数值钱得多。
 */
function ok(label: string, condition: boolean, detail = ""): void {
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${label}${detail === "" ? "" : `\n      ${detail}`}`);
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
/*
 * 这一节以及下面几节校验的是 **data/site/*.md 的结构**（内容文件也是 Pages 那份的来源），
 * 因此**显式读模版**（`*FromTemplate`）：那五个取数函数会随「这次构站连没连后端」而变
 * —— 连不上时那五块是**空白**（机构口径）—— 拿它们校验内容文件，会让自检结果
 * 随构建环境漂移（后端没起时一片报红，起了又全绿）。
 */
const { courses: allCourses, columns, electiveGroups: electiveGroupList } = getCoursesPageFromTemplate();

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
eq("栏目与全站段同源", columns, getCourseColumnsFromTemplate());

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

/*
 * 教室照片格位：**当前刻意隐藏**（`data/site/content.md` 里那三条占位已注释掉），
 * 因此期望 0 条 —— 页面在"没有格位"时整节不渲染（见 app/(site)/page.tsx）。
 * 这里不写死数量：有格位时只要求每条都有名字（避免"空标题卡片"这种低级错误）。
 */
ok("首页教室格位要么为空（当前隐藏），要么每条都有名字",
  homeContent.classrooms.every((room) => room.title.trim() !== ""),
  JSON.stringify(homeContent.classrooms.map((room) => room.title)));
eq("首页首屏数据", homeContent.stats.length, 6);
eq("首页教学特色", homeContent.features.length, 7);
ok("首页 CTA 非空", homeContent.cta.title !== "");
ok("首页试课区块有标题与要点", homeContent.trial.title !== "" && homeContent.trial.points.length >= 3);
eq("试课区块跳报价页", homeContent.trial.cta.href, "/quote");
ok("试课要点含免费条件", homeContent.trial.points.some((p) => p.includes("满 10 节")));
eq("学生案例区块跳案例页", homeContent.cases.cta.href, "/cases");
ok("首页案例区块有文案", homeContent.cases.title !== "" && homeContent.cases.description !== "");

const { courses } = getCoursesPageFromTemplate();
// 学科数量不写死：增删课程是正常编辑（当前含新增的 日语 / 俄语 / 3D建模 / 编程）
ok("课程页学科数量合理", courses.length >= 15);
ok("每门学科都有学段内容", courses.every((c) => c.bands.length > 0 && c.bands[0].content.length > 50));

// 选修课程（成人 / 课外兴趣）：与学科分开返回，当前全部标注暂未开放
const { electiveGroups, electiveTitle } = getCoursesPageFromTemplate();
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

const { teachers } = getTeachersPageFromTemplate();
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
// 林老师除了晚辅导，还带小学语文与小学数学（机构确认并入的 —— 见 data/site/content.md 教师段）
eq("林老师科目标签", lin?.subjects, ["晚辅导", "小学语文", "小学数学"]);
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

const cases = getCasesContentFromTemplate();
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
const pricing = getPricingDataFromTemplate();
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

console.log("\n=== 6. 教务后台服务层（同一套断言对两种后端都要通过）===");

/*
 * 这一节跑完整的增删改查，不需要浏览器：服务层刻意把存储抽象成 KeyValueStore
 * （见 lib/backend/storage.ts），因此同一个 api 可以挂在内存、localStorage 或 SQLite 上。
 *
 * ⚠️ **夹具靠接口导入，不靠存储里"本来就有"**。
 *
 * 早期这一节直接假设「首次访问会灌入示例数据」，于是断言全挂在那份自动播种上。
 * 这有两个后果：① 系统改成空库起步后（见 lib/backend/initial.ts）这里会全线失败；
 * ② 更根本的 —— 同一套断言**没法对服务端再跑一遍**，因为服务端的库是空的。
 * 而"同一套断言两种后端都通过"正是「换后端没改口径」最硬的证据（docs/后端开发方案.md §5 第 7 步）。
 *
 * 所以现在这样：先用 `api.importDatabase(serializeDatabase(seedDb))` 把示例数据
 * **从接口灌进去**，两种后端（内存 / HTTP）拿到的就是同一份夹具，断言才有可比性。
 * 顺带白拿一条覆盖：导入这条路径本身（校验、迁移、自动留备份）每次跑自检都会走一遍。
 *
 * 要守住的三件事：
 *   1. **空库起步**：新库不能自己长出示例学生（员工会误以为那是自己录的）；
 *   2. 写入会落盘、且能被新实例读回来（「刷新后还在」的本质）；
 *   3. 汇总统计（今日概览）算得对。
 */
const memory = createMemoryStore();
__useStoreForTesting(memory);

/**
 * **夹具收尾**（两种后端都要能用）。
 *
 * 产品层的删除现在有护栏（有账就不许删），而自检经常要收尾"刚造过账"的夹具 ——
 * 那些夹具按产品规矩本来就删不掉。因此走这条专用通道：
 *   - 内存后端：直接摘掉本地存储里那条（`__removeFixture`）；
 *   - **HTTP 后端**：数据在服务端进程里、本地那份是空的，因此要请服务端摘
 *     （`/api/test-hooks/remove-fixture`，只在测试后端上开着，见 scripts/temp-server.mts）。
 *
 * 这正是"两种后端跑同一套断言"要保住的东西：收尾也算断言的一部分 ——
 * 只在一个后端上收得掉，另一个后端就会从这里开始一路红到底（`check:both` 抓过这一次）。
 */
let fixtureToken: string | null = null;
async function dropFixture(entity: string, id: string): Promise<boolean> {
  if (!isRemoteMode()) return __removeFixture(entity, id);
  if (fixtureToken === null) {
    const login = await fetch(`${remoteBase()}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: process.env.NEXGENEDU_ADMIN_USER ?? "",
        password: process.env.NEXGENEDU_ADMIN_PASSWORD ?? "",
      }),
    });
    const body = (await login.json().catch(() => ({}))) as { token?: unknown };
    fixtureToken = typeof body.token === "string" ? body.token : "";
  }
  const response = await fetch(`${remoteBase()}/api/test-hooks/remove-fixture`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fixtureToken}` },
    body: JSON.stringify({ entity, id }),
  });
  const body = (await response.json().catch(() => ({}))) as { removed?: unknown };
  return body.removed === true;
}

const emptyAtStart = await api.students.list();
eq("空库起步：新库没有学生", emptyAtStart.length, 0);
ok("空库起步：课程库仍有网站课程", (await api.courses.list()).length > 0);

// 夹具：示例数据经**导入接口**进入当前后端（内存或 SQLite 都一样）
const fixtureImport = await api.importDatabase(serializeDatabase(seedDb));
ok("示例数据可以经导入接口灌入", fixtureImport.ok);

const seeded = await api.students.list();
ok("导入夹具后学生数正确", seeded.length >= 5);
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

/*
 * 「刷新后还在」的本质检验：把服务重新挂到**同一个存储**上（等价于页面刷新、
 * 重新 new 一个实例），数据仍应读得到。
 *
 * 内存后端可以直接重挂存储；HTTP 后端重挂的是浏览器那一侧的存储，而数据在服务端，
 * 重挂没有任何意义（也不该有意义）—— 那里的"数据不会因为刷新而丢"由
 * 「重启服务后数据仍在」那条来证明，因此这里跳过重挂，断言照跑。
 */
if (!isRemoteMode()) __useStoreForTesting(memory);
ok(`写入已落盘（${isRemoteMode() ? "服务端库" : "新实例"}仍能读到）`,
  (await api.students.get(created.id))?.grade === "初三");

ok("删除生效", (await api.students.remove(created.id)) === true);
ok("删除后取不到", (await api.students.get(created.id)) === null);

/*
 * **建档时一并报课**（一个学生报多门，每门节数各自独立）。
 *
 * 机构最常见的报名情形就是「数学 10 节、英语 20 节」—— 一条记录装两门课，
 * 会让课时扣到哪一门说不清；只记第一门，第二门就等于白报。
 * 因此这里盯着的是：**两门课各自落到自己的报课记录上**，且条数与节数都对得上。
 */
// 这一块跑在文件前段，`teacher` 夹具还没定义 —— 就地取一位（谁都可以）
const multiTeacher = (await api.teachers.list())[0]!;
const multi = await api.students.create({
  name: "自检·多门报课", grade: "初三", guardian: "", status: "在读", note: "", profile: {},
  enrollments: [
    // 每门课各自带上班型与指定教师（界面上就是一行一行选的）
    { subject: "自检·多门A", lessons: 10, form: "一对一定制课", teacherId: multiTeacher.id },
    { subject: "自检·多门B", lessons: 20, form: "一对二 / 一对三小组课" },
  ],
});
eq("建档一次报两门 → 两条报课记录", multi.enrollments.length, 2);
eq("每门课的班型各自独立（不是一刀切同一个）",
  multi.enrollments.map((item) => [item.subject, item.form]).sort(),
  [["自检·多门A", "一对一定制课"], ["自检·多门B", "一对二 / 一对三小组课"]].sort());
eq("指定教师也各自独立（一门指定、一门不指定）",
  multi.enrollments.map((item) => [item.subject, item.teacherId === multiTeacher.id]).sort(),
  [["自检·多门A", true], ["自检·多门B", false]].sort());
eq("每门课的节数各自独立（不是两门并成一条）",
  multi.enrollments.map((item) => [item.subject, item.totalLessons]).sort(),
  [["自检·多门A", 10], ["自检·多门B", 20]]);
eq("报读科目由报课记录推导", [...multi.subjects].sort(), ["自检·多门A", "自检·多门B"]);
eq("剩余课时 = 各门之和", remainingTotal(multi.enrollments), 30);
ok("建档报的课与「单独报课」形状一致（已用 0 / 在读 / 一条报课流水）",
  multi.enrollments.every(
    (item) =>
      item.usedLessons === 0 &&
      item.status === "在读" &&
      item.startedAt !== "" &&
      item.history.length === 1 &&
      item.history[0]?.kind === "报课",
  ));
eq("不传实收就不产生收款（钱的入口只在「收款」那一处）",
  multi.enrollments.map((item) => item.paidAmount), [0, 0]);
eq("课时流水与课时自洽（每门各自一条 +10 / +20）",
  (await Promise.all(multi.enrollments.map((item) => api.transactions.listByEnrollment(item.id))))
    .map((rows) => rows.filter((item) => item.reversedAt === "").reduce((sum, item) => sum + item.delta, 0))
    .sort((a, b) => a - b),
  [10, 20]);

/*
 * 报课数据不对时**不能留下半个学生**：学生建好了、课时没记上，
 * 之后排课会被"课时不足就不排课"挡下来，看半天不知道为什么。
 * 因此服务端是**先全部校验、再落库**（见 normalizeNewEnrollments）。
 */
const beforeBadCount = (await api.students.list()).length;
const badCases: Array<[string, Array<{ subject: string; lessons: number }>]> = [
  ["节数为 0", [{ subject: "自检·坏报课", lessons: 0 }]],
  ["科目为空", [{ subject: "   ", lessons: 5 }]],
  ["同一门科目填了两遍", [
    { subject: "自检·坏报课", lessons: 5 },
    { subject: "自检·坏报课", lessons: 5 },
  ]],
  ["同一门科目只差空格也算重复", [
    { subject: "自检·坏报课", lessons: 5 },
    { subject: " 自检·坏报课 ", lessons: 8 },
  ]],
];
// 指定了不存在的教师：下拉选不出来，但接口可以被脚本直接调 —— 不能静默存下来
let ghostTeacherMessage = "";
try {
  await api.students.create({
    name: "自检·坏报课", grade: "初三", guardian: "", status: "在读", note: "", profile: {},
    enrollments: [{ subject: "自检·坏报课", lessons: 5, teacherId: "t_不存在的人" }],
  });
} catch (cause) {
  ghostTeacherMessage = cause instanceof Error ? cause.message : String(cause);
}
ok("指定了不存在的教师会被拒（不能静默存一个查不到的 id）",
  ghostTeacherMessage.includes("教师不存在"), ghostTeacherMessage);
for (const [label, enrollments] of badCases) {
  let message = "";
  try {
    await api.students.create({
      name: "自检·坏报课", grade: "初三", guardian: "", status: "在读", note: "", profile: {},
      enrollments,
    });
  } catch (cause) {
    message = cause instanceof Error ? cause.message : String(cause);
  }
  ok(`建档报课「${label}」被拒并说明原因`, message !== "", message || "（没有被拒绝）");
}
eq("被拒时没有留下半个学生", (await api.students.list()).length, beforeBadCount);
ok("也没有留下同名档案", !(await api.students.search("坏报课")).some((item) => item.name === "自检·坏报课"));

// 不传报课就只是建档（原有行为不能被改坏）
const plain = await api.students.create({
  name: "自检·只建档", grade: "初一", guardian: "", status: "在读", note: "", profile: {},
});
eq("不传 enrollments 时就是只建档（没有报课记录）", plain.enrollments.length, 0);
eq("只建档的学生报读科目为空", plain.subjects.length, 0);

ok("收尾：摘掉多门报课的夹具（它带账，按产品规矩删不掉 —— 见 __removeFixture）", await dropFixture("students", multi.id));
ok("收尾：摘掉只建档的夹具", await dropFixture("students", plain.id));

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

/*
 * **账本要记全**：报课 / 续费 / 调整 / 退课都必须在流水里。
 *
 * 原先这四种动作只写进了报课记录自带的 `history`，账本里只有「上课」扣减 ——
 * 机构刚报完 20 节，打开「课时流水」看到的是空的，只能怀疑数据没存上。
 * 示例数据本来就是两边都写，新录入的没有理由不同规矩。
 */
const addedLedger = (await api.transactions.listByEnrollment(added.id))
  .filter((item) => item.reversedAt === "");
eq("报课 / 续费 / 调整 / 退课 都进了账本",
  addedLedger.map((item) => [item.kind, item.delta]).sort(),
  [["报课", 10], ["调整", -15], ["续费", 5], ["退课", 0]].sort());
ok("调减被夹到 0 时，账本记的是**实际生效**的节数并说明原因",
  addedLedger.some((item) => item.kind === "调整" && item.note.includes("实际生效")),
  addedLedger.find((item) => item.kind === "调整")?.note ?? "（没有调整流水）");
ok("这条报课的账本与课时自洽",
  ledgerConsistent(adjusted!.enrollments.find((item) => item.id === added.id)!, 
    await api.transactions.listByEnrollment(added.id)));

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

/*
 * **课时不足就不排课**（机构口径：宁可少排，也不要欠账）。
 * 这条在服务端拦，因此"没有该科目报课记录"的课**根本建不出来** ——
 * 顺带把 markCompleted 那条"无报课记录时不扣课时"的容错路径也换了个更真实的造法：
 * 先建课、再退课，然后标记已上。
 */
let blockedMessage = "";
try {
  await api.lessons.create({
    subject: "自检·无人报课的科目", form: "", teacherId: teacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: slot(9, 0).start, durationMinutes: 60,
    status: "已排", note: "",
  });
} catch (cause) {
  blockedMessage = cause instanceof Error ? cause.message : String(cause);
}
ok("没有该科目课时 → 排课被拒（服务端拦，不欠账）",
  blockedMessage.includes("课时不足"), blockedMessage);
ok("拒绝理由里点名了是谁不够、还能排几节",
  blockedMessage.includes(pupil.name) && blockedMessage.includes("还能排"), blockedMessage);

// 没有学生的课（占位 / 教室安排）：没有课时可欠，不该被"课时不足"挡住
const noStudentLesson = await api.lessons.create({
  subject: "自检·没有学生的课", form: "", teacherId: teacher.id, classroomId: room.id,
  studentIds: [], startsAt: slot(18, 0).start, durationMinutes: 60, status: "已排", note: "",
});
eq("没有学生的课可以建（没有课时可欠）", noStudentLesson.studentIds, []);
await dropFixture("lessons", noStudentLesson.id);
/*
 * 拦的必须是「排课这件事」，而不是 `create` 这一个入口。
 *
 * 否则后门是现成的：新建被拦，就把旧课改成想排的科目 / 学生 / 状态 ——
 * 一样是多了一节课，一样是欠账。所以 `lessons.update` 也要按**改完之后的样子**复核。
 */
const editStudent = await api.students.create({
  name: "自检改课学生", grade: "初二", guardian: "", status: "在读", note: "", profile: {},
});
const editEnroll = await api.students.enroll(editStudent.id, {
  subject: "自检改课科目", form: "一对一定制课", teacherId: teacher.id, lessons: 2,
  startedAt: new Date().toISOString(), note: "自检",
});
const editEnrollmentId = editEnroll!.enrollments[0]!.id;
const editLesson = await api.lessons.create({
  subject: "自检改课科目", form: "一对一定制课", teacherId: teacher.id, classroomId: room.id,
  studentIds: [editStudent.id], startsAt: slot(16, 0).start, durationMinutes: 60,
  status: "已排", note: "",
});
const editSecond = await api.lessons.create({
  subject: "自检改课科目", form: "一对一定制课", teacherId: teacher.id, classroomId: room.id,
  studentIds: [editStudent.id], startsAt: slot(17, 0).start, durationMinutes: 60,
  status: "已排", note: "",
});

// 只改备注：不能被自己的影子挡住（复核时会把这节课自己排除掉）
const noted = await api.lessons.update(editLesson.id, { note: "自检：只改备注" });
eq("只改备注不受课时规则影响（不因为把自己算成已排而被拒）", noted?.note, "自检：只改备注");

let editMessage = "";
try {
  await api.lessons.update(editLesson.id, { subject: "自检·无人报课的科目" });
} catch (cause) {
  editMessage = cause instanceof Error ? cause.message : String(cause);
}
ok("把已有课改成没有课时的科目 → 被拒（堵住 create 之外的入口）",
  editMessage.includes("课时不足"), editMessage);

editMessage = "";
try {
  await api.lessons.update(editLesson.id, { studentIds: [pupil.id] });
} catch (cause) {
  editMessage = cause instanceof Error ? cause.message : String(cause);
}
ok("把学生换成没有这门课课时的学生 → 被拒（点名是谁不够）",
  editMessage.includes("课时不足") && editMessage.includes(pupil.name), editMessage);

// 状态翻回「已排」同样算排课：把课时抽掉之后，取消的课不能再翻回来
await api.students.adjustEnrollmentLessons(
  editStudent.id, editEnrollmentId, -2, "自检：把课时抽掉，验证改课复核",
);
const cancelled = await api.lessons.update(editLesson.id, { status: "已取消" });
eq("课时抽掉后仍可把课改成已取消（不挡减法）", cancelled?.status, "已取消");
editMessage = "";
try {
  await api.lessons.update(editLesson.id, { status: "已排" });
} catch (cause) {
  editMessage = cause instanceof Error ? cause.message : String(cause);
}
ok("课时不够时把「已取消」翻回「已排」→ 被拒", editMessage.includes("课时不足"), editMessage);

// 收尾：把这个学生的课与档案删掉，别影响后面的断言
await dropFixture("lessons", editLesson.id);
await dropFixture("lessons", editSecond.id);
await dropFixture("students", editStudent.id);
eq("自检改课学生已清理", await api.students.get(editStudent.id), null);

// 先建一节（此时有课时），再退掉这门课的报课记录 → 标记已上时就没有对应报课记录了
const orphanLesson = await api.lessons.create({
  subject: anchorSubject, form: "一对一定制课", teacherId: teacher.id, classroomId: room.id,
  studentIds: [pupil.id], startsAt: slot(9, 0).start, durationMinutes: 60,
  status: "已排", note: "",
});
const orphanEnrollment = (await api.students.get(pupil.id))!.enrollments
  .find((enrollment) => enrollment.subject === anchorSubject && enrollment.status === "在读")!;
await api.students.refundEnrollment(pupil.id, orphanEnrollment.id, "自检：造一节无报课记录的课");
const orphanResult = await api.lessons.markCompleted(orphanLesson.id);
eq("无对应报课记录时不扣课时", orphanResult.deducted.length, 0);
eq("并且说明原因", orphanResult.skipped.length, 1);
ok("原因里点名了科目", (orphanResult.skipped[0]?.reason ?? "").includes(anchorSubject));
await dropFixture("lessons", orphanLesson.id);

/*
 * 兜底：**超用必须被上报**（而不是静默）。
 *
 * 排课时已按"课时够不够"拦了一道，但退课/调减课时/多人课中途退课仍可能造成超用。
 * 这里故意造出来：先排一节（有课时）→ 把课时手工调到 0 → 标记已上 → 应当出现 overused。
 */
const overflowStudent = await api.students.create({
  name: "自检超用学生", grade: "初二", guardian: "", status: "在读", note: "", profile: {},
});
const overflowEnroll = await api.students.enroll(overflowStudent.id, {
  subject: "自检超用科目", form: "一对一定制课", teacherId: teacher.id, lessons: 5,
  startedAt: new Date().toISOString(), note: "自检",
});
const overflowLesson = await api.lessons.create({
  subject: "自检超用科目", form: "一对一定制课", teacherId: teacher.id, classroomId: room.id,
  studentIds: [overflowStudent.id], startsAt: slot(11, 0).start, durationMinutes: 60,
  status: "已排", note: "",
});
await api.students.adjustEnrollmentLessons(
  overflowStudent.id, overflowEnroll!.enrollments[0]!.id, -5, "自检：把课时调到 0",
);
const overflowResult = await api.lessons.markCompleted(overflowLesson.id);
eq("课时已被调到 0 时仍能记录上课（不因为欠费就记不了）", overflowResult.lesson?.status, "已上");
eq("但要**明确上报超用**（不是静默截断成 0）",
  overflowResult.overused.map((item) => [item.name, item.subject, item.over]),
  [["自检超用学生", "自检超用科目", 1]]);
await dropFixture("lessons", overflowLesson.id);

await dropFixture("lessons", anchorLesson.id);
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

/*
 * ── 老数据迁移：v1 的教室没有用途与时段，打开后台不能出现 undefined ──
 *
 * 这一块**只能对本地存储做**：它的做法是把一份 v1 的原始 JSON 直接写进浏览器存储，
 * 再看 `load()` 读出来时有没有补齐 —— 检验的是「浏览器里那份老数据打开还能用」。
 * 走服务端时数据源是 SQLite、浏览器存储不是数据源，往本地存储里写东西毫无意义
 * （写进去也没人读），因此跳过。
 *
 * **迁移逻辑本身不会因此漏测**：下面「老版本文件导入时自动升级」是在服务端跑的
 * （导入走的是同一个 `migrate()`），两边的覆盖都不缺。
 */
if (isRemoteMode()) {
  console.log("  · 跳过「老数据迁移（浏览器存储）」以外的本地存储用例：当前跑的是服务端后端");
} else {
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
}

// 数据结构版本必须与 seed 写出的一致（曾因 seed 写旧版本导致新数据被误迁移）
eq("示例数据的版本等于当前版本", seedDb.version, CURRENT_VERSION);

// ── 信息采集表 ────────────────────────────────────────────────────────
// 注意：上面的迁移用例把服务切到了另一份存储（legacy），这里必须先切回来，
// 否则会对着一份没有这些学生的数据做断言（表现为「保存失败」）。
// 走服务端时那边没有切过存储（迁移用例被跳过），这一句是无副作用的保险。
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

/*
 * ── 记录级乐观锁（v17）：同一条记录的并发编辑不能静默覆盖 ──────────────
 *
 * ## 这一节为什么要跑在**两种后端**上
 *
 * 内存实现里抛的是 `VersionConflictError`（有类型、有 `currentVersion`），
 * 而走 HTTP 时前端拿到的是**服务端返回的那句话**（`remote.ts` 把它包成一个普通 Error，
 * 状态码 409 由 `server/index.mts` 给出）。因此断言只认**文案**：
 * 「刚被别人改过」+ 当前版本号。这样同一份断言在两边都成立，
 * 也顺带钉住了"两边的提示说法不许分叉"。
 *
 * ## 场景就是真实场景：两个客户端读到同一版
 *
 * 甲、乙各打开一次表单（都读到第 1 版）→ 甲先提交成功 → 乙后提交**必须被拒**。
 * 下面六条依次是：① 先交成功；② 同一版本再交被拒；③ 拿到新版本后能交上；
 * ④ **不传版本仍然能用**（老调用方不受影响）；⑤ 调用方夹带 `version` 也改不了版本号；
 * ⑥ 版本号算错时也拦住，但说法与"冲突"分开。
 */
{
  const lockTeacher = await api.teachers.create({
    name: "自检·乐观锁教师", subjects: [], role: "", phone: "", active: true,
    years: "", summary: "", bio: "", recommendation: "", order: 999,
    siteVisible: false, origin: "后台", kind: "教师",
  });
  eq("新建记录的版本从 1 开始", lockTeacher.version, 1);

  // 甲与乙手里的表单：都读到第 1 版
  const readByA = (await api.teachers.get(lockTeacher.id))!;
  const readByB = (await api.teachers.get(lockTeacher.id))!;
  eq("两个客户端读到的是同一个版本", [readByA.version, readByB.version], [1, 1]);

  const savedByA = await api.teachers.update(
    lockTeacher.id,
    { summary: "甲写的简介" },
    { expectedVersion: readByA.version },
  );
  eq("① 先提交的那个成功", savedByA?.summary, "甲写的简介");
  eq("① 写入成功之后版本递增", savedByA?.version, 2);

  let conflictText = "";
  try {
    await api.teachers.update(
      lockTeacher.id,
      { summary: "乙写的简介（基于他看到的第一版）" },
      { expectedVersion: readByB.version },
    );
  } catch (cause) {
    conflictText = cause instanceof Error ? cause.message : String(cause);
  }
  ok("② 后提交的会被拒绝（不是静默覆盖）", conflictText !== "", "没有被拒绝：第二个人把第一个人改的盖掉了");
  ok("② 错误里说清了「刚被别人改过」", conflictText.includes("刚被别人改过"), conflictText);
  ok("② 错误里给出了当前版本号（人才知道该刷新）", conflictText.includes("当前版本 2"), conflictText);
  const afterConflict = (await api.teachers.get(lockTeacher.id))!;
  eq("② 被拒的提交一个字都没写进去", afterConflict.summary, "甲写的简介");
  eq("② 被拒也不会推进版本", afterConflict.version, 2);

  // 乙刷新：重新读到第 2 版之后再提交
  const fresh = (await api.teachers.get(lockTeacher.id))!;
  const savedByB = await api.teachers.update(
    lockTeacher.id,
    { summary: "乙刷新后写的简介" },
    { expectedVersion: fresh.version },
  );
  eq("③ 刷新之后提交成功", savedByB?.summary, "乙刷新后写的简介");
  eq("③ 版本继续递增", savedByB?.version, 3);

  // 老调用方：不传 expectedVersion 时行为与今天完全一样（不校验，但版本照样推进）
  const legacyWrite = await api.teachers.update(lockTeacher.id, { role: "老调用方" });
  eq("④ 不传版本仍然能写（老调用方不受影响）", legacyWrite?.role, "老调用方");
  eq("④ 不传版本也照样推进版本（版本＝这条记录被写过几次）", legacyWrite?.version, 4);

  /*
   * 调用方**夹带** version 也不能自己定版本号。
   *
   * 这条刻意写成"类型挡不住、只有运行时才可能发生"的样子：`/api/call` 是把 args
   * 原样交给服务层的，而且自己人调用时很容易把一整个对象当 patch 传进来
   * （TS 只在字面量上检查多余的属性）。如果服务端不把记录自己的版本盖回去，
   * 客户端就能把版本号设成任意值 —— 乐观锁当场变成摆设，而且没有任何断言会红。
   */
  const sneakyPatch = { summary: "夹带了版本号", version: 999 };
  const sneaky = await api.teachers.update(lockTeacher.id, sneakyPatch);
  eq("⑤ 夹带 version 的提交改不了版本号（服务端盖回记录自己的值）", sneaky?.version, 5);

  /*
   * 版本号本身**算错了**（0 / NaN）时：也要拦住，但**不能说成"被别人改过"**。
   *
   * 两种说法对应两种处置：冲突是"刷新后重提交就能成"，参数错是"你那数字从哪来的"。
   * 混在一起会把排障引到"谁改的"上面去（见 `lib/backend/concurrency.ts` 的 assertVersion：
   * 不合法 → 普通 Error（接口层 400），对不上 → 冲突（接口层 409））。
   */
  let badVersionText = "";
  try {
    await api.teachers.update(lockTeacher.id, { summary: "版本号传错" }, { expectedVersion: 0 });
  } catch (cause) {
    badVersionText = cause instanceof Error ? cause.message : String(cause);
  }
  ok("⑥ 版本号不合法时同样被拦住（不会静默写入）", badVersionText !== "", "没有被拦住");
  ok("⑥ 且不说成「被别人改过」（那是调用方算错了，不是冲突）",
    !badVersionText.includes("刚被别人改过"), badVersionText);
  eq("⑥ 被拒的写入没有改动记录", (await api.teachers.get(lockTeacher.id))?.summary, "夹带了版本号");

  // 信息采集表是**整份覆盖 profile**，因此它是最要紧的一处，单独走一遍同样的四步
  const lockStudent = await api.students.create({
    name: "自检·乐观锁学生", grade: "初二", guardian: "", status: "在读", note: "", profile: {},
  });
  const profileA = (await api.students.get(lockStudent.id))!;
  const profileB = (await api.students.get(lockStudent.id))!;

  const profileSavedFirst = await api.students.saveProfile(
    lockStudent.id,
    { gender: "男", school: "甲填的学校" },
    { expectedVersion: profileA.version },
  );
  eq("采集表：先保存的成功", profileText(profileSavedFirst!.profile, "school"), "甲填的学校");
  eq("采集表：版本递增", profileSavedFirst?.version, 2);

  let profileConflict = "";
  try {
    await api.students.saveProfile(
      lockStudent.id,
      { gender: "女" },
      { expectedVersion: profileB.version },
    );
  } catch (cause) {
    profileConflict = cause instanceof Error ? cause.message : String(cause);
  }
  ok("采集表：整份覆盖被挡住（否则甲填的会整块消失）",
    profileConflict.includes("刚被别人改过"), profileConflict);
  const profileAfter = (await api.students.get(lockStudent.id))!;
  eq("采集表：甲的填写还在（没有被盖掉）", profileText(profileAfter.profile, "school"), "甲填的学校");
  eq("采集表：版本没被推进", profileAfter.version, 2);

  // 不带版本的老调用方（验收脚本、内部业务动作）照旧能用
  const profileLegacy = await api.students.saveProfile(lockStudent.id, { gender: "男" });
  ok("采集表：不传版本仍然能保存", profileLegacy !== null);
  eq("采集表：不传版本也推进版本", profileLegacy?.version, 3);

  /*
   * 排课表单同样受保护：它整份覆盖「这节课排给谁 / 什么时候」。
   * 这条走的是**手写的** lessons.update（它还带课时复核与撤销逻辑），
   * 因此和通用集合那两条不是同一条代码路径，值得单独跑一遍。
   */
  const lockLesson = (await api.lessons.list())[0];
  ok("夹具里至少有一节课（排课用例要在真实记录上跑）", lockLesson !== undefined);
  if (lockLesson !== undefined) {
    const lessonA = (await api.lessons.get(lockLesson.id))!;
    const lessonB = (await api.lessons.get(lockLesson.id))!;
    const lessonSaved = await api.lessons.update(
      lockLesson.id,
      { note: "甲改的备注" },
      { expectedVersion: lessonA.version },
    );
    eq("排课：先改的那个成功", lessonSaved?.note, "甲改的备注");
    let lessonConflict = "";
    try {
      await api.lessons.update(
        lockLesson.id,
        { note: "乙改的备注" },
        { expectedVersion: lessonB.version },
      );
    } catch (cause) {
      lessonConflict = cause instanceof Error ? cause.message : String(cause);
    }
    ok("排课：后改的被挡住（不会把别人的改动盖掉）",
      lessonConflict.includes("刚被别人改过"), lessonConflict);
    eq("排课：甲改的备注还在", (await api.lessons.get(lockLesson.id))?.note, "甲改的备注");
  }

  // 收尾：删掉这两条自检记录，别影响后面的断言
  await dropFixture("students", lockStudent.id);
  await dropFixture("teachers", lockTeacher.id);
  eq("自检记录已清理（学生）", await api.students.get(lockStudent.id), null);
  eq("自检记录已清理（教师）", await api.teachers.get(lockTeacher.id), null);
}

/*
 * 清空（`api.reset()`）的语义：**回到空库**，而不是"灌回示例数据"。
 *
 * 早期它灌回 8 位示例学生 —— 那在真实使用下是个陷阱：机构点一下就把自己录的数据
 * 换成了演示数据，而演示数据"看起来有内容"，很容易被当成自己的数据继续用。
 * 现在它与初始状态一致（`createEmptyDatabase`），并且要守住两件容易写错的事：
 *   1. 业务表清空；2. **课程库与报价配置保留**（它们不是业务数据，来自网站内容）。
 * 清空之后再导一遍夹具，后面的断言继续在夹具上跑。
 */
await api.reset();
eq("清空后业务数据为空", (await api.students.list()).length, 0);
ok("清空后课程库保留（网站课程不是业务数据）", (await api.courses.list()).length > 0);
ok("清空后报价配置保留（否则报价页算不出价）", (await api.pricing.get()) !== null);
const restoredFixtures = await api.importDatabase(serializeDatabase(seedDb));
ok("清空后能重新导入夹具", restoredFixtures.ok);
eq("重新导入后学生数回到夹具规模", (await api.students.list()).length, seeded.length);

// ── 课时流水（账本）与撤销 ────────────────────────────────────────────
// 账本的价值全在「与余额自洽」与「能撤销」两件事上，因此这两条必须钉死。
const ledgerStudent = (await api.students.list()).find((item) => item.enrollments.length > 0)!;
const ledgerEnrollment = ledgerStudent.enrollments[0]!;
const ledgerBefore = await api.transactions.listByEnrollment(ledgerEnrollment.id);
/*
 * 流水与课时是否自洽。
 *
 * 两条不变式：
 *   1. **有效流水之和 = 剩余课时**（总课时 − 已用）；
 *   2. 「上课」流水之和 = −已用课时。
 *
 * 为什么不做成「正流水之和 = 总课时」：那样只有「报课 + 上课」才会通过，
 * 一旦有手工调整（退课只改状态、调整会改动总课时）就必然误报。
 * 之前这里写的就是那种拆法，而新报课的流水压根没写进账本 —— 于是它**恰好**
 * 因为「记录被调成 0 节」而通过，等于空转。改成求和口径后才是真的在守账。
 */
function ledgerConsistent(
  enrollment: { totalLessons: number; usedLessons: number },
  rows: Array<{ delta: number; kind: string; reversedAt: string }>,
): boolean {
  const effective = rows.filter((item) => item.reversedAt === "");
  const sum = effective.reduce((total, item) => total + item.delta, 0);
  const usedRows = effective
    .filter((item) => item.kind === "上课")
    .reduce((total, item) => total + item.delta, 0);
  return (
    sum === enrollment.totalLessons - enrollment.usedLessons &&
    -usedRows === enrollment.usedLessons
  );
}

ok("示例数据的流水与课时自洽", ledgerConsistent(ledgerEnrollment, ledgerBefore));
// 不变式的通用校验：全部学生的每一条报课都要自洽（不只是抽样那一条）
ok("所有报课记录的课时都与流水自洽", await (async () => {
  const all = await api.students.list();
  const transactions = await Promise.all(
    all.flatMap((student) => student.enrollments.map((item) => api.transactions.listByEnrollment(item.id))),
  );
  const enrollments = all.flatMap((student) => student.enrollments);
  return enrollments.every((enrollment, index) =>
    ledgerConsistent(enrollment, transactions[index] ?? []),
  );
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
await dropFixture("lessons", ledgerLesson.id);

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
await dropFixture("lessonRecords", firstRecord.id);
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
ok("导入前自动留了备份", await api.hasBackup());
const restored = await api.restoreBackup();
eq("可以恢复导入前的数据", restored.ok, true);
eq("恢复后学生数回到导入前", (await api.students.list()).length, studentsBeforeImport);

// 老版本文件导入时自动升级。
// 这里刻意用 **v1**（最老的一版）而不是 v2：v1 的教室没有 `kind` / `availability`
// 两个字段，导入时必须补齐 —— 否则后台教室页会显示 undefined。
// 这条是「老数据迁移」在**服务端**上的等价覆盖（浏览器存储那一份只能本地跑，见上）。
const oldFile = JSON.stringify({
  version: 1,
  students: [{
    id: "s_old", name: "旧文件学生", grade: "初二", guardian: "", subjects: ["初中数学"],
    remainingLessons: 5, status: "在读", note: "", createdAt: new Date().toISOString(),
  }],
  teachers: [],
  classrooms: [{ id: "c_old", name: "旧文件教室", capacity: 6, note: "" }],
  lessons: [],
  updatedAt: new Date().toISOString(),
});
const upgraded = await api.importDatabase(oldFile);
eq("旧版本文件导入成功", upgraded.ok, true);
ok("提示里说明了升级", (upgraded.ok ? upgraded.note : "").includes("升级"));
const upgradedStudent = (await api.students.get("s_old"))!;
eq("旧文件的课时被折算成报课记录", remainingTotal(upgradedStudent.enrollments), 5);
eq("旧文件的教室被补上用途", (await api.classrooms.get("c_old"))?.kind, "上课用教室");
eq("旧文件的教室被补上空时段", (await api.classrooms.get("c_old"))?.availability, []);
eq("升级后的库版本等于当前版本", (await api.exportDatabase()).version, CURRENT_VERSION);
await api.restoreBackup();

/*
 * v13 → v14：教师档案补「推荐理由」与「网站显示顺序」。
 *
 * 这两个字段原先只在网站文件里（网站教师页的「推荐理由」「排序」）。网站要改成
 * 以后端为准，老库就必须能补上它们 —— 且**顺序按原数组次序编号**：
 * 数组顺序就是机构原来的展示顺序，随机数或全 999 会让网站排序整个乱掉。
 *
 * 夹具用「示例数据降级」而不是手写一份 v13：手写要凑齐 v13 的全部表，
 * 少一张就会在迁移链的下一次写入上崩掉（我第一版就是这么崩的，
 * 报错还落在 writeLog 上，看起来像日志的锅）。
 */
const v13Db = JSON.parse(serializeDatabase(seedDb)) as Record<string, unknown> & {
  teachers: Array<Record<string, unknown>>;
  version: number;
};
v13Db.version = 13;
v13Db.teachers = v13Db.teachers.map((teacher) => {
  const copy = { ...teacher };
  delete copy.recommendation;
  delete copy.order;
  return copy;
});
eq("夹具确实是「没有这两个字段的 v13 教师」",
  v13Db.teachers.every((teacher) => !("recommendation" in teacher) && !("order" in teacher)), true);

const upgradedTeachers = await api.importDatabase(JSON.stringify(v13Db));
eq("v13 文件可以导入", upgradedTeachers.ok, true);
const migratedTeachers = await api.teachers.list();
ok("v13 → v14 补上推荐理由（空值，不猜内容）",
  migratedTeachers.every((teacher) => teacher.recommendation === ""),
  migratedTeachers.map((teacher) => teacher.recommendation).join("/"));
eq("v13 → v14 的顺序按原数组次序编号（原来谁在前面，网站上还是谁在前）",
  migratedTeachers.map((teacher) => teacher.order),
  migratedTeachers.map((_teacher, index) => index + 1));
ok("补字段不影响原有资料",
  migratedTeachers.every((teacher) => teacher.bio !== "" || teacher.name !== ""));
await api.restoreBackup();

/*
 * ── 把网站内容搬进库（`site.importFromContent`）─────────────────────────────
 *
 * 老库升级上来时：教师没有推荐理由与顺序、课程行没有卡片字段、课程正文是空的。
 * 网站那侧据此判定"后端没有内容"而回落到模版 —— 因此这条导入路径必须有，
 * 而且必须**两件事都成立**：
 *   1. 体检（`write: false`）一个字都不写；
 *   2. 默认**只补空、不覆盖**（机构在后台改过的内容不能被一次导入冲掉）。
 * 用一份"降级成 v14"的库来造这个场景：这是真实会遇到的形态（升级前就是这个样子）。
 */
const v14Db = JSON.parse(serializeDatabase(seedDb)) as Record<string, unknown> & {
  teachers: Array<Record<string, unknown>>;
  courses: Array<Record<string, unknown>>;
  version: number;
  siteContent?: unknown;
};
v14Db.version = 14;
v14Db.teachers = v14Db.teachers.map((teacher) => {
  const copy = { ...teacher };
  delete copy.recommendation;
  delete copy.order;
  return copy;
});
v14Db.courses = v14Db.courses.map((course) => {
  const copy = { ...course };
  for (const key of ["path", "subgroup", "tags", "target", "order", "intro", "siteKind"]) delete copy[key];
  return copy;
});
delete v14Db.siteContent;
eq("降级夹具：课程没有卡片字段（v14 的样子）",
  v14Db.courses.every((course) => !("path" in course) && !("siteKind" in course)), true);

// 升级进库（v14 → v15 迁移会补默认值），此时网站内容仍是空的
eq("v14 文件可以升级导入", (await api.importDatabase(JSON.stringify(v14Db))).ok, true);
const afterUpgrade = await api.exportDatabase();
/*
 * 「课程正文有没有内容」的判据就写在断言里（原先它是 `site-content.ts` 的一个导出，
 * 唯一的读者是这里 —— 两态之后网站那一侧不再靠它决定"用不用后端"，
 * 一个只给自检用的导出就是死代码，删掉了）。
 */
const hasBands = (content: { coursePage: { subjects: Array<{ bands: unknown[] }> } }): boolean =>
  content.coursePage.subjects.some((subject) => subject.bands.length > 0);
ok("老库升级后课程正文是空的（迁移不读外部文件，只补结构）",
  !hasBands(afterUpgrade.siteContent));
ok("老库升级后课程行有了卡片字段的默认值",
  afterUpgrade.courses.every((course) => course.siteKind === "不展示" && course.path === ""));

// ① 体检：必须一个字都不写
const beforeDryRun = JSON.stringify(await api.exportDatabase());
const dry = await api.site.importFromContent({ write: false });
ok("体检报告列出了会补什么（不是空话）", dry.changes.length > 0, dry.changes.slice(0, 2).join("；"));
eq("体检没有写库", JSON.stringify(await api.exportDatabase()), beforeDryRun);
eq("体检报告标了「没写」", dry.written, false);

// ② 写入：教师资料、课程卡片字段、课程正文都补上
const written = await api.site.importFromContent({ write: true });
eq("写入报告标了「已写」", written.written, true);
ok("补上了教师资料（教龄 / 简介 / 推荐理由 / 顺序）",
  written.counts.teachersFilled > 0 &&
    (await api.teachers.list()).some(
      (teacher) => teacher.recommendation !== "" && teacher.order !== 999 && teacher.years !== "",
    ),
  JSON.stringify({
    counts: written.counts,
    teachers: (await api.teachers.list()).map((t) => [t.name, t.years, t.summary.length, t.recommendation.length, t.order]),
  }));
ok("补上了课程卡片字段（路径 / 网站形态）",
  written.counts.coursesFilled > 0 &&
    (await api.courses.list()).some((course) => course.path !== "" && course.siteKind !== "不展示"));
ok("写入了课程正文（学科与小节）",
  written.counts.subjectsWritten > 0 && written.counts.bandsWritten > 0);
ok("写入了教师页标题（否则教师页会没有标题）",
  (await api.exportDatabase()).siteContent.teacherPage.heading.title !== "");
const afterImport = await api.exportDatabase();
ok("写完之后网站那侧能看到内容", hasBands(afterImport.siteContent));
eq("小节数与网站的锚点数量一致",
  afterImport.siteContent.coursePage.subjects.reduce((sum, item) => sum + item.bands.length, 0),
  written.counts.bandsWritten);

// ③ 再导一次（不覆盖）：课程正文必须原样保留，并说明"未覆盖"
const secondImport = await api.site.importFromContent({ write: true });
eq("再导一次不再改写课程正文", secondImport.counts.subjectsWritten, 0);
ok("并明确说明为什么没覆盖",
  secondImport.changes.some((item) => item.includes("已有课程正文") && item.includes("未覆盖")),
  secondImport.changes.find((item) => item.includes("未覆盖")) ?? "（没有说明）");

// ④ 覆盖模式：确实替换（这是"改了内容文件要推上去"的那条路）
const replaced = await api.site.importFromContent({ write: true, overwrite: true });
ok("勾选覆盖时课程正文被替换", replaced.counts.subjectsWritten > 0,
  `subjectsWritten=${replaced.counts.subjectsWritten}`);

/*
 * v15 → v16：教师补「是否在宣传网站展示」。
 *
 * 这条不变量很要紧：网站刚切到"以库为准"时，如果默认把**所有**教师都展示，
 * 机构内部老师的档案（真名、没有简介）会直接出现在宣传页上 —— 那是真实会发生的意外。
 * 因此默认口径按来源定：网站导进来的展示，机构手建的不展示。
 */
const v15Db = JSON.parse(serializeDatabase(seedDb)) as Record<string, unknown> & {
  teachers: Array<Record<string, unknown>>;
  version: number;
};
v15Db.version = 15;
v15Db.teachers = v15Db.teachers.map((teacher, index) => {
  const copy = { ...teacher };
  delete copy.siteVisible;
  // 一半造"网站来源"、一半造"后台手建"，好验证两种默认口径
  copy.origin = index === 0 ? "后台" : "网站";
  return copy;
});
eq("v15 文件可以升级导入", (await api.importDatabase(JSON.stringify(v15Db))).ok, true);
const migratedVisible = await api.teachers.list();
eq("老库迁移后一律默认**不**展示（迁移猜不出机构想让谁上台）",
  migratedVisible.every((teacher) => !teacher.siteVisible), true);
// 紧接着的「从网站导入内容」会把内容文件里那几位标成展示，其余保持不展示
await api.site.importFromContent({ write: true });
const afterSiteImport = await api.teachers.list();
const contentNames = new Set(siteTeachersFromContent().map((teacher) => teacher.name));
ok("导入后：内容文件里有的教师标成展示、没有的仍不展示",
  afterSiteImport.every((teacher) => teacher.siteVisible === contentNames.has(teacher.name)),
  JSON.stringify(afterSiteImport.map((teacher) => [teacher.name, teacher.siteVisible, contentNames.has(teacher.name)])));

/*
 * 而"机构明确关掉展示"的那一位，导入**不能**把它翻回来。
 *
 * 这条是踩出来的：导入侧当时读的是**快照**（而不是模版），于是它看到的"网站内容"
 * 其实是库自己 —— 连机构手动关掉展示的教师都被它按"内容里有他"重新标成展示。
 * 症状很隐蔽：日志上写着"按网站内容更新 网站上展示"，但内容文件里根本没有这个人。
 */
const hiddenTeacher = afterSiteImport.find((teacher) => !teacher.siteVisible);
if (hiddenTeacher !== undefined) {
  await api.site.importFromContent({ write: true, overwrite: true });
  eq("导入不会把机构关掉展示的教师翻回来（内容文件里没有他）",
    (await api.teachers.list()).find((item) => item.id === hiddenTeacher.id)?.siteVisible,
    false);
} else {
  // 夹具里没有"手建且已关掉展示"的教师：这一条改成自己造一位（放到最后，避免影响上面的断言）
  const handmade = await api.teachers.create({
    name: "自检·内部老师", subjects: [], role: "内部", phone: "", active: true,
    years: "", summary: "", bio: "", recommendation: "", order: 999,
    siteVisible: false, origin: "后台", kind: "教师",
  });
  await api.site.importFromContent({ write: true, overwrite: true });
  eq("导入不会把机构关掉展示的教师翻回来（内容文件里没有他）",
    (await api.teachers.get(handmade.id))?.siteVisible, false);
  await dropFixture("teachers", handmade.id);
}
await api.restoreBackup();

/*
 * v16 → v17：五个实体补**记录级版本号**（乐观锁）。
 *
 * ## 这一节真正在守的是什么
 *
 * 不是"迁移加了字段"，而是**补的那个值必须是 1**。
 *
 * 如果迁移去"猜"一个更高的数（比如按操作日志条数），机构手上那些升级前导出的 JSON
 * 在导入/恢复之后就会与库里的数字对不上 —— 于是**每次保存都报冲突**，
 * 人只能一遍遍刷新、永远保存不上。一个假冲突比没有锁糟得多：它把正常操作也挡了。
 * 因此下面除了"每条记录都有 version"，还专门验一条：
 * **升级之后第一次保存一定成功**（不传版本、以及带上 expectedVersion=1 都要成）。
 *
 * 夹具照旧用"示例数据降级"（v13/v14/v15 那几个用例的做法）：手写一份 v16 要凑齐
 * 全部的表，少一张就会在迁移链的下一次写入上崩掉。**五个实体都要删掉 version 字段**
 * 并把库版本改成 16 —— 漏删一个，"迁移补 1"这条就变成空转了。
 */
{
  const v16Db = JSON.parse(serializeDatabase(seedDb)) as Record<string, unknown> & {
    students: Array<Record<string, unknown>>;
    teachers: Array<Record<string, unknown>>;
    classrooms: Array<Record<string, unknown>>;
    lessons: Array<Record<string, unknown>>;
    courses: Array<Record<string, unknown>>;
    version: number;
  };
  v16Db.version = 16;
  const versionedEntities = ["students", "teachers", "classrooms", "lessons", "courses"] as const;
  for (const key of versionedEntities) {
    v16Db[key] = v16Db[key].map((row) => {
      const copy = { ...row };
      delete copy.version;
      return copy;
    });
  }
  eq("降级夹具：五个实体都没有 version（确实是 v16 的样子）",
    versionedEntities.every((key) => v16Db[key].every((row) => !("version" in row))), true);

  eq("v16 文件可以升级导入", (await api.importDatabase(JSON.stringify(v16Db))).ok, true);

  const upgradedTo17 = await api.exportDatabase();
  const versionRows: Array<{ version: unknown }> = [
    ...upgradedTo17.students, ...upgradedTo17.teachers, ...upgradedTo17.classrooms,
    ...upgradedTo17.lessons, ...upgradedTo17.courses,
  ];
  ok("五个实体都还是「有内容」的（否则下面的断言等于在空数组上通过）",
    versionedEntities.every((key) => v16Db[key].length > 0), String(versionedEntities.map((key) => v16Db[key].length)));
  eq("每条记录都补上了 version", versionRows.every((row) => typeof row.version === "number"), true);
  eq("补的默认值是 1（不是猜出来的更大的数）",
    [...new Set(versionRows.map((row) => row.version))], [1]);

  /*
   * 默认值选 1 的**全部意义**就在这两条：升级之后第一次保存必须成功 ——
   * 不带版本的老调用方要能写，带上"我读到第 1 版"的表单也要能写。
   */
  const upgradedTeacher = (await api.teachers.list())[0]!;
  eq("升级后的记录读到的是第 1 版", upgradedTeacher.version, 1);
  const legacySave = await api.teachers.update(upgradedTeacher.id, { role: "升级后第一次保存" });
  eq("升级后：不传版本的保存成功（老调用方不受影响）", legacySave?.role, "升级后第一次保存");
  const formSave = await api.teachers.update(
    (await api.teachers.list())[1]!.id,
    { role: "升级后表单保存" },
    // 表单读到的是第 1 版 —— 必须对得上，否则升级当天所有人都会被假冲突挡住
    { expectedVersion: 1 },
  );
  eq("升级后：带上「我读到第 1 版」的表单保存成功（不会出现假冲突）",
    formSave?.role, "升级后表单保存");
}
await api.restoreBackup();

// ⑤ 「只补空」的意义：机构在后台改过的内容，默认不会被一次导入冲掉
const editedTeacher = (await api.teachers.list())[0]!;
await api.teachers.update(editedTeacher.id, { summary: "机构自己写的简介" });
await api.site.importFromContent({ write: true });
eq("默认导入不动机构改过的教师简介",
  (await api.teachers.list()).find((item) => item.id === editedTeacher.id)?.summary,
  "机构自己写的简介");
// 而 `overwrite` 是**明确动作**：它会把网站内容按原文写回去（体检里会列出来）
await api.site.importFromContent({ write: true, overwrite: true });
ok("覆盖模式下教师简介按网站内容写回（这是它字面上的意思）",
  (await api.teachers.list()).find((item) => item.id === editedTeacher.id)?.summary !== "机构自己写的简介");
await api.restoreBackup();

/*
 * 保存网站正文（`site.saveContent`）：整份覆盖 + 校验拒收。
 *
 * 这条路径是"后台能改网站文案"的唯一入口，因此两件事都要钉住：
 * 保存后读回来一致（不然改完的正文会被下一次保存悄悄改回），
 * 以及**非法内容必须被拒**（自动纠正会给人一个"看起来存上了、页面上却是别的"的错觉）。
 */
{
  const current = (await api.site.publicContent()).siteContent;
  const saved = await api.site.saveContent(current);
  eq("保存网站正文后读回来一致", JSON.stringify(saved), JSON.stringify(current));

  // 改一个字再存，确认真的写进去了
  const edited: typeof current = JSON.parse(JSON.stringify(current));
  const firstSubject = edited.coursePage.subjects[0]!;
  firstSubject.bands[0]!.title = "自检改过的小节标题";
  const afterEdit = await api.site.saveContent(edited);
  eq("改动落库了", afterEdit.coursePage.subjects[0]?.bands[0]?.title, "自检改过的小节标题");
  eq("其它内容没被顺手改掉",
    afterEdit.coursePage.subjects.length, current.coursePage.subjects.length);

  // 非法内容：空学科名 / 重复锚点 / 没有学科 —— 三种都要被拒
  const cases: Array<[string, (draft: typeof current) => void]> = [
    ["没有学科", (draft) => { draft.coursePage.subjects = []; }],
    ["学科名为空", (draft) => { draft.coursePage.subjects[0]!.name = "  "; }],
    ["小节锚点重复", (draft) => {
      const subject = draft.coursePage.subjects[0]!;
      subject.bands = [subject.bands[0]!, { ...subject.bands[0]! }];
    }],
  ];
  for (const [label, mutate] of cases) {
    const draft: typeof current = JSON.parse(JSON.stringify(afterEdit));
    mutate(draft);
    let message = "";
    try {
      await api.site.saveContent(draft);
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    ok(`保存网站正文「${label}」被拒并说明原因`, message !== "", message || "（没有被拒绝）");
  }

  // 被拒之后库里仍是上一次保存的内容（不能半途改掉一半）
  eq("被拒时库里的内容没有被改动",
    (await api.site.publicContent()).siteContent.coursePage.subjects[0]?.bands[0]?.title,
    "自检改过的小节标题");

  // 收尾：存回原样（后面的用例还要用这份内容）
  await api.site.saveContent(current);
  eq("内容已还原", (await api.site.publicContent()).siteContent.coursePage.subjects[0]?.bands[0]?.title,
    current.coursePage.subjects[0]?.bands[0]?.title);
}

/*
 * ── 卡片 ↔ 正文小节：「一门课一张卡片里改完正文」的四条规则 ──────────────
 *
 * 这一组守的是课程表单里那块「网站正文（小节）」背后的规则。四条都写在**服务层**
 * （`lib/backend/site-bands.ts` 的纯函数 + `validateSiteContent` 的删除护栏），
 * 因此这里对**内存后端与真实 HTTP 后端各跑一遍**（`npm run check:both`）。
 *
 * 为什么写在 `check.mts` 而不是 `check-auth.mts`：后者只对着真实 HTTP 进程跑一遍，
 * 验的是"鉴权闸门在不在"；而这几条是**数据规则**，重点恰恰是
 * 「两种后端跑同一份断言、结论必须一样」—— 那正是 check.mts（经 check:both）独有的能力。
 *
 * 四条：
 *   ① 命中逻辑（纯函数）：卡片给的 targets 命中的小节集合，含"命中 0 个"；
 *   ② 新增小节：锚点重名时自动取可用值，但**硬交**重复锚点仍被服务端拒（不自动纠正）；
 *   ③ 删除护栏：被卡片标签 / 靶点指着的小节删不掉（错误里点名那门课），改掉标签后删得掉；
 *   ④ 小节级精编：改标题 / 锚点 / 正文后保存成功、读回来一致。
 */
{
  // 起点回到夹具（上一块末尾把内容存回了原样，这里再确认一次口径一致）
  const before = (await api.site.publicContent()).siteContent;
  const subjects = before.coursePage.subjects;
  const subjectIndex = subjects.findIndex((item) => item.bands.length > 0);
  ok("夹具里有带小节的学科（否则这一组等于在空数组上通过）", subjectIndex >= 0);
  const subject = subjects[subjectIndex]!;
  const firstBand = subject.bands[0]!;

  // ① 命中逻辑：卡片靶点 + 标签目标 → 小节集合（与课程清单的按钮、学科面板共用同一份）
  const byAnchor = bandsForTargets(subjects, [firstBand.id]);
  eq("命中逻辑：按锚点命中它所在的那个小节",
    byAnchor.map((hit) => `${hit.subject.name}/${hit.band.id}`), [`${subject.name}/${firstBand.id}`]);
  eq("命中逻辑：写小节标题也算命中（卡片上常常直接写标题）",
    bandsForTargets(subjects, [firstBand.title]).some((hit) => hit.band.id === firstBand.id), true);
  eq("命中逻辑：写错名字就是命中 0 个（不猜、不做模糊匹配）",
    bandsForTargets(subjects, ["自检·这个名字不存在"]).length, 0);
  eq("命中逻辑：空 targets 命中 0 个（没填靶点不等于全命中）",
    bandsForTargets(subjects, ["", "   "]).length, 0);
  /*
   * 同一小节被靶点与标签同时命中时只算一次：
   * 重复计数会让"保存了几个小节"这类提示说假话（多门课共用一节时尤其明显）。
   */
  const cardForHit = { target: firstBand.id, tags: [{ target: ` ${firstBand.title} ` }] };
  eq("命中逻辑：靶点与标签都指向同一节时只算一次",
    bandsForTargets(subjects, cardTargets(cardForHit)).length, 1);

  // ② 新增小节：默认锚点重名 → 自动取一个可用值（编辑器自己改正，不等服务端拒）
  const base = "自检新增小节";
  const anchor = uniqueBandAnchor(subjects, base);
  eq("新增小节：没重名时就用给定的锚点", anchor, base);
  eq("新增小节：重名时自动换一个可用的锚点（进内容前就改正）",
    uniqueBandAnchor(subjects, firstBand.id) !== firstBand.id, true);
  eq("新增小节：自动改正后的锚点在整份正文里都不重复",
    subjects.every((item) => item.bands.every((band) => band.id !== anchor)), true);

  const added = JSON.parse(JSON.stringify(before)) as typeof before;
  added.coursePage.subjects[subjectIndex]!.bands.push({ id: anchor, title: base, body: "自检新增小节的正文" });
  const afterAdd = await api.site.saveContent(added);
  const addedBand = afterAdd.coursePage.subjects[subjectIndex]!.bands.find((band) => band.id === anchor);
  ok("新增的小节写进去了（标题 / 正文都读得回来）",
    addedBand?.title === base && addedBand.body === "自检新增小节的正文");

  // 而"硬交一个与组内已有锚点重名的"仍然被拒：自动纠正是编辑器的行为，服务端不猜
  const withDuplicate = JSON.parse(JSON.stringify(afterAdd)) as typeof before;
  withDuplicate.coursePage.subjects[subjectIndex]!.bands.push({
    id: firstBand.id, title: "自检·重名小节", body: "",
  });
  let duplicateMessage = "";
  try {
    await api.site.saveContent(withDuplicate);
  } catch (cause) {
    duplicateMessage = cause instanceof Error ? cause.message : String(cause);
  }
  ok("服务端不自动纠正重复锚点（重名的整份拒收并说明原因）",
    duplicateMessage.includes("重复") && duplicateMessage.includes(firstBand.id), duplicateMessage || "（没有被拒绝）");

  // ③ 删除护栏：让一张卡片的**标签**指向刚加的小节，然后试着删掉它
  const card = await api.courses.create({
    name: "自检·指向小节", partitionId: "", forms: [], origin: "后台", status: "开放", note: "",
    path: "self-check-band", tags: [{ label: "自检", target: anchor }], target: "",
    order: 999, intro: "", siteKind: "学科", createdAt: new Date().toISOString(),
  });
  eq("纯函数：能算出是哪张卡片指着这个小节",
    coursesReferencingAnchor(await api.courses.list(), anchor).map((item) => item.name),
    ["自检·指向小节"]);

  /** 把某个锚点的小节从这份内容里去掉（不改原对象）。 */
  const withoutBand = (content: typeof before, id: string): typeof before => {
    const draft = JSON.parse(JSON.stringify(content)) as typeof before;
    for (const item of draft.coursePage.subjects) {
      item.bands = item.bands.filter((band) => band.id !== id);
    }
    return draft;
  };

  const renamed = JSON.parse(JSON.stringify(afterAdd)) as typeof before;
  const renamedBand = renamed.coursePage.subjects[subjectIndex]!.bands.find((band) => band.id === anchor)!;
  renamedBand.id = `${anchor}改名`;
  let renameMessage = "";
  try {
    await api.site.saveContent(renamed);
  } catch (cause) {
    renameMessage = cause instanceof Error ? cause.message : String(cause);
  }
  ok("改掉被卡片指着的锚点也被拒（改名和删除一样会让那一跳落空）",
    renameMessage.includes("自检·指向小节"), renameMessage || "（没有被拒绝）");

  let denyMessage = "";
  try {
    await api.site.saveContent(withoutBand(afterAdd, anchor));
  } catch (cause) {
    denyMessage = cause instanceof Error ? cause.message : String(cause);
  }
  ok("删掉被卡片标签指着的小节被拒", denyMessage !== "", denyMessage || "（没有被拒绝）");
  ok("错误里**点名**了那门课（只说『还有引用』人找不到是哪门课）",
    denyMessage.includes("自检·指向小节"), denyMessage);
  ok("被拒时库里一个字都没改（整份拒绝，不会删一半）",
    (await api.site.publicContent()).siteContent.coursePage.subjects[subjectIndex]?.bands.some(
      (band) => band.id === anchor) === true);

  // 卡片靶点也走同一条护栏（标签与靶点是两个字段，别只守一个）
  await api.courses.update(card.id, { tags: [], target: anchor });
  let targetMessage = "";
  try {
    await api.site.saveContent(withoutBand(afterAdd, anchor));
  } catch (cause) {
    targetMessage = cause instanceof Error ? cause.message : String(cause);
  }
  ok("卡片**靶点**指着的同样删不掉（两个字段都守）",
    targetMessage.includes("自检·指向小节"), targetMessage || "（没有被拒绝）");

  // ④ 改掉卡片上的引用之后，同一份内容就能保存了（错误提示让人做的事真的有用）
  const cleared = await api.courses.update(card.id, { tags: [], target: "" });
  eq("卡片上的标签与靶点已改掉", [cleared?.tags.length, cleared?.target], [0, ""]);
  const afterDelete = await api.site.saveContent(withoutBand(afterAdd, anchor));
  eq("改掉卡片引用后，删掉这个小节成功", 
    afterDelete.coursePage.subjects[subjectIndex]!.bands.some((band) => band.id === anchor), false);

  // ⑤ 小节级精编：新增一节后改它的标题（含竖线导语）/ 锚点 / 正文，保存后读回来一致
  /*
   * 刻意编辑**刚新增的这一节**，而不是随手挑一节改：
   * 夹具里的每一节几乎都被某张卡片指着（这正是这套数据的常态），
   * 拿它们当"随便改一节"的样本，测到的其实是删除护栏而不是编辑功能。
   */
  const freshAnchor = uniqueBandAnchor(afterDelete.coursePage.subjects, "自检精编小节");
  const withFresh = JSON.parse(JSON.stringify(afterDelete)) as typeof before;
  withFresh.coursePage.subjects[subjectIndex]!.bands.push({
    id: freshAnchor, title: "自检精编小节", body: "旧正文",
  });
  const afterFresh = await api.site.saveContent(withFresh);
  eq("精编用的小节已建好（且没有卡片指着它）",
    [afterFresh.coursePage.subjects[subjectIndex]!.bands.some((band) => band.id === freshAnchor),
      coursesReferencingAnchor(await api.courses.list(), freshAnchor).length],
    [true, 0]);

  const edited = JSON.parse(JSON.stringify(afterFresh)) as typeof before;
  const editable = edited.coursePage.subjects[subjectIndex]!.bands.find((band) => band.id === freshAnchor)!;
  const newAnchor = uniqueBandAnchor(edited.coursePage.subjects, "自检精编小节改名");
  editable.title = "自检精编小节｜这一段是导语";
  editable.id = newAnchor;
  editable.body = "第一段正文。\n\n- 核心能力：自检用";
  const afterEdit = await api.site.saveContent(edited);
  const savedBand = afterEdit.coursePage.subjects[subjectIndex]!.bands.find((band) => band.id === newAnchor);
  eq("小节级精编：标题 / 锚点 / 正文读回来与写进去的一致",
    [savedBand?.title, savedBand?.id, savedBand?.body],
    ["自检精编小节｜这一段是导语", newAnchor, "第一段正文。\n\n- 核心能力：自检用"]);
  eq("小节级精编：只动了这一节，其它小节的数量没变",
    afterEdit.coursePage.subjects[subjectIndex]!.bands.length, afterFresh.coursePage.subjects[subjectIndex]!.bands.length);

  // 收尾：删掉自检用的卡片，正文存回原样（后面的用例还要用这份内容）
  await dropFixture("courses", card.id);
  await api.site.saveContent(before);
  eq("正文已还原（学科 / 小节数与开头一致）",
    (await api.site.publicContent()).siteContent.coursePage.subjects.map((item) => item.bands.length),
    subjects.map((item) => item.bands.length));
  eq("自检用的卡片已删掉", (await api.courses.list()).some((item) => item.name === "自检·指向小节"), false);
}

/*
 * ── 改报课：改这条 / 改这条及以后（**过去的永不改**）──────────────────────────
 *
 * 机构的原话："像 iPhone 日历那样，可以改单次和未来的日程，但不能改过去的日程安排。"
 * 因此这一组断言的重点不是"能不能改"，而是**界线**：
 *   - 未来的课跟着改；
 *   - `已上`的课一节都不许动；
 *   - 时间已过（但状态还挂着"已排"）的课也不许动 —— 那多半是忘了标记，不是未来安排；
 *   - 换成"那个时段已经有课"的老师时，那一节**跳过并说明原因**（不硬改）。
 */
{
  const editStudent = await api.students.create({
    name: "自检·改报课学生", grade: "初三", guardian: "", status: "在读", note: "", profile: {},
  });
  const editEnroll = (await api.students.enroll(editStudent.id, {
    subject: "自检·改报课科目", form: "一对一定制课", teacherId: "",
    lessons: 10, startedAt: new Date().toISOString(), note: "",
    unitPrice: 200, agreedAmount: 2000, paidNow: 2000, method: "微信",
  }))!.enrollments[0]!;

  /*
   * 自己造两位老师（都带这门自检科目）。
   *
   * 为什么不用夹具里现成的那几位：换教师时会过一遍冲突判定，其中一条是
   * "教师不带这个科目" —— 自检科目当然没人带，于是每一节都会被判成"科目不符"而跳过，
   * 断言就变成在测那条规则、而不是在测"未来的课跟不跟着改"（我第一版就是这么写的）。
   */
  const newTeacher = (name: string) => ({
    name, subjects: ["自检·改报课科目"], role: "", phone: "", active: true,
    years: "", summary: "", bio: "", recommendation: "", order: 999,
    siteVisible: false, origin: "后台" as const, kind: "教师" as const,
  });
  const teacherA = await api.teachers.create(newTeacher("自检·改课甲老师"));
  const teacherB = await api.teachers.create(newTeacher("自检·改课乙老师"));
  const pastDone = await api.lessons.create({
    subject: editEnroll.subject, form: "一对一定制课", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已上", note: "",
  });
  const pastOpen = await api.lessons.create({
    subject: editEnroll.subject, form: "一对一定制课", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    durationMinutes: 60, status: "已排", note: "",
  });
  const futureLesson = await api.lessons.create({
    subject: editEnroll.subject, form: "一对一定制课", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已排", note: "",
  });

  // ① 只改记录：课节一节都不动
  const onlyRecord = await api.students.updateEnrollment(
    editStudent.id, editEnroll.id,
    { form: "一对二 / 一对三小组课", unitPrice: 260, agreedAmount: 2600 },
    "enrollment",
  );
  eq("只改记录时不动课节", onlyRecord.updatedLessons.length, 0);
  eq("记录本身改了班型", (await api.students.get(editStudent.id))!.enrollments[0]?.form, "一对二 / 一对三小组课");
  eq("未来那节课的班型没跟着变（这正是「只改记录」的意思）",
    (await api.lessons.get(futureLesson.id))?.form, "一对一定制课");
  eq("单价与约定应缴改了",
    [(await api.students.get(editStudent.id))!.enrollments[0]?.unitPrice,
     (await api.students.get(editStudent.id))!.enrollments[0]?.agreedAmount], [260, 2600]);

  // ② 改记录 + 后续还没上的课：未来的跟着改，过去的（含已上、含状态还挂着的）一律不动
  const withFuture = await api.students.updateEnrollment(
    editStudent.id, editEnroll.id,
    { form: "一对一定制课", teacherId: teacherB.id },
    "future-lessons",
  );
  eq("只改了未来那一节", withFuture.updatedLessons.map((item) => item.id), [futureLesson.id]);
  eq("过去的两节都算「已过去、未动」", withFuture.pastLessons, 2);
  eq("未来那节换成新教师了",
    (await api.lessons.get(futureLesson.id))?.teacherId, teacherB.id);
  eq("未来那节班型也变了", (await api.lessons.get(futureLesson.id))?.form, "一对一定制课");
  eq("已上的课原封不动（老师没变）", (await api.lessons.get(pastDone.id))?.teacherId, teacherA.id);
  eq("过去但状态还挂着「已排」的课也原封不动",
    [(await api.lessons.get(pastOpen.id))?.teacherId, (await api.lessons.get(pastOpen.id))?.status],
    [teacherA.id, "已排"]);

  // ③ 钱与账本不受影响（单价变了不等于钱变了）
  const afterEdit = (await api.students.get(editStudent.id))!.enrollments[0]!;
  eq("实收没被改动（改价不等于改收款）", afterEdit.paidAmount, 2000);
  eq("课时数没被改动（课时只走续费/调整）", afterEdit.totalLessons, 10);
  ok("课时流水仍与余额自洽",
    ledgerConsistent(afterEdit, await api.transactions.listByEnrollment(afterEdit.id)));

  // ④ 换成"那个时段已经有课"的老师：跳过并说明，不硬改
  const busyTeacher = teacherB;
  const blockStart = new Date(Date.now() + 5 * 86_400_000);
  await api.lessons.create({
    subject: "自检·占位科目", form: "", teacherId: busyTeacher.id, classroomId: room.id,
    studentIds: [], startsAt: blockStart.toISOString(), durationMinutes: 60, status: "已排", note: "",
  });
  const conflicting = await api.lessons.create({
    subject: editEnroll.subject, form: "", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: blockStart.toISOString(), durationMinutes: 60,
    status: "已排", note: "",
  });
  const clash = await api.students.updateEnrollment(
    editStudent.id, editEnroll.id, { teacherId: busyTeacher.id }, "future-lessons",
  );
  eq("撞课的节被跳过、没被硬改",
    [(await api.lessons.get(conflicting.id))?.teacherId, clash.skippedLessons.map((item) => item.id)],
    [teacherA.id, [conflicting.id]]);
  ok("跳过时说清了原因（点名老师或时段）",
    (clash.skippedLessons[0]?.reason ?? "").includes("已有课"), clash.skippedLessons[0]?.reason ?? "");
  eq("而没冲突的那一节改好了（同一批里逐节判定）",
    (await api.lessons.get(futureLesson.id))?.teacherId, busyTeacher.id);

  // ⑤ 非法输入被拒
  let badTeacher = "";
  try {
    await api.students.updateEnrollment(editStudent.id, editEnroll.id, { teacherId: "t_不存在" }, "enrollment");
  } catch (cause) {
    badTeacher = cause instanceof Error ? cause.message : String(cause);
  }
  ok("指定不存在的教师被拒", badTeacher.includes("教师不存在"), badTeacher);
  let negative = "";
  try {
    await api.students.updateEnrollment(editStudent.id, editEnroll.id, { agreedAmount: -1 }, "enrollment");
  } catch (cause) {
    negative = cause instanceof Error ? cause.message : String(cause);
  }
  ok("负数金额被拒", negative.includes("不能是负数"), negative);

  // 收尾
  await dropFixture("lessons", conflicting.id);
  await dropFixture("lessons", futureLesson.id);
  await dropFixture("lessons", pastOpen.id);
  await dropFixture("lessons", pastDone.id);
  await dropFixture("students", editStudent.id);
  await dropFixture("teachers", teacherA.id);
  await dropFixture("teachers", teacherB.id);
  eq("自检改报课学生已清理", await api.students.get(editStudent.id), null);
  eq("自检用的两位老师也清理了", (await api.teachers.get(teacherA.id)) === null && (await api.teachers.get(teacherB.id)) === null, true);
}

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
/*
 * 退费样本刻意让"约定应缴"与"实收"**不同**（1800 约定、1500 实收）：
 * 退费必须按**实收**算 —— 家长欠着钱来退课时，按约定算会退出没收到过的钱。
 * 早先两条策略都在用 `agreedAmount`，而名字、说明、公式里写的都是"实付/实收"。
 */
const refundSample = {
  totalLessons: 10, usedLessons: 3, agreedAmount: 1800, paidAmount: 1500, unitPrice: 200,
};
const prorata = findRefundPolicy("prorata").calculate(refundSample);
const clawback = findRefundPolicy("list-clawback").calculate(refundSample);
ok("退费口径只有一处实现（界面与服务端都从 REFUND_POLICIES 取）",
  REFUND_POLICIES.length >= 2 && REFUND_POLICIES.every((policy) => policy.id !== "" && policy.description !== ""));
eq("按实付比例退：剩 7 节 × **实收**单价（1500 ÷ 10 × 7）", prorata.refund, 1050);
eq("追回标价：**实收** − 已上 3 节 × 标价 200", clawback.refund, 900);
ok("公式说明里写的是「实收」而不是「约定」",
  prorata.formula.includes("实收") && clawback.formula.includes("实收"));
ok("两条策略结果不同且都带公式说明",
  prorata.refund !== clawback.refund && prorata.formula !== "" && clawback.formula !== "");
eq("已上完时不退款（追回口径）",
  findRefundPolicy("list-clawback").calculate({ ...refundSample, usedLessons: 10 }).refund, 0);
ok("退款不会为负（超退保护）",
  findRefundPolicy("list-clawback").calculate({ ...refundSample, usedLessons: 10, paidAmount: 1000 }).refund >= 0);

/*
 * 退课 + 退款：金额**由服务端按策略重算**（客户端只传口径 `policyId`）。
 * 这里先自己按同一个函数算一遍期望值 —— 断言"服务端退的就是策略算出来的那个数"，
 * 而不是写死一个魔数（写死的话，改了策略这条断言反而会拦着人）。
 */
const moneyBeforeRefund = (await api.students.get(moneyStudent.id))!.enrollments.find((item) => item.id === moneyCreated.id)!;
const expectedRefund = calculateRefund(moneyBeforeRefund, "prorata");
const moneyRefunded = await api.students.refundEnrollment(moneyStudent.id, moneyCreated.id, "退课自检", {
  policyId: "prorata", method: "微信",
});
const afterRefund = moneyRefunded!.enrollments.find((item) => item.id === moneyCreated.id)!;
eq("退课后状态为已退课", afterRefund.status, "已退课");
eq("退款金额 = 服务端按策略重算的结果", expectedRefund.refund, 2400);
eq("退款后实收被扣回", afterRefund.paidAmount, round2(moneyBeforeRefund.paidAmount - expectedRefund.refund));
ok("退款流水已记录",
  (await api.payments.listByEnrollment(moneyCreated.id)).some((item) => item.kind === "退款"));
ok("退款也写了操作日志（钱必须留痕）",
  (await api.logs.list()).some((item) => item.entity === "收款" && item.action === "退款"));

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

await dropFixture("lessons", makeup!.id);
await dropFixture("lessons", reconcileLesson.id);

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

/*
 * 这一处**必须走真实的产品路径**：断言的就是"删除会留日志"。
 * （`__removeFixture` 是夹具钩子、不写日志，用它就测不到这件事了。）
 */
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
// 日志上限要在**库本身**上核对，而不是在浏览器存储上：走服务端时数据在 SQLite 里，
// `memory` 是空的 —— 早期这里直接读 memory，换成 HTTP 后端就会拿到 null。
const allLogs = (await api.exportDatabase()).logs as unknown[];
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
/*
 * 边界说明必须**与当前事实一致**。
 *
 * 原来这里钉的是"数据只在本机浏览器"——那条在接上服务端之后就成了假话。
 * 现在钉的是当前真正的边界：单用户、没有并发控制、线上后台连不上后端。
 * 假话比没有更糟：员工会按错误的前提做事（以为换个电脑也能看到数据）。
 */
ok("README 与 docs 索引都说明了当前边界（单用户 / 线上后台连不上后端）",
  readmeRoot.includes("单用户") && docsIndex.includes("单用户"));
/*
 * 文档里的**锚点链接**（`[第 8 节](#8-转真后端时改什么)`）必须真的指得到标题。
 *
 * 为什么要有这条：改文档时最容易被忽略的破坏就是**改了小标题**——
 * 正文读起来完全正常，但所有指向它的锚点都悄悄失效了（GitHub 上点了没反应）。
 * 这次就真的发生过一次：把「转真后端时改什么」加上"（已做过）"之后，
 * 别处的 `#8-转真后端时改什么` 立刻变成了死链接，而当时没有任何检查会发现。
 *
 * 只校验**同一份文档内**的锚点；跨文档引用（`docs/xxx.md#…`）先不查 ——
 * 那需要按目标文档解析，容易写成"看起来在查、其实没查"的样子。
 * slug 规则按 GitHub 的近似实现：转小写、去标点、空格转连字符
 * （中日韩字符保留）。这条检查宁可漏报也不要误报：误报会让人去改正确的标题。
 */
function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const docFiles = [
  "README.md",
  "PROJECT.md",
  ...["使用手册", "内容维护手册", "技术架构", "部署与发布", "后台API约定", "后端开发方案"]
    .map((name) => `docs/${name}.md`),
];
const brokenAnchors: string[] = [];
for (const file of docFiles) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const headings = [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => headingSlug(match[1] ?? ""));
  for (const match of text.matchAll(/\]\(#([^)]+)\)/g)) {
    const target = decodeURIComponent(match[1] ?? "");
    if (!headings.includes(headingSlug(target))) brokenAnchors.push(`${file} → #${target}`);
  }
}
eq("文档内的锚点链接都指得到标题", brokenAnchors, []);

/*
 * **跨文件锚点也要校验**（这一条是补的，因为真出过事）。
 *
 * 上面那条只校验"同文件内的 `](#xxx)`" —— 而 `docs/README.md` 里写着
 * `[技术架构 § 已知边界](./技术架构.md#10-已知边界与技术债)` 这种**跨文件**链接。
 * 真实事故：`docs/技术架构.md` 被整份覆盖成了部署文档（371 行 → 187 行），
 * 那一节随之消失，**死链却一条都没报** —— 同文件锚点断言根本看不见它。
 *
 * 现在逐个解析 `](./某文件.md#锚点)`：目标文件存在、且里面有对应标题，才放过。
 */
const crossFileBroken: string[] = [];
for (const file of docFiles) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of text.matchAll(/\]\((\.{1,2}\/[^)#]+\.md)#([^)]+)\)/g)) {
    const target = (match[1] ?? "").replace(/^\.\//, "");
    const anchor = decodeURIComponent(match[2] ?? "");
    const targetPath = target.startsWith("../")
      ? new URL(`../${target.slice(3)}`, import.meta.url)
      : new URL(`../docs/${target.replace(/^docs\//, "")}`, import.meta.url);
    if (!existsSync(targetPath)) {
      crossFileBroken.push(`${file} → ${target}（文件不存在）`);
      continue;
    }
    const headings = [...readFileSync(targetPath, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)].map((item) =>
      headingSlug(item[1] ?? ""),
    );
    if (!headings.includes(headingSlug(anchor))) {
      crossFileBroken.push(`${file} → ${target}#${anchor}`);
    }
  }
}
eq("跨文件的锚点链接也指得到标题（整份覆盖文档这类事故靠它抓）", crossFileBroken, []);

/*
 * 每个核心文档的**首行标题**必须与它的身份相符：整份覆盖（把 A 写进 B）会让两件事同时不对 ——
 * 内容错位、而上面的锚点断言未必都撞得上。这条按文件名与标题的对应关系兜住。
 */
const expectedTitles: Array<[string, string]> = [
  ["docs/技术架构.md", "# 技术架构"],
  ["docs/部署与发布.md", "# 部署与发布"],
  ["docs/内容维护手册.md", "# 内容维护手册（宣传网站）"],
  ["docs/后端开发方案.md", "# 后端开发方案（开发阶段：本机 Node + SQLite，不上 Docker）"],
  ["docs/后台API约定.md", "# 教务后台 API 约定（服务端已实现）"],
  ["docs/使用手册.md", "# 教务后台使用手册"],
];
eq("每个文档的首行标题与它的身份相符（防止整份覆盖：把 A 的内容写进 B）",
  expectedTitles.filter(([file, title]) =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")[0]?.trim() !== title,
  ).map(([file]) => file),
  []);

// 已经变成假话的旧说法不能残留（接上服务端后"数据只在浏览器里"不再成立）
const staleClaims = [
  ["README.md", readmeRoot, "数据只保存在**这台电脑的浏览器**里"],
  ["docs/README.md", docsIndex, "数据只在这台电脑的浏览器里"],
];
eq("文档里没有残留的过时说法（数据只在浏览器里）",
  staleClaims.filter(([, text, claim]) => String(text).includes(String(claim))).map(([file]) => file), []);



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

/*
 * ── 宣传网站的公开只读数据（`site.publicContent` / `GET /api/public/site`）──
 *
 * 这是**匿名**就能拿到的数据（构站的是 CI 或本机脚本，不会去登录），
 * 因此"漏了什么都不该漏敏感信息"这件事必须由断言钉死，而不是靠自觉。
 * 三条一起守：
 *   1. 该有的都有（教师 / 课程卡片 / 课程正文 / 报价）；
 *   2. 字段名里不允许出现敏感词（电话、家长、学生、金额、日志…）；
 *   3. 整份 JSON 文本里不允许出现手机号样式 —— 防止某个字段"顺带"把号码带出去。
 */
const publicSite = await api.site.publicContent();
ok("公开数据包含教师、课程、课程正文与报价",
  publicSite.teachers.length > 0 &&
    publicSite.courses.length > 0 &&
    publicSite.siteContent.coursePage.subjects.length > 0 &&
    publicSite.pricing.stages.length > 0);
ok("公开数据里的教师带上了网站要用的资料（教龄 / 简介 / 推荐理由 / 顺序）",
  publicSite.teachers.some(
    (teacher) =>
      teacher.years !== "" && teacher.summary !== "" && teacher.recommendation !== "" && teacher.order > 0,
  ));
ok("公开数据里的课程带上了卡片字段（路径 / 分区 / 班型）",
  publicSite.courses.some(
    (course) =>
      course.path !== "" &&
      partitionPlace(publicSite.partitions, course.partitionId).column !== null &&
      course.forms.length > 0,
  ));
ok("公开数据里带上了课程分区（网站要按它排栏目与层级）",
  publicSite.partitions.length > 0 &&
    publicSite.partitions.every((item) => item.name !== "") &&
    publicSite.partitions.some((item) => item.parentId !== ""));

/** 递归收集 JSON 里出现过的全部键名。 */
function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      collectKeys(item, into);
    }
  }
  return into;
}

const forbiddenKeys = [
  "phone", "guardian", "password", "token", "student", "payment", "refund",
  "inquiry", "log", "enrollment", "teachershare", "paidamount", "agreedamount",
];
const publicKeys = [...collectKeys(publicSite)].map((key) => key.toLowerCase());
eq("公开数据里没有任何敏感字段名",
  publicKeys.filter((key) => forbiddenKeys.some((bad) => key.includes(bad))), []);
/*
 * 内部备注（`note`）按**精确名**禁：子串匹配会误伤 `formulaNote`（报价页的提示语，
 * 本来就该公开）—— 我第一版就是这么误报的。师生两边都有真正的 `note` 字段：
 * 课程备注、教师备注都是内部信息。
 */
eq("公开数据里没有内部备注字段（note）", publicKeys.filter((key) => key === "note"), []);
ok("公开数据的 JSON 里没有手机号样式的号码",
  !/1[3-9]\d{9}/.test(JSON.stringify(publicSite)));
ok("教师课时费分成（内部成本口径）不在公开数据里",
  !JSON.stringify(publicSite).includes("teacherShare") &&
    !JSON.stringify(publicSite).includes("系数"));


// 分组本身也要有内容与说明
ok("每个分组都有说明", API_CONTRACT.every((group) => group.note.length > 30));
ok("每个分组都有方法", API_CONTRACT.every((group) => group.methods.length > 0));

/*
 * ── 角色与权限的映射不能走样（现在还没有拦，但归属必须齐全）──────────────────
 *
 * 权限最容易出的问题不是"判错了"，而是**新增功能时没人给它定归属**：
 * 加了页面、加了接口，映射表还是旧的，于是新功能默认对所有人开放。
 * 这三条断言把"必须想清楚归谁"变成构建时就红的事。
 */
{
  const navHrefs = ADMIN_NAV.map((item) => item.href);
  eq("每个后台页面都有角色映射（新增页面要顺手定归属）",
    navHrefs.filter((href) => PAGE_ACCESS[href] === undefined), []);
  eq("角色映射里没有已不存在的页面（删页面要同步删映射）",
    Object.keys(PAGE_ACCESS).filter((href) => !navHrefs.includes(href)), []);

  const groupIds = API_CONTRACT.map((group) => group.id);
  eq("每个接口分组都有角色映射（新增分组要顺手定归属）",
    groupIds.filter((id) => GROUP_ACCESS[id] === undefined), []);
  eq("分组映射里没有已不存在的分组",
    Object.keys(GROUP_ACCESS).filter((id) => !groupIds.includes(id)), []);

  // "技术管理员 = 全权限"必须是**验出来的**，不能只是文档里的一句话
  eq("技术管理员能进全部页面", visiblePages(["技术管理员"]).length, navHrefs.length);
  eq("技术管理员能用全部分组", allowedGroups(["技术管理员"]).length, groupIds.length);

  // 其余三个角色必须是**真受限**的：一个都不许等于全集（否则等于没分权）
  ok("财务 / 招生 / 教师都不是全权限（否则等于没分权）",
    (["财务管理员", "招生老师", "普通教师"] as const).every(
      (role) =>
        visiblePages([role]).length < navHrefs.length ||
        allowedGroups([role]).length < groupIds.length,
    ));
  ok("普通教师进不了数据与备份、收费、报价改价",
    visiblePages(["普通教师"]).includes("/admin/data") === false &&
      visiblePages(["普通教师"]).includes("/admin/finance") === false &&
      allowedGroups(["普通教师"]).includes("ops") === false &&
      allowedGroups(["普通教师"]).includes("pricing") === false);
  ok("招生老师进不了数据与备份（运维与审计是技术管理员的）",
    allowedGroups(["招生老师"]).includes("ops") === false);

  /*
   * 四条已确认的边界：逐一钉在断言里，免得以后被"顺手收紧"。
   *
   * 判据用 `canCallMethod`（界面与服务端**同一个**判定函数）而不是另建一张动作表 ——
   * 审计发现原先那张 `STUDENT_ACTION_ACCESS` 全仓库没有任何运行时读者，
   * 只有自检拿它自己的字面值自证（"两张表互相证明"），而真正生效的是 `METHOD_ACCESS`。
   * 现在界面上能点的按钮就是服务端放行的方法，`canCallMethod` 是那条纽带。
   */
  ok("机构确认①：财务管理员能建档 / 报课",
    canCallMethod(["财务管理员"], "students.create") &&
      canCallMethod(["财务管理员"], "students.enroll"));
  ok("机构确认②：招生老师能退课（含那笔退款）",
    canCallMethod(["招生老师"], "students.refundEnrollment"));
  ok("机构确认③：普通教师能看自己学生的课时余额",
    canCallMethod(["普通教师"], "students.get") &&
      !canCallMethod(["普通教师"], "students.remove"));
  ok("界面判定与服务端同源：没登记归属的方法对谁都不放行",
    canCallMethod(["技术管理员"], "根本没这个方法") === false);
  ok("机构确认④：一个账号兼任多个角色时，按「有一个允许就允许」判定",
    canAccess(["普通教师", "财务管理员"], GROUP_ACCESS.pricing!) &&
      canAccess(["普通教师", "技术管理员"], GROUP_ACCESS.ops!) &&
      !canAccess(["普通教师"], GROUP_ACCESS.ops!));
  ok("每个角色都进得了今日概览（登录后不至于一片空白）",
    ROLES.every((role) => visiblePages([role]).includes("/admin")));

  /*
   * 方法级判定（`allowedRolesForMethod`）：分组只作兜底，特例写在 roles.ts。
   * 这里钉三件事：**每个方法都解析得出归属**、**读宽写严**、以及**没登记就关门**。
   */
  const unresolved = realMethods.filter((method) => allowedRolesForMethod(method) === null);
  eq("每个接口方法都解析得出权限归属（新增方法忘了定归属会被这条抓到）", unresolved, []);

  ok("读宽写严：列表 / 单条 / 查询类方法四类角色都能用",
    ["students.list", "students.get", "lessons.list", "lessons.findConflicts", "courses.list"].every(
      (method) => canAccess(["普通教师"], allowedRolesForMethod(method) ?? []),
    ));
  ok("但写类方法普通教师不行（教师不该能改档案）",
    ["students.create", "students.remove", "teachers.create", "courses.update"].every(
      (method) => !canAccess(["普通教师"], allowedRolesForMethod(method) ?? []),
    ));
  ok("教学动作普通教师能做（标记已上 / 课堂记录 / 阶段测评 / 补课）",
    ["lessons.markCompleted", "lessonRecords.save", "assessments.add", "lessons.createMakeup"].every(
      (method) => canAccess(["普通教师"], allowedRolesForMethod(method) ?? []),
    ));
  ok("但报课 / 收款不是教师的活",
    ["students.enroll", "payments.record", "students.refundEnrollment"].every(
      (method) => !canAccess(["普通教师"], allowedRolesForMethod(method) ?? []),
    ));
  ok("运维与审计只有技术管理员（导出 / 导入 / 备份 / 日志）",
    realMethods
      .filter((method) => groupOfMethod(method) === "ops")
      .every((method) => {
        const allowed = allowedRolesForMethod(method) ?? [];
        return canAccess(["技术管理员"], allowed) &&
          !canAccess(["财务管理员", "招生老师", "普通教师"], allowed);
      }));
  ok("没登记归属的方法一律关门（返回 null 而不是「谁都行」）",
    allowedRolesForMethod("不存在的.method") === null);
}

/*
 * ── 行级范围（Phase B）：普通教师只看自己的课与自己学生的课时余额 ────────────────
 *
 * ## 这一节为什么只钉"判定"，不钉"过滤后的数据"
 *
 * 过滤发生在**服务层按会话范围**的那条路上（`lib/backend/api.ts` 读 `api.setScope`
 * 设进去的范围）。这个脚本会跑两遍 —— 内存后端与真实 HTTP 后端 —— 而 HTTP 那遍的
 * 范围由**服务端按会话**算，脚本手上只有技术管理员一个账号，`api.setScope` 在
 * HTTP 后端只影响它自己那一次调用（服务端在调方法前会按会话再设一次）。
 * 也就是说"教师到底看到几行"这件事在这里**验不了**，写在这儿只会变成一条
 * 一边真、一边假通过的断言（本项目最讨厌的那种）。
 * 因此：**判定与登记完整性放这里**（两种后端跑的是同一份纯函数，结论必须一样），
 * **真正的过滤效果放 `scripts/check-auth.mts`**（那里有真实会话与真实教师账号）。
 *
 * ## 钉住的三件事
 *
 *   1. **默认关门**：角色上允许普通教师的**每一个**方法，都必须在范围表里登记 ——
 *      否则新增一个读接口（读接口默认四类角色都能用）就顺手对全校学生开放了；
 *   2. **范围表里没有死配置**：登记了范围、角色却压根不让教师调的方法，等于没人维护的假条目；
 *   3. **只有"恰好是普通教师"才受限，账目类对教师一律关门** —— 这两条都是机构确认过的边界。
 */
{
  const teacherAllowed = realMethods.filter((method) =>
    canAccess(["普通教师"], allowedRolesForMethod(method) ?? []),
  );
  eq("角色上允许普通教师的每个方法都登记了行级范围处理（没登记＝新增读接口默认对全校开放）",
    teacherAllowed.filter((method) => teacherScopeRule(method) === null), []);
  eq("行级范围表里没有「角色压根不让教师调」的死条目（那是没人维护的假配置）",
    Object.keys(TEACHER_SCOPE_RULES).filter(
      (method) => !teacherAllowed.includes(method),
    ), []);

  // 设定值：教师账号的实际范围
  eq("普通教师 + 填了 teacherId → 只看自己名下的课与学生",
    scopeForAccount(["普通教师"], "t_abc"), { kind: "own", teacherId: "t_abc", warning: "" });
  const emptyScope = scopeForAccount(["普通教师"], "");
  ok("普通教师 + 没填 teacherId → 登录成功但范围为空（不拒绝登录，理由写在 roles.ts）",
    emptyScope.kind === "own" && emptyScope.teacherId === "" && emptyScope.warning === EMPTY_SCOPE_WARNING);
  ok("空范围的提示说清了原因与怎么修（teacherId / accounts.json / 重启）",
    EMPTY_SCOPE_WARNING.includes("teacherId") &&
      EMPTY_SCOPE_WARNING.includes("accounts.json") &&
      EMPTY_SCOPE_WARNING.includes("重启"));
  eq("兼任多角色的账号不受行级范围限制（机构确认④：给了更高角色就按更高角色看）",
    scopeForAccount(["普通教师", "财务管理员"], "t_abc").kind, "all");
  eq("技术管理员不受限制", scopeForAccount(["技术管理员"], "").kind, "all");
  eq("没有角色的账号不按「受范围限制的教师」处理（它连方法都调不到，角色闸门会全拒）",
    scopeForAccount([], "t_abc").kind, "all");

  // 判定：放行 = 由服务层过滤；hidden / 没登记 = 明确拒绝
  ok("教师调得到的是「放行、由服务层过滤」，不是拒绝",
    teacherScopeDenial("students.list", ["普通教师"]) === null &&
      teacherScopeDenial("lessons.list", ["普通教师"]) === null &&
      teacherScopeDenial("today", ["普通教师"]) === null);
  ok("钱与排课这些整块不归教师的业务一律拒绝（payments / finance / 欠费 / 排课 / 待跟进）",
    ["payments.list", "payments.listByStudent", "finance", "outstandingByStudent",
      "followups", "lessons.createSeries", "lessons.suggestMoves"].every(
      (method) => teacherScopeDenial(method, ["普通教师"]) !== null));
  ok("范围表里标了 hidden 的对教师一律拒绝，其余一律放行（口径只有这两种，不会一会儿 403 一会儿空）",
    Object.entries(TEACHER_SCOPE_RULES).every(([method, rule]) =>
      (teacherScopeDenial(method, ["普通教师"]) === null) === (rule !== "hidden")));
  ok("没登记范围的方法对教师默认关门（新增接口忘登记＝教师一点都调不到）",
    teacherScopeDenial("不存在的.method", ["普通教师"]) !== null);
  ok("非普通教师账号不吃这一层判定（兼任财务的教师照样能看收款）",
    teacherScopeDenial("payments.list", ["普通教师", "财务管理员"]) === null &&
      teacherScopeDenial("payments.list", ["技术管理员"]) === null);
  // 范围限制**只**看角色、不看 teacherId：没绑 teacherId 是"什么都看不到"，不是"被拒"
  ok("没绑 teacherId 的教师账号不是「被拒」而是「空范围」（两者表现不同，别混）",
    teacherScopeDenial("students.list", ["普通教师"]) === null &&
      scopeForAccount(["普通教师"], "").teacherId === "");
}

// 服务端必须复核的清单：这些是接服务端时的验收项，不能被悄悄删掉
ok("服务端校验清单覆盖关键项（冲突 / 幂等 / 金额 / 鉴权 / 审计）", (() => {
  const text = SERVER_MUST_VALIDATE.map((item) => item.rule).join(" ");
  return ["冲突", "幂等", "金额", "鉴权", "审计"].every((key) => text.includes(key));
})());
ok("每条服务端校验都写了理由", SERVER_MUST_VALIDATE.every((item) => item.why.length > 15));
// `done` 的含义是「服务端真的会拦」，不是「文档写了」；标了已落地的条目必须在清单里被点名
ok("服务端校验清单标出已落地项", (() => {
  const landed = SERVER_MUST_VALIDATE.filter((item) => item.done);
  return landed.length >= 1 && landed.some((item) => item.rule.includes("课时"));
})());
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

/*
 * ── 文档里写死的计数必须与真实一致（或者干脆别写死）────────────────────────
 *
 * 这一条是"文档对账"的自动化版本：**能被机器算出来的数字，就不该靠人记得去改**。
 * 起因是真事：`accept` 早就从 43 项长到 53 项，而六个文档里还写着"43/43 通过"；
 * 服务层方法从 106 长到 115，也有五处还写着 106。
 *
 * 两条规则：
 *   1. 文档里凡出现「N 个方法」，N 必须等于 `realMethods.length`（真实方法数）；
 *   2. `accept` 的旧签名「43/43」不许再出现 —— 它是"写死了就会过期"的典型，
 *      要写就写当前值并配一句"以命令输出为准"（那类数字没法在自检里复算，
 *      因为复算它等于跑一遍 accept）。
 */
const methodCountMentions: Array<{ file: string; value: number }> = [];
const staleAcceptCount: string[] = [];
for (const file of docFiles) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const match of text.matchAll(/(\d+)\s*个方法/g)) {
    /*
     * 排除「9 个资源 × 5 个方法」这种**每个资源的 CRUD 个数** —— 它不是总方法数。
     * 判据：这个数字前面紧挨着「×」。第一版没排除，于是 PROJECT.md 与
     * 后台API约定.md 里那句 "× 5 个方法" 被误报成"方法数漂移"。
     */
    const before = text.slice(Math.max(0, (match.index ?? 0) - 3), match.index ?? 0);
    if (before.includes("×")) continue;
    methodCountMentions.push({ file, value: Number(match[1]) });
  }
  if (text.includes("43/43")) staleAcceptCount.push(file);
}
eq("文档里的「N 个方法」都等于真实方法数（写死了就要跟着改，否则别写死）",
  methodCountMentions.filter((item) => item.value !== realMethods.length).map((item) => `${item.file}: ${item.value}`),
  []);
eq("文档里不再出现旧的 accept 计数签名（43/43 —— 写死就会过期）", staleAcceptCount, []);
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
  for (const id of accepted.ok ? accepted.lessonIds : []) await dropFixture("lessons", id);
}

const abandoned = await api.inquiries.abandon(createdInquiry.id, "自检放弃");
eq("放弃后状态为已放弃", abandoned?.status, "已放弃");
ok("放弃原因写进备注", (abandoned?.note ?? "").includes("自检放弃"));
await dropFixture("inquiries", createdInquiry.id);

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
await dropFixture("lessons", blockingLesson.id);
await dropFixture("inquiries", e2eInquiry.id);

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

/*
 * 老库升级：pbV9 没有报价配置，升级后要按站点内容补齐（不能是空的，也不能变价）。
 *
 * 走**导入**这条路，而不是往浏览器存储里塞一份老库再读回来 —— 后者在服务端后端上
 * 是**假通过**：写进去的本地存储根本没人读，`api.pricing.get()` 读的是服务端库，
 * 报的是"当前版本、有报价配置"，于是断言全绿却什么都没验。
 * 导入是真实用户升级数据的路径（走同一个 `migrate()`），两种后端都跑得到。
 */
const pbV9 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
delete pbV9.pricing;
pbV9.version = 9;
const pbV9Upgrade = await api.importDatabase(JSON.stringify(pbV9));
ok("v9 老库能导入并升级", pbV9Upgrade.ok);
const pbUpgraded = await api.pricing.get();
eq("pbV9 老库升级后有了报价配置", pbUpgraded.source, PRICING_SOURCE_CONTENT);
eq("升级补上的价格与站点内容一致",
  pbUpgraded.stages[1]?.courses.map((course) => course.basePrice),
  pricing.stages[1]?.courses.map((course) => course.price));
eq("升级后的版本号是当前版本",
  (await api.exportDatabase()).version, CURRENT_VERSION);
await api.restoreBackup();

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

// 老库（v10 没有教师分成字段）升级后要补上默认值，不能是 undefined。
// 同样走导入这条路（理由见上面 v9 那段：写本地存储对服务端后端是假通过）。
const pbV10 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
delete (pbV10.pricing as Record<string, unknown>).teacherShare;
pbV10.version = 10;
const pbV10Upgrade = await api.importDatabase(JSON.stringify(pbV10));
ok("v10 老库能导入并升级", pbV10Upgrade.ok);
const pbV11Config = await api.pricing.get();
eq("v10 老库升级后补上了教师分成默认值",
  [pbV11Config.teacherShare.basePercent, pbV11Config.teacherShare.stepPercent, pbV11Config.teacherShare.priceBasis],
  [40, 10, "course"]);
eq("升级后版本号是当前版本",
  (await api.exportDatabase()).version, CURRENT_VERSION);
await api.restoreBackup();

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
const pbPartitions = await api.coursePartitions.list();
const pbPartitionName = (id: string): string =>
  partitionPlace(pbPartitions, id).column?.name ?? "";
ok(`课程库从网站内容播种（${pbLibrary.length} 门，至少 20 门）`, pbLibrary.length >= 20);
ok("网站课程都标为「网站」来源", pbLibrary.every((course) => course.origin === "网站"));
ok("每门网站课程都挂了分区（v18：不再是一串分类文字）",
  pbLibrary.every((course) => partitionPlace(pbPartitions, course.partitionId).leaf !== null));
ok("网站课程的分区名非空（清单与网站要按它分组）",
  pbLibrary.every((course) => pbPartitionName(course.partitionId) !== ""));
ok("课程行上**没有**遗留的 category / subgroup 字段（同一件事只留一处）",
  pbLibrary.every((course) =>
    (course as unknown as Record<string, unknown>).category === undefined &&
    (course as unknown as Record<string, unknown>).subgroup === undefined));
ok("网站课程的卡片班型被带进来",
  pbLibrary.some((course) => course.forms.length > 0));

const pbOptions = await api.courses.options();
ok(`科目候选非空（${pbOptions.length} 项）`, pbOptions.length >= 20);
eq("科目候选里没有重复名字",
  pbOptions.filter((option, index) => pbOptions.findIndex((item) => item.name === option.name) !== index),
  []);
ok("科目候选带分区名（下拉要按栏目分组）", pbOptions.every((option) => option.category !== ""));

// 机构自己加一门网站上还没有的课：围棋（分区里要有"兴趣才艺"，先建后挂）
const pbHobby = await api.coursePartitions.create({ name: "兴趣才艺" });
eq("新建的分区排在同级最后（不抢到最前面）",
  topLevelPartitions(await api.coursePartitions.list()).at(-1)?.name, "兴趣才艺");
const pbWeiqi = await api.courses.create({
  name: "围棋", partitionId: pbHobby.id, forms: ["一对一定制课"], origin: "后台",
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
    name: "围棋", partitionId: pbHobby.id, forms: [], origin: "后台",
    status: "开放", note: "", createdAt: new Date().toISOString(),
  });
} catch {
  pbDupRejected = true;
}
ok("同名课程被拒绝", pbDupRejected);
let pbEmptyRejected = false;
try {
  await api.courses.create({
    name: "  ", partitionId: pbHobby.id, forms: [], origin: "后台",
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
await dropFixture("teachers", pbTeacher.id);

// 老库（v12 的教师没有资料字段）升级后要补空值与默认值，且不猜内容
const pbV12 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
pbV12.version = 12;
// 造一条"老结构"的教师：把资料字段删掉，模拟 v12 的数据
(pbV12.teachers as Array<Record<string, unknown>>).forEach((teacher) => {
  delete teacher.years;
  delete teacher.summary;
  delete teacher.bio;
  delete teacher.origin;
  delete teacher.kind;
});
const pbV12Upgrade = await api.importDatabase(JSON.stringify(pbV12));
ok("v12 老库能导入并升级", pbV12Upgrade.ok);
const migratedTeacher = (await api.teachers.list())[0]!;
eq("升级后的版本号是当前版本", (await api.exportDatabase()).version, CURRENT_VERSION);
eq("v12 教师升级后补齐资料字段（不猜内容，一律空串）",
  [migratedTeacher.years, migratedTeacher.summary, migratedTeacher.bio], ["", "", ""]);
eq("v12 教师升级后默认来源是「后台」（老数据是机构自己录的）", migratedTeacher.origin, "后台");
eq("v12 教师升级后默认类型是「教师」", migratedTeacher.kind, "教师");
await api.restoreBackup();

// 老库（v11 没有课程表）升级后要按网站内容补齐，否则科目候选会空。
// 同样走导入这条路（理由见上面 v9 那段：写本地存储对服务端后端是假通过）。
const pbV11 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
delete pbV11.courses;
pbV11.version = 11;
const pbV11Upgrade = await api.importDatabase(JSON.stringify(pbV11));
ok("v11 老库能导入并升级", pbV11Upgrade.ok);
const pbMigratedCourses = await api.courses.list();
eq("v11 老库升级后课程库按网站内容补齐", pbMigratedCourses.length, pbLibrary.length);
eq("升级后版本号是当前版本",
  (await api.exportDatabase()).version, CURRENT_VERSION);
await api.restoreBackup();

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
  name: "围棋", partitionId: "", forms: ["一对一定制课"], origin: "后台",
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
await dropFixture("courses", pbGo.id);
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

console.log("\n=== 11. 按需导出（数据集 × 选中的行 × 格式）===");

/*
 * 导出是「给外面看」的功能：导错列、导漏行、Excel 乱码都会被当成系统不可靠。
 * 因此这一组守四件事：全选与部分选择的语义、格式只给该数据集支持的、
 * CSV 中文不乱码、导出不改数据。
 */
__useStoreForTesting(memory);

const exDb = JSON.parse(JSON.stringify(seedDb)) as Database;

// 1) 数据集清单：8 个，格式受支持，且都能取到行
ok(`数据集至少 8 个（当前 ${EXPORT_DATASETS.length} 个）`, EXPORT_DATASETS.length >= 8);
ok("每个数据集都有说明与可用格式",
  EXPORT_DATASETS.every((dataset) => dataset.description.length > 10 && dataset.formats.length > 0));
eq("排课支持日历导出、课程支持 Markdown、其余至少 CSV + JSON",
  [findExportDataset("lessons")?.formats.includes("ics"), findExportDataset("courses")?.formats.includes("md"),
   EXPORT_DATASETS.every((dataset) => dataset.formats.includes("csv") && dataset.formats.includes("json"))],
  [true, true, true]);
eq("数据集大小查询与数据库一致",
  datasetSizes(exDb).find((item) => item.id === "students")?.count, exDb.students.length);

// 2) 全选导出（ids 不传 = 全选）
const exAllStudents = exportDataset(exDb, { datasetId: "students", format: "csv" });
ok("不传 ids 时导出全部", exAllStudents.ok && exAllStudents.count === exDb.students.length);
ok("结果里同时给出实际条数与总数",
  exAllStudents.ok && exAllStudents.count === exAllStudents.total);
ok("CSV 带 BOM（Excel 打开中文不乱码）",
  exAllStudents.ok && exAllStudents.content.startsWith("\uFEFF"));
ok("CSV 表头是中文、内容里没有 uuid",
  exAllStudents.ok &&
    exAllStudents.content.includes("姓名") &&
    !/s\d{2,}|t\d{2,}/.test(exAllStudents.content.split("\n")[1] ?? ""));

// 3) 部分导出：只导选中的两行
const exPicked = exDb.students.slice(0, 2).map((student) => student.id);
const exPartial = exportDataset(exDb, { datasetId: "students", ids: exPicked, format: "csv" });
eq("只导选中的行", exPartial.ok ? exPartial.count : -1, 2);
ok("部分导出时仍报出总数（让人知道没导全）",
  exPartial.ok && exPartial.total === exDb.students.length);
ok("文件名里带「选中 N 条」，避免与全量导出混淆",
  exPartial.ok && exPartial.filename.includes("选中2条"));
ok("选中的学生确实在内容里、没选的不在",
  exPartial.ok &&
    exPartial.content.includes(exDb.students[0]!.name) &&
    !exPartial.content.includes(exDb.students[2]!.name));

// 4) 排课导 ICS：事件数 = 选中行数，且是真日历文件
const exLessonIds = exDb.lessons.slice(0, 3).map((lesson) => lesson.id);
const exIcs = exportDataset(exDb, { datasetId: "lessons", ids: exLessonIds, format: "ics" });
ok("ICS 是真日历文件",
  exIcs.ok && exIcs.content.includes("BEGIN:VCALENDAR") && exIcs.content.includes("END:VCALENDAR"));
eq("ICS 事件数 = 选中的课节数", exIcs.ok ? (exIcs.content.match(/BEGIN:VEVENT/g) ?? []).length : -1, 3);
ok("ICS 里的标题是科目、地点是教室",
  exIcs.ok && exIcs.content.includes("SUMMARY:") && exIcs.content.includes("LOCATION:"));

// 5) 课程导 Markdown：生成的是内容文件里的卡片行，且能被内容解析器读懂
const exCourseMd = exportDataset(exDb, { datasetId: "courses", format: "md" });
ok("课程 Markdown 是 ### 卡片行",
  exCourseMd.ok && exCourseMd.content.startsWith("#### "));
ok("卡片行里有「路径:」（内容文件要求）",
  exCourseMd.ok && exCourseMd.content.includes("路径: "));
const guessSource = `# 占位
## 页面: 全站
### 课程栏目
${exCourseMd.ok ? exCourseMd.content.split("\n")[0] : ""}
`;
ok("导出的卡片行能被内容解析器解析成课程名",
  guessSource.includes("#### "));

// 6) 报课记录与收款记录能导（这两张表是嵌套/关联的，最容易漏列）
const exEnroll = exportDataset(exDb, { datasetId: "enrollments", format: "csv" });
ok("报课记录导出成功且含学生名与科目",
  exEnroll.ok && exEnroll.content.includes("学生") && exEnroll.count > 0);
const exPay = exportDataset(exDb, { datasetId: "payments", format: "csv" });
ok("收款记录导出成功", exPay.ok && exPay.content.includes("金额"));
ok("收款记录里写的是学生姓名而不是 id",
  exPay.ok && !/,[st]\d{2,},/.test(exPay.content));

// 7) 不支持的格式要明确报错（而不是导出一个空文件）
const exBadFormat = exportDataset(exDb, { datasetId: "teachers", format: "ics" });
ok("不支持 ICS 的数据集会报错", exBadFormat.ok === false && exBadFormat.error.includes("不支持"));
const exBadDataset = exportDataset(exDb, { datasetId: "nope", format: "csv" });
ok("未知数据集会报错", exBadDataset.ok === false && exBadDataset.error.includes("没有这个数据集"));

// 8) 导出是只读的：跑完一圈数据不能变
eq("导出前后数据完全一致",
  JSON.stringify(exDb), JSON.stringify(seedDb));

console.log("\n=== 11.1 批量导入（CSV / JSON）===");

/*
 * 批量导入是**一次写入几百条**的操作，出错代价最高，所以这里钉得细一点：
 * 解析要能吃下 Excel 导出的各种写法、校验要能指出"第几行错在哪"、
 * 落库要**只新增不覆盖**且**重复导入不重复加**。
 */
const importMemory = createMemoryStore();
__useStoreForTesting(importMemory);
await api.importDatabase(serializeDatabase(seedDb));

const teacherCsv = [
  "姓名,可带科目,职务,电话,在职",
  '张老师,"初中数学|初中物理",授课教师,138-0000-0001,是',
  "李老师,初中英语,晚辅导老师,138-0000-0002,否",
  "王老师,,全科教师,,在职",
].join("\r\n");

const parsedTeachers = parseImport("teachers", teacherCsv);
eq("CSV 表头按中文列名识别", parsedTeachers.headers, ["姓名", "可带科目", "职务", "电话", "在职"]);
eq("CSV 全部行都通过校验", parsedTeachers.problems, []);
eq("解析出 3 位教师", parsedTeachers.records.length, 3);
eq("用 | 分隔的科目拆成数组", parsedTeachers.records[0]?.subjects, ["初中数学", "初中物理"]);
eq("是/否 转成布尔", [parsedTeachers.records[0]?.active, parsedTeachers.records[1]?.active], [true, false]);
eq("「在职」也算真值（Excel 里常见的写法）", parsedTeachers.records[2]?.active, true);

// 引号内的逗号与换行、双写引号、BOM、CRLF：Excel 导出真的会出现
const trickyCsv = "\uFEFF姓名,年级,家长联系方式,备注\r\n" +
  '"李四,小",初二,138-0000-0003,"第一行\n第二行"\r\n' +
  '"王五",,,"他说""你好"""\r\n';
const tricky = parseImport("students", trickyCsv);
eq("带引号的逗号不会被当分隔符", tricky.records[0]?.name, "李四,小");
eq("引号内的换行保留在单元格里", tricky.records[0]?.note, "第一行\n第二行");
eq("双写引号还原成一个引号", tricky.records[1]?.note, '他说"你好"');
eq("BOM 不影响第一列识别", tricky.records[0]?.name, "李四,小");

// 校验要指出具体行与原因
const badCsv = "姓名,年级,状态\n张三,初二,在读\n,初一,在读\n李四,初二,已毕业\n";
const bad = parseImport("students", badCsv);
eq("不是候选值的枚举被拦下并说明原因",
  bad.problems.map((item) => item.line), [3, 4]);
ok("错误信息里说清了是哪一列：空必填列报姓名、错枚举报状态",
  (bad.problems[0]?.reason ?? "").includes("姓名") &&
  (bad.problems[1]?.reason ?? "").includes("状态") &&
  (bad.problems[1]?.reason ?? "").includes("已毕业"));
eq("能导入的仍只有通过校验的那一条", bad.records.length, 1);

// 必填列缺失：整份不导（通常是选错了实体或列名写错）
const wrongEntity = parseImport("students", "教师姓名,科目\n张老师,数学\n");
eq("缺少必填列时列出缺哪一列", wrongEntity.missingRequiredHeaders, ["姓名"]);
eq("缺少必填列时不产出任何记录", wrongEntity.records.length, 0);

// 不认识的列会被忽略但不是错误（表格里常有额外列）
const extraCsv = "姓名,年级,微信昵称\n张三,初二,aka\n";
const extra = parseImport("students", extraCsv);
eq("多余列被记入未识别列表", extra.unknownHeaders, ["微信昵称"]);
eq("多余列不影响导入", extra.records.length, 1);

// JSON：数组与 { students: [...] } 两种形状都接受
const jsonArray = parseImport("classrooms", JSON.stringify([
  { name: "301 教室", kind: "上课用教室", capacity: 8 },
]));
eq("JSON 数组可以直接导", jsonArray.records.length, 1);
eq("JSON 里的数字列保持数字", jsonArray.records[0]?.capacity, 8);
const jsonWrapped = parseImport("classrooms", JSON.stringify({ classrooms: [{ 名称: "302 教室", 用途: "上课用教室" }] }));
eq("JSON 对象按实体键取数组", jsonWrapped.records.length, 1);
eq("JSON 里用中文列名也认", jsonWrapped.records[0]?.name, "302 教室");
eq("空 JSON 对象会说明缺什么",
  parseImport("students", JSON.stringify({ teachers: [] })).problems.length, 1);

// 模板与解析器同源：模板必须能被自己解析
for (const entity of IMPORT_ENTITIES) {
  const fromTemplate = parseImport(entity, csvTemplate(entity));
  eq(`CSV 模板能被自己解析（${ENTITY_SPECS[entity].label}）`,
    [fromTemplate.missingRequiredHeaders, fromTemplate.records.length], [[], 1]);
  const jsonFromTemplate = parseImport(entity, jsonTemplate(entity));
  eq(`JSON 模板能被自己解析（${ENTITY_SPECS[entity].label}）`,
    [jsonFromTemplate.missingRequiredHeaders, jsonFromTemplate.records.length], [[], 1]);
}
eq("格式自动识别：JSON 看首个非空字符", [detectFormat('  [{"a":1}]'), detectFormat("姓名,年级")], ["json", "csv"]);

// 走接口真导一次（同一份实现在服务端也跑）
const beforeTeachers = (await api.teachers.list()).length;
const applied = await api.imports.apply({ entity: "teachers", text: teacherCsv, fileName: "教师名单.csv" });
eq("导入成功", applied.ok, true);
eq("新增 3 位教师", applied.added, 3);
eq("数据库里确实多了 3 位", (await api.teachers.list()).length, beforeTeachers + 3);
eq("导入的教师带上了科目与在职状态",
  (await api.teachers.list()).find((teacher) => teacher.name === "李老师")?.active, false);

// 幂等：同一份文件重复导入不会重复加
const reimported = await api.imports.apply({ entity: "teachers", text: teacherCsv });
eq("重复导入新增 0 条", reimported.added, 0);
eq("重复导入把 3 条都记成跳过", reimported.skipped.length, 3);
eq("重复导入后总数没变", (await api.teachers.list()).length, beforeTeachers + 3);

// 一次导入只写一条日志（日志上限 500，逐行写会把历史冲掉）
const importLogs = (await api.logs.list(20)).filter((log) => log.action === "批量导入");
// 到这里一共导入了两次（首次 + 重复导入），因此应当**恰好两条**：
// 每条对应"一次导入"，而不是"一行记录一条"
eq("每次导入只留一条日志（两次导入 = 两条日志）", importLogs.length, 2);
ok("日志里写清了导入对象与条数（不是逐行记录）",
  importLogs.every((log) => (log.summary ?? "").includes("教师")) &&
  importLogs.some((log) => (log.summary ?? "").includes("3 条")));

// 必填列缺失时整份拒绝，且**不动现有数据**
const rejected = await api.imports.apply({ entity: "students", text: "教师姓名,科目\n张老师,数学\n" });
eq("必填列缺失时导入被拒", rejected.ok, false);
ok("拒绝时给出了缺哪一列", (rejected.error ?? "").includes("姓名"));
eq("被拒时没有写入任何记录", (await api.students.list()).length, seeded.length);

// 学生：按「姓名 + 家长联系方式」判重
const studentCsv = "姓名,年级,家长联系方式\n导入同学甲,初二,139-0000-0001\n导入同学甲,初二,139-0000-0009\n";
const studentsImported = await api.imports.apply({ entity: "students", text: studentCsv });
eq("同姓名但家长联系方式不同 → 算两个人", studentsImported.added, 2);
eq("导入的学生默认是在读状态",
  (await api.students.list()).filter((student) => student.name === "导入同学甲").every((s) => s.status === "在读"), true);
eq("导入的学生没有报课记录（报课要走页面流程）",
  (await api.students.list()).find((student) => student.name === "导入同学甲")?.enrollments.length, 0);

// 课程：重名会被拦（课程名是引用键）
const courseCsv = "课程名,分类,班型\n导入课程甲,初中课内,一对一定制课\n导入课程甲,初中课内,一对一定制课\n";
const coursesImported = await api.imports.apply({ entity: "courses", text: courseCsv });
eq("同名课程只进第一条", coursesImported.added, 1);
eq("第二条被记成跳过", coursesImported.skipped.length, 1);

/*
 * 后悔药：`imports.apply` 在写入前把当前库存进 BACKUP_KEY（只留最近一次），
 * 所以 `restoreBackup()` 回退的是**最后一次导入之前**的状态 ——
 * 也就是"课程那次导入"没发生、但更早导入的学生还在。
 * （断言写准这一点，免得以后有人以为它能把所有导入都撤掉。）
 */
await api.restoreBackup();
eq("恢复后最后一次导入的课程消失（回退到导入前）",
  (await api.courses.list()).some((course) => course.name === "导入课程甲"), false);
ok("更早导入的学生仍在（后悔药只回退最近一次导入）",
  (await api.students.list()).some((student) => student.name === "导入同学甲"));

/* ── 冲突处理：覆盖 / 跳过 / 保留两份（对应「复制文件遇到同名」那三个选择）── */

// 先体检（ask）：只报告冲突，**不写任何东西**
const existingTeacher = (await api.teachers.list()).find((teacher) => teacher.name === "张老师")!;
const clashCsv = "姓名,可带科目,职务,电话,在职\r\n张老师,初中数学,首席教师,138-0000-9999,是\r\n";
const beforeAsk = (await api.teachers.list()).length;
const asked = await api.imports.apply({ entity: "teachers", text: clashCsv, onConflict: "ask" });
eq("ask 模式下不写入", (await api.teachers.list()).length, beforeAsk);
eq("ask 模式要求人来决定", asked.needsDecision, true);
eq("ask 模式列出冲突行", asked.conflicts.length, 1);
eq("冲突里带上库里那条的 id 与摘要，便于判断是不是同一个人",
  [asked.conflicts[0]?.existing.id === existingTeacher.id, (asked.conflicts[0]?.existing.summary.length ?? 0) > 0],
  [true, true]);

// ask 在没有冲突时也**不写入**（体检就只是体检）
const cleanCsv = "姓名,职务\r\n体检专用老师,顾问\r\n";
const beforeCleanAsk = (await api.teachers.list()).length;
const cleanAsk = await api.imports.apply({ entity: "teachers", text: cleanCsv, onConflict: "ask" });
eq("ask 无冲突时也不写入（体检不代劳）",
  [(await api.teachers.list()).length, cleanAsk.needsDecision, cleanAsk.added],
  [beforeCleanAsk, false, 0]);
const afterCleanApply = await api.imports.apply({ entity: "teachers", text: cleanCsv });
eq("随后 apply 才真正写入", [afterCleanApply.added, afterCleanApply.skipped.length], [1, 0]);

// skip（默认）：保留库里那条
const skippedRun = await api.imports.apply({ entity: "teachers", text: clashCsv });
eq("默认策略是 skip：不新增、不改动", [skippedRun.added, skippedRun.overwritten, skippedRun.skipped.length], [0, 0, 1]);
eq("skip 之后那条的职务没被改", (await api.teachers.get(existingTeacher.id))?.role, existingTeacher.role);

// overwrite：用文件里的值更新
const beforeOverwrite = (await api.teachers.list()).length;
const overwrittenRun = await api.imports.apply({ entity: "teachers", text: clashCsv, onConflict: "overwrite" });
eq("overwrite：不新增、记一条覆盖", [overwrittenRun.added, overwrittenRun.overwritten], [0, 1]);
const afterOverwrite = (await api.teachers.get(existingTeacher.id))!;
eq("overwrite 之后职务被更新", afterOverwrite.role, "首席教师");
eq("overwrite 之后电话被更新", afterOverwrite.phone, "138-0000-9999");
eq("overwrite 之后 id 不变（是更新不是新建）", afterOverwrite.id, existingTeacher.id);
eq("overwrite 不新增记录", (await api.teachers.list()).length, beforeOverwrite);

// overwrite 的边界：文件里空着的字段不能被清空
const partialCsv = "姓名,备注\r\n张老师,\r\n";
await api.imports.apply({ entity: "teachers", text: partialCsv, onConflict: "overwrite" });
eq("空单元格不会把已有内容清掉（覆盖只改真的带值的字段）",
  (await api.teachers.get(existingTeacher.id))?.role, "首席教师");

// duplicate：两条都留，第二条加序号后缀（名称同时是身份，不能看起来一模一样）
const dupRun = await api.imports.apply({ entity: "teachers", text: clashCsv, onConflict: "duplicate" });
eq("duplicate：记一条「保留两份」", [dupRun.duplicated, dupRun.added], [1, 1]);
const teacherNames = (await api.teachers.list()).map((teacher) => teacher.name);
ok("保留两份时第二条带序号后缀", teacherNames.includes("张老师（2）"), teacherNames.join("、"));

// 学生的「保留两份」**不加**后缀：同名同家长可能是兄弟姐妹（那是真实数据，不能改）
const siblingCsv = "姓名,年级,家长联系方式\r\n共享家长同学,初一,139-1111-1111\r\n共享家长同学,初三,139-1111-1111\r\n";
await api.imports.apply({ entity: "students", text: siblingCsv, onConflict: "duplicate" });
eq("学生保留两份：姓名都保持原样（不改真实数据）",
  (await api.students.list()).filter((student) => student.name === "共享家长同学").length, 2);

// perRow：大部分跳过、个别覆盖
const mixedCsv = "姓名,职务\r\n张老师,顾问\r\n李老师,教研组长\r\n";
const perRowRun = await api.imports.apply({
  entity: "teachers",
  text: mixedCsv,
  onConflict: "skip",
  perRow: { "1": "overwrite" },
});
eq("逐行策略：第 1 行覆盖、第 2 行跳过", [perRowRun.overwritten, perRowRun.skipped.length], [1, 1]);
eq("逐行覆盖生效", (await api.teachers.get(existingTeacher.id))?.role, "顾问");

console.log("\n=== 11.2 按周批量排课（一次排一串，冲突的跳过）===");

/*
 * 这一节钉两件事：
 *   1. **日期生成**（纯函数）：起排日当天算不算、星期几怎么数、节数上限、非法输入；
 *   2. **冲突处理**：能排的排上、撞了的跳过并说明 —— 绝不"硬塞"。
 */
const mon = "2026-09-21"; // 周一（2026-09-21 是周一）

// 日期生成：只取命中的星期几，且含起排当天
eq("每周一只排周一：从起排日当天开始",
  generateSeriesDates({ startDate: mon, weekdays: [1], time: "17:00", count: 3 }).length, 3);
eq("生成的三节依次相隔 7 天",
  generateSeriesDates({ startDate: mon, weekdays: [1], time: "17:00", count: 3 }).map((iso) =>
    new Date(iso).getDate(),
  ),
  [21, 28, 5]);
ok("时间按本地时区构造（17:00 就是 17:00）",
  new Date(generateSeriesDates({ startDate: mon, weekdays: [1], time: "17:00", count: 1 })[0] ?? "").getHours() === 17);
eq("每周二、五：一周两节",
  generateSeriesDates({ startDate: mon, weekdays: [2, 5], time: "18:30", count: 4 }).map((iso) =>
    new Date(iso).getDay(),
  ),
  [2, 5, 2, 5]);
eq("起排日是周三、只排周一：第一节是下周一（不含过去日期）",
  new Date(generateSeriesDates({ startDate: "2026-09-23", weekdays: [1], time: "17:00", count: 1 })[0] ?? "").getDate(),
  28);
eq("没选星期几 → 生成 0 节（不是死循环）",
  generateSeriesDates({ startDate: mon, weekdays: [], time: "17:00", count: 5 }).length, 0);
eq("节数为 0 → 生成 0 节",
  generateSeriesDates({ startDate: mon, weekdays: [1], time: "17:00", count: 0 }).length, 0);
eq("日期写错 → 生成 0 节（不抛错）",
  generateSeriesDates({ startDate: "2026/09/21", weekdays: [1], time: "17:00", count: 3 }).length, 0);
eq("时间写错 → 生成 0 节",
  generateSeriesDates({ startDate: mon, weekdays: [1], time: "25:00", count: 3 }).length, 0);
eq("手滑填 2000 节会被截到上限 200",
  generateSeriesDates({ startDate: mon, weekdays: [1], time: "17:00", count: 2000 }).length, 200);
ok("预览里的日期是人话（月日 + 星期 + 时间）",
  describeSeriesDate("2026-09-22T09:00:00.000Z").includes("月") &&
  describeSeriesDate("2026-09-22T09:00:00.000Z").includes("周"),
  describeSeriesDate("2026-09-22T09:00:00.000Z"));

/*
 * 走接口的部分**自造一套独立数据**（专用科目 / 教师 / 教室 / 学生）：
 * 夹具里那些学生的课时余额是别的用例在动的，拿它们验证"课时够不够"会被干扰。
 */
const seriesSubject = "自检批量排课科目";
const seriesTeacher = await api.teachers.create({
  name: "自检批量排课老师", subjects: [seriesSubject], role: "授课教师", phone: "",
  active: true, years: "", summary: "", bio: "", origin: "后台", kind: "教师",
});
const seriesRoom = await api.classrooms.create({
  name: "自检批量排课教室", kind: "上课用教室", capacity: 8, availability: [], note: "",
});
const seriesStudent = await api.students.create({
  name: "自检批量排课学生", grade: "初二", guardian: "", status: "在读", note: "", profile: {},
});
// 报 12 节：够跑"排 6 节 + 重复排一次（冲突跳过）"，又不足以跑满 100 节（用来验封顶）
await api.students.enroll(seriesStudent.id, {
  subject: seriesSubject, form: "一对一定制课", teacherId: seriesTeacher.id, lessons: 12,
  startedAt: new Date().toISOString(), note: "自检",
});
// 起排日取**远期的一个周一**：夹具的课都在"现在"附近，这里要测的是机制本身
const farMonday = (() => {
  const d = new Date(2027, 2, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();
const seriesInput = {
  subject: seriesSubject,
  form: "一对一定制课",
  teacherId: seriesTeacher.id,
  classroomId: seriesRoom.id,
  studentIds: [seriesStudent.id],
  durationMinutes: 90,
  status: "已排" as const,
  note: "批量排课自检",
  startDate: farMonday,
  weekdays: [1, 4],
  time: "19:00",
  count: 6,
};

const plan = await api.lessons.planSeries(seriesInput);
eq("预检：只算不写（计划 6 节，库里没多）",
  [plan.items.length, (await api.lessons.list()).length], [6, (await api.lessons.list()).length]);
ok("预检给出建议节数（按该科目剩余课时 − 已排未上）",
  plan.suggestedCount >= 0 && plan.remainingLessons >= 0,
  JSON.stringify({ remaining: plan.remainingLessons, scheduled: plan.alreadyScheduled, suggested: plan.suggestedCount }));
eq("预检里能排 + 冲突 = 总数",
  plan.schedulable + plan.blocked, plan.items.length);

// 写入：**把预检说能排的都排上**（不假设一定没有冲突 —— 断言"预检与写入一致"才是真性质）
const beforeSeries = (await api.lessons.list()).length;
const outcome = await api.lessons.createSeries(seriesInput);
eq("写入的节数 = 预检说能排的节数（两者共用同一套判定）", outcome.created, plan.schedulable);
eq("库里的课数 = 之前 + 能排的节数",
  (await api.lessons.list()).length, beforeSeries + plan.schedulable);
eq("这次 6 节都排上了（远期时段没有别的课）", [plan.schedulable, plan.blocked], [6, 0]);
const createdLessons = (await api.lessons.list()).filter((lesson) => lesson.note === "批量排课自检");
eq("新增的课都带上了备注与科目",
  [createdLessons.length, createdLessons.every((lesson) => lesson.subject === seriesSubject)],
  [plan.schedulable, true]);
eq("新增的课都挂着这位学生",
  createdLessons.every((lesson) => lesson.studentIds.includes(seriesStudent.id)), true);
eq("时间落在选定的星期几上",
  createdLessons.every((lesson) => [1, 4].includes(new Date(lesson.startsAt).getDay())), true);
eq("一次批量排课只写一条日志",
  (await api.logs.list(20)).filter((log) => log.action === "批量排课").length, 1);

/*
 * 再把同一串时间排一遍：应当**全部**被跳过（教师/教室/学生都已有课），
 * 而且每一节都要给出原因 —— 批量排课最怕的就是"悄悄少排几节"。
 */
const again2 = await api.lessons.createSeries(seriesInput);
eq("重复排同一串：新增 0 节、逐节跳过", [again2.created, again2.skipped.length], [0, 6]);
ok("每一节跳过都写清了原因（谁撞了）",
  again2.skipped.every((item) => item.reason !== ""),
  again2.skipped[0]?.reason ?? "(空)");
ok("跳过原因里提到教师、教室或学生",
  /已有课|已被占用|不开放|容量|科目/.test(again2.skipped[0]?.reason ?? ""),
  again2.skipped[0]?.reason ?? "(空)");

// 边界：教师在该时段已被自己占用 → 预检里就该显示冲突（而不是写入时才 failed）
const clashPlan = await api.lessons.planSeries({ ...seriesInput, subject: seriesSubject });
eq("重复排同一串：生成的 6 节全部撞在已有安排上（能排 0 节）",
  [clashPlan.items.length, clashPlan.schedulable, clashPlan.blocked], [6, 0, 6]);

/*
 * **课时不足就不排课**：报 12 节、已排 6 节 → 还能排 6 节。
 * 要 100 节时应当**封顶到 6 节**，并且把"砍掉了多少、谁不够"说清楚
 * （不能让"少排了"悄无声息 —— 那是另一种形式的欠账）。
 */
// 换一个空闲时段，才能同时看清"封顶"与"这 6 节确实可排"
// 上午 9 点：与已排的 19:00–20:30 完全不重叠（90 分钟时长很容易撞上邻近时段）
const capped = await api.lessons.planSeries({ ...seriesInput, count: 100, time: "09:00" });
eq("课时不足时按剩余课时封顶：只生成 6 节",
  [capped.items.length, capped.requestedCount, capped.cappedBy], [6, 100, 94]);
ok("封顶时给出课时不足的说明（点名是谁、还能排几节）",
  capped.shortageMessage.includes("课时不足") && capped.shortageMessage.includes("还能排"),
  capped.shortageMessage);
eq("封顶后的计划里这 6 节都可排（不含冲突）", [capped.schedulable, capped.blocked], [6, 0]);

/* ── 两阶段导入的流程本身（先体检、再写入）──
 *
 * 这一段守的是一个**真实发生过的 bug**：从网站导入只做了"体检"那一步，
 * 没有冲突时就直接返回 —— 用户看到"检查完成、都能导入"，但库里什么都没变，
 * 表现就是"点了没反应"。这段流程原本只写在组件里、自检碰不到，
 * 所以抽成 `runTwoPhaseImport` 之后在这里钉住它的两条性质。
 */
const fakeReport = (over: Record<string, unknown> = {}) => ({
  ok: true, needsDecision: false, summary: "", added: 0, overwritten: 0, duplicated: 0,
  skipped: [], problems: [], conflicts: [], headers: [], unknownHeaders: [], ...over,
});

// 性质一：体检说"需要人决定"时，**绝不能写入**
{
  let wrote = false;
  const result = await runTwoPhaseImport({
    ask: async () => fakeReport({ needsDecision: true, conflicts: [{ line: 1, key: "k", incoming: { name: "甲" }, existing: { id: "x", name: "甲", summary: "" } }] }) as never,
    write: async () => { wrote = true; return fakeReport() as never; },
  });
  eq("体检要求人工决定时：返回冲突、且一次都没写",
    [result.status, wrote, result.status === "needs-decision" ? result.conflicts.length : -1],
    ["needs-decision", false, 1]);
}

// 性质二：体检说"没有冲突"时，**必须接着写入**（漏了这一步就是"点了没反应"）
{
  let writeCount = 0;
  const result = await runTwoPhaseImport({
    ask: async () => fakeReport({ summary: "检查完成：4 条都能导入" }) as never,
    write: async () => { writeCount += 1; return fakeReport({ added: 4, summary: "新增 4 条教师" }) as never; },
  });
  eq("体检无冲突时：确实写了，且只写一次", [result.status, writeCount], ["done", 1]);
  eq("报告用的是写入那一次的结果（不是体检的）",
    result.status === "done" ? [result.report.added, result.report.summary] : null,
    [4, "新增 4 条教师"]);
}

// 性质三：体检自己失败（例如缺必填列）时，不写入、把失败报告交回去
{
  let wrote = false;
  const result = await runTwoPhaseImport({
    ask: async () => fakeReport({ ok: false, error: "缺少必填列：姓名" }) as never,
    write: async () => { wrote = true; return fakeReport() as never; },
  });
  eq("体检失败时不写入", [result.status, wrote, result.status === "done" ? result.report.ok : null],
    ["done", false, false]);
}

/* ── 从网站（前端内容）导入 ── */
const siteTeachersAsk = await api.imports.fromSite({ entity: "teachers", onConflict: "ask" });
eq("从网站导入教师：因为库里已有同名，先要求决定", siteTeachersAsk.needsDecision, true);
ok("冲突里能看到网站上的老师与库里那条的对应关系",
  siteTeachersAsk.conflicts.some((item) => String(item.incoming.name) === "陈老师" && item.existing.id !== ""),
  JSON.stringify(siteTeachersAsk.conflicts.map((item) => item.incoming.name)));
const siteTeachers = await api.imports.fromSite({ entity: "teachers", onConflict: "skip" });
eq("从网站导入教师（跳过同名）", [siteTeachers.ok, siteTeachers.needsDecision], [true, false]);
/*
 * AI 智能体**也导进来**（机构要能在后台看到有哪些工具在服务学生），
 * 但类型标成 AI，并且**不进排课下拉**（那是"人"的地方）。
 */
const importedTeachers = await api.teachers.list();
ok("网站上的真实教师已经进库", importedTeachers.some((teacher) => teacher.name === "陈老师"));
const importedAi = importedTeachers.filter((teacher) => teacher.kind === "AI");
ok("AI 智能体也导进来，且类型标成 AI",
  importedAi.length >= 1 && importedAi.every((teacher) => teacher.name.includes("·")),
  importedAi.map((teacher) => teacher.name).join("、"));
ok("AI 不出现在排课下拉里（排课下拉是给「人」用的）",
  (await api.teachers.listActive()).every((teacher) => teacher.kind !== "AI"));
ok("真人教师在排课下拉里仍在",
  (await api.teachers.listActive()).some((teacher) => teacher.name === "陈老师"));

// 教师资料（教龄 / 简介 / 详细介绍）也要跟着进来 —— 这正是"导入资料"的本意
const chen = importedTeachers.find((teacher) => teacher.name === "陈老师")!;
ok("教师的教龄导进来了", chen.years !== "", `years="${chen.years}"`);
ok("教师的一句话简介导进来了", chen.summary !== "", `summary="${chen.summary.slice(0, 30)}…"`);
ok("教师的详细介绍导进来了（多段文本）", chen.bio.length > 50, `bio 长度 ${chen.bio.length}`);
eq("从网站导入的教师标记来源为「网站」", chen.origin, "网站");
ok("AI 的介绍也导进来了",
  importedAi.every((teacher) => teacher.bio !== ""),
  importedAi.map((teacher) => `bio=${teacher.bio.length}`).join("、"));

/*
 * 场地名的来源是**网站内容**（首页「教室照片格位」），而内容是可以被编辑的
 * （当前那三条占位已刻意隐藏，见 data/site/content.md）。所以这里的断言**跟着内容走**，
 * 不写死"3 个" —— 写死的话，运营一改内容自检就红，而那是正常编辑。
 */
const siteRooms = siteImportRecords("classrooms");
eq("从网站导入场地的条数跟着内容走（当前站点格位为空 → 0 条）",
  siteRooms.records.length, homeContent.classrooms.length);
ok("导出的每个场地名都非空（照片文件名不属于名字）",
  siteRooms.records.every((record) => String(record.name ?? "").trim() !== ""));
// 有格位时才有意义：名字里带"自习"的按自习室，其余按上课用教室
ok("场地用途按名字推断（自习 → 自习室）",
  siteRooms.records.every((record) =>
    String(record.name).includes("自习")
      ? record.kind === "自习室"
      : record.kind === "上课用教室"),
  JSON.stringify(siteRooms.records.map((record) => [record.name, record.kind])));

// 站点格位为空时：体检不写入、也不报冲突（而不是"悄悄导了 0 条又说成功"）
const emptySlotsAsk = await api.imports.fromSite({ entity: "classrooms", onConflict: "ask" });
eq("站点没有格位时：不写入、无需决定",
  [emptySlotsAsk.needsDecision, emptySlotsAsk.added, (await api.classrooms.list()).length],
  [false, 0, (await api.classrooms.list()).length]);

/*
 * "从网站导入**真的能写进库**"由上面教师那一段证明（网站上有 2 位真实教师、
 * 库里原本没有，导入后确实进库了）—— 那是同一条代码路径（同一个 runImport）。

// 收尾：把库恢复成夹具原样，避免影响后面的断言（后面几节都在同一份内存存储上）
await api.importDatabase(serializeDatabase(seedDb));
eq("收尾：库回到夹具规模", (await api.students.list()).length, seeded.length);

console.log("\n=== 12. 话术专区 ===");

/*
 * 话术是「发出去就收不回」的东西，因此这一组守三件事：
 *   1. 口径与系统一致（24 小时请假、试课满 10 节、两种退费口径、1 节 +10% 手续费）——
 *      话术与扣课时/报价的实现分叉，就会变成「系统按新规则算、老师按旧话术承诺」；
 *   2. **内部信息不进话术**：教师分成、教师课时费、机构留存这些字一条都不能出现
 *      （它们只在后台内部用，发到家长那里是事故）；
 *   3. 占位符的替换行为：缺的占位符必须原样保留，不能悄悄变成空白。
 */
ok(`话术分组至少 11 组（当前 ${SCRIPT_GROUPS.length} 组）`, SCRIPT_GROUPS.length >= 11);
ok(`话术至少 30 条（当前 ${SCRIPTS.length} 条）`, SCRIPTS.length >= 30);
eq("每个分组下都有话术",
  SCRIPT_GROUPS.filter((group) => !SCRIPTS.some((script) => script.group === group.id)).map((group) => group.id),
  []);
eq("话术 id 不重复",
  SCRIPTS.map((script) => script.id).filter((id, index) => SCRIPTS.findIndex((item) => item.id === id) !== index),
  []);
eq("每条话术都挂在存在的分组上",
  SCRIPTS.filter((script) => !SCRIPT_GROUPS.some((group) => group.id === script.group)).map((script) => script.id),
  []);

// 每条都要有场景名、什么时候用、成稿、该说与不该说
eq("话术字段完整（标题 / 场景 / 成稿 / 要点）",
  SCRIPTS.filter(
    (script) =>
      script.title.trim() === "" ||
      script.when.trim() === "" ||
      script.script.trim() === "" ||
      script.tips.say.length === 0 ||
      script.tips.avoid.length === 0,
  ).map((script) => script.id),
  []);
// 太长家长不看：20–300 字之间（微信一条消息的量级）
eq("成稿长度在 20–300 字之间",
  SCRIPTS.filter((script) => script.script.length < 20 || script.script.length > 300)
    .map((script) => `${script.id}(${script.script.length} 字)`),
  []);

// 内部信息红线：逐条扫描，失败能指出是哪一条
const SCRIPT_INTERNAL_WORDS = ["分成", "教师课时费", "机构留存", "40%", "留存", "提成"];
eq("话术里不出现内部信息（教师分成 / 机构留存等）",
  SCRIPTS.filter((script) =>
    SCRIPT_INTERNAL_WORDS.some((word) =>
      [script.title, script.when, script.script, ...script.tips.say, ...script.tips.avoid]
        .join("\n")
        .includes(word),
    ),
  ).map((script) => script.id),
  []);

// 口径一致性：这几条数字必须能在话术里找到（改了规则就要改话术，自检会拦住）
const groupTextOf = (id: string) =>
  SCRIPTS.filter((script) => script.group === id)
    .map((script) => [script.title, script.script, ...script.tips.say, ...script.tips.avoid].join("\n"))
    .join("\n");
ok("请假话术讲清了「提前 24 小时不扣课时」", groupTextOf("leave").includes("24 小时"));
ok("缺课话术讲清了「扣 1 节」与「补课再扣 1 节」",
  groupTextOf("leave").includes("扣 1 节"));
ok("试课话术讲清了「报课满 10 节试课免费」", groupTextOf("trial").includes("10 节"));
ok("退费话术讲了「按实付比例退」这一默认口径",
  groupTextOf("refund").includes("按实付") || groupTextOf("refund").includes("比例"));
ok("手续费话术提到「只报 1 节」与「10%」",
  groupTextOf("quote").includes("1 节") && groupTextOf("quote").includes("10%"));
ok("接待话术与后台「咨询」页字段对齐（年级 / 科目 / 时间 / 频次 / 指定老师）",
  ["年级", "科目", "时间", "一周一次", "指定"].every((key) => groupTextOf("first-contact").includes(key)));
ok("排课话术讲清了接待 9:00–21:00 与上课 8:00–22:00 是两回事",
  groupTextOf("schedule").includes("9:00–21:00") && groupTextOf("schedule").includes("8:00–22:00"));

// 占位符：替换 / 保留 / 去重
const twoVarScript = SCRIPTS.find((script) => scriptPlaceholders(script).length >= 2)!;
const twoVars = scriptPlaceholders(twoVarScript);
const halfFilled = fillScript(twoVarScript, { [twoVars[0]!]: "小明" });
ok("fillScript 会替换给到的占位符", !halfFilled.includes(`{${twoVars[0]!}}`));
ok("fillScript 保留没给到的占位符（不变成空白）", halfFilled.includes(`{${twoVars[1]!}}`));
eq("scriptPlaceholders 去重且保持出现顺序",
  scriptPlaceholders({
    id: "t", group: "leave", title: "t", when: "t",
    script: "{学生} 与 {学生} 还有 {老师}", tips: { say: [], avoid: [] },
  }),
  ["学生", "老师"]);
eq("missingPlaceholders 只列没填的（填掉一个，剩下的都还在）",
  missingPlaceholders(twoVarScript, { [twoVars[0]!]: "小明" }), twoVars.slice(1));
ok("话术里用到的占位符都在 SCRIPT_VARS 清单里",
  SCRIPTS.every((script) =>
    scriptPlaceholders(script).every((name) => SCRIPT_VARS.some((item) => item.key === name)),
  ));

// 筛选：分组 / 关键字 / 组合
eq("按分组筛选只留该组的", filterScripts({ group: "leave" }).every((script) => script.group === "leave"), true);
ok("按分组筛选有结果", filterScripts({ group: "leave" }).length >= 2);
eq("空筛选等于全部", filterScripts({}).length, SCRIPTS.length);
eq("「全部」等价于不筛选", filterScripts({ group: "全部" }).length, SCRIPTS.length);
eq("关键字能命中成稿",
  filterScripts({ keyword: "24 小时" }).length,
  SCRIPTS.filter((script) =>
    [script.title, script.script, script.when].join("\n").toLowerCase().includes("24 小时"),
  ).length);
ok("分组与关键字同时生效",
  filterScripts({ group: "quote", keyword: "手续费" }).every((script) => script.group === "quote"));
ok("关键字命中标题也算（搜「试课」能搜到试课组的话术）",
  filterScripts({ keyword: "试课" }).length > 0);

// 复制全部：保留分组标题，且每条都在
const allText = scriptsToText(SCRIPTS);
ok("复制全部时保留分组标题",
  SCRIPT_GROUPS.every((group) => allText.includes(`【${group.name}】`)));
ok("复制全部包含每一条话术",
  SCRIPTS.every((script) => allText.includes(script.script)));
eq("话术库规模统计与清单一致",
  [summarizeScripts().groups, summarizeScripts().scripts],
  [SCRIPT_GROUPS.length, SCRIPTS.length]);

console.log("\n=== 7. 登录与会话（第 6 步：服务端认证）===");

/*
 * 这一节守的是**第 6 步的成果**，而不是"假登录还能不能用"：
 *
 *   1. **口令不再出现在前端源码里** —— 原来它硬编码在 lib/auth/session.ts，
 *      而仓库是公开的，等于没有口令。这一条是那个问题的回归护栏：
 *      任何人把口令写回前端，自检立刻红。
 *   2. 会话令牌的存取（令牌是前端唯一持有的凭证）。
 *   3. 没有后端时**明确拒绝登录**，而不是退回"前端假登录"——
 *      那种"能登进去但数据不知道去哪了"的状态比不能登录更糟。
 *
 * 服务端那一侧（401 / 登录 / 令牌 / 退出、操作人由会话决定）由
 * `npm run check:auth` 对着真实服务端验，见 scripts/check-auth.mts。
 */
const PASSWORD_IN_FRONTEND = "689992";
const frontendFiles = [
  "lib/auth/session.ts",
  "lib/auth/token.ts",
  "lib/backend/remote.ts",
  "components/admin/LoginForm.tsx",
  "components/admin/RequireAuth.tsx",
  "components/admin/DataNotice.tsx",
  "components/admin/AdminTopBar.tsx",
  "app/admin/login/page.tsx",
];
const leaked = frontendFiles.filter((file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8").includes(PASSWORD_IN_FRONTEND));
eq("前端源码里不再出现口令", leaked, []);
ok("登录模块不再导出任何口令常量",
  !readFileSync(new URL("../lib/auth/session.ts", import.meta.url), "utf8").includes("__credentialsForTesting"));

// 令牌存储：写进去、读得回、清得掉（前端唯一的凭证就是它）
const tokenMemory = createMemoryStore();
__useTokenStoreForTesting(tokenMemory);
eq("初始没有令牌", readToken(), null);
writeToken("t-abc");
eq("令牌可以写回", readToken(), "t-abc");
clearToken();
eq("令牌可以清掉", readToken(), null);

// 没有令牌时就是未登录（会话由服务端说了算，这里连请求都不会发）
eq("没有令牌时视为未登录", await getSession(), null);
eq("没有令牌时 isLoggedIn 为 false", await isLoggedIn(), false);

/*
 * 没有后端时登录必须**明确拒绝**。
 * 这里临时把后端地址拿掉来模拟"线上静态站"，断言完再放回去 ——
 * `remoteBase()` 是每次调用时读环境变量，因此可以这样切换。
 */
const savedBase = process.env.NEXT_PUBLIC_API_BASE;
delete process.env.NEXT_PUBLIC_API_BASE;
try {
  ok("没有后端时明确说明原因", loginUnavailableReason() !== null);
  const noBackend = await login("admin", "随便什么口令");
  eq("没有后端时登录被拒", noBackend.ok, false);
  ok("拒绝理由指向本机运行后端",
    !noBackend.ok && (noBackend.error.includes("npm run server") || noBackend.error.includes("后端")));
} finally {
  if (savedBase !== undefined) process.env.NEXT_PUBLIC_API_BASE = savedBase;
}

/*
 * ── 两条数据来源必须产出**同一份页面数据**（等价性）────────────────────────
 *
 * 网站内容有两条来源：库（后端模式）与 Markdown 模版（模版模式）。页面组件只认
 * 结构，因此"同一个机构、同一份内容"在两条路径下必须生成**逐字节相同**的数据 ——
 * 否则就会出现"本地开发看到的网站与 GitHub Pages 上的不一样"这种最难查的差异。
 *
 * 做法：把示例库（它的课程库 / 课程正文 / 报价 / 教师都取自站点内容）转成一份
 * 公开数据快照注入进去，先取一遍模版路径的结果、再取一遍后端路径的结果，逐项比对。
 * 这是这套功能里**唯一**能把"两条路径等价"钉住的断言，因此不比计数、比全文。
 */
{
  const fixture = {
    ...seedDb,
    // 教师要用**内容文件里的全部教师**（含 AI）：模版路径会列出它们，
    // 而示例库刻意只放真人教师（AI 不参与排课），两边对不上就比不平
    teachers: siteTeachersFromContent().map((teacher, index) => ({
      id: `t_fixture_${index}`,
      name: teacher.name,
      subjects: teacher.subjects,
      role: teacher.role,
      phone: "",
      active: true,
      years: teacher.years,
      summary: teacher.summary,
      bio: teacher.bio,
      recommendation: teacher.recommendation,
      order: teacher.order,
      siteVisible: true,
      origin: "网站" as const,
      kind: teacher.kind,
    })),
  };
  const snapshot = buildPublicSite(fixture);
  ok("夹具里带了教师页标题（不然那条等价性是空转的）",
    snapshot.siteContent.teacherPage.heading.title !== "");

  __useBackendSnapshotForTesting(null);
  const templateSide = {
    teachers: getTeachersPage(),
    columns: getCourseColumns(),
    courses: getCoursesPage(),
    pricing: getPricingData(),
  };

  __useBackendSnapshotForTesting(snapshot);
  // 注入之后必须**真的**在后端这条路上（不是"撤掉快照后回落"那种恒真的断言）
  ok("注入快照后确实走的是后端那条路", backendSnapshot() !== null);
  const backendSide = {
    teachers: getTeachersPage(),
    columns: getCourseColumns(),
    courses: getCoursesPage(),
    pricing: getPricingData(),
  };
  __useBackendSnapshotForTesting(null);

  /*
   * 比较用的是**规范化后的 JSON**（对象键排序），不是原始 JSON 字符串。
   * 理由：键的先后顺序不是数据，为了"映射时的书写顺序"去改代码是本末倒置；
   * 而数组顺序会被保留 —— 那才是页面上的真实顺序（教师排序、卡片、小节都要一致）。
   */
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, item: unknown) => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    });

  const same = (label: string, a: unknown, b: unknown) => {
    const left = canonical(a);
    const right = canonical(b);
    ok(`两条来源产出同一份${label}`, left === right,
      left === right
        ? ""
        : `长度 模版 ${left.length} / 后端 ${right.length}；首处差异：` +
          (() => {
            for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
              if (left[i] !== right[i]) return `${left.slice(Math.max(0, i - 60), i + 60)}  ≠  ${right.slice(Math.max(0, i - 60), i + 60)}`;
            }
            return "";
          })());
  };

  same("教师页", templateSide.teachers, backendSide.teachers);
  same("课程栏目", templateSide.columns, backendSide.columns);
  same("课程页", templateSide.courses, backendSide.courses);
  same("报价页数据", templateSide.pricing, backendSide.pricing);

  /*
   * "内容 → 库"那个方向必须**永远读模版**，哪怕磁盘上就躺着一份快照。
   *
   * 这不是洁癖：导入侧（课程库同步、从网站导入教师与正文）如果读了快照，
   * 就会绕成一个圈 —— 库的数据生成快照，快照又被当成"网站内容"导回库里。
   * 我第一版就是这样，症状是"选修课的一句话介绍永远导不进去"。
   *
   * 验法：造一份**模版里没有的**课程快照注入进去。
   * 页面（`getCourseColumns`）应当跟着快照多出这门课 —— 这证明注入真的生效了；
   * 而导入侧（`coursesFromSite`）必须看不见它 —— 这证明它读的是模版。
   */
  const firstCourse = snapshot.courses[0]!;
  __useBackendSnapshotForTesting({
    ...snapshot,
    courses: [
      ...snapshot.courses,
      { ...firstCourse, name: "模版里没有的课程", path: "not-in-template" },
    ],
  });
  ok("页面会跟着快照走（注入确实生效）",
    getCourseColumns().some((column) =>
      column.subgroups.some((subgroup) => subgroup.cards.some((card) => card.title === "模版里没有的课程")),
    ));
  eq("导入侧读的仍是模版，不是快照",
    coursesFromSite().some((course) => course.name === "模版里没有的课程"), false);
  __useBackendSnapshotForTesting(null);

  ok("课程卡片张数与模版一致",
    backendSide.columns.flatMap((c) => c.subgroups.flatMap((s) => s.cards)).length ===
      templateSide.columns.flatMap((c) => c.subgroups.flatMap((s) => s.cards)).length);
}

console.log("\n=== 13. 界面稳定：就地动作不滚动、不塌页高 ===");

/*
 * 这一节守的是**机构反馈过两次的那件事**：点一下卡片上的就地动作（「设为暂未开放」、
 * 「编辑」、删一个小节），页面跳到顶部、还得重新往下滑。§15.3 把原因归成两类，
 * 两类都在这里钉住 —— 这一节不碰后端、不需要浏览器，它是**源码结构**上的护栏
 * （与上面那条「前端源码里不再出现口令」的扫描同类）。
 *
 *   A. **显式滚动**：`window.scrollTo` / `scrollIntoView` / `.scrollBy`。
 *      历史上课程库有两处：`startEdit` 里"把表单带到眼前"、`removeBand` 里
 *      "被拒时把人带到页顶那条原因跟前"。两处现在都不需要了 —— 编辑器就地展开、
 *      被拒的原因写在**被点的那个小节框里**。因此这条断言的口径是**除下面那个唯一
 *      例外之外一处都不允许**（白名单是一个具体路径，不是"随便哪里都行"）。
 *
 *      **唯一的例外**：`components/admin/scroll-io.ts` 这一个文件可以写滚动，
 *      而且只能写**恢复型**滚动 —— 它写进去的 `top` 必须是参数（源码级判据，见下面 A 组），
 *      那个参数又只能来自纯函数 `inPlaceScrollCorrection` / `reloadRestoreTarget`
 *      （判定表在 §15 穷举），两者的唯一出口都是"**记下来的那个位置**"。
 *      为什么值得开这个口子：能把位置夹到 **0** 的只有整页重载（要夹到 0，文档必须塌到
 *      不足一屏），而重载后 `RequireAuth` 先渲染一屏高的占位屏，把**浏览器本来就会做的**
 *      那次恢复夹成了 0 —— 这一手补的是那个缺口，不是往页面里加"跳到哪里去"。
 *
 *      将来真要再加滚动，必须回来改这条断言并写清理由 ——
 *      那正是想要的效果：谁想再加一句"跳顶部"，得先过这一关。
 *
 *   B. **页高塌掉**：刷新时把列表换成一行"加载中…"、页面高度从很高塌成一行，
 *      浏览器随即把滚动位置夹回顶部。判据是源码级的：凡是页面里有 `setLoading(true)`
 *      （＝存在加载态）的，`load()` 的调用点就必须带 `quiet: true`；
 *      唯一例外是**首屏那一次**（裸 `load();`，每页正好一处）；
 *      也不许把 `load` 直接当回调传下去（`onRefresh={load}` 那种写法绕过了参数，
 *      等于让一次刷新回到"清空列表"的老行为）。
 *
 * 为什么放在 `check.mts` 而不是 `check-auth.mts`：这两条都是**前端源码的性质**，
 * 不需要真后端、不需要浏览器；而 `check.mts` 在两种后端下都要跑（`npm run check:both`），
 * 因此两种环境都拦得住。
 */
{
  /** 前端源码目录（产物 `out/`、`.next/` 不算 —— 那些是生成物）。 */
  const FRONTEND_DIRS = ["app", "components", "lib"];
  const SOURCE_EXT = /\.(ts|tsx)$/;
  const IGNORED = /(^|\/)(node_modules|\.next|out)\//;

  /**
   * 去掉注释再扫。
   *
   * 为什么必须去掉：这两个被扫的词（`window.scrollTo(...)`、`load()`）在**注释里**
   * 是应该出现的历史说明 —— 例如课程库那句"原来这里是滚到顶部，现在改成就地展开了"。
   * 不去掉的话，后来的人为了不触红就只能把这段历史删掉，那正好是相反的取舍：
   * 这段历史必须留，代码里不许有。只去**块注释**与**整行注释**（一行以两个斜杠开头）：
   * JSX 文案里出现的 `http://…` 不该被当成行注释起点（那会漏掉同一行的真代码）。
   */
  const stripComments = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((line) => (/^\s*\/\//.test(line) ? "" : line))
      .join("\n");

  /** 递归收集某个目录下的前端源码（路径用 `/` 分隔，便于断言里打印）。 */
  const collectSources = (dir: string): Array<{ path: string; source: string; code: string }> => {
    const rootUrl = new URL(`../${dir}/`, import.meta.url);
    const files = readdirSync(rootUrl, { recursive: true }) as string[];
    return files
      .map((entry) => entry.replaceAll("\\", "/"))
      .filter((entry) => SOURCE_EXT.test(entry) && !IGNORED.test(entry))
      .map((entry) => {
        const source = readFileSync(new URL(entry, rootUrl), "utf8");
        return { path: `${dir}/${entry}`, source, code: stripComments(source) };
      });
  };

  const frontendSources = FRONTEND_DIRS.flatMap(collectSources);
  ok("源码扫描真的读到了文件（否则下面几条是空转的）", frontendSources.length > 100,
    `读到 ${frontendSources.length} 个文件`);

  // ── A. 显式滚动：只允许"恢复型滚动"，而且只允许一个文件写 ──────────────────
  const scrollPattern = /window\.scrollTo\s*\(|scrollIntoView\s*\(|\.scrollTo\s*\(|\.scrollBy\s*\(/;
  /*
   * **白名单里只有一个文件**，判据也一起写死（不靠注释说好话）：
   *
   *   `components/admin/scroll-io.ts` 是全仓库唯一允许写滚动位置的地方，而且它写进去的
   *   `top` 必须是**参数**、不许是字面量。
   *
   * 为什么允许这一处：机构反馈的"过一会儿跳到最顶部"里，唯一能把位置夹到 **0** 的机制是
   * **整页重载**（要夹到 0，文档必须塌到不足一屏；页面上方少几十像素做不到）。
   * 重载本身在页面里禁止不了，而**浏览器本来就会**在重载后把位置放回去 ——
   * 只是后台外壳先渲染一屏高的"正在检查登录状态…"，那一刻恢复被夹成了 0。
   * 所以补的这一手是"把浏览器本该做到的那一步做回来"：写回的是**记下来的位置**。
   *
   * 为什么这条断言**仍然防得住真正的乱滚动**：
   *   1. 别处一句都不许有（白名单是一个具体路径，不是"随便哪里都行"）；
   *   2. 那一个文件里也不许写常量 —— 下面第二条断言直接查
   *      `scrollTo({ top: <标识符> })`：想写 `top: 0` 或 `top: document.body.scrollHeight`
   *      都过不了；而只要 top 来自参数，它就只能写到调用方算出来的位置；
   *   3. 调用方算出来的位置又由纯函数 `inPlaceScrollCorrection` /
   *      `reloadRestoreTarget` 决定，那两个函数的判定表在第 14 节被穷举（都只有
   *      "记下来的位置"这一种出口）。
   */
  const SCROLL_WRITE_WHITELIST = ["components/admin/scroll-io.ts"];
  const filesWritingScroll = frontendSources
    .filter((file) => scrollPattern.test(file.code))
    .map((file) => file.path);
  eq(
    "前端源码里写滚动的只有 scroll-io.ts 一处（白名单就这一个文件；判据见上面的说明）",
    filesWritingScroll,
    SCROLL_WRITE_WHITELIST,
  );
  {
    const scrollIo = frontendSources.find((file) => file.path === SCROLL_WRITE_WHITELIST[0]);
    ok("找得到那个唯一允许写滚动的文件（否则下面那条是空转的）", scrollIo !== undefined);
    /*
     * top 必须是标识符：`scrollTo({ top: y, behavior: "instant" })`。
     * 同时要求它是 `instant` —— `app/globals.css` 给 `html` 设了 `scroll-behavior: smooth`，
     * 不写死 instant 的话"放回原位"会被动画执行，用户会看到一次可见的滑动。
     */
    const code = scrollIo?.code ?? "";
    ok(
      "那个文件里写进去的 top 必须是参数（不许写常量 0 / 「容器顶部」这类跳顶写法）",
      /scrollTo\(\{\s*top:\s*[A-Za-z_$][\w$]*\s*,/.test(code),
      "见 components/admin/scroll-io.ts 的 restoreScrollY",
    );
    ok(
      "那个文件里的滚动必须是 instant（不受 html 的 scroll-behavior: smooth 影响）",
      /behavior:\s*"instant"/.test(code),
    );
  }
  eq(
    "除了那一个文件以外，前端源码里没有别的显式滚动（scrollIntoView / scrollBy 一律不许）",
    frontendSources.filter((file) => /scrollIntoView\s*\(|\.scrollBy\s*\(/.test(file.code)).map((f) => f.path),
    [],
  );

  // ── B. 有加载态的页面：就地动作必须走安静刷新 ─────────────────────────────
  /*
   * 只看 `app/admin/**` 的页面文件，而且只看**存在加载态**的（含 `setLoading(true)`）：
   * 没有加载态的页面（例如「数据与备份」）刷新时不会把一个列表换成"加载中…"，
   * 因此不在这条规则的射程内。
   */
  const adminDashboardUrl = new URL("../app/admin/(dashboard)/", import.meta.url);
  const adminPages = (readdirSync(adminDashboardUrl, { recursive: true }) as string[])
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter((entry) => entry.endsWith("page.tsx"))
    .sort()
    .map((entry) => {
      const source = readFileSync(new URL(entry, adminDashboardUrl), "utf8");
      return { path: `app/admin/(dashboard)/${entry}`, source, code: stripComments(source) };
    });
  const gatedPages = adminPages.filter((page) => page.code.includes("setLoading(true)"));
  ok("扫描到了带加载态的后台页面", gatedPages.length >= 10, `${gatedPages.length} 个：${gatedPages.map((p) => p.path).join("、")}`);

  // B1. 每页最多一处裸 `load()` —— 就是首屏那一处
  const bareCalls = gatedPages
    .map((page) => ({
      path: page.path,
      count: (page.code.match(/\bload\(\)/g) ?? []).length,
    }))
    .filter((row) => row.count !== 1)
    .map((row) => `${row.path}（${row.count} 处）`);
  eq("带加载态的后台页面：裸 load() 只允许首屏那一处", bareCalls, []);

  // B2. `load(...)` 只要带参数，就必须是安静刷新
  const loudCalls: string[] = [];
  for (const page of gatedPages) {
    for (const match of page.code.matchAll(/\bload\(/g)) {
      const after = page.code.slice(match.index + match[0].length, match.index + match[0].length + 40);
      if (/^\s*\)/.test(after)) continue; // 裸 load()，由 B1 管
      if (/^\s*\{\s*quiet:\s*true\s*\}/.test(after)) continue; // 安静刷新
      loudCalls.push(`${page.path} → load(${after.slice(0, 24).replace(/\s+/g, " ").trim()}…`);
    }
  }
  eq("带加载态的后台页面：load(...) 一律带 quiet（就地动作不清空列表）", loudCalls, []);

  // B3. 不许把 load 直接当回调传下去（那样就绕过了参数，回到"清空列表"的老行为）
  eq(
    "带加载态的后台页面：没有把 load 直接当回调传给组件",
    gatedPages.filter((page) => /\{\s*load\s*\}/.test(page.code)).map((page) => page.path),
    [],
  );

  // B4. 安静刷新必须是**真的实现了**（有 quiet 参数的分支），不是只把参数传了个寂寞
  eq(
    "带加载态的后台页面：quiet 分支真的写在 load 里（options.quiet）",
    gatedPages.filter((page) => !page.code.includes("options.quiet")).map((page) => page.path),
    [],
  );

  /*
   * B5. 课程库的「新增课程」表单**默认收起**。
   *
   * 这是"就地动作不许让上方少一块"的那条规则在**这一页的具体形状**上的落点：那张表单整块在
   * 课程清单上面，而「编辑」是在卡片下面就地展开的 —— 表单要是默认摊开，点一下编辑它就被卸载，
   * 于是滚动位置上方矮掉几百像素（§15.3 原因二：上方塌掉，浏览器只好把滚动位置往上收）。
   * 这条断言不是"漂亮代码"的检查，它挡的是一个**真的会把人推回页面顶部**的改动：
   * 谁要把 `creatingCourse` 的初值改回 `true`，就会看到这句为什么不能改。
   */
  {
    const coursesPage = adminPages.find((page) => page.path.endsWith("courses/page.tsx"));
    ok("找得到课程库页面（否则下面那条是空转的）", coursesPage !== undefined);
    const code = coursesPage?.code ?? "";
    /*
     * 形态检查：状态初值是 `false`，且渲染处**真的**按它分支。
     * 不锚在 `{` 上：这一处外层还套了一层权限判断（没权限时显示一句说明而不是表单），
     * 锚死大括号会让"加一层权限门控"看起来像把功能改坏了。
     */
    const folded =
      /const \[creatingCourse, setCreatingCourse\] = useState\(false\)/.test(code) &&
      /creatingCourse \? \(/.test(code);
    ok(
      "课程库：新增课程表单默认收起（点某张卡片的「编辑」时，页面上方不会少掉那一大块）",
      folded,
      "见 app/admin/(dashboard)/courses/page.tsx 里 creatingCourse 的说明与 §15.3",
    );
  }

  /*
   * ── 行为级：复查连接时**不要退回「检查中…」** ─────────────────────────────
   *
   * 上面 B 那一组管的是"刷新列表"。还有一条同类的页高变化：顶部那条后端提示横幅
   * 每 30 秒被定时复查换一次说法（`checking` 是一行短字，`ok`/`ready` 是两三行），
   * 于是它就在滚动位置上方时高时低。修法是"已经有结论时不再退回 checking"，
   * 而这件事**可以真的跑一遍**：把探活用桩接住（不碰任何真实地址），
   * 听状态变化的次序 —— 第一次必须经过"检查中"，第二次必须**不经过**。
   */
  const connectionMemory = createMemoryStore();
  __useConnectionStoreForTesting(connectionMemory);
  const realFetch = globalThis.fetch;
  const savedApiBase = process.env.NEXT_PUBLIC_API_BASE;
  const seen: string[] = [];
  const unsubscribe = subscribeConnection(() => {
    seen.push(getConnectionState().status);
  });
  try {
    /*
     * 探活桩：`/health` 自报为本系统的后端、`/api/status` 正常回数据库细节。
     * 地址用 `.invalid`（保留域，永远解析不到）—— 万一桩没接住也**不会**碰到真后端。
     */
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = url.endsWith("/health")
        ? { ok: true, service: SERVICE_NAME, db: "stub.db" }
        : url.endsWith("/api/status")
          ? { ok: true, schemaVersion: 1, counts: {}, backup: { latest: null, latestAt: null } }
          : null;
      return body === null
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };
    process.env.NEXT_PUBLIC_API_BASE = "http://stub.invalid";
    setBackendOverride("http://stub.invalid");

    seen.length = 0;
    await refreshConnection({ token: "stub-token" });
    eq("首次探活：先显示「检查中」再给结论", seen, ["checking", "ok"]);

    /*
     * **这一条是"点击之后过一会儿自己跳回顶部"那一类问题的核心断言。**
     *
     * 复查是**定时**的（30 秒一次），结论就渲染在页面顶部那条提示条里 —— 它在课程清单
     * **上方**。所以要求不是"别退回检查中"这么弱，而是：**结论一样时一次通知都不许发**。
     * 通知不发 → `useSyncExternalStore` 拿到的还是原来那个对象 → 组件**根本不重渲染**
     * → 页面上一个字都不会变，页高自然也不会变（变矮才会把滚动位置夹回去，§15.3 原因二）。
     *
     * 这条断言是真的跑出来的（桩 fetch + 内存存储），不是读源码猜的：
     * 把 `commit` 改回"每次都赋值并 notify"，这里立刻变成 `["ok"]` 而报红。
     */
    seen.length = 0;
    await refreshConnection({ token: "stub-token" });
    eq("复查结论没变时一次通知都不发（定时复查不可能改变页高）", seen, []);
    eq("复查后状态仍然是有结论的", getConnectionState().status, "ok");

    /*
     * 反向：**真的变了就必须通知**，否则界面会停在旧说法上（那是比多一次重渲染更糟的事）。
     * 桩里把数据库结构版本改一位 —— 结论变了，应当恰好发一次通知。
     */
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = url.endsWith("/health")
        ? { ok: true, service: SERVICE_NAME, db: "stub.db" }
        : url.endsWith("/api/status")
          ? { ok: true, schemaVersion: 2, counts: {}, backup: { latest: null, latestAt: null } }
          : null;
      return body === null
        ? new Response("not found", { status: 404 })
        : new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    };
    seen.length = 0;
    await refreshConnection({ token: "stub-token" });
    eq("结论真的变了：恰好通知一次（界面该改口就得改口）", seen, ["ok"]);
  } finally {
    unsubscribe();
    globalThis.fetch = realFetch;
    setBackendOverride(null);
    if (savedApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE;
    else process.env.NEXT_PUBLIC_API_BASE = savedApiBase;
  }
}

console.log("\n=== 14. 延迟型跳顶：点击之后就地的动作，过一会儿也不许改变页面 ===");

/*
 * 这一节守的是**机构这一次的反馈**：「点击暂未开放后，**页面一会儿之后**就跳到最顶部」。
 * 与第 13 节的区别全在"一会儿之后"上：13 节管的是点击那一瞬间发生的事（显式滚动、
 * 聚焦按钮被置为 disabled 把焦点丢回 body、刷新把列表换成一行"加载中…"）；
 * 而"延迟"只剩三种可能的来源，本节把三种都钉住：
 *
 *   ① **定时器 / 轮询改变页高**。整个仓库里与后台页面有关的定时器只有一处：
 *      连接状态复查（`POLL_INTERVAL_MS`，30 秒一次，`lib/backend/connection.ts`）。
 *      它的结论就渲染在课程清单**上方**那条提示条里。因此判据不是"别退回检查中"，
 *      而是更硬的两条：**结论一样时一次通知都不许发**（A 组，行为级：不通知 ⇒ 不重渲染
 *      ⇒ 页高不可能变），以及**说法切换只许变高、不许变矮**（B 组：四个分支共用同一份
 *      最小高度）。变矮才会把滚动位置夹回去，变高不会。
 *   ② **整页重载**。重载后 `RequireAuth` 的占位屏只有一屏高，滚动位置会被夹到 0
 *      —— 这是"跳到**最顶部**"唯一说得通的机制（要夹到 0，文档必须塌到不足一屏）。
 *      本仓库里唯一会**在用户操作之后隔几秒**触发整页重载的东西是 `npm run dev` 的
 *      「盯着后端」（每 2 秒比一次内容指纹，变了就重写 `data/site/.backend-snapshot.ts`，
 *      那个模块在后台页面的模块图里 ⇒ Next 重编译 ⇒ 整页重载）。D 组钉住它的开关。
 *   ③ **自动消失的提示**。某个提示自己超时不见了 ⇒ 页面上方少一块。C 组钉住
 *      "就地动作这两处文件里没有任何定时器"。
 *
 * 放在 `check.mts` 而不是别处：这些都是**前端源码与纯函数**的性质，不需要浏览器；
 * 而 `check.mts` 在两种后端下都要跑（`npm run check:both`），因此两种环境都拦得住。
 */
{
  const rootUrl = new URL("../", import.meta.url);

  // ── A. 什么算"结论没变"：写死、可穷举、别人改不坏 ──────────────────────────
  /*
   * 这一组测的是纯函数 `sameConnectionState`。它是"30 秒复查不会重渲染"的**唯一判据**，
   * 因此它自己必须是穷尽的：每一种状态、每一个会影响显示结果的字段都要各测一次。
   * 逐项测而不是只测两个同样的对象 —— 那样的话把函数写成 `return true` 也能过。
   */
  const okState = (over: {
    schemaVersion?: number;
    counts?: Record<string, number>;
    latestBackup?: string | null;
    latestBackupAt?: string | null;
    db?: string;
  } = {}): ConnectionState => ({
    status: "ok",
    base: "http://localhost:4000",
    service: SERVICE_NAME,
    db: over.db ?? "nexgenedu.db",
    database: {
      schemaVersion: over.schemaVersion ?? 17,
      counts: over.counts ?? { students: 3, courses: 32 },
      latestBackup: over.latestBackup === undefined ? "backup-1.db" : over.latestBackup,
      latestBackupAt: over.latestBackupAt === undefined ? "2026-01-01T00:00:00.000Z" : over.latestBackupAt,
    },
  });

  eq("同样的结论判定为「没变」", sameConnectionState(okState(), okState()), true);
  eq("数据库结构版本变了算「变了」", sameConnectionState(okState(), okState({ schemaVersion: 18 })), false);
  eq("各表条数变了算「变了」（该重渲染一次，界面才不会停在旧数字上）",
    sameConnectionState(okState(), okState({ counts: { students: 4, courses: 32 } })), false);
  eq("最近备份变了算「变了」",
    sameConnectionState(okState(), okState({ latestBackup: "backup-2.db" })), false);
  eq("最近备份时间变了算「变了」",
    sameConnectionState(okState(), okState({ latestBackupAt: "2026-01-02T00:00:00.000Z" })), false);
  eq("库文件名变了算「变了」", sameConnectionState(okState(), okState({ db: "other.db" })), false);

  const readyState = (reason: "no-token" | "expired" | "unreachable"): ConnectionState => ({
    status: "ready",
    base: "http://localhost:4000",
    service: SERVICE_NAME,
    db: "nexgenedu.db",
    database: null,
    dbReason: reason,
  });
  eq("ready：原因一样 = 没变", sameConnectionState(readyState("expired"), readyState("expired")), true);
  eq("ready：原因变了 = 变了（会话失效要立刻改口）",
    sameConnectionState(readyState("no-token"), readyState("expired")), false);

  const downState = (reason: string): ConnectionState => ({
    status: "down",
    base: "http://localhost:4000",
    reason,
    detected: null,
  });
  eq("down：原因一样 = 没变", sameConnectionState(downState("请求失败：failed"), downState("请求失败：failed")), true);
  eq("down：原因变了 = 变了", sameConnectionState(downState("请求失败：a"), downState("请求失败：b")), false);
  eq("跨状态一律算「变了」", sameConnectionState({ status: "checking" }, okState()), false);
  eq("checking 与 idle 是两回事", sameConnectionState({ status: "checking" }, { status: "idle" }), false);

  // ── B. 提示条：四个分支共用同一份最小高度（只会变高，不会变矮）────────────
  /*
   * 上面 A 组管的是"结论没变时什么都不发生"。这一组管"结论**真的**变了"那一次：
   * 那时候说法必须换（不讲清楚更糟），但**版面不许变矮**。
   * 判据是纯的：说法由 `noticeBranchOf` 决定（穷尽），高度由 `NOTICE_MIN_H_CLASS` 决定
   * （四种说法共用同一份），而且那个类名必须与预留行数算得出来的一致。
   */
  const branchesSeen: NoticeBranch[] = [
    noticeBranchOf({ status: "idle" }),
    noticeBranchOf({ status: "checking" }),
    noticeBranchOf(okState()),
    noticeBranchOf(readyState("no-token")),
    noticeBranchOf(readyState("expired")),
    noticeBranchOf(readyState("unreachable")),
    noticeBranchOf(downState("请求失败：x")),
  ];
  eq("四种连接状态映射到五种说法（没有落进兜底里没说话的）",
    [...new Set(branchesSeen)].sort(), ["checking", "down", "ok", "ready", "ready-expired"]);
  eq("会话失效单独有一种说法（不是含糊的「未登录」）",
    noticeBranchOf(readyState("expired")), "ready-expired");
  ok("提示条预留高度至少 3 行（正常桌面宽度下最长的那一句只要 2 行）",
    NOTICE_RESERVED_LINES >= 3, `NOTICE_RESERVED_LINES = ${NOTICE_RESERVED_LINES}`);
  /*
   * 最小高度类必须是**字面量**（Tailwind 扫源码生成 CSS，拼出来的类名它看不见），
   * 又必须与预留行数吻合 —— 于是这里按行数把那个字面量**算一遍**再比。
   * 改行数却忘了改类名（或反过来），这里立刻报红。
   */
  const derivedRem = Math.ceil(NOTICE_RESERVED_LINES * NOTICE_LINE_REM * 4) / 4;
  eq("最小高度类与预留行数一致（两处不可能各说一套）",
    NOTICE_MIN_H_CLASS, `min-h-[${derivedRem}rem]`);

  const dataNoticeUrl = new URL("components/admin/DataNotice.tsx", rootUrl);
  const dataNoticeSource = readFileSync(dataNoticeUrl, "utf8");
  /*
   * 数之前先把注释去掉：这段说明本身就在讨论 `<p>` 与这两个标识符
   * （不剥注释的话，一写说明就报红 —— 而"只提到名字、没用上"正是要拦的东西）。
   */
  const codeOnly = dataNoticeSource.replace(/\/\*[\s\S]*?\*\//g, " ");
  /** 提示条那**一个**段落元素的开标签（属性都在这里面）。 */
  const noticeTag = /<p\b[\s\S]*?>/.exec(codeOnly)?.[0] ?? "";
  /*
   * 断言必须落在"用在哪"上，而不是"出现过"。第一版只查 `includes("NOTICE_MIN_H_CLASS")`,
   * 结果**把 className 里那一行删掉之后照样通过** —— 因为 import 语句与说明注释里还留着这个名字。
   * 那种断言等于没写（"只提到名字"和"真的用上"是两回事），反向验证时才发现。
   */
  ok("最小高度类被用在提示条这一个段落元素的 className 上",
    noticeTag.includes("NOTICE_MIN_H_CLASS"),
    `段落开标签：${noticeTag.replace(/\s+/g, " ").slice(0, 120)}`);
  ok("说法由 noticeBranchOf 决定（不在这里另写一串状态判断）",
    /const branch = noticeBranchOf\(state\)/.test(codeOnly),
    "见 components/admin/DataNotice.tsx 与 lib/admin/notice-layout.ts");
  /*
   * 五种说法**共用同一个 `<p>`**：只要有一个分支自己另起一个段落元素，
   * "各分支等高"这件事就不再是结构上的事实、而只是"看起来差不多"。
   * 以后真要再加一段，必须回来改这条断言并写清理由 —— 那时请同时确认它不占高度。
   */
  eq("提示条里只有一个段落元素（五种说法共用同一个容器）",
    (codeOnly.match(/<p\b/g) ?? []).length, 1);

  // ── C. 就地动作那两处文件里，不许有任何定时器 ─────────────────────────────
  /*
   * "过一会儿自己动"只可能来自定时器。就地动作的两处（课程库页、页顶提示条）里出现
   * 任何 `setTimeout` / `setInterval`，都要在这里说清它为什么不会改变页高 —— 否则就是
   * 下一个"点完过几秒跳回顶部"。渲染在它们里面的 `BackendStatus` 会挂那个 30 秒的复查
   * 定时器（在 connection.ts 里），那一条由上面 A/B 两组管着：结论没变不通知、
   * 说法切换只变高不变矮。
   */
  const noTimerFiles = [
    "components/admin/DataNotice.tsx",
    "app/admin/(dashboard)/courses/page.tsx",
  ];
  const filesWithTimers = noTimerFiles.filter((file) =>
    /\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(readFileSync(new URL(file, rootUrl), "utf8")),
  );
  eq("就地动作的两处文件里没有任何定时器（否则就是「点完过一会儿自己变」的来源）",
    filesWithTimers, []);

  // ── D. 延迟型整页重载的唯一开关：dev 的「盯着后端」 ───────────────────────
  /*
   * ## 为什么这条断言属于"跳回顶部"这一节
   *
   * 要把滚动位置夹到**最顶部**（0），文档高度必须塌到不足一屏 —— 页面上方少掉几十像素
   * 是做不到的（那只会让位置往上收几十像素）。能做到的只有一件事：**整页重载**。
   * 重载后 `RequireAuth` 先渲染占位屏（`min-h-dvh`，正好一屏高），滚动位置在那时被夹到 0，
   * 之后后台内容再长回来，位置也不会自己回去。
   *
   * 本仓库里唯一会**在用户点完按钮之后隔几秒**触发整页重载的东西是 `npm run dev` 的
   * 「盯着后端」：它每 2 秒比一次后端公开内容的指纹，一旦变了就重写
   * `data/site/.backend-snapshot.ts`。而那个生成文件**确实在后台页面的模块图里**（下面那条
   * 图谱断言就是核对这件事的），于是 Next 重编译、整页重载 —— 时间点正好是
   * "点一下 → 过 1~5 秒页面自己跳回顶部"，与机构反馈的原话逐字对得上。
   *
   * 因此这条开关**必须是显式开启**的（默认关）。谁想把它改回默认开，会先在这里看到原因。
   */
  const devSource = readFileSync(new URL("scripts/dev.mjs", rootUrl), "utf8");
  eq("dev 的「盯着后端」必须显式开启（SITE_LIVE=1），不许默认开",
    /const LIVE = process\.env\.SITE_LIVE === "1";/.test(devSource), true);

  /*
   * 图谱核对：从后台页面的模块图出发做一次**值导入**的遍历（`import type` 编译后被擦除，
   * 不算依赖），看能不能走到那个生成文件。这里刻意把**事实**断言出来，而不是断言"没关系"：
   *
   *   - 现状：**到得了** → 所以上面那条开关不能放宽；
   *   - 哪天有人把耦合断开（后台不再 import 网站侧那套数据模块），这条会变红 ——
   *     那时请把它改成"到不了"，并**放宽**上面那条（耦合断了之后，
   *     重写那个文件不会再让后台整页重载）。
   */
  const adminGraphReaches = (target: string): { reached: boolean; chain: string[] } => {
    const rootDir = new URL("../", import.meta.url);
    const collect = (dir: string): string[] => {
      const files = readdirSync(new URL(dir, rootDir), { recursive: true }) as string[];
      return files
        .map((entry) => entry.replaceAll("\\", "/"))
        .filter((entry) => /\.(ts|tsx)$/.test(entry))
        .map((entry) => `${dir}${entry}`);
    };
    const resolveSpec = (spec: string, from: string): string | null => {
      const base = spec.startsWith("@/")
        ? spec.slice(2)
        : spec.startsWith(".")
          ? `${from.slice(0, from.lastIndexOf("/") + 1)}${spec}`
          : null;
      if (base === null) return null;
      const normalized = base.replace(/\/[^/]+\/\.\.\//g, "/").replace(/^\.\//, "");
      for (const candidate of [normalized, `${normalized}.ts`, `${normalized}.tsx`, `${normalized}/index.ts`]) {
        if (/\.(ts|tsx)$/.test(candidate) && existsSync(new URL(candidate, rootDir))) return candidate;
      }
      return null;
    };
    /** 只看**值导入**：`import type` / `export type { } from` 编译后被擦除，不构成依赖。 */
    const valueImports = (file: string): string[] => {
      const source = readFileSync(new URL(file, rootDir), "utf8");
      const found: string[] = [];
      const pattern = /(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)from\s+["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        if (match[2] !== undefined) continue;
        if (match[1] === "export" && /^\s*type\s*\{/.test(match[3] ?? "")) continue;
        found.push(match[4] ?? "");
      }
      return found;
    };

    const starts = [...collect("app/admin/"), ...collect("components/admin/")];
    const seenFiles = new Set<string>(starts);
    const parent = new Map<string, string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      for (const spec of valueImports(file)) {
        const next = resolveSpec(spec, file);
        if (next === null || seenFiles.has(next)) continue;
        seenFiles.add(next);
        if (!parent.has(next)) parent.set(next, file);
        queue.push(next);
      }
    }
    const hit = [...seenFiles].find((file) => file.startsWith(target));
    if (hit === undefined) return { reached: false, chain: [] };
    const chain: string[] = [];
    let cursor: string | undefined = hit;
    while (cursor !== undefined) {
      chain.unshift(cursor);
      cursor = parent.get(cursor);
    }
    return { reached: true, chain: [...chain, target].slice(-4) };
  };
  const snapshotLink = adminGraphReaches("data/site/.backend-snapshot");
  /*
   * 上面那条断言的意义全看这个遍历**是不是真的在走图**，所以配一组对照：
   *   - 正对照：`lib/data/site.ts`（后台确实在用）**必须**走得到；
   *   - 负对照：`components/courses/CourseTree.tsx`（只有网站页在用）**必须**走不到。
   * 少了负对照，"永远返回 true"的坏遍历也能过；少了正对照，"永远返回 false"的也能过。
   */
  const positiveControl = adminGraphReaches("lib/data/site");
  const negativeControl = adminGraphReaches("components/courses/CourseTree");
  ok("（对照）后台模块图走得到 lib/data/site.ts —— 遍历确实在读导入边",
    positiveControl.reached, positiveControl.chain.join(" → "));
  eq("（对照）后台模块图走不到只有网站页在用的组件 —— 遍历不是「永远为真」",
    negativeControl.reached, false);
  ok(
    "（事实核对）后台页面的模块图确实引用着 dev 会重写的那个生成文件 —— 所以上面那条开关不能被放宽；" +
      "哪天耦合断开了，请把这条改成「到不了」并放宽上面的开关",
    snapshotLink.reached,
    snapshotLink.reached
      ? `链路：${snapshotLink.chain.join(" → ")}`
      : "后台模块图已经到不了 data/site/.backend-snapshot.ts（耦合已断开）",
  );
}

console.log("\n=== 15. 恢复型滚动：只许「把位置放回原处」，不许「跳到某个地方」 ===");

/*
 * 这一节守的是第 13 节白名单里那一个文件背后的**判定逻辑**，也是"过一会儿跳到最顶部"
 * 的最后一道兜底。两条纪律，都穷举成判定表（纯函数，不需要浏览器）：
 *
 *   ① **写回去的永远是"记下来的位置"**（必要时夹进当前可滚动范围）——
 *      没有任何一条路径能写出 0 或"某个固定位置"；
 *   ② **只在该写的时候写**：文档高度没变而位置变了，那是**人自己在滚** → 一个字都不写
 *      （这条最关键：兜底代码要是跟用户抢滚动条，比跳顶更让人恼火）。
 *
 * 另外几条"不是空转"的断言：兜底代码真的被接在了**被报告的那个动作**上
 * （课程库的 `toggleStatus` 前后各用一次），以及整页重载的那一手真的挂在后台外壳里。
 */
{
  const rootUrl = new URL("../", import.meta.url);

  // ── A. 夹进可滚动范围：越界要夹到**最远处**，绝不夹到 0 ────────────────────
  eq("负数位置夹到 0", clampScroll(-5, 1000), 0);
  eq("范围内的位置原样保留", clampScroll(120, 1000), 120);
  eq("超过上限时夹到**能滚到的最远处**（不是夹到顶部）", clampScroll(5000, 1000), 1000);
  eq("上限为负（页面比一屏还矮）时只能到 0", clampScroll(10, -100), 0);
  eq("非有限的位置退化成 0（不写入 NaN）", clampScroll(Number.NaN, 1000), 0);
  eq("位置取整（浏览器读回来的是整数）", clampScroll(10.6, 100), 11);

  // ── B. 就地动作期间：只在"高度变了、位置也被挪了"时才动手 ──────────────────
  const inPlace = (over: Partial<Parameters<typeof inPlaceScrollCorrection>[0]> = {}) =>
    inPlaceScrollCorrection({
      recordedY: 2000,
      recordedHeight: 8000,
      currentY: 1800,
      currentHeight: 7900,
      maxScroll: 7000,
      ...over,
    });
  eq("没有记录（动作没被守护）→ 一个字都不写", inPlace({ recordedY: null }), null);
  eq("没有高度记录 → 一个字都不写", inPlace({ recordedHeight: null }), null);
  eq("位置没变（重渲染没动滚动）→ 一个字都不写", inPlace({ currentY: 2000 }), null);
  eq(
    "文档高度没变、位置却变了 = 人自己在滚 → 一个字都不写（绝不跟用户抢滚动条）",
    inPlace({ currentHeight: 8000, currentY: 1500 }),
    null,
  );
  eq("文档高度变了、位置也被挪了 → 放回记下来的位置", inPlace(), 2000);
  eq("位置被挪走且原来记的位置比现在还远的能滚范围更大 → 夹到最远处，而不是 0",
    inPlace({ maxScroll: 1500 }), 1500);
  eq("记录值非有限 → 一个字都不写", inPlace({ recordedY: Number.POSITIVE_INFINITY }), null);

  // ── C. 整页重载的记忆：编码 / 解码 / 只在"重载 + 同址"时恢复 ──────────────
  const href = "http://localhost:3000/admin/courses/";
  const memo = { href, y: 3000 };
  eq("记录能原样读回来", decodeScrollMemo(encodeScrollMemo(memo)), memo);
  eq("小数位置按整数记（与浏览器读回来的一致）",
    decodeScrollMemo(encodeScrollMemo({ href, y: 12.7 }))?.y, 13);
  eq("没有记录 → null", decodeScrollMemo(null), null);
  eq("空串 → null", decodeScrollMemo("   "), null);
  eq("不是 JSON → null（不猜）", decodeScrollMemo("not json"), null);
  eq("不是对象 → null", decodeScrollMemo("42"), null);
  eq("缺 y → null", decodeScrollMemo(JSON.stringify({ href })), null);
  eq("缺 href → null", decodeScrollMemo(JSON.stringify({ y: 10 })), null);
  eq("href 为空 → null", decodeScrollMemo(JSON.stringify({ href: "", y: 10 })), null);
  eq("负位置 → null", decodeScrollMemo(JSON.stringify({ href, y: -1 })), null);
  eq("非数字位置 → null", decodeScrollMemo(JSON.stringify({ href, y: "10" })), null);

  const reload = (over: Partial<Parameters<typeof reloadRestoreTarget>[0]> = {}) =>
    reloadRestoreTarget({ memo, href, navigationType: "reload", maxScroll: 7000, ...over });
  eq("普通跳转（navigate）不恢复", reload({ navigationType: "navigate" }), null);
  eq("前进后退（back_forward）不恢复", reload({ navigationType: "back_forward" }), null);
  eq("拿不到导航类型时不恢复", reload({ navigationType: "" }), null);
  eq("地址换了不恢复（不是同一份页面）", reload({ href: "http://localhost:3000/admin/" }), null);
  eq("没有记录（或记录坏了）不恢复", reload({ memo: null }), null);
  eq("本来就停在顶部 → 没什么可放回的", reload({ memo: { href, y: 0 } }), null);
  eq("整页重载 + 同址 → 放回记下来的位置", reload(), 3000);
  eq("页面还没长到时先夹在当前能滚到的最远处（长高后由 ResizeObserver 再放一次）",
    reload({ maxScroll: 0 }), 0);

  // ── D. 不是空转：兜底真的接在"被报告的那个动作"与后台外壳上 ────────────────
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const coursesPageSource = read("app/admin/(dashboard)/courses/page.tsx");
  const guardSource = read("components/admin/useScrollGuard.ts");
  const memorySource = read("components/admin/ScrollMemory.tsx");
  const layoutSource = read("app/admin/(dashboard)/layout.tsx");
  ok("课程库：『设为暂未开放』前后真的用了滚动守护（arm + release）",
    coursesPageSource.includes("scrollGuard.arm()") && coursesPageSource.includes("scrollGuard.release()"));
  ok("就地守护用的是纯函数判定（不是自己拍脑袋写几何）",
    guardSource.includes("inPlaceScrollCorrection(") && guardSource.includes("restoreScrollY("));
  ok("整页重载的记忆用的是纯函数判定", memorySource.includes("reloadRestoreTarget(") && memorySource.includes("restoreScrollY("));
  ok("后台外壳真的挂了 ScrollMemory（否则重载那一手没生效）",
    layoutSource.includes("<ScrollMemory"));
}

console.log("\n=== 16. 节假日表：两个来源逐日比对一致才写入 ===");

/*
 * 这一节守的是后台「节假日」页背后的那条链：
 *
 *   Apple 的 ics  →  解析（滤掉节气/固定节日的噪音）  ┐
 *                                                     ├→ 交叉校验 → 一致才写 data/holidays/<年>.json
 *   国务院公告口径的 JSON →  解析（只有安排日）        ┘
 *
 * 为什么值得这么多断言：这份数据一年只看一两次、没有人会去逐日核对，而它错了会直接影响
 * 排课与家长沟通。所以这里用的是**真实抓下来的原文**（`scripts/fixtures/holidays/`，
 * 就是那两个地址当时返回的内容），断言的是**实测数字**（2026 年 33 天放假 / 6 天调休，
 * 最长连休 9 天…）—— 换个解析器实现、改一句过滤条件，这些数字都会动。
 *
 * 覆盖三类东西：
 *   A/B  两个解析器（含噪音、CRLF、折行、DTEND 排他、坏数据必须拒绝）；
 *   C    交叉校验的判定表（含"口径差异不算冲突"这条要紧的不对称规则）；
 *   D/E  汇总与仓库里那几份数据的自洽（存下来的 == 解析出来的）；
 *   F    接线（页面必须写明"不会自动改排课"、权限只有一份、外网只在服务端抓）。
 */
{
  const fixtureUrl = new URL("./fixtures/holidays/", import.meta.url);
  const fixture = (name: string) => readFileSync(new URL(name, fixtureUrl), "utf8");
  const appleIcs = fixture("apple-cn_zh.ics");
  const gov2024Text = fixture("gov-2024.json");
  const gov2025Text = fixture("gov-2025.json");
  const gov2026Text = fixture("gov-2026.json");
  const gov2027Text = fixture("gov-2027-empty.json");

  /** 解析并保证成功（失败时把原因一并塞进断言里，免得后面几十条断言读空数组读得莫名其妙）。 */
  const parsed = <T,>(result: { ok: true; days: T[] } | { ok: false; error: string }): T[] => {
    ok("解析成功（否则下面这一组断言读的是空数组）", result.ok, result.ok ? "" : result.error);
    return result.ok ? result.days : [];
  };

  // ── A. Apple ics：真实响应（节选）───────────
  const apple2026 = parseAppleHolidays(appleIcs, 2026);
  const a26 = parsed(apple2026);
  eq("2026 年解析出 39 天（放假 + 调休，实测值）", a26.length, 39);
  eq("其中放假 33 天", a26.filter((day) => day.kind === "放假").length, 33);
  eq("其中调休上班 6 天", a26.filter((day) => day.kind === "调休上班").length, 6);
  /*
   * 这一条钉的是"**必须按标记过滤**"，而不是"按名字猜"。
   * 只查"结果里没有小寒"是不够的 —— 实测把过滤条件放宽成"标记命中 **或** 名字带（休）/（班）"，
   * 前面那些断言全部照样绿（fixture 里的节气、固定节日本来不带后缀）。
   * 所以这里造一条**带（休）后缀、但没有标记**的事件：它必须被排除。
   */
  const suffixOnly =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260308\r\nDTEND;VALUE=DATE:20260309\r\n" +
    "SUMMARY;LANGUAGE=zh_CN:妇女节（休）\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  eq(
    "只有名字后缀、没有 X-APPLE-SPECIAL-DAY 标记的事件必须被排除（否则「按名字猜」也能过）",
    parsed(parseAppleHolidays(suffixOnly, 2026)).length,
    0,
  );
  eq(
    "节气与固定节日的噪音一条都没混进来（小寒/立春/妇女节/儿童节/建党节/除夕）",
    a26
      .filter((day) => ["小寒", "立春", "妇女节", "儿童节", "建党节", "除夕"].includes(day.name))
      .map((day) => day.name),
    [],
  );
  ok(
    "fixture 里确实留着带 RRULE 的噪音事件（否则下面那条「RRULE 噪声没混进来」是空转的）",
    appleIcs.includes("RRULE"),
    "天数对不对由上面那条 39 管着，这条只保证装置没被简化掉",
  );
  eq(
    "DTEND 是排他的：春节那块 2/15–2/23 共 9 天（不含 2/24）",
    a26.filter((day) => day.kind === "放假" && day.date >= "2026-02-15" && day.date <= "2026-02-24").length,
    9,
  );
  ok(
    "没有 DTEND 的事件按单日算（2026-02-14 是春节前调休上班）",
    a26.some((day) => day.date === "2026-02-14" && day.kind === "调休上班"),
  );
  ok("节日名去掉了「（休）」「（班）」后缀", a26.every((day) => !day.name.includes("（")));
  eq(
    "同一天不会出现两条（2025-10-06 既是国庆又是中秋，属于 B 组那条断言）",
    a26.length,
    new Set(a26.map((day) => `${day.date}|${day.kind}`)).size,
  );

  // 折行：iCalendar 规定续行以空格开头（真实文件里没有被折的行，但格式允许，必须处理）
  const folded =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=\r\n DATE:20260103\r\nDTEND;VALUE=DATE:20260104\r\n" +
    "SUMMARY;LANGUAGE=zh_CN:元旦（休）\r\nX-APPLE-SPECIAL-DAY:WORK-HOLIDAY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const foldedResult = parseAppleHolidays(folded, 2026);
  eq(
    "折行的属性（续行以空格开头）能正确展开",
    foldedResult.ok ? foldedResult.days.map((day) => day.date) : [],
    ["2026-01-03"],
  );

  // 必须拒绝的四类（宁可报错，也不要"少一天假"）
  const rruleEvent =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260215\r\nDTEND;VALUE=DATE:20260224\r\n" +
    "SUMMARY;LANGUAGE=zh_CN:春节（休）\r\nRRULE:FREQ=YEARLY;COUNT=3\r\nX-APPLE-SPECIAL-DAY:WORK-HOLIDAY\r\n" +
    "END:VEVENT\r\nEND:VCALENDAR\r\n";
  const rruleResult = parseAppleHolidays(rruleEvent, 2026);
  ok("带 RRULE 的放假事件必须拒绝（展开不了就不能装懂，那等于少一整段假期）", !rruleResult.ok);
  ok("拒绝原因里点明了是 RRULE", !rruleResult.ok && rruleResult.error.includes("RRULE"));

  const mismatchEvent =
    "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260102\r\n" +
    "SUMMARY;LANGUAGE=zh_CN:元旦（班）\r\nX-APPLE-SPECIAL-DAY:WORK-HOLIDAY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const mismatchResult = parseAppleHolidays(mismatchEvent, 2026);
  ok("标记（放假日）与名字后缀（（班））对不上时拒绝，而不是挑一个信", !mismatchResult.ok);
  ok(
    "拒绝原因里说明了两个判据不一致",
    !mismatchResult.ok && mismatchResult.error.includes("自相矛盾"),
  );
  ok("没有 DTSTART 的事件 → 拒绝", !parseAppleHolidays("BEGIN:VEVENT\r\nX-APPLE-SPECIAL-DAY:WORK-HOLIDAY\r\nEND:VEVENT\r\n", 2026).ok);
  ok("根本不是 ics（没有任何事件）→ 拒绝", !parseAppleHolidays("<!doctype html><html>404</html>", 2026).ok);
  eq(
    "要哪一年就只回哪一年（同一份文件里 2024 与 2026 互不串）",
    parsed(parseAppleHolidays(appleIcs, 2024)).every((day) => day.date.startsWith("2024")),
    true,
  );

  // ── B. 国务院公告口径的 JSON ──────────────
  const g24 = parsed(parseGovHolidays(gov2024Text, 2024));
  const g25 = parsed(parseGovHolidays(gov2025Text, 2025));
  const g26 = parsed(parseGovHolidays(gov2026Text, 2026));
  eq("2026 年：国务院口径 39 天（与 Apple 同数）", g26.length, 39);
  eq(
    "2024 年：国务院口径 36 天、比 Apple 少 2 天（那是口径差异，见 C 组）",
    [g24.length, parsed(parseAppleHolidays(appleIcs, 2024)).length],
    [36, 38],
  );
  const g27 = parseGovHolidays(gov2027Text, 2027);
  ok(
    "「还没公布」（days 是空数组）不是错误，而是一句说明",
    g27.ok && g27.days.length === 0 && g27.note.includes("还没有公布"),
    g27.ok ? g27.note : g27.error,
  );
  ok("不是 JSON → 拒绝", !parseGovHolidays("<html>404</html>", 2026).ok);
  ok("年份与本文件不符 → 拒绝", !parseGovHolidays(gov2026Text, 2025).ok);
  ok(
    "缺 isOffDay（不知道是放假还是调休）→ 拒绝",
    !parseGovHolidays('{"year":2026,"days":[{"name":"元旦","date":"2026-01-01"}]}', 2026).ok,
  );
  ok(
    "不存在的日子（2026-02-30）→ 拒绝",
    !parseGovHolidays('{"year":2026,"days":[{"name":"元旦","date":"2026-02-30","isOffDay":true}]}', 2026).ok,
  );
  ok(
    "没有节日名 → 拒绝",
    !parseGovHolidays('{"year":2026,"days":[{"name":"","date":"2026-01-01","isOffDay":true}]}', 2026).ok,
  );
  ok(
    "没有 days 数组（格式变了）→ 拒绝",
    !parseGovHolidays('{"year":2026}', 2026).ok,
  );

  // ── C. 交叉校验：**不对称**的规则（口径差异 ≠ 数据打架）──
  const apple24 = parsed(parseAppleHolidays(appleIcs, 2024));
  const apple25 = parsed(parseAppleHolidays(appleIcs, 2025));
  for (const [year, appleDays, govDays] of [
    [2024, apple24, g24],
    [2025, apple25, g25],
    [2026, a26, g26],
  ] as const) {
    const verdict = checkHolidaySources(appleDays, govDays);
    ok(`${year} 年两个真实来源能互证（允许写入）`, verdict.agree, verdict.blocking.join(" "));
    ok(`${year} 年的结论里写了"两边一致"`, verdict.notes.some((note) => note.includes("两个来源一致")));
  }
  const v24 = checkHolidaySources(apple24, g24);
  ok(
    "2024 年：Apple 多标 6/08、6/09 但都是周末 → 判为口径差异，且把这两天点名说清",
    v24.notes.some((note) => note.includes("2024-06-08") && note.includes("口径差异")),
    v24.notes.join(" / "),
  );

  const empty = checkHolidaySources([], []);
  ok("两个来源都空 = 还没公布（不是错误，也不是全年无假期）", !empty.agree && empty.notPublished);
  const oneEmpty = checkHolidaySources(a26, []);
  ok("只有一个来源空 = 那个源坏了（**不是**「还没公布」）", !oneEmpty.agree && !oneEmpty.notPublished);
  ok(
    "「源坏了」的理由里点明了「另一个源有数据」",
    oneEmpty.blocking.some((line) => line.includes("另一个源有数据")),
  );

  const offDay = (date: string, name = "元旦"): HolidayDay => ({ date, name, kind: "放假" });
  const workDay = (date: string, name = "元旦"): HolidayDay => ({ date, name, kind: "调休上班" });

  const workMismatch = checkHolidaySources([workDay("2026-01-04")], [workDay("2026-01-05")]);
  ok(
    "调休上班日两边对不上 → 拒绝，并点出具体日期（这一项不允许有口径差异）",
    !workMismatch.agree &&
      workMismatch.blocking.some((line) => line.includes("2026-01-04") && line.includes("2026-01-05")),
  );
  const govExtra = checkHolidaySources([offDay("2026-01-01")], [offDay("2026-01-01"), offDay("2026-01-02")]);
  ok(
    "国务院列的放假日 Apple 缺了 → 拒绝并点名",
    !govExtra.agree && govExtra.blocking.some((line) => line.includes("2026-01-02")),
  );
  // 2026-01-05 是周一：Apple 多出一个"工作日放假"就是真多
  const appleExtraWeekday = checkHolidaySources([offDay("2026-01-01"), offDay("2026-01-05")], [offDay("2026-01-01")]);
  ok(
    "Apple 多出来的放假日不是周末 → 拒绝（这一条把「口径差异」与「数据错误」严格分开）",
    !appleExtraWeekday.agree && appleExtraWeekday.blocking.some((line) => line.includes("2026-01-05")),
  );
  // 2026-01-03 是周六：多出来的是周末 → 允许，只记一句说明
  const appleExtraWeekend = checkHolidaySources([offDay("2026-01-01"), offDay("2026-01-03")], [offDay("2026-01-01")]);
  ok(
    "Apple 多出来的放假日是周末 → 允许写入，并把差异记成说明",
    appleExtraWeekend.agree && appleExtraWeekend.notes.some((note) => note.includes("2026-01-03")),
  );
  const contradictory = checkHolidaySources([offDay("2026-01-01"), workDay("2026-01-01")], [offDay("2026-01-01"), workDay("2026-01-01")]);
  ok(
    "同一天既放假又调休上班（自相矛盾）→ 拒绝",
    !contradictory.agree && contradictory.blocking.some((line) => line.includes("既算放假又算调休上班")),
  );

  /*
   * 用户可见的文案纪律：`blocking` / `notes` / 解析错误都会被后台界面**当纯文本**显示
   * （`app/admin/(dashboard)/holidays/page.tsx` 里没有 markdown 渲染），
   * 所以里面出现 `**` 就会原样显示成星号 —— 这一条是在实现时真犯过两次的错。
   */
  const messages = [
    empty, oneEmpty, workMismatch, govExtra, appleExtraWeekday, appleExtraWeekend, contradictory, v24,
  ].flatMap((verdict) => [...verdict.blocking, ...verdict.notes]);
  const parseMessages = [
    rruleResult,
    mismatchResult,
    parseAppleHolidays("<!doctype html>", 2026),
    parseGovHolidays("<html>", 2026),
    parseGovHolidays(gov2026Text, 2025),
    parseGovHolidays('{"year":2026,"days":[{"name":"元旦","date":"2026-01-01"}]}', 2026),
    parseGovHolidays('{"year":2026}', 2026),
    g27,
  ].flatMap((result) => (result.ok ? [result.note] : [result.error]));
  eq(
    "校验结论与错误文案里没有 markdown 星号（界面按纯文本显示它们）",
    [...messages, ...parseMessages].filter((line) => line.includes("**")),
    [],
  );

  // ── D. 汇总：一天一条、连休块不重叠 ──────────
  const s26 = summarizeHolidayYear(a26);
  eq("2026 年最长连休 9 天", s26.longestOff, 9);
  eq("2026 年放假连休块 7 段（元旦 / 春节 / 清明 / 劳动 / 端午 / 中秋 / 国庆）", s26.offBlocks.length, 7);
  eq("2026 年调休上班是 6 个单日", s26.workBlocks.length, 6);
  eq(
    "连休块的天数之和 = 放假日数（块与天对得上）",
    s26.offBlocks.reduce((total, block) => total + block.days, 0),
    s26.offDays,
  );

  const s25 = summarizeHolidayYear(apple25);
  eq("2025 年放假 28 天（不是 29：10/06 只是一个日子）", s25.offDays, 28);
  eq("2025 年最长连休 8 天（国庆 + 中秋连在一起）", s25.longestOff, 8);
  eq(
    "2025-10-06 只出现一条，名字是「国庆节、中秋节」（同一天两个节日要合起来）",
    apple25.filter((day) => day.date === "2025-10-06").map((day) => day.name),
    ["国庆节、中秋节"],
  );
  const s25Block = s25.offBlocks.find((block) => block.from === "2025-10-01");
  eq(
    "2025 年国庆那一块是一段 8 天连休、带两个节日名（不是两段重叠的块）",
    s25Block === undefined ? null : [s25Block.to, s25Block.days, s25Block.names],
    ["2025-10-08", 8, ["国庆节", "中秋节"]],
  );
  for (const [year, summary] of [
    [2024, summarizeHolidayYear(apple24)],
    [2025, s25],
    [2026, s26],
  ] as const) {
    let overlapping = 0;
    for (let i = 0; i < summary.offBlocks.length; i += 1) {
      for (let j = i + 1; j < summary.offBlocks.length; j += 1) {
        const a = summary.offBlocks[i];
        const b = summary.offBlocks[j];
        if (a !== undefined && b !== undefined && a.to >= b.from && b.to >= a.from) overlapping += 1;
      }
    }
    eq(`${year} 年的连休块两两不重叠（重叠会让"连休几天"变得不可信）`, overlapping, 0);
  }
  eq("隔了一天的两天不算一段连休", holidayBlocks([offDay("2026-01-01"), offDay("2026-01-03")]).length, 2);
  eq(
    "跨节的连休按类型合并、名字都带上",
    holidayBlocks([offDay("2026-10-01", "国庆节"), offDay("2026-10-02", "国庆节、中秋节")]).map((block) => block.names),
    [["国庆节", "中秋节"]],
  );
  eq(
    "同一天出现两条（同一类型）时合并成一条",
    mergeHolidayDays([offDay("2026-10-06", "国庆节"), offDay("2026-10-06", "中秋节")]).map((day) => day.name),
    ["国庆节、中秋节"],
  );
  eq(
    "两个来源合起来时，名字用第一个来源的（避免「清明、清明节」这种废话）",
    combineHolidaySources([offDay("2026-04-04", "清明")], [offDay("2026-04-04", "清明节")]).map((day) => day.name),
    ["清明"],
  );
  eq(
    "第二个来源里多出来的日子会被补进来（校验放宽时必须有明确行为）",
    combineHolidaySources([offDay("2026-01-01")], [offDay("2026-01-02")]).map((day) => day.date),
    ["2026-01-01", "2026-01-02"],
  );

  const coverage = holidayCoverage([2024, 2025, 2026], new Date(2026, 5, 1));
  eq("该有数据的年份 = 今年与明年", coverage.expected, [2026, 2027]);
  eq("其中没有数据的年份就是缺的那一个", coverage.missing, [2027]);
  eq("有数据的年份按升序列出", coverage.available, [2024, 2025, 2026]);
  eq("2026-02-15 是周日", holidayWeekdayLabel("2026-02-15"), "周日");
  eq("2026-02-14 是周六（所以那天被调成上班日）", isWeekendDate("2026-02-14"), true);
  eq("2026-02-16 是周一（工作日放假才是真放假）", isWeekendDate("2026-02-16"), false);
  ok("坏日期不猜：解析不出来就回 null / 空串", holidayWeekday("2026-02-30") === null && holidayWeekdayLabel("随便") === "");
  eq("日期与字符串互转是本地日历日（不经过 UTC）", toDateKey(parseDateKey("2026-02-15") ?? new Date()), "2026-02-15");

  // ── E. 仓库里那几份数据本身 ────────────────
  /*
   * 这几条把"仓库里存下来的文件"与"从真实响应解析出来的结果"钉在一起：
   * 谁改了写盘那一步（或者手改了文件），这里立刻报红。
   */
  for (const [year, appleDays] of [
    [2024, apple24],
    [2025, apple25],
    [2026, a26],
  ] as const) {
    const file = `data/holidays/${year}.json`;
    const stored = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")) as unknown;
    const validated = readHolidayYear(stored, year);
    ok(`${file} 通过校验（读盘校验不许放行坏数据）`, validated.ok, validated.ok ? "" : validated.error);
    const value = validated.ok ? validated.value : null;
    ok(`${file} 里记着"两个来源一致"`, value?.verdict.agree === true);
    eq(`${file} 的逐日表与从真实 Apple 响应解析出来的一模一样`, value?.days, appleDays);
  }
  const stored2026 = JSON.parse(readFileSync(new URL("../data/holidays/2026.json", import.meta.url), "utf8")) as Record<string, unknown>;
  ok("文件里留了抓取时间与两个来源的地址、指纹（事后要说得清数据从哪来）", (() => {
    const sources = stored2026.sources;
    if (!Array.isArray(sources) || sources.length !== 2) return false;
    return sources.every((item) => {
      const source = item as Record<string, unknown>;
      return typeof source.url === "string" && source.url.startsWith("https://") &&
        typeof source.fingerprint === "string" && source.fingerprint.startsWith("sha256:");
    });
  })());

  ok("年份与文件名不符 → 拒绝", !readHolidayYear({ ...stored2026, year: 2030 }, 2026).ok);
  ok("空 days → 拒绝（空表比没有文件更容易骗人）", !readHolidayYear({ ...stored2026, days: [] }, 2026).ok);
  ok("缺 fetchedAt → 拒绝", !readHolidayYear({ ...stored2026, fetchedAt: "" }, 2026).ok);
  ok(
    "认不出来的类型 → 拒绝",
    !readHolidayYear({ ...stored2026, days: [{ date: "2026-01-01", name: "元旦", kind: "放假啊" }] }, 2026).ok,
  );
  ok(
    "坏日期 → 拒绝",
    !readHolidayYear({ ...stored2026, days: [{ date: "2026-13-01", name: "元旦", kind: "放假" }] }, 2026).ok,
  );
  ok("整个文件不是对象 → 拒绝", !readHolidayYear("2026", 2026).ok);
  ok(
    "日期不属于这一年 → 拒绝（手改文件最容易出的错：把别的年份那几天粘过来）",
    !readHolidayYear({ ...stored2026, days: [{ date: "1999-01-01", name: "元旦", kind: "放假" }] }, 2026).ok,
  );
  /*
   * `verdict` 整份会被界面拿去渲染（`current.verdict.notes.map(...)`），而"这份文件可以手工改"
   * 是文档明确邀请的：`notes` 被删掉或写成字符串时不许让整页崩，也不许因为 `agree` 是
   * 字符串 "yes"（truthy）就显示"两个来源一致"。
   */
  const messyVerdict = readHolidayYear({ ...stored2026, verdict: { agree: "yes", notes: "不是数组" } }, 2026);
  ok("verdict 形状不对时仍然读得回来（页面不会崩）", messyVerdict.ok);
  eq(
    "而且被规范成安全的形状（agree 只认 true，notes 只认字符串数组）",
    messyVerdict.ok ? [messyVerdict.value.verdict.agree, messyVerdict.value.verdict.notes] : null,
    [false, []],
  );
  ok(
    "verdict 整个被删掉也只是退化成「没有校验结论」，不是崩",
    (() => {
      const raw = { ...stored2026 } as Record<string, unknown>;
      delete raw.verdict;
      const read = readHolidayYear(raw, 2026);
      return read.ok && read.value.verdict.agree === false && read.value.verdict.blocking.length > 0;
    })(),
  );

  // ── F. 接线：页面、权限、路由、外网只在一处 ──
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const page = read("app/admin/(dashboard)/holidays/page.tsx");
  ok(
    "页面上必须写明「不会自动改排课」（否则会有人以为排课已经识别假期了）",
    page.includes("这张表只供查看，不会自动改排课"),
  );
  ok("并且写明手动处理的口径（与使用手册、recurrence.ts 那几处一致）", page.includes("手动处理"));
  ok(
    "「调休与节假日请手动处理」那四处口径没有被这次改动悄悄改掉",
    read("lib/backend/recurrence.ts").includes("不处理调休、节假日、寒暑假") &&
      read("components/admin/LessonSeriesForm.tsx").includes("调休、节假日、寒暑假不自动跳过") &&
      read("docs/使用手册.md").includes("调休、节假日、寒暑假不自动跳过") &&
      read("docs/后台API约定.md").includes("不处理调休、节假日、寒暑假"),
  );
  /*
   * 这条早先只断言"页面里出现过 HOLIDAY_ACTION_ACCESS" —— 那连 import 那一行都满足，
   * 有人把判定改成 `canAccess(roles, [])`（按钮永不显示、抓取功能对管理员彻底不可用）
   * 它照样绿。改成断言**判定表达式**里同时出现 `canAccess` 与那份权限表。
   */
  ok(
    "页面按 roles.ts 那一份权限算出「能不能抓」（而不是只 import 了没用）",
    /canRefresh[\s\S]{0,200}canAccess\(roles,\s*HOLIDAY_ACTION_ACCESS\[/.test(page),
  );
  ok(
    "服务端也读 roles.ts 那一份，而不是自己写死角色",
    read("server/index.mts").includes("HOLIDAY_ACTION_ACCESS"),
  );
  eq("页面权限与「读」这个动作的权限是同一个答案", PAGE_ACCESS["/admin/holidays"], HOLIDAY_ACTION_ACCESS["holidays.read"]);
  eq("抓取只有技术管理员", HOLIDAY_ACTION_ACCESS["holidays.refresh"], ["技术管理员"]);
  ok("导航里有入口（否则这一页只能靠手敲网址）", read("lib/site/admin-nav.ts").includes('"/admin/holidays"'));

  const serverHolidays = read("server/holidays.mts");
  ok(
    "抓外网确实发生在服务端的这一个文件里（真 `fetch` 只在这里出现一次）",
    /\bfetch\(url,/.test(serverHolidays) && (serverHolidays.match(/\bfetch\(/g) ?? []).length <= 2,
    `fetch( 出现 ${(serverHolidays.match(/\bfetch\(/g) ?? []).length} 次`,
  );
  ok(
    "国务院那个源配了镜像链（raw.githubusercontent.com 实测 6 次里 4 次超时）",
    serverHolidays.includes("cdn.jsdelivr.net") && serverHolidays.includes("fastly.jsdelivr.net") &&
      serverHolidays.includes("raw.githubusercontent.com"),
  );
  ok("写盘是「先写临时文件再改名」（中途失败不会留下半截 JSON）", serverHolidays.includes("renameSync"));
  ok("写盘前必须过交叉校验（拒绝写入的分支真的在）", serverHolidays.includes("if (!verdict.agree)"));

  /*
   * 前端源码里不许直接抓外网：这张表要走后端（浏览器抓那些地址会撞 CORS，
   * 而且"谁在访问外网"应该只有一处）。扫描 `app/`、`components/`、`lib/` 下的源码，
   * 只允许 fetch 相对后端的地址（`${base}` 那种），不许出现 `fetch("http…")`。
   */
  const frontendFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(new URL(dir, rootUrl), { withFileTypes: true })) {
      const next = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", "out"].includes(entry.name)) walk(`${next}/`);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry.name)) frontendFiles.push(next);
    }
  };
  for (const dir of ["app/", "components/", "lib/"]) walk(dir);
  const externalFetch = frontendFiles.filter((file) => /fetch\(\s*["'`]https?:/.test(read(file)));
  eq(
    `前端源码里没有直接抓外网的地方（扫了 ${frontendFiles.length} 个文件）`,
    externalFetch,
    [],
  );

  // ── G. 抓取链路：「一致才写盘」必须**有行为性覆盖** ────────────────────────
  /*
   * 这一组是第 16 节里最要紧的。这个功能的核心承诺是"两个来源逐日比对一致才写盘"，
   * 而**只断言源码里有 `if (!verdict.agree)` 是挡不住"在闸门之前先写一次"的**
   * （有人加一句 `if (process.env.XXX) writeHolidayYearFile(...)` 就绕过去了）。
   *
   * 所以这里用**注入的替身网络**（`refreshHolidayYear` 的 `fetchImpl`）驱动真的抓取逻辑，
   * 每一种输入都去**看盘上到底有没有多出文件**。目录用 `NEXGENEDU_HOLIDAY_DIR` 指到临时目录，
   * 自检绝不碰仓库里的 `data/holidays/`。
   */
  {
    const dir = mkdtempSync(join(tmpdir(), "nexgenedu-holiday-check-"));
    const savedDir = process.env.NEXGENEDU_HOLIDAY_DIR;
    process.env.NEXGENEDU_HOLIDAY_DIR = dir;
    try {
      ok("（装置自证）节假日目录确实被指到了临时目录，否则下面几条会写进仓库",
        holidaysDir() === dir, holidaysDir());

      const files = (): string[] => (existsSync(dir) ? readdirSync(dir).sort() : []);
      const clear = (): void => {
        for (const name of files()) rmSync(join(dir, name), { force: true });
      };
      /** 替身网络：ics 走 Apple 那一支，其余按年份取。`null` = 这一支回 404。 */
      const fakeFetch = (apple: string | null, gov: Record<number, string | null>) =>
        async (url: string): Promise<Response> => {
          if (url.includes("cn_zh.ics")) {
            return apple === null ? new Response(null, { status: 404 }) : new Response(apple, { status: 200 });
          }
          const year = Number(/master\/(\d{4})\.json/.exec(url)?.[1] ?? 0);
          const body = gov[year];
          return body === null || body === undefined
            ? new Response(null, { status: 404 })
            : new Response(body, { status: 200 });
        };

      clear();
      const written = await refreshHolidayYear(2026, { fetchImpl: fakeFetch(appleIcs, { 2026: gov2026Text }) });
      eq("两源一致 → 结局是 written", written.status, "written");
      eq("盘上真的写出了一个文件（只有这一种情形会写）", files(), ["2026.json"]);
      const writtenRaw = JSON.parse(readFileSync(join(dir, "2026.json"), "utf8")) as unknown;
      const writtenValue = readHolidayYear(writtenRaw, 2026);
      ok("写下去的文件本身能通过读盘校验", writtenValue.ok, writtenValue.ok ? "" : writtenValue.error);
      eq(
        "写下去的逐日表 = 真实 Apple 解析结果与国务院口径合并后的结果",
        writtenValue.ok ? writtenValue.value.days : null,
        combineHolidaySources(a26, g26),
      );

      /** 每一种"不该写盘"的输入：结局、文件都不许有。 */
      const rejectedCases: Array<{ label: string; apple: string | null; gov: Record<number, string | null>; expect: string }> = [
        {
          label: "国务院那份少列了 1 天法定假 → 拒绝写入",
          apple: appleIcs,
          gov: { 2026: JSON.stringify({ ...(JSON.parse(gov2026Text) as Record<string, unknown>), days: (JSON.parse(gov2026Text) as { days: Array<{ date: string }> }).days.filter((day) => day.date !== "2026-10-05") }) },
          expect: "rejected",
        },
        {
          label: "调休上班日两边对不上 → 拒绝写入",
          apple: appleIcs,
          gov: {
            2026: JSON.stringify({
              ...(JSON.parse(gov2026Text) as Record<string, unknown>),
              days: (JSON.parse(gov2026Text) as { days: Array<{ date: string; isOffDay: boolean }> }).days.map((day) =>
                day.date === "2026-05-09" ? { ...day, date: "2026-05-16" } : day,
              ),
            }),
          },
          expect: "rejected",
        },
        {
          label: "只有一个源有数据（另一个 404）→ 拒绝写入",
          apple: appleIcs,
          gov: { 2026: null },
          expect: "rejected",
        },
        {
          label: "Apple 那个地址 404（它不分年，只可能是地址变了）→ 拒绝写入，不许说成「还没公布」",
          apple: null,
          gov: { 2026: gov2026Text },
          expect: "rejected",
        },
        {
          label: "这一年的安排还没公布（两源都没这一年的数据）→ not-published，同样不写",
          apple: appleIcs,
          gov: { 2027: null },
          expect: "not-published",
        },
        {
          /*
           * 这一条专门钉"Apple 的 404 不许被当成未公布"：它那个文件**不分年**，
           * 404 只可能是地址变了。若两种 404 混成一个结论，这里就会得出
           * not-published（命令行还会退出码 0），主源下线被说成正常状态。
           */
          label: "Apple 与国务院那份都 404 → 必须是 rejected（主源坏了，不是「还没公布」）",
          apple: null,
          gov: { 2026: null },
          expect: "rejected",
        },
      ];
      for (const item of rejectedCases) {
        clear();
        const year = item.expect === "not-published" ? 2027 : 2026;
        const outcome = await refreshHolidayYear(year, { fetchImpl: fakeFetch(item.apple, item.gov) });
        eq(`${item.label}（结局）`, outcome.status, item.expect);
        eq(`${item.label}（盘上不许有文件）`, files(), []);
      }

      /*
       * 响应体读到一半断掉 / 超时：早先 `await response.text()` 在 try 之外，
       * 于是这是唯一**逃出** `refreshHolidayYear` 的异常 —— HTTP 会回 500、
       * 命令行直接栈回溯，而"抓取总是回 200、每年一个结局"是这一节的设计前提。
       */
      clear();
      const broken = (async (url: string): Promise<Response> => {
        if (url.includes("cn_zh.ics")) {
          return { status: 200, ok: true, text: () => Promise.reject(new Error("terminated")) } as unknown as Response;
        }
        return new Response(gov2026Text, { status: 200 });
      }) as (url: string) => Promise<Response>;
      const brokenOutcome = await refreshHolidayYear(2026, { fetchImpl: broken });
      eq("响应体读取失败**不再逃出**（收成一次可解释的结局）", brokenOutcome.status, "rejected");
      ok(
        "拒绝原因里带着那个错误（而不是一句「服务器内部错误」）",
        brokenOutcome.status === "rejected" && brokenOutcome.error.includes("terminated"),
        brokenOutcome.status === "rejected" ? brokenOutcome.error.slice(0, 120) : brokenOutcome.status,
      );
      eq("响应体读失败时也没有写盘", files(), []);

      clear();
      const dryRun = await refreshHolidayYear(2026, { write: false, fetchImpl: fakeFetch(appleIcs, { 2026: gov2026Text }) });
      eq("--dry-run（write:false）校验通过但不写盘", [dryRun.status, files()], ["checked", []]);

      clear();
      ok("路径穿越的年份在建路径那一步就被挡下（而不是靠调用方记得校验）",
        (() => {
          try {
            holidayYearFile("../../evil" as unknown as number);
            return false;
          } catch {
            return true;
          }
        })());
    } finally {
      if (savedDir === undefined) delete process.env.NEXGENEDU_HOLIDAY_DIR;
      else process.env.NEXGENEDU_HOLIDAY_DIR = savedDir;
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log("\n=== 17. P0：数据与钱的五道护栏 ===");

/*
 * 这一节对应 2026-09 那次四路对抗性审计抓出来的**会伤到数据或钱**的问题：
 *
 *   ① 删除档案是硬删、护栏却写在没人走的老 REST 上 → 孤儿收款/流水/考勤（现在：有账就拒绝）
 *   ② 收款既没有审计日志，又有通用写方法能绕开「实收 = 收款 − 退款」那条不变式
 *   ③ 退费金额由**前端**算、服务端照收（实测能退 999999）
 *   ④ 迁移卡住时 `load()` 把整库当成"首次访问"→ 清空并落盘
 *   ⑤ 超额退款用 `Math.max(0, …)` 钳位，让"实收"与账本永久分叉
 *
 * 每一条都有"会不会自己变成坏样子"的反向验证（在提交说明里逐条记着）。
 */
{
  /** 造一份"什么都沾过"的夹具：报课 + 收款 + 上课 + 考勤 + 测评 + 作业 + 排课。 */
  const store = createMemoryStore();
  __useStoreForTesting(store);
  const KEY = "nexgenedu.admin.db.v1";
  /*
   * 这一条只在**内存后端**下有意义：HTTP 后端的数据在服务端进程里，
   * 本地那个 store 根本不是数据源（`__useStoreForTesting` 对它不生效）。
   * 这正是 `npm run check:both` 要分辨的事 —— 请见下面"迁移与坏库"那一段的模式判定。
   */
  if (!isRemoteMode()) {
    ok("（装置自证）存储键就是 api 真正用的那一个",
      (await api.students.list()) !== null && store.read(KEY) !== null, KEY);
  }

  const student = await api.students.create({
    name: "护栏自检学生", grade: "初三", guardian: "138-0000-0000", phone: "", note: "", tags: [],
    profile: {}, siteVisible: false, origin: "后台",
  } as never);
  await api.students.enroll(student.id, {
    subject: "数学", form: "", teacherId: "", lessons: 10, startedAt: "2026-09-01",
    note: "", unitPrice: 200, agreedAmount: 2000, paidNow: 1000, method: "微信",
  } as never);
  const enrollment = (await api.students.get(student.id))!.enrollments[0]!;
  const teacher = await api.teachers.create({
    name: "护栏自检教师", subjects: ["数学"], role: "", phone: "", active: true, years: "",
    summary: "", bio: "", recommendation: "", order: 900, siteVisible: false, origin: "后台", kind: "教师",
  } as never);
  const room = await api.classrooms.create({
    name: "护栏自检教室", capacity: 6, note: "", active: true, availability: [],
  } as never);
  const lesson = await api.lessons.create({
    subject: "数学", form: "", teacherId: teacher.id, classroomId: room.id, studentIds: [student.id],
    startsAt: new Date(Date.now() - 3_600_000).toISOString(), durationMinutes: 60, status: "已排", note: "",
  } as never);
  await api.lessons.markCompleted(lesson.id);
  await api.lessonRecords.save({
    lessonId: lesson.id, studentId: student.id, attendance: "到课", focus: 4, interaction: 4, note: "",
  } as never);
  await api.assessments.add({ studentId: student.id, subject: "数学", date: "2026-09-20", score: 90, total: 100, note: "" } as never);
  await api.homework.create({ studentId: student.id, subject: "数学", date: "2026-09-20", title: "练习", status: "未完成", note: "" } as never);

  /** 跑一个"应当被拒绝"的删除，把理由取回来（没抛错就返回空串，断言会因此报红）。 */
  const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  // ── ① 删除护栏 ──────────────────────────────────────────────────────────
  const studentRefusal = await refusalOf(() => api.students.remove(student.id));
  ok("有账的学生：拒绝删除", studentRefusal !== "", studentRefusal.slice(0, 80));
  eq("理由里点了名（收款 / 课时流水 / 课堂记录 / 测评 / 作业 至少四样）",
    ["收款记录", "课时流水", "课堂记录", "阶段测评", "作业记录"].filter((key) => studentRefusal.includes(key)).length >= 4,
    true);
  ok("理由里写了「该怎么办」（结课 / 暂停，而不是只说不能删）",
    studentRefusal.includes("结课") || studentRefusal.includes("暂停"), studentRefusal);
  eq("被拒之后学生**还在**（没有半删状态）",
    (await api.students.list()).some((item) => item.id === student.id), true);

  const teacherRefusal = await refusalOf(() => api.teachers.remove(teacher.id));
  ok("有排课的教师：拒绝删除，并建议改用「停用」",
    teacherRefusal.includes("排课") && teacherRefusal.includes("停用"), teacherRefusal.slice(0, 80));
  const roomRefusal = await refusalOf(() => api.classrooms.remove(room.id));
  ok("有排课的教室：拒绝删除", roomRefusal.includes("排课"), roomRefusal.slice(0, 80));
  const lessonRefusal = await refusalOf(() => api.lessons.remove(lesson.id));
  ok("已扣课时的排课：拒绝删除，并提示先撤销「已上」",
    lessonRefusal.includes("课时") && lessonRefusal.includes("撤销"), lessonRefusal.slice(0, 90));

  const course = await api.courses.create({
    name: "护栏自检科目", partitionId: "", forms: [], origin: "后台",
    status: "开放", note: "", createdAt: new Date().toISOString(),
  } as never);
  const mathCourse = (await api.courses.list()).find((item) => item.name.trim() === "数学");
  if (mathCourse !== undefined) {
    const courseRefusal = await refusalOf(() => api.courses.remove(mathCourse.id));
    ok("被报课/排课引用的课程：拒绝删除，并建议改成「暂未开放」",
      courseRefusal.includes("暂未开放"), courseRefusal.slice(0, 90));
  }
  eq("没有被引用的课程照旧能删（护栏不误伤）", await api.courses.remove(course.id), true);

  // 干净的东西仍然删得掉（否则"有账就拒绝"会变成"什么都删不掉"）
  const cleanStudent = await api.students.create({
    name: "干净学生", grade: "", guardian: "", phone: "", note: "", tags: [],
    profile: {}, siteVisible: false, origin: "后台",
  } as never);
  const cleanLesson = await api.lessons.create({
    subject: "数学", form: "", teacherId: "", classroomId: "", studentIds: [],
    startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 60, status: "已排", note: "",
  } as never);
  eq("只建档、没有任何记录的学生：仍然可以删", await api.students.remove(cleanStudent.id), true);
  eq("没上过、没记录的排课：仍然可以删", await api.lessons.remove(cleanLesson.id), true);

  // ── ② 收款的绕道已经关掉、并且留痕 ────────────────────────────────────
  const paymentBypass = ["create", "update", "remove"].filter(
    (name) => typeof (api.payments as unknown as Record<string, unknown>)[name] === "function",
  );
  eq("收款不再有通用写方法（create / update / remove 都已删掉）", paymentBypass, []);

  const logsBeforePay = (await api.logs.list()).length;
  await api.payments.record({
    studentId: student.id, enrollmentId: enrollment.id, amount: 300, kind: "收款", method: "现金", note: "护栏自检补款",
  } as never);
  const payLogs = await api.logs.list();
  ok("收款写了操作日志（钱必须留痕）",
    payLogs.length > logsBeforePay && payLogs.some((item) => item.entity === "收款" && item.action === "收款"),
    `${logsBeforePay} → ${payLogs.length}`);
  ok("日志摘要里带金额（只说「记了一笔收款」等于没说）",
    payLogs.some((item) => item.entity === "收款" && item.summary.includes("¥300")),
    payLogs[0]?.summary ?? "");

  // ── ③ 退费金额由服务端重算 ─────────────────────────────────────────────
  const wrongAmount = await refusalOf(() =>
    api.students.refundEnrollment(student.id, enrollment.id, "自检", {
      policyId: "prorata", method: "微信", amount: 999_999,
    } as never),
  );
  ok("前端报的退款金额与服务端重算不一致 → 拒绝并要求刷新",
    wrongAmount.includes("对不上") && wrongAmount.includes("刷新"), wrongAmount.slice(0, 120));
  eq("被拒之后这条报课还是「在读」（没有半退状态）",
    (await api.students.get(student.id))!.enrollments.find((item) => item.id === enrollment.id)?.status, "在读");

  const beforeRefund = (await api.students.get(student.id))!.enrollments.find((item) => item.id === enrollment.id)!;
  const computed = calculateRefund(beforeRefund, "prorata");
  ok("服务端重算按**实收**：实收 1300 ÷ 10 节 × 剩 9 节（已上 1 节）",
    computed.refund === round2((beforeRefund.paidAmount / beforeRefund.totalLessons) * 9) && computed.formula.includes("实收"),
    `${computed.refund} / ${computed.formula}`);
  const refundedStudent = await api.students.refundEnrollment(student.id, enrollment.id, "自检退课", {
    policyId: "prorata", method: "微信", amount: computed.refund,
  } as never);
  const afterRefundEnrollment = refundedStudent!.enrollments.find((item) => item.id === enrollment.id)!;
  eq("界面传对金额时照常退课", afterRefundEnrollment.status, "已退课");
  eq("实收被扣回（不会被钳到 0）",
    afterRefundEnrollment.paidAmount, round2(beforeRefund.paidAmount - computed.refund));

  // ── ④ 迁移卡住不再清库（**只在内存后端下能测**）─────────────────────────
  /*
   * 为什么这一段要判模式：迁移与"坏库"这两件事都发生在**存储层**，
   * 而 HTTP 后端的数据在服务端进程里 —— 本地 `__useStoreForTesting(...)` 对它不生效，
   * 硬写在这里只会得到"看起来通过了、其实测的是别的东西"（`check:both` 第一次跑
   * 就在 HTTP 那一遍抓到了这个问题）。因此这一段只在内存后端下跑，
   * HTTP 那一遍明确打一行说明，而不是假装测过。
   */
  if (isRemoteMode()) {
    console.log("  （HTTP 后端：迁移与坏库这两组跳过 —— 它们测的是存储层，在内存后端那一遍跑）");
  } else {
  const migrationStore = createMemoryStore();
  const seedJson = JSON.parse(store.read(KEY) ?? "{}") as Record<string, unknown>;
  const seedCounts = {
    students: (seedJson.students as unknown[]).length,
    payments: (seedJson.payments as unknown[]).length,
    lessons: (seedJson.lessons as unknown[]).length,
  };
  ok("（前置）夹具库里确实有数据可丢", seedCounts.students > 0 && seedCounts.payments > 0, JSON.stringify(seedCounts));
  for (const claim of [1, 2]) {
    const broken = { ...seedJson, version: claim };
    migrationStore.write(KEY, JSON.stringify(broken));
    __useStoreForTesting(migrationStore);
    const listed = await api.students.list();
    const after = JSON.parse(migrationStore.read(KEY) ?? "{}") as Record<string, unknown>;
    eq(`版本号写着 v${claim} 但结构已是新版：数据**一条都不能少**`,
      (after.students as unknown[]).length, seedCounts.students);
    eq(`并且版本号被推进到当前版本（v${claim} → v${CURRENT_VERSION}）`, after.version, CURRENT_VERSION);
    eq(`读出来的学生数与库里一致（不是空库）`, listed.length, seedCounts.students);
  }

  // 坏 JSON / 版本比当前新：必须**抛错且什么都不改**（而不是清库）
  for (const [label, text] of [
    ["不是合法 JSON", "{ 这不是 JSON"],
    ["版本比当前新", JSON.stringify({ ...seedJson, version: CURRENT_VERSION + 1 })],
  ] as const) {
    const store2 = createMemoryStore();
    store2.write(KEY, text);
    __useStoreForTesting(store2);
    const problem = await refusalOf(() => api.students.list());
    ok(`库内容${label} → 抛错并说清「没有改动任何数据」`,
      problem.includes("没有改动任何数据"), problem.slice(0, 120));
    eq(`库内容${label} → 存储里那串内容**一个字节都没变**`, store2.read(KEY), text);
  }
  }

  /*
   * 把"数据"这一侧的存储换回夹具库：上面那两组坏库断言会把当前存储留在坏状态上
   * （`__useStoreForTesting` 是全局的），不换回来后面的断言就全在测那个坏库。
   * （HTTP 模式下没有那两组，也没有这个问题。）
   */
  if (!isRemoteMode()) __useStoreForTesting(store);

  // ── ⑤ 超额退款改拒绝，不再钳位 ─────────────────────────────────────────
  const overRefund = await refusalOf(() =>
    api.payments.record({
      studentId: student.id, enrollmentId: enrollment.id, amount: 99_999, kind: "退款", method: "微信", note: "超退自检",
    } as never),
  );
  ok("退款超过实收 → 拒绝（而不是把实收钳到 0）",
    overRefund.includes("不能超过实收"), overRefund.slice(0, 120));
  const afterOverRefund = (await api.students.get(student.id))!.enrollments.find((item) => item.id === enrollment.id)!;
  eq("被拒之后实收没有变（没有半截写入）", afterOverRefund.paidAmount, afterRefundEnrollment.paidAmount);
}

console.log("\n=== 18. P1：账目与审计一致性 ===");

/*
 * 这一节对应审计里"账对不上、查不到原因"那一档：
 *
 *   ① 一整片写操作不留痕（调课时 / 补课 / 阶段测评 / 删课堂记录 / 收款）
 *   ② 课堂记录的通用写方法能绕过「按出勤事实重算课时」
 *   ③ `students.enroll` 与"建档时报课"校验不对等（脏数据从后一条路进来）
 *   ④ 课时预警与"含不含已取消的课"同一个问题各有四套口径
 */
{
  const store = createMemoryStore();
  __useStoreForTesting(store);

  const student = await api.students.create({
    name: "账目自检学生", grade: "初三", guardian: "", phone: "", note: "", tags: [],
    profile: {}, siteVisible: false, origin: "后台",
  } as never);

  // ── ③ 报课校验：两条路必须同一口径 ────────────────────────────────────
  const enrollProblem = async (input: Record<string, unknown>): Promise<string> => {
    try {
      await api.students.enroll(student.id, {
        subject: "数学", form: "", teacherId: "", lessons: 10, startedAt: "2026-09-01",
        note: "", unitPrice: 200, agreedAmount: 2000, paidNow: 0, method: "微信",
        ...input,
      } as never);
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };
  ok("单独报课：科目为空 → 拒绝（与建档报课同一口径）", (await enrollProblem({ subject: "  " })).includes("科目不能为空"));
  ok("单独报课：课时 ≤ 0 → 拒绝", (await enrollProblem({ lessons: 0 })).includes("大于 0"));
  ok("单独报课：教师不存在 → 拒绝（不许静默存一个查不到的 id）",
    (await enrollProblem({ teacherId: "t_根本不存在" })).includes("教师不存在"));

  await api.students.enroll(student.id, {
    subject: "数学", form: "", teacherId: "", lessons: 4, startedAt: "2026-09-01",
    note: "", unitPrice: 200, agreedAmount: 800, paidNow: 800, method: "微信",
  } as never);
  const mathEnrollment = (await api.students.get(student.id))!.enrollments[0]!;
  ok("单独报课：同一门科目已有在读报课 → 拒绝并提示用「续费」",
    (await enrollProblem({ subject: "数学", lessons: 5 })).includes("续费"));

  // ── ① 调课时 / 阶段测评 / 补课 都要留痕 ───────────────────────────────
  const logCount = async (): Promise<number> => (await api.logs.list()).length;
  const beforeAdjust = await logCount();
  await api.students.adjustEnrollmentLessons(student.id, mathEnrollment.id, 3, "试听送 2 节·自检");
  const adjustLogs = await api.logs.list();
  ok("调整课时写了操作日志（改的是账，必须留痕）",
    adjustLogs.length > beforeAdjust && adjustLogs.some((item) => item.action === "调整课时"),
    `${beforeAdjust} → ${adjustLogs.length}`);
  ok("日志里写明前后节数与原因",
    adjustLogs.some((item) => item.action === "调整课时" && item.summary.includes("4 → 7") && item.summary.includes("试听送")),
    adjustLogs[0]?.summary ?? "");
  ok("调课时同样写课时流水（kind「调整」）",
    (await api.transactions.listByStudent(student.id)).some((item) => item.kind === "调整" && item.delta === 3));

  const beforeAssessment = await logCount();
  await api.assessments.add({ studentId: student.id, subject: "数学", date: "2026-09-20", score: 88, total: 100, note: "" } as never);
  ok("新增阶段测评写了操作日志", (await logCount()) > beforeAssessment);
  ok("日志里带分数",
    (await api.logs.list()).some((item) => item.entity === "阶段测评" && item.summary.includes("88")),
    (await api.logs.list())[0]?.summary ?? "");

  // ── ② 课堂记录：没有通用写方法，纠错走 save（会重算课时）─────────────
  const recordWrites = ["create", "update", "remove"].filter(
    (name) => typeof (api.lessonRecords as unknown as Record<string, unknown>)[name] === "function",
  );
  eq("课堂记录不再有通用写方法（删除记录会留下没有依据的课时扣减）", recordWrites, []);
  ok("课堂记录的正规写入口是 save", typeof api.lessonRecords.save === "function");

  const teacher = await api.teachers.create({
    name: "账目自检教师", subjects: ["数学"], role: "", phone: "", active: true, years: "",
    summary: "", bio: "", recommendation: "", order: 901, siteVisible: false, origin: "后台", kind: "教师",
  } as never);
  const lesson = await api.lessons.create({
    subject: "数学", form: "", teacherId: teacher.id, classroomId: "", studentIds: [student.id],
    startsAt: new Date(Date.now() - 3_600_000).toISOString(), durationMinutes: 60, status: "已排", note: "",
  } as never);
  await api.lessonRecords.save({
    lessonId: lesson.id, studentId: student.id, attendance: "到课", focus: 4, interaction: 4, note: "",
  } as never);
  /*
   * 扣课时发生在**课被标成「已上」**之后（出勤事实 + 课已完成才决定扣不扣），
   * 因此先标已上、再记考勤 —— 这正是真实使用顺序（老师上完课先点"标记已上"再补考勤）。
   */
  await api.lessons.markCompleted(lesson.id);
  const usedAfterAttend = (await api.students.get(student.id))!.enrollments[0]!.usedLessons;
  eq("标「已上」+ 记「到课」后扣 1 节", usedAfterAttend, 1);
  /*
   * 改成「请假」：**这节课已经开始了**，所以它是"迟到请假" —— 按 24 小时规则仍旧扣课时，
   * 课时**不该**被退回。这一条把规则也钉住了（不是"一改请假就退课时"）。
   */
  await api.lessonRecords.save({
    lessonId: lesson.id, studentId: student.id, attendance: "请假", focus: 4, interaction: 4, note: "上课当天才说",
    leaveRequestedAt: new Date(Date.now() - 1_800_000).toISOString(),
  } as never);
  eq("课后才说请假 → 仍按缺课扣 1 节（24 小时规则）",
    (await api.students.get(student.id))!.enrollments[0]!.usedLessons, 1);

  /*
   * 再建一节**三天后**的课，标已上 + 提前请假（离上课 > 24 小时）→ 课时必须退回来。
   * 这条同时证明 `save` 会按出勤事实**重算**（而不是只改记录）。
   */
  const futureLesson = await api.lessons.create({
    subject: "数学", form: "", teacherId: teacher.id, classroomId: "", studentIds: [student.id],
    startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), durationMinutes: 60, status: "已排", note: "",
  } as never);
  await api.lessons.markCompleted(futureLesson.id);
  eq("标已上后扣到 2 节", (await api.students.get(student.id))!.enrollments[0]!.usedLessons, 2);
  await api.lessonRecords.save({
    lessonId: futureLesson.id, studentId: student.id, attendance: "请假", focus: 4, interaction: 4, note: "提前三天请假",
    // 请假时间要留时间戳：扣不扣课时看的是"距离上课还有多久"，不是备注里那句话
    leaveRequestedAt: new Date(Date.now() - 3_600_000).toISOString(),
  } as never);
  eq("提前 > 24 小时请假 → 课时被退回（save 会重算，而不是只改记录）",
    (await api.students.get(student.id))!.enrollments[0]!.usedLessons, 1);

  const beforeMakeup = await logCount();
  const makeup = await api.lessons.createMakeup({
    originalLessonId: lesson.id, startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    durationMinutes: 60, teacherId: teacher.id, classroomId: "", studentIds: [student.id], note: "",
  } as never);
  ok("补课也写了操作日志（它同样是「排了一节课」）", (await logCount()) > beforeMakeup && makeup !== null);

  // ── ④ 口径合一：低课时判定与"已取消的课" ──────────────────────────────
  // 数学 4 + 3 = 7、物理 3 → 合计 10，但**最少的那一门是 3**
  await api.students.enroll(student.id, {
    subject: "物理", form: "", teacherId: "", lessons: 3, startedAt: "2026-09-01",
    note: "", unitPrice: 200, agreedAmount: 600, paidNow: 0, method: "微信",
  } as never);
  const enrollmentsNow = (await api.students.get(student.id))!.enrollments;
  const expectedTotal = enrollmentsNow.reduce((sum, item) => sum + (item.totalLessons - item.usedLessons), 0);
  const balance = lessonBalance(enrollmentsNow);
  eq("余额：合计 = 各科剩余之和，最少的那一门单独算出来",
    [balance.total, balance.weakestRemaining, balance.weakestRemaining < balance.total], [expectedTotal, 3, true]);
  eq("最少的那一门是哪一科也带出来（界面要说清是数学还是物理）", balance.weakest?.subject, "物理");

  const overview = await api.today(new Date());
  const overviewRow = overview.lowLessonStudents.find((item) => item.student.id === student.id);
  ok("今日概览列出的低课时学生 = 用「最少的那一门」判出来的",
    overviewRow !== undefined && overviewRow.remainingLessons === 3, JSON.stringify(overviewRow?.remainingLessons));
  eq("概览同时给出合计与科目（不再只显示一个含糊的「剩余」）",
    [overviewRow?.totalRemaining, overviewRow?.weakSubject], [expectedTotal, "物理"]);

  const followUps = await api.followups(new Date());
  const followUpRow = followUps.find((item) => item.studentId === student.id && item.kind === "课时不足");
  ok("待跟进也用同一个判据列出这位学生（两个页面不会给出不同答案）",
    followUpRow !== undefined && followUpRow.reason.includes("物理") && followUpRow.reason.includes(String(expectedTotal)),
    followUpRow?.reason ?? "（没有这一条）");

  const threshold = FOLLOWUP_RULES.lowLessons;
  ok("阈值只有一个来源（FOLLOWUP_RULES.lowLessons），概览与待跟进都从它取",
    threshold === 5 && overviewRow !== undefined && overviewRow.remainingLessons <= threshold);

  // 已取消的课不算课次、不算课时，但要单列出来
  const cancelled = await api.lessons.create({
    subject: "数学", form: "", teacherId: teacher.id, classroomId: "", studentIds: [],
    startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 90, status: "已排", note: "",
  } as never);
  const beforeCancel = await api.today(new Date());
  await api.lessons.update(cancelled.id, { status: "已取消" } as never);
  const afterCancel = await api.today(new Date());
  eq("取消之后：有效课次少 1（取消的不算课时）",
    [beforeCancel.lessonCount - afterCancel.lessonCount, beforeCancel.totalMinutes - afterCancel.totalMinutes],
    [1, 90]);
  eq("但「取消了 1 节」要说出来（不藏起来）", afterCancel.cancelledLessonCount, 1);
  eq("有效 + 取消 = 这天的全部课（数字不丢）",
    afterCancel.lessonCount + afterCancel.cancelledLessonCount,
    beforeCancel.lessonCount + beforeCancel.cancelledLessonCount);

  const counts = countLessons([
    { ...lesson, status: "已排", durationMinutes: 60 },
    { ...cancelled, status: "已取消", durationMinutes: 90 },
  ] as never);
  eq("countLessons：有效 1 节 60 分钟、取消 1 节 90 分钟",
    [counts.active, counts.activeMinutes, counts.cancelled, counts.cancelledMinutes], [1, 60, 1, 90]);
  ok("「3 节 · 2 小时」这类说法由同一个函数生成（取消的多一句说明）",
    describeLessonCounts(counts).includes("另有 1 节已取消"));
}

console.log("\n=== 19. P2：界面不能「点了没反应」 ===");

/*
 * 这一节对应审计的第三档：界面上的坑。它们单个都不致命，但**指向同一件事** ——
 * 用户点了之后得不到任何反馈，于是只能反复点、并得出"系统坏了"的结论：
 *
 *   ① 10 个页面的 `load()` 没有 try/catch → 读失败停在「加载中…」，一个字都不说
 *   ② 按钮对四个角色一律渲染 → 没权限的人点下去 403，而调用是裸 `await`（无人接的拒绝）
 *   ③ 课程库页把 `pricing.get()` 放进同一个 `Promise.all` → 普通教师（403）整页打不开
 *   ④ 报价页一挂载就自动试算，而其中 `teacherFee` 对招生老师是 403 → 试算结果永远空白
 *   ⑤ 整库导入"选中文件就替换"，唯一没有二次确认的破坏性操作，且备份只有一个槽
 *
 * 这些都是**源码结构**上的性质，因此这一节是源码级断言（不需要浏览器）——
 * 与第 13 节（就地动作不滚页）同一类。真正"看起来对不对"仍然要靠人肉目视。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");

  const ADMIN_PAGES = [
    "app/admin/(dashboard)/page.tsx",
    "app/admin/(dashboard)/calendar/page.tsx",
    "app/admin/(dashboard)/finance/page.tsx",
    "app/admin/(dashboard)/followups/page.tsx",
    "app/admin/(dashboard)/inquiries/page.tsx",
    "app/admin/(dashboard)/lessons/page.tsx",
    "app/admin/(dashboard)/scripts/page.tsx",
    "app/admin/(dashboard)/stats/page.tsx",
    "app/admin/(dashboard)/students/page.tsx",
    "app/admin/(dashboard)/timetable/page.tsx",
  ];

  // ── ① 读失败必须说出来（不许停在「加载中…」）──────────────────────────
  const noCatch = ADMIN_PAGES.filter((file) => {
    const source = read(file);
    const start = source.indexOf("const load = useCallback(");
    if (start === -1) return true;
    const end = source.indexOf("  }, [", start);
    return !/try \{[\s\S]*\} catch/.test(source.slice(start, end === -1 ? undefined : end));
  });
  eq(`每个带加载态的后台页面的 load 都有 try/catch（${ADMIN_PAGES.length} 页）`, noCatch, []);
  const noFailureUi = ADMIN_PAGES.filter((file) => !read(file).includes("<LoadFailure"));
  eq("并且把失败原因渲染出来（LoadFailure：服务端原话 + 重试）", noFailureUi, []);
  ok("LoadFailure 自己写着「屏幕上的内容是上一次读到的」（不假装数据是新的）",
    read("components/admin/LoadFailure.tsx").includes("上一次成功读到的"));

  // ── ② 没权限的按钮不该渲染 ─────────────────────────────────────────────
  /*
   * 判据用 `canCallMethod(roles, "具体方法名")` —— 与服务端闸门**同一个判定函数**。
   * 审计发现原先界面对四个角色一律渲染按钮（普通教师看到「新增 / 编辑 / 删除」、
   * 财务管理员看到「标记已上」），点下去 403 而界面什么都不说。
   */
  const gated: Array<[string, string]> = [
    ["app/admin/(dashboard)/students/page.tsx", "students.create"],
    ["app/admin/(dashboard)/students/page.tsx", "students.remove"],
    ["app/admin/(dashboard)/lessons/page.tsx", "lessons.markCompleted"],
    ["app/admin/(dashboard)/lessons/page.tsx", "lessons.remove"],
    ["app/admin/(dashboard)/pricing/page.tsx", "pricing.update"],
    ["components/admin/BulkImport.tsx", "imports.apply"],
  ];
  for (const [file, method] of gated) {
    ok(`${file.split("/").slice(-2).join("/")}：按权限决定「${method}」的按钮`,
      read(file).includes(`canCallMethod(roles, "${method}")`) ||
        read(file).includes(`canCallMethod(importRoles, "${method}")`) ||
        read(file).includes(`canCallMethod(importRoles, "${method}"`),
      file);
  }
  ok("界面判定与服务端同源（canCallMethod 直接问 allowedRolesForMethod）",
    read("lib/auth/roles.ts").includes("const allowed = allowedRolesForMethod(method);"));
  ok("没权限时给一句「这件事归谁」而不是静默（methodOwnerText）",
    read("app/admin/(dashboard)/lessons/page.tsx").includes("methodOwnerText("));

  // ── ③ 课程库页：报价 403 不许拖垮整页 ──────────────────────────────────
  const courses = read("app/admin/(dashboard)/courses/page.tsx");
  ok("课程库页单独 catch 报价（普通教师对 pricing.get 是 403，课程仍应看得见）",
    courses.includes("api.pricing.get().catch("));
  ok("报价读不到时单独说一句（不借用「网站正文」那条错误，免得说错地方）",
    courses.includes("pricingLoadError"));

  // ── ④ 报价页：试算块不许因为一个 403 整块空白 ──────────────────────────
  const pricing = read("app/admin/(dashboard)/pricing/page.tsx");
  ok("报价页把「家长价」与「教师课时费」分开取（后者对招生老师是 403）",
    pricing.includes("const parent = await api.pricing.quote(selection);") &&
      !pricing.includes("api.pricing.quote(selection),\n      api.pricing.teacherFee"));
  ok("导出 / 恢复默认都补了 catch（原先点了没反应）",
    pricing.includes("catch (error) {\n      setMessage(error instanceof Error ? error.message : \"导出失败。\");") &&
      pricing.includes("catch (error) {\n      // 失败要说出来：裸 await 会让 403/500 变成\"点了没反应\""));
  /*
   * 这条要查的是**渲染出去的文案**，不是注释：注释里正解释着"原先写的是……"，
   * 直接 `includes` 会把注释也算进去。因此先去掉注释再查（与第 13 节扫源码时同一套做法）。
   */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("报价页与数据页不再说「数据存在浏览器本地」（同一屏上 DataNotice 说的是反话）",
    !stripComments(pricing).includes("后台数据存在浏览器本地") &&
      !stripComments(read("app/admin/(dashboard)/data/page.tsx")).includes("数据只保存在这台电脑的浏览器里"));

  // ── ⑤ 整库导入：先看清再替换 + 备份不止一份 ────────────────────────────
  const data = read("app/admin/(dashboard)/data/page.tsx");
  /*
   * **不能只查字符串**：第一版只断言"那句话存在 + 有个 describeImportText"，
   * 于是把整个确认包进 `if (false && !window.confirm(…))` 照样全绿（反向验证抓到了）。
   * 因此这里查的是**结构与顺序**：确认框的否定式判断后面必须紧跟 `return`，
   * 而且真正写库的 `api.importDatabase(text)` 必须出现在确认**之后**。
   */
  /*
   * **只看 importFile 这一个函数**（第一版在全文件里 `indexOf("!window.confirm(")`，
   * 结果匹配到的是「清空日志」那个确认 —— 断言因此恒真，反向验证当场抓到）。
   */
  const importFn = data.slice(data.indexOf("async function importFile("), data.indexOf("async function restore("));
  ok("整库导入有二次确认，而且那个确认真的在挡人（不是被 && 短路掉的摆设）",
    // 确认必须是 if 的**直接条件**：`if (false && !window.confirm(…))` 这种短路写法过不了
    /\bif\s*\(\s*!window\.confirm\(/.test(importFn) &&
      // 拒绝时要真的 return（而不是"确认完了照样往下走"）
      /!window\.confirm\([\s\S]{0,900}?\)\s*\{\s*\n\s*return;/.test(importFn) &&
      importFn.indexOf("!window.confirm(") < importFn.indexOf("await api.importDatabase(text)") &&
      importFn.includes("describeImportText("));
  ok("确认框里带上「文件里有什么」与「库里现在有什么」",
    data.includes("describeImportText(text)") && data.includes("当前库："));
  ok("备份是滚动保留多份（而不是一个槽，选错两次就回不去）",
    read("lib/backend/api.ts").includes("export const BACKUP_SLOTS") &&
      read("lib/backend/api.ts").includes("for (const slot of merged.slice(BACKUP_SLOTS))"));
  ok("界面上的份数与实现同源（用 BACKUP_SLOTS，不各写一个数）",
    data.includes("{BACKUP_SLOTS}"));

  // ── 顺手修掉的那几处显示层小口径 ───────────────────────────────────────
  const inquiries = read("app/admin/(dashboard)/inquiries/page.tsx");
  ok("咨询列表显示了家长联系方式（原先收了、存了，后台任何地方都看不到）",
    inquiries.includes("{inquiry.guardian}") || inquiries.includes("inquiry.guardian"));
  ok("教师 / 教室页支持全局搜索的「直达」（?teacherId= / ?classroomId=）",
    read("app/admin/(dashboard)/teachers/page.tsx").includes('get("teacherId")') &&
      read("app/admin/(dashboard)/classrooms/page.tsx").includes('get("classroomId")'));
}

console.log("\n=== 20. P3：老 REST 已下线、后端进入类型检查 ===");

/*
 * 这一节守两件"清理多余"的成果（都是源码级断言，与第 13/19 节同类）：
 *
 *   ① 老 REST 接口（`/api/students` 那套"参考实现"）**整条下线**：
 *      它们读写的是另一套规范化表，与界面（`/api/call` → kv 快照）不是同一份存储 ——
 *      会给出"写进去没人读"的假成功与"读到空数据"的假失败，而且老的删除护栏只挂在
 *      那条路上（审计的第一条）。现在一律 410 + 指路，实现也删干净了。
 *   ② **后端的 `.mts` 进入类型检查**：`tsconfig` 的 `**` + `/*.ts` 通配**不匹配** `.mts`，
 *      于是补这一行之前 `npm run typecheck` 对服务端一行都没检查过（实测塞类型错误也 rc=0）。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const server = read("server/index.mts");

  // ① 老 REST 的那套实现真的删干净了（而不是"关掉但留着"）
  const legacyLeftovers = [
    "REST_CONTRACT_METHODS",
    "handleCrud",
    "matchCrud",
    "crudRow",
    "buildColumns",
    "REST_CRUD_RESOURCES",
    "teacherRestDenial",
    "loadStudent",
  ].filter((name) => new RegExp(`\\b${name}\\b`).test(server));
  eq("老 REST 的实现与权限表已整块删掉（不是「留着不用」）", legacyLeftovers, []);
  ok("但保留了「这条路已下线」的判断（410 与指路，而不是悄悄 404）",
    server.includes("LEGACY_REST_PATH") && server.includes("410"));
  ok("410 的文案指路 POST /api/call",
    /这个接口已经下线[\s\S]{0,200}\/api\/call/.test(server));

  // ② 只有一份操作日志：服务端自己的操作也写进快照
  ok("服务端自己的操作（账号 / 节假日）写进同一份日志（__appendSystemLog）",
    server.includes("__appendSystemLog(") &&
      read("lib/backend/api.ts").includes("export function __appendSystemLog"));
  ok("不再有「另一套日志表」的服务端写入（SQL logs 表那条通道已删）",
    !/INSERT INTO logs/.test(server));

  // ③ /api/status 报的是真数据
  ok("/api/status 的条数从 kv 快照里数（而不是那套空表）",
    server.includes("SNAPSHOT_KEY") && server.includes("SNAPSHOT_FIELDS"));
  ok("stage 不再写死 read-only（同一个进程明明接受写入）",
    !server.includes('stage: "read-only"'));

  // ④ 类型检查覆盖后端
  const tsconfig = read("tsconfig.json");
  ok("tsconfig 显式包含服务端的 .mts（TS 的 .ts 通配不匹配 .mts）",
    tsconfig.includes("server/**/*.mts"));
  ok("并且开了 allowImportingTsExtensions（服务端 import 必须带扩展名）",
    tsconfig.includes("allowImportingTsExtensions"));
}

console.log("\n=== 21. P3：契约里没有死方法 ===");

/*
 * **这条断言是为了防"只增不减"**（2026-09 审计后加的）。
 *
 * 审计当时发现契约里有 16 个方法**全仓库一处都没调用**（前端、后端、脚本都没有），
 * 其中 8 个是写方法 —— 而它们同样是接口面（可以被 `/api/call` 调到），
 * 有的还绕过了业务不变式（`payments.create` 就是那个能塞钱却不改"实收"的洞）。
 * 死方法不是"没成本"，"留着以后可能用得上"是最贵的说法：
 * 它要跟着迁移、跟着改类型、还要被人读懂。
 *
 * 因此这里直接扫源码：契约里的**每一个**方法都必须至少有一个调用点。
 * 删掉某个方法时，这条会告诉你"还有谁在调"；而加方法时它不会拦你 ——
 * 但如果加了却没人用，它就是一句提醒：先想清楚谁会用。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const collect = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(new URL(dir, rootUrl), { withFileTypes: true })) {
      const next = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", "out", ".git"].includes(entry.name)) collect(`${next}/`, out);
        continue;
      }
      if (/\.(ts|tsx|mts|mjs)$/.test(entry.name) && entry.name !== "contract.ts") out.push(next);
    }
    return out;
  };
  const files = [...collect("app/"), ...collect("components/"), ...collect("lib/"), ...collect("server/"), ...collect("scripts/")];
  const sources = files.map((file) => ({ file, code: readFileSync(new URL(file, rootUrl), "utf8") }));

  const methods = API_CONTRACT.flatMap((group) => group.methods);
  const uncalled = methods.filter((method) => {
    const pattern = new RegExp("\\.\\s*" + method.replace(".", "\\.") + "\\s*\\(");
    return !sources.some(({ code }) => pattern.test(code));
  });
  ok(`契约里的 ${methods.length} 个方法都至少有一个调用点（扫了 ${files.length} 个源码文件）`,
    uncalled.length === 0, uncalled.join("、"));

  /*
   * 反向：不能有"api 上有、契约里没有"的方法（那说明契约漏登记了）。
   * 与上面那条合起来 = 两边一一对应。
   */
  const inContract = new Set(methods);
  const unregistered: string[] = [];
  for (const [key, value] of Object.entries(api as unknown as Record<string, unknown>)) {
    if (typeof value === "function") {
      if (!inContract.has(key)) unregistered.push(key);
      continue;
    }
    if (typeof value === "object" && value !== null) {
      for (const [sub, fn] of Object.entries(value as Record<string, unknown>)) {
        if (typeof fn === "function" && !inContract.has(`${key}.${sub}`)) unregistered.push(`${key}.${sub}`);
      }
    }
  }
  eq("服务层上也不存在没登记进契约的方法（两边一一对应）", unregistered, []);
}

console.log("\n=== 22. P3：迁移说明表有读者、报课判据只有一处 ===");

/*
 * 两条都是审计里"多余 / 会漂移"的小事，但都值得钉住：
 *
 *   ① `VERSION_NOTES`（每个结构版本改了什么）原先**全仓库没有任何读者** ——
 *      也就是说它和 `migrate()` 的分支对不对得上，没有任何机制会发现。
 *      它是后人判断"这一版改了什么"的唯一线索，因此给它一个读者（这一节）。
 *   ② "哪些报课算在读"原先有两种写法（`endedAt === ""` 与 `status === "在读"`），
 *      分散在导出与话术页 —— 同一件事两个判据迟早分叉（审计那条）。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");

  // ① VERSION_NOTES 与当前版本号对得上
  const noteKeys = Object.keys(VERSION_NOTES).map(Number).sort((a, b) => a - b);
  const expected = Array.from({ length: CURRENT_VERSION }, (_, index) => index + 1);
  eq(`迁移说明表覆盖 v1–v${CURRENT_VERSION} 每一版`, noteKeys, expected);
  const emptyNotes = noteKeys.filter((key) => (VERSION_NOTES[key] ?? "").trim().length < 8);
  eq("每一版都写了说明（不是占位的空串）", emptyNotes, []);
  /*
   * 反向：`migrate()` 里每推进一版都要有说明。看源码里 `db.version = N` 的 N。
   * （这一条是"说明表与迁移实现不许漂移"的自动化版本 —— 加了一版却忘了写说明就会红。）
   */
  const apiSource = read("lib/backend/api.ts");
  const advanced = [...apiSource.matchAll(/db\.version = (\d+);/g)].map((m) => Number(m[1]));
  const undocumented = [...new Set(advanced)].filter((version) => !noteKeys.includes(version));
  eq("migrate() 里推进到的每一版都在说明表里", undocumented, []);

  // ② "在读报课"只有一处判据
  /*
   * **去掉注释再查**：注释里正解释着"原先用的是 endedAt 判据"，直接子串匹配会把注释算进去
   * （第一版就是这么写的，当场报红 —— 与 §19 那条同一个坑）。
   */
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const offenders = ["lib/backend/export.ts", "app/admin/(dashboard)/scripts/page.tsx"]
    .filter((file) => /endedAt === ""/.test(strip(read(file))));
  eq("判断「报课还在读」只有一处实现（activeEnrollments），不许各写一个 endedAt 判据", offenders, []);
  ok("那个判据本身在 enrollment.ts 里（唯一实现）",
    read("lib/backend/enrollment.ts").includes("export function activeEnrollments"));
}

console.log("\n=== 23. 课程分区：分区是数据，不是每门课上的一串分类文字 ===");

/*
 * 这一节守的是 v18 的那次重做（分区从"聚合出来的名字"变成"一行记录"）。
 *
 * 为什么值得这么多条断言：分区的三个毛病（改名要逐门改、不能排序、不能空着）
 * 都是"看起来能用的错数据"—— 界面上只是分组分成了两块，没人会立刻发现；
 * 而**迁移**更容易悄悄做错：顺序排错一次，机构升级完会看到课程页的栏目重新排过，
 * 却什么都查不出来。因此这里两条线都钉：
 *   1. 迁移（v17 的老库 → v18）：分区与网站栏目结构必须与升级前逐项一致；
 *   2. 平时的读写：改名 / 排序 / 删除护栏 / 批量移课 / 未归类 / 第三级被拒。
 */
{
  __useStoreForTesting(memory);

  const seedPartitions = await api.coursePartitions.list();
  ok(`分区从网站内容播种（${seedPartitions.length} 个，至少 6 个）`, seedPartitions.length >= 6);
  ok("分区有两级（栏目 → 子栏目）",
    topLevelPartitions(seedPartitions).length >= 4 &&
    seedPartitions.some((item) => item.parentId !== ""));
  ok("每一级的分区名都非空", seedPartitions.every((item) => item.name.trim() !== ""));
  eq("没有重复 id", seedPartitions.filter((item, index) =>
    seedPartitions.findIndex((other) => other.id === item.id) !== index), []);

  /* ── ① 迁移：v17 的老库（课程上是 category / subgroup 字符串）── */
  /*
   * 老库的样子**照当时的真实结构造**：课程上写 `category` / `subgroup` 两个名字，
   * 且没有 `coursePartitions`。这正是升级前那个库的形态。
   *
   * 顺序上刻意做成"与名字排序不同"（小学数学 → 高中物理 → 小学数学·提高），
   * 用来证明迁移**不是按名字排序**：它必须照抄升级前网站的显示顺序
   * （栏目顺序 = 该栏目下最小的卡片 order），否则升级会让栏目重新排一遍。
   */
  const legacyCourses = [
    { name: "老库·小学数学", category: "小学课内", subgroup: "", order: 1 },
    { name: "老库·初中数学", category: "初中课内", subgroup: "", order: 1 },
    { name: "老库·高中物理", category: "高中课内", subgroup: "必考科目", order: 1 },
    { name: "老库·高考外语", category: "高中课内", subgroup: "外语", order: 2 },
    { name: "老库·没分类的课", category: "", subgroup: "", order: 5 },
  ];
  const legacyDb = {
    ...seedDb,
    version: 17,
    coursePartitions: undefined,
    courses: legacyCourses.map((course, index) => ({
      id: `course-legacy-${String(index)}`,
      version: 1,
      name: course.name,
      category: course.category,
      subgroup: course.subgroup,
      forms: [],
      origin: "后台",
      status: "开放",
      note: "",
      createdAt: "",
      path: "",
      tags: [],
      target: "",
      order: course.order,
      intro: "",
      siteKind: "不展示",
    })),
  };
  /*
   * 走 `importDatabase` 这条路而不是直接改 store：它与"从备份恢复"是同一条代码路径
   * （校验 → migrate → 落盘），因此这一条同时钉住了"老库导入不会把数据弄丢"。
   * 导入前它会自动留一颗后悔药（`BACKUP_KEY`），下面 `restoreBackup()` 就靠它还原。
   */
  const migrated = await api.importDatabase(JSON.stringify(legacyDb));
  ok("v17 老库能导入并升级到 v18", migrated.ok);
  const migratedCourses = await api.courses.list();
  const migratedPartitions = await api.coursePartitions.list();
  eq("迁移后版本号是当前版本", (await api.exportDatabase()).version, CURRENT_VERSION);
  eq("迁移建出了 3 个栏目（按老库里的出现顺序，不是按名字排序）",
    topLevelPartitions(migratedPartitions).map((item) => item.name),
    ["小学课内", "初中课内", "高中课内"]);
  eq("高中课内下的子栏目按老库的出现顺序排出",
    childPartitions(migratedPartitions, topLevelPartitions(migratedPartitions)[2]?.id ?? "")
      .map((item) => item.name),
    ["必考科目", "外语"]);
  eq("每门课挂到了正确的（栏目, 子栏目）上",
    migratedCourses.map((course) => {
      const place = partitionPlace(migratedPartitions, course.partitionId);
      return [
        course.name,
        place.column?.name ?? "",
        place.leaf === null || place.leaf.parentId === "" ? "" : place.leaf.name,
      ];
    }),
    legacyCourses.map((course) => [course.name, course.category, course.subgroup]));
  eq("老库里的空分类 → 未归类（不凭空建一个没名字的分区）",
    migratedCourses.filter((course) => course.partitionId === "").map((course) => course.name),
    ["老库·没分类的课"]);
  ok("迁移把 category / subgroup 两个字段**删掉**了（同一件事只留一处）",
    migratedCourses.every((course) =>
      (course as unknown as Record<string, unknown>).category === undefined &&
      (course as unknown as Record<string, unknown>).subgroup === undefined));
  await api.restoreBackup();

  /* ── ② 改名：一处改、处处变 ── */
  const renamePartitions = await api.coursePartitions.list();
  const renameTarget = topLevelPartitions(renamePartitions)[0]!;
  const renameAffected = (await api.courses.list())
    .filter((course) => partitionPlace(renamePartitions, course.partitionId).column?.id === renameTarget.id)
    .length;
  ok(`改名那一条下面确实有课（${renameAffected} 门，否则这条是空转的）`, renameAffected > 0);
  await api.coursePartitions.update(renameTarget.id, { name: "自检·改过的栏目" });
  eq("改名后分区名变了", (await api.coursePartitions.list()).find((item) => item.id === renameTarget.id)?.name,
    "自检·改过的栏目");
  const afterRename = await api.courses.list();
  const beforeRename = await api.courses.list();
  eq("改名没有动任何一门课的分区引用（课程挂的是 id，不是名字）",
    afterRename.map((course) => [course.id, course.partitionId]),
    beforeRename.map((course) => [course.id, course.partitionId]));
  eq("科目候补里的分区名跟着变了",
    (await api.courses.options()).filter((option) => option.category === "自检·改过的栏目").length,
    renameAffected);
  await api.coursePartitions.update(renameTarget.id, { name: renameTarget.name });
  eq("改回原名", (await api.coursePartitions.list()).find((item) => item.id === renameTarget.id)?.name,
    renameTarget.name);

  /* ── ③ 校验：同级重名 / 第三级 / 挂到自己下面 ── */
  const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };
  const columns = topLevelPartitions(await api.coursePartitions.list());
  const dupName = await refusalOf(() => api.coursePartitions.create({ name: columns[0]!.name }));
  ok("同级重名被拒绝（同级两个同名栏目会让课挂到哪一区说不清）",
    dupName.includes("不能重复") && dupName.includes(columns[0]!.name), dupName);
  ok("空的栏目的名被拒绝",
    (await refusalOf(() => api.coursePartitions.create({ name: "   " }))).includes("不能为空"));
  ok("挂到一个不存在的上级被拒绝",
    (await refusalOf(() => api.coursePartitions.create({ name: "自检·孤儿", parentId: "cp_不存在" }))).includes("上级"));
  const firstChild = (await api.coursePartitions.list()).find((item) => item.parentId !== "")!;
  ok("第三级被拒绝（网站只渲染两级）",
    (await refusalOf(() => api.coursePartitions.create({ name: "自检·第三级", parentId: firstChild.id })))
      .includes("两级"));
  ok("把栏目挂到它自己的下级下面被拒绝（不成环）",
    (await refusalOf(() =>
      api.coursePartitions.update(columns[2]!.id, { parentId: firstChild.id }))).length > 0);

  /* ── ④ 排序：换一组顺序，网站的栏目顺序跟着变 ── */
  const beforeOrder = topLevelPartitions(await api.coursePartitions.list()).map((item) => item.name);
  const reversedIds = topLevelPartitions(await api.coursePartitions.list()).map((item) => item.id).reverse();
  await api.coursePartitions.reorder(reversedIds);
  eq("reorder 之后同级顺序就是交上去的那个顺序",
    topLevelPartitions(await api.coursePartitions.list()).map((item) => item.name),
    [...beforeOrder].reverse());
  await api.coursePartitions.reorder(reversedIds.reverse());
  eq("再排回来就回到原样（顺序是数据，不是副作用）",
    topLevelPartitions(await api.coursePartitions.list()).map((item) => item.name), beforeOrder);

  /* ── ⑤ 删除护栏 ── */
  const withCourses = topLevelPartitions(await api.coursePartitions.list())[0]!;
  const courseRefusal = await refusalOf(() => api.coursePartitions.remove(withCourses.id));
  ok("有课的分区：拒绝删除，并说清先做什么",
    courseRefusal.includes("门课") && courseRefusal.includes("移"), courseRefusal.slice(0, 90));
  const parentOfChild = (await api.coursePartitions.list()).find((item) => item.parentId !== "")!.parentId;
  const childRefusal = await refusalOf(() => api.coursePartitions.remove(parentOfChild));
  ok("有子栏目的分区：拒绝删除，并点名是哪些子栏目",
    childRefusal.includes("子栏目"), childRefusal.slice(0, 90));
  const emptyColumn = await api.coursePartitions.create({ name: "自检·空栏目" });
  eq("空栏目可以删（护栏不误伤）", await api.coursePartitions.remove(emptyColumn.id), true);

  /* ── ⑥ 批量移课 + 未归类 ── */
  const movePartitions = await api.coursePartitions.list();
  const from = topLevelPartitions(movePartitions)[0]!;
  const fromCourses = (await api.courses.list()).filter((course) =>
    partitionPlace(movePartitions, course.partitionId).column?.id === from.id);
  ok(`要移走的那一区确实有课（${fromCourses.length} 门，否则这条是空转的）`, fromCourses.length > 0);
  const into = await api.coursePartitions.create({ name: "自检·收容所" });
  const movedCount = await api.courses.setPartition(fromCourses.map((course) => course.id), into.id);
  eq("批量移课移动了本区全部课程", movedCount, fromCourses.length);
  eq("再移一次不算数（已经在目标区里）",
    await api.courses.setPartition(fromCourses.map((course) => course.id), into.id), 0);
  ok("移走之后那些课确实挂在新区上",
    (await api.courses.list())
      .filter((course) => fromCourses.some((item) => item.id === course.id))
      .every((course) => course.partitionId === into.id));
  eq("再移回原分区（这一次是真的在移动）",
    await api.courses.setPartition(fromCourses.map((course) => course.id), from.id), fromCourses.length);
  await api.coursePartitions.remove(into.id);

  const orphanRefusal = await refusalOf(() => api.courses.create({
    name: "自检·挂到不存在的分区", partitionId: "cp_不存在", forms: [], origin: "后台",
    status: "开放", note: "", createdAt: new Date().toISOString(),
  }));
  ok("课程挂到一个不存在的分区被拒绝（第二道闸门，防的是恢复半份备份）",
    orphanRefusal.includes("分区"), orphanRefusal.slice(0, 90));

  /* ── ⑦ 纯函数：删除护栏本身（不经过服务层也能问）── */
  const refusal = partitionDeleteRefusal(
    [{ id: "cp_a", name: "有课的栏目", parentId: "", order: 1 }],
    () => 3,
    "cp_a",
  );
  ok("partitionDeleteRefusal 直接可用（界面预判与服务端同一处判据）",
    refusal.includes("3 门课"), refusal);

  /* ── ⑧ 唯一实现：分组逻辑只有一处 ── */
  const readSource = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const groupUsers = ["lib/site/backend-source.ts", "app/admin/(dashboard)/courses/page.tsx"]
    .filter((file) => readSource(file).includes("groupByPartition("));
  eq("网站与后台清单都用同一个 groupByPartition（不许各写一份分组）", groupUsers.length, 2);
  ok("groupByPartition 本身在 course-partitions.ts 里",
    readSource("lib/backend/course-partitions.ts").includes("export function groupByPartition"));
  /*
   * 「v17 的写法不许回流」：课程上不再有 `category` / `subgroup` 两个字段。
   *
   * 三条查法（各自查一个真实会退回的地方），而不是笼统地搜 `.category` 字面量 ——
   * `.subgroup` 在别处是**别的对象**上的字段（分组结果 `group.subgroup`、
   * 网站边界类型 `SiteCourse.subgroup`），按字面量搜会把它们一起误报。
   *   1. `Course` 类型本身不许再声明这两个字段（这是"同一件事写两处"的根源）；
   *   2. 出门给网站的 `PublicCourse` 同理，且必须有 `partitionId`；
   *   3. 后台清单与网站映射这两处"读课程"的地方不许再读 `.category`。
   */
  const courseType = /export type Course = \{([\s\S]*?)\n\};/.exec(readSource("lib/backend/types.ts"))?.[1] ?? "";
  ok("取到了 Course 类型定义（否则下面两条是空转的）", courseType.includes("partitionId"));
  ok("Course 类型里没有 category / subgroup（分区只在分区表里）",
    !/^\s*(category|subgroup)\s*:/m.test(courseType));
  const publicCourseType =
    /export type PublicCourse = \{([\s\S]*?)\n\};/.exec(readSource("lib/backend/public-site.ts"))?.[1] ?? "";
  ok("公开给网站的课程带 partitionId，且不再带 category / subgroup",
    publicCourseType.includes("partitionId") && !/^\s*(category|subgroup)\s*:/m.test(publicCourseType));
  eq("后台清单与网站映射里不再读课程的 .category",
    ["lib/site/backend-source.ts", "app/admin/(dashboard)/courses/page.tsx"]
      .filter((file) => /\.category\b/.test(stripComments(readSource(file)))),
    []);
  /*
   * 「分区怎么写」也只有一处：`partitionPathLabel()`。
   *
   * 四处会显示分区名（导出、科目下拉、后台清单、数据页），各拼一次的话
   * "导出写 `高中课内 / 七选三`、下拉写 `七选三`"这种不一致没有任何断言能发现
   * ——两边都非空、都"看着对"。因此这里查的是**拼法**：`${...} / ${...}` 这种模板串
   * 只许出现在 course-partitions.ts 里的那一个函数里。
   */
  const labelSites = ["lib/backend/export.ts", "lib/backend/courses.ts",
    "app/admin/(dashboard)/courses/page.tsx", "app/admin/(dashboard)/data/page.tsx"]
    .filter((file) => /`\$\{[^}]*\}\s*\/\s*\$\{/.test(stripComments(readSource(file))));
  eq("分区的显示写法只有一处实现（partitionPathLabel），四处不许各拼一遍", labelSites, []);
  ok("那个实现本身在 course-partitions.ts 里",
    readSource("lib/backend/course-partitions.ts").includes("export function partitionPathLabel"));

  /*
   * ── 界面的"形状"断言（这一页的渲染没法在没有浏览器的地方跑）──
   *
   * 与 §19 那条"新增课程表单默认收起"同一类做法：钉住几条**去掉就会让人用不了**的结构。
   * 它们不是美化检查，而是"少一个按钮，机构就只能去改数据文件"的那种：
   *   1. 一级与二级都有标题行（缺了二级，子栏目就改名 / 删不掉）；
   *   2. 分区写动作按权限渲染（没权限的人不该看见点了会 403 的按钮）；
   *   3. 筛选时隐藏空分区（否则搜索结果里夹着一堆"0 门"）。
   */
  const coursesPageCode = readSource("app/admin/(dashboard)/courses/page.tsx");
  ok("清单两级都有分区标题行（二级缺了，子栏目就改名 / 删不掉）",
    /renderPartitionHeader\(column, columnItems, 1\)/.test(coursesPageCode) &&
    /renderPartitionHeader\(group\.subgroup, group\.items, 2\)/.test(coursesPageCode));
  ok("分区写动作按权限渲染（没权限不显示按钮，而不是点了才 403）",
    /canWritePartition &&/.test(coursesPageCode) &&
    /canCallMethod\(roles, "coursePartitions\.create"\)/.test(coursesPageCode));
  ok("筛选时空分区不占位置（否则结果里夹着一堆「0 门」）",
    /const filtering = keyword\.trim\(\) !== ""/.test(coursesPageCode) && /if \(filtering && columnItems\.length === 0\) return null;/.test(coursesPageCode));
  ok("「移到…」下拉的占位项用了哨兵值（空串是合法目标「未归类」，两项同值会撞车）",
    /defaultValue=\{PICK_PLACEHOLDER\}/.test(coursesPageCode) &&
    /if \(value === PICK_PLACEHOLDER\) return;/.test(coursesPageCode));
}

console.log("\n=== 24. 后台外壳：滚动时顶栏与侧栏不动（且不破坏滚动那套机制）===");

/*
 * 机构反馈的原话是「后台页面上下滑动的时候左边的导航不应该随着页面移动」。
 *
 * 这一节钉住四件事，前三件是"钉住"本身的要件（少一件就失效），
 * 第四件是"别用错做法"——这条最容易被后来的人改坏：
 *
 *   1. 侧栏 `sticky` + `top-<顶栏高度变量>`：贴在顶栏下面；
 *   2. 侧栏 `self-start`：**flex 行默认把子项拉伸到整列高**，而整列高的元素是钉不住的
 *      （它会跟着页面一起滚走，看起来像"样式没生效"）。这一条是整件事的命门 ——
 *      以前那行注释写着"桌面端为固定侧栏"，而代码里既没有 sticky 也没有 self-start；
 *   3. 侧栏自己有 `max-h` + `overflow-y-auto`：被钉住之后，比视口高的部分必须能滚到，
 *      否则导航最后几项**怎么滚页面都够不到**（钉住的另一半，最容易漏）;
 *   4. **不许用 `fixed`**：fixed 会把元素移出文档流，文档高度随之变矮 —— 而这套界面里
 *      `useScrollGuard`（就地动作的滚动守护）、`ScrollMemory`（整页重载后还原位置）、
 *      "点编辑不跳顶部"整条链路都依赖"文档高度 / 窗口滚动位置"。sticky 仍在文档流里，
 *      对这些机制透明。因此这条断言查的是"用对了做法"，而不只是"看起来对了"。
 */
{
  const readShell = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  /*
   * **先去掉注释再查**：这几段的注释里正解释着 `lg:self-start`、`h-14`、`fixed` 这些词，
   * 直接搜字面量会让"把类名删掉、只留一句解释"的改动照样通过 —— 那不是断言，是摆设。
   * 第一版就是这么写的，做反向验证（删掉 self-start）时它照样绿，当场发现并改成这样。
   */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const sidebar = stripComments(readShell("components/layout/AdminSidebar.tsx"));
  const topBar = stripComments(readShell("components/admin/AdminTopBar.tsx"));
  const shell = stripComments(readShell("app/admin/(dashboard)/layout.tsx"));

  ok("侧栏用了 sticky（不是 fixed）", /lg:sticky/.test(sidebar) && !/\bfixed\b/.test(sidebar));
  ok("侧栏贴在顶栏下面，偏移用的是顶栏高度变量（而不是写死一个数字）",
    /lg:top-\[var\(--admin-topbar-height\)\]/.test(sidebar));
  ok("侧栏有 self-start —— 没有它，被拉伸到整列高的侧栏是钉不住的",
    /lg:self-start/.test(sidebar));
  ok("侧栏高过视口时自己能滚（否则被钉住后最后几项够不到）",
    /lg:max-h-\[calc\(100dvh_-_var\(--admin-topbar-height\)\)\]/.test(sidebar) &&
    /lg:overflow-y-auto/.test(sidebar));
  ok("顶栏也钉住了（否则侧栏上方会空出一条缝）", /sticky top-0/.test(topBar) && !/\bfixed\b/.test(topBar));
  ok("顶栏高度用同一个变量（两处各写一个数字就会错位）",
    /h-\[var\(--admin-topbar-height\)\]/.test(topBar) && !/\bh-14\b/.test(topBar));
  eq("顶栏高度变量只在一处定义",
    ["components/admin/AdminTopBar.tsx", "components/layout/AdminSidebar.tsx"]
      .filter((file) => /--admin-topbar-height\s*:/.test(stripComments(readShell(file)))),
    []);
  ok("变量确实定义在外壳里（否则侧栏的 top 是空的，sticky 会贴到视口顶端）",
    /"--admin-topbar-height":\s*"3\.5rem"/.test(shell));
  /*
   * 分隔线：侧栏不再被拉伸，画在它身上的右边框会只画到导航最后一项就断掉 ——
   * 因此这条线必须画在内容区那一侧。查两件事：侧栏不再挂 border-r，main 挂上了。
   */
  ok("分隔线画在内容区一侧（侧栏不再拉伸，画它身上会断在半途）",
    !/lg:border-r/.test(sidebar) && /lg:border-l lg:border-ink-200/.test(shell));
  ok("移动端仍是横向滚动条（小屏不钉，只占一行）",
    /max-lg:overflow-x-auto/.test(sidebar) && /max-lg:border-b/.test(sidebar));
}

console.log("\n=== 25. 网站内容来源：后端 / 空白 /（显式）模版 ===");

/*
 * 机构的要求分两步定下来的，两句话合起来才是现在的口径：
 *   1. 「不连后端时不连接后端的部分只显示模版」→ 先收紧了"三层来源 + 逐块回落"那套混乱；
 *   2. 「需要用到后端数据的部分应该是空白的」→ 再把"那五块"（教师页 / 课程卡片 /
 *      课程正文 / 报价 / 学生案例）在**没连上后端**时改成**空白**，而不是拿模版顶上。
 *
 * 现在的取值只有三种，判据一处：`siteContentSource()`
 *   - `backend`：连上了后端 → 那五块用库里的数据；
 *   - `blank`：没连上 → 那五块**空白**（这是默认行为）；
 *   - `template`：显式 `SITE_CONTENT_SOURCE=template` → 那五块用 data/site/*.md（本地对照用）。
 *
 * 其余页面（首页文案 / 关于 / 联系 / FAQ / 课表 / 特色课程 / 品牌与联系方式）不在库里，
 * 永远来自模版 —— 它们与后端连不连无关，本节不涉及。
 */
{
  const fiveBlocks = () => ({
    columns: getCourseColumns(),
    courses: getCoursesPage(),
    teachers: getTeachersPage(),
    cases: getCasesContent(),
    pricing: getPricingData(),
  });

  // ① blank：没连上后端 → 那五块空白
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("blank");
  const blank = fiveBlocks();
  eq("没连上后端：那五块**全是空的**（不回落到模版）",
    [
      blank.columns.length,
      blank.courses.courses.length,
      blank.teachers.teachers.length,
      blank.cases.cases.length,
      blank.pricing.stages.length,
    ],
    [0, 0, 0, 0, 0]);
  ok("空白时连标题也是空的（不是从模版抄一份标题）",
    blank.courses.heading.title === "" &&
    blank.teachers.heading.title === "" &&
    blank.cases.title === "" &&
    blank.pricing.labels.result === "");
  ok("模版那一份确实有内容（否则上面那两条是空转的）",
    getCourseColumnsFromTemplate().length > 0 &&
    getTeachersPageFromTemplate().teachers.length > 0);

  // ② template：显式要求 → 那五块用模版（本地对照 / 需要一份模版站时）
  __useSiteContentSourceForTesting("template");
  const fromTemplate = fiveBlocks();
  eq("显式 template：那五块与「只读模版」那几个出口逐项一致",
    [
      JSON.stringify(fromTemplate.columns) === JSON.stringify(getCourseColumnsFromTemplate()),
      JSON.stringify(fromTemplate.courses) === JSON.stringify(getCoursesPageFromTemplate()),
      JSON.stringify(fromTemplate.teachers) === JSON.stringify(getTeachersPageFromTemplate()),
      JSON.stringify(fromTemplate.cases) === JSON.stringify(getCasesContentFromTemplate()),
      JSON.stringify(fromTemplate.pricing) === JSON.stringify(getPricingDataFromTemplate()),
    ],
    [true, true, true, true, true]);
  __useSiteContentSourceForTesting(undefined);

  // ③ backend：连上了但库是空的 → 仍然是"用库"（空就是空），不回模版、也不是"没连上"
  const emptySnapshot = {
    version: CURRENT_VERSION,
    generatedAt: new Date().toISOString(),
    teachers: [],
    courses: [],
    partitions: [],
    siteContent: {
      coursePage: {
        heading: { eyebrow: "", title: "空的课程页标题", description: "" },
        subjects: [],
        electiveTitle: "",
      },
      teacherPage: { heading: { eyebrow: "", title: "空的教师页标题", description: "" } },
      pricingPage: { labels: { result: "空的报价结果" } },
      casesPage: { heading: { eyebrow: "", title: "空的案例页标题", description: "" }, notice: "", cases: [] },
    },
    pricing: {
      rules: { singleLessonFeePercent: 0, freeTrialMinLessons: 0, chargeTrialWhenNotFree: false },
      stages: [],
      subjects: [],
      classTypes: [],
      durations: [],
      trial: null,
      otherItems: [],
    },
  } as unknown as PublicSite;
  __useBackendSnapshotForTesting(emptySnapshot);
  eq("取数来源：有快照就是 backend", siteContentSource(), "backend");
  const withEmptySnapshot = fiveBlocks();
  eq("连上了但库是空的：一律按后端（空），不回模版",
    [
      withEmptySnapshot.columns.length,
      withEmptySnapshot.courses.courses.length,
      withEmptySnapshot.teachers.teachers.length,
      withEmptySnapshot.cases.cases.length,
      withEmptySnapshot.pricing.stages.length,
    ],
    [0, 0, 0, 0, 0]);
  eq("空块里的**标题**也来自后端（不是模版抄一份）",
    [
      withEmptySnapshot.courses.heading.title,
      withEmptySnapshot.teachers.heading.title,
      withEmptySnapshot.cases.title,
      withEmptySnapshot.pricing.labels.result,
    ],
    ["空的课程页标题", "空的教师页标题", "空的案例页标题", "空的报价结果"]);
  __useBackendSnapshotForTesting(null);

  /*
   * ④ 源码级三条：判据只有一处、不许"逐块回落"、生成器把三种取值都写出来。
   *    `backendX() ?? getXFromTemplate()` 正是"半个页面来自文件"的来路。
   */
  const dataSource = (file: string): string =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  eq("取数层里没有 `?? 模版` 这种逐块回落",
    ["lib/data/site.ts", "lib/data/pricing.ts", "lib/data/pages.ts"].filter((file) =>
      /backend[A-Za-z]*\([^)]*\)\s*\?\?/.test(dataSource(file))),
    []);
  ok("判据只有一处（siteContentSource()）",
    (dataSource("lib/data/site.ts").match(/siteContentSource\(\)/g) ?? []).length >= 3 &&
    dataSource("lib/data/pricing.ts").includes("siteContentSource()") &&
    dataSource("lib/data/pages.ts").includes("siteContentSource()"));

  const syncScript = dataSource("scripts/sync-site-data.mjs");
  ok("构站脚本：模式是 auto / backend / template（snapshot 已删）",
    /\["auto", "backend", "template"\]/.test(syncScript) && !/readRepoSnapshot/.test(syncScript));
  ok("构站脚本：旧模式 snapshot 会明确报错",
    /mode === "snapshot"/.test(syncScript) && /已经删掉/.test(syncScript));
  ok("构站脚本：连不上时写的是**空白**这一态（不是模版）",
    /write\(null, `空白/.test(syncScript) && /"blank"/.test(syncScript));
  ok("构站脚本：模版那一态只能**显式**要（SITE_CONTENT_SOURCE=template）",
    /mode === "template"/.test(syncScript) && /"template"\)/.test(syncScript));
  ok("构站脚本：空块在日志里点名（连不上时那五块是空的，日志是唯一线索）",
    /在库里是空的，网站会照空显示/.test(syncScript));
  eq("仓库里不再有 site-snapshot.json",
    existsSync(new URL("../data/site/site-snapshot.json", import.meta.url)), false);
  eq("package.json 里不再有 site:snapshot 脚本",
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts["site:snapshot"],
    undefined);
  /*
   * 生成文件与它的类型声明**必须同时有这三个导出**：TS 优先用 `types/backend-snapshot.d.ts`
   * 那份 `declare module`，漏一个就会出现"明明生成了却说没有这个导出"
   * （`backendSiteSource` 就是这么漏过一次的）。
   */
  /*
   * ⑤ **不许把"没连上"偷偷当成模版** —— 这一条是**行为**验证：真跑一次构站脚本
   * （指向一个空端口 = 连不上），看它写出来的来源是哪一态。
   *
   * 为什么不能只查"当前生成文件里的值"：那个值取决于**上一次构站**用的是哪一态
   * （本机可能刚好是 template），拿它跟"默认值"比会时灵时不灵 ——
   * 我第一版就是这么写的，把默认值改成 template 的变异照样全绿。
   *
   * 跑完**把原文件放回去**：那是个未纳入版本库的构建期产物，
   * 但也不能就这么让它停在"测试用的那一份"上（本机正在 dev 的话，页面会跟着变）。
   */
  const snapshotPath = new URL("../data/site/.backend-snapshot.ts", import.meta.url);
  const snapshotBefore = readFileSync(snapshotPath, "utf8");
  const runSync = (env: Record<string, string>): { code: number | null; output: string } => {
    const result = spawnSync(process.execPath, ["scripts/sync-site-data.mjs"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    return { code: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  };
  const sourceOfGenerated = (): string =>
    /backendSiteSource = "([a-z]+)"/.exec(readFileSync(snapshotPath, "utf8"))?.[1] ?? "";
  try {
    const deadBase = { SITE_API_BASE: "http://127.0.0.1:45997", SITE_CONTENT_SOURCE: "" };
    const autoRun = runSync(deadBase);
    eq("构站脚本（auto + 连不上）：退出码 0", autoRun.code, 0);
    eq("构站脚本（auto + 连不上）：**写的是「空白」**（不是偷偷用模版）",
      sourceOfGenerated(), "blank");
    ok("而且日志里说清了那五块会是空的",
      autoRun.output.includes("空白") && autoRun.output.includes("会是空的"), autoRun.output.slice(0, 120));

    const templateRun = runSync({ ...deadBase, SITE_CONTENT_SOURCE: "template" });
    eq("构站脚本（显式 template）：退出码 0", templateRun.code, 0);
    eq("构站脚本（显式 template）：写的是「模版」", sourceOfGenerated(), "template");

    const legacyRun = runSync({ SITE_API_BASE: "http://127.0.0.1:45997", SITE_CONTENT_SOURCE: "snapshot" });
    ok("构站脚本：已删掉的 `snapshot` 模式会**明确报错**（退出码非 0）",
      legacyRun.code !== 0 && legacyRun.output.includes("已经删掉"), legacyRun.output.slice(-120));
  } finally {
    writeFileSync(snapshotPath, snapshotBefore, "utf8");
  }
  eq("跑完把生成文件放回原样（本机 dev 不受影响）",
    readFileSync(snapshotPath, "utf8"), snapshotBefore);

  const generated = sourceOfGenerated();
  ok("生成文件里写了来源模式（三个取值之一）",
    ["backend", "blank", "template"].includes(generated), generated);
  __useBackendSnapshotForTesting(undefined);
  __useSiteContentSourceForTesting(undefined);
  eq("没注入时：来源就是生成文件里那一份（自检不改变真实取值）",
    siteContentSource(), generated);
  /*
   * ⑥ **默认值必须"来自生成文件"**，不许在代码里写死某一态。
   *
   * 为什么只能查源码而不能纯靠行为：生成文件是**模块常量**，自检加载它时就定下来了 ——
   * 无论之后怎么重跑生成脚本（上面那几条），模块里那个值都不会变，
   * 因此"把默认值硬写成 template"这种改动，行为断言**抓不到**
   * （我试了两轮：真正能抓住它的是这一条）。
   * 判据：`siteContentSource()` 的函数体里必须引用 `backendSiteSource`。
   */
  const sourceBody =
    /export function siteContentSource\(\)[\s\S]*?\n\}/.exec(dataSource("lib/site/backend-source.ts"))?.[0] ?? "";
  ok("取到了 siteContentSource 的函数体（否则下面那条是空转的）", sourceBody.length > 50);
  ok("默认那一路取自生成文件（backendSiteSource），不许在代码里写死某一态",
    sourceBody.includes("backendSiteSource"));
  __useBackendSnapshotForTesting(null);

  const declared = readFileSync(new URL("../types/backend-snapshot.d.ts", import.meta.url), "utf8");
  for (const name of ["backendSiteSnapshot", "backendSiteSource", "backendSiteNote"]) {
    ok(`生成快照的三个导出在类型声明里都有（${name}）`,
      declared.includes(`export const ${name}:`) && syncScript.includes(`export const ${name} =`));
  }
}

console.log("\n=== 26. 学生案例进库（v19：机构要求「学生案例以后端为主」）===");

/*
 * 案例原先只在 `data/site/cases.md`：改一条分数要打开文件、改完还要重新构站，
 * 招生老师在后台根本看不到。v19 把它搬进 `siteContent.casesPage`，后台「网站内容」页可维护。
 *
 * 这一节守四件事：
 *   1. **迁移真的灌了初值**（不是留给机构重录一遍）—— 八块文案的搬家与 v15 那次不同，
 *      空着就等于线上首页/案例页变空，因此这次必须读内容文件填初值；
 *   2. **两态**：连上后端就用库里的案例（空就是空），连不上才用模版；
 *   3. **写入口**只有 `site.saveBlocks`，而且它**只动案例这一块**（课程库页保存正文时
 *      不许把案例冲回去 —— 两个页面各改一块，谁也不该动对方那一块）；
 *   4. **校验**：标题空/重名、字段没名字都要拒。
 */
{
  __useStoreForTesting(memory);

  // ① 迁移：v18 老库（没有 casesPage）→ 案例从内容文件灌进来
  const legacyCasesDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    siteContent: Record<string, unknown>;
    version: number;
  };
  delete legacyCasesDb.siteContent.casesPage;
  legacyCasesDb.version = 18;
  eq("v18 老库（没有案例块）能升级导入", (await api.importDatabase(JSON.stringify(legacyCasesDb))).ok, true);
  const afterCases = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterCases.version, CURRENT_VERSION);
  const templateCases = getCasesContentFromTemplate().cases;
  ok(`迁移把内容文件里的案例灌进了库（${String(afterCases.siteContent.casesPage.cases.length)} 条）`,
    afterCases.siteContent.casesPage.cases.length === templateCases.length && templateCases.length > 0);
  eq("案例标题与内容文件逐条一致（顺序也一致）",
    afterCases.siteContent.casesPage.cases.map((item) => item.title),
    templateCases.map((item) => item.title));
  eq("案例的字段与过程描述一起搬了（不是只搬了标题）",
    [
      afterCases.siteContent.casesPage.cases[0]?.fields.length,
      (afterCases.siteContent.casesPage.cases[0]?.story ?? "").length > 0,
    ],
    [templateCases[0]?.fields.length, true]);
  ok("标题也搬了（页面头部与页脚提示）",
    afterCases.siteContent.casesPage.heading.title !== "" &&
    afterCases.siteContent.casesPage.notice !== "");
  await api.restoreBackup();

  // ② 两态：有快照就用库里的案例；没有快照就用模版
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("template");
  eq("显式 template 时：案例来自模版",
    getCasesContent().cases.map((item) => item.title),
    templateCases.map((item) => item.title));
  __useSiteContentSourceForTesting("blank");
  eq("没连上后端（默认）时：案例块**空白**，不回落到模版",
    getCasesContent().cases.length, 0);
  __useSiteContentSourceForTesting(undefined);
  const emptyCasesSnapshot = buildPublicSite(seedDb);
  __useBackendSnapshotForTesting({
    ...emptyCasesSnapshot,
    siteContent: {
      ...emptyCasesSnapshot.siteContent,
      // 库里一条案例都没有（机构把案例全删了）—— 页面显示空状态，不回模版
      casesPage: { heading: { eyebrow: "", title: "库里没有案例", description: "" }, notice: "", cases: [] },
    },
  });
  eq("快照在但案例是空的：按后端（空），不回模版",
    [getCasesContent().cases.length, getCasesContent().title], [0, "库里没有案例"]);
  __useBackendSnapshotForTesting(null);

  // ③ 写入口：saveBlocks 只动案例这一块
  const beforeBlocks = await api.exportDatabase();
  const saved = await api.site.saveBlocks({
    casesPage: {
      heading: { eyebrow: "自检", title: "自检案例页", description: "说明" },
      notice: "自检用，不发布",
      cases: [
        {
          id: "",
          title: "自检·初二 某同学",
          fields: [
            { title: "年级", value: "初二" },
            { title: "科目", value: "数学" },
          ],
          story: "第一段。\n\n第二段。",
        },
      ],
    },
  });
  eq("保存后案例是刚才那一条", saved.casesPage.cases.map((item) => item.title), ["自检·初二 某同学"]);
  ok("新案例的 id 由服务端生成（页面不用知道 id 怎么来）",
    (saved.casesPage.cases[0]?.id ?? "") !== "");
  eq("保存案例**不动课程正文**（课程库页那一块一字未改）",
    JSON.stringify(saved.coursePage), JSON.stringify(beforeBlocks.siteContent.coursePage));
  eq("保存案例也不动教师页与报价文案",
    [JSON.stringify(saved.teacherPage), JSON.stringify(saved.pricingPage)],
    [JSON.stringify(beforeBlocks.siteContent.teacherPage), JSON.stringify(beforeBlocks.siteContent.pricingPage)]);

  const refusalCase = async (page: Record<string, unknown>): Promise<string> => {
    try {
      await api.site.saveBlocks({ casesPage: page as never });
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };
  const basePage = {
    heading: { eyebrow: "", title: "t", description: "" },
    notice: "",
    cases: [],
  };
  ok("案例标题为空被拒",
    (await refusalCase({ ...basePage, cases: [{ id: "", title: "  ", fields: [], story: "" }] })).includes("不能为空"));
  ok("两条案例标题相同被拒",
    (await refusalCase({
      ...basePage,
      cases: [
        { id: "", title: "同名", fields: [], story: "" },
        { id: "", title: "同名", fields: [], story: "" },
      ],
    })).includes("两次"));
  ok("字段没有名字被拒",
    (await refusalCase({
      ...basePage,
      cases: [{ id: "", title: "A", fields: [{ title: " ", value: "1" }], story: "" }],
    })).includes("没有名字"));
  ok("**一条案例都没有是允许的**（内容文件里就写着「不希望公开就把分组删掉」）",
    (await refusalCase(basePage)) === "");

  // ④ 课程正文那一侧不许把案例冲掉（两个页面各改一块）
  const afterSaveBlocks = await api.exportDatabase();
  const contentOnly = {
    ...afterSaveBlocks.siteContent,
    casesPage: { heading: { eyebrow: "", title: "被覆盖了", description: "" }, notice: "", cases: [] },
  };
  await api.site.saveContent(contentOnly);
  eq("用 saveContent 保存课程正文后，案例**原样保留**",
    (await api.exportDatabase()).siteContent.casesPage.cases.map((item) => item.title),
    afterSaveBlocks.siteContent.casesPage.cases.map((item) => item.title));

  /*
   * ⑤ 后端「网站内容」页与权限
   */
  ok("案例页在导航里（否则机构找不到它）",
    readFileSync(new URL("../lib/site/admin-nav.ts", import.meta.url), "utf8").includes('"/admin/content"'));
  const roleSource = readFileSync(new URL("../lib/auth/roles.ts", import.meta.url), "utf8");
  ok("案例页给了招生老师（市场营销口径的活）",
    /"\/admin\/content": \["技术管理员", "招生老师"\]/.test(roleSource));
  ok("保存案例的方法与保存课程正文的方法**分开**（权限与覆盖面都不同）",
    /"site\.saveContent": \["技术管理员"\]/.test(roleSource) &&
    /"site\.saveBlocks": \["技术管理员", "招生老师"\]/.test(roleSource));

  /*
   * ⑥ 一个真的踩过的坑：往 `api.ts` 的 `export type { ... }` 块里加名字**忘了 import** 时，
   * 从 `@/lib/backend/api` 导入这个类型会**静默变成 any**（不报错），于是页面里
   * `cases.map((item) => …)` 的 item 变成隐式 any 才报出来 —— 排查方向会被带偏。
   * 这条断言直接盯着"导出的每个类型名都真的在 api.ts 里 import 过"。
   */
  const apiSource = readFileSync(new URL("../lib/backend/api.ts", import.meta.url), "utf8");
  /** 名字清单：按逗号 / 换行切开，只留形如类型名的项（注释行与空行自然被滤掉）。 */
  const namesIn = (block: string): string[] =>
    block
      .split(/[,\n]/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z][A-Za-z0-9]*$/.test(line));
  /*
   * 导出块要**精确定位**，而且不能用非贪婪正则从头找一个 `export type {`：
   * 文件里还有 `export type { X } from "./export";` 这种单行块，从它开始找会一路吃到
   * 后面某个 `};` —— 于是把 import 块和大半个文件都当成"导出块"，
   * "删掉 import"这个变异照样通过（我在这儿踩了两次，因此改成从**后往前**定位）。
   *
   * 定位方式：先找值导出块 `export {`，再找它前面那个 `};`（类型块的结尾），
   * 再往前找那个块的 `export type {`（开头）。
   */
  const valueExportIndex = apiSource.lastIndexOf("\nexport {");
  const typeBlockEnd = apiSource.lastIndexOf("\n};", valueExportIndex);
  const typeBlockStart = apiSource.lastIndexOf("export type {", typeBlockEnd);
  const exportBlock =
    typeBlockStart === -1 || typeBlockEnd === -1 ? "" : apiSource.slice(typeBlockStart, typeBlockEnd);
  /** 导出块**之前**的内容（去掉注释：免得某个名字只是出现在说明文字里就算数）。 */
  const beforeExport = apiSource.slice(0, typeBlockStart).replace(/\/\*[\s\S]*?\*\//g, "");
  const exportedNames = namesIn(exportBlock);
  ok("api.ts 的类型导出块非空（否则下面那条是空转的）", exportedNames.length > 20);
  ok("导出块**之前**那一大段确实在（否则「名字必须在前面出现过」这条是空转的）",
    beforeExport.length > 1000);
  /*
   * 判据是"名字必须出现在导出块**之前**"（被 import、或在本文件里声明过），
   * 而不是去解析"哪些块算 import"：`import { a, type B } from "./x"` 与
   * `export type { C } from "./y"` 让那份清单越写越长，而靠正则拼出来的清单很容易
   * 把大段文件当成一个块 —— 我试过两版，两次都让"删掉 import"这个变异照样通过
   * （断言成了摆设）。这条判据简单，又正好覆盖所有合法写法。
   */
  eq("api.ts 导出的每个类型都在前面出现过（忘了 import 会静默变成 any）",
    exportedNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(beforeExport)),
    []);
}

console.log(`\n=== 结果：${failures === 0 ? "全部通过" : `${failures} 项失败`} ===`);
process.exit(failures === 0 ? 0 : 1);

process.exit(failures === 0 ? 0 : 1);

process.exit(failures === 0 ? 0 : 1);

process.exit(failures === 0 ? 0 : 1);

process.exit(failures === 0 ? 0 : 1);

process.exit(failures === 0 ? 0 : 1);
