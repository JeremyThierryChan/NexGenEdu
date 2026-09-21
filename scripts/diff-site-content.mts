/**
 * **比对两边的网站内容**：模版（`data/site/*.md`）与后端库。
 *
 * 用途：回答"前后端数据同步了吗"。这是切到"以后端为准"之后最常要问的一句话，
 * 而靠眼睛翻两个地方对不出来 —— 这里逐字段比，并分成三类：
 *
 *   - **只在模版**：库里的还没导入，或内容文件比库新；
 *   - **只在库**：机构在后台加的（例如内部老师、后台自建的课），未必是错；
 *   - **两边不同**：同一个字段两边都有值但不一样 —— 这类才是要人拍板的冲突。
 *
 * 用法（后端要在跑）：
 *   node --experimental-strip-types --import ./server/loader.mjs scripts/diff-site-content.mts
 * 或指定地址：`SITE_API_BASE=http://127.0.0.1:4000 node ...`
 *
 * 退出码：0 = 完全一致（或只有"只在库"的内部数据）；1 = 有需要人决定的差异。
 */

import { getTeachersPageFromTemplate, getCourseColumnsFromTemplate, getCoursesPageFromTemplate } from "@/lib/data/site";
import { getPricingDataFromTemplate } from "@/lib/data/pricing";
import type { PublicSite } from "@/lib/backend/public-site";

const base = (process.env.SITE_API_BASE ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

const response = await fetch(`${base}/api/public/site`);
if (!response.ok) {
  console.error(`连不上后端（${base}）：HTTP ${response.status}`);
  process.exit(2);
}
const body = (await response.json()) as { ok: boolean; data: PublicSite };
if (body.ok !== true) {
  console.error("后端返回不合法：", JSON.stringify(body).slice(0, 200));
  process.exit(2);
}
const db = body.data;

/** 一份差异清单。 */
type Diff = { area: string; kind: "只在模版" | "只在库" | "两边不同"; what: string; template?: unknown; db?: unknown };
const diffs: Diff[] = [];
const add = (d: Diff) => diffs.push(d);

const show = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "（空）" : text.replace(/\s+/g, " ").slice(0, 110);
};

/* ── 1. 教师（只比网站上会展示的那部分）──────────────────────────────────── */
const tplTeachers = getTeachersPageFromTemplate().teachers;
const dbTeachers = db.teachers.filter((teacher) => teacher.active && teacher.siteVisible);

{
  const tplNames = new Set(tplTeachers.map((teacher) => teacher.name));
  const dbNames = new Set(dbTeachers.map((teacher) => teacher.name));
  for (const teacher of tplTeachers) {
    if (!dbNames.has(teacher.name)) add({ area: "教师", kind: "只在模版", what: teacher.name });
  }
  for (const teacher of dbTeachers) {
    if (!tplNames.has(teacher.name)) add({ area: "教师", kind: "只在库", what: teacher.name });
  }

  for (const tpl of tplTeachers) {
    const other = dbTeachers.find((teacher) => teacher.name === tpl.name);
    if (other === undefined) continue;
    const pairs: Array<[string, unknown, unknown]> = [
      ["职务", tpl.role, other.role],
      ["教龄", tpl.years, other.years],
      ["一句话简介", tpl.summary, other.summary],
      ["推荐理由", tpl.recommendation, other.recommendation],
      ["顺序", tpl.order, other.order],
      // 类型：模版是 `teacher` / `ai`，库是 `教师` / `AI` —— 同一件事的两种写法，
      // 不归一化就会报 4 处假差异（我第一版就是这样，第一眼看像"库没同步"）
      ["类型", tpl.kind, other.kind === "AI" ? "ai" : "teacher"],
      ["可带科目", tpl.subjects.join("、"), [...other.subjects].join("、")],
    ];
    for (const [field, a, b] of pairs) {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        add({ area: "教师", kind: "两边不同", what: `${tpl.name} · ${field}`, template: a, db: b });
      }
    }
    if ((tpl.bio ?? "") !== (other.bio ?? "")) {
      add({
        area: "教师",
        kind: "两边不同",
        what: `${tpl.name} · 详细介绍（${(tpl.bio ?? "").length} 字 vs ${(other.bio ?? "").length} 字）`,
      });
    }
  }
  // 库里的内部档案（不在网站内容里）：单独说一声，不算冲突
  const internal = db.teachers.filter((teacher) => !teacher.siteVisible).map((teacher) => teacher.name);
  if (internal.length > 0) {
    add({ area: "教师", kind: "只在库", what: `内部档案（不在网站展示）：${internal.join("、")}` });
  }
}

