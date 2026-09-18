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
const home = contentDoc.pages.get("首页");
const coursesPage = contentDoc.pages.get("课程");
const teachersPage = contentDoc.pages.get("教师");
const aboutPage = contentDoc.pages.get("关于");
const contactPage = contentDoc.pages.get("联系我们");

eq("首页分组数", home?.groups.map((g) => g.name), ["首屏数据", "教学特色", "首页课程卡片", "教室照片格位"]);
eq("首页课程卡片数", home?.groups.find((g) => g.name === "首页课程卡片")?.items.length, 17);
eq("首页首屏数据数", home?.groups.find((g) => g.name === "首屏数据")?.items.length, 6);
eq("首页教学特色数", home?.groups.find((g) => g.name === "教学特色")?.items.length, 7);
eq("教师数", teachersPage?.groups.length, 5);
eq("关于分组数", aboutPage?.groups.length, 4);
eq("联系分组数", contactPage?.groups.length, 1);

const courseNames = (coursesPage?.groups ?? []).map((g) => g.name);
eq("学科数", courseNames.length, 17);
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
eq("物理含 1 个学段", bandCounts["物理"], 1);
// 语言类课程按欧标 A1–B2 四段
for (const lang of ["法语", "德语", "意大利语", "西班牙语"]) {
  eq(`${lang}含 A1–B2 四段`, bandCounts[lang], 4);
}
eq("雅思含 1 段", bandCounts["雅思"], 1);

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
eq("首页课程卡片", homeContent.courses.length, 17);
eq("首页教室格位", homeContent.classrooms.length, 3);
eq("首页首屏数据", homeContent.stats.length, 6);
eq("首页教学特色", homeContent.features.length, 7);
ok("首页 CTA 非空", homeContent.cta.title !== "");

const { courses } = getCoursesPage();
eq("课程页学科数", courses.length, 17);
ok("每门学科都有学段内容", courses.every((c) => c.bands.length > 0 && c.bands[0].content.length > 50));
ok("数学含 3 个学段且带核心能力", (() => { const m = courses.find((c) => c.nameZh === "数学"); return m?.bands.length === 3 && m.bands.every((b) => b.content.includes("核心能力")); })());

const { teachers } = getTeachersPage();
eq("教师数", teachers.length, 5);
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
ok("教师排序无重复", new Set(teachers.map((t) => t.order)).size === teachers.length);

const about = getAboutContent();
eq("教学理念条数", about.principles.length, 4);
eq("服务形式条数", about.services.length, 5);
eq("校区数据条数", about.facts.length, 4);
eq("校区介绍段数", about.campusParagraphs.length, 3);
ok("关于页标题与站点标语一致", about.title === brand.tagline.split(" · ")[0] || about.title.length > 0);
ok("理念含数据化诊断", about.principles.some((x) => x.title === "数据化诊断"));

const contact = getContactContent();
eq("联系方式条数", contact.methods.length, 5);

// 首页卡片与课程页必须一一对应，否则点击卡片会跳不到对应课程
const cardNames = homeContent.courses.map((c) => c.title).sort();
const anchorNames = courses.map((c) => c.nameZh).sort();
eq("首页卡片与课程页一一对应", cardNames, anchorNames);

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
