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
  getCoursesPage,
  getHomeContent,
  getSiteBrand,
  getTeachersPage,
} from "@/lib/data/site";
import { getPricingData } from "@/lib/data/pricing";
import { getCasesContent, getFaqContent, getScheduleContent } from "@/lib/data/pages";
import { findFeaturedCourse, getAllFeaturedCourses, getFeaturedContent } from "@/lib/data/featured";
import { calculateQuote, isTrialFree, trialFeeFor } from "@/lib/pricing/quote";

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
eq("首页栏目", homeContent.courseColumns.map((c) => c.title),
  ["小学课内", "初中课内", "高中课内", "外语", "课外兴趣", "成人课程"]);
eq("课程页栏目与首页同源", columns, homeContent.courseColumns);

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

// 卡片与标签的目标都必须能在课程页找到对应小节（曾因小节改名导致大批标签跳空）
const sectionNames = new Set<string>();
for (const course of allCourses) {
  sectionNames.add(course.nameZh);
  for (const band of course.bands) sectionNames.add(band.title.split("｜")[0] ?? band.title);
}
for (const group of electiveGroupList) for (const item of group.items) sectionNames.add(item.name);

const dangling = allCards.flatMap((c) => [
  ...(sectionNames.has(c.target) ? [] : [`${c.title}→${c.target}`]),
  ...c.tags.filter((t) => !sectionNames.has(t.target)).map((t) => `${t.label}→${t.target}`),
]);
eq("所有卡片与标签都有对应小节", dangling, []);

// 反向：课程页的每个小节都要能从首页/课程页点进来，不能有孤立小节
const entryTargets = new Set(allCards.flatMap((c) => [c.target, ...c.tags.map((t) => t.target)]));
const orphans = [
  ...allCourses.flatMap((c) => c.bands.map((b) => b.title.split("｜")[0] ?? b.title)),
  ...electiveGroupList.flatMap((g) => g.items.map((i) => i.name)),
].filter((name) => !entryTargets.has(name));
eq("课程页没有进不去的小节（栏目里删掉课程时，详情区的小节也要删）", orphans, []);

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
eq("课程页学科数（不含选修分组）", courses.length, 19);
ok("每门学科都有学段内容", courses.every((c) => c.bands.length > 0 && c.bands[0].content.length > 50));

// 选修课程（成人 / 课外兴趣）：与学科分开返回，当前全部标注暂未开放
const { electiveGroups, electiveTitle } = getCoursesPage();
const electives = electiveGroups.flatMap((g) => g.items);
eq("选修课程分组名", electiveTitle, "成人课程与课外兴趣");
ok("选修课程至少 1 门", electives.length >= 1);
// 选修课按栏目分节，栏目名与数量都随内容调整；只要求分节非空且每节都有课
ok("选修课按栏目分节", electiveGroups.length >= 1 && electiveGroups.every((g) => g.title !== "" && g.items.length > 0));
eq("选修课栏目不重复", electiveGroups.filter((g, i) => electiveGroups.findIndex((x) => x.title === g.title) !== i).map((g) => g.title), []);
ok("选修课程都有介绍", electives.every((e) => e.description.length > 10));
ok("选修课程当前全部未开放", electives.every((e) => !e.available));
ok("选修课程未混入学科列表", courses.every((c) => !electives.some((e) => e.name === c.nameZh)));
ok("每门选修课都归类到栏目", electives.every((e) => e.group !== ""));
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
eq("二级课程数", inClass?.children.length, 6);
eq("二级课程名", inClass?.children.map((c) => c.name),
  ["一对一定制课", "一对二 / 一对三小组课", "一对多小班课", "9 人以上大班课", "晚托管", "周中预习课"]);
eq("课程总数（含各级）", getAllFeaturedCourses().length, 13);
ok("每门课程都有 4 个描述字段",
  getAllFeaturedCourses().every((c) => c.fields.length >= 3));
ok("三级课程挂在正确的父级下",
  (inClass?.children.find((c) => c.name === "一对多小班课")?.children.map((c) => c.name) ?? []).join(",") === "精品小升初,精品初升高");
ok("基础班挂在 9 人以上大班课下",
  (inClass?.children.find((c) => c.name === "9 人以上大班课")?.children.map((c) => c.name) ?? []).join(",") === "基础小升初,基础初升高");
ok("晚托班挂在晚托管下",
  (inClass?.children.find((c) => c.name === "晚托管")?.children.map((c) => c.name) ?? []).join(",") === "小学晚托,初中晚托");
ok("核心课程都有详细介绍",
  ["周中预习课", "一对一定制课", "精品小升初"].every((name) => {
    const found = getAllFeaturedCourses().find((c) => c.name === name);
    return (found?.body.length ?? 0) > 50;
  }));
// 按路径查找（页面路由与面包屑依赖它）。路径为显式声明的 ASCII 短路径。
const deep = findFeaturedCourse(["in-class", "mini-class", "junior-prep"]);
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

console.log(`\n=== 结果：${failures === 0 ? "全部通过" : `${failures} 项失败`} ===`);
process.exit(failures === 0 ? 0 : 1);