/* ── 2. 课程卡片 ─────────────────────────────────────────────────────────── */
const tplCards = getCourseColumnsFromTemplate().flatMap((column) =>
  column.subgroups.flatMap((subgroup) => subgroup.cards.map((card) => ({ card, column: column.title, subgroup: subgroup.title }))),
);
const dbCards = db.courses.filter((course) => course.siteKind !== "不展示" && course.path !== "");

{
  const tplNames = new Set(tplCards.map((item) => item.card.title));
  const dbNames = new Set(dbCards.map((course) => course.name));
  for (const item of tplCards) if (!dbNames.has(item.card.title)) add({ area: "课程卡片", kind: "只在模版", what: item.card.title });
  for (const course of dbCards) if (!tplNames.has(course.name)) add({ area: "课程卡片", kind: "只在库", what: course.name });

  for (const item of tplCards) {
    const other = dbCards.find((course) => course.name === item.card.title);
    if (other === undefined) continue;
    const tags = (list: Array<{ label: string; target: string }>) =>
      list.map((tag) => `${tag.label}→${tag.target}`).join("、");
    const pairs: Array<[string, unknown, unknown]> = [
      ["栏目", item.column, other.category],
      ["子栏目", item.subgroup, other.subgroup],
      ["路径", item.card.path, other.path],
      ["点进哪一节", item.card.target, other.target],
      ["顺序", undefined, other.order],
      ["班型", item.card.forms.join("、"), other.forms.join("、")],
      ["标签", tags(item.card.tags), tags(other.tags)],
      ["暂未开放", item.card.unavailable, other.status !== "开放"],
    ];
    for (const [field, a, b] of pairs) {
      if (field === "顺序") continue; // 模版没有顺序字段，单独在下面说明
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        add({ area: "课程卡片", kind: "两边不同", what: `${item.card.title} · ${field}`, template: a, db: b });
      }
    }
  }

  /*
   * 顺序：按**「栏目 → 子栏目 → 卡片」的结构**比，不能拉平成一个列表。
   *
   * 库里的 `order` 是"同一子栏目内的相对次序"，拉平后按 order 排会把子栏目交叉在一起
   * （高中课内的 必考科目 / 外语 / 七选三 会串成 高中语文、高考外语、高中物理…），
   * 看起来像"顺序全乱了"，其实渲染出来一模一样 —— 我第一版就是这么误报的。
   */
  const tplStructure = getCourseColumnsFromTemplate().map((column) => ({
    column: column.title,
    subgroups: column.subgroups.map((subgroup) => ({
      subgroup: subgroup.title,
      cards: subgroup.cards.map((card) => card.title),
    })),
  }));
  const dbStructure = [...new Set(dbCards.map((course) => course.category))]
    .map((column) => ({
      column,
      subgroups: [...new Set(dbCards.filter((course) => course.category === column).map((course) => course.subgroup))]
        .map((subgroup) => ({
          subgroup,
          cards: dbCards
            .filter((course) => course.category === column && course.subgroup === subgroup)
            .sort((a, b) => a.order - b.order)
            .map((course) => course.name),
        })),
    }))
    .sort((a, b) => {
      // 栏目顺序：按它在模版里的次序对齐（模版第一条卡片所在栏目在前）
      const order = tplStructure.map((item) => item.column);
      return order.indexOf(a.column) - order.indexOf(b.column);
    });
  if (JSON.stringify(tplStructure) !== JSON.stringify(dbStructure)) {
    add({
      area: "课程卡片",
      kind: "两边不同",
      what: "卡片的栏目 / 子栏目 / 先后次序",
      template: JSON.stringify(tplStructure),
      db: JSON.stringify(dbStructure),
    });
  }
}

/* ── 3. 课程正文（学科 → 小节）───────────────────────────────────────────── */
const tplPage = getCoursesPageFromTemplate();
const dbPage = db.siteContent.coursePage;

