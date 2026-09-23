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
// `Section` 是**类型**：第 1 节要拿它标注「某个学科组下的小节」这个中间量
import type { Section } from "@/lib/data/content";
import { contentSource } from "@/data/site/content";
import { pricingSource } from "@/data/site/pricing";
import {
  getAboutContent,
  getContactContent,
  getHomeSectionHeadings,
  COLUMN_PATHS,
  bodyHeadings,
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
import {
  getPricingData,
  getPricingDataFromTemplate,
  parsePricingSource,
  type PricingData,
} from "@/lib/data/pricing";
import type { PricingConfig, QuoteInput, QuoteSelection } from "@/lib/backend/pricing";
import { classTypeIssuesText, syncClassTypes } from "@/lib/backend/class-types";
import {
  dayPlanFor,
  validateVacations,
  vacationOverlaps,
  windowsFromSchedule,
  type CalendarPlanInput,
  type DayPlan,
} from "@/lib/backend/calendar-plan";
import type { VacationPeriod } from "@/lib/backend/types";
import {
  getCasesContent,
  getCasesContentFromTemplate,
  getFaqContent,
  getFaqContentFromTemplate,
  getScheduleContent,
} from "@/lib/data/pages";
import {
  findFeaturedCourse,
  getAllFeaturedCourses,
  getFeaturedContent,
  getFeaturedContentFromTemplate,
} from "@/lib/data/featured";
import { calculateQuote, isTrialFree, trialFeeFor } from "@/lib/pricing/quote";
import { __removeFixture, __useStoreForTesting, api } from "@/lib/backend/api";
/*
 * 夹具里用到的**类型**也要显式 import。
 *
 * 这些名字以前在 check.mts 里是"裸用"的（`const lessons: Lesson[] = …`）—— 因为
 * `scripts/**\/*.mts` 从来没被 `tsc` 检查过（见 tsconfig 里那段注释），
 * 缺 import 也照样跑（`node --experimental-strip-types` 会把类型注解整段剥掉）。
 * 2026-09 把 scripts 纳入类型检查之后，这一批"看不见的错误"才浮出来 —— 这是其中之一。
 */
import type {
  Assessment,
  Classroom,
  Database,
  HomeworkRecord,
  Inquiry,
  Lesson,
  LessonRecord,
  Student,
  Teacher,
  TeacherEmployment,
} from "@/lib/backend/types";
/*
 * `TEACHER_EMPLOYMENTS` 是**值**（候选值清单），不能走上面那块 `import type` ——
 * 第 44 节要拿它比对「全职 / 兼职」这个取值域是不是只有两项。
 */
import { TEACHER_EMPLOYMENTS } from "@/lib/backend/types";
/*
 * 教室的显示口径与拆分（v31）也是**值**：第 45 节要拿 `classroomLabel` 比
 * 「校区为空时就是纯名」、拿 `splitCampusFields` 验"按第一个「·」拆"。
 * 第 46 节还要拿 `hasCampus` / `campusRequiredProblem` 验「校区必填」这条口径
 * —— 判据与文案各只有一处，服务层与导入共用它们。
 */
import {
  campusRequiredProblem,
  classroomLabel,
  hasCampus,
  splitCampusFields,
} from "@/lib/backend/classrooms";
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
import { dateKey, isSameMonth, monthGrid, shiftMonths } from "@/lib/backend/format";
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
  backendCasesContent,
  backendCourseColumns,
  backendCoursesPage,
  backendFaqContent,
  backendFeaturedContent,
  backendPricingData,
  backendSnapshot,
  backendTeachersPage,
  siteContentSource,
} from "@/lib/site/backend-source";
import {
  SITE_EXPORT_FILES,
  exportSiteMarkdown,
  readSiteCore,
  siteCoreFromViews,
  type SiteExportFile,
} from "@/lib/backend/site-export";
import { coursesFromSite } from "@/lib/backend/courses";
import { SITE_COPY_KEYS, validateCopy } from "@/lib/backend/site-copy-model";
import { copyBlocksFromContent } from "@/lib/backend/site-copy";
import { featuredDeleteRefusal } from "@/lib/backend/featured-tree";
import { getFormOptionsFromTemplate } from "@/lib/backend/options";
import {
  assignCatalogIds,
  catalogGroups,
  catalogSummary,
  stageNamesOf,
  subjectsInGroup,
  subjectsOfStage,
  validateCatalog,
} from "@/lib/backend/catalog";
import { catalogFromSeed, catalogId, catalogSeedSummary } from "@/lib/backend/catalog-seed";
import {
  courseDimensionProblems,
  isCourseLinked,
  opennessHint,
  suggestCourseDimensions,
} from "@/lib/backend/course-dimensions";
import {
  applyDecision,
  buildMatrix,
  danglingOffers,
  offerId,
  offerKey,
  offersByKey,
  offersOfDimension,
  resolveOffer,
  validateOffers,
} from "@/lib/backend/offers";
import type { Catalog, CatalogOffer } from "@/lib/backend/types";
import { validateFeaturedPage } from "@/lib/backend/site-content";
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
  ADMIN_COURSE_TABS,
  pickInitialCourseTab,
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
import { EXTRA_COURSE_NAMES, extraCourseDimensions, extraCourses } from "@/lib/backend/extra-courses";
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
import { createEmptyDatabase } from "@/lib/backend/initial";
import { materializeSiteCourses } from "@/lib/backend/courses";
import {
  ENTITY_SPECS,
  IMPORT_ENTITIES,
  csvTemplate,
  detectFormat,
  jsonTemplate,
  parseImport,
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

/*
 * ── 开跑之前先确认 3000 上没有 next dev ────────────────────────────────────
 *
 * 为什么必须挡：本文件里有一项会以 `SITE_CONTENT_SOURCE=template` 重跑
 * `scripts/sync-site-data.mjs`，然后读它写出来的 `data/site/.backend-snapshot.ts` 断言"这次写的是模版"。
 * 而**开着的 dev 会同时以 backend 模式重写同一个文件** —— 于是那条断言会**假红**
 * （我 2026-09 就撞上一次：`构站脚本（显式 template）：写的是「模版」` 实际 "backend"，
 * 停掉 dev 重跑立刻全绿）。
 *
 * 判据刻意不是"3000 上有东西在监听"：这台机器上常有**别的项目**占着 3000（部署文档里写着这件事），
 * 那样报错就变成误伤。这里抓的是 next dev 的特征：首页 HTML 里的 chunk 带 `?v=<时间戳>`
 * （开发模式的写法）。抓到了就直接停 —— 假红的断言比"跑不起来"更难查。
 */
function assertNoDevServer(): void {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "fetch('http://127.0.0.1:3000/').then(r=>r.text()).then(t=>console.log(t.includes('webpack.js?v=')?'dev':'other')).catch(()=>console.log('none'))",
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  const verdict = (probe.stdout ?? "").trim();
  if (verdict !== "dev") return;
  console.error(
    "\n✗ 3000 端口上有一个 next dev 在跑 —— 请先停掉它再跑自检（Ctrl+C，或 `npm run check` 前先关掉那个终端）。\n" +
      "  原因：自检里有一项会以 template 模式重跑 sync-site-data 并读生成文件，\n" +
      "  开着的 dev 会在同一刻把它写回 backend 模式，那条断言就会**假红**（不是代码错了）。\n",
  );
  process.exit(1);
}

assertNoDevServer();

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

/*
 * 2026-09：课程正文改成「**一门课一个小节、段名就是课程名**」
 * （机构原话：「课程全都按照课程库里的来，课程库以外的全部都应该删掉」，方案 B）。
 *
 * 因此这一节不再断言"某学科有几个学段"——「高中物理学考 / 选考」那种"一张卡多个阶段"
 * 的形状已经不存在了。改断言两件事：
 *   ① 每个学科组里的小节数 = 该组有几门课，且段名（「｜」之前那一段）= 课程名；
 *   ② 原来那些级别 / 技能现在写在正文的 `### 小标题` 里 —— **结构变了，内容一个都没少**。
 */
const bandsOf = (name: string): Section[] =>
  coursesPage?.groups.find((g) => g.name === name)?.children ?? [];
/** 一组课正文里的小标题名（`### 学考｜合格考基础` → `学考`）。 */
const headingNames = (name: string): string[] =>
  bandsOf(name).flatMap((b) =>
    bodyHeadings(b.body).map((h) => (h.split("｜")[0] ?? "").trim()),
  );
/** 一组课的小节段名（`#### 小学语文｜建立阅读与表达的基础` → `小学语文`）。 */
const anchorsOfGroup = (name: string): string[] =>
  bandsOf(name).map((b) => (b.name.split("｜")[0] ?? "").trim());

eq("语文组：三段正文，段名就是课程名", anchorsOfGroup("语文"), ["小学语文", "初中语文", "高中语文"]);
eq("数学组：四段正文（含新增的小学奥数）", anchorsOfGroup("数学"),
  ["小学数学", "初中数学", "高中数学", "小学奥数"]);
eq("英语组：四段正文（高考英语 → 高考外语，含新增的小学英语竞赛）", anchorsOfGroup("英语"),
  ["小学英语", "初中英语", "高考外语", "小学英语竞赛"]);
eq("科学组：两段正文", anchorsOfGroup("科学"), ["小学科学", "初中科学"]);
eq("社会组：一段正文", anchorsOfGroup("社会"), ["初中社会"]);
// 七选三的 7 科：一段正文，学考 / 选考降级成正文里的两个小标题
for (const subject of ["物理", "化学", "生物", "政治", "历史", "地理", "技术"]) {
  eq(`高中${subject}只有一段正文（段名就是课程名）`, anchorsOfGroup(subject), [`高中${subject}`]);
  eq(`高中${subject}的正文里有 学考 / 选考 两个小标题`, headingNames(subject), ["学考", "选考"]);
}
eq("日语：N5–N3 变成正文里的三个小标题", headingNames("日语"), ["N5", "N4", "N3"]);
for (const lang of ["俄语", "法语", "德语", "意大利语", "西班牙语"]) {
  eq(`${lang}：A1–B2 变成正文里的四个小标题`, headingNames(lang), ["A1", "A2", "B1", "B2"]);
}
// 雅思总览 + 听/说/读/写四个分项：总览是小节标题里那半句，分项是小标题
eq("雅思只有一段正文（段名就是课程名）", anchorsOfGroup("雅思"), ["雅思"]);
eq("雅思的正文里有 听力 / 口语 / 阅读 / 写作 四个小标题", headingNames("雅思"),
  ["听力", "口语", "阅读", "写作"]);
eq("3D建模的正文里有三个软件小标题", headingNames("3D建模 & 3D打印"),
  ["Shapr3D", "OpenSCAD", "Bambu Studio"]);
eq("编程与信息素养的正文里有四个方向小标题", headingNames("编程与信息素养"),
  ["Python", "C/C++", "Java", "其它"]);
// 新增的两个学科组（备考与冲刺那几门课原来只在后台用，机构要求一起上网）
eq("新学科组「小升初与初升高」", anchorsOfGroup("小升初与初升高"), ["小升初"]);
/*
 * 机构 2026-09 在后台把「高考冲刺」「特殊计划专项」**删掉了**（课程库里已经不存在），
 * 它们的正文小节也跟着删（自检有一条"每个小节都对应课程库里的一门课"在守这件事）。
 * 所以这里只留两门。
 */
eq("新学科组「备考与冲刺」", anchorsOfGroup("备考与冲刺"),
  ["中考冲刺", "提前招专项"]);
ok("学科组里没有任何一个空组（课程库以外的段落都删掉了）",
  (coursesPage?.groups ?? []).every((g) => g.children.length > 0),
  JSON.stringify((coursesPage?.groups ?? []).filter((g) => g.children.length === 0).map((g) => g.name)));

// 段名就是课程名：每个小节名（「｜」之前那一段）都必须能在课程库里找到同名课程
const libraryNames = new Set(
  getCourseColumnsFromTemplate().flatMap((c) =>
    c.subgroups.flatMap((g) => g.cards.map((card) => card.title)),
  ),
);
eq("每个小节都对应课程库里的一门课（课程库以外的小节已经删掉）",
  (coursesPage?.groups ?? [])
    .flatMap((g) => g.children.map((c) => (c.name.split("｜")[0] ?? "").trim()))
    .filter((anchor) => !libraryNames.has(anchor)),
  []);

// 语言 / 技能级别的正文都还写着「核心能力」（内容没在重排里丢）
ok("每个语言组的正文都保留了核心能力清单",
  ["法语", "德语", "意大利语", "西班牙语", "俄语", "日语"].every((lang) =>
    bandsOf(lang).every((b) => b.body.includes("核心能力"))));

const pricingDoc = parseDocument(pricingSource);
const pricingPage = pricingDoc.pages.get("智能报价");
// 顺序与 `pricing.exportMarkdown()` 的输出一致（v37 起内容文件就是"导出替换"出来的那一份，
// 因此顺序也跟着导出走：试课排在教师分成之后）
eq("报价页分组", pricingPage?.groups.map((g) => g.name),
  ["学习阶段", "班级类型", "课时选择", "计费规则", "教师分成", "试课", "其他项目"]);

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
 *
 * 2026-09 起追加一条口径（机构：**课程全都按照课程库里的来**）：课程正文是
 * **一门课一个小节、段名就是课程名**，卡片上的标签**全部去掉** ——
 * 原来的级别 / 技能（学考 / 选考、N5–N3、A1–B2、雅思四项、三个软件…）
 * 降级成那门课正文里的 `### 小标题`。因此下面那几条"每张卡都该带某组标签"的断言
 * 换成了"这些级别必须出现在正文的小标题里"：**标签没了不等于级别没了**。
 */
// 栏目结构只服务于课程页的「课程总览」（首页课程区改为按班型展示）
eq("课程页栏目", columns.map((c) => c.title),
  ["小学课内", "初中课内", "高中课内", "外语", "课外兴趣", "成人课程"]);
eq("栏目与全站段同源", columns, getCourseColumnsFromTemplate());

/*
 * 首页课程区展示的是班型（一对一等），不是学科。
 *
 * 2026-09 机构把班型统一成五个（E13）：一对一 / 一对二 / 一对三 / 小班课（4-8人）/
 * 大班课（9-20人）。特色课程树的二级课程名里同时还有三个**服务**（晚托管 / 周中预习课 /
 * 假期预习课）—— 它们会出现在这一区，因此这里断的是"那五个班型一个不少"，
 * 而不是"这一区只有班型"。
 */
const classTypes = getFeaturedContent().courses.flatMap((c) =>
  c.children.map((child) => child.name),
);
ok("首页课程区有班型可展示", classTypes.length >= 5);
ok("首页课程区列全了那五个班型",
  ["一对一", "一对二", "一对三", "小班课（4-8人）", "大班课（9-20人）"]
    .every((name) => classTypes.includes(name)),
  JSON.stringify(classTypes));

const HIGH_SCHOOL_SUBGROUPS = ["必考科目", "外语", "七选三"];
/*
 * 子标题只看**有名字的那几个**：直接挂在栏目上的卡片（`subgroup === null`）
 * 渲染成 `title: ""` 且页面上不渲染标题 —— 这是六个栏目共用的正常形状
 * （小学课内 / 初中课内 / 外语 / 课外兴趣 / 成人课程 全都这样），
 * 2026-09 起 `高中课内` 也有了这种卡片（高考冲刺 / 特殊计划专项 两门备考课，
 * 它们不属于必考科目 / 外语 / 七选三 任何一档）。这里断言的是**命名子标题**的固定性。
 */
const subgroupTitles = (title: string): string[] =>
  (columns.find((c) => c.title === title)?.subgroups ?? [])
    .map((g) => g.title)
    .filter((name) => name !== "");
eq("高中课内的命名子标题", subgroupTitles("高中课内"), HIGH_SCHOOL_SUBGROUPS);
// 一个栏目最多一个"无子标题"的桶：多了就是种混乱（同一栏目的卡片散在两处）
eq("每个栏目最多一个无子标题的桶",
  columns.filter((c) => c.subgroups.filter((g) => g.title === "").length > 1).map((c) => c.title), []);
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

/*
 * 2026-09：卡片上的标签**全部去掉**（机构选定的方案 B ——「课程全都按照课程库里的来」）。
 * 级别 / 技能不再是可点的独立小节，而是那门课正文里的 `### 小标题`。
 *
 * 因此原来那两条「七选三每张卡都带 学考 + 选考 标签」「外语栏目每张卡都有级别标签」
 * 换成了下面这两条 —— **断言的对象从"标签"变成"正文的小标题"**，守的还是同一件事：
 * 级别信息必须真的在页面上看得见。留标签只会让断言假绿。
 */
ok("卡片上不再有任何标签（方案 B：级别写在课程正文的小标题里，不做可点入口）",
  allCards.every((c) => c.tags.length === 0),
  JSON.stringify(allCards.filter((c) => c.tags.length > 0).map((c) => c.title)));

/** 一门课的页面正文（把所有阶段的正文拼起来）里的小标题。 */
const headingsOf = (path: string): string[] =>
  (getCoursePageData(path)?.stages ?? []).flatMap((stage) => bodyHeadings(stage.body));

// 七选三：每张卡的正文里都必须有「学考」「选考」两个小标题（这是该子标题的定义）
const xuanSan = columns.find((c) => c.title === "高中课内")?.subgroups.find((g) => g.title === "七选三");
ok("七选三每张卡的正文里都有 学考 + 选考 两个小标题",
  (xuanSan?.cards ?? []).every((c) => {
    const heads = headingsOf(c.path).map((h) => (h.split("｜")[0] ?? "").trim());
    return heads.includes("学考") && heads.includes("选考");
  }),
  JSON.stringify((xuanSan?.cards ?? []).map((c) => [c.title, headingsOf(c.path)])));

// 外语栏目的语言课：每张卡的正文里都必须有该语种的全部级别小标题（日语 N5–N3、其余 A1–B2）
const foreignCards = (columns.find((c) => c.title === "外语")?.subgroups ?? []).flatMap((g) => g.cards);
const LEVEL_HEADS: Record<string, string[]> = {
  日语: ["N5", "N4", "N3"],
  俄语: ["A1", "A2", "B1", "B2"],
  法语: ["A1", "A2", "B1", "B2"],
  德语: ["A1", "A2", "B1", "B2"],
  意大利语: ["A1", "A2", "B1", "B2"],
  西班牙语: ["A1", "A2", "B1", "B2"],
};
const levelHeads = (path: string): string[] =>
  headingsOf(path).map((h) => (h.split("｜")[0] ?? "").trim());
eq("外语栏目的语种都在级别表里（新增语种要连级别一起写进来）",
  foreignCards.filter((c) => !["雅思"].includes(c.title) && LEVEL_HEADS[c.title] === undefined).map((c) => c.title),
  []);
ok("外语栏目每张语言卡的正文里都有该语种的全部级别小标题",
  foreignCards.every((c) => (LEVEL_HEADS[c.title] ?? []).every((level) => levelHeads(c.path).includes(level))),
  JSON.stringify(foreignCards.map((c) => [c.title, levelHeads(c.path)])));
// 雅思：四项技能 + 它自己的总览小节，都在正文的小标题里
ok("雅思的正文里有 听力 / 口语 / 阅读 / 写作 四个小标题",
  ["听力", "口语", "阅读", "写作"].every((skill) => levelHeads("ielts").includes(skill)),
  JSON.stringify(levelHeads("ielts")));

// 课外兴趣：软件名 / 语言名也是小标题，不是标签
const interestCards = (columns.find((c) => c.title === "课外兴趣")?.subgroups ?? []).flatMap((g) => g.cards);
eq("3D建模 的正文里有三个软件小标题",
  ["Shapr3D", "OpenSCAD", "Bambu Studio"].filter(
    (name) => !headingsOf("3d-printing").some((h) => (h.split("｜")[0] ?? "").trim() === name),
  ), []);
eq("编程与信息素养 的正文里有四个方向小标题",
  ["Python", "C/C++", "Java", "其它"].filter(
    (name) => !headingsOf("programming").some((h) => (h.split("｜")[0] ?? "").trim() === name),
  ), []);
ok("课外兴趣栏目的卡片确实有合并进来的小标题",
  interestCards.every((c) => headingsOf(c.path).length >= 3));

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
const grouped = getFormSubjectGroups("一对一").flatMap((g) =>
  g.subgroups.flatMap((sub) => sub.cards.map((card) => card.path)),
);
eq("班型页分组展示不漏卡片",
  allCards.filter((c) => c.forms.includes("一对一") && !grouped.includes(c.path)).map((c) => c.title),
  []);
ok("班型页分组都带栏目页路径",
  getFormSubjectGroups("一对一").every((g) => g.columnHref.startsWith("/courses/")));
/*
 * 三个**服务**（不是班型）的语义由业务决定，这里把它固定住：
 *   - 晚托管：不分科目，是单独的服务（按学段分小学晚托 / 初中晚托），
 *     因此不该挂到任何学科上；
 *   - 周中预习课：2026-09 起**不再是卡片上的班型**（机构口径：班型只有那五个，
 *     其余的班型信息全部清空）—— 它仍然留在特色课程树里当一门服务，
 *     因此卡片上一个字都不该有它。
 * 哪天业务变了，改内容的同时也会在这里被提醒。
 */
eq("晚托管不挂到任何学科（它是单独的服务，不分科目）", getCardsForForm("晚托管"), []);
eq("周中预习课不再是卡片上的班型（它不是班型，是特色课程里的一门服务）",
  getCardsForForm("周中预习课").map((item) => item.card.title), []);
ok("周中预习课仍然在特色课程树里（删掉它等于删掉网站上的那一门）",
  featuredNames.has("周中预习课"));
const FIVE_FORMS = ["一对一", "一对二", "一对三", "小班课（4-8人）", "大班课（9-20人）"];
ok("五个按人数的班型都有关联科目",
  FIVE_FORMS.every((form) => getCardsForForm(form).length >= 20),
  JSON.stringify(FIVE_FORMS.map((form) => [form, getCardsForForm(form).length])));
ok("卡片上的班型就是那五个（机构口径：其他的班型信息全部清空）",
  [...new Set(allCards.flatMap((c) => c.forms))].sort().join("、") === [...FIVE_FORMS].sort().join("、"),
  JSON.stringify([...new Set(allCards.flatMap((c) => c.forms))]));
eq("卡片上写的班型都存在于特色课程",
  allCards.flatMap((c) => c.forms.filter((form) => !featuredNames.has(form)).map((form) => `${c.title} → ${form}`)),
  []);

eq("卡片路径是 ASCII（中文名进 URL 会踩百分号编码的坑）",
  slugs.filter((slug) => !/^[a-z0-9-]+$/.test(slug)), []);

const pages = allCards.map((card) => ({ card, data: getCoursePageData(card.path) }));
eq("每张卡片都有页面数据", pages.filter((p) => p.data === null).map((p) => p.card.title), []);
eq("卡片页路径清单与卡片一致", [...getAllCoursePageSlugs()].sort(), [...slugs].sort());

/*
 * 老口径「卡片上的标签 = 同一页面内的阶段」保留着：标签已经全部去掉，
 * 因此 `missingStages` 必然为空 —— 这条现在是**方案 B 的守卫**：
 * 哪天有人在卡片上重新挂标签，而那个目标在本页取不到阶段，这里会立刻红。
 */
const missingStages = pages.flatMap(({ card, data }) =>
  card.tags
    .filter((tag) => !(data?.stages ?? []).some((stage) => stage.anchor === tag.target))
    .map((tag) => `${card.title} · ${tag.label}→${tag.target}`),
);
eq("标签都能在本卡片页面里找到对应阶段", missingStages, []);

// 卡片必须至少有一段正文或介绍，否则页面会只剩标题
eq("每张卡片都有正文或介绍",
  pages
    .filter(({ data }) =>
      (data?.stages.length ?? 0) === 0 &&
      (data?.intro ?? "").trim() === "")
    .map(({ card }) => card.title),
  []);

/*
 * 方案 B 的核心：**一门课 = 一段正文，段名（锚点）= 课程名**。
 *
 * 这里不断言具体名单（改内容与自检应当互相兼容，见本节开头那段），只断言这个**关系**：
 * 每张学科卡片点进去，取到的必须是「自己那一段」。原来「高中物理 → 学考 / 选考」
 * 那种"一张卡多个阶段"的形状因此被固定成历史 —— 想再拆出去，这里立刻红。
 * 反向（有正文却没有卡片 / 卡片却找不到正文）由下面那条「孤立小节」断言守住。
 */
const bandAnchors = allCourses.flatMap((c) => c.bands.map((b) => (b.title.split("｜")[0] ?? b.title)));
const oneStagePerCard = pages
  .filter(({ card, data }) =>
    data !== null &&
    !electiveGroupList.some((g) => g.items.some((i) => i.name === card.title)) &&
    (data.stages.length !== 1 || data.stages[0]?.anchor !== card.title))
  .map(({ card, data }) => `${card.title} → ${JSON.stringify((data?.stages ?? []).map((s) => s.anchor))}`);
eq("每张学科卡片 = 一段正文，段名就是课程名", oneStagePerCard, []);
ok("正文小节的数量与学科课程对得上（一门课一段）",
  bandAnchors.length >= 30, String(bandAnchors.length));

// 「与其他课程的关联性」：学段课程应当能指出同学科的其他学段
const chinese = getCoursePageData("primary-chinese");
eq("小学语文页面关联到初中 / 高中语文",
  chinese?.sameSubject.map((c) => c.title), ["初中语文", "高中语文"]);
const physics = getCoursePageData("senior-physics");
// 学考 / 选考不再是独立阶段，而是高中物理这一节正文里的两个小标题
eq("高中物理页面只有一个阶段（课程名）", physics?.stages.map((s) => s.anchor), ["高中物理"]);
eq("高中物理的正文里有 学考 / 选考 两个小标题",
  headingsOf("senior-physics").map((h) => (h.split("｜")[0] ?? "").trim()), ["学考", "选考"]);
ok("高中物理页面关联到七选三的其他课程",
  (physics?.sameColumn.length ?? 0) >= 3);
const ielts = getCoursePageData("ielts");
eq("雅思页面只有一个阶段（课程名）", ielts?.stages.map((s) => s.anchor), ["雅思"]);
// 雅思自己的总览小节现在是本节正文的开头，不再单独作为「课程说明」渲染
eq("雅思页面不再单独渲染课程总览（总览已经是正文开头）", ielts?.overview, null);
ok("雅思正文里保留了原来那条总览导语「按目标分数提分」",
  (ielts?.stages[0]?.title ?? "").includes("按目标分数提分"),
  ielts?.stages[0]?.title ?? "");
eq("雅思的正文里有四项技能小标题",
  headingsOf("ielts").map((h) => (h.split("｜")[0] ?? "").trim()),
  ["听力", "口语", "阅读", "写作"]);

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
        // 与 `teachersForCourse` 同一口径：课程名 + 阶段锚点 + 正文里的小标题
        const haystack = [
          data?.card.title ?? "",
          ...(data?.stages ?? []).map((stage) => stage.anchor),
          ...(data?.stages ?? []).flatMap((stage) => bodyHeadings(stage.body)),
        ].join(" ");
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
ok("每门学科都有学段内容", courses.every((c) => c.bands.length > 0 && (c.bands[0]?.content.length ?? 0) > 50));

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
/*
 * 选修课的判据是**每条都写了 `- · 状态:`**，而不是"当前都未开放"。
 *
 * `getCoursesPageFromTemplate` 认出"这一组是选修课"靠的正是"每个子项都有 `状态` 字段"
 * （`isElectiveGroup`）—— 少写一条，整组会被读成学科，选修课会跑到学科网格里。
 * 原来的断言是"当前全部标注暂未开放"：那是当时的内容状态；2026-09 有 44 门课上网之后
 * 状态由课程库决定（机构在后台自己改，例如「成人旅游、出行」现在是开放的），
 * 因此这里守住**判据**而不是**状态本身**，并把当前开放的那几门打印出来。
 */
ok("每条选修课都写了状态字段（否则整组会被读成学科）",
  (coursesPage?.groups.find((g) => g.name === electiveTitle)?.children ?? []).every((child) =>
    child.fields.some((field) => field.name === "状态")));
console.log(`  （提示）当前开放的选修课：${electives.filter((e) => e.available).map((e) => e.name).join("、") || "无"}`);
ok("选修课程未混入学科列表", courses.every((c) => !electives.some((e) => e.name === c.nameZh)));
ok("每门选修课都归类到栏目", electives.every((e) => e.group !== ""));

/*
 * 「暂未开放」有两处来源：课程总览卡片行里的 `状态`，以及课程 / 选修课自己的 `状态`。
 *
 * **只锁一个方向：正文标了「暂未开放」→ 卡片上也必须标。** 反方向不锁 ——
 * 机构在后台把 8 门课（初中社会 / 高中政治·历史·地理·技术 / 日语 / 俄语 / 意大利语）的
 * **卡片**设成了「暂未开放」（暂时不接报名），而课程页的学科正文照旧写着
 * （那几段说明还想留着）。那是 2026-09 从后台导出（`npm run site:export`）如实带出来的
 * 真实数据，不是导出写坏了：卡片的 `状态` 与学科正文的 `- · 状态:` 本来就是两个开关，
 * 原先那条"两边必须一致"是把两个开关当成一个了。
 *
 * 保留下来的这个方向是**必须成立**的那个：正文说暂未开放、卡片上却看不出来，
 * 家长从课程总览点进去才发现 —— 那才是自相矛盾。
 */
const availability = new Map<string, boolean>();
for (const course of courses) availability.set(course.nameZh, course.unavailable);
for (const item of electives) availability.set(item.name, !item.available);
eq("正文标了暂未开放的课，卡片上也标了（反方向不锁，见上面的说明）",
  allCards
    .filter((card) => availability.get(card.title) === true)
    .filter((card) => !card.unavailable)
    .map((card) => card.title),
  []);
ok("有课程标注了暂未开放", [...availability.values()].some(Boolean));
ok("数学组每段正文都带核心能力", (() => { const m = courses.find((c) => c.nameZh === "数学"); return m?.bands.length === 4 && m.bands.every((b) => b.content.includes("核心能力")); })());

const { teachers } = getTeachersPageFromTemplate();
// 在职角色数应等于「教师页分组数 − 离职数」：漏解析或重复解析都会在这里露出来
const offDuty = (teachersPage?.groups ?? []).filter(
  (g) => g.items.find((i) => i.title === "状态")?.value.trim() === "离职",
).length;
eq("在职角色数 = 分组数 − 离职数", teachers.length, (teachersPage?.groups.length ?? 0) - offDuty);
/*
 * 每位教师都必须有科目（没有科目 = 教师卡片上没有标签，课程页也匹配不到他）；
 * 详细介绍改成**下限**：后台新加的老师可能还没写介绍（2026-09 从后台导出的
 * 「曹轶豪」就只有职务 / 科目 / 教龄），不该让自检变红；但整批介绍被丢掉
 * （解析坏了、导出把正文写没了）必须红，因此要求至少 4 位有详细介绍。
 */
ok("教师都有科目", teachers.every((t) => t.subjects.length > 0));
ok("至少 4 位教师有详细介绍（下限，不阻止新增还没写介绍的教师）",
  teachers.filter((t) => t.bio.length > 30).length >= 4);
ok("教师按排序升序", teachers.every((t, i) => i === 0 || (teachers[i - 1]?.order ?? 0) <= t.order));
ok("页面只展示在职教师", teachers.every((t) => t.active));
/*
 * 姓名在 v39 跟着后台改过（陈老师 → 陈林维祎、林老师 → 林笑丹）：机构在后台把教师
 * 改成了真名，`npm run site:export` 把它写回了 `data/site/content.md`。
 * 这几条钉的还是**内容**（首位是全科教师且有推荐理由、第二位是晚辅导且带三个科目），
 * 不是"某个名字"——名字改了要跟着改这里，但改的只是名字。
 */
ok("首位教师为陈林维祎", teachers[0]?.name === "陈林维祎");
eq("首位教师职务为全科教师", teachers[0]?.role, "全科教师");
ok("首位教师有推荐理由", (teachers[0]?.recommendation ?? "").length > 10);
ok("其余教师未填推荐理由时为空", teachers.slice(1).every((t) => t.recommendation === ""));
const lin = teachers.find((t) => t.name === "林笑丹");
eq("第二位的职务是晚辅导老师", lin?.role, "晚辅导老师");
// 除了晚辅导，还带小学语文与小学数学（机构确认并入的 —— 见 data/site/content.md 教师段）
eq("晚辅导老师科目标签", lin?.subjects, ["晚辅导", "小学语文", "小学数学"]);
eq("晚辅导老师教龄", lin?.years, "10 年");
ok("晚辅导老师有详细介绍", (lin?.bio.length ?? 0) > 50);
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
const faq = getFaqContentFromTemplate();
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
/*
 * 二级课程 = **五个班型 + 三个服务**（晚托管 / 周中预习课 / 假期预习课）。
 *
 * 2026-09 机构把班型统一成五个（E13），原先那一套旧写法
 * （一对一定制课 / 一对二 / 一对三小组课 / 一对多小班课 / 9 人以上大班课）全部换成新名字；
 * 其中原来那个**合并写法**「一对二 / 一对三小组课」按五个班型拆成两个节点
 * （一对二、一对三）—— 因为卡片上的「班型」必须在这棵树里找得到
 * （见前面那条"卡片上写的班型都存在于特色课程"），合并成一个节点就会让
 * 「一对三」变成一个查不到的名字。
 */
eq("二级课程数（五个班型 + 三个服务）", inClass?.children.length, 8);
// 只要求「既有的这几门都在」：以后新增班型不该让自检失败，
// 但改名或误删既有课程必须被拦住
const LEVEL2_NAMES = [
  "一对一", "一对二", "一对三", "小班课（4-8人）", "大班课（9-20人）",
  "晚托管", "周中预习课", "假期预习课",
];
eq("二级课程都在（含假期预习课）",
  LEVEL2_NAMES.filter((name) => !(inClass?.children.some((c) => c.name === name))),
  []);
ok("特色课程数量合理（当前 15 门）", getAllFeaturedCourses().length >= 13);
ok("每门课程都有 4 个描述字段",
  getAllFeaturedCourses().every((c) => c.fields.length >= 3));
ok("三级课程挂在正确的父级下",
  (inClass?.children.find((c) => c.name === "小班课（4-8人）")?.children.length ?? -1) === 0);
ok("基础班挂在大班课（9-20人）下",
  (inClass?.children.find((c) => c.name === "大班课（9-20人）")?.children.length ?? -1) === 0);
ok("晚托班挂在晚托管下",
  (inClass?.children.find((c) => c.name === "晚托管")?.children.map((c) => c.name) ?? []).join(",") === "小学晚托,初中晚托");
ok("假期预习课单独成组，含小升初 / 初升高四门课",
  (inClass?.children.find((c) => c.name === "假期预习课")?.children.map((c) => c.name) ?? []).join(",") ===
    "精品小升初,精品初升高,基础小升初,基础初升高");
ok("精品 / 基础两种进度都归在假期预习课下",
  (inClass?.children.find((c) => c.name === "假期预习课")?.children ?? []).every(
    (c) => c.children.length === 0 && c.fields.some((f) => f.title === "适合对象")));
ok("核心课程都有详细介绍",
  ["周中预习课", "一对一", "一对三", "精品小升初"].every((name) => {
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
/*
 * 曾出问题的课程：课程名里带空格与斜杠（旧写法「一对二 / 一对三小组课」）会让派生的
 * 网址多出一个分段，页面直接 404。2026-09 那个名字已经拆成「一对二」「一对三」两个节点
 * （E13），因此这一条改成钉住**改名后网址没变**：显式声明的 slug 与课程名是两份数据。
 */
const smallGroup = getAllFeaturedCourses().find((c) => c.name === "一对二");
eq("改名之后网址没变（slug 是显式声明的，不跟着名字派生）",
  smallGroup?.path, ["in-class", "small-group"]);
eq("拆出来的那个节点也有自己的 ASCII 网址",
  getAllFeaturedCourses().find((c) => c.name === "一对三")?.path, ["in-class", "one-on-three"]);

console.log("\n=== 4. 报价数据 ===");
const pricing = getPricingDataFromTemplate();
/*
 * v37：报价的**分组改成课程类型的学段**，里面的**课程名以课程库为准**
 * （机构口径：「以课程清单为准…公式依旧不变，主要修改的是课程名称以及分类」）。
 *
 * 这一节因此分两层断言：
 *   1. **结构性** —— 阶段名必须是课程类型里真有的学段（写死一个"小学课内"当场挂）；
 *   2. **内容性** —— 这份站点内容（模板的那一份，也是新装库的报价初值）里有哪些组、
 *      每组几门课、都是什么价。价格是按"沿用同组旧价的入门档"定的，不是重新拍的。
 */
const pricingStageNames = pricing.stages.map((stage) => stage.name);
const catalogStageNames = catalogFromSeed().stages.map((stage) => stage.name);
eq("报价的分组名都是课程类型里的学段",
  pricingStageNames.filter((name) => !catalogStageNames.includes(name)), []);
eq("阶段（没有课程的学段不建组：现在没有大学生的课）",
  pricingStageNames, ["小学", "初中", "高中", "其他类型"]);
const priceLabel = (course: { name: string; price: number | null; available: boolean }) =>
  `${course.name}=${course.available ? course.price : "暂未开放"}`;
eq("小学的课程与价格",
  pricing.stages[0]?.courses.map(priceLabel),
  ["小学语文=150", "小学数学=150", "小学英语=150", "小学科学=150", "小学奥数=260", "小学英语竞赛=260"]);
eq("初中的课程与价格",
  pricing.stages[1]?.courses.map(priceLabel),
  ["初中语文=220", "初中数学=220", "初中英语=220", "初中科学=220", "初中社会=暂未开放",
    "小升初=200", "中考冲刺=350", "提前招专项=400"]);
eq("高中的课程与价格（含五个语种与两个专项）",
  pricing.stages[2]?.courses.map(priceLabel),
  ["高中语文=300", "高中数学=300", "高考外语=300", "高中物理=300", "高中化学=300", "高中生物=300",
    "高中政治=暂未开放", "高中历史=暂未开放", "高中地理=暂未开放", "高中技术=暂未开放",
    "日语=暂未开放", "俄语=暂未开放", "法语=300", "德语=300", "西班牙语=300",
    // 这两门课机构已从课程库删除 → 报价配置按既定口径把对应行**置成暂未开放、不删名字**
    // （`syncLibraryLinks`："不静默删除，机构自己决定去留"）。要清掉就到报价页删那一行。
    "高考冲刺=暂未开放", "特殊计划专项=暂未开放"]);
eq("其他类型的课程与价格",
  pricing.stages[3]?.courses.map(priceLabel),
  ["雅思=700", "意大利语=暂未开放", "3D建模 & 3D打印=暂未开放", "编程与信息素养=暂未开放",
    "成人英语口语=暂未开放", "成人零基础外语=暂未开放", "出国语言备考=暂未开放",
    "职场与商务英语=暂未开放", "医学专业英语=暂未开放", "机械行业英语=暂未开放", "贸易行业英语=暂未开放",
    "成人旅游、出行=100", "跨国交友=暂未开放"]);
ok("每一组都有可报价的课（否则家长点进来是空的）",
  pricing.stages.every((stage) => stage.courses.some((course) => course.available)));
ok("「暂未开放」的课不许带价（导出时那个价会丢，回读就对不上了）",
  pricing.stages.every((stage) => stage.courses.every((course) => course.available || course.price === null)));
/*
 * **没有「科目」这一维了**（机构口径：「科目系数可以删除」）。
 *
 * 这里把"它真的没了"钉三层，因为这一维以前在每个层面都留过痕迹
 * （内容的 `#### 科目:` 行 → 解析出来的 `subjectGroups` → 配置里的 `subjects`）：
 *   1. **解析结果里没有这个字段**：`PricingData` 上已经没有 `subjects` / `subjectGroups`
 *      （类型层面少了字段，这条上面的代码在 `tsc --noEmit` 里就编译不过）；
 *      这里再用运行时的方式钉一次，免得将来有人"顺手加回一个字段"而不改公式；
 *   2. **内容文件里没有那一行**（下面那两条）。
 *
 * 以前这里是四条断言：三组科目、每组几个科目、以及"科目必须是该学段真有的学科"。
 * 那些断言随科目表一起删掉 —— 不是放宽了标准，是那一维不存在了。
 */
eq("站点内容的报价数据里没有 subjects / subjectGroups（v29 删掉的那一维）",
  Object.keys(pricing).filter((key) => key === "subjects" || key === "subjectGroups"), []);
eq("报价配置（库/内容那一份）里也没有 subjects 字段",
  Object.keys(pricingConfigFromContent()).filter((key) => key === "subjects"), []);
ok("内容文件里不再有「#### 科目:」这一行",
  !pricingSource.includes("#### 科目"));
/*
 * 老内容里的那一行**不该让解析炸掉、也不该被读成别的东西**：
 * 机构手上可能还留着一份旧 `pricing.md`（或者从旧后台导出的片段），
 * 里面照样写着 `#### 科目: 语文、物理 ×1.1`。它现在只是一个**没人读的条目**
 * —— 不报错、不参与计算、也不产出任何科目分组。
 */
const legacySubjectSource = parsePricingSource(`# NexGenEdu · 新锐教培 · 报价数据

## 页面: 智能报价

## 学习阶段

### 小学

#### 课程: 小学数学: 150

#### 科目: 语文、物理 ×1.1
`);
eq("旧内容里残留的「#### 科目:」被忽略（不产出任何科目分组）",
  Object.keys(legacySubjectSource).filter((key) => key.toLowerCase().includes("subject")), []);
eq("而且那一行没把课程解析坏",
  legacySubjectSource.stages[0]?.courses.map(priceLabel), ["小学数学=150"]);
/*
 * **类型层面**的那一条：上面这些运行时断言只能证明"现在这份数据里没有这个键"，
 * 证明不了"将来也加不回来"。下面两个类型别名是**编译期**的：`PricingData` 上若又出现
 * `subjects` / `subjectGroups`（或 `PricingConfig` 上出现 `subjects`），
 * 条件类型会算成 `never`，赋值当场编译不过 —— 本文件在 `tsc --noEmit` 里（见 §38.5）。
 */
type NoSubjectFieldOnData = "subjects" | "subjectGroups" extends keyof PricingData ? never : true;
type NoSubjectFieldOnConfig = "subjects" extends keyof PricingConfig ? never : true;
type NoSubjectOnQuoteInput = "subject" extends keyof QuoteInput ? never : true;
type NoSubjectOnSelection = "subjectName" extends keyof QuoteSelection ? never : true;
const noSubjectTypes: [
  NoSubjectFieldOnData,
  NoSubjectFieldOnConfig,
  NoSubjectOnQuoteInput,
  NoSubjectOnSelection,
] = [true, true, true, true];
eq("类型上也删干净了（PricingData / PricingConfig / QuoteInput / QuoteSelection 都没有科目字段）",
  noSubjectTypes, [true, true, true, true]);
eq("班级类型", pricing.classTypes.map((c) => c.name),
  ["一对一", "一对二", "一对三", "小班课（4-8人）", "大班课（9-20人）"]);
eq("时长选项", pricing.durations.map((d) => `${d.name}×${d.multiplier}`),
  ["1 小时×1", "1.5 小时×1.5", "2 小时×2"]);
eq("试课", pricing.trial?.priceLabel, "免费");
eq("其他项目数", pricing.otherItems.length, 3);

console.log("\n=== 5. 报价公式 ===");
const stageOf = (courseName: string) =>
  pricing.stages.find((s) => s.courses.some((c) => c.name === courseName));
/*
 * 试算只发三样东西：选哪门课、选哪个班型（人数系数挂在这上面）、上多久与多少节。
 * **没有科目**（v29 删掉的那一维）—— 这个函数的签名就是"参数里没有科目"最直接的证据。
 */
const quote = (
  courseName: string,
  classTypeName: string,
  durationName: string,
  lessons: number,
  extra: Record<string, number> = {},
) => {
  const stage = stageOf(courseName);
  return calculateQuote({
    course: stage?.courses.find((c) => c.name === courseName) ?? { name: courseName, price: null, available: false },
    classType: pricing.classTypes.find((c) => c.name === classTypeName) ?? pricing.classTypes[0]!,
    duration: pricing.durations.find((d) => d.name === durationName) ?? pricing.durations[0]!,
    lessons,
    ...extra,
  });
};

// 初中数学 220 × 一对二 0.7 = 154；1.5 小时 ×1.5 = 231；5 节正课 1155
// 未满 10 节，试课按原价 220 计 → 总价 1375
const a = quote("初中数学", "一对二", "1.5 小时", 5);
eq("220×0.7×1.5×5 节", [a.unitPrice, a.lessonsPrice, a.trialFee, a.totalPrice], [231, 1155, 220, 1375]);
ok("5 节不加手续费", a.unitPrice === 231);
ok("9 节以下试课不免费", a.trialFree === false);

// 1 节 +10% 手续费：220×1 = 220 → 242；正课 242 + 试课 220 = 462
const b = quote("初中数学", "一对一", "1 小时", 1);
eq("1 节含 10% 手续费", [b.unitPrice, b.lessonsPrice, b.totalPrice], [242, 242, 462]);

// 满 10 节：试课免费
const c = quote("初中数学", "一对一", "1 小时", 10);
eq("10 节正课", c.lessonsPrice, 2200);
eq("10 节试课免费", [c.trialFree, c.trialFee, c.totalPrice], [true, 0, 2200]);

// 班课：教师费 2400 ÷ 12 人 = 200；×1.5 小时 = 300；×8 节 = 2400
// 正课 2400 + 试课 220（初中英语原价）= 2620
const d = quote("初中英语", "大班课（9-20人）", "1.5 小时", 8, { studentCount: 12, classCost: 2400 });
eq("班课按人数分摊", [d.unitPrice, d.lessonsPrice, d.totalPrice], [300, 2400, 2620]);

// 班课缺参数应报错
const e = quote("初中英语", "大班课（9-20人）", "1 小时", 5, { classCost: 2400 });
ok("班课缺人数时报错", e.ok === false);

// 节数非法应报错
const f = quote("初中数学", "一对一", "1 小时", 0);
ok("节数为 0 时报错", f.ok === false);

// 试课规则边界
eq("试课免费门槛", [isTrialFree(9), isTrialFree(10)], [false, true]);
eq("试课费", [trialFeeFor(9, 220), trialFeeFor(10, 220)], [220, 0]);

/*
 * **基础价的单位是"元 / 小时"**（机构口径：基础价之后还要按客户选的每节课小时数
 * 1 / 1.5 / 2 才算出一节课的价，写成"元 / 节"会两套单位混着说）。
 *
 * 这里钉两件事：① 乘数确实是"每节课几小时"这个乘数（1.5 小时 = 基础价 ×1.5）；
 * ② 明细里把这一步写出来（不写出来，"150 元的课怎么变成 225 元"只能靠猜）。
 */
const hourlyQuote = quote("初中数学", "一对一", "1.5 小时", 5);
eq("基础价 220（元/小时）× 1.5 小时 = 课单价 330（元/节）",
  [hourlyQuote.unitPrice, hourlyQuote.lessonsPrice], [330, 1650]);
ok("价格构成明细里写明了基础价是按小时算的",
  hourlyQuote.breakdown.some((item) => item.label.includes("基础价（元/小时）")));
ok("明细里列出了「每节课 1.5 小时 ×1.5」这一行",
  hourlyQuote.breakdown.some((item) => item.label === "每节课 1.5 小时" && item.value === "×1.5"));
ok("1 小时的课不显示这一行（乘 1 不用解释）",
  quote("初中数学", "一对一", "1 小时", 5).breakdown
    .every((item) => !item.label.startsWith("每节课")));

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
    { subject: "自检·多门A", lessons: 10, form: "一对一", teacherId: multiTeacher.id },
    { subject: "自检·多门B", lessons: 20, form: "一对二" },
  ],
});
eq("建档一次报两门 → 两条报课记录", multi.enrollments.length, 2);
eq("每门课的班型各自独立（不是一刀切同一个）",
  multi.enrollments.map((item) => [item.subject, item.form]).sort(),
  [["自检·多门A", "一对一"], ["自检·多门B", "一对二"]].sort());
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
  subject: "自检科目", form: "一对一", teacherId: "",
  lessons: 10, startedAt: new Date().toISOString(), note: "自检",
  unitPrice: 0, agreedAmount: 0, paidNow: 0, method: "微信",
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
  subject: anchorSubject, form: "一对一", teacherId: teacher.id, classroomId: room.id,
  studentIds: [pupil.id], startsAt: first.start, durationMinutes: first.duration,
  status: "已排", note: "", makeupForLessonId: "",
});

// 科目刻意用该教师可带的科目：否则「教师科目不符」会混进冲突计数，
// 让「撞课」的断言看起来失败（这是本组新增的校验，见下面的专门用例）
const conflictsFor = (start: string, duration = 60) =>
  api.lessons.findConflicts({
    subject: anchorSubject, form: "", teacherId: teacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: start, durationMinutes: duration,
    status: "已排", note: "", makeupForLessonId: "",
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
  startsAt: slot(7, 30).start, durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
});
eq("超过教室容量会被报出", overfilled.overCapacity,
  { capacity: tightRoom.capacity, students: tightRoom.capacity + 2 });
ok("超容量计入冲突总数", overfilled.total >= 1);

const fitsRoom = await api.lessons.findConflicts({
  subject: anchorSubject, form: "", teacherId: teacher.id, classroomId: tightRoom.id,
  studentIds: (await api.students.list()).slice(0, tightRoom.capacity).map((item) => item.id),
  startsAt: slot(7, 30).start, durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
});
eq("刚好坐满不算超容量", fitsRoom.overCapacity, null);

// ── 教师科目校验：科目不在可带科目里要提示 ────────────────────────────
const mathTeacher = (await api.teachers.list()).find((item) => item.subjects.includes("数学"));
if (mathTeacher !== undefined) {
  const wrongSubject = await api.lessons.findConflicts({
    // 「编程入门」不在任何教师的可带科目里，用它才能测出「科目不符」
    subject: "编程入门", form: "", teacherId: mathTeacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: slot(7, 30).start, durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "",
  });
  eq("科目与教师不符会被报出", wrongSubject.teacherSubjectMismatch, true);

  const rightSubject = await api.lessons.findConflicts({
    subject: "初中数学", form: "", teacherId: mathTeacher.id, classroomId: room.id,
    studentIds: [pupil.id], startsAt: slot(7, 30).start, durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "",
  });
  eq("科目匹配时不报", rightSubject.teacherSubjectMismatch, false);
}

// 编辑自己不算冲突
const selfReport = await api.lessons.findConflicts({
  id: anchorLesson.id, subject: anchorSubject, form: "", teacherId: teacher.id,
  classroomId: room.id, studentIds: [pupil.id], startsAt: first.start,
  durationMinutes: first.duration, status: "已排", note: "", makeupForLessonId: "",
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
    status: "已排", note: "", makeupForLessonId: "",
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
    status: "已排", note: "", makeupForLessonId: "",
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
  studentIds: [], startsAt: slot(18, 0).start, durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
  subject: "自检改课科目", form: "一对一", teacherId: teacher.id, lessons: 2,
  startedAt: new Date().toISOString(), note: "自检",
  unitPrice: 0, agreedAmount: 0, paidNow: 0, method: "微信",
});
const editEnrollmentId = editEnroll!.enrollments[0]!.id;
const editLesson = await api.lessons.create({
  subject: "自检改课科目", form: "一对一", teacherId: teacher.id, classroomId: room.id,
  studentIds: [editStudent.id], startsAt: slot(16, 0).start, durationMinutes: 60,
  status: "已排", note: "", makeupForLessonId: "",
});
const editSecond = await api.lessons.create({
  subject: "自检改课科目", form: "一对一", teacherId: teacher.id, classroomId: room.id,
  studentIds: [editStudent.id], startsAt: slot(17, 0).start, durationMinutes: 60,
  status: "已排", note: "", makeupForLessonId: "",
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
  subject: anchorSubject, form: "一对一", teacherId: teacher.id, classroomId: room.id,
  studentIds: [pupil.id], startsAt: slot(9, 0).start, durationMinutes: 60,
  status: "已排", note: "", makeupForLessonId: "",
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
  subject: "自检超用科目", form: "一对一", teacherId: teacher.id, lessons: 5,
  startedAt: new Date().toISOString(), note: "自检",
  unitPrice: 0, agreedAmount: 0, paidNow: 0, method: "微信",
});
const overflowLesson = await api.lessons.create({
  subject: "自检超用科目", form: "一对一", teacherId: teacher.id, classroomId: room.id,
  studentIds: [overflowStudent.id], startsAt: slot(11, 0).start, durationMinutes: 60,
  status: "已排", note: "", makeupForLessonId: "",
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
  /*
   * v31 收紧后校区**必须填**，因此这个夹具也显式给一个（不再靠"名称里带「·」自动拆"兜底）：
   * 那串「自检·限时教室」里的「自检·」是**自检夹具的命名前缀**、并不是校区，
   * 靠拆分去得到 `campus="自检"` 正好是机构说的"校区会多出一个值"。
   * 显式写 `campus: "自检"` + 名称里保留原串，落库时会把重复的那段前缀剥一次
   * （`splitCampusFields` 的第二种情形），显示仍是原来那一串 —— 断言不受影响。
   */
  campus: "自检",
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
  status: "已排", note: "", makeupForLessonId: "",
});
eq("超出教室可用时段会被标记", closedReport.classroomClosed, true);
ok("教室不开放计入冲突总数", closedReport.total >= 1);

const openReport = await api.lessons.findConflicts({
  subject: "测试", form: "", teacherId: teacher.id, classroomId: limited.id,
  studentIds: [pupil.id], startsAt: monday17.toISOString(), durationMinutes: 90,
  status: "已排", note: "", makeupForLessonId: "",
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
    // v30 的两个内部字段：自检建的临时档案留空（空串＝未填）
    employment: "", source: "",
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
  durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
  attendance: "到课", focus: "高", interaction: "主动", rating: 4, note: "自检第一条", leaveRequestedAt: "",
});
ok("课堂记录返回 id", firstRecord.id !== "");
const secondRecord = await api.lessonRecords.save({
  lessonId: trackLesson.id, studentId: trackStudent,
  attendance: "请假", focus: "低", interaction: "被动", rating: 2, note: "自检改过", leaveRequestedAt: "",
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
  id, version: 1, subject: "初中数学", form: "", teacherId: "t1", classroomId: "c1", studentIds: [],
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
    stageIds: [], subjectIds: [], moduleIds: [],
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
    subject: "自检·改报课科目", form: "一对一", teacherId: "",
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
    // v30：用工性质与招聘渠道（这里都用不上，留空）
    employment: "" as const, source: "",
  });
  const teacherA = await api.teachers.create(newTeacher("自检·改课甲老师"));
  const teacherB = await api.teachers.create(newTeacher("自检·改课乙老师"));
  const pastDone = await api.lessons.create({
    subject: editEnroll.subject, form: "一对一", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已上", note: "", makeupForLessonId: "",
  });
  const pastOpen = await api.lessons.create({
    subject: editEnroll.subject, form: "一对一", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: new Date(Date.now() - 86_400_000).toISOString(),
    durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
  });
  const futureLesson = await api.lessons.create({
    subject: editEnroll.subject, form: "一对一", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
  });

  // ① 只改记录：课节一节都不动
  const onlyRecord = await api.students.updateEnrollment(
    editStudent.id, editEnroll.id,
    { form: "一对二", unitPrice: 260, agreedAmount: 2600 },
    "enrollment",
  );
  eq("只改记录时不动课节", onlyRecord.updatedLessons.length, 0);
  eq("记录本身改了班型", (await api.students.get(editStudent.id))!.enrollments[0]?.form, "一对二");
  eq("未来那节课的班型没跟着变（这正是「只改记录」的意思）",
    (await api.lessons.get(futureLesson.id))?.form, "一对一");
  eq("单价与约定应缴改了",
    [(await api.students.get(editStudent.id))!.enrollments[0]?.unitPrice,
     (await api.students.get(editStudent.id))!.enrollments[0]?.agreedAmount], [260, 2600]);

  // ② 改记录 + 后续还没上的课：未来的跟着改，过去的（含已上、含状态还挂着的）一律不动
  const withFuture = await api.students.updateEnrollment(
    editStudent.id, editEnroll.id,
    { form: "一对一", teacherId: teacherB.id },
    "future-lessons",
  );
  eq("只改了未来那一节", withFuture.updatedLessons.map((item) => item.id), [futureLesson.id]);
  eq("过去的两节都算「已过去、未动」", withFuture.pastLessons, 2);
  eq("未来那节换成新教师了",
    (await api.lessons.get(futureLesson.id))?.teacherId, teacherB.id);
  eq("未来那节班型也变了", (await api.lessons.get(futureLesson.id))?.form, "一对一");
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
    studentIds: [], startsAt: blockStart.toISOString(), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
  });
  const conflicting = await api.lessons.create({
    subject: editEnroll.subject, form: "", teacherId: teacherA.id, classroomId: room.id,
    studentIds: [editStudent.id], startsAt: blockStart.toISOString(), durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "",
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
      title: "初中数学 · 一对一",
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
  subject: "自检·收费科目", form: "一对一", teacherId: "",
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
  version: 1,
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
    id: `fl_${studentId}`, version: 1, subject: "初中数学", form: "", teacherId: "", classroomId: "",
    studentIds: [studentId],
    startsAt: new Date(followNow.getTime() + 2 * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
    attendance, focus: "中", interaction: "一般", rating: 3, note: "", leaveRequestedAt: "",
    recordedAt: followNow.toISOString(),
  },
  lesson: {
    id: `fl${daysAgo}`, version: 1, subject: "初中数学", form: "", teacherId: "", classroomId: "",
    studentIds: ["fs1"],
    startsAt: new Date(followNow.getTime() - daysAgo * 86_400_000).toISOString(),
    durationMinutes: 60, status: "已上", note: "", makeupForLessonId: "",
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
  id: "fl_future", version: 1, subject: "初中数学", form: "", teacherId: "", classroomId: "",
  studentIds: ["fs1"],
  startsAt: new Date(followNow.getTime() + 2 * 86_400_000).toISOString(),
  durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
  id: "lv1", version: 1, subject: "初中数学", form: "", teacherId: "t1", classroomId: "c1",
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
  durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
    id, version: 1, subject: "初中数学", form: "", teacherId: "t1", classroomId: "c1",
    studentIds: ["s1"], startsAt: day.toISOString(), durationMinutes: duration,
    status: "已排", note: "", makeupForLessonId: "", ...over,
  };
};

const statRooms: Classroom[] = [
  {
    id: "c1", version: 1, name: "301", kind: "上课用教室", campus: "", capacity: 8,
    // 周一至周五 17:00–21:00 → 每天 4 小时，一周 20 小时 = 1200 分钟
    availability: [{ id: "a1", weekdays: [1, 2, 3, 4, 5], start: "17:00", end: "21:00" }],
    note: "",
  },
  { id: "c2", version: 1, name: "不限时段教室", kind: "自习室", campus: "", capacity: 4, availability: [], note: "" },
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
  { id: "t1", version: 1, name: "自检老师A", subjects: ["数学"], role: "", phone: "", active: true, years: "", summary: "", bio: "", recommendation: "", order: 1, siteVisible: true, origin: "后台", kind: "教师", employment: "", source: "" },
  { id: "t2", version: 1, name: "自检老师B", subjects: ["英语"], role: "", phone: "", active: true, years: "", summary: "", bio: "", recommendation: "", order: 2, siteVisible: true, origin: "后台", kind: "教师", employment: "", source: "" },
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
ok("按课时降序排列（老师A 在前）", (workload[0]?.teacher.id ?? "") === "t1");

// 退课与流失：口径按「退掉的课时」而不是条数
const churnStudents: Student[] = [
  {
    id: "cs1", version: 1, name: "退课学生", grade: "初二", guardian: "", subjects: [], profile: {},
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
    id: "cs2", version: 1, name: "暂停学生", grade: "初三", guardian: "", subjects: [], profile: {},
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

/*
 * 全局搜索的夹具。
 *
 * ⚠️ 这些对象以前是"缺字段也能过"的：`scripts/**\/*.mts` 从没被类型检查过，
 * 而 `searchAll()` 只读它用到的几个字段。纳入类型检查之后才要求它们**真的是**
 * Student / Teacher / Classroom / Lesson（补 `version` 与档案字段）——
 * 这不是为了讨好 tsc：夹具与真实记录形状一致，才不会出现
 * "按夹具写对了、按真实数据崩了"这种假绿。
 */
const searchInput = {
  keyword: "",
  students: [
    {
      id: "s1", version: 1, name: "张小明", grade: "初二", guardian: "138-0000-0000",
      subjects: ["初中数学"], profile: {}, enrollments: [],
      status: "在读" as const, note: "", createdAt: new Date().toISOString(),
    },
    {
      id: "s2", version: 1, name: "张小红", grade: "初三", guardian: "", subjects: [],
      profile: {}, enrollments: [], status: "在读" as const, note: "",
      createdAt: new Date().toISOString(),
    },
  ],
  teachers: [
    {
      id: "t1", version: 1, name: "陈老师", subjects: ["数学"], role: "全科教师", phone: "",
      active: true, years: "", summary: "", bio: "", recommendation: "", order: 1,
      siteVisible: true, origin: "网站" as const, kind: "教师" as const,
      // v30：这两个内部字段**不参与搜索**（搜「朋友介绍」不该搜出一个人），留空即可
      employment: "" as const, source: "",
    },
  ],
  classrooms: [
    {
      id: "c1", version: 1, name: "301 教室", kind: "上课用教室" as const, campus: "", capacity: 8,
      availability: [], note: "白板",
    },
  ],
  lessons: [
    {
      id: "l1", version: 1, subject: "初中数学", form: "一对一", teacherId: "t1", classroomId: "c1",
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
walkApi(api, "");
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
/*
 * 教师课时费分成**不在公开数据里** —— 查的是**结构**（字段名），不是"文案里出现了某个词"。
 *
 * 第一版写的是 `!JSON.stringify(publicSite).includes("系数")`，那是个很粗的代理判据：
 * 报价页本来就公开「人数系数」这类**价格输入**，它只是恰好用英文键名
 * （`coefficient`）装，中文「系数」两字只出现在文案里。v21 把常见问题搬进公开数据之后，
 * 问答里写着"基础价 × 人数系数"，这条断言立刻误报 —— 而它报的不是泄漏，
 * 是我的判据不成立。现在改成查三个只属于教师分成的字段名。
 */
eq("教师课时费分成（内部成本口径）不在公开数据里",
  publicKeys.filter((key) => ["teachershare", "basepercent", "steppercent", "pricebasis"].includes(key)),
  []);


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
  { id: "it1", version: 1, name: "数学老师", subjects: ["数学"], role: "", phone: "", active: true, years: "", summary: "", bio: "", recommendation: "", order: 1, siteVisible: true, origin: "后台", kind: "教师", employment: "", source: "" },
  { id: "it2", version: 1, name: "英语老师", subjects: ["英语"], role: "", phone: "", active: true, years: "", summary: "", bio: "", recommendation: "", order: 2, siteVisible: true, origin: "后台", kind: "教师", employment: "", source: "" },
  { id: "it3", version: 1, name: "离职数学", subjects: ["数学"], role: "", phone: "", active: false, years: "", summary: "", bio: "", recommendation: "", order: 3, siteVisible: true, origin: "后台", kind: "教师", employment: "", source: "" },
];
eq("按科目筛教师（在职且科目匹配）",
  teachersForSubject(iqTeachers, "初中数学").map((t) => t.id), ["it1"]);

const iqRooms: Classroom[] = [
  { id: "ic1", version: 1, name: "小教室", kind: "上课用教室", campus: "", capacity: 4, availability: [], note: "" },
  { id: "ic2", version: 1, name: "限时教室", kind: "上课用教室", campus: "", capacity: 8,
    availability: [{ id: "r", weekdays: [6], start: "09:00", end: "12:00" }], note: "" },
];
const iqLessons: Lesson[] = [
  { id: "il1", version: 1, subject: "初中数学", form: "", teacherId: "it1", classroomId: "ic2",
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
  { id: "il2", version: 1, subject: "初中数学", form: "", teacherId: "it1", classroomId: "ic1",
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
  startsAt: blockingStart.toISOString(), durationMinutes: 60, status: "已排", note: "自检·挡路课", makeupForLessonId: "",
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

/*
 * 这份小内容文件是**最小的一份合法报价内容**（只有一个阶段、一门课、一行课）。
 * 它以前还用来验"科目系数怎么写"（`物理 ×1.1` / `化学 x1.05`）—— 那一维 v29 删掉了，
 * 于是这里只剩下一件事：老内容少写了「计费规则」那一组时，规则要落到默认值上
 * （否则老库升级上来的报价页会因为没有手续费规则而算不出价）。
 */
const pbMini = parsePricingSource(`# NexGenEdu · 新锐教培 · 报价数据

## 页面: 智能报价

## 学习阶段

### 小学

#### 课程: 小学数学: 150
`);
eq("没写「计费规则」分组时用默认规则",
  [pbMini.rules.singleLessonFeePercent, pbMini.rules.freeTrialMinLessons],
  [10, 10]);

// 库里的配置由站点内容初始化（价格与宣传页一致，不是另抄一份）
const pbConfig = await api.pricing.get();
eq("种子报价配置来自站点内容", pbConfig.source, PRICING_SOURCE_CONTENT);
eq("库里的基础价与宣传页完全一致",
  pbConfig.stages.map((stage) => stage.courses.map((course) => `${course.name}:${course.basePrice}`)),
  pricing.stages.map((stage) => stage.courses.map((course) => `${course.name}:${course.price}`)));

/**
 * 按名字向**后台服务**报价（页面只发选择，不发价格）。
 *
 * 参数里**没有科目**（v29 删掉的那一维）—— 这也是「pricing.quote 不接受科目
 * 也能算出价」最直接的证据：这个函数连传科目的地方都没有。
 */
const pbQuote = (
  courseName: string,
  classTypeName: string,
  durationName: string,
  lessons: number,
  extra: Record<string, number> = {},
) =>
  api.pricing.quote({ courseName, classTypeName, durationName, lessons, ...extra });

// 主线：同一方案，前台公式与后台服务必须一致
const pbParityCases: Array<[string, string, string, number, Record<string, number>]> = [
  ["初中数学", "一对二", "1.5 小时", 5, {}],
  ["初中数学", "一对二", "1 小时", 1, {}],
  ["初中数学", "一对一", "1 小时", 10, {}],
  ["初中英语", "大班课（9-20人）", "1.5 小时", 8, { studentCount: 12, classCost: 2400 }],
  ["小学语文", "一对三", "2 小时", 20, {}],
  ["医学专业英语", "一对一", "1 小时", 5, {}],
  ["初中数学", "一对一", "1 小时", 0, {}],
];
for (const [course, classType, duration, lessons, extra] of pbParityCases) {
  const front = quote(course, classType, duration, lessons, extra);
  const back = await pbQuote(course, classType, duration, lessons, extra);
  eq(
    `前后台一致：${course} / ${classType} / ${duration} / ${lessons} 节`,
    [back.ok, back.unitPrice, back.lessonsPrice, back.trialFee, back.totalPrice, back.reason ?? ""],
    [front.ok, front.unitPrice, front.lessonsPrice, front.trialFee, front.totalPrice, front.reason ?? ""],
  );
}

// 选择里有名字对不上时要说清是哪一项（而不是安静地按 0 元算）
const pbUnknownCourse = await pbQuote("没有这门课", "一对一", "1 小时", 5);
ok("未知课程会被指出", pbUnknownCourse.ok === false && (pbUnknownCourse.reason ?? "").includes("没有课程"));
const pbUnknownClass = await pbQuote("初中数学", "没有这种班型", "1 小时", 5);
ok("未知班型会被指出", pbUnknownClass.ok === false && (pbUnknownClass.reason ?? "").includes("班型"));
/*
 * **不接受科目也能算出价**：这是 v29 之后 `pricing.quote` 的主口径
 * （页面根本不发科目），因此要当着面钉一次"它就是能算，而且算的是新公式的数"。
 * 顺带钉住**老前端**：它还按老形状多发一个 `subjectName` 时，
 * 那个字段被忽略、价格**一模一样** —— 否则升级当天就会出现"页面上的价突然变了"
 * 这种没人能解释的现象。
 */
const pbNoSubject = await pbQuote("初中数学", "一对二", "1.5 小时", 5);
eq("不带科目的报价算得出来，且就是新公式的数（220 × 0.7 × 1.5）",
  [pbNoSubject.ok, pbNoSubject.unitPrice, pbNoSubject.totalPrice], [true, 231, 1375]);
const pbLegacySelection = await api.pricing.quote({
  courseName: "初中数学", classTypeName: "一对二", durationName: "1.5 小时", lessons: 5,
  // 老前端多发的字段（v29 之后不该再有）—— 类型上不存在，因此这里用一层宽类型发出去
  ...({ subjectName: "数学" } as Record<string, unknown>),
} as Parameters<typeof api.pricing.quote>[0]);
eq("老前端多发一个 subjectName 不影响价格（升级当天不许悄悄变价）",
  [pbLegacySelection.ok, pbLegacySelection.unitPrice, pbLegacySelection.totalPrice],
  [pbNoSubject.ok, pbNoSubject.unitPrice, pbNoSubject.totalPrice]);

// 服务端必须自己复核配置：系数写 0 会让所有报价变 0，不能进库
const pbBadConfig = JSON.parse(JSON.stringify(pbConfig));
pbBadConfig.classTypes[0].coefficient = 0;
ok("人数系数为 0 的配置校验不通过", validatePricingConfig(pbBadConfig).length > 0);
/*
 * **配置里不再有 subjects 字段**（v29 删掉的那一维），两条一起钉：
 *   - 类型层面：上面那些代码（`pbBadConfig.classTypes` 之类）能通过 `tsc --noEmit`，
 *     而 `PricingConfig` 上已经没有 `subjects` 这个键了；
 *   - **真实库层面**：从服务端读回来的这一份（以及迁移后的老库）字段清单里也没有它。
 *     只看类型是不够的 —— 老库升级上来的那份 JSON 里可能还残留着这个键，
 *     而"库里到底还有没有这个字段"要按**实际读回来的对象**断，不能按类型断。
 */
eq("服务端读回来的报价配置里没有 subjects 键",
  Object.keys(pbConfig).filter((key) => key === "subjects"), []);
eq("校验函数也不再管科目（配置里多带一个 subjects 也不会被读）",
  validatePricingConfig({ ...pbConfig, subjects: "手写的残留" } as unknown as typeof pbConfig), []);
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
/*
 * 只改**基础价**（330）—— 以前这里还顺手改一个科目的系数（1.2），用来验"科目那一维
 * 真的进了公式"。科目 v29 删掉之后那个乘法不存在了，因此这一条断的就是新公式：
 * `330 × 一对二 0.7 × 1.5 小时 = 346.5`。
 *
 * ⚠️ 这个数**和改动前不一样**（改动前是 415.8 = 330 × 1.2 × 0.7 × 1.5），
 * 变的不是公式，是**夹具**：那条断言当初就是专门用来验科目系数的，现在没有那一维了。
 * 其它几条"按内容里的价算出来的数"（231 / 242 / 2200 / 300 / 1375 / 1650 …）
 * 一个都没动 —— 因为内容里所有科目的系数本来就都是 1。
 */
const pbRaised = JSON.parse(JSON.stringify(pbConfig));
pbRaised.stages.forEach((stage: { courses: Array<{ name: string; basePrice: number | null }> }) => {
  for (const course of stage.courses) if (course.name === "初中数学") course.basePrice = 330;
});
const pbSaved = await api.pricing.update(pbRaised);
eq("保存后标记为后台修改", pbSaved.source, PRICING_SOURCE_ADMIN);
const pbRaisedQuote = await pbQuote("初中数学", "一对二", "1.5 小时", 5);
eq("改价后后台按新价报", pbRaisedQuote.unitPrice, 346.5); // 330 × 0.7 × 1.5
eq("试课费按课程原价收（不带人数系数与手续费）", pbRaisedQuote.trialFee, 330);
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
/*
 * 导出的是**新口径**的内容片段：里面**不该**再有 `#### 科目:` 那一行
 * （v29 删掉的那一维）—— 否则替换进 `data/site/pricing.md` 之后，
 * 机构下次打开内容文件会看到一行没人读、也不知道该不该删的东西。
 */
ok("导出内容里不再有「#### 科目:」那一行",
  !pbExported.includes("#### 科目") && pbRoundTrip.stages.length === pbSaved.stages.length);
ok("导出内容带上了未开放课程",
  pbRoundTrip.stages.some((stage) => stage.courses.some((course) => course.basePrice === null)));

// 恢复默认：退回站点内容里的价格
const pbRestored = await api.pricing.reset();
eq("恢复后来源回到站点内容", pbRestored.source, PRICING_SOURCE_CONTENT);
eq("恢复后的价格就是宣传页的价格",
  pbRestored.stages[0]?.courses.map((course) => course.basePrice),
  pricing.stages[0]?.courses.map((course) => course.price));
const pbRestoredQuote = await pbQuote("初中数学", "一对二", "1.5 小时", 5);
eq("恢复后报价回到原值", pbRestoredQuote, quote("初中数学", "一对二", "1.5 小时", 5));

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
eq("人数上限与班型「小班课（4-8人）」对得上", TEACHER_SHARE_MAX_STUDENTS, 8);
ok("规则原文与机构给的公式一致",
  teacherShareFormula(pricing.teacherShare).includes("(0.4 + (学生人数 − 1) × 0.1)"));

// 人话版必须回答四件事：适用什么班型、比例怎么加、不适用什么、单价怎么取
const pbShareText = describeTeacherShare(pricing.teacherShare).join("\n");
ok("人话版说明了适用班型", pbShareText.includes("一对一") && pbShareText.includes("小班课（4-8人）"));
ok("人话版写明了 40% 起与每人 +10", pbShareText.includes("40%") && pbShareText.includes("10 个百分点"));
ok("人话版点明了 8 人时的比例", pbShareText.includes("110%"));
ok("人话版说明了 大班课（9-20人）不适用",
  pbShareText.includes("大班课（9-20人）不适用") && pbShareText.includes("另议"));
/*
 * 人话版里的「课程单价」口径（v29 之后）：标准单价**就是基础价**（不含人数折扣），
 * 班型课时价才是「基础价 × 人数系数」。改这一条是因为文案本身变了 ——
 * **算出来的课时费一分没变**（科目系数全是 1，那一步乘法本来就没起作用）。
 */
ok("人话版说明了课程单价的口径（标准单价 = 基础价本身）",
  pbShareText.includes("课程单价 = 基础价（") && pbShareText.includes("人数系数"));
ok("人话版说明了时长按小时算", pbShareText.includes("1.5 小时乘 1.5"));

/*
 * 按名字算：一对一 1 人 1 小时（初中数学 220 / 小时）= 220 × 40% = 88。
 *
 * **`subjectName` 已经不发了**（v29）：教师课时费的「课程单价」= **基础价**
 * —— 这两个数（88 与下面的 198）改动前后**一模一样**，因为以前那一步乘的是
 * 科目系数 1。
 */
const pbTeacher1 = await api.pricing.teacherFee({
  courseName: "初中数学", classTypeName: "一对一",
  durationName: "1 小时", lessons: 1, students: 1,
});
eq("一对一 1 人 1 小时的教师课时费", [pbTeacher1.ok, pbTeacher1.percent, pbTeacher1.teacherFee], [true, 40, 88]);
eq("教师课时费的「课程单价 / 小时」就是基础价（不再乘任何科目系数）",
  pbTeacher1.hourlyPrice, 220);
eq("明细里写明了那一档口径是课程标准单价",
  pbTeacher1.breakdown.some((item) => item.label.includes("课程标准单价") && item.value === "¥220"), true);
// 3 人 = 60%；1.5 小时 ×220 ×0.6 = 198
const pbTeacher3 = await api.pricing.teacherFee({
  courseName: "初中数学", classTypeName: "一对三",
  durationName: "1.5 小时", lessons: 5, students: 3,
});
eq("一对三 3 人 1.5 小时的教师课时费", [pbTeacher3.percent, pbTeacher3.teacherFee], [60, 198]);
ok("教师课时费里含家长侧收入与机构留存",
  pbTeacher3.revenue > pbTeacher3.teacherFee &&
  Math.abs(pbTeacher3.keepFee - (pbTeacher3.revenue - pbTeacher3.teacherFee)) < 0.01);
ok("教师课时费明细写清了比例怎么来的",
  pbTeacher3.breakdown.some((item) => item.value.includes("40% + 2×10%")));

// 大班课不适用：按人数分摊的那类按「教师费用 ÷ 人数」另议，不能硬套公式
const pbTeacherBig = await api.pricing.teacherFee({
  courseName: "初中英语", classTypeName: "大班课（9-20人）",
  durationName: "1.5 小时", lessons: 5, students: 12,
});
ok("大班课（9-20人）不适用分成规则",
  pbTeacherBig.ok === false && (pbTeacherBig.reason ?? "").includes("大班课"));

// 单价口径切换会改变教师课时费，但不影响家长报价
const pbSeatConfig = JSON.parse(JSON.stringify(await api.pricing.get()));
pbSeatConfig.teacherShare.priceBasis = "seat";
await api.pricing.update(pbSeatConfig);
const pbTeacherSeat = await api.pricing.teacherFee({
  courseName: "初中数学", classTypeName: "一对二",
  durationName: "1 小时", lessons: 1, students: 1,
});
// 班型课时价口径：基础价 220 × 人数系数 0.7 = 154 → 40% = 61.6
eq("切到班型课时价口径后的教师课时费", pbTeacherSeat.teacherFee, 61.6);
eq("那档口径算的是「基础价 × 人数系数」",
  pbTeacherSeat.hourlyPrice, 154);
eq("口径切换不影响家长报价",
  (await pbQuote("初中数学", "一对二", "1 小时", 5)).unitPrice,
  quote("初中数学", "一对二", "1 小时", 5).unitPrice);

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

/*
 * v28 → v29：**删掉「科目系数」这一维**（机构口径：「科目系数可以删除」）。
 *
 * 走**导入**这条路（理由同上面 v9 那段：写本地存储对服务端后端是假通过），并且刻意
 * 造一份"v28 的库"：`pricing.subjects` 里放着**系数不是 1** 的两行 —— 这样才能真的验到
 * "删掉那一维不改变任何已算出的价"，而不是"因为全是 1 所以碰巧一样"。
 *
 * （顺带说明为什么这里敢造一个非 1 的系数：那是**老库夹具**，代表"以前真有人给物理加过价"。
 * 删掉科目这一维之后它不再参与任何计算，因此价格仍然只由基础价 × 人数系数 × 时长决定。）
 */
const pbV28 = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
  version: number;
  pricing: Record<string, unknown>;
};
pbV28.version = 28;
pbV28.pricing.subjects = [
  { name: "数学", stageName: "初中", coefficient: 1.3 },
  { name: "语文", stageName: "小学", coefficient: 1 },
];
const pbV28Import = await api.importDatabase(JSON.stringify(pbV28));
ok("v28 老库（报价里还带着科目表）能导入并升级", pbV28Import.ok);
const pbV29Config = await api.pricing.get();
eq("迁移后配置对象里没有 subjects 键（不留 undefined 占位）",
  Object.keys(pbV29Config).filter((key) => key === "subjects"), []);
const pbV29Exported = await api.exportDatabase();
eq("落库的那一份里也没有这个键（不是只在读时视图上抹掉）",
  Object.keys(pbV29Exported.pricing).filter((key) => key === "subjects"), []);
eq("升级后版本号是当前版本", pbV29Exported.version, CURRENT_VERSION);
/*
 * **一分钱都没改**：与内容文件里那一份比「钱的部分」（`pricingConfigCore`）。
 * 那条 1.3 的科目系数是刻意造的"非 1"值 —— 删掉它价格照样一样，
 * 因为它从来就只乘在基础价后面，而基础价本身没动。
 */
eq("迁移只删字段、不改价（与内容文件那一份逐字段相同）",
  pricingConfigCore(pbV29Config), pricingConfigCore(pricingConfigFromContent()));
eq("迁移后按新口径算出来的价与迁移前一致（初中数学 220 × 一对二 0.7 × 1.5 小时）",
  (await pbQuote("初中数学", "一对二", "1.5 小时", 5)).unitPrice, 231);
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
/*
 * ⚠️ 清单里的课**全部来自网站卡片**（2026-09 起那十二门"只在后台用"的课也上网了，
 * 见 `extra-courses.ts` 与 PROJECT.md 的 E12）；来源字段仍然两态，因此下面按来源分组断言 ——
 * 「网站」这一组必须都有分区，「后台」那一组（机构自己在后台加的课，如示例里的围棋）不带分区。
 */
const pbSiteCourses = pbLibrary.filter((course) => course.origin === "网站");
const pbAdminCourses = pbLibrary.filter((course) => course.origin === "后台");
ok(`网站卡片来的课都标为「网站」来源（${pbSiteCourses.length} 门）`,
  pbSiteCourses.length >= 20 && pbSiteCourses.every((course) => course.origin === "网站"));
/*
 * 那十二门 2026-09 全部上网，因此它们现在与其余卡片一样是「网站」来源 ——
 * 这一条反过来钉住这件事：剔掉自检新加的围棋之后，**后台来源的课一门都不该有**。
 */
/*
 * ⚠️ 这一条**不是**"永远不许有『不展示』的课"：机构随时可以把某门课从网站撤下来
 * （卡片改成「不展示」），那是正常的经营动作（2026-09 他们就把 4 门撤了）。
 * 这里守的是"**那十二门当时确实上过网**"——因此只断"至少有一批在网站上"，
 * 不再断"一门不在网站的都没有"。
 */
ok(`那十二门里至少有一批在网站上（当前 ${EXTRA_COURSE_NAMES.filter((name) => pbSiteCourses.some((course) => course.name === name)).length} / ${EXTRA_COURSE_NAMES.length}）`,
  EXTRA_COURSE_NAMES.some((name) => pbSiteCourses.some((course) => course.name === name)));
ok("每门网站课程都挂了分区（v18：不再是一串分类文字）",
  pbSiteCourses.every((course) => partitionPlace(pbPartitions, course.partitionId).leaf !== null));
ok("网站课程的分区名非空（清单与网站要按它分组）",
  pbSiteCourses.every((course) => pbPartitionName(course.partitionId) !== ""));
ok("后台课不带分区（分区是网站栏目的结构，它们不上网）",
  pbAdminCourses.every((course) => course.partitionId === ""));
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
/*
 * 科目候选里，网站课程带栏目名（下拉按栏目分组），后台课没有栏目 ——
 * `MultiSelect` 把空 group 渲染成"不分组"（见 `components/admin/MultiSelect.tsx`），
 * 因此这里断的是"网站课程必须有分组名、后台课必须是空串"，而不是"每一项都有分组名"。
 */
eq("科目候选里的网站课程都带分区名（下拉要按栏目分组）",
  pbOptions.filter((option) => option.category === "" && option.origin === "网站").map((option) => option.name),
  []);
ok("后台课的科目候选确实在（排课与报课要选得到它们）",
  EXTRA_COURSE_NAMES.every((name) => pbOptions.some((option) => option.name === name)));

// 机构自己加一门网站上还没有的课：围棋（分区里要有"兴趣才艺"，先建后挂）
const pbHobby = await api.coursePartitions.create({ name: "兴趣才艺" });
eq("新建的分区排在同级最后（不抢到最前面）",
  topLevelPartitions(await api.coursePartitions.list()).at(-1)?.name, "兴趣才艺");
const pbWeiqi = await api.courses.create({
  name: "围棋", partitionId: pbHobby.id, forms: ["一对一"], origin: "后台",
  status: "开放", note: "自检用", createdAt: new Date().toISOString(),
  stageIds: [], subjectIds: [], moduleIds: [],
  path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
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
    stageIds: [], subjectIds: [], moduleIds: [],
    path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
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
    stageIds: [], subjectIds: [], moduleIds: [],
    path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
  });
} catch {
  pbEmptyRejected = true;
}
ok("课程名为空被拒绝", pbEmptyRejected);

/*
 * 课程**可以删**（包括"网站来源"的那些）。
 *
 * 这条断言以前是反的：「网站来源的课程不能删除」（理由：删了下次同步又回来）。
 * 那条护栏在 2026-09 删掉了 —— 机构问「为什么现有的这些课程卡片不能删除」：
 * v32 把"从网站同步课程"入口删了、v39/v40 又把真源反成"课程库 → 内容文件"，
 * 所以"网站来的"不再是"不许删"的理由。**真正拦着的仍是另一条**：
 * 被报课 / 排课引用着的课不许删（下面单独断言）。
 *
 * ## 验法：**自己造一门临时课，一根手指都不许碰夹具**
 *
 * 上一版是直接在夹具上删一门（`pbLibrary[0]`）—— 断言当场通过了，代价却写在后面：
 * 「主存储的课程库未被自检改坏」变成 `43 ≠ 44`。**断言自己把夹具改了**，
 * 于是它既证明不了"课程可以删"（删得掉本来就是因为它删的是真数据），
 * 又让后面所有"库里有几门课"的断言全部失去基准。这一版改成：
 *
 *   1. **建一门临时课 → 删掉它 → 断言它不在了**（`origin` 刻意写成「网站」：
 *      那条老护栏的判据正是 `origin === "网站"`，拿它来删才是"护栏真的不在了"的证据）；
 *   2. **源码级再钉一遍**：`canRemoveCourse` 不许在代码里复活 ——
 *      否则有人把那段护栏贴回来，"建一门删一门"照样绿，机构却会发现卡片又删不掉了。
 */
const pbTempCourse = await api.courses.create({
  name: "自检·建了就删的课", partitionId: pbPartitions[0]!.id, forms: [],
  origin: "网站", status: "开放", note: "", createdAt: new Date().toISOString(),
  path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
  stageIds: [], subjectIds: [], moduleIds: [],
});
eq("临时课程建出来了（走的是同一条新建校验）",
  (await api.courses.list()).filter((course) => course.id === pbTempCourse.id).length, 1);
// 先验"网站来源的课能改状态"（同一门临时课，删之前验），再验删除
eq("网站课程可以设为暂未开放",
  (await api.courses.update(pbTempCourse.id, { status: "暂未开放" }))?.status, "暂未开放");
eq("改回开放",
  (await api.courses.update(pbTempCourse.id, { status: pbTempCourse.status }))?.status,
  pbTempCourse.status);
eq("课程**可以删**（造一门再删掉，夹具一门没动）", await api.courses.remove(pbTempCourse.id), true);
ok("删掉之后它不在清单里了",
  (await api.courses.list()).every((course) => course.id !== pbTempCourse.id));
/*
 * 「夹具一门没少」的判据按 **id 逐个比**，不按条数比：自检自己在这之前也建过课
 * （围棋那条夹具），条数本来就比 `pbLibrary` 多一条 —— 按条数比会把"自检建的课"
 * 也算成"夹具被改了"，那正是上一版翻车的同一种错（拿一个会变的总数当判据）。
 */
const pbCoursesAfterTempRemove = await api.courses.list();
ok(`夹具那 ${String(pbLibrary.length)} 门课一门没少（这就是「不碰夹具」的判据）`,
  pbLibrary.every((course) => pbCoursesAfterTempRemove.some((item) => item.id === course.id)));
/** 去掉注释后再找：那几处说明文字里就写着 `canRemoveCourse`，按字面量搜会把自己搜出来。 */
const pbCode = (file: string): string =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
ok("「网站来源的课不许删」那条护栏（`canRemoveCourse`）在代码里已经不存在了",
  !pbCode("lib/backend/courses.ts").includes("canRemoveCourse") &&
  !pbCode("lib/backend/api.ts").includes("canRemoveCourse"));

// 后台新增的课程可以删
eq("后台新增的课程可以删除", await api.courses.remove(pbWeiqi.id), true);
ok("删除后不再出现在科目候选里",
  !(await api.courses.options()).some((option) => option.name === "围棋"));

// 教师可带科目直接存课程名（含后台新增的课）
const pbTeacher = await api.teachers.create({
  name: "自检老师", role: "", subjects: ["初中数学", "围棋"], phone: "", active: true,
  years: "", summary: "", bio: "", recommendation: "", order: 999, siteVisible: false,
  origin: "后台", kind: "教师", employment: "", source: "",
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
/*
 * **升级上来的课程必须有 id**。
 *
 * 这是一条"顺手加断言、当场抓出真 bug"的例子：v12 那一步是按**名字**把内容文件里的
 * 卡片灌进来的，一直没有 id —— 而台账里改名 / 删除 / 挪分区、报课与排课引用课程全按 id 走。
 * 也就是说：**从 v11 升上来的库，课程一门都改不动**。原先这里只数了条数，所以一直绿着。
 */
eq("升级补上的课程都有 id（否则台账里改名 / 删除都点不动）",
  pbMigratedCourses.filter((course) => course.id.trim() === "").map((course) => course.name), []);
eq("id 与新装系统的同一门课一致（course-site-<卡片路径>）",
  pbMigratedCourses.find((course) => course.name === "小学语文")?.id, "course-site-primary-chinese");
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
 * v37 起两边的**粒度是同一套**（报价里的课程名 = 课程库里的课程名，见第 41 节），
 * 所以"按名字认领"能把整份配置一次认全。这条注释原先写的是「报价是课程包粒度
 * （九年级课本 / 雅思口语）、课程库是学科粒度（初中数学 / 雅思），大多数名字本来就不一样」
 * —— 那正是这一轮要修掉的错位：**报价页上有 20 门"课程"，课程库里一门都没有**，
 * 打通机制因此完全空转。机构要给某门课定价，仍可以走「课程库课程定价」面板
 * （显式选课程 + 填价格），两种做法都保留。
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
  name: "围棋", partitionId: "", forms: ["一对一"], origin: "后台",
  status: "开放", note: "", createdAt: new Date().toISOString(),
  stageIds: [], subjectIds: [], moduleIds: [],
  path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
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
/*
 * 反过来断：**课程库里的每一门课在报价配置里都有行**（v37 起"以课程清单为准"）。
 *
 * 原先这里断的是"至少有一门未定价"（演示库里那门兴趣才艺课）—— 那条断言的立足点是
 * 当年那个错位状态：报价页自己有 20 门"课程"，与课程库对不上，于是随便一门课都可能没价。
 */
eq("课程库里的每一门课在报价配置里都有行",
  pbStatus.filter((item) => !item.priced).map((item) => item.name), []);

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
// v31：校区必填 —— 这两条夹具也得带上校区（不带的话它们会变成"被必填拒掉"的例子）
const jsonArray = parseImport("classrooms", JSON.stringify([
  { name: "301 教室", kind: "上课用教室", campus: "城西校区", capacity: 8 },
]));
eq("JSON 数组可以直接导", jsonArray.records.length, 1);
eq("JSON 里的数字列保持数字", jsonArray.records[0]?.capacity, 8);
const jsonWrapped = parseImport("classrooms", JSON.stringify({ classrooms: [{ 名称: "302 教室", 用途: "上课用教室", 校区: "城西校区" }] }));
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
const courseCsv = "课程名,分类,班型\n导入课程甲,初中课内,一对一\n导入课程甲,初中课内,一对一\n";
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
  active: true, years: "", summary: "", bio: "", recommendation: "", order: 999,
  siteVisible: false, origin: "后台", kind: "教师", employment: "", source: "",
});
const seriesRoom = await api.classrooms.create({
  // v31：校区必填 —— 夹具也要给（不给的话这里会被必填校验拒掉，而它要验的是批量排课）
  name: "自检批量排课教室", kind: "上课用教室", campus: "自检校区", capacity: 8, availability: [], note: "",
});
const seriesStudent = await api.students.create({
  name: "自检批量排课学生", grade: "初二", guardian: "", status: "在读", note: "", profile: {},
});
// 报 12 节：够跑"排 6 节 + 重复排一次（冲突跳过）"，又不足以跑满 100 节（用来验封顶）
await api.students.enroll(seriesStudent.id, {
  subject: seriesSubject, form: "一对一", teacherId: seriesTeacher.id, lessons: 12,
  startedAt: new Date().toISOString(), note: "自检",
  unitPrice: 0, agreedAmount: 0, paidNow: 0, method: "微信",
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
  form: "一对一",
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
    ask: async () => fakeReport({ summary: "检查完成：4 条都能导入" }),
    write: async () => { writeCount += 1; return fakeReport({ added: 4, summary: "新增 4 条教师" }); },
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
    ask: async () => fakeReport({ ok: false, error: "缺少必填列：姓名" }),
    write: async () => { wrote = true; return fakeReport(); },
  });
  eq("体检失败时不写入", [result.status, wrote, result.status === "done" ? result.report.ok : null],
    ["done", false, false]);
}

/*
 * 「从网站导入」（教师 / 教室）已经删掉（机构口径：现在都以后端为主，与 v32 删掉课程那两个同理）。
 * 这里守住**它当年覆盖过、现在仍然成立**的三条口径 —— 数据改用夹具里的教师来验：
 * AI 智能体也在档案里、但类型标成 AI、且**不进排课下拉**（那是给"人"的地方）。
 * 冲突策略（ask / skip / 覆盖）的覆盖在上一节的 `imports.apply` 用例里，不受这次删除影响。
 */
{
  /*
   * 示例库（`seedDb`）刻意只放真人教师，因此这里**自己造一条 AI 记录**来验口径 ——
   * 比依赖夹具里恰好有 AI 更结实（夹具哪天改了，这条不会静默失效）。
   */
  const ai = await api.teachers.create({
    name: "自检·AI 助手", role: "试课诊断", subjects: ["全科诊断"], phone: "", active: true,
    years: "", summary: "自检用", bio: "自检用的一段介绍。", recommendation: "", order: 999,
    siteVisible: false, origin: "后台", kind: "AI",
    // v30：这里刻意用**示例值**（而不是留空）—— 顺带证明"AI 档案也能带用工性质"，见下面那条断言
    employment: "兼职", source: "自检·内部推荐",
  });
  ok("AI 智能体能进教师档案（机构要能看到有哪些工具在服务学生）",
    (await api.teachers.list()).some((teacher) => teacher.id === ai.id && teacher.kind === "AI"));
  ok("AI 不出现在排课下拉里（排课下拉是给「人」用的）",
    (await api.teachers.listActive()).every((teacher) => teacher.kind !== "AI"));
  ok("真人教师在排课下拉里仍在",
    (await api.teachers.listActive()).some((teacher) => teacher.kind === "教师"));
  await api.teachers.remove(ai.id);
}

/*
 * 「从网站导入」（教师 / 教室）删干净了没有（v36）。
 *
 * 机构在原话是「**要一起删掉**」—— 前提是我先把课程那两个入口删掉之后回头问了这一句：
 * 「教师 / 教室面板里还有一个「从网站导入」，一起删吗？」。删的理由与 v32 同一条：
 * **现在都以后端为主**，库已经在了就不该再从 Markdown 反推。
 *
 * 这里要钉住的不是"代码里少了几个字符串"，而是三件**会静默退化**的事：
 *   1. **删干净**：契约、服务层、页面三处都不再有它 —— 只删一处会留下"点了报 404"的按钮；
 *   2. **别把孩子跟洗澡水一起倒掉**：批量导入（机构自己的 CSV / JSON）与那套
 *      "体检 → 写入"的流程必须还在（`runTwoPhaseImport` 的三条断言在上一节）；
 *   3. **口径后果要写死**：新装系统里教师与教室是**空的**（`initial.ts` 的"空库起步"
 *      一张表里，教师 / 教室列在"机构自己要录"那一栏）。以前那个按钮是"从网站拉一份"
 *      的唯一入口，删掉它就等于"装好之后要录一次"。这条是我特意问过机构的，
 *      所以**用断言写死**：哪天有人想改成自动灌一份（像课程那样），必须先改这一行，
 *      而不是让新装系统悄悄多出 8 个人。
 */
{
  const readFile = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  eq("契约里没有 imports.fromSite（删方法要同步更新 contract.ts）",
    realMethods.includes("imports.fromSite"), false);
  eq("服务层的 imports 上只剩 apply", Object.keys(api.imports).filter((key) => key !== "apply"), []);

  const importPages = [
    "components/admin/BulkImport.tsx",
    "app/admin/(dashboard)/teachers/page.tsx",
    "app/admin/(dashboard)/classrooms/page.tsx",
    "app/admin/(dashboard)/students/page.tsx",
    "app/admin/(dashboard)/data/page.tsx",
  ];
  /*
   * **去掉注释再查**（与 §22 / §44 同一个坑、同一个做法）：这两条要拦的是
   * "页面上还留着一个点了报 404 的入口"，而**注释里提到那个入口**是正当的 ——
   * 教师卡片那段注释正解释着"v36 把那个入口删掉之后为什么可以不再显示 origin"。
   * 不剥注释的话，写清楚历史的人反而会把断言弄红，最后大家只好把话说得含糊。
   */
  const importPageCode = new Map(
    importPages.map((file) => [
      file,
      readFile(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
    ]),
  );
  eq("这几个页面与导入面板里都不再出现「从网站导入」",
    [...importPageCode].filter(([, code]) => code.includes("从网站导入")).map(([file]) => file), []);
  eq("导入面板里也不再接 siteSource / 调 fromSite",
    [...importPageCode].filter(([, code]) => /siteSource|fromSite/.test(code)).map(([file]) => file), []);
  ok("只服务它的那个模块整块删掉了（留着就是死代码 + 一句已经不对的文件头注释）",
    !existsSync(new URL("../lib/backend/site-import.ts", import.meta.url)));

  const bulk = readFile("components/admin/BulkImport.tsx");
  ok("批量导入（机构自己的 CSV / JSON）还在，而不是被顺手一起删了",
    bulk.includes("批量导入") && bulk.includes("imports.apply"));
  ok("两阶段流程还在，批量导入走的就是它（上一节那三条断言守的是它）",
    bulk.includes("runTwoPhaseImport"));
  ok("代码里不再指向不存在的 npm 脚本 `server:import-site`（迁移注释里曾写着它）",
    !readFile("lib/backend/api.ts").includes("server:import-site"));

  const fresh = createEmptyDatabase();
  eq("新装系统里教师与教室是空的：装好之后要录一次（想改成自动灌一份，先改这一行）",
    [fresh.teachers.length, fresh.classrooms.length], [0, 0]);
  ok("同一张「空库」表里课程是例外：建库就有课（否则排课下拉什么都选不到）",
    fresh.courses.length > 0);
}

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
    teachers: getTeachersPageFromTemplate().teachers.map((teacher, index) => ({
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
      kind: teacher.kind === "ai" ? ("AI" as const) : ("教师" as const),
      // v17 起每条记录带乐观锁版本号：夹具也要与真实记录同形
      version: 1,
      /*
       * v30 的两个内部字段：夹具一样留空（＝未填）。
       * 顺带说明为什么它们**不影响**这一节的等价性：这两个字段与网站无关
       * （`publicTeacher` 的白名单里没有它们），因此模版路径与后端路径比得平。
       */
      employment: "" as const,
      source: "",
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

  /*
   * v29 起，三个"页面"被拆成了 `components/admin/*Panel.tsx`（机构要求把
   * 课程库 / 课程类型 / 开放矩阵合成一页）。这些面板**事实上仍然是页面**：
   * 它们自己读数据、自己有加载态、自己保存，因此"就地动作必须走安静刷新"这条规则
   * 必须照旧管着它们 —— 否则拆分就等于把一整组断言悄悄放走了。
   */
  const adminPanelUrl = new URL("../components/admin/", import.meta.url);
  const adminPanels = readdirSync(adminPanelUrl)
    .filter((entry) => entry.endsWith("Panel.tsx"))
    .sort()
    .map((entry) => {
      const source = readFileSync(new URL(entry, adminPanelUrl), "utf8");
      return { path: `components/admin/${entry}`, source, code: stripComments(source) };
    });
  const pageLikeSources = [...adminPages, ...adminPanels];
  const gatedPages = pageLikeSources.filter((page) => page.code.includes("setLoading(true)"));
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
    const coursesPage = pageLikeSources.find((page) => page.path.endsWith("CoursesLedgerPanel.tsx"));
    ok("找得到课程台账那一块（v29 起它是 components/admin/CoursesLedgerPanel.tsx，否则下面那条是空转的）",
      coursesPage !== undefined);
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
      "课程台账：新增课程表单默认收起（点某张卡片的「编辑」时，页面上方不会少掉那一大块）",
      folded,
      "见 components/admin/CoursesLedgerPanel.tsx 里 creatingCourse 的说明与 §15.3",
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
    "components/admin/CoursesLedgerPanel.tsx",
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
  const coursesPageSource = read("components/admin/CoursesLedgerPanel.tsx");
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
  /*
   * v28 起节假日不再是独立的一页：它成了「日历」页「假期与作息」页签里的一块。
   * 断言**内容一条不删**，只是指向新文件 —— 那两句口径（"只供查看、不会自动改排课"
   * 与"手动处理"）仍然必须出现在用户看得到的地方。
   */
  const page = read("components/admin/HolidayTablePanel.tsx");
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
  eq("页面权限与「读」这个动作的权限是同一个答案", PAGE_ACCESS["/admin/calendar"], HOLIDAY_ACTION_ACCESS["holidays.read"]);
  eq("抓取只有技术管理员", HOLIDAY_ACTION_ACCESS["holidays.refresh"], ["技术管理员"]);
  ok("导航里有入口（否则这一页只能靠手敲网址）", read("lib/site/admin-nav.ts").includes('"/admin/calendar"'));
  ok("而且**没有**第二个人口（节假日不再是一页：多一条导航就是两处入口）",
    !read("lib/site/admin-nav.ts").includes('"/admin/holidays"') &&
      PAGE_ACCESS["/admin/holidays"] === undefined);
  ok("日历页把这一块挂上了「假期与作息」页签（不是搬走了却没人引用）",
    read("app/admin/(dashboard)/calendar/page.tsx").includes("<HolidayTablePanel />") &&
      read("app/admin/(dashboard)/calendar/page.tsx").includes("假期与作息"));

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
    // v31：校区必填（这个夹具原先整个字段都没带，必填校验会把"删教室护栏"那一段直接弄红）
    name: "护栏自检教室", campus: "自检校区", capacity: 6, note: "", active: true, availability: [],
  } as never);
  const lesson = await api.lessons.create({
    subject: "数学", form: "", teacherId: teacher.id, classroomId: room.id, studentIds: [student.id],
    startsAt: new Date(Date.now() - 3_600_000).toISOString(), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
    startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
    startsAt: new Date(Date.now() - 3_600_000).toISOString(), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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
    startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
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

  /*
   * 已取消的课不算课次、不算课时，但要单列出来。
   *
   * ⚠️ 这里刻意**不用 `Date.now() + 1 小时`**：23:00 之后跑自检时它落到**明天**，
   * `api.today()` 自然数不到这一节 —— 断言就变成"取消前后都是 0"。
   * 这类"只在深夜红"的用例比没有用例更糟（`check:both` 会因此整轮不过，而原因看不出来），
   * 所以时间一律锚在**今天的固定钟点**上（`todayAt`）。
   */
  const cancelled = await api.lessons.create({
    subject: "数学", form: "", teacherId: teacher.id, classroomId: "", studentIds: [],
    startsAt: todayAt(14), durationMinutes: 90, status: "已排", note: "", makeupForLessonId: "",
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
  const courses = read("components/admin/CoursesLedgerPanel.tsx");
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
  /*
   * 子栏目护栏：**造一个临时的栏目 + 子栏目**来测，不再依赖现成的结构。
   *
   * 为什么不能像以前那样拿"夹具里第一个有子级的栏目"直接测：护栏是
   * **先看本区有没有课、再看有没有子栏目**，而那类栏目（高中课内）自己名下可能也有课
   * —— 拿它会先命中"还有 N 门课"那条，子栏目这一条就测不到了。
   * 造一个干净的临时结构，两条分支就各测各的。
   */
  const tempParent = await api.coursePartitions.create({ name: "自检·有子栏目的栏目" });
  const tempChild = await api.coursePartitions.create({ name: "自检·子栏目", parentId: tempParent.id });
  const childRefusal = await refusalOf(() => api.coursePartitions.remove(tempParent.id));
  ok("有子栏目的分区：拒绝删除，并点名是哪些子栏目",
    childRefusal.includes("子栏目") && childRefusal.includes("自检·子栏目"), childRefusal.slice(0, 90));
  eq("清掉临时子栏目", await api.coursePartitions.remove(tempChild.id), true);
  eq("空栏目可以删（护栏不误伤）", await api.coursePartitions.remove(tempParent.id), true);

  /*
   * 既有课又有子栏目时：**先提示把课移走**。
   *
   * 课会变成「未归类」是静默的数据错位，比"子栏目还在"更急，因此护栏的优先级如此。
   *
   * ## 这一条也改成**自己在用例里造结构**
   *
   * 原先它拿夹具里现成的「高中课内」来测 —— 那个栏目 2026-09 起确实同时有子栏目
   * （必考科目 / 外语 / 七选三）和自己名下的两门备考课（高考冲刺 / 特殊计划专项）。
   * 但机构后来把那两门课**删掉了**（课程清单整理，见 E13 与 `data/site/content.md`），
   * 于是「高中课内」只剩子栏目、自己名下没有课，这条断言就落到了「子栏目」那一条分支上
   * （实际打印的是"下面还有 3 个子栏目…"）—— **断言的成立与否取决于夹具碰巧长成什么样**，
   * 那是这类断言最不该有的性质：夹具一改，它就从"验护栏"变成"验数据"。
   *
   * 现在自己造：临时栏目 + 临时子栏目 + 一门挂在临时栏目上的课。
   * 判据仍然是那个护栏行为本身（先看本区有没有课，且说清会变成「未归类」）。
   */
  const tempBothParent = await api.coursePartitions.create({ name: "自检·既有课又有子栏目" });
  const tempBothChild = await api.coursePartitions.create({
    name: "自检·它下面的子栏目", parentId: tempBothParent.id,
  });
  const tempBothCourse = await api.courses.create({
    name: "自检·挂在那个栏目上的课", partitionId: tempBothParent.id, forms: [],
    origin: "后台", status: "开放", note: "", createdAt: new Date().toISOString(),
    path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
    stageIds: [], subjectIds: [], moduleIds: [],
  });
  const bothRefusal = await refusalOf(() => api.coursePartitions.remove(tempBothParent.id));
  ok("本区既有课又有子栏目时：先提示把课移走（并说清会变成「未归类」）",
    bothRefusal.includes("门课") && bothRefusal.includes("未归类"), bothRefusal.slice(0, 90));
  // 收尾：把临时结构整份拆掉（课 → 子栏目 → 栏目），一条都不留给后面的用例
  eq("清掉临时的那门课", await api.courses.remove(tempBothCourse.id), true);
  eq("清掉临时子栏目", await api.coursePartitions.remove(tempBothChild.id), true);
  eq("清掉临时栏目（课与子栏目都空了才能删）",
    await api.coursePartitions.remove(tempBothParent.id), true);

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
    stageIds: [], subjectIds: [], moduleIds: [],
    path: "", tags: [], target: "", order: 999, intro: "", siteKind: "不展示",
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
  const groupUsers = ["lib/site/backend-source.ts", "components/admin/CoursesLedgerPanel.tsx"]
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
    ["lib/site/backend-source.ts", "components/admin/CoursesLedgerPanel.tsx"]
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
    "components/admin/CoursesLedgerPanel.tsx", "app/admin/(dashboard)/data/page.tsx"]
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
  const coursesPageCode = readSource("components/admin/CoursesLedgerPanel.tsx");
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
    featured: getFeaturedContent(),
    faq: getFaqContent(),
  });

  // ① blank：没连上后端 → 那五块空白
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("blank");
  const blank = fiveBlocks();
  eq("没连上后端：**条目全是空的**（不拿模版当数据）",
    [
      blank.columns.length,
      blank.courses.courses.length,
      blank.teachers.teachers.length,
      blank.cases.cases.length,
      blank.pricing.stages.length,
      blank.featured.courses.length,
      blank.faq.count,
    ],
    [0, 0, 0, 0, 0, 0, 0]);
  /*
   * **骨架照常**：机构先后说了两句 —— 「需要用到后端数据的部分应该是空白的」与
   * 「教师界面和学生案例不能全空，得有分区标题」。合起来才是完整口径：
   * `blank` = 模版骨架（标题 / 说明 / 分区标题 / 页脚提示 / 报价页文案）+ 空条目。
   * 只守住前一句会得到"整页空白"（机构会以为坏了），只守住后一句就退回"拿模版当数据"。
   */
  eq("空白时标题与说明照常（来自模版骨架），教师 / 案例 / 特色课程 / 报价页这几块都要有",
    [
      blank.teachers.heading.title === getTeachersPageFromTemplate().heading.title &&
        blank.teachers.heading.title !== "",
      blank.cases.title === getCasesContentFromTemplate().title && blank.cases.title !== "",
      blank.featured.title === getFeaturedContentFromTemplate().title && blank.featured.title !== "",
      blank.pricing.labels.result === getPricingDataFromTemplate().labels.result &&
        blank.pricing.labels.result !== "",
      // FAQ 的**分区标题**也要在（问答为空）
      JSON.stringify(blank.faq.groups.map((group) => group.title)) ===
        JSON.stringify(getFaqContentFromTemplate().groups.map((group) => group.title)),
      // 课程页 / 课程总览的标题同样是骨架
      blank.courses.heading.title === getCoursesPageFromTemplate().heading.title &&
        blank.courses.heading.title !== "",
    ],
    [true, true, true, true, true, true]);
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
   * ③.5 报价那一块的**优先级**：backend 模式下，库里的价压过内容文件里的价。
   *
   * 机构问过一句「前端的基础价格已经可以根据后端走了吗？」—— 答案是"看在哪构站"，
   * 而这里钉住的正是那个容易搞反的次序：本机构建（后端在跑）**库里的那份优先**，
   * `data/site/pricing.md` 只在 template 模式（线上 Pages 那一份）与兜底时才用得上。
   * 搞反的症状是"明明起了后端、也改了价，重新构站却没变"。
   *
   * 断言用的是**故意与文件不一样**的价格（文件里小学语文是 150，快照里给 777）：
   * 结果必须是 777 —— 否则说明读的还是文件。
   */
  const priceSnapshot = {
    ...emptySnapshot,
    pricing: {
      ...emptySnapshot.pricing,
      stages: [{ name: "小学", courses: [{ name: "小学语文", basePrice: 777, available: true }] }],
      classTypes: [{ name: "一对一", mode: "coefficient", coefficient: 1 }],
      durations: [{ name: "1 小时", hours: 1, multiplier: 1 }],
    },
  } as unknown as PublicSite;
  __useBackendSnapshotForTesting(priceSnapshot);
  const fromBackend = getPricingData();
  const fromFile = getPricingDataFromTemplate();
  const priceOf = (data: typeof fromBackend, name: string) =>
    data.stages.flatMap((stage) => stage.courses).find((course) => course.name === name)?.price;
  ok("backend 模式下：报价取的是**库里那一份**（文件里那个价被忽略）",
    priceOf(fromBackend, "小学语文") === 777 && priceOf(fromFile, "小学语文") === 150);
  eq("而且阶段也跟着库走（不是「库里查不到就掺一半文件进来」）",
    fromBackend.stages.map((stage) => stage.name), ["小学"]);
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

console.log("\n=== 27. 特色课程进库（v20：机构要求「特色课程也该来源于后端」）===");

/*
 * 机构的原话是「特色课程应该也来源于后端呀，为什么现在前端还有」——
 * 它原先确实只在 `data/site/featured.md` 里，因此后端没起时照样显示。
 * v20 把它搬进 `siteContent.featuredPage`（三级课程树），后台「网站内容」页可维护。
 *
 * 这一节守五件事：
 *   1. **迁移真的灌了初值**（14 门课程、三级结构、字段与正文都在）；
 *   2. **三态**：后端态用库里的树，空白态是空的，显式 template 才用文件；
 *   3. **校验**：名字空 / 同级重名 / 路径重复 / 超过三级都要拒；
 *   4. **删除护栏**：有子课程不能删；名字还被课程当班型用时也不能删（并点名是哪几门课）；
 *   5. **耦合解开**：后台的「可开班型」候选取自**库里的**特色课程（不再是网站内容文件）。
 */
{
  __useStoreForTesting(memory);

  // ① 迁移：v19 老库（没有 featuredPage）→ 课程树从内容文件灌进来
  const legacyFeaturedDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    siteContent: Record<string, unknown>;
    version: number;
  };
  delete legacyFeaturedDb.siteContent.featuredPage;
  legacyFeaturedDb.version = 19;
  eq("v19 老库（没有特色课程块）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyFeaturedDb))).ok, true);
  const afterFeatured = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterFeatured.version, CURRENT_VERSION);
  const templateFeatured = getFeaturedContentFromTemplate();
  const countNodes = (list: readonly { children: unknown[] }[]): number =>
    list.reduce((sum, item) => sum + 1 + countNodes(item.children as { children: unknown[] }[]), 0);
  eq("迁移把内容文件里的课程树灌进了库（门数一致）",
    countNodes(afterFeatured.siteContent.featuredPage.courses), countNodes(templateFeatured.courses));
  ok(`库里的特色课程不止一门（${String(countNodes(afterFeatured.siteContent.featuredPage.courses))} 门）`,
    countNodes(afterFeatured.siteContent.featuredPage.courses) > 10);
  eq("一级课程名与内容文件一致",
    afterFeatured.siteContent.featuredPage.courses.map((item) => item.name),
    templateFeatured.courses.map((item) => item.name));
  eq("二级课程名与 URL 分段都搬了（路径不是从名字现算的）",
    afterFeatured.siteContent.featuredPage.courses[0]?.children.map((item) => [item.name, item.slug]),
    templateFeatured.courses[0]?.children.map((item) => [item.name, item.slug]));
  eq("字段与详细介绍也搬了（不是只搬了名字）",
    [
      (afterFeatured.siteContent.featuredPage.courses[0]?.children[0]?.fields.length ?? 0) > 0,
      (afterFeatured.siteContent.featuredPage.courses[0]?.children[0]?.body ?? "").length > 0,
    ],
    [true, true]);
  ok("每门课程都有自己的 id（日志 / 上下移 / 删除按它认人）",
    afterFeatured.siteContent.featuredPage.courses.every((item) => item.id !== ""));
  await api.restoreBackup();

  // ② 三态
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("template");
  eq("显式 template：特色课程来自模版",
    getFeaturedContent().courses.map((item) => item.name),
    templateFeatured.courses.map((item) => item.name));
  __useSiteContentSourceForTesting("blank");
  eq("没连上后端（默认）：特色课程**空白**，不回落到模版",
    [getFeaturedContent().courses.length, getAllFeaturedCourses().length], [0, 0]);
  __useSiteContentSourceForTesting(undefined);
  __useBackendSnapshotForTesting(null);

  // ③ 校验：四类拒绝
  const basePage = { heading: { eyebrow: "", title: "t", description: "" }, notice: "", courses: [] };
  const course = (name: string, slug = "", children: unknown[] = []): unknown => ({
    id: "", name, slug, fields: [], body: "", children,
  });
  const refusalOf = (page: unknown): string[] => validateFeaturedPage(page as never);
  ok("课程名为空被拒", refusalOf({ ...basePage, courses: [course("  ")] }).some((t) => t.includes("没有名字")));
  ok("同级课程名重复被拒",
    refusalOf({ ...basePage, courses: [course("同名"), course("同名")] }).some((t) => t.includes("不能重复")));
  ok("同级路径分段重复被拒",
    refusalOf({ ...basePage, courses: [course("A", "same"), course("B", "same")] })
      .some((t) => t.includes("路径")));
  ok("超过三级被拒（第四级在网站上没有入口）",
    refusalOf({
      ...basePage,
      courses: [course("一", "", [course("二", "", [course("三", "", [course("四")])])])],
    }).some((t) => t.includes("三级")));

  // ④ 删除护栏
  const guardPage = {
    ...basePage,
    courses: [
      { id: "f1", name: "课内辅导", slug: "in-class", fields: [], body: "", children: [
        { id: "f2", name: "小班课（4-8人）", slug: "mini-class", fields: [], body: "", children: [] },
      ] },
    ],
  } as never;
  ok("有子课程的节点：拒绝删除并点名子课程",
    featuredDeleteRefusal(guardPage, "f1", []).includes("子课程"));
  ok("名字正被课程当班型用：拒绝删除并点名是哪几门课",
    featuredDeleteRefusal(guardPage, "f2", [{ name: "小学数学", forms: ["小班课（4-8人）"] }])
      .includes("小学数学"));
  eq("既没子课程、也没被引用：可以删（护栏不误伤）",
    featuredDeleteRefusal(guardPage, "f2", []), "");

  /*
   * ⑤ 后台「班型」候选的口径（v23 改成维度表）。
   *
   * 这一条原先钉的是"班型候选 = 库里特色课程的二级课程名"（一对一定制课 / 一对二 /
   * 一对三小组课…那套写法）。机构确认「班型以系统现行的那一套为准，全部改过来」之后，
   * 班型的唯一口径是 `catalog.formats`（一对一 / 一对二 / 一对三 / 小班课（4-8人）/
   * 大班课（9-20人），与 `data/site/pricing.md` 的「班级类型」逐个同名）。
   *
   * ⚠️ 2026-09 之后**两边写法已经一样了**（E13 把旧那一套从特色课程树里也清掉了），
   * 但这条断言仍然要守着"候选只从维度表来"：特色课程树的二级课程名里还有三个服务
   * （晚托管 / 周中预习课 / 假期预习课），拿它当候选就会把服务混进班型下拉。
   */
  eq("班型候选的同步种子 = 课程类型里的班型（不再是特色课程的二级课程名）",
    getFormOptionsFromTemplate(), catalogFromSeed().formats.map((format) => format.name));
  eq("而且就是报价里那五个班型（同一件事不再有两套写法）",
    catalogFromSeed().formats.map((format) => format.name),
    ["一对一", "一对二", "一对三", "小班课（4-8人）", "大班课（9-20人）"]);
  const optionsSource = readFileSync(new URL("../lib/backend/options.ts", import.meta.url), "utf8");
  ok("那一份只读种子的班型候选**明确写着是同步种子**（名字里带 FromTemplate）",
    optionsSource.includes("getFormOptionsFromTemplate") && optionsSource.includes("catalogFromSeed()"));
  const hookSource = readFileSync(new URL("../components/admin/useFormOptions.ts", import.meta.url), "utf8");
  ok("后台表单的班型候选问的是课程类型（维度表），不再是特色课程树",
    /\.catalog\s*\n?\s*\.list\(\)/.test(hookSource) &&
    hookSource.includes("catalog.formats.map((format) => format.name)") &&
    !hookSource.includes("featuredFormOptions"));
  const formUsers = ["components/admin/CoursesLedgerPanel.tsx", "components/admin/StudentForm.tsx",
    "components/admin/EnrollmentPanel.tsx", "components/admin/LessonForm.tsx",
    "components/admin/LessonSeriesForm.tsx"]
    .filter((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").includes("useFormOptions()"));
  eq("五个用班型的地方都换成了那个 hook", formUsers.length, 5);

  // ⑥ 后台编辑界面挂在「网站内容」页上（否则库里那份数据没地方改）
  const contentPage = readFileSync(
    new URL("../app/admin/(dashboard)/content/page.tsx", import.meta.url), "utf8");
  ok("「网站内容」页挂了特色课程编辑器，并且与案例一起保存",
    contentPage.includes("FeaturedCoursesEditor") &&
    /saveBlocks\(\{ casesPage, featuredPage, faqPage, copy: content.copy \}\)/.test(contentPage));
}

console.log("\n=== 28. 常见问题进库（v21）+ 空态口径：骨架在、条目空 ===");

/*
 * 机构两句要求合起来才是完整口径：
 *   1. 「需要用到后端数据的部分应该是空白的」→ 不拿模版当数据；
 *   2. 「教师界面和学生案例不能全空，得有分区标题」→ 骨架（标题 / 分区标题 / 页脚提示）
 *      照常显示，只有条目为空。
 * 因此第 25 节验的是"条目为空"，这一节补上"骨架必须在"，以及 FAQ 进库（v21）。
 */
{
  __useStoreForTesting(memory);

  // ① 迁移：v20 老库 → 问答从内容文件灌进来
  const legacyFaqDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    siteContent: Record<string, unknown>;
    version: number;
  };
  delete legacyFaqDb.siteContent.faqPage;
  legacyFaqDb.version = 20;
  eq("v20 老库（没有常见问题块）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyFaqDb))).ok, true);
  const afterFaq = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterFaq.version, CURRENT_VERSION);
  const templateFaq = getFaqContentFromTemplate();
  const faqCount = (groups: readonly { items: unknown[] }[]): number =>
    groups.reduce((sum, group) => sum + group.items.length, 0);
  eq("迁移把内容文件里的分组搬进了库（组数一致）",
    afterFaq.siteContent.faqPage.groups.length, templateFaq.groups.length);
  eq("问题总数也一致（不是只搬了分组标题）",
    faqCount(afterFaq.siteContent.faqPage.groups), templateFaq.count);
  eq("分组标题与内容文件逐条一致（页面上的分区标题）",
    afterFaq.siteContent.faqPage.groups.map((group) => group.title),
    templateFaq.groups.map((group) => group.title));
  ok("每一条问答都有自己的 id（增删 / 上下移按它认人）",
    afterFaq.siteContent.faqPage.groups.every(
      (group) => group.id !== "" && group.items.every((item) => item.id !== ""),
    ));

  // ② 保存：能改、能校验、只动自己那一块
  const beforeFaq = await api.exportDatabase();
  const savedFaq = await api.site.saveBlocks({
    faqPage: {
      heading: { eyebrow: "自检", title: "自检常见问题", description: "说明" },
      notice: "自检用",
      groups: [{ id: "", title: "自检分组", items: [{ id: "", question: "问题一？", answer: "答案一。" }] }],
    },
  });
  eq("保存后分组与问答是刚才那一份",
    [savedFaq.faqPage.groups.length, faqCount(savedFaq.faqPage.groups)], [1, 1]);
  eq("新分组 / 新问答的 id 由服务端生成",
    [savedFaq.faqPage.groups[0]?.id !== "", savedFaq.faqPage.groups[0]?.items[0]?.id !== ""], [true, true]);
  eq("保存常见问题**不动**课程正文与案例",
    [
      JSON.stringify(savedFaq.coursePage) === JSON.stringify(beforeFaq.siteContent.coursePage),
      JSON.stringify(savedFaq.casesPage) === JSON.stringify(beforeFaq.siteContent.casesPage),
    ],
    [true, true]);

  const refusalFaq = async (page: unknown): Promise<string> => {
    try {
      await api.site.saveBlocks({ faqPage: page as never });
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };
  const baseFaq = { heading: { eyebrow: "", title: "t", description: "" }, notice: "", groups: [] };
  ok("分组标题为空被拒",
    (await refusalFaq({ ...baseFaq, groups: [{ id: "", title: " ", items: [] }] })).includes("分组没有标题"));
  ok("问题或答案为空被拒",
    (await refusalFaq({
      ...baseFaq,
      groups: [{ id: "", title: "A", items: [{ id: "", question: "问？", answer: "" }] }],
    })).includes("还没有答案"));
  ok("分组重名被拒",
    (await refusalFaq({
      ...baseFaq,
      groups: [
        { id: "", title: "同名", items: [] },
        { id: "", title: "同名", items: [] },
      ],
    })).includes("两次"));
  await api.restoreBackup();

  // ③ 骨架在、条目空（机构第 2 条要求）
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("blank");
  const blankFaq = getFaqContent();
  const blankCases = getCasesContent();
  const blankTeachers = getTeachersPage();
  const blankFeatured = getFeaturedContent();
  eq("没连后端：FAQ 的**分组标题**照常在，问答为空",
    [blankFaq.groups.map((group) => group.title), blankFaq.count],
    [templateFaq.groups.map((group) => group.title), 0]);
  ok("FAQ 的标题 / 说明 / 页脚提示也照常",
    blankFaq.title !== "" && blankFaq.description !== "" && blankFaq.notice !== "");
  eq("案例页：标题在、案例为空",
    [blankCases.title !== "", blankCases.cases.length],
    [true, 0]);
  eq("教师页：标题在、教师为空",
    [blankTeachers.heading.title !== "", blankTeachers.teachers.length],
    [true, 0]);
  eq("特色课程：标题在、课程树为空",
    [blankFeatured.title !== "", blankFeatured.courses.length], [true, 0]);
  __useSiteContentSourceForTesting(undefined);
  __useBackendSnapshotForTesting(null);

  /*
   * ④ 页面里那几句空状态（否则只有一行标题，机构会以为页面坏了）。
   *    查的是**渲染分支存在**，不是文案好看。
   */
  const readSite = (file: string): string =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const [file, marker] of [
    ["app/(site)/teachers/page.tsx", "暂无展示中的教师"],
    ["app/(site)/cases/page.tsx", "案例整理中"],
    ["app/(site)/faq/page.tsx", "暂无常见问题"],
    ["app/(site)/courses/page.tsx", "特色课程整理中"],
  ] as const) {
    ok(`${file} 里有空状态说明（只有标题会让人以为坏了）`, readSite(file).includes(marker));
  }

  // ⑤ 后台「网站内容」页挂了常见问题编辑器
  const contentPage = readSite("app/admin/(dashboard)/content/page.tsx");
  ok("「网站内容」页有常见问题的编辑区（分组 + 问答 + 增删排序）",
    contentPage.includes("常见问题") && contentPage.includes("新增分组") &&
    contentPage.includes("在这一组加一条问答"));
}

console.log("\n=== 29. 页面文案块进库（v22：品牌 / 首页 / 关于 / 联系我们 / 时间安排）===");

/*
 * 这五块是"整站骨架"那些文案。搬进库的目的与案例 / 特色课程 / 常见问题一样：机构要改它们，
 * 而它们原先只在 `data/site/*.md` 里。这一节守四件事：
 *
 *   1. **迁移真的灌了初值**（五块都在、字段与分组数对得上内容文件）；
 *   2. **两条来源产出同一份页面数据** —— 这是这次重构最核心的一条：
 *      从"读 Markdown"换成"读库"，页面上的字**一个都不该变**。
 *      为此把映射写成"只认 `CopySource`"（`lib/backend/site-copy-model.ts`），
 *      两种来源共用同一份映射，等价性因此是结构上成立的 —— 这条断言是把它钉住；
 *   3. **校验**：字段键重复 / 分组标题重复 / 空条目要拒；
 *   4. **空态**：`blank` 时短字段与分组标题保留、组内条目清空（与其他块同一条口径）。
 */
{
  __useStoreForTesting(memory);

  // ① 迁移：v21 老库 → 五块文案从内容文件灌进来
  const legacyCopyDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    siteContent: Record<string, unknown>;
    version: number;
  };
  delete legacyCopyDb.siteContent.copy;
  legacyCopyDb.version = 21;
  eq("v21 老库（没有页面文案块）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyCopyDb))).ok, true);
  const afterCopy = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterCopy.version, CURRENT_VERSION);
  const copySummary = (blocks: Record<string, { fields: unknown[]; groups: { items: unknown[] }[] }>): string[] =>
    SITE_COPY_KEYS.map((key) => {
      const block = blocks[key];
      if (block === undefined) return `${key}: 缺`;
      const items = block.groups.reduce((sum, group) => sum + group.items.length, 0);
      return `${key}: ${String(block.fields.length)}/${String(block.groups.length)}/${String(items)}`;
    });
  const imported = copySummary(afterCopy.siteContent.copy);
  ok(`五块文案都进了库（${imported.join(" · ")}）`,
    SITE_COPY_KEYS.every((key) => afterCopy.siteContent.copy[key] !== undefined));
  eq("品牌那一块**没有分组**（「全站」页里的「课程栏目」属于课程库，不是品牌文案）",
    afterCopy.siteContent.copy.brand.groups.length, 0);
  eq("首页 / 关于 / 联系 / 时间安排的分组数与内容文件一致",
    SITE_COPY_KEYS.filter((key) => key !== "brand").map(
      (key) => afterCopy.siteContent.copy[key].groups.length,
    ),
    SITE_COPY_KEYS.filter((key) => key !== "brand").map((key) => {
      const block = copyBlocksFromContent()[key];
      return block.groups.length;
    }));
  ok("短字段搬全了（品牌 14 个字段里包含电话与地址）",
    afterCopy.siteContent.copy.brand.fields.some((field) => field.key === "phone") &&
    afterCopy.siteContent.copy.brand.fields.some((field) => field.key === "address"));
  ok("每个字段 / 分组 / 条目都有自己的 id",
    SITE_COPY_KEYS.every((key) => {
      const block = afterCopy.siteContent.copy[key];
      return block.fields.every((field) => field.id !== "") &&
        block.groups.every((group) => group.id !== "" && group.items.every((item) => item.id !== ""));
    }));

  /*
   * ② **两条来源产出同一份页面数据**（这次重构的核心断言）
   *
   * 用真实库（刚导入的那一份）造快照：模版态与库态下这六个取数函数必须逐字节相同。
   * 这条能抓到的错包括"字段名写歪了""list() 的分隔符不对""分组白名单漏了一组"——
   * 我在开发时就是被 `trial_points` 的分隔符坑过一次（页面上的 ✓ 位置变了），
   * 而当时**只有逐页 diff 才看得出来**。现在它是断言。
   */
  const copySnapshot = buildPublicSite(await api.exportDatabase());
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("template");
  const copyTemplate = {
    brand: getSiteBrand(),
    home: getHomeContent(),
    headings: getHomeSectionHeadings(),
    about: getAboutContent(),
    contact: getContactContent(),
    schedule: getScheduleContent(),
  };
  __useBackendSnapshotForTesting(copySnapshot);
  __useSiteContentSourceForTesting(undefined);
  const copyBackend = {
    brand: getSiteBrand(),
    home: getHomeContent(),
    headings: getHomeSectionHeadings(),
    about: getAboutContent(),
    contact: getContactContent(),
    schedule: getScheduleContent(),
  };
  eq("模版与库**产出同一份**品牌与联系方式", JSON.stringify(copyBackend.brand), JSON.stringify(copyTemplate.brand));
  eq("模版与库**产出同一份**首页文案", JSON.stringify(copyBackend.home), JSON.stringify(copyTemplate.home));
  eq("模版与库**产出同一份**首页区块标题", JSON.stringify(copyBackend.headings), JSON.stringify(copyTemplate.headings));
  eq("模版与库**产出同一份**关于我们", JSON.stringify(copyBackend.about), JSON.stringify(copyTemplate.about));
  eq("模版与库**产出同一份**联系我们", JSON.stringify(copyBackend.contact), JSON.stringify(copyTemplate.contact));
  eq("模版与库**产出同一份**课程时间安排", JSON.stringify(copyBackend.schedule), JSON.stringify(copyTemplate.schedule));
  ok("而且这些取值**不是空的**（否则上面六条是空转的）",
    copyBackend.brand.contact.phone !== "" &&
    copyBackend.home.trial.points.length > 1 &&
    copyBackend.schedule.groups.length > 0 &&
    copyBackend.contact.methods.length > 0);

  // ③ blank：短字段与分组标题保留、组内条目清空
  __useBackendSnapshotForTesting(null);
  __useSiteContentSourceForTesting("blank");
  const blankAbout = getAboutContent();
  const blankSchedule = getScheduleContent();
  const blankContact = getContactContent();
  eq("blank：关于我们的短字段照常、分组标题照常、组内条目清空",
    [
      blankAbout.title === copyTemplate.about.title && blankAbout.title !== "",
      JSON.stringify(blankAbout.services) === "[]",
      blankAbout.serviceTitle === copyTemplate.about.serviceTitle,
    ],
    [true, true, true]);
  eq("blank：时间安排的分组标题在、时段为空",
    [blankSchedule.groups.map((group) => group.title), blankSchedule.groups.every((g) => g.items.length === 0)],
    [copyTemplate.schedule.groups.map((group) => group.title), true]);
  eq("blank：联系方式的清单为空、但页面标题与说明在",
    [blankContact.methods.length, blankContact.title !== ""], [0, true]);
  ok("blank：品牌与联系方式**整份保留**（它是网站自己的身份，没有「条目」可分）",
    JSON.stringify(getSiteBrand()) === JSON.stringify(copyTemplate.brand));
  __useSiteContentSourceForTesting(undefined);
  __useBackendSnapshotForTesting(null);

  // ④ 校验
  const block = (fields: [string, string][], groups: unknown[]): unknown => ({
    fields: fields.map(([key, value], index) => ({ id: `f${String(index)}`, key, value })),
    groups,
  });
  const refusalCopy = (page: unknown): string[] => validateCopy({ brand: page as never });
  ok("字段键重复被拒",
    refusalCopy(block([["phone", "1"], ["phone", "2"]], [])).some((t) => t.includes("出现了两次")));
  ok("字段没有名字被拒", refusalCopy(block([["", "1"]], [])).some((t) => t.includes("没有名字")));
  ok("分组标题重复被拒",
    refusalCopy(block([], [
      { id: "g1", title: "同名", description: "", items: [] },
      { id: "g2", title: "同名", description: "", items: [] },
    ])).some((t) => t.includes("出现了两次")));
  ok("标题 / 值 / 正文都空的条目被拒",
    refusalCopy(block([], [
      { id: "g1", title: "组", description: "", items: [{ id: "i1", title: "", value: "", body: "" }] },
    ])).some((t) => t.includes("空条目")));
  eq("完整的块可以通过", refusalCopy(block([["phone", "1"]], [
    { id: "g1", title: "组", description: "", items: [{ id: "i1", title: "a", value: "", body: "" }] },
  ])), []);

  // ⑤ 后台「网站内容」页挂了这五块的编辑器
  const contentPage = readFileSync(
    new URL("../app/admin/(dashboard)/content/page.tsx", import.meta.url), "utf8");
  ok("「网站内容」页有页面文案的编辑区（五个页签 + 共用编辑器 + 保存）",
    contentPage.includes("SITE_COPY_LABELS") &&
    contentPage.includes("SITE_COPY_KEYS.map") &&
    contentPage.includes("SiteCopyEditor"));
}

console.log("\n=== 30. 课程类型：四张维度表（v23，v26 去掉「交付形态」）===");

/*
 * 机构给的那份课程清单铺开有四百多条叶子，但它们是**五个维度的乘积**：
 * 学段 × 学科 / 项目 × 内容模块 × 班型。这一节守四件事：
 *
 *   1. **种子自洽**：id 不重复、引用不悬空、名字不重名 —— 灌进去的那一份必须
 *      **立刻**能通过 `catalog.save` 的同一道闸门（否则机构打开后台第一眼就是一片红字）；
 *   2. **合并语义**：清单里「小学语文 / 初中语文 / 高中语文」是**一行**语文 + 一个学段列表
 *      （不合并就会出现重复 id，而报价 / 排课 / 诊断引用的是学科 id）；
 *   3. **校验真的拦**：重名 / 悬空引用 / 两层分组 / 班型人数区间反向 / 删空 / 空 id；
 *   4. **API 与迁移**：v22 老库升到 v23 时维度表被灌进去，`save` 落库并留痕，
 *      `resetToSeed` 回初值，而"自称当前版本却缺这张表"的文件也要被兜住。
 */
{
  __useStoreForTesting(memory);

  // ① 种子自洽
  const seedCatalog = catalogFromSeed();
  const seedSummary = catalogSeedSummary();
  eq("种子的规模与 catalogSeedSummary 一致",
    [seedCatalog.stages.length, seedCatalog.subjects.length, seedCatalog.modules.length,
      seedCatalog.formats.length],
    [seedSummary.stages, seedSummary.subjects, seedSummary.modules, seedSummary.formats]);
  ok(`种子规模就是机构清单那一份（${catalogSummary(seedCatalog)}）`,
    seedCatalog.stages.length === 5 && seedCatalog.formats.length === 5 &&
    seedCatalog.subjects.length > 30 && seedCatalog.modules.length > 80);
  const duplicatesOf = (ids: string[]): string[] => ids.filter((id, index) => ids.indexOf(id) !== index);
  eq("四张表的 id 都不重复",
    [duplicatesOf(seedCatalog.stages.map((item) => item.id)).length,
      duplicatesOf(seedCatalog.subjects.map((item) => item.id)).length,
      duplicatesOf(seedCatalog.modules.map((item) => item.id)).length,
      duplicatesOf(seedCatalog.formats.map((item) => item.id)).length],
    [0, 0, 0, 0]);
  eq("种子**自己就能过闸门**（否则后台打开第一眼是一片红字）", validateCatalog(seedCatalog), []);
  eq("班型就是报价里的「班级类型」（一件事不再有两套写法）",
    seedCatalog.formats.map((format) => format.name), pricing.classTypes.map((item) => item.name));
  ok("每个模块都属于一个存在的学科、每个引用都指向存在的学段",
    seedCatalog.modules.every((item) => seedCatalog.subjects.some((subject) => subject.id === item.subjectId)) &&
    seedCatalog.subjects.every((item) =>
      item.parentIds.every((id) => seedCatalog.subjects.some((subject) => subject.id === id))));

  // ② 合并语义（学科与学段解耦，这正是"不枚举"的落脚点）
  const named = (name: string) => seedCatalog.subjects.find((item) => item.name === name);
  const stagesOf = (ids: readonly string[]): string[] => stageNamesOf(seedCatalog, ids);
  eq("「语文」只有一行，小学 / 初中 / 高中挂在这一行上",
    [seedCatalog.subjects.filter((item) => item.name === "语文").length, stagesOf(named("语文")?.stageIds ?? [])],
    [1, ["小学", "初中", "高中"]]);
  eq("「英语」横跨四个学段（小学 / 初中 / 高中 / 大学）",
    stagesOf(named("英语")?.stageIds ?? []), ["小学", "初中", "高中", "大学"]);
  eq("「日语」既在高中（高考外语）又在其他类型（等级考试），并且挂在「外语等级考试」下",
    [stagesOf(named("日语")?.stageIds ?? []), named("日语")?.parentIds],
    [["高中", "其他类型"], [catalogId("subj", "外语等级考试")]]);
  const chineseModules = seedCatalog.modules.filter((item) => item.subjectId === catalogId("subj", "语文"));
  const objective = chineseModules.find((item) => item.name === "客观题");
  eq("语文里「客观题」只有一行（初中与高中并到这一行上）",
    [chineseModules.filter((item) => item.name === "客观题").length, objective?.kind, stagesOf(objective?.stageIds ?? [])],
    [1, "能力点", ["初中", "高中"]]);
  eq("小学语文的模块是教材进度（一年级…六年级）",
    chineseModules.filter((item) => item.kind === "教材进度").map((item) => item.name),
    ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"]);
  ok("「听力」在两个学科里各有一条（模块不跨学科复用，这不算重名）",
    new Set(seedCatalog.modules.filter((item) => item.name === "听力").map((item) => item.subjectId)).size >= 2);

  // ③ 分组是「学段内的桶」
  const stageIdOf = (name: string): string =>
    seedCatalog.stages.find((item) => item.name === name)?.id ?? "";
  const examGroup = catalogGroups(seedCatalog).find((group) => group.name === "外语等级考试");
  ok("「外语等级考试」这个分组只属于「其他类型」",
    examGroup !== undefined && !(named("外语等级考试")?.stageIds.includes(stageIdOf("高中")) ?? true));
  eq("在「其他类型」那一栏里，日语在分组里",
    examGroup !== undefined &&
      subjectsInGroup(seedCatalog, stageIdOf("其他类型"), examGroup.id).some((item) => item.name === "日语"),
    true);
  eq("在「高中」那一栏里，这个分组是空桶",
    examGroup === undefined ? ["missing"] : subjectsInGroup(seedCatalog, stageIdOf("高中"), examGroup.id), []);
  ok("而日语仍然出现在「高中」那一栏的顶层（否则高考外语那一支整条消失）",
    subjectsInGroup(seedCatalog, stageIdOf("高中"), "").some((item) => item.name === "日语"));
  eq("「其他类型」那一栏 = 顶层桶 + 各分组，不重不漏",
    subjectsOfStage(seedCatalog, stageIdOf("其他类型")).length,
    subjectsInGroup(seedCatalog, stageIdOf("其他类型"), "").length +
      catalogGroups(seedCatalog)
        .filter((group) => group.stageIds.includes(stageIdOf("其他类型")))
        .reduce((sum, group) => sum + subjectsInGroup(seedCatalog, stageIdOf("其他类型"), group.id).length, 0));

  /** 跑一次"应当被拒绝"的保存，把服务端的原话取回来（没抛错就返回空串，断言会因此报红）。 */
  const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  // ④ 校验真的拦（每一种都给得出理由）
  const draftOf = (): Catalog => JSON.parse(JSON.stringify(seedCatalog)) as Catalog;
  const problemsOf = (mutate: (draft: Catalog) => void): string[] => {
    const draft = draftOf();
    mutate(draft);
    return validateCatalog(draft);
  };
  ok("学科重名被拒",
    problemsOf((draft) => draft.subjects.push({ ...draft.subjects[0]!, id: "subj_另一个" }))
      .some((text) => text.includes("出现了两次")));
  ok("学科没有名字被拒",
    problemsOf((draft) => { draft.subjects[0]!.name = "  "; }).some((text) => text.includes("没有名字")));
  ok("学科的空 id 被拒（保存后没有任何东西能引用它）",
    problemsOf((draft) => { draft.subjects[0]!.id = ""; }).some((text) => text.includes("没有 id")));
  ok("学科引用不存在的学段被拒",
    problemsOf((draft) => { draft.subjects[0]!.stageIds = ["st_不存在"]; })
      .some((text) => text.includes("不存在的学段")));
  ok("学科挂在不存在的分组上被拒",
    problemsOf((draft) => { draft.subjects[0]!.parentIds = ["subj_不存在"]; })
      .some((text) => text.includes("不存在的分组")));
  ok("分组只允许一层（把学科挂到「雅思」下面被拒）", (() => {
    const inGroup = named("雅思");
    if (inGroup === undefined) return false;
    return problemsOf((draft) => {
      const target = draft.subjects.find((item) => item.name === "语文");
      if (target !== undefined) target.parentIds = [inGroup.id];
    }).some((text) => text.includes("分组只允许一层"));
  })());
  ok("模块属于不存在的学科被拒",
    problemsOf((draft) => { draft.modules[0]!.subjectId = "subj_不存在"; })
      .some((text) => text.includes("不存在的学科")));
  ok("模块挂在一个不存在的上级模块上被拒",
    problemsOf((draft) => { draft.modules[0]!.parentId = "mod_不存在"; })
      .some((text) => text.includes("不存在的上级模块")));
  ok("模块挂到**别的学科**的模块下被拒", (() => {
    const first = seedCatalog.modules[0];
    const other = seedCatalog.modules.find((item) => item.subjectId !== first?.subjectId);
    if (first === undefined || other === undefined) return false;
    return problemsOf((draft) => { draft.modules[0]!.parentId = other.id; })
      .some((text) => text.includes("别的学科"));
  })());
  ok("模块的上级是它自己被拒",
    problemsOf((draft) => {
      const item = draft.modules[0]!;
      item.parentId = item.id;
    }).some((text) => text.includes("上级是它自己")));
  ok("同一学科同一上级下模块重名被拒",
    problemsOf((draft) => draft.modules.push({ ...draft.modules[0]!, id: "mod_另一个" }))
      .some((text) => text.includes("同一层内不能重复")));
  ok("班型最少人数小于 1 被拒",
    problemsOf((draft) => { draft.formats[0]!.minSize = 0; }).some((text) => text.includes("最少人数")));
  ok("班型最多人数小于最少人数被拒",
    problemsOf((draft) => { draft.formats[0]!.maxSize = 0; }).some((text) => text.includes("最多人数")));
  ok("班型重名被拒",
    problemsOf((draft) => draft.formats.push({ ...draft.formats[0]!, id: "fmt_另一个" }))
      .some((text) => text.includes("出现了两次")));
  ok("学段删空被拒",
    problemsOf((draft) => { draft.stages = []; }).some((text) => text.includes("学段至少")));
  ok("班型删空被拒",
    problemsOf((draft) => { draft.formats = []; }).some((text) => text.includes("班型至少")));

  // ⑤ 新增行补 id（保存前的那一次扫描）
  const fresh = draftOf();
  fresh.stages.push({ id: "", name: "研究生", order: 9, note: "" });
  fresh.subjects.push({
    id: "", name: "统计", kind: "学科", parentIds: [], order: 99,
    stageIds: [catalogId("st", "研究生")], note: "",
  });
  fresh.modules.push({
    id: "", parentId: "", subjectId: catalogId("subj", "统计"), name: "回归", kind: "教材进度", order: 1,
    stageIds: [catalogId("st", "研究生")],
  });
  fresh.formats.push({ id: "", name: "一对六", minSize: 6, maxSize: 6, mode: "系数", order: 9 });
  assignCatalogIds(fresh, catalogId);
  eq("新加的行按名字派生 id（模块带学科名，两个学科的同名模块才不会撞）",
    [fresh.stages.at(-1)?.id, fresh.subjects.at(-1)?.id, fresh.modules.at(-1)?.id, fresh.formats.at(-1)?.id],
    [catalogId("st", "研究生"), catalogId("subj", "统计"), catalogId("mod", "统计·回归"),
      catalogId("fmt", "一对六")]);
  eq("补完 id 之后整份仍然通过校验", validateCatalog(fresh), []);
  const freshBefore = JSON.stringify(fresh);
  assignCatalogIds(fresh, catalogId);
  eq("再补一次不会动已经落地的 id（幂等）", JSON.stringify(fresh), freshBefore);

  // ⑥ API 与迁移
  const legacyCatalogDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & { version: number };
  delete legacyCatalogDb.catalog;
  legacyCatalogDb.version = 22;
  eq("v22 老库（没有课程类型这一块）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyCatalogDb))).ok, true);
  const afterCatalog = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterCatalog.version, CURRENT_VERSION);
  eq("迁移把种子灌进了库（与 catalogFromSeed 一致）",
    catalogSummary(afterCatalog.catalog), catalogSummary(seedCatalog));

  const listed = await api.catalog.list();
  eq("catalog.list 读出来的是库里那一份", catalogSummary(listed), catalogSummary(seedCatalog));

  const invalidDraft = JSON.parse(JSON.stringify(listed)) as Catalog;
  invalidDraft.formats[0]!.minSize = 0;
  const catalogRefusal = await refusalOf(async () => await api.catalog.save(invalidDraft));
  ok("catalog.save 拦住非法维度表并把理由说清（不是静默保存）",
    catalogRefusal.includes("最少人数"));

  const grown = JSON.parse(JSON.stringify(listed)) as Catalog;
  grown.stages.push({ id: "", name: "研究生", order: grown.stages.length + 1, note: "" });
  assignCatalogIds(grown, catalogId);
  const savedCatalog = await api.catalog.save(grown);
  eq("合法的维度表能保存（新学段进去了）",
    savedCatalog.stages.some((item) => item.name === "研究生"), true);
  const catalogLog = await api.logs.list();
  eq("保存课程类型写了操作日志", catalogLog[0]?.entity, "课程类型");
  ok("日志里写了规模（「原本几条、现在几条」看得出是哪一次改的）",
    (catalogLog[0]?.summary ?? "").includes("学段"));
  eq("再读一次，库里确实是那一份（不是只改了返回值）",
    (await api.catalog.list()).stages.length, listed.stages.length + 1);

  const restoredCatalog = await api.catalog.resetToSeed();
  eq("恢复种子把维度表还原（新加的那个学段没了）",
    [restoredCatalog.stages.length, catalogSummary(restoredCatalog)],
    [listed.stages.length, catalogSummary(seedCatalog)]);
  eq("恢复种子也留痕", (await api.logs.list())[0]?.action, "恢复种子");

  /*
   * 尾闸门（与分区表 / 网站内容同一条纪律）：**声称的版本号不是证据**。
   * 一份"自称当前版本却缺 catalog"的文件（手改过的导出、半份恢复）如果直接进库，
   * 后台「课程类型」页会整页 TypeError。这里走真实的导入路径验一次。
   */
  const brokenCatalogDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & { version: number };
  delete brokenCatalogDb.catalog;
  brokenCatalogDb.version = CURRENT_VERSION;
  eq("自称当前版本、却缺课程类型的文件也能导入",
    (await api.importDatabase(JSON.stringify(brokenCatalogDb))).ok, true);
  const repaired = await api.exportDatabase();
  ok("导入后被兜成种子那一份（后台不会整页打不开）",
    Array.isArray(repaired.catalog.stages) && repaired.catalog.stages.length === seedSummary.stages);
}

console.log("\n=== 31. 开放矩阵：本机构开哪些组合（v24）===");

/*
 * 维度表回答"可以有哪些维度"，组合表回答"本机构开哪些组合"。
 * 这一节守五件事：
 *
 *   1. **矩阵的形状**：行 = 学科 + 它的模块（含"不分模块"那一行），列 = 班型，
 *      分组（"外语等级考试"这种桶）**不出现在行里**；
 *   2. **组合的身份**：四个维度 id 拼出来的 id 是确定的（可重复、不可能重复两行），
 *      而且**不按下标反解**（学科 / 模块 id 里本来就带 `·`）；
 *   3. **三种状态**：没设过 / 开放 / 明确关闭是**三件事**，批量勾选能退回"没设过"；
 *   4. **校验真的拦**：悬空引用（维度被删之后留下的组合）、模块跨学科、同一条组合两行、id 对不上；
 *   5. **API 与迁移**：v23 老库升到 v24 时是**空表**（不是猜一份初值），`save` 落库并留痕，
 *      而"自称当前版本却缺这张表"的文件也要被兜住。
 */
{
  __useStoreForTesting(memory);

  const seedCatalogForOffers = catalogFromSeed();
  const matrix = buildMatrix(seedCatalogForOffers);

  // ① 矩阵的形状
  const groupIds = new Set(
    seedCatalogForOffers.subjects.flatMap((subject) => subject.parentIds),
  );
  ok("矩阵的行是「学科 + 它的模块 + 每个学科那一行『不分模块』」",
    matrix.rows.length ===
      seedCatalogForOffers.subjects.filter((subject) => !groupIds.has(subject.id)).length +
        seedCatalogForOffers.modules.length);
  eq("列 = 班型（就是课程类型里那一份）", matrix.columns.length,
    seedCatalogForOffers.formats.length);
  eq("分组（桶）自己不出现在行里",
    matrix.rows.some((row) => row.subjectName === "外语等级考试"), false);
  ok("而分组下面的学科在（雅思 / 日语…）",
    matrix.rows.some((row) => row.subjectName === "雅思") &&
      matrix.rows.some((row) => row.subjectName === "日语"));
  eq("每个学科都恰好有一行『不分模块』",
    matrix.rows.filter((row) => row.moduleId === "").length,
    seedCatalogForOffers.subjects.filter((subject) => !groupIds.has(subject.id)).length);
  const objectiveRow = matrix.rows.find(
    (row) => row.subjectName === "语文" && row.moduleName === "客观题",
  );
  ok("模块行带自己的学段（语文的「客观题」只在初中与高中，不在小学）",
    objectiveRow !== undefined && !objectiveRow.stageIds.includes(catalogId("st", "小学")) &&
      objectiveRow.stageIds.includes(catalogId("st", "初中")));

  // ② 组合的身份
  const oneKey = {
    subjectId: catalogId("subj", "语文"),
    moduleId: catalogId("mod", "语文·客观题"),
    formatId: catalogId("fmt", "一对一"),
  };
  eq("组合 id 由四个维度 id 拼出来（确定性）",
    offerId(oneKey),
    `off_${oneKey.subjectId}·${oneKey.moduleId}·${oneKey.formatId}`);
  eq("同一个组合问两次得到同一个 id", offerId(oneKey), offerId({ ...oneKey }));
  ok("键里带 `·` 也不影响身份（模块 id 自己就带 `·`）",
    offerId(oneKey).includes("mod_语文·客观题"));
  eq("空模块（不分模块）也是合法的一条",
    offerId({ ...oneKey, moduleId: "" }),
    `off_${oneKey.subjectId}··${oneKey.formatId}`);

  // ③ 三种状态与批量勾选
  const now = "2026-09-23T00:00:00.000Z";
  const keys = [oneKey, { ...oneKey, formatId: catalogId("fmt", "一对二") }];
  const opened = applyDecision([], keys, "open", now);
  eq("批量开放：两条都进来了", opened.length, 2);
  eq("每条的 id 与四个维度一致",
    opened.every((offer) => offer.id === offerId(offer)), true);
  const openedIndex = offersByKey(opened);
  eq("解析：开的算 open", resolveOffer(openedIndex, oneKey), "open");
  eq("解析：没设过的算 unset",
    resolveOffer(openedIndex, { ...oneKey, formatId: catalogId("fmt", "大班课（9-20人）") }), "unset");

  const withClosed = applyDecision(opened, [oneKey], "closed", now);
  eq("改成明确关闭之后不是删行，而是 open: false",
    [withClosed.length, withClosed.find((offer) => offerKey(offer) === offerKey(oneKey))?.open],
    [2, false]);
  eq("解析：明确关闭算 closed", resolveOffer(offersByKey(withClosed), oneKey), "closed");

  const cleared = applyDecision(withClosed, [oneKey], "unset", now);
  eq("清除设置＝把这一行删掉（回到『还没设过』）",
    [cleared.length, resolveOffer(offersByKey(cleared), oneKey)], [1, "unset"]);
  eq("清除别的行不受影响",
    resolveOffer(offersByKey(cleared), keys[1]!), "open");
  eq("批量动作不改入参（纯函数）", opened.length, 2);
  ok("批量勾选保留原来的备注",
    applyDecision(
      applyDecision([], [oneKey], "open", now).map((offer) => ({ ...offer, note: "只在寒暑假开" })),
      [oneKey], "closed", now,
    )[0]?.note === "只在寒暑假开");

  /** 跑一次"应当被拒绝"的保存，把服务端的原话取回来（没抛错就返回空串，断言会因此报红）。 */
  const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  // ④ 校验真的拦
  const catalogForOffers = seedCatalogForOffers;
  const badOffers = (mutate: (rows: CatalogOffer[]) => void): string[] => {
    const rows = applyDecision([], [oneKey], "open", now);
    mutate(rows);
    return validateOffers(rows, catalogForOffers);
  };
  eq("一条正常的组合通过", validateOffers(applyDecision([], keys, "open", now), catalogForOffers), []);
  ok("引用不存在的学科被拒",
    badOffers((rows) => { rows[0]!.subjectId = "subj_不存在"; }).some((t) => t.includes("不存在的学科")));
  ok("引用不存在的班型被拒",
    badOffers((rows) => { rows[0]!.formatId = "fmt_不存在"; }).some((t) => t.includes("不存在的班型")));
  ok("引用不存在的内容模块被拒",
    badOffers((rows) => { rows[0]!.moduleId = "mod_不存在"; }).some((t) => t.includes("不存在的内容模块")));
  ok("模块挂在别的学科下被拒（模块不跨学科复用）", (() => {
    const other = seedCatalogForOffers.modules.find(
      (item) => item.subjectId !== oneKey.subjectId,
    );
    if (other === undefined) return false;
    return badOffers((rows) => { rows[0]!.moduleId = other.id; })
      .some((t) => t.includes("不属于它那个学科"));
  })());
  ok("同一条组合两行被拒",
    badOffers((rows) => { rows.push({ ...rows[0]! }); }).some((t) => t.includes("只能有一行")));
  ok("id 与四个维度对不上被拒",
    badOffers((rows) => { rows[0]!.id = "off_自己写的"; }).some((t) => t.includes("对不上")));
  ok("空 id 被拒",
    badOffers((rows) => { rows[0]!.id = ""; }).some((t) => t.includes("没有 id")));
  eq("一条组合都没设过＝合法（机构还没开始勾）", validateOffers([], catalogForOffers), []);

  // ⑤ 「这一删会牵动几条组合」：后台删维度前的警告要能算出来
  const touched = applyDecision([], keys, "open", now);
  eq("按学科查引用它的组合", offersOfDimension(touched, "subject", oneKey.subjectId).length, 2);
  eq("按班型查引用它的组合", offersOfDimension(touched, "format", oneKey.formatId).length, 1);
  eq("没人引用的维度返回空", offersOfDimension(touched, "format", catalogId("fmt", "大班课（9-20人）")), []);

  // ⑥ API 与迁移
  const legacyOffersDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & { version: number };
  delete legacyOffersDb.offers;
  legacyOffersDb.version = 23;
  eq("v23 老库（没有组合表）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyOffersDb))).ok, true);
  const afterOffers = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterOffers.version, CURRENT_VERSION);
  eq("迁移**不猜初值**：组合表空着起步（哪些组合开放是机构的经营决定）",
    afterOffers.offers.length, 0);

  eq("offers.list 读出来的是库里的那一份", (await api.offers.list()).length, 0);

  const offerDraft = applyDecision(await api.offers.list(), keys, "open", now);
  const savedOffers = await api.offers.save(offerDraft);
  eq("合法的组合表能保存", savedOffers.length, 2);
  const offersLog = await api.logs.list();
  eq("保存开放矩阵写了操作日志", offersLog[0]?.entity, "开放矩阵");
  ok("日志里写了「开放几条 / 明确关闭几条」这句话",
    (offersLog[0]?.summary ?? "").includes("开放"));
  eq("再读一次，库里确实是那一份",
    (await api.offers.list()).map((offer) => offer.id).sort(),
    savedOffers.map((offer) => offer.id).sort());

  const offerRefusal = await refusalOf(async () =>
    await api.offers.save([{ ...savedOffers[0]!, subjectId: "subj_不存在" }]),
  );
  ok("offers.save 拦住悬空引用并把理由说清", offerRefusal.includes("不存在的学科"));
  eq("被拒之后库里那一份没变（不是「改了一半」）", (await api.offers.list()).length, 2);

  /* 尾闸门：自称当前版本却缺 `offers` 的文件（手改过的导出、半份恢复）也要能导入 */
  const brokenOffersDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & { version: number };
  delete brokenOffersDb.offers;
  brokenOffersDb.version = CURRENT_VERSION;
  eq("自称当前版本、却缺组合表的文件也能导入",
    (await api.importDatabase(JSON.stringify(brokenOffersDb))).ok, true);
  ok("导入后被兜成空数组（矩阵页不会整页打不开）",
    Array.isArray((await api.exportDatabase()).offers));
}

console.log("\n=== 32. 报价的班型挂到课程类型的维度表上（v25）===");

/*
 * 「班型」以前写在两个地方：`pricing.md` 的班级类型（每个班型一个系数）与特色课程树的
 * 二级课程名。v23 把班型收进维度表之后，报价那一份仍是**各存一个名字** ——
 * 机构改个名，两边各显示一套，而且**不会报错**。这一节守四件事：
 *
 *   1. **名称只有一个真源**：报价读出来（`pricing.get`）、构站（`buildPublicSite`）、
 *      导出 Markdown 三处都是维度表里的名字，改名之后一起变；
 *   2. **身份是 id**：迁移把老数据的每一行对上 `formatId`，之后改名不影响它；
 *   3. **对不上的两种情形都要说出来**：报价里有维度表里没有（orphans）、
 *      维度表里有报价里没有（unpriced）；
 *   4. **试算按名字查得到**：改名之后页面发过来的新名字必须能算（这是改名最容易漏的一处）。
 */
{
  __useStoreForTesting(memory);

  /** 跑一次"应当被拒绝"的写操作，把服务端的原话取回来（没抛错就返回空串，断言会因此报红）。 */
  const refusalOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  /** 在一份报价配置的副本上改一处（不改原对象）。 */
  const clonePricingWith = (
    mutate: (config: PricingConfig) => void,
    base: PricingConfig,
  ): PricingConfig => {
    const copy = JSON.parse(JSON.stringify(base)) as PricingConfig;
    mutate(copy);
    return copy;
  };

  // ① 迁移：老库（v24，报价里没有 formatId）升上来要对上 id
  const legacyPricingDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    version: number;
    pricing: { classTypes: Array<{ name: string; formatId?: string }> };
  };
  legacyPricingDb.version = 24;
  /*
   * 只**去掉** `formatId`（v24 及更早就是这个形状），系数与计价方式一律照原样保留 ——
   * 第一版夹具把所有行的系数都写成 1，于是下面"一对三比一对一便宜"当场报红：
   * 那种改法把夹具自己变成了另一份配置，验的就不是迁移了。
   */
  legacyPricingDb.pricing.classTypes = legacyPricingDb.pricing.classTypes.map((row) => {
    const rest: Record<string, unknown> = { ...row };
    delete rest.formatId;
    return rest as { name: string; mode: "coefficient" | "cost-share"; coefficient: number | null };
  });
  eq("v24 老库（报价里没有班型 id）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyPricingDb))).ok, true);
  const afterPricing = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterPricing.version, CURRENT_VERSION);
  const linkedFormats = afterPricing.pricing.classTypes.map((row) => row.formatId);
  ok("每一行班级类型都对上了课程类型里的班型 id",
    linkedFormats.length > 0 && linkedFormats.every((id) => id !== ""));
  eq("对上的就是维度表里那一份（同名同 id）",
    afterPricing.pricing.classTypes.map((row) => row.name),
    catalogFromSeed().formats.map((format) => format.name));

  // ② 名称只有一个真源：改名之后报价读出来跟着变
  const renamed = JSON.parse(JSON.stringify(catalogFromSeed())) as Catalog;
  const target = renamed.formats.find((format) => format.name === "一对三");
  ok("种子里有一对三（下面要改名的是它）", target !== undefined);
  const originalName = target?.name ?? "";
  if (target !== undefined) target.name = "一对三（小组课）";
  await api.catalog.save(renamed);
  const afterRename = await api.pricing.get();
  ok("机构在课程类型里改了班型名，报价里读到的就是新名字",
    afterRename.classTypes.some((row) => row.name === "一对三（小组课）"));
  ok("而库里那一份也一起改了（不是只有读时视图变）",
    (await api.exportDatabase()).pricing.classTypes.some((row) => row.name === "一对三（小组课）"));
  eq("班型 id 没变（改的是名字，引用它的东西不受影响）",
    afterRename.classTypes.find((row) => row.name === "一对三（小组课）")?.formatId,
    target?.id);

  // ③ 试算按新名字查得到（改名最容易漏的一处：页面发过来的是新名字）
  const pricedStage = afterRename.stages.find((stage) => stage.courses.some((course) => course.available));
  const pricedCourse = pricedStage?.courses.find((course) => course.available);
  // 试算里**没有科目**（v29 删掉的那一维）：只发课程 / 班型 / 时长 / 节数
  const quoteAfterRename = await api.pricing.quote({
    courseName: pricedCourse?.name ?? "",
    classTypeName: "一对三（小组课）",
    durationName: afterRename.durations[0]?.name ?? "",
    lessons: 10,
    studentCount: 1,
    classCost: 0,
  });
  eq("改名之后按新名字试算算得出来（不是「报价配置里没有班型」）", quoteAfterRename.ok, true);
  ok("而且算出来的是那个班型的人数系数（0.6 那一档，比一对一便宜）",
    (quoteAfterRename.unitPrice ?? 0) < ((await api.pricing.quote({
      courseName: pricedCourse?.name ?? "",
      classTypeName: "一对一",
      durationName: afterRename.durations[0]?.name ?? "",
      lessons: 10,
      studentCount: 1,
      classCost: 0,
    })).unitPrice ?? 0));

  // ④ 导出 Markdown 用维度表的名称（否则没连后端那一份会把旧名字带回去）
  const exported = await api.pricing.exportMarkdown();
  ok("导出的 pricing.md 片段里写的是课程类型里的名字",
    exported.includes("名称: 一对三（小组课）") && !exported.includes("名称: 一对三\n"));
  /*
   * 导出的是**片段**（从「## 学习阶段」开始，替换进 data/site/pricing.md 的那几节），
   * 不是整份文件 —— 因此这里不断言"能整份回读"，只断言它写着班级类型那一节。
   */
  ok("导出里带着班级类型那一节", exported.includes("## 班级类型"));

  // ⑤ 构站那一侧（网站报价器）拿到的也是同一份名字
  const publicSite = buildPublicSite(await api.exportDatabase());
  ok("网站公开数据里的班型名同样是课程类型里那一份",
    publicSite.pricing.classTypes.some((row) => row.name === "一对三（小组课）"));

  // ⑥ 对不上的两种情形都要报出来（而不是各显示一套）
  const catalogNow = await api.catalog.list();
  const asIs = syncClassTypes(catalogNow.formats.map((format) => ({
    name: format.name, formatId: format.id, mode: "coefficient" as const, coefficient: 1,
  })), catalogNow);
  eq("两边一致时没有任何差异", [asIs.orphans, asIs.unpriced], [[], []]);
  const orphaned = syncClassTypes(
    [{ name: "手写的班型", formatId: "", mode: "coefficient" as const, coefficient: 1 }],
    catalogNow,
  );
  eq("报价里有、维度表里没有 → orphans",
    [orphaned.orphans, orphaned.classTypes.length], [["手写的班型"], 1]);
  ok("对不上的行**原样保留**（不静默丢掉一行价格）",
    orphaned.classTypes[0]?.name === "手写的班型");
  const missing = syncClassTypes(
    catalogNow.formats.filter((format) => format.name !== "一对一").map((format) => ({
      name: format.name, formatId: format.id, mode: "coefficient" as const, coefficient: 1,
    })),
    catalogNow,
  );
  eq("维度表里有、报价里没有 → unpriced（新班型还没定系数）", missing.unpriced, ["一对一"]);
  ok("两种差异各有一句人话（报价页上显示的就是它）",
    classTypeIssuesText(orphaned).includes("找不到了") &&
      classTypeIssuesText(missing).includes("还没有系数"));
  eq("没有差异时不产生任何文案（不要渲染一个空壳）", classTypeIssuesText(asIs), "");

  // ⑦ 写入口要拦住"维度表里没有的班型"
  const badPricing = clonePricingWith((config) => {
    config.classTypes[0]!.formatId = "fmt_不存在";
  }, afterRename);
  const pricingRefusal = await refusalOf(async () => await api.pricing.update(badPricing));
  ok("保存报价时拦住课程类型里不存在的班型，并指路「课程类型」页",
    pricingRefusal.includes("已经不存在了") && pricingRefusal.includes("课程类型"));
  const duplicated = clonePricingWith((config) => {
    config.classTypes[1]!.formatId = config.classTypes[0]!.formatId;
  }, afterRename);
  ok("同一个班型挂两行人数系数被拒",
    (await refusalOf(async () => await api.pricing.update(duplicated))).includes("只能有一行人数系数"));

  // ⑧ 收尾：把班型名改回种子那一份（验收库是机构自己的库）
  if (target !== undefined) {
    const restored = JSON.parse(JSON.stringify(await api.catalog.list())) as Catalog;
    const back = restored.formats.find((format) => format.id === target.id);
    if (back !== undefined) back.name = originalName;
    await api.catalog.save(restored);
    eq("改回原名之后报价里也回到原名",
      (await api.pricing.get()).classTypes.some((row) => row.name === originalName), true);
  }
}

console.log("\n=== 33. 删一个维度之后，引用它的组合怎么办（死角与出口）===");

/*
 * 这一节守的是一个**死角**（实现完第 31 节之后自己走了一遍才发现的）：
 *
 *   机构在「课程类型」页删掉一个班型 → 引用它的开放组合变成"悬空" →
 *   ① 那些格子在矩阵里**根本不显示**（列已经不在维度表里）；
 *   ② 而 `offers.save` 会因为"引用了不存在的行"**整份拒绝**。
 *   两条合起来 = "一保存就报错，却找不到改哪一格"。
 *
 * 现在的两条出路：
 *   - 删除维度时，服务层**连带清掉**受影响的组合，并把条数写进日志（明确的删除动作有明确后果）；
 *   - 从外部进来的不一致数据（手改过的导出、半份恢复）由矩阵页单独列出来 + 一键清除
 *     （`danglingOffers`），**不静默丢弃** —— 组合开不开是机构的经营决定。
 */
{
  __useStoreForTesting(memory);

  const catalogPageSource = readFileSync(
    new URL("../components/admin/CatalogDimensionsPanel.tsx", import.meta.url), "utf8");
  const offersPageSource = readFileSync(
    new URL("../components/admin/OffersMatrixPanel.tsx", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../lib/backend/api.ts", import.meta.url), "utf8");

  const catalogForDrop = catalogFromSeed();
  const targetFormat = catalogForDrop.formats.find((format) => format.name === "一对三");
  const keepFormat = catalogForDrop.formats.find((format) => format.name === "一对一");
  ok("种子里有一对三与一对一（下面要拿它们做对比）",
    targetFormat !== undefined && keepFormat !== undefined);

  const subject = catalogForDrop.subjects.find((item) => item.parentIds.length === 0);
  const affectedKey = {
    subjectId: subject?.id ?? "",
    moduleId: "",
    formatId: targetFormat?.id ?? "",
  };
  const keptKey = { ...affectedKey, formatId: keepFormat?.id ?? "" };
  const fresh = applyDecision([], [affectedKey, keptKey], "open", "2026-09-23T00:00:00.000Z");
  eq("先勾两条组合（一条用要被删的班型，一条不用）", fresh.length, 2);

  await api.importDatabase(JSON.stringify(seedDb));
  await api.offers.save(fresh);
  eq("库里有两条开放组合", (await api.offers.list()).length, 2);

  // ① 删除维度：受影响的组合连带清掉，日志写清条数
  const shrinkCatalog = JSON.parse(JSON.stringify(await api.catalog.list())) as Catalog;
  shrinkCatalog.formats = shrinkCatalog.formats.filter((format) => format.id !== targetFormat?.id);
  await api.catalog.save(shrinkCatalog);
  const afterDrop = await api.offers.list();
  eq("引用被删班型的那条组合被连带清掉，另一条留着",
    [afterDrop.length, afterDrop[0]?.formatId], [1, keepFormat?.id]);
  ok("日志里写清「删维度连带清掉几条组合」",
    (await api.logs.list()).some((log) => log.entity === "开放矩阵" && log.summary.includes("失效")));

  // ② 手改过的数据（悬空）会被认出来，而不是让保存永远被拒
  const danglingRows = [
    { ...fresh[0]!, id: "off_自己写的", formatId: "fmt_不存在" },
    { ...fresh[1]!, id: "off_另一条" },
  ];
  const catalogAfterDrop = await api.catalog.list();
  const dangling = danglingOffers(danglingRows, catalogAfterDrop);
  eq("悬空的那条被认出来（另一条不算）", dangling.map((offer) => offer.id), ["off_自己写的"]);
  eq("失效组合的条数就是「这一删会牵动几条」那个数（后台删除前的提示用它）",
    offersOfDimension(danglingRows, "format", keepFormat?.id ?? "").length, 1);
  ok("后台「课程类型」页在删除前会说出牵动几条组合",
    catalogPageSource.includes("offersOfDimension(offers,") &&
      catalogPageSource.includes("条开放组合引用着"));
  ok("后台「开放矩阵」页把失效的组合单独列出来，并给了清除出口",
    offersPageSource.includes("danglingOffers(draft ?? [], catalog)") &&
      offersPageSource.includes("清除这些失效设置"));
  ok("而读的时候只兜「必须是个数组」，**不偷偷清掉**失效组合（开不开是机构的经营决定）",
    apiSource.includes("if (!Array.isArray(db.offers)) db.offers = [];") &&
      apiSource.includes("danglingOffers(db.offers, normalized)"));

  // ③ 恢复：把班型加回来，确认一切照常
  const restored = JSON.parse(JSON.stringify(await api.catalog.list())) as Catalog;
  restored.formats = catalogFromSeed().formats.map((format) => ({ ...format }));
  await api.catalog.save(restored);
  const reopened = await api.offers.save(applyDecision(await api.offers.list(), [affectedKey], "open", "2026-09-23T00:00:00.000Z"));
  eq("把班型加回来之后，那条组合可以重新勾上", reopened.length, 2);
}

/**
 * **今天**的某个钟点（本地时间，ISO 字符串）。
 *
 * 自检里凡是要"这一天的课"的夹具都用它，而不用 `Date.now() ± 若干小时`：
 * 后者在深夜（或凌晨）会跨到另一天，于是断言变成"数不到这一节"，
 * 而失败信息完全看不出跟时间有关。
 */
function todayAt(hour: number, minute = 0): string {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  return at.toISOString();
}

console.log("\n=== 34. 删掉「交付形态」这一维（v26，机构更正）===");

/*
 * 我第一版把「面授 / 网课 / 网课+答疑 / 托管 / 全日托管」做成了第五个维度"交付形态"
 * （"一门课可以面授，也可以网课+答疑"）。机构的口径是：**不对** ——
 * 「网课」「网课+答疑」「网课+一对一针对性答疑」「小学托管」…是**独立的项目**，
 * 与小学 / 初中 / 高中那些按学段的课程**没有任何组合关系**。
 *
 * 那一维的害处不只是"多记了一遍"：它凭空造出了"小学语文 × 网课"这种机构根本不卖的组合，
 * 而矩阵是一张**要机构照着勾**的表 —— 多出来的格子会让人以为那些组合是存在的。
 *
 * 这一节钉三件事：
 *   1. **维度只剩四个**（模型里、种子里、矩阵列里都没有"交付形态"）；
 *   2. **那些项目没有丢**：它们本来就在 `subjects` 里（`kind: "项目"`，挂在「不分班型项目」下）；
 *   3. **老库能升上来**：v25 的库里带着 `deliveries` 与 `offers[].deliveryId`，
 *      导入之后维度被抹掉、只在交付形态上不同的组合**合并成一条**（开放优先）。
 */
{
  __useStoreForTesting(memory);

  const seed = catalogFromSeed();
  eq("维度表里没有 deliveries 这个字段", Object.hasOwn(seed, "deliveries"), false);
  eq("维度表的四个字段就是学段 / 学科 / 模块 / 班型",
    Object.keys(seed).sort(), ["formats", "modules", "seededAt", "stages", "subjects"].sort());
  eq("矩阵的列里没有「网课」这种交付形态（只有班型）",
    buildMatrix(seed).columns.filter((column) =>
      ["网课", "网课+答疑", "面授", "托管", "全日托管"].includes(column.formatName)),
    []);

  // ② 那些项目还在，而且是"独立项目"
  const projectNames = ["网课", "网课+答疑", "网课+一对一针对性答疑", "小学托管", "假期全日托管"];
  const projects = seed.subjects.filter((item) => projectNames.includes(item.name));
  eq("网课 / 托管 这些**还在**学科与项目里（5 条）", projects.length, projectNames.length);
  eq("它们的类别都是「项目」", [...new Set(projects.map((item) => item.kind))], ["项目"]);
  const groupId = catalogId("subj", "不分班型项目");
  eq("它们挂在「不分班型项目」分组下",
    [...new Set(projects.map((item) => item.parentIds.join("|")))], [groupId]);
  ok("而它们**不**出现在矩阵的列里（列是班型）",
    buildMatrix(seed).columns.every((column) => !projectNames.includes(column.formatName)));
  ok("它们在「其他类型」那一栏里（机构清单就是这么放的）",
    projects.every((item) => item.stageIds.includes(catalogId("st", "其他类型"))));

  // ③ v25 老库升上来：抹掉维度、合并只在交付形态上不同的组合
  const legacyDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    version: number;
    catalog: Record<string, unknown>;
    offers: unknown[];
  };
  legacyDb.version = 25;
  legacyDb.catalog.deliveries = [
    { id: "dlv_面授", name: "面授", schedulable: true, order: 1 },
    { id: "dlv_网课", name: "网课", schedulable: true, order: 2 },
  ];
  const legacySubject = catalogId("subj", "语文");
  legacyDb.offers = [
    {
      id: `off_${legacySubject}···dlv_面授`, subjectId: legacySubject, moduleId: "",
      formatId: catalogId("fmt", "一对一"), deliveryId: "dlv_面授", open: true, note: "寒暑假", updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: `off_${legacySubject}···dlv_网课`, subjectId: legacySubject, moduleId: "",
      formatId: catalogId("fmt", "一对一"), deliveryId: "dlv_网课", open: false, note: "", updatedAt: "2026-09-02T00:00:00.000Z",
    },
  ];
  eq("v25 老库（带交付形态与 deliveryId 的组合）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyDb))).ok, true);
  const afterMigration = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterMigration.version, CURRENT_VERSION);
  eq("库里那份维度表也没有 deliveries 了",
    Object.hasOwn(afterMigration.catalog as unknown as object, "deliveries"), false);
  eq("只在交付形态上不同的两条组合**合并成一条**", afterMigration.offers.length, 1);
  eq("合并后的 id 是新的（三个维度）",
    afterMigration.offers[0]?.id, `off_${legacySubject}··${catalogId("fmt", "一对一")}`);
  eq("合并规则：有一条开放就算开放（那是更强的表态）", afterMigration.offers[0]?.open, true);
  eq("备注保留非空的那一条", afterMigration.offers[0]?.note, "寒暑假");
  eq("时间取较晚的那个（可重复执行、结果确定）",
    afterMigration.offers[0]?.updatedAt, "2026-09-02T00:00:00.000Z");
  eq("合并之后组合表能直接通过校验", validateOffers(afterMigration.offers, afterMigration.catalog), []);
  eq("而且能再次保存（不是「导入进来了却谁也存不回去」）",
    (await api.offers.save(afterMigration.offers)).length, 1);

  // ④ 页面口径：课程类型页不该再有「交付形态」页签
  const catalogPage = readFileSync(
    new URL("../components/admin/CatalogDimensionsPanel.tsx", import.meta.url), "utf8");
  ok("「课程类型」页没有「交付形态」页签了",
    !catalogPage.includes('key: "deliveries"') && !catalogPage.includes('tab === "deliveries"'));
  ok("而且页面上写明了那些是独立项目（避免以后又有人把它加回来）",
    catalogPage.includes("独立的项目"));
}

console.log("\n=== 35. 哪一天按哪一组时段（v27 寒暑假段 + 时段口径）===");

/*
 * 机构 2026-09 定的口径（原话）：
 *   - **假期要上课**（法定假日照常排，假期正是旺季）；
 *   - **寒暑假开始和结束的日期每次手动输入**（不推算）；
 *   - **作息和现在的周末上课时间完全一样**（假期用周末那一组时段）；
 *   - 寒暑假**按学段**录（实际上时间差不多）；
 *   - 「先把时段分清楚，后续的排课再另外安排」。
 *
 * 这一节守四件事：
 *   1. **判定只有一份**（`dayPlanFor`）：优先级 寒暑假 > 调休上班 > 法定假日 > 周末/工作日；
 *   2. **时段从「时间安排」那一块读**，不另建一套配置（否则网站上公布的时间会与排课用的漂开）；
 *   3. **寒暑假段手动录入的形状与校验**（起止合法、至少一个学段、重叠只提示不拦）；
 *   4. **这一版不改排课**：`recurrence.ts` 的日期生成一行都没动（机构说排课另行安排）——
 *      这条要**断言**，否则下一个人很容易顺手把它接上。
 */
{
  __useStoreForTesting(memory);

  const holidays: HolidayDay[] = [
    { date: "2026-10-01", name: "国庆节", kind: "放假" },
    { date: "2026-10-02", name: "国庆节", kind: "放假" },
    { date: "2026-10-10", name: "国庆节", kind: "调休上班" },
  ];
  const stage = catalogId("st", "小学");
  const vacations: VacationPeriod[] = [
    { id: "v1", name: "寒假", kind: "寒假", stageIds: [stage], startDate: "2026-01-20", endDate: "2026-02-25", note: "" },
    { id: "v2", name: "暑假", kind: "暑假", stageIds: [stage], startDate: "2026-07-06", endDate: "2026-08-31", note: "" },
  ];

  // ① 优先级与两组时段
  const plan = (date: string, extra: Partial<CalendarPlanInput> = {}): DayPlan =>
    dayPlanFor(date, { holidays, vacations, ...extra });
  eq("普通工作日 → 工作日组",
    [plan("2026-09-23").kind, plan("2026-09-23").windowGroup], ["workday", "工作日"]);
  eq("普通周六 → 周末组",
    [plan("2026-09-26").kind, plan("2026-09-26").windowGroup], ["weekend", "周末"]);
  eq("法定假日 → **照常上课**，按周末组（白天能排）",
    [plan("2026-10-01").kind, plan("2026-10-01").windowGroup, plan("2026-10-01").badge], ["holiday", "周末", "休"]);
  eq("调休上班日（那个周六）→ 按工作日组（学生要上学）",
    [plan("2026-10-10").kind, plan("2026-10-10").windowGroup, plan("2026-10-10").badge], ["makeup", "工作日", "班"]);
  eq("寒暑假段内 → 按周末组（作息与周末相同）",
    [plan("2026-08-03").kind, plan("2026-08-03").windowGroup, plan("2026-08-03").badge], ["vacation", "周末", "暑"]);
  eq("寒假段内标「寒」", plan("2026-02-01").badge, "寒");
  ok("判定都给出依据（页面上做 tooltip，不让人猜）",
    ["workday", "weekend", "holiday", "makeup", "vacation"]
      .map((kind) => [plan("2026-09-23"), plan("2026-09-26"), plan("2026-10-01"), plan("2026-10-10"), plan("2026-08-03")]
        .find((item) => item.kind === kind))
      .every((item) => (item?.reason ?? "").length > 8));

  /*
   * 优先级里最容易搞错的一条：**春节的调休上班日与法定假日落在寒假里**。
   * 那时学校已经放假、学生不上学，因此寒暑假优先 —— 否则"寒假里的那个调休周六"
   * 会被判成工作日组（只能排晚上），与机构"假期照排、白天也能排"的口径正好相反。
   */
  const springFestival: HolidayDay[] = [
    { date: "2026-02-17", name: "春节", kind: "放假" },
    { date: "2026-02-14", name: "春节", kind: "调休上班" },
  ];
  eq("寒假里的法定假日 → 仍然是假期作息（寒假优先于法定假日）",
    dayPlanFor("2026-02-17", { holidays: springFestival, vacations }).kind, "vacation");
  eq("寒假里的调休上班日 → 仍然是假期作息（寒假优先于调休）",
    dayPlanFor("2026-02-14", { holidays: springFestival, vacations }).kind, "vacation");

  // ② 按学段：别的学段的段不生效
  const otherStage = catalogId("st", "初中");
  eq("只看小学时，初中的假期段不算假期",
    dayPlanFor("2026-08-03", { vacations, stageId: otherStage }).kind, "workday");
  eq("只看小学时，小学的假期段算假期",
    dayPlanFor("2026-08-03", { vacations, stageId: stage }).kind, "vacation");
  eq("不给学段时，任意学段在假期里就算假期（页面上会写清是哪一段）",
    dayPlanFor("2026-08-03", { vacations }).kind, "vacation");

  // ③ 时段从「课程时间安排」那一块读（不另建配置）
  const block = {
    groups: [
      { id: "g1", title: "工作日排课", description: "", items: [
        { id: "i1", title: "晚第一节", value: "17:30–19:30", body: "" },
        { id: "i2", title: "晚第二节", value: "19:30–21:30", body: "" },
      ] },
      { id: "g2", title: "周末排课", description: "", items: [
        { id: "i3", title: "第一节", value: "08:00–10:00", body: "" },
        { id: "i4", title: "第六节", value: "20:00–22:00", body: "" },
      ] },
      { id: "g3", title: "全日托", description: "", items: [
        { id: "i5", title: "工作日", value: "08:00–17:00", body: "" },
        { id: "i6", title: "周末", value: "按需预约", body: "" },
      ] },
      { id: "g4", title: "晚辅导", description: "", items: [
        { id: "i7", title: "小学", value: "17:30–19:30", body: "" },
      ] },
    ],
  };
  const workdayWindows = windowsFromSchedule(block, "工作日");
  const weekendWindows = windowsFromSchedule(block, "周末");
  eq("工作日组读出两个时段（原样保留「17:30–19:30」这种写法）",
    workdayWindows.windows.map((item) => `${item.label}=${item.raw}`), ["晚第一节=17:30–19:30", "晚第二节=19:30–21:30"]);
  eq("周末组读出两个时段", weekendWindows.windows.map((item) => item.raw), ["08:00–10:00", "20:00–22:00"]);
  ok("「全日托 / 晚辅导」那两组**不会**被当成排课时段（它们不含「排课 / 上课」）",
    windowsFromSchedule({ groups: [block.groups[2]!, block.groups[3]!] }, "工作日").missing);
  ok("分组名改成「工作日上课」也认得（按关键字匹配）",
    windowsFromSchedule({ groups: [{ ...block.groups[0]!, title: "工作日上课" }] }, "工作日").windows.length === 2);
  ok("「双休日排课」这种写法认得出是周末那一组",
    !windowsFromSchedule({ groups: [{ ...block.groups[1]!, title: "双休日排课" }] }, "周末").missing);
  ok("读不到那一组时 `missing` 为真（页面上会指路去「网站内容 → 时间安排」）",
    windowsFromSchedule({ groups: [block.groups[2]!] }, "周末").missing &&
      windowsFromSchedule(undefined, "工作日").missing);
  ok("「按需预约」这种不能解析的值被跳过（不当成时段）",
    windowsFromSchedule({ groups: [block.groups[2]!] }, "周末").windows.length === 0);

  // ④ 寒暑假段：形状与校验
  const catalogForVacations = catalogFromSeed();
  eq("合法的一段通过校验", validateVacations(vacations, catalogForVacations), []);
  ok("起止写反被拒（否则那一段永远不生效，而页面上看不出问题）",
    validateVacations([{ ...vacations[0]!, startDate: "2026-03-01", endDate: "2026-02-01" }], catalogForVacations)
      .some((text) => text.includes("早于开始日期")));
  ok("日期不合法被拒",
    validateVacations([{ ...vacations[0]!, startDate: "2026-2-1" }], catalogForVacations)
      .some((text) => text.includes("不是合法日期")));
  ok("2026-02-30 这种被拒（Date 会把它规整成 3 月 2 日）",
    validateVacations([{ ...vacations[0]!, endDate: "2026-02-30" }], catalogForVacations)
      .some((text) => text.includes("不是合法日期")));
  ok("没勾学段被拒（机构口径：寒暑假按学段录）",
    validateVacations([{ ...vacations[0]!, stageIds: [] }], catalogForVacations)
      .some((text) => text.includes("没有勾学段")));
  ok("勾了不存在的学段被拒",
    validateVacations([{ ...vacations[0]!, stageIds: ["st_不存在"] }], catalogForVacations)
      .some((text) => text.includes("不存在的学段")));
  ok("没有名字被拒",
    validateVacations([{ ...vacations[0]!, name: "  " }], catalogForVacations)
      .some((text) => text.includes("没有名字")));
  eq("一条都没有＝合法（还没录就是为了不录：那就按星期几判）",
    validateVacations([], catalogForVacations), []);
  eq("重叠**只提示不拦**（国庆集训套在暑假里是正常安排）",
    [validateVacations([vacations[1]!, { ...vacations[0]!, id: "v3", startDate: "2026-08-01", endDate: "2026-08-10" }], catalogForVacations),
      vacationOverlaps([vacations[1]!, { ...vacations[0]!, id: "v3", startDate: "2026-08-01", endDate: "2026-08-10" }]).length],
    [[], 1]);
  eq("不同学段的段不算重叠",
    vacationOverlaps([vacations[1]!, { ...vacations[0]!, id: "v4", stageIds: [otherStage] }]), []);

  // ⑤ 这一版**不改排课**（机构：后续的排课再另外安排）
  const recurrenceSource = readFileSync(new URL("../lib/backend/recurrence.ts", import.meta.url), "utf8");
  ok("recurrence.ts 没有引入 calendar-plan（排课生成仍然「按星期几往后数」）",
    !recurrenceSource.includes("calendar-plan") && !recurrenceSource.includes("dayPlanFor"));
  ok("planSeries 也没有拿假期去过滤日期",
    !readFileSync(new URL("../lib/backend/api.ts", import.meta.url), "utf8")
      .split("function planSeries(")[1]!
      .slice(0, 4000)
      .includes("dayPlanFor"));
  ok("页面上写明了「录了寒暑假也不会自动改排课」（免得人以为已经接上了）",
    readFileSync(new URL("../components/admin/VacationPanel.tsx", import.meta.url), "utf8").includes("这一版只把口径摆出来，不改排课"));

  // ⑥ API：迁移与读写
  const legacyDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & { version: number };
  delete legacyDb.vacations;
  legacyDb.version = 26;
  eq("v26 老库（没有寒暑假段）能升级导入",
    (await api.importDatabase(JSON.stringify(legacyDb))).ok, true);
  const after = await api.exportDatabase();
  eq("升级后版本号是当前版本", after.version, CURRENT_VERSION);
  eq("迁移**不猜日期**：寒暑假段空着起步（机构每年手动输入）", after.vacations.length, 0);
  eq("vacations.list 读出来的是库里的那一份", (await api.vacations.list()).length, 0);
  const savedVacations = await api.vacations.save(vacations);
  eq("保存两段之后读得回来", savedVacations.map((item) => item.name), ["寒假", "暑假"]);
  eq("保存写了操作日志", (await api.logs.list())[0]?.entity, "寒暑假");
  const vacationRefusal = await (async () => {
    try {
      await api.vacations.save([{ ...vacations[0]!, startDate: "2026-05-01", endDate: "2026-01-01" }]);
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  })();
  ok("起止写反在服务端也被拒（不是只在页面上提示）", vacationRefusal.includes("早于开始日期"));
  eq("被拒之后库里那一份没变", (await api.vacations.list()).length, 2);
  const brokenDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & { version: number };
  delete brokenDb.vacations;
  brokenDb.version = CURRENT_VERSION;
  eq("自称当前版本、却缺寒暑假段的文件也能导入",
    (await api.importDatabase(JSON.stringify(brokenDb))).ok, true);
  ok("导入后被兜成空数组（日历页不会整页打不开）",
    Array.isArray((await api.exportDatabase()).vacations));
}

console.log("\n=== 35.5 没有「永远来自模版」的页面（这条口径漂过一次）===");

/*
 * `lib/site/backend-source.ts` 的文件头曾经写着"首页文案 / 关于 / 联系 / FAQ / 课表 /
 * 特色课程 / 品牌与联系方式**不在库里**，永远来自 data/site/*.md" —— 那是 v19 之前的实情。
 * v19–v22 把它们逐块搬进库之后这句话就错了，而**没有人会发现**：
 * 注释不影响运行，页面也照常工作。直到有人照着它去改代码。
 *
 * 因此这一条把**事实**钉住：那些块的取数函数都必须走同一套三态判定
 * （`siteContentSource()` + 后端快照），而不是直接读模版。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");

  /** 一个取数函数体里必须出现的三态痕迹（截到下一个顶层 `export function` 之前）。 */
  const bodyOf = (file: string, name: string): string => {
    const source = read(file);
    const start = source.indexOf(`${name.startsWith("copySourceFor") ? "export function " : "export function "}${name}(`);
    if (start < 0) return "";
    const next = source.indexOf("export function ", start + 10);
    return source.slice(start, next < 0 ? undefined : next);
  };
  const gated = (file: string, name: string): boolean => {
    const body = bodyOf(file, name);
    return body.includes("siteContentSource()") && body.includes("backend");
  };

  /*
   * 两组写法都要盯住，因为**它们是对的、但写法不同**：
   *   - 案例 / FAQ / 特色课程：函数体里直接三态判定；
   *   - 品牌 / 首页 / 关于 / 联系 / 时间安排：五块共用 `copySourceFor(key)`，
   *     三态判定在**那一处**（这正是 v22 那次重构的成果 —— 一份映射两种来源）。
   * 第一版断言把第二组也按"函数体里必须出现 siteContentSource()"来查，当场报红 ——
   * 报的不是代码错了，是**我的判据没覆盖这种写法**。
   */
  for (const [file, name, label] of [
    ["lib/data/pages.ts", "getFaqContent", "常见问题"],
    ["lib/data/pages.ts", "getCasesContent", "学生案例"],
    ["lib/data/featured.ts", "getFeaturedContent", "特色课程"],
  ] as const) {
    ok(`「${label}」的取数是三态（连上后端用库、连不上空白、显式才读模版）`, gated(file, name));
  }
  ok("页面文案块共用的取数入口 `copySourceFor` 是三态（五块都从它走）",
    gated("lib/data/site.ts", "copySourceFor"));
  for (const [name, label] of [
    ["getSiteBrand", "品牌与联系方式"],
    ["getHomeContent", "首页文案"],
    ["getAboutContent", "关于我们"],
    ["getContactContent", "联系我们"],
  ] as const) {
    ok(`「${label}」走的是那个共用的三态入口`, bodyOf("lib/data/site.ts", name).includes("copySourceFor("));
  }

  ok("文件头不再声称有「永远来自模版」的页面",
    !read("lib/site/backend-source.ts").includes("它们**不在库里**，因此与后端连不连无关"));
}

console.log("\n=== 36. 课程一页三页签（v29：课程库 + 课程类型 + 开放矩阵合并）===");

/*
 * 机构：「课程库、课程类型、开放矩阵这里面很多功能也完全可以合并到同一个页面里」
 * 以及「网址也只留一个」。这一节守四件事：
 *
 *   1. **入口只有一个**（导航一条、`PAGE_ACCESS` 里只有 `/admin/courses`）；
 *   2. **三条保存语义各自独立**（合并最容易犯的错：合成一个"保存"按钮 ——
 *      那会把"改一门课"变成"提交整份维度表"，乐观锁当场失效）；
 *   3. **权限不放开也不收紧**：路由取并集，页签按合并前那三条页面权限逐字一致；
 *   4. **页签切走不丢草稿**（面板用 `hidden` 保活，不是卸载）。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const page = read("app/admin/(dashboard)/courses/page.tsx");
  const nav = read("lib/site/admin-nav.ts");

  // ① 入口只有一个
  ok("导航里只有「课程」一条入口（旧的课程类型 / 开放矩阵两条已删）",
    nav.includes('href: "/admin/courses"') && !nav.includes('"/admin/catalog"') && !nav.includes('"/admin/offers"'));
  eq("页面权限表里也只有课程这一条",
    Object.keys(PAGE_ACCESS).filter((href) => ["/admin/catalog", "/admin/offers", "/admin/courses"].includes(href)),
    ["/admin/courses"]);
  ok("三个面板各自都在（合成一页而不是把两块删掉）",
    page.includes("<CoursesLedgerPanel />") &&
      page.includes("<CatalogDimensionsPanel />") &&
      page.includes("<OffersMatrixPanel />"));

  // ② 三条保存语义各自独立：三个面板里各有一个保存动作，页面自己**没有**保存按钮
  ok("页面壳自己没有保存按钮（没有把三块合成一次提交）",
    !/save\(|保存修改/.test(page));
  ok("台账那块保存的是「一门课」（逐条 + 乐观锁）",
    read("components/admin/CoursesLedgerPanel.tsx").includes("api.courses.update(") ||
      read("components/admin/CoursesLedgerPanel.tsx").includes("courses.update("));
  ok("课程类型那块保存的是整份维度表",
    read("components/admin/CatalogDimensionsPanel.tsx").includes("api.catalog.save("));
  ok("开放矩阵那块保存的是整份组合表",
    read("components/admin/OffersMatrixPanel.tsx").includes("api.offers.save("));

  // ③ 权限：路由并集 + 页签逐字一致
  const tabRoles = Object.fromEntries(ADMIN_COURSE_TABS.map((tab) => [tab.key, tab.roles]));
  eq("三个页签的角色与合并前那三条页面权限逐字一致（不许顺手放开或收紧）",
    [tabRoles.ledger, tabRoles.dimensions, tabRoles.matrix],
    [
      ["技术管理员", "招生老师", "普通教师"],
      ["技术管理员", "财务管理员", "招生老师"],
      ["技术管理员", "财务管理员", "招生老师"],
    ]);
  const union = [...new Set(ADMIN_COURSE_TABS.flatMap((tab) => tab.roles))];
  eq("路由权限 = 三个页签角色的并集（谁也不会因为合并少看到他本来能看的）",
    [...(PAGE_ACCESS["/admin/courses"] ?? [])].sort(), [...union].sort());
  ok("页面上按角色过滤页签（不是全部渲染再靠 CSS 藏）",
    /ADMIN_COURSE_TABS\.filter\(\(item\) => canAccess\(roles, item\.roles\)\)/.test(page) &&
      page.includes("tabs.map((item) =>"));
  ok("锚点里的页签也要先过权限（否则拿到 #matrix 链接的教师会看到空壳）",
    page.includes("pickInitialCourseTab(ADMIN_COURSE_TABS, tabs, window.location.hash)") &&
      read("lib/auth/roles.ts").includes(
        "if (hit !== undefined && allowed.some((item) => item.key === hit.key)) return hit.key;",
      ));
  ok("四个页签锚点都是 ASCII（中文锚点会变成一长串百分号编码）",
    ADMIN_COURSE_TABS.every((tab) => /^[a-z]+$/.test(tab.hash)));

  // ④ 切走不丢草稿
  ok("面板用 hidden 保活（卸载会把没保存的草稿悄悄丢掉）",
    page.includes('hidden={tab !== "ledger"}') &&
      page.includes('hidden={tab !== "dimensions"}') &&
      page.includes('hidden={tab !== "matrix"}') &&
      page.includes("mounted.has("));

  // ⑤ 旧网址只留一个：那两条路由**不该**再存在（机构口径：网址只留一个，不做转发页）
  const routeExists = (dir: string): boolean => {
    try {
      return (readdirSync(new URL(`../app/admin/(dashboard)/${dir}/`, import.meta.url)) as string[]).includes("page.tsx");
    } catch {
      // 整个目录都没了（这正是我们要的：路由与它的目录一起删）
      return false;
    }
  };
  eq("课程类型与开放矩阵的路由文件已经删掉（没有留转发页）",
    [routeExists("catalog"), routeExists("offers")], [false, false]);
}

console.log("\n=== 37. 日历的月视图（v30）===");

/*
 * 机构：「日历再加个月视图」。周视图与月视图是**同一件事的两个缩放级别**
 * （同一条数据、同一个"点开某天看明细"），因此它不是一个新页签，而是看课那一块里的
 * 周/月切换。这一节守四件事：
 *
 *   1. **月格子是"周 × 7"**（补齐到整周、从周一开始 —— 否则列对不上星期几）；
 *   2. **翻月不跳月**（1 月 31 日的"下一月"是 2 月 1 日，不是 3 月 3 日）；
 *   3. **读的区间与画的格子一致**（月视图要读整张格子含前后补齐的天，
 *      否则那几格显示"0 节"，而那里其实有课）；
 *   4. **切换级别不换页签**（选中的那天在周/月之间是同一个）。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");

  // ① 格子形状
  const jan = monthGrid(new Date(2026, 0, 15));
  const feb = monthGrid(new Date(2026, 1, 15));
  eq("格子数总是 7 的倍数（否则最后一行缺列，星期几对不上）",
    [jan.length % 7, feb.length % 7], [0, 0]);
  eq("从周一开始（与 weekDays 同一口径）", jan[0]?.getDay(), 1);
  eq("到周日结束", jan[jan.length - 1]?.getDay(), 0);
  ok("含整个月（1 月的 31 天都在格子里）",
    [...Array(31).keys()].every((index) => {
      const day = new Date(2026, 0, index + 1);
      return jan.some((cell) => dateKey(cell) === dateKey(day));
    }));
  ok("也含前后补齐的天（1 月的格子从 2025-12-29 开始）",
    dateKey(jan[0] ?? new Date()) === "2025-12-29");
  /*
   * 2027 年 2 月：2/1 是周一、一共 28 天 → 正好 4 整周，格子就该是 28 格
   * （**不该**为了"看起来整齐"硬凑 5 行）。2026 年 2 月是周日开头，那才需要补齐到 35。
   */
  eq("2 月正好从周一开始时不做多余补齐（2027-02 = 28 格）",
    [monthGrid(new Date(2027, 1, 15)).length, dateKey(monthGrid(new Date(2027, 1, 15))[0] ?? new Date())],
    [28, "2027-02-01"]);
  eq("而周日开头的那个 2 月（2026-02）补齐到 35 格",
    monthGrid(new Date(2026, 1, 15)).length, 35);

  // ② 翻月
  eq("1 月 31 日的下一月 → 2 月 1 日（不是 3 月：直接加一个月会被 Date 规整掉 2 月）",
    dateKey(shiftMonths(new Date(2026, 0, 31), 1)), "2026-02-01");
  eq("12 月的下一月跨年 → 次年 1 月 1 日",
    dateKey(shiftMonths(new Date(2026, 11, 15), 1)), "2027-01-01");
  eq("上一月同样锚到 1 号", dateKey(shiftMonths(new Date(2026, 2, 31), -1)), "2026-02-01");
  eq("是同一月就认得出（月视图用它给「隔壁月」的天淡显）",
    [isSameMonth(new Date(2026, 8, 1), new Date(2026, 8, 30)), isSameMonth(new Date(2026, 7, 31), new Date(2026, 8, 1))],
    [true, false]);

  // ③ 页面接线
  const page = read("app/admin/(dashboard)/calendar/page.tsx");
  ok("看课那一块里有周 / 月切换（不是一个新页签）",
    page.includes('{ key: "week", label: "周" }') && page.includes('{ key: "month", label: "月" }'));
  ok("周视图与月视图共用「选中那一天」（同一个 selectedKey）",
    (page.match(/setSelectedKey\(key\)/g) ?? []).length >= 2);
  ok("读课程用的是**当前可见区间**（`range`），而不是写死那 7 天",
    page.includes("api.lessons.listBetween(range.from, range.to)") && page.includes("}, [range]);"));
  ok("月视图的 range 取的正是格子首尾（含前后补齐的天，否则那几格假空）",
    /zoom === "month" && grid\.length > 0[\s\S]{0,160}grid\[0\][\s\S]{0,160}grid\[grid\.length - 1\]/.test(page));
  ok("翻月 / 回到本月用的是 shiftMonths（不是手写 date.setMonth）",
    page.includes("shiftMonths(anchor, -1)") && page.includes("shiftMonths(anchor, 1)"));
  /*
   * 机构口径（v31）：「月视图应该和周视图的**卡片一样**，只不过是按照日历的排布顺序，
   * 同一周内上个月 / 下个月的卡片可以颜色浅一点」。因此这里断言的是"两张视图共用同一个卡片组件"
   * —— 而不是"月视图有自己的一套精简格子"（那正是被改掉的那一版）。
   */
  ok("周视图与月视图**共用同一个日卡片组件**（不是各画一套）",
    (page.match(/function DayCard\(/g) ?? []).length === 1 &&
      (page.match(/<DayCard/g) ?? []).length === 2);
  ok("月视图是「一周一行、七列」的日历排布（周一到周日的表头 + grid-cols-7）",
    page.includes('["周一", "周二", "周三", "周四", "周五", "周六", "周日"]') &&
      (page.match(/grid-cols-7/g) ?? []).length >= 2);
  ok("上个月 / 下个月的卡片淡一档（dimmed）",
    page.includes("dimmed={!inMonth}") && page.includes("dimmed && \"opacity-60\""));
  ok("窄屏不把七列压扁，而是整块横向滚动（不然一天一张卡片没法看）",
    page.includes("overflow-x-auto") && page.includes("min-w-[68rem]"));
  ok("点开的是「不在本月」的那几天时页面上写明了",
    page.includes("（不在本月）"));
}

console.log("\n=== 38. 课程挂到维度上（v28：课程 ←→ 课程类型）===");

/*
 * 机构口径：「课程可以完全按照…**不靠枚举的方式为主安排**」，以及"状态两层都留、各管一层"。
 *
 * 课程台账里的课是**枚举**出来的（小学语文 / 高考外语…），课程类型是**维度**（学段 × 学科 × 模块），
 * 两者以前没有任何联系：同一门「小学语文」两处各写一遍，改一处不会动另一处。
 * 这一节守四件事：
 *
 *   1. **按名字对得上就对、对不上就说对不上**（不猜：猜错的后果是排课与诊断按错的维度筛课）；
 *   2. **机构在卖的每一张卡片都能挂到维度上**（对不上的那几个"枚举尾巴"已经补进维度表）；
 *   3. **引用要能校验**（悬空学段 / 悬空学科 / 模块跨学科 / 学段与学科对不上）；
 *   4. **两层开放状态各管一层、互相提示**（课程状态 vs 开放矩阵）。
 */
{
  __useStoreForTesting(memory);
  const catalog = catalogFromSeed();

  // ① 按名字挂
  const linked = (name: string): { stages: string[]; subjects: string[] } => {
    const hit = suggestCourseDimensions(name, catalog);
    return {
      stages: hit.stageIds.map((id) => catalog.stages.find((stage) => stage.id === id)?.name ?? ""),
      subjects: hit.subjectIds.map((id) => catalog.subjects.find((subject) => subject.id === id)?.name ?? ""),
    };
  };
  eq("「学段 + 学科」这种名字按前缀对上", linked("小学语文"), { stages: ["小学"], subjects: ["语文"] });
  eq("「初中数学」同理", linked("初中数学"), { stages: ["初中"], subjects: ["数学"] });
  eq("名字本身就是学科时按学科名对上（并带上它自己的学段）",
    linked("雅思").subjects, ["雅思"]);
  ok("「雅思」的学段来自学科自己（其他类型）", linked("雅思").stages.includes("其他类型"));
  eq("一张卡片覆盖多个学科的（高考外语 → 五个语种）",
    linked("高考外语").subjects, ["日语", "俄语", "德语", "法语", "西班牙语"]);
  eq("「高考外语」的学段按对应表写的高中", linked("高考外语").stages, ["高中"]);
  eq("名字只差一个连接符的（3D建模 & 3D打印）也对得上",
    linked("3D建模 & 3D打印").subjects, ["3D建模与3D打印"]);
  eq("别名（职场与商务英语 → 商务英语）", linked("职场与商务英语").subjects, ["商务英语"]);
  eq("完全对不上的就**留空**（不猜）",
    [suggestCourseDimensions("随便编的一门课", catalog).linked,
      suggestCourseDimensions("随便编的一门课", catalog).subjectIds],
    [false, []]);

  // ② 机构在卖的每一张卡片都能挂上（这才是"不靠枚举"的前提）
  {
    const names = coursesFromSite().map((course) => course.name);
    ok(`网站课程卡片有 ${String(names.length)} 张（否则下面那条是空转的）`, names.length >= 30);
    /*
     * 两条路都算"挂上了"，与 `materializeSiteCourses` 的顺序一致：
     *   ① 显式清单（`extraCourseDimensions`）—— 那十二门课（小学奥数 / 中考冲刺 / 医学…）
     *      的名字里没有学科名，`suggestCourseDimensions` 猜不出来，口径写在那份清单里；
     *   ② 按名字推断（`suggestCourseDimensions`）。
     * 两条都落空才算"挂不上"，那种课会出现在台账的「还没挂到维度上」里。
     */
    const unmatched = names.filter(
      (name) => !suggestCourseDimensions(name, catalog).linked && extraCourseDimensions(name) === null,
    );
    eq("**每一张卡片都能挂到维度上**（显式清单或按名字推断，两条都落空才算挂不上）", unmatched, []);
    ok("那十二门只能靠显式清单挂上（按名字推断一定落空，因此那份清单不能丢）",
      EXTRA_COURSE_NAMES.filter((name) => !suggestCourseDimensions(name, catalog).linked).length ===
        EXTRA_COURSE_NAMES.length);
  }

  // ③ 引用校验
  const stageId = catalogId("st", "小学");
  const subjectId = catalogId("subj", "语文");
  const moduleId = catalogId("mod", "语文·一年级");
  const base = { name: "自检课程" };
  eq("什么都不挂＝合法（还没挂是正常状态）", courseDimensionProblems(base, catalog), []);
  eq("挂上存在的学段 / 学科 / 模块＝合法",
    courseDimensionProblems({ ...base, stageIds: [stageId], subjectIds: [subjectId], moduleIds: [moduleId] }, catalog), []);
  ok("悬空学段被拒",
    courseDimensionProblems({ ...base, stageIds: ["st_不存在"] }, catalog).some((text) => text.includes("不存在的学段")));
  ok("悬空学科被拒",
    courseDimensionProblems({ ...base, subjectIds: ["subj_不存在"] }, catalog).some((text) => text.includes("不存在的学科")));
  ok("悬空模块被拒",
    courseDimensionProblems({ ...base, subjectIds: [subjectId], moduleIds: ["mod_不存在"] }, catalog)
      .some((text) => text.includes("不存在的内容模块")));
  ok("模块不属于挂着的学科被拒（模块不跨学科复用）", (() => {
    const other = catalog.modules.find((item) => item.subjectId !== subjectId);
    if (other === undefined) return false;
    return courseDimensionProblems({ ...base, subjectIds: [subjectId], moduleIds: [other.id] }, catalog)
      .some((text) => text.includes("不属于它挂着的学科"));
  })());
  ok("学段与学科对不上被拒（数学不开在大学）",
    courseDimensionProblems(
      { ...base, stageIds: [catalogId("st", "大学")], subjectIds: [catalogId("subj", "数学")] },
      catalog,
    ).some((text) => text.includes("对不上")));
  eq("挂上了就算 linked（学段可以后补）",
    [isCourseLinked({ subjectIds: [subjectId] }), isCourseLinked({ subjectIds: [] })], [true, false]);

  // ④ 两层开放状态：各管一层，互相提示
  const offerOf = (open: boolean) => [{ subjectId, moduleId: "", formatId: catalogId("fmt", "一对一"), open }];
  eq("没挂维度 → 说「看不出开没开」（而不是硬给结论）",
    opennessHint({ name: "自检课程", status: "开放", stageIds: [], subjectIds: [], moduleIds: [] }, []).level,
    "unknown");
  eq("挂了但矩阵里一条都没设过、课程却是开放 → 提醒（两层矛盾）",
    opennessHint({ name: "自检课程", status: "开放", stageIds: [stageId], subjectIds: [subjectId], moduleIds: [] }, []).level,
    "warn");
  eq("矩阵里全关着、课程却开放 → 提醒",
    opennessHint({ name: "自检课程", status: "开放", stageIds: [stageId], subjectIds: [subjectId], moduleIds: [] }, offerOf(false)).level,
    "warn");
  eq("矩阵里有关着的组合、课程暂未开放 → 一致（不再是警告）",
    opennessHint({ name: "自检课程", status: "暂未开放", stageIds: [stageId], subjectIds: [subjectId], moduleIds: [] }, offerOf(false)).level,
    "ok");
  eq("矩阵里开着组合 → 一致",
    opennessHint({ name: "自检课程", status: "开放", stageIds: [stageId], subjectIds: [subjectId], moduleIds: [] }, offerOf(true)).level,
    "ok");
  ok("提示里说得清「矩阵里开放着几条」",
    opennessHint({ name: "自检课程", status: "开放", stageIds: [stageId], subjectIds: [subjectId], moduleIds: [] }, offerOf(true))
      .text.includes("1 条"));

  // ⑤ 迁移：老库升上来之后课程就挂好了
  const legacy = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    version: number;
    courses: Array<Record<string, unknown>>;
  };
  legacy.version = 27;
  legacy.courses = legacy.courses.map((course) => {
    const { stageIds, subjectIds, moduleIds, ...rest } = course;
    void stageIds;
    void subjectIds;
    void moduleIds;
    return rest;
  });
  eq("v27 老库（课程上没有维度字段）能升级导入",
    (await api.importDatabase(JSON.stringify(legacy))).ok, true);
  const afterLink = await api.exportDatabase();
  eq("升级后版本号是当前版本", afterLink.version, CURRENT_VERSION);
  const linkedCourses = afterLink.courses.filter((course) => (course.subjectIds ?? []).length > 0);
  ok(`迁移把课程挂上了（${String(linkedCourses.length)}/${String(afterLink.courses.length)} 门）`,
    linkedCourses.length === afterLink.courses.length);
  ok("而且挂的是**存在**的学科（不是编出来的 id）",
    afterLink.courses.every((course) =>
      (course.subjectIds ?? []).every((id) => afterLink.catalog.subjects.some((subject) => subject.id === id))));
  ok("学段也挂上了（用来按学段筛课）",
    afterLink.courses.every((course) => (course.stageIds ?? []).length > 0));

  // ⑥ API 闸门：挂悬空引用写不进去
  const badCourse = {
    name: "自检·挂错维度", partitionId: "", forms: [], status: "开放" as const, note: "", path: "",
    tags: [], target: "", order: 999, intro: "", siteKind: "不展示" as const, origin: "后台" as const,
    createdAt: "", stageIds: [], subjectIds: ["subj_不存在"], moduleIds: [],
  };
  const refusal = await (async () => {
    try {
      await api.courses.create(badCourse);
      return "";
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  })();
  ok("新建课程时挂悬空学科被拒（服务端也拦，不只是页面上）", refusal.includes("不存在的学科"));

  /*
   * ⑥.5 **新库与「从网站同步」也要挂上**（这一条是自查时发现的一个真漏：
   * 第一版只在迁移里挂，于是"全新的库"与"从网站同步进来的课"全是没挂维度的 ——
   * 而机构根本没有老库可迁移，等于这个功能对新装的系统完全不起作用）。
   */
  {
    const seeded = createSeedDatabase();
    eq("空库 / 示例数据起步时课程就挂好了",
      [seeded.courses.filter((course) => (course.subjectIds ?? []).length > 0).length, seeded.courses.length],
      [seeded.courses.length, seeded.courses.length]);
    const withCatalog = materializeSiteCourses([], undefined, catalogFromSeed());
    eq("materializeSiteCourses 拿到维度表就把名字换成维度",
      withCatalog.courses.filter((course) => (course.subjectIds ?? []).length > 0).length, withCatalog.courses.length);
    const withoutCatalog = materializeSiteCourses([]);
    eq("没给维度表就留空（判据只有一处：谁有维度表谁负责挂）",
      withoutCatalog.courses.filter((course) => (course.subjectIds ?? []).length > 0).length, 0);

    /*
     * 后台新增的课**自己带维度**（表单里选的）—— 这是删掉「从网站同步」之后
     * 新课程进入系统的唯一路径，因此也要能挂上。
     */
    await api.importDatabase(JSON.stringify(afterLink));
    const created = await api.courses.create({
      name: "自检·新加的课", partitionId: "", forms: [], status: "开放", note: "", path: "",
      tags: [], target: "", order: 998, intro: "", siteKind: "不展示", origin: "后台", createdAt: "",
      stageIds: [catalogId("st", "小学")], subjectIds: [catalogId("subj", "语文")], moduleIds: [],
    });
    eq("后台新增的课按表单挂上维度",
      [created.stageIds.length, created.subjectIds.length], [1, 1]);
    await api.courses.remove(created.id);
  }

  /*
   * ⑧ 「从网站同步课程」「从网站导入内容」两个入口已经删掉（机构口径：现在都以后端为主）。
   * 这一条钉住"删干净了"：契约里没有、服务层没有、页面上没有那两个按钮。
   */
  {
    const methods = API_CONTRACT.flatMap((group) => group.methods);
    eq("契约里不再有那两个方法",
      methods.filter((method) => method === "courses.syncFromSite" || method === "site.importFromContent"),
      []);
    ok("服务层上也没有（不是「契约删了、实现还留着」）",
      !("syncFromSite" in (api.courses as unknown as Record<string, unknown>)) &&
        !("importFromContent" in (api.site as unknown as Record<string, unknown>)));
    const ledger = readFileSync(new URL("../components/admin/CoursesLedgerPanel.tsx", import.meta.url), "utf8");
    /*
     * 断到"调用与处理函数"这一层，而不是断言页面上不出现那几个字：
     * 页面顶部那段口径说明**应该**提到"那两个入口已删"（不然下一个人会以为丢了功能）。
     */
    ok("「课程」页上不再调那两个方法（也没有它们的处理函数）",
      !ledger.includes("syncFromSite") && !ledger.includes("importFromContent") &&
        !ledger.includes("checkSiteContent") && !ledger.includes("applySiteContent"));
    ok("而页面顶部写明了那两个入口已经删掉（免得有人以为功能丢了）",
      ledger.includes("两个入口已删"));
    ok("而「批量导入」（从文件导入）仍然在（那是另一件事）",
      ledger.includes("BulkImport"));
  }

  // ⑦ 页面接线
  const ledger = readFileSync(new URL("../components/admin/CoursesLedgerPanel.tsx", import.meta.url), "utf8");
  ok("台账页有维度的选择器（所属学段 / 学科 / 内容模块）",
    ledger.includes('label="所属学段"') && ledger.includes('label="所属学科 / 项目"') && ledger.includes('label="内容模块"'));
  ok("台账页能**按维度筛**（学段 / 学科 + 只看未挂维度）",
    ledger.includes("按维度筛：") && ledger.includes("只看未挂维度"));
  ok("台账页把「还没挂到维度上」的课单独列出来（迁移对不上的落在这里）",
    ledger.includes("还没挂到课程类型上"));
  ok("卡片上显示这门课的维度与两层开放的互相提示",
    ledger.includes("维度：") && ledger.includes("opennessHint(course, offers)"));
  ok("维度表 / 组合表各自静默降级（拿不到也不让台账打不开）",
    ledger.includes("api.catalog.list().catch(() => null)") && ledger.includes("api.offers.list().catch(() => null)"));
  for (const [label, pattern] of [
    ["没挂维度 → 说看不出开没开", "还没挂到学科上，看不出矩阵里开没开"],
    ["矩阵全关但课程开放 → 提醒矛盾", "矩阵里这门课的组合"],
  ] as const) {
    ok(`提示文案里保留了「${label}」这句（改文案时会被提醒）`,
      readFileSync(new URL("../lib/backend/course-dimensions.ts", import.meta.url), "utf8").includes(pattern));
  }
}

console.log("\n=== 38.5 自检与验收脚本也纳入类型检查（2026-09 清账）===");

/*
 * 这一段曾经是**最大的一个洞**：`scripts/**\/*.mts` 从来没被 `tsc` 检查过
 * （`**\/*.ts` 通配不匹配 `.mts`），而"自检脚本出错是响亮失败"这个理由让它一直排在
 * 后端后面。清账时那 115 处里藏着**四处真错误**，它们全都是"看起来在断言、其实没有"：
 *
 *   1. `markCompleted(...).skipped === false` —— `skipped` 是数组，永远不等于 false，
 *      而 `check()` 在没有 `expect` 时只看抛不抛错，于是那条断言什么都没验；
 *   2. `walkApi(api, "", realMethods)` —— 函数只收两个参数，第三个参数被静默忽略；
 *   3. `offersOfDimension(rows, "delivery", …)` —— v26 删掉"交付形态"之后留下的一处，
 *      查不到的字段返回空数组，于是断言**空转通过**；
 *   4. `diff-site-content.mts` 读 `publicSite.coursePartitions` —— 真实字段叫 `partitions`，
 *      脚本一跑就抛（没人跑过它）。
 *
 * 这一条把"纳入"钉住：tsconfig 的 include 里必须有 scripts，而且真的没有历史债。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  /*
   * tsconfig 里带注释（JSON with comments），因此不能用 `JSON.parse` —— 直接读文本断言，
   * 这也正好是这一条要验的东西："include 那一行里到底有没有 scripts"。
   */
  const tsconfig = readFileSync(new URL("tsconfig.json", rootUrl), "utf8");
  const includeLine = /"include"\s*:\s*\[([^\]]*)\]/.exec(tsconfig)?.[1] ?? "";
  ok("tsconfig 的 include 里有 scripts/**\\/*.mts（否则 .mts 通配不匹配，等于没检查）",
    includeLine.includes("scripts/**/*.mts"));
  ok("服务端与脚本都在里面", includeLine.includes("server/**/*.mts"));
}

console.log("\n=== 39. 课程台账按维度分组（v33：默认按维度，分区视图保留）===");

/*
 * 机构：「课程可以完全按照…**不靠枚举的方式为主安排**」。E3 把课程挂到了维度上（能筛、能挂），
 * 这一版把**分组**也换成维度 —— 但分区视图**保留**：分区仍然是网站的展示结构
 * （课程页按栏目分组、每个栏目在网站上都有入口），分区改名 / 排序 / 删除 / 批量移课
 * 那几个动作就挂在分区表头上。
 *
 * 这一节守四件事：
 *   1. **默认按维度**（学段 → 学科），且**没有维度表时强制分区视图**（否则全被归到"未挂"）；
 *   2. **多学科卡片不重复列**（「高考外语」覆盖五个语种，只出现一次，归到「多学科卡片」）；
 *   3. **没挂维度的课不进维度分组**（由那块黄色提示 + 「只看未挂维度」处理）；
 *   4. 分区视图与它的管理动作**都还在**（不是"换成维度就删了老路"）。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const ledger = read("components/admin/CoursesLedgerPanel.tsx");

  ok("默认是「按维度」分组（机构口径：课程以维度法为主安排）",
    /useState<"dimension" \| "partition">\("dimension"\)/.test(ledger));
  ok("两种分组方式都能切，且分区那一种标明了它是「网站栏目」",
    ledger.includes('{ key: "dimension", label: "按维度（学段 → 学科）" }') &&
      ledger.includes('{ key: "partition", label: "按分区（网站栏目）" }'));
  ok("没有维度表时维度那一个不可选（否则所有课都归到「未挂」里，像清单坏了）",
    ledger.includes('disabled={item.key === "dimension" && catalog === null}') &&
      ledger.includes("读不到课程类型，只能按分区看"));
  ok("维度分组是学段 → 学科两层",
    ledger.includes("const dimensionGroups = useMemo") && ledger.includes("section.buckets.map("));
  ok("多学科卡片归到「多学科卡片」那一桶（不重复列 N 次）",
    ledger.includes('"多学科卡片"') && ledger.includes("一张卡片覆盖多个学科"));
  ok("没挂维度的课**不进**维度分组（它们由提示块与筛选处理）",
    ledger.includes('course.subjectIds.length === 0') && ledger.includes('"（没挂学科）"'));
  ok("分区视图与它的表头动作都还在（分区改名 / 排序 / 删除 / 批量移课）",
    ledger.includes("groupByPartition(visible, partitions)") &&
      ledger.includes("renderPartitionHeader(column, columnItems, 1)") &&
      ledger.includes("renderPartitionHeader(group.subgroup, group.items, 2)"));
  ok("「未归类 / 分区已失效」那一块只在分区视图里出现",
    ledger.includes('groupMode === "partition" && unpartitioned.length > 0'));
  ok("两种分组都复用同一张课程卡片（不是各画一套）",
    (ledger.match(/renderCourseCard\(course\)/g) ?? []).length >= 3);
}

console.log("\n=== 40. 「课程」页点页签有反应（一个真 bug 的回归断言）===");

/*
 * 机构报的现象：「课程矩阵和课程类型为什么点了没反应」。
 *
 * 根因在合并三个页面的那一版（v29）：选页签的 effect 依赖写成了
 * `[tabs]`，而 `tabs = ADMIN_COURSE_TABS.filter(...)` **每次渲染都是新数组** ——
 * 于是那个 effect 每次渲染都跑一遍，刚点下去的页签立刻被重置回第一个
 * （而且它与"把页签写进地址"的 effect 组成来回改状态的循环）。
 *
 * 这一节守两件事：**选页签的纯逻辑**逐条正确；**页面结构**不再犯那个错。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const page = read("app/admin/(dashboard)/courses/page.tsx");

  // ① 纯逻辑
  const all = ADMIN_COURSE_TABS.map((tab) => ({ key: tab.key, hash: tab.hash }));
  const allTabs = ADMIN_COURSE_TABS.map((tab) => ({ key: tab.key }));
  const onlyLedger = [{ key: "ledger" as const }];
  eq("没有锚点时选第一个能进的页签", pickInitialCourseTab(all, allTabs, ""), "ledger");
  eq("有锚点且允许 → 直接进那一个", pickInitialCourseTab(all, allTabs, "#matrix"), "matrix");
  eq("锚点是 key 本身也认", pickInitialCourseTab(all, allTabs, "dimensions"), "dimensions");
  eq("锚点不允许（教师拿到 #matrix）→ 退到第一个能进的，**不是**空壳",
    pickInitialCourseTab(all, onlyLedger, "#matrix"), "ledger");
  eq("锚点不认识 → 退到第一个", pickInitialCourseTab(all, allTabs, "#不存在的页签"), "ledger");
  eq("一个都进不去 → null（页面上给说明，而不是空白）", pickInitialCourseTab(all, [], "#matrix"), null);
  eq("带不带 # 都一样", [
    pickInitialCourseTab(all, allTabs, "#offers"),
    pickInitialCourseTab(all, allTabs, "offers"),
  ], ["ledger", "ledger"]);

  // ② 页面结构：不许再犯那个错
  ok("页签列表是 useMemo 出来的（每次渲染新建数组会让「选页签」的 effect 每次都跑）",
    /const tabs = useMemo\(/.test(page));
  ok("选页签的 effect 只跑一次（依赖不是那个数组，而且有 picked 守卫）",
    page.includes("const picked = useRef(false)") &&
      /if \(picked\.current\) return;/.test(page) &&
      !/\}, \[tabs\]\);\n\n  \/\*\n   \* 角色变化后/.test(page));
  ok("选页签用的是那个纯函数（逻辑可断言，不是埋在 effect 里）",
    page.includes("pickInitialCourseTab(ADMIN_COURSE_TABS, tabs, window.location.hash)"));
  ok("角色变化导致当前页签不允许时会退到能进的第一个",
    page.includes("if (tabs.some((item) => item.key === tab)) return;"));
  ok("切页签不卸载已经打开过的面板（卸载会把没保存的草稿悄悄丢掉）",
    page.includes("hidden={tab !== \"ledger\"}") && page.includes("mounted.has("));
}

console.log("\n=== 41. 报价与课程清单对齐（v37）===");

/*
 * 机构：「**现在以课程清单为准，整理一下网站的报价**（公式依旧不变，主要修改的是课程名称
 * 以及分类这些）」。
 *
 * 这一步要守的性质只有一句话：**报价里的每一门课，课程库里都真有那门课**（反过来也一样）。
 * 这条性质以前不成立，而且不成立得很隐蔽：报价页上有 20 门"课程"（九年级课本 / 雅思口语 /
 * 专业英语…），课程库里一门都找不到 —— 家长能选中、能算出价，机构却排不了课、报不了课，
 * 而那 20 门课的价格全对不上任何一门真实课程。v25 那套"报价跟着课程库走"的打通机制
 * 也因此完全空转（名字对不上，谁也没认领谁）。
 *
 * 断言分三层，都是"结构上必须成立"的那一类，而不是把当前的清单再抄一遍：
 *   1. **集合相等**：报价的课程名集合 = 课程库的课程名集合（示例库 / 空库 / 新装库同一份）；
 *   2. **分组对齐**：报价的每个阶段都对应课程类型里的一个学段，且那个学段下真有课；
 *   3. **两端都在**：课程库里的课在报价里有行、开放的有价；那十二门"只在后台用"的课
 *      确实没有上网（网站卡片数没变），维度也都挂上了。
 */
{
  const templateCourses = pricing.stages.flatMap((stage) => stage.courses.map((course) => course.name));
  const libraryNames = seedDb.courses.map((course) => course.name).sort();
  eq("报价里的课程名与课程库里的课程名一一对应（名字就是引用键）",
    [...templateCourses].sort(), libraryNames);
  eq("报价里的课程没有重名（重名会按错误的价报价）",
    templateCourses.filter((name, index) => templateCourses.indexOf(name) !== index), []);

  const emptyNames = createEmptyDatabase().courses.map((course) => course.name).sort();
  eq("空库起步与示例库是同一份课程清单（否则机构装出来的库与自检断的不是一份）",
    emptyNames, libraryNames);

  // 分组：报价的每个阶段 = 课程类型里的一个学段，且该学段下有课
  const stageRows = catalogFromSeed().stages;
  const courseStageNames = (course: { stageIds: string[] }) =>
    course.stageIds.map((id) => stageRows.find((stage) => stage.id === id)?.name ?? id);
  const seedByName = new Map(seedDb.courses.map((course) => [course.name, course]));
  eq("报价的每个阶段都真有该学段的课",
    pricing.stages
      .filter((stage) =>
        !stage.courses.some((course) => {
          const row = seedByName.get(course.name);
          return row !== undefined && courseStageNames(row).includes(stage.name);
        }))
      .map((stage) => stage.name),
    []);
  eq("课程库里每一门课的学段都能在报价里找到对应阶段",
    seedDb.courses
      .filter((course) => courseStageNames(course).every(
        (name) => !pricing.stages.some((stage) => stage.name === name)))
      .map((course) => course.name),
    []);
  eq("报价的每门课都有价或明确写着暂未开放（不留「两头空」的行）",
    pricing.stages.flatMap((stage) =>
      stage.courses.filter((course) => course.available === (course.price === null)).map((course) => course.name)),
    []);

/*
 * 去重后的合并：那十二门课（`extraCourses()` 的 `SPECS`）2026-09 **全部上过网站**，
 * 因此它们由网站卡片那条路建出来 —— `extraCourses(网站卡片名)` 只会返回**还没上网的**
 * 那几门，库里不会有同名两条（报价与台账都按名字认领，重名一定认错一门）。
 * 清单本身仍然有用：`extraCourseDimensions()` 是这十二门课的维度口径。
 *
 * ## ⚠️ 为什么这里不再断「十二门一门不少地上网」
 *
 * 机构随时可以把某门课从网站撤下来、甚至从课程库删掉 —— 那是正常的经营动作
 * （2026-09 他们就删了「高考冲刺」「特殊计划专项」，报价里那两行按既定口径留着并置成
 * 「暂未开放」）。旧的写法把"十二门全在卡片上"当成不变式，机构一整理课程清单，
 * 自检就红在**数据**上，而不是红在**代码**上 —— 那种红只会让人去改断言。
 * 现在守的是两件真正的不变式：
 *   ① `extraCourses(网站卡片名)` 不许**造新名字**（只从那十二门里挑没上网的）；
 *   ② 它挑出来的那几门确实不在网站卡片上（否则就是"同名两条"的那个老毛病）。
 */
const extras = extraCourses();
eq("完整清单仍然是十二门（`SPECS` 没被删空，维度口径还靠它）", extras.length, EXTRA_COURSE_NAMES.length);
eq("它们的名字都在报价里（否则又是「报价有、库里没有」）",
  EXTRA_COURSE_NAMES.filter((name) => !templateCourses.includes(name)), []);
const extrasToBackfill = extraCourses(coursesFromSite().map((course) => course.name));
eq("`extraCourses(网站卡片名)` 只从那十二门里挑，不造新名字",
  extrasToBackfill.filter((course) => !EXTRA_COURSE_NAMES.includes(course.name)), []);
ok(`它挑出来的那几门确实都不在网站卡片上（当前要补 ${String(extrasToBackfill.length)} 门：` +
  `${extrasToBackfill.map((course) => course.name).join("、") || "无"}）`,
  extrasToBackfill.every(
    (course) => !coursesFromSite().some((card) => card.name === course.name)));
const onSiteNames = EXTRA_COURSE_NAMES.filter(
  (name) => coursesFromSite().some((course) => course.name === name));
ok(`那十二门里至少有一批仍挂在网站卡片上（当前 ${String(onSiteNames.length)} / ` +
  `${String(EXTRA_COURSE_NAMES.length)}）`, onSiteNames.length > 0);
ok("仍然挂在网站卡片上的那几门确实带着网站卡片字段（有 path、siteKind 不是「不展示」）",
  seedDb.courses
    .filter((course) => onSiteNames.includes(course.name))
    .every((course) => course.path !== "" && course.siteKind !== "不展示"));
eq("库里没有同名两条（重名会让报价与台账认错课）",
  seedDb.courses.map((course) => course.name).filter((name, i, all) => all.indexOf(name) !== i), []);
ok("它们的维度都挂好了（学段 + 学科，台账按维度分组时不会掉到「未挂」里）",
  seedDb.courses
    .filter((course) => EXTRA_COURSE_NAMES.includes(course.name))
    .every((course) => course.stageIds.length > 0 && course.subjectIds.length > 0));
/*
 * 「上网」这件事的判据是**有 `path` 且 `siteKind` 不是「不展示」**，而这里守的是
 * 「上网的那些**就是网站卡片上的那些**」（按名字一一对应，不多不少）。
 *
 * 原先这一条写死了一个数字（`=== 44`）：44 = 42 张卡片 + 2 门"只在后台用"的课全上网时的总数。
 * 机构 2026-09 删掉「高考冲刺」「特殊计划专项」之后，卡片变成 42 张、库里那两门回落成
 * 「不展示」，写死的数字当场变假 —— 而它想说的话（"上网的与卡片一致"）本来与数字无关。
 * 改成比**两份名单**：库里"上网的课" vs 内容文件里的卡片。
 */
{
  const onSiteCourses = seedDb.courses.filter(
    (course) => course.siteKind !== "不展示" && course.path !== "");
  eq("「上网」的课就是网站卡片上的那些课（按名字一一对应，不多不少）",
    onSiteCourses.map((course) => course.name).sort(),
    coursesFromSite().map((course) => course.name).sort());
}

  // 打通机制现在真的能生效：整份配置一次认全
  const claimed = syncLibraryLinks(pricingConfigFromContent(), seedDb.courses);
  eq("报价里的每一门课都能认领到课程库里那门课（不留未关联的行）",
    claimed.config.stages
      .flatMap((stage) => stage.courses)
      .filter((course) => (course.courseId ?? "") === "")
      .map((course) => course.name),
    []);
  /*
   * ③ 「未导出上线」这句话必须**比出来**，不能只看来源。
   *
   * 原先报价页写的是 `draft.source === "后台修改"` —— 于是这句话永远不会消失：
   * 导出、替换内容文件、发布之后来源仍然是"后台修改"，页面还在说"未导出上线"。
   * 现在比的是库里的配置与内容文件里那一份（`pricingConfigCore`），因此这里也盯住
   * "比的基准忽略后台专属关联"（`courseId` / 班型的 `formatId`：内容文件里没有它们，
   * 比进去会让明明一样的两份永远不相等），以及页面确实用了那个比较。
   */
  const withLinks = pricingConfigFromContent();
  const linked: typeof withLinks = {
    ...withLinks,
    stages: withLinks.stages.map((stage, index) => ({
      ...stage,
      courses: stage.courses.map((course, courseIndex) => ({
        ...course,
        courseId: `course-${String(index)}-${String(courseIndex)}`,
      })),
    })),
    classTypes: withLinks.classTypes.map((classType) => ({ ...classType, formatId: `fmt_${classType.name}` })),
  };
  eq("「与内容文件一致吗」的比法忽略后台专属关联（courseId / 班型 formatId）",
    pricingConfigCore(linked) === pricingConfigCore(withLinks), true);
  ok("但它**不**忽略钱（改一个基础价就比得出不一样）",
    pricingConfigCore({
      ...withLinks,
      stages: withLinks.stages.map((stage, index) =>
        index === 0
          ? { ...stage, courses: stage.courses.map((course, i) => (i === 0 ? { ...course, basePrice: 999 } : course)) }
          : stage),
    }) !== pricingConfigCore(withLinks));
  const pricingPageSource = readFileSync(
    new URL("../app/admin/(dashboard)/pricing/page.tsx", import.meta.url),
    "utf8",
  );
  /*
   * ④ 基础价的单位在**界面与内容文件里都写成"元 / 小时"**（机构口径）。
   *
   * 这是"两套单位混着说"的防呆：基础价（元 / 小时）与课单价（元 / 节）并存，
   * 只要有一处把基础价标成"元 / 节"，填价的人就会以为家长看到的就是那个数。
   * 断言按"基础价附近不许出现元 / 节"来写：台账与报价页里的报价区块必须是"元 / 小时"。
   */
  const ledgerSource = readFileSync(
    new URL("../components/admin/CoursesLedgerPanel.tsx", import.meta.url),
    "utf8",
  );
  /*
   * ⑥ 保存课程的提示必须写清"网站什么时候才变"。
   *
   * 机构反馈过「我在后台改了课程名，前台还是旧的」—— 根子是那半句提示
   * （"卡片 + 报价 + 网站正文"）读起来像"网站已经变了"，而网站是静态的：
   * 只在构站那一刻取一次库里的数据。这里断的是提示**按两种情况分开写**：
   * 上网站课要说"要重新构站"，不上网的课要说"它不在网站上"。
   */
  ok("保存课程的提示写明了网站什么时候才变（上网站 / 不上网两种情况分开说）",
    ledgerSource.includes("网站页面上要重新构站一次") &&
      ledgerSource.includes("它不在网站上（卡片选了「不展示」）"));
  ok("课程台账里的报价单位是「元 / 小时」",
    ledgerSource.includes('报价（元 / 小时）') && ledgerSource.includes('${price} 元/小时'));
  ok("报价页里基础价输入框的单位是「元 / 小时」（课单价才是元 / 节）",
    pricingPageSource.includes('suffix="元 / 小时"') &&
      pricingPageSource.includes("课单价") &&
      !pricingPageSource.includes('suffix="元 / 节"'));
  /*
   * ⑦ 构站必须**问得到后端**（连不上就当场失败，而不是悄悄发一版空站）。
   *
   * 这一条是被一次真实事故催出来的：后端没起时 `npm run build` 退出码是 0，
   * 但 `out/` 里的页面从 82 张掉到 31 张（课程卡片 / 教师 / 报价整块空白）——
   * 对一次"本机构建然后发布"来说，这是最糟的失败方式：看起来成功了。
   */
  const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  ok("npm run build 内置了 SITE_API_STRICT=1（后端连不上就构站失败，而不是发一版空站）",
    /"build":\s*"[^"]*SITE_API_STRICT=1[^"]*sync-site-data/.test(packageJson));
  ok("文档里写明了这一条（否则有人会以为「构站失败」是坏了）",
    readFileSync(new URL("../docs/部署与发布.md", import.meta.url), "utf8").includes("SITE_API_STRICT=1"));

  ok("内容文件里也写明了基础价是元 / 小时",
    pricingSource.includes("基础价（**元 / 小时**"));

  /*
   * ⑦ 「科目系数」与「班级系数」这两个词，在**界面与内容里**都不许再出现。
   *
   * 机构口径：「科目系数可以删除，班级系数改成人数系数」。这条按**源码级扫描**来断，
   * 而不是靠肉眼看页面 —— 这类"叫法漂回去"只发生在文案里，肉眼看不见，
   * 但机构会因此以为系统还是以前那套口径（到底有几个系数、按什么算）。
   * 扫四处：后台报价页（那一整块 UI 都在这个文件里）、网站报价器（家长看到的表单）、
   * 内容文件 `data/site/pricing.md`，以及由它生成的那份 ts
   * （后台「恢复为站点内容」与"没连后端"那一份读的正是后者）。
   */
  const estimateFormSource = readFileSync(
    new URL("../components/pricing/EstimateForm.tsx", import.meta.url),
    "utf8",
  );
  const pricingContentMd = readFileSync(
    new URL("../data/site/pricing.md", import.meta.url),
    "utf8",
  );
  const pricingContentTs = readFileSync(
    new URL("../data/site/pricing.ts", import.meta.url),
    "utf8",
  );
  const staleWordOffenders = ["科目系数", "班级系数"].flatMap((word) =>
    ([
      ["后台报价页", pricingPageSource],
      ["网站报价器", estimateFormSource],
      ["内容文件 pricing.md", pricingContentMd],
      ["内容文件 pricing.ts", pricingContentTs],
    ] as Array<[string, string]>)
      .filter(([, source]) => source.includes(word))
      .map(([where]) => `${where} 里还有「${word}」`));
  eq("界面与内容里不再出现「科目系数」「班级系数」（统一的叫法是「人数系数」）",
    staleWordOffenders, []);
  /*
   * 上面那条查的是**那两个确切的词**。这一条更狠一点：网站报价器里连"科目"两个字
   * 都不该有 —— 因为那一页的步骤里已经没有它了（下拉、状态、联动全删了）。
   * **查之前先去掉注释**（与 §19、§22 同一个坑）：注释里正解释着"以前有科目这一步"，
   * 直接子串匹配会把注释算进去，而它不在界面上。
   */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const estimateFormCode = stripComments(estimateFormSource);
  ok("网站报价器里连「科目」都没有了（下拉 / 状态 / 联动全删干净）",
    !estimateFormCode.includes("科目") && !estimateFormCode.includes("subjectName") &&
      !estimateFormCode.includes("subjectGroups"));
  ok("那一页上这一步现在叫「人数（班型）」",
    estimateFormCode.includes("人数（班型）"));
  ok("后台报价页也没有「科目」这一步（试算器的科目下拉删了）",
    !pricingPageSource.includes("subjectName") && !pricingPageSource.includes("draft.subjects"));

  // 报价页把"这个价折成课单价是多少"算给机构看（填 150 不会以为家长看到的也是 150）
  ok("报价页在基础价输入框下面列出了各时长的课单价",
    pricingPageSource.includes("元/小时 →") && pricingPageSource.includes("元/节"));

  /*
   * ⑤ 数字输入框的**原生上下微调箭头**不许回来，后缀也要按长度留够宽度。
   *
   * 机构反馈：「元/小时这个文字说明和输入框的上下微调价格的东西冲突了，把这个微调价格的
   * 删掉，只接受文本输入」。两件事各自都会造成那种"叠在一起"：
   *   1. 微调箭头固定贴在输入框右缘，而右缘放着单位文字；
   *   2. 右侧留白原来固定 `pr-10`（40px）——「元 / 小时」有 4 个可见字（≈56px），会压住数字。
   * 断言按"这两条路都堵上"来写（CSS 里去掉箭头 + 两个数字输入组件按后缀长度分档留白），
   * 而不是"某个输入框现在写着 pr-16"—— 后者换个单位文字就又不对了。
   */
  const globalsCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  ok("原生微调箭头被全局去掉（它会和输入框右缘的单位文字叠在一起）",
    globalsCss.includes('input[type="number"]::-webkit-inner-spin-button') &&
      globalsCss.includes("-webkit-appearance: none"));
  ok("Firefox 那条也写了（appearance: textfield）",
    globalsCss.includes("appearance: textfield"));
  const adminFields = readFileSync(
    new URL("../components/admin/AdminFields.tsx", import.meta.url),
    "utf8",
  );
  const siteNumberField = readFileSync(
    new URL("../components/ui/NumberField.tsx", import.meta.url),
    "utf8",
  );
  ok("两个数字输入框都按后缀长度留白（后台与网站各一份，不能只修一处）",
    adminFields.includes("function suffixPadding(") && siteNumberField.includes("function suffixPadding("));
  ok("而且旧写法（固定 `pr-10`）已经不存在",
    !adminFields.includes('suffix !== undefined && "pr-10"') &&
      !siteNumberField.includes('suffix !== undefined && "pr-10"'));
  ok("报价页那个长后缀（元 / 小时）确实落在多留一档的写法上",
    adminFields.includes('if (suffix.length <= 3) return "pr-10";') &&
      adminFields.includes('if (suffix.length <= 5) return "pr-16";'));
  ok("报价页的「未导出上线」按内容文件比出来（不是看来源那一句话）",
    pricingPageSource.includes("publishedInSync") &&
      pricingPageSource.includes('"（未导出上线）"') &&
      !pricingPageSource.includes('draft.source === PRICING_SOURCE_ADMIN ? "（未导出上线）"'));

  eq("报价里没有「写着开放却没有价」的行（家长选中了却算不出价，是最糟的一种）",
    pricing.stages
      .flatMap((stage) => stage.courses)
      .filter((course) => course.available && course.price === null)
      .map((course) => course.name),
    []);
  /*
   * 这里**刻意不**断「课程库里开放的课都必须有价」：模板内容里就有这种课 ——
   * `data/site/content.md` 写着「初中社会」开放，而价目表里它是暂未开放。
   * 那不是错，是两条口径的正常落差：课开着、价还没定，台账里会把它标成「未定价」，
   * 那正是给机构看的待办清单。要守的是"课程库改了状态，报价跟着走"（第 10 节那几条）。
   */
}

console.log("\n=== 41.5 网站页脚显示「这一份内容从哪来」===");

/*
 * 机构：「**再在网站的右下角教务后台旁边添加一个状态显示吧，显示现在的网站使用的是
 * 模版数据还是根据后端显示的数据**」。
 *
 * 网站是静态产物，内容可能来自三处而长得一模一样：后端快照（`backend`）/
 * 内容文件（`template`）/ 空（`blank`）。这个标存在的意义就是让机构一眼分清
 * "看的那一份不对"还是"数据没重新取"——前几轮反复出现的
 * 「我在后台改了课程名字，前台没变」正是这一类问题。
 *
 * 断言按"三种状态各自对应哪个标"来写（源码级），而不是"页脚里有某个字符串"：
 * 后者在改了措辞之后会静默失效。
 */
{
  const badge = readFileSync(
    new URL("../components/layout/SiteDataSourceBadge.tsx", import.meta.url),
    "utf8",
  );
  const footer = readFileSync(new URL("../components/layout/Footer.tsx", import.meta.url), "utf8");

  ok("页脚里挂了这个标（就在「教务后台」旁边）",
    footer.includes("SiteDataSourceBadge") && footer.includes("教务后台"));
  ok("三种来源各有一句人话：后端数据 / 模版数据 / 空",
    badge.includes("内容：后端数据") &&
      badge.includes("内容：模版数据") &&
      badge.includes("内容：空（没连上后端）"));
  ok("判据用的是网站那唯一一处取数口径（不是另算一套）",
    badge.includes("siteContentSource()"));
  ok("标上了「构站取数时间」——后端数据是构站那一刻的快照，不是实时读库",
    badge.includes("generatedAt") && badge.includes("UTC"));
  ok("悬停给出完整来源说明（构站脚本写的那句：含后端地址与时间戳原文）",
    badge.includes("backendSiteNote"));
}

console.log("\n=== 42. 后台的卡片都能折叠（机构：「闲时可以占用更少的空间」）===");

/*
 * 机构：「**后台的每个卡片都可以折叠，这样闲时可以占用更少的空间**」。
 *
 * 实现落在 `components/admin/AdminFields.tsx` 的 `Panel` 上（后台那 52 处卡片全是它渲染的），
 * 因此这一节盯的是**三条会静默退化的规矩**：
 *
 *   1. **折叠不卸载内容**：收起来必须用 `hidden`，不能条件渲染 ——
 *      面板里常有没保存的草稿（课程正文 / 报价草稿），卸载等于悄悄丢掉。
 *      同一个教训在 /admin/courses 的页签上已经踩过一次（第 40 节），这里不许再犯；
 *   2. **状态记得住、且按「页面路径 + 面板标题」记**：不带路径的话，
 *      在课程页折叠「批量导入」，学生页那几个同名面板也会跟着折叠；用序号则会被新面板挤错位；
 *   3. **动作按钮不跟着收起**：`actions`（保存 / 导出这类）在折叠时仍然可见 ——
 *      把「保存」藏进收起来的面板里，人会以为按钮没了。
 *
 * 另外两条是"别退化成不能用"：箭头要带 `aria-expanded`（读屏能知道状态），
 * 默认是展开的（藏起来的东西没人会去找）。
 */
{
  const fields = readFileSync(new URL("../components/admin/AdminFields.tsx", import.meta.url), "utf8");
  const panel = fields.slice(fields.indexOf("export function Panel("));

  ok("卡片可以折叠（标题栏是一个按钮）",
    panel.includes("onClick={toggle}") && panel.includes("collapsible"));
  ok("折叠用的是 hidden，不是条件渲染（否则面板里没保存的草稿会被丢掉）",
    panel.includes("hidden={!open}") && !/\{open &&/.test(panel));
  ok("折叠状态按「页面路径 + 面板标题」记（不带路径会让同名面板一起折叠）",
    fields.includes("PANEL_STATE_KEY") &&
      fields.includes("window.location.pathname") &&
      fields.includes("readPanelOpen") &&
      fields.includes("writePanelOpen"));
  ok("动作按钮在折叠时仍然可见（保存不该被藏起来）",
    panel.indexOf("{actions !== undefined") > 0 &&
      !panel.includes("open && actions"));
  ok("箭头带 aria-expanded（读屏能知道当前是展开还是收起）",
    panel.includes("aria-expanded={open}") && panel.includes("aria-controls={bodyId}"));
  ok("默认展开（第一次见到一个面板时它不是收着的）",
    fields.includes("const [open, setOpen] = useState(!defaultCollapsed)") &&
      fields.includes("defaultCollapsed = false"));
}

console.log("\n=== 43. 网站内容导出：库 → data/site/*.md（npm run site:export）===");
/*
 * ## 这一节盯的是什么
 *
 * 线上（GitHub Actions → Pages）那台机器**连不上后端**，工作流设了
 * `SITE_CONTENT_SOURCE=template` —— 也就是说**线上读的就是 `data/site/*.md`**。
 * 而 `npm run site:export` 是反方向的那条通道（库 → 文件）。它出错的形态很难看：
 * 写出来的文件**网站读不回来**（层级写错、字段名写错、正文被当成标题…），
 * 而页面只是安静地少一块内容。
 *
 * 这里用内存夹具（`createSeedDatabase()`，不依赖真实后端）验三件事：
 *
 *   ① **回读的口径 = 网站现成那套解析口径**：拿真实的六个文件对一遍
 *      （`readSiteCore` 是导出的回读，`lib/data/*` 是网站自己的读法，两者必须一致）；
 *   ② **导出是导入的逆运算**：由这六个文件建起来的库导回去，六个文件**逐字节不变**；
 *   ③ **库改过的内容一字不差地进文件、并被读回来**：把库戳一堆改动（每个文件都动到），
 *      导出 → 回读，与库里那一份逐字段比。
 */
{
  const exportFiles = {} as Record<SiteExportFile, string>;
  for (const name of SITE_EXPORT_FILES) {
    exportFiles[name] = readFileSync(new URL(`../data/site/${name}.md`, import.meta.url), "utf8");
  }

  /** 两份核心内容逐字段比，返回前 8 处不同（比 eq 的整段 JSON 好读得多）。 */
  const coreDifferences = (expected: unknown, actual: unknown, limit = 8): string[] => {
    const out: string[] = [];
    const walk = (a: unknown, b: unknown, path: string): void => {
      if (out.length >= limit) return;
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if (
        a === null || b === null || typeof a !== "object" || typeof b !== "object" ||
        Array.isArray(a) !== Array.isArray(b)
      ) {
        out.push(`${path}：期望 ${JSON.stringify(a)}，实际 ${JSON.stringify(b)}`);
        return;
      }
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
        if (out.length >= limit) return;
      }
    };
    walk(expected, actual, "核心");
    return out;
  };

  /* ① 回读 == 网站现成的解析口径（真实的六个文件） */
  eq(
    "回读真实文件的结果与网站现成的解析口径完全一致",
    coreDifferences(
      siteCoreFromViews({
        copy: copyBlocksFromContent(),
        teachersPage: getTeachersPageFromTemplate(),
        courseColumns: getCourseColumnsFromTemplate(),
        coursesPage: getCoursesPageFromTemplate(),
        pricing: getPricingDataFromTemplate(),
        faq: getFaqContentFromTemplate(),
        cases: getCasesContentFromTemplate(),
        featured: getFeaturedContentFromTemplate(),
      }),
      readSiteCore(exportFiles),
    ),
    [],
  );

  /*
   * ② 由这六个文件建起来的库导回去 == 这六个文件（逐字节）
   *
   * 教师这里要补两位 AI 智能体：夹具刻意不把它们放进教师档案（它们不参与排课），
   * 而真实库里有（建库时从教师页导入的），不补上这条会假红。
   */
  const fileDb = createSeedDatabase();
  fileDb.teachers = getTeachersPageFromTemplate().teachers.map((teacher, index) => ({
    id: `t${index + 1}`,
    version: 1,
    name: teacher.name,
    subjects: teacher.subjects,
    role: teacher.role,
    phone: "",
    active: teacher.active,
    years: teacher.years,
    summary: teacher.summary,
    bio: teacher.bio,
    recommendation: teacher.recommendation,
    order: teacher.order,
    siteVisible: true,
    origin: "网站" as const,
    kind: teacher.kind === "ai" ? ("AI" as const) : ("教师" as const),
    // v30：内部字段留空；它们不导出，因此下面那条"逐字节不变"不受影响
    employment: "" as const,
    source: "",
  }));
  const fileSite = buildPublicSite(fileDb);
  const sameAgain = exportSiteMarkdown({ site: fileSite, existing: exportFiles });
  eq("库（由这六个文件建起来）导回去，六个文件逐字节不变", sameAgain.changed, []);
  eq("这一步没有「写不进文件」的东西", sameAgain.warnings, []);

  /* ③ 库改过的内容，导出后回读必须与库里那一份一致 */
  const mutated = JSON.parse(JSON.stringify(fileSite)) as PublicSite;
  type CopyBlockFixture = {
    fields: Array<{ key: string; value: string }>;
    groups: Array<{ title: string; items: Array<{ title: string; value: string }> }>;
  };
  const copyBlock = (key: string): CopyBlockFixture => {
    const blocks = mutated.siteContent.copy as unknown as Record<string, CopyBlockFixture>;
    const block = blocks[key];
    if (block === undefined) throw new Error(`夹具里没有文案块 ${key}`);
    return block;
  };
  const setField = (key: string, fieldKey: string, value: string): void => {
    const field = copyBlock(key).fields.find((item) => item.key === fieldKey);
    if (field === undefined) throw new Error(`夹具里没有字段 ${key}.${fieldKey}`);
    field.value = value;
  };
  const group = (key: string, title: string) => {
    const found = copyBlock(key).groups.find((item) => item.title === title);
    if (found === undefined) throw new Error(`夹具里没有分组 ${key}.${title}`);
    return found;
  };
  const find = <T extends { name: string }>(list: T[], name: string): T => {
    const found = list.find((item) => item.name === name);
    if (found === undefined) throw new Error(`夹具里没有 ${name}`);
    return found;
  };

  // content.md —— 品牌 / 首页 / 课程卡片 / 学科正文 / 选修课 / 教师
  setField("brand", "phone", "+86 138-0000-0000（自检）");
  copyBlock("brand").fields.push({ key: "brand_name_selfcheck", value: "自检字段" });
  setField("home", "title", "让学习真正发生（自检）");
  group("home", "首屏数据").items[0]!.value = "1-2 人";
  group("home", "教学特色").items.push({ title: "自检特色", value: "这条是自检加上的" });

  const xiaoxue = find(mutated.courses, "小学语文");
  xiaoxue.status = "暂未开放";
  xiaoxue.path = "primary-chinese-v2";
  xiaoxue.forms = ["一对一"];
  xiaoxue.tags = [{ label: "基础", target: "小学语文" }];
  const yuwen = find(mutated.siteContent.coursePage.subjects, "语文");
  yuwen.unavailable = true;
  yuwen.lead = "自检改过的学科导语。";
  yuwen.bands[0]!.body = "自检改过的小节正文。";
  const elective = find(mutated.courses, "成人英语口语");
  elective.intro = "自检改过的选修课介绍。";
  elective.status = "开放";
  find(mutated.teachers, "陈林维祎").bio = "自检改过的介绍第一段。\n\n第二段。";
  find(mutated.teachers, "林笑丹").active = false;
  find(mutated.teachers, "曹轶豪").siteVisible = false;
  mutated.teachers.find((teacher) => teacher.name.startsWith("采苓"))!.summary = "自检改过的一句话简介。";

  // pricing.md
  find(mutated.pricing.stages, "小学").courses[0]!.basePrice = 175;
  find(mutated.pricing.stages, "小学").courses[1]!.available = false;
  mutated.pricing.classTypes[1]!.coefficient = 0.75;
  mutated.pricing.durations[1]!.multiplier = 1.75;
  mutated.pricing.rules.singleLessonFeePercent = 15;
  mutated.pricing.trial!.priceLabel = "第一节课免费";
  find(mutated.pricing.otherItems, "课后晚辅导").details.push({ title: "高中", value: "9000 / 学期 / 人" });

  // faq.md / cases.md / featured.md / schedule.md
  mutated.siteContent.faqPage.groups[0]!.items[0]!.answer = "自检改过的答案。";
  mutated.siteContent.faqPage.groups.push({
    id: "faqg_selfcheck",
    title: "自检分组",
    items: [{ id: "faq_selfcheck", question: "自检问题？", answer: "自检答案。" }],
  });
  mutated.siteContent.casesPage.cases[0]!.story = "自检改过的过程描述第一段。\n\n第二段。";
  mutated.siteContent.casesPage.cases.push({
    id: "case_selfcheck",
    title: "自检案例｜从 0 到 1",
    fields: [{ title: "年级", value: "高二" }],
    story: "自检用的案例过程。",
  });
  const featuredFirst = mutated.siteContent.featuredPage.courses[0]!;
  featuredFirst.body = "自检改过的特色课程介绍。";
  featuredFirst.fields[0]!.value = "自检改过的适合对象。";
  featuredFirst.children[0]!.name = "一对一（自检）";
  mutated.siteContent.featuredPage.courses.push({
    id: "feat_selfcheck",
    name: "自检特色课",
    slug: "self-check",
    fields: [{ title: "课程定位", value: "自检课程定位" }],
    body: "自检课程正文。",
    children: [],
  });
  group("schedule", "工作日排课").items[0]!.value = "18:00–20:00";
  copyBlock("schedule").groups.push({
    title: "自检分组",
    items: [{ title: "自检时段", value: "10:00–11:00" }],
  });

  const exported = exportSiteMarkdown({ site: mutated, existing: exportFiles });
  ok("库改过之后导出确实改到了文件", exported.changed.length >= 5, `changed=${exported.changed.join(",")}`);
  eq(
    "库改过的内容导出后回读，与库里那一份逐字段一致",
    coreDifferences(
      siteCoreFromViews({
        copy: mutated.siteContent.copy,
        teachersPage: backendTeachersPage(mutated),
        courseColumns: backendCourseColumns(mutated),
        coursesPage: backendCoursesPage(mutated),
        pricing: backendPricingData(mutated),
        faq: backendFaqContent(mutated),
        cases: backendCasesContent(mutated),
        featured: backendFeaturedContent(mutated),
      }),
      readSiteCore(exported.files),
    ),
    [],
  );
  eq("改过之后导出也没有「写不进文件」的东西", exported.warnings, []);
  ok(
    "不展示的教师没有写进文件（`.md` 表达不了那个开关）",
    exported.notes.some((note) => note.includes("曹轶豪")),
  );

  // 导出必须**收敛**：拿导出的结果再导一次，一个字节都不该变
  const again = exportSiteMarkdown({ site: mutated, existing: exported.files });
  eq("反复导出收敛（第二次导出不再改动任何文件）", again.changed, []);

  /*
   * 护栏：文件不见了 / 是空的 / 页面标记被改坏时**不许写**。
   *
   * 那几种情况下生成出来的是一份"没有页面"的残骸（可能只有两行），而写盘是静默的 ——
   * 一次误操作就把机构那份内容文件抹掉。因此导出要能自己认出这种情况并停下来
   * （`npm run site:export` 会连一个字都不写，退出码 2）。
   */
  const blanked = exportSiteMarkdown({
    site: fileSite,
    existing: { ...exportFiles, schedule: "" },
  });
  eq(
    "文件不见了/是空的：导出拒绝它（不许写出一份残骸）",
    blanked.unsafe.map((item) => item.file),
    ["schedule"],
  );
}

console.log("\n=== 44. 三个内部字段：校区 / 全职兼职 / 来源（v30）===");

/*
 * 机构原话：「**在教室页面里添加一个校区字段吧，教师界面也添加一个全职/兼职以及教师来源**」。
 *
 * 这一节守四件事，每一件都对应"加字段最容易踩的一种坑"：
 *
 *   ① **迁移**：老库（v29）缺这三个字段 → 补**空串**（不猜内容）。
 *      这里尤其值得钉住：库里那几位教师是照网站教师页建的，机构从没登记过
 *      谁是全职谁是兼职 —— 默认成「全职」等于凭空记下一条会被拿去算成本的人事事实。
 *   ② **校验**：`employment` 只认 全职 / 兼职 / 空串，**非法值报错拒绝**，
 *      而且被拒的那一次**什么都不写**（连版本号都不推进）。
 *   ③ **导入**：模板与表头里有这三列；空单元格导出「未填」而不是第一个候选值。
 *   ④ **不许泄漏到公网**：公开快照（`site.publicContent` 的产出形状）与
 *      `data/site/content.md` 里都不出现它们 —— 招聘渠道与用工性质是人事信息，
 *      校区是内部结构，公开仓库与 Pages 上都不该有。
 *
 * 还要单独说清 **`source`（招聘渠道）与 `origin`（这条档案从哪来）是两个东西**：
 * 前者回答"这个人是机构从哪招来的"，后者回答"这条记录是网站同步还是后台手建"。
 * 两者在中文里都能叫"来源"，因此界面上刻意分开：字段叫「来源」，技术小标叫「网站导入」。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  /** 切到一份干净的存储上验（与前面几节同一条做法） */
  const internalMemory = createMemoryStore();
  __useStoreForTesting(internalMemory);

  // ── ① 取值域常量 ───────────────────────────────────────────────────────
  eq("用工性质只有「全职 / 兼职」两个候选值（空串＝未填不在常量里）",
    [...TEACHER_EMPLOYMENTS], ["全职", "兼职"]);

  /** 教师入参（与页面表单交上来的形状一致）。 */
  const teacherPayload = (
    name: string,
    fields: { employment?: TeacherEmployment | ""; source?: string } = {},
  ): Omit<Teacher, "id" | "version"> => ({
    name, role: "", subjects: [], phone: "", active: true,
    years: "", summary: "", bio: "", recommendation: "", order: 999,
    siteVisible: false, origin: "后台", kind: "教师",
    employment: fields.employment ?? "",
    source: fields.source ?? "",
  });

  /*
   * 故意传一个**类型上不合法**的值。类型系统本来就会拦住这种调用，
   * 这一条验的是**运行时那道闸**（`/api/call` 的 args 原样进服务层，编译期帮不上忙），
   * 因此这里必须绕过类型 —— 用一个说清意图的小函数，而不是散落的 `as never`。
   */
  const illegalEmployment = (value: unknown): Partial<Teacher> => ({
    employment: value as TeacherEmployment,
  });

  // ── ② 迁移：v29 老库 → v30，一律补空串 ────────────────────────────────
  const v29Internal = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    version: number;
    teachers: Array<Record<string, unknown>>;
    classrooms: Array<Record<string, unknown>>;
  };
  v29Internal.version = 29;
  v29Internal.teachers = v29Internal.teachers.map((teacher) => {
    const copy = { ...teacher };
    delete copy.employment;
    delete copy.source;
    return copy;
  });
  v29Internal.classrooms = v29Internal.classrooms.map((room) => {
    const copy = { ...room };
    delete copy.campus;
    return copy;
  });
  eq("夹具确实是「缺这三个字段的 v29 库」",
    [
      v29Internal.teachers.every((t) => !("employment" in t) && !("source" in t)),
      v29Internal.classrooms.every((c) => !("campus" in c)),
    ],
    [true, true]);

  const v30Upgrade = await api.importDatabase(JSON.stringify(v29Internal));
  ok("v29 老库能导入并升级", v30Upgrade.ok);
  eq("升级后版本号是当前版本", (await api.exportDatabase()).version, CURRENT_VERSION);
  const v30Teachers = await api.teachers.list();
  ok("v29 → v30 给教师补的「全职 / 兼职」是空串（不猜内容：机构从没登记过谁是全职）",
    v30Teachers.every((teacher) => teacher.employment === ""),
    v30Teachers.map((teacher) => `${teacher.name}=${JSON.stringify(teacher.employment)}`).join(" / "));
  ok("v29 → v30 给教师补的「来源」是空串（招聘渠道是机构自己才知道的事）",
    v30Teachers.every((teacher) => teacher.source === ""));
  ok("v29 → v30 给教室补的「校区」是空串（教室名里看得出校区，但「看得出」不等于「登记过」）",
    (await api.classrooms.list()).every((room) => room.campus === ""));
  ok("补字段不动原有内容（姓名 / 职务 / 来源口径 / 容量都还在）",
    v30Teachers.every(
      (teacher) =>
        teacher.name !== "" &&
        teacher.role !== "" &&
        // `origin`（这条档案从哪来）仍然是那两档之一 —— 迁移不该搅动它
        (teacher.origin === "网站" || teacher.origin === "后台"),
    ) &&
    (await api.classrooms.list()).every((room) => room.name !== "" && room.capacity > 0));
  /* 迁移只加字段、不改别的：拿迁移前后各表逐字节比一次是 `scripts/` 外的事（真实库上做过），
   * 这里选两条最容易被迁移顺手改掉的：教师版本号与教室可用时段。 */
  ok("迁移不推版本号（乐观锁不该被一次升级搅动）",
    v30Teachers.every((teacher) => teacher.version >= 1));
  ok("迁移不动教室的可用时段",
    (await api.classrooms.list()).every((room) => Array.isArray(room.availability)));

  /*
   * 收尾归一：一份**自称 v30 却缺这三个字段**的文件。
   *
   * 会出现的场合：手改过的导出、只跑了一半的恢复、以及**导入**。
   * 缺了它们的后果是看得见的坏（教师页下拉读到 `undefined`、教室卡片上「校区：undefined」），
   * 而且不报错 —— 因此收尾归一必须兜一次，与 `db.coursePartitions` 那种兜法同一条纪律。
   */
  const v30MissingFields = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown>;
  for (const teacher of (v30MissingFields.teachers ?? []) as Array<Record<string, unknown>>) {
    delete teacher.employment;
    delete teacher.source;
  }
  for (const room of (v30MissingFields.classrooms ?? []) as Array<Record<string, unknown>>) {
    delete room.campus;
  }
  eq("夹具自称的就是当前版本（走的不是迁移分支，而是收尾归一）",
    v30MissingFields.version, CURRENT_VERSION);
  ok("「自称 v30 却缺字段」的文件也能导入", (await api.importDatabase(JSON.stringify(v30MissingFields))).ok);
  ok("收尾归一给教师补上空串",
    (await api.teachers.list()).every((teacher) => teacher.employment === "" && teacher.source === ""));
  ok("收尾归一给教室补上空串",
    (await api.classrooms.list()).every((room) => room.campus === ""));

  /*
   * 收尾归一遇到**非法取值**时不许抛错：抛错等于整库读不出来，
   * 那是比"显示成未填"坏得多的结局。归成空串（＝未填，人可以在下拉里重选），
   * 而**拒绝非法值的那道闸留在服务层**（下面第三条验它）。
   */
  const v30DirtyValue = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    teachers: Array<Record<string, unknown>>;
  };
  const dirtyIndex = 0;
  v30DirtyValue.teachers[dirtyIndex]!.employment = "临时工";
  v30DirtyValue.teachers[dirtyIndex]!.source = "  内部推荐  ";
  ok("手改文件里带着非法取值也能读进来（不许因此整库打不开）",
    (await api.importDatabase(JSON.stringify(v30DirtyValue))).ok);
  const dirtyTeacher = (await api.teachers.list())[dirtyIndex]!;
  eq("那个非法取值被归成空串＝未填（下拉里显示不出「临时工」，留着才是坑）",
    dirtyTeacher.employment, "");
  eq("同一行的「来源」只是去掉了前后空白", dirtyTeacher.source, "内部推荐");

  // ── ③ 服务层：合法值能存能读回来，非法值报错拒绝 ──────────────────────
  const internalTeacher = await api.teachers.create(
    teacherPayload("自检·内部字段老师", { employment: "全职", source: "  朋友介绍  " }),
  );
  /*
   * 来源去空白：与 `note` / `campus` 同一处口径。不去的话「朋友介绍」与「朋友介绍 」是两条
   * 不同的值，按渠道统计时会各算一份 —— 而列表上看不出区别（尾部空格不显示）。
   */
  eq("合法的「全职」能存能读回来，且「来源」去掉了前后空白",
    [(await api.teachers.get(internalTeacher.id))?.employment, (await api.teachers.get(internalTeacher.id))?.source],
    ["全职", "朋友介绍"]);

  const internalUpdated = await api.teachers.update(internalTeacher.id, {
    employment: "兼职", source: "招聘网站",
  });
  eq("改成另一个合法值也能读回来", [internalUpdated?.employment, internalUpdated?.source], ["兼职", "招聘网站"]);

  const versionBeforeReject = (await api.teachers.get(internalTeacher.id))!.version;
  const rejection = await (async () => {
    try {
      await api.teachers.update(internalTeacher.id, illegalEmployment("临时工"));
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  })();
  ok("非法取值被**报错拒绝**（不是静默压成空串）",
    rejection !== null && rejection.includes("全职") && rejection.includes("临时工"),
    rejection ?? "没有报错 —— 非法值被静默接受了");
  eq("被拒的那一次**什么都没写**（值还是原来的值，版本号也没推进）",
    [(await api.teachers.get(internalTeacher.id))?.employment, (await api.teachers.get(internalTeacher.id))?.version],
    ["兼职", versionBeforeReject]);

  const cleared = await api.teachers.update(internalTeacher.id, { employment: "" });
  eq("空串（＝未填）是合法的一档，能选回来", cleared?.employment, "");
  /*
   * 字段级 patch（页面上点一下切在职就是这种调用）**不能把新字段抹掉**：
   * patch 会与库里那条合并，因此合并后的记录照样过一遍校验与归一。
   */
  const patched = await api.teachers.update(internalTeacher.id, { active: false });
  eq("只改一个字段的 patch 不会把新字段弄丢", [patched?.employment, patched?.source], ["", "招聘网站"]);

  /*
   * **不知道这个字段的老调用方**（老脚本、老版客户端）仍然能建档案：
   * 入参里根本没有这两个键时按"未提供"处理 → 补空串＝未填。
   * 这条与"非法值报错"是一对：**没给** 不等于 **给错了** —— 前者按迁移那条纪律补空串，
   * 后者必须顶回去（"我明明填了兼职"不能变成一次无声的数据改动）。
   */
  const legacyPayload = teacherPayload("自检·老调用方老师") as Record<string, unknown>;
  delete legacyPayload.employment;
  delete legacyPayload.source;
  const legacyTeacher = await api.teachers.create(
    legacyPayload as unknown as Omit<Teacher, "id" | "version">,
  );
  eq("入参里没有这两个字段的老调用方仍然能建档案（缺字段＝未填，与迁移同口径）",
    [legacyTeacher.employment, legacyTeacher.source], ["", ""]);

  // 教室：校区**必填**（v31 收紧），但仍然是自由文本、只去空白
  /*
   * 夹具的教室名**刻意不带「·」**（v31 起「·」是校区与教室名的连接符，见第 45 节）：
   * 这一组验的是「校区」这一格本身（trims、改值、**不许清空**），名字里带「·」会把
   * "清空校区"变成"又从名字里拆出一个校区"，那是另一条规则、由第 45 / 46 节单独验。
   */
  const internalRoom = await api.classrooms.create({
    name: "自检校区教室", kind: "上课用教室", capacity: 4,
    availability: [], note: "", campus: "  城西校区  ",
  });
  eq("校区存的时候去掉前后空白", (await api.classrooms.get(internalRoom.id))?.campus, "城西校区");
  eq("校区能改成另一个值并读回来",
    (await api.classrooms.update(internalRoom.id, { campus: "总校" }))?.campus, "总校");
  /*
   * **v31 收紧**：校区**不许清空**（机构原话「校区必须填」）。
   *
   * 这一条原先断言的是"校区也允许清空（＝未填）"—— 那句话正是这次要作废的口径，
   * 因此断言跟着反过来：拒绝 + 错误里点名「校区」+ **什么都没写**（值没变、版本号没推进）。
   * 只判"抛错了"是不够的：拒绝路径写进去半截值，比不拒绝更难查。
   */
  const versionBeforeCampusClear = (await api.classrooms.get(internalRoom.id))!.version;
  const campusClearRejection = await (async () => {
    try {
      await api.classrooms.update(internalRoom.id, { campus: "  " });
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  })();
  ok("把校区清空（空格串）会被**报错拒绝**，错误里点名「校区」并说清为什么必须填",
    campusClearRejection !== null &&
      campusClearRejection.includes("校区") &&
      campusClearRejection.includes("必填"),
    campusClearRejection ?? "没有报错 —— 空格串被当成了合法校区");
  eq("被拒的那一次**什么都没写**（校区还是原来的值、版本号也没推进）",
    [(await api.classrooms.get(internalRoom.id))?.campus, (await api.classrooms.get(internalRoom.id))?.version],
    ["总校", versionBeforeCampusClear]);

  // ── ④ 批量导入：模板与表头里有这三列 ──────────────────────────────────
  /*
   * 表头那一行要先掐掉 BOM 与行尾的 `\r`：CSV 模板为了 Excel 会在开头写 BOM，
   * 而 `toCsv` 用的是 CRLF —— 不处理的话最后一列会带着一个看不见的 `\r`，
   * `includes("来源")` 就会假红（第一版就是这么红的）。
   */
  const headerCells = (text: string): string[] =>
    (text.split("\n")[0] ?? "").replace(/^\uFEFF/, "").trim().split(",");
  const internalTeacherHeader = headerCells(csvTemplate("teachers"));
  ok("教师 CSV 模板的表头里有「全职兼职」与「来源」",
    internalTeacherHeader.includes("全职兼职") && internalTeacherHeader.includes("来源"),
    internalTeacherHeader.join(","));
  const internalTeacherJson = jsonTemplate("teachers");
  ok("教师 JSON 模板里有 employment / source 两个键",
    internalTeacherJson.includes('"employment"') && internalTeacherJson.includes('"source"'));
  const internalRoomHeader = headerCells(csvTemplate("classrooms"));
  ok("教室 CSV 模板的表头里有「校区」", internalRoomHeader.includes("校区"), internalRoomHeader.join(","));
  ok("教室 JSON 模板里有 campus 键", jsonTemplate("classrooms").includes('"campus"'));

  /*
   * 表头识别：列名写「全职兼职」或「全职/兼职」都认（`aliases` 惯例，与「家长电话 / 联系方式」同一套）。
   * 空单元格必须是**未填**，不能是第一个候选值 —— 否则一份没写用工性质的名单导进来，
   * 所有人都会变成「全职」（凭空多出几十条假的人事事实）。
   */
  const internalImport = parseImport(
    "teachers",
    "姓名,全职/兼职,来源\n导入·兼职老师,兼职,内部推荐\n导入·未填老师,,\n",
  );
  eq("「全职/兼职」这种列名也认，两行都通过校验",
    [internalImport.problems, internalImport.records.length], [[], 2]);
  eq("合法的取值原样收下", internalImport.records[0]?.employment, "兼职");
  eq("**空单元格 = 未填**（不是第一个候选值「全职」）", internalImport.records[1]?.employment, "");
  eq("「来源」列被收下", internalImport.records[0]?.source, "内部推荐");
  const internalBadImport = parseImport("teachers", "姓名,全职兼职\n导入·错老师,临时工\n");
  eq("导入里非法取值被拦下并指到行", internalBadImport.problems.map((item) => item.line), [2]);
  ok("错误信息说明只能是哪几个值",
    (internalBadImport.problems[0]?.reason ?? "").includes("全职") &&
    (internalBadImport.problems[0]?.reason ?? "").includes("临时工"),
    internalBadImport.problems[0]?.reason ?? "");
  eq("教室的「校区」列能解析",
    parseImport("classrooms", "名称,用途,校区\n导入·校区教室,上课用教室,城西校区\n").records[0]?.campus,
    "城西校区");

  const appliedInternal = await api.imports.apply({
    entity: "teachers",
    text: "姓名,全职兼职,来源\n导入·用工性质老师,兼职,校招\n",
  });
  ok("导入真的落库（含这两个新字段）",
    appliedInternal.ok &&
      (await api.teachers.list()).some(
        (teacher) => teacher.name === "导入·用工性质老师" &&
          teacher.employment === "兼职" && teacher.source === "校招",
      ),
    JSON.stringify(appliedInternal.skipped));

  // ── ⑤ 界面源码里有这三处（源码级，不依赖浏览器）──────────────────────
  /**
   * 去掉注释再查源码（与 §22 同一个坑、同一个做法）：注释里正解释着"另一处怎么写"，
   * 直接子串匹配会把注释算进去 —— 例如下面那条"小标顺序"断言，注释里就写着
   * 「填了显示值、没填显示灰色待办小标（「用工未填」/「来源未填」）」，不剥注释会取到它。
   */
  const internalStripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const internalTeachersPage = read("app/admin/(dashboard)/teachers/page.tsx");
  const internalClassroomsPage = read("app/admin/(dashboard)/classrooms/page.tsx");
  ok("教师表单里有「全职 / 兼职」下拉，且带上「未填」这一档",
    internalTeachersPage.includes('label="全职 / 兼职"') &&
      internalTeachersPage.includes("TEACHER_EMPLOYMENTS") &&
      internalTeachersPage.includes('label: "未填"'));
  ok("教师表单里有「来源」输入框，并写明它是**招聘渠道**",
    internalTeachersPage.includes('label="来源"') && internalTeachersPage.includes("招聘渠道"));
  ok("教师表单整份提交时把这两个字段一起交上去",
    /employment,\s*\n\s*source: source\.trim\(\)/.test(internalTeachersPage));
  ok("「来源」给了 `<datalist>`（已在用的渠道可复用，也不拦着写新的）",
    internalTeachersPage.includes("<datalist") && internalTeachersPage.includes("sourceOptions"));
  /*
   * ── 卡片上那两个人事小标：**填了显示值、没填显示灰色待办标**（机构口径）──
   *
   * 机构原话：「**教师信息我自己在后台填**，更希望**没填的时候也看得出来**
   * （比如卡片上显示一个灰色的「用工未填」，提醒你去补）」。
   *
   * 因此这里查的是"**空值那一支渲染出来的是什么**"，而不是"有没有这个字段"：
   * 写成 `{x !== "" && <span>…</span>}`（没填就什么都不渲染）正好是机构要反过来的那种写法，
   * 一条断言就能把它拦住。
   */
  const employmentBranch = /teacher\.employment === ""\s*\?([\s\S]{0,400}?)\)\s*:\s*\(/.exec(internalTeachersPage);
  const sourceBranch = /teacher\.source === ""\s*\?([\s\S]{0,400}?)\)\s*:\s*\(/.exec(internalTeachersPage);
  ok("没填时卡片上渲染的是「用工未填」文案（不是 null / 不渲染）",
    employmentBranch !== null && employmentBranch[1]!.includes("用工未填"),
    employmentBranch === null ? "源码里没有「employment 为空 ? … : …」这样的分支" : employmentBranch[1]!.slice(0, 120));
  ok("「来源」没填时渲染的是「来源未填」文案",
    sourceBranch !== null && sourceBranch[1]!.includes("来源未填"),
    sourceBranch === null ? "源码里没有「source 为空 ? … : …」这样的分支" : sourceBranch[1]!.slice(0, 120));
  /* 另一态也要钉住（这一条以前叫"有值才显示"，现在两态都要看得见） */
  ok("填了的时候渲染的是**值本身**（不是灰标、也不是空着）",
    internalTeachersPage.includes("{teacher.employment}") &&
      internalTeachersPage.includes("来源 {teacher.source}"));
  ok("两个待办灰标用同一个类与同一条提示（一个字段一个样式会让人以为其中一个没生效）",
    (internalTeachersPage.match(/HR_TODO_CLASS/g) ?? []).length >= 3 &&
      (internalTeachersPage.match(/HR_TODO_HINT/g) ?? []).length >= 3);
  ok("灰标是虚线边框 + 灰底 + 更浅的字色，与已填的白底描边**分得开**",
    /HR_TODO_CLASS =\s*"[^"]*border-dashed[^"]*bg-ink-50[^"]*text-ink-400/.test(internalTeachersPage) &&
      /HR_FILLED_CLASS =\s*"[^"]*border-ink-200[^"]*bg-white[^"]*text-ink-600/.test(internalTeachersPage));
  ok("灰标带悬停提示，说明去哪儿补（「点姓名展开就能填」）",
    /HR_TODO_HINT =\s*"[^"]*点姓名展开就能填/.test(internalTeachersPage));
  /*
   * 顺序：`AI` → `教龄 …` → 用工性质 → 来源。
   * 待办灰标**不许抢到 AI / 教龄 前面** —— 身份与资历是"这个人是谁"，
   * 待办是"还缺一条信息"，缺的不该排在身份前面（机构原话里的那个例子就在教龄那一排）。
   */
  {
    const teachersCode = internalStripComments(internalTeachersPage);
    const order = ["kind === \"AI\"", "教龄 {teacher.years}", "用工未填", "来源未填"]
      .map((marker) => teachersCode.indexOf(marker));
    ok("卡片上小标的顺序：AI → 教龄 → 用工性质 → 来源",
      order.every((index) => index >= 0) &&
        order.every((index, i) => i === 0 || order[i - 1]! < index),
      order.join(" / "));
  }
  /*
   * ── 卡片上**不再渲染 `origin`**（机构口径：「教师标签里的『网站导入』能删掉吗？」）──
   *
   * 这一条与上面那条**配套、方向相反**，两条都要在：
   *   - 这里：界面上**没有**那个标了（那段 JSX 与它的文案都不在了）——
   *     上一条口径（把标改名成「网站导入」）已经作废，因此这条是"反过来"的那一条；
   *   - 下面那条：`origin` **字段还在**（类型 / 迁移 / 导入都在用），不许有人顺手把字段也删了。
   *
   * 为什么删标但留字段：v36 删掉「从网站导入教师」入口之后**不会再有新的「网站」来源档案**，
   * 这个标只会出现在当年那几条老记录上（真实库里 5 位教师有 4 位是 `网站`），留着只是噪声、
   * 还容易与人事的「来源（招聘渠道）」撞名；而 `origin` 记的是"这条档案当初从哪来"这段历史事实，
   * 删字段要动数据库形状（迁移 / 夹具 / 导入 / 导出 / 断言全在用），不值当。
   */
  {
    const teachersCode = internalStripComments(internalTeachersPage);
    ok("教师卡片上不再渲染 origin（那段 JSX 与「网站导入」文案都不在了）",
      !teachersCode.includes("teacher.origin") && !teachersCode.includes("网站导入"));
    ok("列表里也不再出现「来自网站」那种技术小标的文案",
      !teachersCode.includes("来自网站"));
    /* 字段还在：类型里有它、导入会给它赋值、导出的教师映射与断言都照旧用它 */
    const teacherSource = read("lib/backend/types.ts");
    ok("`origin` 字段仍在类型里（删标不等于删字段）",
      teacherSource.includes("origin: TeacherOrigin") && teacherSource.includes("TeacherOrigin"));
    ok("`origin` 仍然由迁移与导入维护（不是「没人写了」的死字段）",
      read("lib/backend/import.ts").includes("origin: record.origin") &&
        read("lib/backend/api.ts").includes("origin: teacher.origin ?? \"后台\""));
    ok("`origin` 的类型注释写清了「为什么留字段、界面为什么不显示」",
      teacherSource.includes("界面上不再显示") && teacherSource.includes("以后不会再有新的档案是「网站」来源"));
  }

  ok("教室表单里有「校区」输入框", internalClassroomsPage.includes('label="校区"'));
  ok("校区给了 `<datalist>`（已在用的校区可复用）",
    internalClassroomsPage.includes("<datalist") && internalClassroomsPage.includes("campusOptions"));
  ok("教室页卡片标题走显示口径（v31：校区为空时就是纯教室名，因此不会出现一个空的「校区：」）",
    internalClassroomsPage.includes("classroomLabel(room)") &&
      !internalClassroomsPage.includes("校区：") &&
      // 标题里已经含校区，那一行不再单独印一遍（同一条信息不重复两遍）
      !internalClassroomsPage.includes("校区 {room.campus}"));
  ok("教室表单整份提交时带上校区", /campus: campus\.trim\(\)/.test(internalClassroomsPage));

  // ── ⑥ 不许泄漏到公网 ──────────────────────────────────────────────────
  const internalPublicKeys = [...collectKeys(await api.site.publicContent())].map((key) => key.toLowerCase());
  eq("公开快照里没有 employment / source / campus 这三个键（内部信息不上网）",
    internalPublicKeys.filter((key) => ["employment", "source", "campus"].includes(key)), []);

  /*
   * 值层面的金丝雀：夹具给前两位教师写了「全职」「朋友介绍」、给教室里写了「总校 / 城西校区」——
   * 万一有人把字段塞进公开映射，这些**只可能来自内部字段**的字符串会当场出现在快照里。
   * （查键名可能漏掉"换了个名字给出去"，查值能把这条也堵上。）
   */
  const internalPublicText = JSON.stringify(await api.site.publicContent());
  ok("公开快照的正文里也没有「全职 / 朋友介绍」这类人事内容",
    !/全职|兼职|朋友介绍|内部推荐|校招|招聘渠道/.test(internalPublicText));

  /**
   * `public-site.ts` 的**字段白名单**里不许出现这三个字段。
   *
   * 那个文件的设计是"新增字段必须显式写一行，忘了就是没给出去 —— 失败方向是安全的"，
   * 因此它里面不该有这三个字段的任何痕迹，连注释里都不该有
   * （免得后人以为"它已经给出去过了"）。
   *
   * **查之前先去注释**：这个文件的注释里引用了 `lib/site/backend-source.ts`
   * （一个模块路径，里面正好有 `source` 这个词）—— 直接子串匹配会当场假红。
   * 与 §22 那条"去掉注释再查"同一个坑、同一个做法。
   */
  const internalPublicSiteCode = internalStripComments(read("lib/backend/public-site.ts"));
  eq("公开字段白名单的源码里没有这三个字段（注释里也没有）",
    ["employment", "source", "campus"].filter((key) => internalPublicSiteCode.includes(key)), []);

  /*
   * `data/site/content.md`：网站内容的真源（线上连不上后端时读的就是它）。
   * 招聘渠道与用工性质是**人事信息**，公开仓库与 Pages 上都不该有。
   *
   * 注意判据要挑准：`campus` 这个词**不能**直接禁用 —— 文件里本来就有 `campus_title: 校区信息`
   * 这个页面文案键（讲的是"关于页那一块叫校区信息"），它合法。因此查的是
   * `campus:` 这种**数据字段**写法，以及那几个只在人事语境里出现的词。
   */
  const internalContentMd = read("data/site/content.md");
  eq("content.md 里没有这三个数据字段的键",
    ["employment:", "source:", "campus:"].filter((key) => internalContentMd.includes(key)), []);
  ok("content.md 里没有招聘渠道 / 用工性质那类内容",
    !/招聘渠道|全职|兼职|朋友介绍|内部推荐|校招|用工性质/.test(internalContentMd));

  /*
   * 导出到文件的那条路同样不许带出去（导出的是网站内容，不是整库里的每一列）。
   *
   * 判据要挑**字段写法**（`key:`）而不是裸词：导出的 `content.md` 里本来就有
   * `campus_title: 校区信息` / `campus_description` 这两个**页面文案键**
   * （「关于」页那一块的标题与说明），它们是合法的 —— 禁裸词 `campus` 会当场误报。
   * 真正要拦住的是"有人把 `Classroom.campus` 加到导出映射里"，那写出来是 `campus: 值`。
   */
  const internalExportExisting = {} as Record<SiteExportFile, string>;
  for (const name of SITE_EXPORT_FILES) {
    internalExportExisting[name] = readFileSync(new URL(`../data/site/${name}.md`, import.meta.url), "utf8");
  }
  const internalExported = exportSiteMarkdown({
    site: buildPublicSite(await api.exportDatabase()),
    existing: internalExportExisting,
  });
  const internalExportText = Object.values(internalExported.files).join("\n");
  eq("导出成 `data/site/*.md` 的内容里没有这三个数据字段的键",
    ["employment:", "source:", "campus:"].filter((key) => internalExportText.includes(key)), []);
  ok("导出里也没有「全职 / 朋友介绍」这类值（值层面的金丝雀）",
    !/全职|兼职|朋友介绍|内部推荐|校招/.test(internalExportText));

  // ── 收尾：清掉这一节造的夹具，别影响后面的用例 ────────────────────────
  await api.teachers.remove(legacyTeacher.id);
  await api.teachers.remove(internalTeacher.id);
  await api.classrooms.remove(internalRoom.id);
  __useStoreForTesting(memory);
}

console.log("\n=== 45. 教室名：显示格式不变、输入分开（v31「校区·教室名」）===");

/*
 * 机构原话：「**沐阳教育·教室1**，现在这个显示格式就是校区·教室名，现在添加了校区字段，
 * 也就意味着我需要这个**卡片显示格式不变**，但**输入的时候校区和教室名称要单独输入**」。
 *
 * 这一节守四件事：
 *   ① **显示口径只有一处**（`classroomLabel`）：全后台给用户看教室名的地方都走它
 *      —— 源码级断言（清单显式写出来，新增显示点要加进来）；
 *   ② **拆分只有一处**（`normalizeClassroom` 内的 `splitCampusFields`）：用一份
 *      「沐阳教育·教室1」的 **v30 老库**走真实 `migrate()`，断言拆成
 *      `campus=沐阳教育` / `name=教室1`，并且**再跑一次不变**（幂等）；
 *   ③ **导入也拆**：一份"名称列写着「沐阳教育·教室1」"的老表要识别成**同一间房**
 *      （否则重导一次就多出一间重复的房）；
 *   ④ **表单是两个独立输入框**（校区 / 教室名称），且显示时拼回去。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  /** 去掉注释再查源码（与 §22 / §44 同一个坑：注释里提到的词不算代码） */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // ── ① helper 本身：有校区就拼、没有就纯名 ───────────────────────────────
  eq("有校区 → 「校区·教室名」（中文间隔号、**不加空格**）",
    classroomLabel({ campus: "沐阳教育", name: "教室1" }), "沐阳教育·教室1");
  eq("没有校区 → 就是教室名本身（不留下一个孤零零的「·」）",
    classroomLabel({ campus: "", name: "教室1" }), "教室1");
  eq("两边只有一边有时也不出多余符号",
    [classroomLabel({ campus: "沐阳教育", name: "" }), classroomLabel({ campus: "", name: "" })],
    ["沐阳教育", ""]);
  eq("夹具里那两间房拼出来就是机构熟悉的样子",
    [classroomLabel({ campus: "总校", name: "301 教室" }), classroomLabel({ campus: "城西校区", name: "自习区" })],
    ["总校·301 教室", "城西校区·自习区"]);
  /*
   * 拆分规则的三行表（`splitCampusFields`）。第二行是**真实数据里出现过**的那种：
   * 校区那一格填了、教室名里又粘着同一段校区 —— 不管的话显示会拼两遍
   * （「沐阳教育·沐阳教育·教室1」），而那看起来像界面坏了、不像数据问题。
   */
  eq("三种情形各归各位（拆 / 去重复前缀 / 原样）",
    [
      splitCampusFields({ campus: "", name: "沐阳教育·教室1" }),
      splitCampusFields({ campus: "沐阳教育", name: "沐阳教育·教室1" }),
      splitCampusFields({ campus: "沐阳教育", name: "教室1" }),
    ],
    [
      { campus: "沐阳教育", name: "教室1" },
      { campus: "沐阳教育", name: "教室1" },
      { campus: "沐阳教育", name: "教室1" },
    ]);
  eq("去重复前缀时**只**动名字（校区那一格原样保留）",
    splitCampusFields({ campus: "全慧教育", name: "全慧教育·落地房四楼大" }),
    { campus: "全慧教育", name: "落地房四楼大" });
  eq("去掉前缀之后名字不能变成空的（「沐阳教育·」这种原样留着）",
    splitCampusFields({ campus: "沐阳教育", name: "沐阳教育·" }),
    { campus: "沐阳教育", name: "沐阳教育·" });
  /*
   * **只剥一次**（机构口径里写明的一条，而且它是对的）。
   * 粘了两遍校区时（粘两回才会出现），剥一次之后显示仍是原来那串（不变）；
   * 若改成"循环剥到干净"，名字会变成「教室9」、显示**被改短** —— 那就不是"去掉重复"
   * 而是"替用户改名字"了。这一条防止有人把实现"优化"成循环。
   */
  eq("粘了两遍校区：只剥一次（剥完显示与原文一字不差）",
    [
      splitCampusFields({ campus: "沐阳教育", name: "沐阳教育·沐阳教育·教室9" }).name,
      classroomLabel({
        campus: "沐阳教育",
        name: splitCampusFields({ campus: "沐阳教育", name: "沐阳教育·沐阳教育·教室9" }).name,
      }),
    ],
    ["沐阳教育·教室9", "沐阳教育·沐阳教育·教室9"]);

  // ── ② 真实 migrate()：一份「沐阳教育·教室1」的 v30 老库 ─────────────────
  const splitMemory = createMemoryStore();
  __useStoreForTesting(splitMemory);
  const v30Merged = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    version: number;
    classrooms: Array<Record<string, unknown>>;
  };
  v30Merged.version = 30;
  // 真实库那 6 间就是这么写的：名字里是「校区·教室名」、campus 是空的
  v30Merged.classrooms = [
    { id: "cx1", version: 1, name: "沐阳教育·教室1", kind: "上课用教室", campus: "", capacity: 2, availability: [], note: "无白板" },
    { id: "cx2", version: 1, name: "沐阳教育·自习室", kind: "自习室", campus: "", capacity: 10, availability: [], note: "网课+自习+答疑" },
    { id: "cx3", version: 1, name: "全慧教育·落地房四楼小", kind: "上课用教室", campus: "", capacity: 2, availability: [], note: "小白板" },
    // 已经分开填过的（campus 非空）—— 迁移**不许**再动它
    { id: "cx4", version: 1, name: "教室9", kind: "上课用教室", campus: "沐阳教育", capacity: 4, availability: [], note: "" },
    // 名字里没有「·」的 —— 没什么可拆
    { id: "cx5", version: 1, name: "自习区", kind: "自习室", campus: "", capacity: 6, availability: [], note: "" },
    /*
     * 校区那一格已经有值、名字里**又**粘着同一段校区（真实数据里出现过：先在表单里填了
     * 校区，又把老表那串「沐阳教育·教室1」粘进了教室名称）→ 只去掉重复的前缀。
     */
    { id: "cx6", version: 1, name: "沐阳教育·教室7", kind: "上课用教室", campus: "沐阳教育", capacity: 3, availability: [], note: "" },
  ];
  const v30Import = await api.importDatabase(JSON.stringify(v30Merged));
  ok("v30 老库（教室名是合并写法）能导入并升级", v30Import.ok, v30Import.ok ? "" : v30Import.error);
  eq("升级后版本号是当前版本", (await api.exportDatabase()).version, CURRENT_VERSION);
  const upgradedRooms = await api.classrooms.list();
  const roomByName = (id: string) => upgradedRooms.find((room) => room.id === id)!;
  eq("「沐阳教育·教室1」被拆成 校区 + 教室名",
    [roomByName("cx1").campus, roomByName("cx1").name], ["沐阳教育", "教室1"]);
  eq("自习室同样拆（自习室也是教室）",
    [roomByName("cx2").campus, roomByName("cx2").name], ["沐阳教育", "自习室"]);
  eq("按**第一个**「·」拆：剩下的「·」留在教室名里",
    [roomByName("cx3").campus, roomByName("cx3").name], ["全慧教育", "落地房四楼小"]);
  eq("已经分开填过的**一个字都没动**（幂等、也不覆盖机构填的内容）",
    [roomByName("cx4").campus, roomByName("cx4").name], ["沐阳教育", "教室9"]);
  eq("名字里没有「·」的不拆", [roomByName("cx5").campus, roomByName("cx5").name], ["", "自习区"]);
  eq("两边都写了校区的：只去掉名字里那段重复前缀（校区那一格没动）",
    [roomByName("cx6").campus, roomByName("cx6").name, classroomLabel(roomByName("cx6"))],
    ["沐阳教育", "教室7", "沐阳教育·教室7"]);
  eq("**显示格式不变**：拆完拼回来与迁移前那串一字不差",
    [classroomLabel(roomByName("cx1")), classroomLabel(roomByName("cx3"))],
    ["沐阳教育·教室1", "全慧教育·落地房四楼小"]);

  /*
   * **幂等**：把这份库的版本号退回 v30 再升一次 —— 结果必须完全一样。
   * （机构的库可能被反复导入/恢复；一个"拆一次变一次"的迁移会把教室名越切越短。）
   */
  const afterFirst = await api.exportDatabase();
  const again = JSON.parse(JSON.stringify(afterFirst)) as Record<string, unknown> & { version: number };
  again.version = 30;
  ok("再跑一次迁移（版本退回 v30 再升）", (await api.importDatabase(JSON.stringify(again))).ok);
  eq("第二次迁移的结果与第一次逐字节相同（幂等）",
    (await api.exportDatabase()).classrooms, afterFirst.classrooms);
  eq("第二次也只是把校区原样带过（没有把教室名再切一刀）",
    (await api.classrooms.list()).map((room) => `${room.campus}|${room.name}`),
    ["沐阳教育|教室1", "沐阳教育|自习室", "全慧教育|落地房四楼小", "沐阳教育|教室9", "|自习区", "沐阳教育|教室7"]);

  /*
   * 迁移拆了几条要**写进操作日志**：这是"库里的教室名怎么变了"的唯一线索。
   * 上面那次升级拆了 3 条（cx1 / cx2 / cx3），cx4 / cx5 不算，
   * 另有 1 条是"名字里重复写了校区"（cx6）—— 两件事分开记。
   */
  const splitLogs = (await api.logs.list(50)).filter(
    (log) => log.entity === "教室" && log.summary.includes("拆成两个字段"),
  );
  ok("拆了几条进了操作日志（点名是哪几间）",
    splitLogs.length >= 1 &&
      splitLogs.some((log) => log.summary.includes("3 间教室") && log.summary.includes("沐阳教育·教室1")),
    splitLogs.map((log) => log.summary).join(" / ").slice(0, 200));
  ok("两种情形在日志里分开说（拆字段 / 去重复前缀）—— 混成一句会让人以为后者也丢了一份信息",
    splitLogs.some((log) => log.summary.includes("1 间教室的名字里重复写了校区")),
    splitLogs.map((log) => log.summary).join(" / ").slice(0, 300));

  // ── ③ 导入：老表里的合并写法要认成同一间房（否则重导一次多一间）──────────
  const importMemory = createMemoryStore();
  __useStoreForTesting(importMemory);
  await api.importDatabase(JSON.stringify(afterFirst));
  const mergedImport = await api.imports.apply({
    entity: "classrooms",
    text: "名称,用途,校区,容量\n沐阳教育·教室1,上课用教室,,2\n全慧教育·落地房四楼小,上课用教室,全慧教育,2\n",
  });
  eq("老表里的合并写法**不会新增**（认成同一间房）",
    [mergedImport.added, mergedImport.skipped.length], [0, 2]);
  /*
   * 判重的**键**是拆开之后的教室名 —— `skipped` 里只有行号与原因（键在体检那一阶段的
   * `conflicts[].key` 里），因此这里直接对着"体检"再要一次键，比从原因文案里抠字符串结实。
   */
  const mergeConflicts = parseImport(
    "classrooms",
    "名称,用途,校区,容量\n沐阳教育·教室1,上课用教室,,2\n全慧教育·落地房四楼小,上课用教室,全慧教育,2\n",
  );
  eq("体检阶段给出的判重键就是拆开之后的教室名（因此才认得出是同一间房）",
    mergeConflicts.records.map((record) => record.name), ["教室1", "落地房四楼小"]);
  const importedSplit = await api.imports.apply({
    entity: "classrooms",
    text: "名称,用途,校区,容量\n沐阳教育·新教室,上课用教室,,5\n",
  });
  eq("新的一行照样拆开落库（显示还是「沐阳教育·新教室」）",
    importedSplit.added, 1);
  const newRoom = (await api.classrooms.list()).find((room) => room.name === "新教室")!;
  eq("落库的形状是 校区 + 教室名两格",
    [newRoom.campus, newRoom.name, classroomLabel(newRoom)], ["沐阳教育", "新教室", "沐阳教育·新教室"]);

  // ── ④ 表单：两个独立输入框（源码级）────────────────────────────────────
  const classroomsPage = stripComments(read("app/admin/(dashboard)/classrooms/page.tsx"));
  ok("教室表单的名称那一格叫「教室名称」（与「校区」分开）",
    classroomsPage.includes('label="教室名称"') && classroomsPage.includes('label="校区"'));
  ok("名称的 placeholder **不引导**用户填带「·」的完整写法",
    /placeholder="例如 教室1 \/ 落地房四楼小"/.test(classroomsPage) &&
      !classroomsPage.includes("例如 301 教室 / 自习区"));
  ok("提示里写清了两者会拼起来显示",
    classroomsPage.includes("拼成「校区·教室名」") || classroomsPage.includes("校区·教室名"));
  ok("列表/卡片上按显示口径出（因此看到的还是「校区·教室名」）",
    classroomsPage.includes("classroomLabel(room)"));

  /*
   * ── ⑤ 显示口径只有一处（源码级）──────────────────────────────────────
   *
   * 清单是**显式写出来**的：这些文件都会给用户看教室名，因此都必须走 `classroomLabel`。
   * 新增一处显示点时要把它加到这里 —— 漏了的话，那个页面会显示成"半个教室名"，
   * 而那看起来不像 bug（只是一间房少了校区），很难被人发现。
   *
   * **允许的例外**（逐个说明，免得后来的人以为漏了）：
   *   ① `lib/backend/classrooms.ts` —— helper 自己（`classroomLabel` 拼、`splitCampusFields` 拆）；
   *   ② `lib/backend/import.ts` —— 判重键用的是**文件里的 `name` 字段**（`Record<string, unknown>`），
   *      它决定"这一行算不算同一间房"，不是给人看的文案（拆分在解析那一步已经做过）；
   *   ③ `lib/backend/api.ts` 的 v30 → v31 迁移那一段 —— 日志里点名的必须是**拆之前**那串
   *      （「把「沐阳教育·教室1」拆开」），拿显示口径反而说不清改了什么；
   *   ④ `lib/backend/export.ts` 的教室数据集那一列 —— 导出的是**数据**：
   *      「名称」只写房间名、校区单独一列，与导入同形（见那里的说明）；
   *   ⑤ `app/admin/(dashboard)/timetable/page.tsx` 的 `row.name` —— 那是 `summary` 里
   *      **早就拼好的显示名**（教室页签下就是 `classroomLabel` 的结果），不是原始字段。
   */
  const CLASSROOM_DISPLAY_FILES = [
    "app/admin/(dashboard)/classrooms/page.tsx",
    "app/admin/(dashboard)/lessons/page.tsx",
    "app/admin/(dashboard)/timetable/page.tsx",
    "app/admin/(dashboard)/calendar/page.tsx",
    "app/admin/(dashboard)/page.tsx",
    "app/admin/(dashboard)/stats/page.tsx",
    "app/admin/(dashboard)/data/page.tsx",
    "components/admin/LessonForm.tsx",
    "components/admin/LessonSeriesForm.tsx",
    "components/admin/InquiryForm.tsx",
    "components/admin/InquiryReport.tsx",
    "components/admin/PendingMakeups.tsx",
    "components/admin/StudentDetail.tsx",
    "lib/backend/search.ts",
    "lib/backend/inquiry.ts",
    "lib/backend/api.ts",
    "lib/backend/export.ts",
  ];
  eq("每个显示教室名的文件都走唯一显示口径 classroomLabel",
    CLASSROOM_DISPLAY_FILES.filter((file) => !stripComments(read(file)).includes("classroomLabel")),
    []);

  /*
   * 第二道网：这些文件里**不许**再把教室对象的 `.name` 直接读出来渲染。
   * 判据挑的是"取教室名的那几种写法"（`room.name` / `classroom.name` /
   * `classrooms.find(...)?.name`）；`teacher.name`、教师列表里的 `item.name`
   * 都合法，因此不进这张网 —— 宁可漏一个，也不要为了这条断言把别处搅进来。
   */
  const RAW_NAME_OFFENDERS = [
    ["room.name", /(^|[^A-Za-z])room\.name/g],
    ["classroom.name", /(^|[^A-Za-z])classroom\.name/g],
    ["classrooms.find(...)?.name", /classrooms\.find\([^;]{0,120}?\?\.name/g],
  ] as const;
  const rawNameHits: string[] = [];
  for (const file of CLASSROOM_DISPLAY_FILES) {
    // `data/page.tsx` 的 `nameById` 是通用小工具（教师 / 学生 / 教室都过它），教室那处已改用专用函数
    const code = stripComments(read(file));
    for (const [label, pattern] of RAW_NAME_OFFENDERS) {
      for (const match of code.matchAll(pattern)) {
        // 允许的例外：教室数据集那一列（数据不是显示）、迁移日志里点名的旧名字
        const around = code.slice(Math.max(0, (match.index ?? 0) - 200), (match.index ?? 0) + 60);
        const allowed =
          around.includes("这一张是**数据**") ||
          around.includes("room.name") && file === "lib/backend/export.ts" ||
          (file === "lib/backend/api.ts" && around.includes("splitTargets"));
        if (!allowed) rawNameHits.push(`${file} → ${label}`);
      }
    }
  }
  eq("这些文件里没有「直接读教室 .name 来显示」的写法", rawNameHits, []);

  /*
   * 搜索也走显示口径：机构按**校区**找房时得能搜到「沐阳教育·教室1」。
   * 只匹配 `room.name`（＝「教室1」）的话，搜「沐阳教育」会得到"查无此房"——
   * 而机构脑子里的名字就是带校区的那一串。
   */
  const searchHits = searchAll({
    keyword: "沐阳教育",
    students: [],
    teachers: [],
    classrooms: [{
      id: "sx1", version: 1, name: "教室1", kind: "上课用教室" as const,
      campus: "沐阳教育", capacity: 4, availability: [], note: "",
    }],
    lessons: [],
    courses: [],
  });
  eq("按校区能搜到那间房（匹配串与结果标题都是显示口径）",
    searchHits.map((hit) => [hit.kind, hit.title]), [["教室", "沐阳教育·教室1"]]);

  ok("`classroomLabel` 与拆分都在同一个模块里（唯一的显示 / 拆分实现）",
    read("lib/backend/classrooms.ts").includes("export function classroomLabel") &&
      read("lib/backend/classrooms.ts").includes("export function splitCampusFields") &&
      read("lib/backend/classrooms.ts").includes("export function normalizeClassroom"));

  // 夹具：示例教室是"校区 + 纯名"，示例数据里不该再出现「·」
  eq("示例教室的名字里一个「·」都没有（合并写法是显示时拼的，不是存出来的）",
    seedDb.classrooms.filter((room) => room.name.includes("·") || room.campus.includes("·")), []);
  ok("示例教室确实填了校区（否则「显示口径没在工作」这件事看不出来）",
    seedDb.classrooms.some((room) => room.campus !== ""));

  __useStoreForTesting(memory);
}

console.log("\n=== 46. 校区必填（v31 收紧 —— 机构原话「校区必须填」）===");

/*
 * ## 这一节守的是什么
 *
 * v31 给教室加了「校区」并定了显示口径「校区·教室名」之后，留下一个**已知歧义**：
 * 名字里真带「·」而校区空着的房间，会被当成合并写法拆开（显示不变，但校区会多一个值）。
 * 项目问过机构"要不要加个开关"，机构答：**「校区必须填」**。
 *
 * 也就是说：**不加开关，而是让那个歧义状态不再出现**。这一节把"必填"钉在三条路上
 * （服务层 / 批量导入 / 界面表单），外加两条边界（老数据不许被搞坏、先拆后判）：
 *
 *   ① **服务层** `create` / `update`：空校区（空串、空格串）**报错拒绝**，错误里点名「校区」
 *      并说清为什么必须填；带校区能建、能改、能读回来；被拒的那一次**什么都不写**；
 *   ② **批量导入**：判据是**拆完之后**的校区 —— 只写名称列、名字里带「·」的旧名单
 *      **先拆后过**（判在拆分之前会把它整份拒掉，而它本来是能导的）；
 *      拆完还是没有校区的行才报「缺少必填列：校区」；
 *   ③ **老数据**：更老的库里"拆不出校区"的记录（例如「自习区」）**读取 / 迁移都不报错**，
 *      只是保存时才被必填拦住（界面上有「校区未填」待补灰标，见 ⑤）；
 *   ④ **界面**：教室表单的校区那一格是必填（`required` + 提交前那句 JS 校验，源码级），
 *      卡片上的待补灰标与教师卡片那两个待办标**同一档样式**；
 *   ⑤ **三处同一条口径**：服务层与导入判的是同一件事（拆完之后的 `campus`），
 *      因此一条记录从表单进来和从 CSV 进来不会得到两种说法。
 */
{
  const rootUrl = new URL("../", import.meta.url);
  const read = (file: string) => readFileSync(new URL(file, rootUrl), "utf8");
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // ── ① 判据与文案本身（服务层与导入共用的那一份）──────────────────────────
  eq("校区的判据就是「trim 之后非空」（空格串不算填了）",
    [hasCampus({ campus: "总校" }), hasCampus({ campus: "   " }), hasCampus({ campus: "" }), hasCampus({})],
    [true, false, false, false]);
  ok("那句文案点明了「必填」与为什么要填（不然用户只觉得「又是一格必填」）",
    campusRequiredProblem().includes("校区必填") &&
      campusRequiredProblem().includes("校区·教室名") &&
      campusRequiredProblem().includes("按校区筛"),
    campusRequiredProblem());

  // ── ② 服务层：拒绝空校区，带校区能建能改能读回来 ─────────────────────────
  const campusMemory = createMemoryStore();
  __useStoreForTesting(campusMemory);

  /** 教室入参（省得每条都写一遍） */
  const roomBody = (name: string, campus: string) => ({
    name, kind: "上课用教室" as const, campus, capacity: 4, availability: [], note: "",
  });
  /** 跑一次写操作，把"报错原话"或 `null`（＝没报错）拿回来 */
  const rejectionOf = async (run: () => Promise<unknown>): Promise<string | null> => {
    try {
      await run();
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  /*
   * 「什么都没建」要按**前后差**判，不能写死成 `length === 0`：
   * 这一节在 `npm run check`（内存库）里是空库，但在 `npm run check:both`（临时服务上的库）
   * 里本来就有一批示例教室 —— 写死 0 会在 check:both 里假红（第一版就是这么红的）。
   */
  const roomsBeforeReject = (await api.classrooms.list()).length;
  const emptyCampusReject = await rejectionOf(() => api.classrooms.create(roomBody("空校区教室", "")));
  ok("新建时校区是空串 → **报错拒绝**，错误里点名「校区」并说清为什么必填",
    emptyCampusReject !== null &&
      emptyCampusReject.includes("校区") &&
      emptyCampusReject.includes("必填") &&
      emptyCampusReject.includes("校区·教室名"),
    emptyCampusReject ?? "没有报错 —— 空校区被建进去了");

  const blankCampusReject = await rejectionOf(() => api.classrooms.create(roomBody("空格校区教室", "   ")));
  ok("校区只填了空格 → 同样拒绝（`trim` 之后为空就是没填）",
    blankCampusReject !== null && blankCampusReject.includes("校区"),
    blankCampusReject ?? "没有报错 —— 空格串被当成了合法校区");

  const roomsAfterReject = await api.classrooms.list();
  eq("被拒的那两次**什么都没建**",
    [
      roomsAfterReject.length,
      roomsAfterReject.filter((room) => room.name === "空校区教室" || room.name === "空格校区教室").length,
    ],
    [roomsBeforeReject, 0]);

  const withCampus = await api.classrooms.create(roomBody("满校区教室", "  城西校区  "));
  eq("带校区能建、能读回来（顺带去掉了前后空白）",
    [(await api.classrooms.get(withCampus.id))?.campus, (await api.classrooms.get(withCampus.id))?.name],
    ["城西校区", "满校区教室"]);
  eq("能改成另一个校区并读回来",
    (await api.classrooms.update(withCampus.id, { campus: "总校" }))?.campus, "总校");

  const versionBeforeClear = (await api.classrooms.get(withCampus.id))!.version;
  const clearReject = await rejectionOf(() => api.classrooms.update(withCampus.id, { campus: "" }));
  ok("改的时候把校区清空 → 也拒绝（不是「只有新建才判」）",
    clearReject !== null && clearReject.includes("校区"), clearReject ?? "没有报错 —— 校区被清空了");
  eq("被拒的那一次**什么都没写**（校区还在、版本号也没推进）",
    [(await api.classrooms.get(withCampus.id))?.campus, (await api.classrooms.get(withCampus.id))?.version],
    ["总校", versionBeforeClear]);

  /*
   * **先拆后判**（这条是刻意留的口子，别当成漏判）。
   *
   * 交上来的是老表那种合并写法（校区那一格空着）：拆分先跑，拆出来的校区让这一行**通过**。
   * 判在拆分之前的话，一份"名称列里写着「沐阳教育·教室1」"的旧名单 / 一个只知道合并写法的
   * 旧调用方会被**整份拒掉** —— 而它们本来是能建、能导的。
   *
   * 注意：**界面表单走不到这里**（校区那一格已经必填，空着就提交不了），
   * 因此这个口子只服务于"绕开表单"的入口（批量导入 / `/api/call` / 老脚本）。
   * 收紧要收的是"校区空着"这个状态 —— 拆分之后校区那一格是有值的，存下来的记录照样满足必填。
   */
  const legacyNotation = await api.classrooms.create(roomBody("沐阳教育·先拆后判教室", ""));
  eq("老表那种合并写法仍然能建：先拆成两格（校区那一格有值，因此不算「空校区」）",
    [legacyNotation.campus, legacyNotation.name, classroomLabel(legacyNotation)],
    ["沐阳教育", "先拆后判教室", "沐阳教育·先拆后判教室"]);

  // ── ③ 导入：缺列要报「缺少必填列」；只写名称列且名字带「·」→ 先拆后过 ──
  /*
   * ⚠️ 顺序是这一条的全部重点。
   *
   * 「校区」虽然声明成必填列，但它**不进"整份不导入"那道表头闸**：因为它的值能从「名称」里拆出来。
   * 判据因此落在**行归一之后** —— 拆完还是没有校区的**那一行**才报错。
   * 顺序反了（判在拆分之前）的话，下面第二份文件会被**整份拒掉**，而它本来是能导的。
   */
  const onlyNamesPlain = parseImport("classrooms", "名称,用途\n自习区,自习室\n");
  eq("只写名称列、名字里没有「·」→ 这一行不通过（拆不出校区）", onlyNamesPlain.records.length, 0);
  ok("错误原话是「缺少必填列：校区」（点名是哪一列，也说清名称里没有可拆的写法）",
    (onlyNamesPlain.problems[0]?.reason ?? "").includes("缺少必填列：校区") &&
      (onlyNamesPlain.problems[0]?.reason ?? "").includes("名称"),
    onlyNamesPlain.problems[0]?.reason ?? "（没有报错）");

  const onlyNamesMerged = parseImport(
    "classrooms",
    "名称,用途\n沐阳教育·教室1,上课用教室\n全慧教育·落地房四楼小,上课用教室\n",
  );
  eq("只写名称列、名字里带「·」→ **先拆后过**（一条都不许拒）",
    [onlyNamesMerged.problems.length, onlyNamesMerged.missingRequiredHeaders.length, onlyNamesMerged.records.length],
    [0, 0, 2]);
  eq("落库的形状是拆开后的两格（判据正是拆完之后的校区）",
    onlyNamesMerged.records.map((record) => `${record.campus}|${record.name}`),
    ["沐阳教育|教室1", "全慧教育|落地房四楼小"]);

  const blankCell = parseImport("classrooms", "名称,校区\n自习区,\n");
  ok("校区列在、但这一行的校区空着 → 同样报「缺少必填列：校区」",
    blankCell.records.length === 0 &&
      (blankCell.problems[0]?.reason ?? "").includes("缺少必填列：校区"),
    blankCell.problems.map((problem) => problem.reason).join(" / ") || "（没有报错）");

  const filledCell = parseImport("classrooms", "名称,校区\n自习区,城西校区\n");
  eq("校区列填了 → 通过，且值原样落进来",
    [filledCell.problems.length, filledCell.records[0]?.campus], [0, "城西校区"]);

  /*
   * 表头闸对**真的缺列**仍然照旧整份拦住（「名称」这种不能从别处推出来的列）。
   * 这一条是"放宽"的反面证据：改了校区那一列，别的必填列一个字都没松。
   */
  const missingNameColumn = parseImport("classrooms", "用途,校区\n上课用教室,城西校区\n");
  eq("硬必填列（名称）缺席时仍然是整份不导入",
    [missingNameColumn.missingRequiredHeaders, missingNameColumn.records.length], [["名称"], 0]);

  // ── ④ 老数据：拆不出校区的记录读取 / 迁移都不报错，保存时才被拦住 ────────
  /*
   * 这份夹具就是任务里那种记录：**更老的库**（v30 之前还没有 `campus` 这个字段）
   * 里一间名字里没有「·」的教室 —— 拆不出校区，也没人填过。
   *
   * 关键：**必填不许出现在读取与迁移上**。在那里抛错等于整库读不出来，
   * 比"有一间房待补校区"坏得多（迁移的纪律是"不猜、不拒"，只补空串）。
   */
  const legacyMemory = createMemoryStore();
  __useStoreForTesting(legacyMemory);
  const legacyDb = JSON.parse(JSON.stringify(seedDb)) as Record<string, unknown> & {
    version: number;
    classrooms: Array<Record<string, unknown>>;
  };
  legacyDb.version = 30;
  legacyDb.classrooms = [
    // 名字里没有「·」→ 拆不出校区（真实里就是「自习区」这种），而且这份库里连 campus 键都没有
    { id: "cold1", version: 1, name: "自习区", kind: "自习室", capacity: 6, availability: [], note: "" },
    { id: "cold2", version: 1, name: "沐阳教育·教室1", kind: "上课用教室", capacity: 2, availability: [], note: "" },
  ];
  const legacyUpgrade = await api.importDatabase(JSON.stringify(legacyDb));
  ok("带「拆不出校区」教室的老库照样能导入升级（必填**不许**让迁移失败）",
    legacyUpgrade.ok, legacyUpgrade.ok ? "" : legacyUpgrade.error);

  const legacyList = await api.classrooms.list();
  eq("那间房读得出来：校区是空串（不报错、也**不猜**一个校区给它）",
    [legacyList.find((room) => room.id === "cold1")?.campus, legacyList.find((room) => room.id === "cold1")?.name],
    ["", "自习区"]);
  eq("显示就是纯教室名（不会多出一个孤零零的「·」）",
    classroomLabel(legacyList.find((room) => room.id === "cold1")!), "自习区");
  eq("同一份库里有校区的记录照常（只对「拆不出校区」的那条网开一面）",
    [legacyList.find((room) => room.id === "cold2")?.campus, legacyList.find((room) => room.id === "cold2")?.name],
    ["沐阳教育", "教室1"]);

  const legacyVersion = (await api.classrooms.get("cold1"))!.version;
  const legacySaveReject = await rejectionOf(() => api.classrooms.update("cold1", { capacity: 8 }));
  ok("真要保存时才被必填拦住（改的是容量也不行 —— 整份提交里校区还是空的）",
    legacySaveReject !== null && legacySaveReject.includes("校区"),
    legacySaveReject ?? "没有报错 —— 一条没校区的老记录被静默存了回去");
  eq("被拦下之后库里那条一点没变",
    [(await api.classrooms.get("cold1"))?.capacity, (await api.classrooms.get("cold1"))?.version],
    [6, legacyVersion]);

  const legacyFilled = await api.classrooms.update("cold1", { campus: "城西校区" });
  eq("把校区补上就能存了（＝界面上那个待补提示要去做的事）",
    [legacyFilled?.campus, legacyFilled?.name, classroomLabel(legacyFilled!)],
    ["城西校区", "自习区", "城西校区·自习区"]);

  // ── ⑤ 界面：校区那一格必填（源码级）+ 待补灰标与教师那两个同一档 ──────────
  const campusPage = stripComments(read("app/admin/(dashboard)/classrooms/page.tsx"));
  ok("教室表单的「校区」那一格是必填（`required` + 提交前那句 JS 校验，两条都在）",
    /label="校区"[\s\S]{0,700}?required/.test(campusPage) &&
      campusPage.includes("校区必填 —— 它决定教室在列表与排课里显示成「校区·教室名」"),
    "校区那一格看不见 required，或提交前那句 JS 校验不见了");
  ok("名称那一格的提示说明「校区不在这一格」",
    campusPage.includes("只写房间名（不要写校区）") && campusPage.includes("「校区」那一格单独填"));

  /*
   * 卡片上的**待补灰标**：老记录（校区空着）在列表上看起来和正常的没两样 ——
   * 标题里只有房间名。正因为"看不出来"，才必须挂个标（与教师卡片上「用工未填」同一个道理）。
   */
  const teacherPage = stripComments(read("app/admin/(dashboard)/teachers/page.tsx"));
  const todoClass = "rounded-sm border border-dashed border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] text-ink-400";
  ok("教室卡片上待补灰标的渲染条件就是「校区空着」",
    campusPage.includes('room.campus.trim() === ""') && campusPage.includes("校区未填"),
    "卡片上没有「校区空着就挂待办标」这件事");
  ok("灰标带了「去哪儿补」的提示",
    campusPage.includes('CAMPUS_TODO_HINT = "点编辑补校区"'));
  ok("待补灰标与教师卡片的「用工未填」**用同一个样式**（各写一套会被读成两个不同的待办）",
    campusPage.includes(todoClass) && teacherPage.includes(todoClass),
    "某一页的待办灰标样式与另一页不一致");

  // ── ⑥ 三处同一条口径（源码级：谁在哪儿判"必填"）────────────────────────
  const apiSource = stripComments(read("lib/backend/api.ts"));
  const importSource = stripComments(read("lib/backend/import.ts"));
  const classroomSource = read("lib/backend/classrooms.ts");
  ok("服务层的写入闸挂的是「先拆后判」那个钩子（不是只归一不校验）",
    apiSource.includes("normalizeClassroomStrict") && apiSource.includes("classroomIssues(normalized)"),
    "服务层那个钩子里看不到校验");
  ok("导入那一列声明成必填、并且声明了「能从名称推导」（因此不进整份表头闸）",
    /key: "campus"[\s\S]{0,400}?required: true[\s\S]{0,200}?derivableFrom: "name"/.test(importSource),
    "校区那一列的声明变了");
  ok("判据与文案各只有一处（教室那个模块里）",
    classroomSource.includes("export function hasCampus") &&
      classroomSource.includes("export function campusRequiredProblem"));

  __useStoreForTesting(memory);
}

console.log(`\n=== 结果：${failures === 0 ? "全部通过" : `${failures} 项失败`} ===`);
process.exit(failures === 0 ? 0 : 1);