{
  add({
    area: "课程正文",
    kind: dbPage.heading.title === tplPage.heading.title ? "只在库" : "两边不同",
    what: "课程页标题",
    template: tplPage.heading.title,
    db: dbPage.heading.title,
  });
  diffs.pop(); // 标题单独用下面的精确判断，不占"只在库"

  for (const [field, a, b] of [
    ["课程页标题", tplPage.heading.title, dbPage.heading.title],
    ["课程页小字", tplPage.heading.eyebrow, dbPage.heading.eyebrow],
    ["课程页描述", tplPage.heading.description, dbPage.heading.description],
    ["选修课父分组名", tplPage.electiveTitle, dbPage.electiveTitle],
  ] as Array<[string, string, string]>) {
    if ((a ?? "") !== (b ?? "")) add({ area: "课程正文", kind: "两边不同", what: field, template: a, db: b });
  }

  const tplSubjects = tplPage.courses;
  for (const course of tplSubjects) {
    const other = dbPage.subjects.find((subject) => subject.name === course.nameZh);
    if (other === undefined) {
      add({ area: "课程正文", kind: "只在模版", what: `学科「${course.nameZh}」` });
      continue;
    }
    if ((course.lead ?? "") !== (other.lead ?? "")) {
      add({ area: "课程正文", kind: "两边不同", what: `${course.nameZh} · 学科导语`, template: course.lead, db: other.lead });
    }
    if (course.unavailable !== other.unavailable) {
      add({ area: "课程正文", kind: "两边不同", what: `${course.nameZh} · 整组暂未开放`, template: course.unavailable, db: other.unavailable });
    }
    for (const band of course.bands) {
      const anchor = (band.title.split("｜")[0] ?? band.title).trim();
      const otherBand = other.bands.find((item) => item.id === anchor);
      if (otherBand === undefined) {
        add({ area: "课程正文", kind: "只在模版", what: `小节「${anchor}」` });
        continue;
      }
      if (band.title !== otherBand.title) {
        add({ area: "课程正文", kind: "两边不同", what: `${anchor} · 小节标题`, template: band.title, db: otherBand.title });
      }
      if (band.content !== otherBand.body) {
        add({
          area: "课程正文",
          kind: "两边不同",
          what: `${anchor} · 小节正文（${band.content.length} 字 vs ${otherBand.body.length} 字）`,
        });
      }
    }
    for (const band of other.bands) {
      const exists = course.bands.some((item) => ((item.title.split("｜")[0] ?? item.title).trim()) === band.id);
      if (!exists) add({ area: "课程正文", kind: "只在库", what: `小节「${band.id}」` });
    }
  }
  for (const subject of dbPage.subjects) {
    if (!tplSubjects.some((course) => course.nameZh === subject.name)) {
      add({ area: "课程正文", kind: "只在库", what: `学科「${subject.name}」` });
    }
  }
}

/* ── 4. 报价 ─────────────────────────────────────────────────────────────── */
const tplPricing = getPricingDataFromTemplate();
const dbPricing = db.pricing;
const dbLabels = db.siteContent.pricingPage.labels;

{
  for (const [key, value] of Object.entries(tplPricing.labels)) {
    const other = (dbLabels as unknown as Record<string, string>)[key] ?? "";
    if (value !== other) add({ area: "报价", kind: "两边不同", what: `文案 · ${key}`, template: value, db: other });
  }

  const tplStages = tplPricing.stages.map((stage) => ({
    name: stage.name,
    courses: stage.courses.map((course) => `${course.name}=${course.available ? course.price : "暂未开放"}`).join("|"),
  }));
  /*
   * 库那边的字段名是 `basePrice`（见 lib/backend/pricing.ts），不是 `price`。
   * 读错字段的后果很吓人：整张报价表会显示成"全部暂未开放"，
   * 看起来像"库里的价格全没了"—— 我第一版就是这么误报的，差点去改本来没错的数据。
   */
  const dbStages = dbPricing.stages.map((stage) => ({
    name: stage.name,
    courses: stage.courses
      .map((course) => `${course.name}=${course.available ? course.basePrice : "暂未开放"}`)
      .join("|"),
  }));
  if (JSON.stringify(tplStages) !== JSON.stringify(dbStages)) {
    for (const stage of tplStages) {
      const other = dbStages.find((item) => item.name === stage.name);
      if (other === undefined) {
        add({ area: "报价", kind: "只在模版", what: `学习阶段「${stage.name}」` });
      } else if (stage.courses !== other.courses) {
        add({ area: "报价", kind: "两边不同", what: `阶段「${stage.name}」的课程价`, template: stage.courses, db: other.courses });
      }
    }
    for (const stage of dbStages) {
      if (!tplStages.some((item) => item.name === stage.name)) add({ area: "报价", kind: "只在库", what: `学习阶段「${stage.name}」` });
    }
  }

  const tplSubjects = tplPricing.subjectGroups.map((group) => `${group.name}: ${group.subjects.map((s) => `${s.name}×${s.coefficient}`).join("、")}`);
  const dbSubjects = Object.entries(
    dbPricing.subjects.reduce<Record<string, string[]>>((acc, subject) => {
      (acc[subject.stageName] ??= []).push(`${subject.name}×${subject.coefficient}`);
      return acc;
    }, {}),
  ).map(([stage, list]) => `${stage}: ${list.join("、")}`);
  if (JSON.stringify(tplSubjects) !== JSON.stringify(dbSubjects)) {
    add({ area: "报价", kind: "两边不同", what: "科目系数", template: tplSubjects, db: dbSubjects });
  }

  const tplClass = tplPricing.classTypes.map((item) => `${item.name}=${item.coefficient ?? "按人数分摊"}`).join("|");
  const dbClass = dbPricing.classTypes.map((item) => `${item.name}=${item.coefficient ?? "按人数分摊"}`).join("|");
  if (tplClass !== dbClass) add({ area: "报价", kind: "两边不同", what: "班级系数", template: tplClass, db: dbClass });

  const tplDuration = tplPricing.durations.map((item) => `${item.name}=${item.hours}h×${item.multiplier}`).join("|");
  const dbDuration = dbPricing.durations.map((item) => `${item.name}=${item.hours}h×${item.multiplier}`).join("|");
  if (tplDuration !== dbDuration) add({ area: "报价", kind: "两边不同", what: "时长档", template: tplDuration, db: dbDuration });

  if (JSON.stringify(tplPricing.rules) !== JSON.stringify(dbPricing.rules)) {
    add({ area: "报价", kind: "两边不同", what: "计费规则", template: tplPricing.rules, db: dbPricing.rules });
  }
  const tplTrial = tplPricing.trial === null ? "无" : `${tplPricing.trial.name}（${tplPricing.trial.priceLabel}）`;
  const dbTrial = dbPricing.trial === null ? "无" : `${dbPricing.trial.name}（${dbPricing.trial.priceLabel}）`;
  if (tplTrial !== dbTrial) add({ area: "报价", kind: "两边不同", what: "试课", template: tplTrial, db: dbTrial });
}

/* ── 输出 ────────────────────────────────────────────────────────────────── */
const areas = ["教师", "课程卡片", "课程正文", "报价"];
console.log(`\n模版（data/site/*.md）  vs  后端（${base}）\n`);

for (const area of areas) {
  const list = diffs.filter((item) => item.area === area);
  if (list.length === 0) {
    console.log(`✓ ${area}：一致`);
    continue;
  }
  console.log(`· ${area}：${list.length} 处差异`);
  for (const item of list) {
    const detail =
      item.template === undefined && item.db === undefined
        ? ""
        : `\n      模版：${show(item.template)}\n      库　：${show(item.db)}`;
    console.log(`    [${item.kind}] ${item.what}${detail}`);
  }
}

const conflicts = diffs.filter((item) => item.kind === "两边不同");
const templateOnly = diffs.filter((item) => item.kind === "只在模版");
const dbOnly = diffs.filter((item) => item.kind === "只在库");

console.log(
  `\n合计：两边不同 ${conflicts.length} 处；只在模版 ${templateOnly.length} 处；只在库 ${dbOnly.length} 处`,
);
console.log(
  conflicts.length === 0 && templateOnly.length === 0
    ? "→ 两边内容一致（「只在库」的都是机构自己在后台加的内部数据，不属于网站内容）"
    : "→ 上面标了「两边不同 / 只在模版」的才是需要人拍板的；「只在库」可能只是内部数据",
);
process.exit(conflicts.length === 0 && templateOnly.length === 0 ? 0 : 1);
