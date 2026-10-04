/**
 * 逐页验收（真实后端 + 真实写操作）。
 *
 * 为什么要有它：后台各页面各调一批方法，光靠"打开页面看一眼"发现不了
 * 「某个按钮背后调的方法参数不对」这类问题 —— 而这类问题恰恰是**静默**的
 * （上一轮把报课字段猜成 totalLessons，写进去就是 null）。
 *
 * **不要直接调用这个文件**：用 `npm run accept`。那一层会自己起临时后端、
 * 指对地址、跑完收尾（见 `scripts/accept-run.mts`）。下面那道闸是为"有人绕过
 * 运行器直接跑"准备的 —— 它必须对着服务端跑，否则验的是内存里的伪后端。
 */

import { api } from "../lib/backend/api.ts";
// 教室名的唯一显示口径（「校区·教室名」，v31）—— 逐页验收要按用户看到的样子核对
import { classroomLabel } from "../lib/backend/classrooms.ts";
// 公开快照 → 内部形状（评价的内部实名只在内部那一份里，见 public-site.ts）
import { siteContentFromPublic } from "../lib/backend/public-site.ts";
// 教材的唯一显示口径（`学科·模块名`，v32）
import { textbookSummary } from "../lib/backend/textbooks.ts";
import { applyDecision, offerKey, offersByKey, resolveOffer } from "../lib/backend/offers.ts";
import {
  /*
   * ⚠️ E22 续 起：**恢复成功 = 所有人的会话被作废**（包括验收脚本自己那一个）。
   * 因此每次恢复之后都要**重新登录一次**再继续比对 —— 这就是"更贴近真实使用"的那一步。
   */
  forgetScriptLogin,
  isRemoteMode,
  remoteBase,
} from "../lib/backend/remote.ts";
import SqliteDatabase from "better-sqlite3";
/*
 * 「每天自动备份」那一块（「数据与备份」页）：它读写的是**服务端机器上的备份文件**，
 * 因此验收要造一份夹具备份、再点"恢复"（见下面 10.5 那一节）。
 * 夹具备份用服务端同一个模块写，参数与真实服务端一致（`SNAPSHOT_KEY` 与结构版本一处真源）。
 */
import { SNAPSHOT_KEY } from "../lib/backend/api.ts";
import { createNodeDailyBackupFiles } from "../server/daily-backup-files.mts";
import { listMigrations } from "../server/migrate.mts";
// 「升级前快照」的名字只有一处实现（`server/backup.mts`）：验收造夹具时也用它，不自己拼前缀
import { migrationBackupName } from "../server/backup.mts";

/*
 * 闸：没指向服务端就直接退出。
 *
 * 没有这道闸时，忘了设 `NEXT_PUBLIC_API_BASE` 会静默退化成内存伪后端，
 * 然后照样打印「43/43 通过」—— 一份假证据比不跑更糟：它让人以为真实后端验过了。
 */
if (!isRemoteMode()) {
  console.error(
    "✗ 逐页验收必须对着真实服务端跑，但当前没有设置 NEXT_PUBLIC_API_BASE。\n" +
    "  现在这样跑的是内存里的伪后端，那 43/43 是假通过。请用：\n" +
    "    npm run accept",
  );
  process.exit(2);
}
console.log(`后端：${remoteBase()}\n`);

type Result = { page: string; label: string; ok: boolean; note: string };
const results: Result[] = [];

/** 执行一项检查：抛错记成 ✗ 并留下原因（不中断整轮，才能一次看全）。 */
async function check(page: string, label: string, run: () => Promise<unknown>, expect?: (value: never) => boolean) {
  try {
    const value = await run();
    const pass = expect === undefined ? true : expect(value as never);
    results.push({ page, label, ok: pass, note: pass ? "" : `断言不通过：${JSON.stringify(value)?.slice(0, 120)}` });
  } catch (cause) {
    results.push({ page, label, ok: false, note: cause instanceof Error ? cause.message : String(cause) });
  }
}

const iso = (offsetDays = 0, hour = 10) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/*
 * 星期几的口径是 **1–7（周日 = 7）**，而 JS 的 `getDay()` 里**周日是 0** ——
 * 两者只差「周日」这一天，所以搞混了会「平时都对、一到周日就出事」。
 *
 * 这个坑真的踩过：候选时段原先直接传 `getDay()`，于是凡是「今天 + 2 天是周日」的日子
 * （也就是每个周五）跑验收，「周日 17:00」就变成 `weekday: 0`，把服务端的
 * `buildDateSeries` 转进了死循环 —— 整个后端不再应答、验收永不结束。
 * 服务端现在会当场拒绝 0（见 `lib/backend/inquiry.ts` 的 `assertWeekday`），
 * 这里则按正确口径把值算对。口径只有一份：`getDay() === 0 ? 7 : getDay()`。
 */
const isoWeekdayOf = (date: Date): number => (date.getDay() === 0 ? 7 : date.getDay());

/* ── 1 课程库（含分区）── */
/*
 * 维度引用（v28）：下面是「围棋」这门后台新增课程要挂的学段 / 学科。
 * 取一次放在这里 —— 验收里多处要用，而每次调 `catalog.list()` 都是一次真实 HTTP。
 */
const acceptCatalog = await api.catalog.list();
/*
 * 刻意挑**成对的**（学段 ∩ 学科）：「语文」在小学 / 初中 / 高中都开。
 * 第一版随手取了 `subjects[0]`（那是分组「外语等级考试」）+ `stages[0]`（小学），
 * 服务端当场拒绝（学段与学科对不上）—— 校验是对的，是夹具取错了。
 */
const acceptStageId =
  acceptCatalog.stages.find((stage) => stage.name === "小学")?.id ?? acceptCatalog.stages[0]?.id ?? "";
const acceptSubjectId =
  acceptCatalog.subjects.find(
    (subject) => subject.name === "语文" && subject.stageIds.includes(acceptStageId),
  )?.id ??
  acceptCatalog.subjects.find((subject) => subject.stageIds.includes(acceptStageId))?.id ??
  "";
let courseId = "";
/*
 * 分区先行：课程要挂在某一区上（v18 起课程只存 `partitionId`）。
 * 这几条按"机构在后台整理分区"的真实顺序走一遍：
 * 建栏目 → 建子栏目 → 把课挂进去 → 改名（一处改、处处变）→ 删除空栏目 → 有课的删不掉。
 */
let columnId = "";
await check("课程库", "新建栏目（兴趣才艺）", async () => {
  const created = await api.coursePartitions.create({ name: "兴趣才艺" });
  columnId = created.id;
  return created;
}, (p: { name: string; parentId: string }) => p.name === "兴趣才艺" && p.parentId === "");
let subId = "";
await check("课程库", "在栏目下新建子栏目（棋类）", async () => {
  const created = await api.coursePartitions.create({ name: "棋类", parentId: columnId });
  subId = created.id;
  return created;
}, (p: { parentId: string }) => p.parentId === columnId);
await check("课程库", "分区列表能读回来（两级都在）", async () => {
  const list = await api.coursePartitions.list();
  return list.some((item) => item.id === columnId) && list.some((item) => item.id === subId);
});
await check("课程库", "同级重名被拒绝", async () => {
  try {
    await api.coursePartitions.create({ name: "棋类", parentId: columnId });
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("不能重复") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("课程库", "新建课程（围棋，挂到子栏目）", async () => {
  const created = await api.courses.create({
    name: "围棋", partitionId: subId, forms: ["一对一"], origin: "后台",
    status: "开放", note: "验收用", createdAt: new Date().toISOString(),
    path: "", tags: [], target: "", order: 990, intro: "", siteKind: "不展示",
    /*
     * 维度引用（v28）：新建课程**必须挂上**（机构口径："课程以维度法为主安排"）。
     * 这里顺手验一次"新建时就带维度"，并把「围棋」挂到「其他类型 × 3D建模与3D打印」之外的
     * 一个真实学科上 —— 它是后台新增的兴趣课，挂哪个学科由机构自己选，验收里挑第一个存在的。
     */
    stageIds: [acceptStageId],
    subjectIds: [acceptSubjectId],
    moduleIds: [],
  });
  courseId = created.id;
  return created;
}, (c: { name: string; partitionId: string }) => c.name === "围棋" && c.partitionId === subId);
await check("课程库", "改分区名：课程引用不变、显示名跟着变", async () => {
  await api.coursePartitions.update(columnId, { name: "兴趣才艺（改）" });
  const option = (await api.courses.options()).find((item) => item.name === "围棋");
  // 两级时显示完整路径（与导出、清单同一个写法）—— 只看叶子名会看不出它属于哪个栏目
  return option?.category ?? "";
}, (category: string) => category === "兴趣才艺（改） / 棋类");
await check("课程库", "有子栏目的栏目删不掉（先说清是哪些子栏目）", async () => {
  try {
    await api.coursePartitions.remove(columnId);
    return "竟然删掉了";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("子栏目") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("课程库", "有课的子栏目也删不掉（护栏说清了先做什么）", async () => {
  try {
    await api.coursePartitions.remove(subId);
    return "竟然删掉了";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("门课") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("课程库", "把课移到另一区（一次事务）", async () => {
  const target = (await api.coursePartitions.list()).find((item) => item.parentId === "");
  if (target === undefined) return "没有可用的目标分区";
  const moved = await api.courses.setPartition([courseId], target.id);
  return moved;
}, (moved: number) => moved === 1);
await check("课程库", "空栏目可以删掉（护栏不误伤）", async () => {
  const empty = await api.coursePartitions.create({ name: "验收·空栏目" });
  return await api.coursePartitions.remove(empty.id);
}, (removed: boolean) => removed === true);
await check("课程库", "课程列表与统计", async () => (await api.courses.list()).length > 0);
await check("课程库", "修改课程", async () => (await api.courses.update(courseId, { note: "已改" }))?.note === "已改");

/* ── 1.5 网站内容（学生案例）── */
let casesPageId = "";
await check("网站内容", "读案例（初始为空或已有内容）", async () => {
  const content = await api.site.publicContent();
  return Array.isArray(content.siteContent.casesPage.cases);
});
await check("网站内容", "新增一条案例", async () => {
  const content = await api.site.publicContent();
  const saved = await api.site.saveBlocks({
    casesPage: {
      ...content.siteContent.casesPage,
      cases: [
        ...content.siteContent.casesPage.cases,
        {
          id: "",
          title: "验收·初三 王同学｜物理从 71 分到 88 分",
          fields: [
            { title: "年级", value: "初三" },
            { title: "科目", value: "物理" },
            { title: "入学水平", value: "71 分" },
            { title: "当前水平", value: "88 分（中考）" },
          ],
          story: "验收用的一条案例。\n\n第二段。",
        },
      ],
    },
  });
  const created = saved.casesPage.cases.at(-1);
  casesPageId = created?.id ?? "";
  return [created?.title ?? "", created?.id ?? ""];
}, (value: string[]) => value[0] !== "" && value[1] !== "");
await check("网站内容", "案例出现在网站那侧的数据里", async () => {
  const content = await api.site.publicContent();
  return content.siteContent.casesPage.cases.some((item) => item.id === casesPageId);
});
await check("网站内容", "标题为空被拒", async () => {
  const content = await api.site.publicContent();
  try {
    await api.site.saveBlocks({
      casesPage: {
        ...content.siteContent.casesPage,
        cases: [{ id: "", title: "  ", fields: [], story: "" }],
      },
    });
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("不能为空") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("网站内容", "保存课程正文不会冲掉案例", async () => {
  const content = await api.site.publicContent();
  /*
   * 公开快照里没有评价的内部实名（v36），而 `site.saveContent` 要的是 `SiteContent`：
   * 走 `siteContentFromPublic` 补成那个形状（运行时不带 `realName` 键）。
   * 这一页保存的是**课程正文**，服务端会原样保留评价块 —— 实名安全。
   */
  await api.site.saveContent(siteContentFromPublic(content.siteContent));
  const after = await api.site.publicContent();
  return after.siteContent.casesPage.cases.some((item) => item.id === casesPageId);
});
await check("网站内容", "删掉刚加的案例（收尾）", async () => {
  const content = await api.site.publicContent();
  const saved = await api.site.saveBlocks({
    casesPage: {
      ...content.siteContent.casesPage,
      cases: content.siteContent.casesPage.cases.filter((item) => item.id !== casesPageId),
    },
  });
  return saved.casesPage.cases.some((item) => item.id === casesPageId) === false;
});

await check("网站内容", "特色课程读数（初始来自内容文件）", async () => {
  const content = await api.site.publicContent();
  const count = (list: Array<{ children: unknown[] }>): number =>
    list.reduce((sum, item) => sum + 1 + count(item.children as Array<{ children: unknown[] }>), 0);
  return count(content.siteContent.featuredPage.courses);
}, (n: number) => n > 0);
await check("网站内容", "改一门特色课程的名字并保存", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.featuredPage;
  const first = page.courses[0];
  if (first === undefined) return "没有一级课程";
  const saved = await api.site.saveBlocks({
    featuredPage: {
      ...page,
      courses: [{ ...first, name: `${first.name}（验收改名）` }, ...page.courses.slice(1)],
    },
  });
  return saved.featuredPage.courses[0]?.name ?? "";
}, (name: string) => name.endsWith("（验收改名）"));
await check("网站内容", "改回原名（收尾）", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.featuredPage;
  const first = page.courses[0];
  if (first === undefined) return "没有一级课程";
  const saved = await api.site.saveBlocks({
    featuredPage: {
      ...page,
      courses: [{ ...first, name: first.name.replace("（验收改名）", "") }, ...page.courses.slice(1)],
    },
  });
  return saved.featuredPage.courses[0]?.name.includes("验收改名") === false;
}, (ok: boolean) => ok === true);
await check("网站内容", "同级重名被拒", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.featuredPage;
  const first = page.courses[0];
  if (first === undefined) return "没有一级课程";
  try {
    await api.site.saveBlocks({ featuredPage: { ...page, courses: [first, { ...first, id: "" }] } });
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("不能重复") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("网站内容", "保存特色课程不会动学生案例", async () => {
  const content = await api.site.publicContent();
  const before = content.siteContent.casesPage.cases.length;
  const saved = await api.site.saveBlocks({ featuredPage: content.siteContent.featuredPage });
  return saved.casesPage.cases.length === before;
});

await check("网站内容", "常见问题读数（初始来自内容文件）", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.faqPage;
  return page.groups.reduce((sum, group) => sum + group.items.length, 0);
}, (n: number) => n > 0);
await check("网站内容", "加一条问答并保存", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.faqPage;
  const first = page.groups[0];
  if (first === undefined) return "没有分组";
  const saved = await api.site.saveBlocks({
    faqPage: {
      ...page,
      groups: [
        { ...first, items: [...first.items, { id: "", question: "验收用的一个问题？", answer: "验收用的答案。" }] },
        ...page.groups.slice(1),
      ],
    },
  });
  return saved.faqPage.groups[0]?.items.some((item) => item.question === "验收用的一个问题？") ?? false;
}, (ok: boolean) => ok === true);
await check("网站内容", "删掉刚加的那条（收尾）", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.faqPage;
  const saved = await api.site.saveBlocks({
    faqPage: {
      ...page,
      groups: page.groups.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.question !== "验收用的一个问题？"),
      })),
    },
  });
  return saved.faqPage.groups.every((group) =>
    group.items.every((item) => item.question !== "验收用的一个问题？"));
});
await check("网站内容", "答案为空被拒", async () => {
  const content = await api.site.publicContent();
  const page = content.siteContent.faqPage;
  try {
    await api.site.saveBlocks({
      faqPage: { ...page, groups: [{ id: "", title: "验收", items: [{ id: "", question: "问？", answer: " " }] }] },
    });
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("还没有答案") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");

await check("网站内容", "页面文案读数（品牌 / 首页 / 关于 / 联系 / 时间安排）", async () => {
  const content = await api.site.publicContent();
  const copy = content.siteContent.copy;
  return [copy.brand.fields.length > 0, copy.home.fields.length > 0, copy.about.groups.length > 0,
    copy.contact.groups.length > 0, copy.schedule.groups.length > 0];
}, (value: boolean[]) => value.every((item) => item === true));
await check("网站内容", "改一个短字段并保存（品牌电话）", async () => {
  const content = await api.site.publicContent();
  const brand = content.siteContent.copy.brand;
  const phone = brand.fields.find((field) => field.key === "phone")?.value ?? "";
  const saved = await api.site.saveBlocks({
    copy: {
      ...content.siteContent.copy,
      brand: {
        ...brand,
        fields: brand.fields.map((field) =>
          field.key === "phone" ? { ...field, value: `${phone}（验收）` } : field,
        ),
      },
    },
  });
  return saved.copy.brand.fields.find((field) => field.key === "phone")?.value ?? "";
}, (value: string) => value.endsWith("（验收）"));
await check("网站内容", "改回原值（收尾）", async () => {
  const content = await api.site.publicContent();
  const brand = content.siteContent.copy.brand;
  const saved = await api.site.saveBlocks({
    copy: {
      ...content.siteContent.copy,
      brand: {
        ...brand,
        fields: brand.fields.map((field) =>
          field.key === "phone" ? { ...field, value: field.value.replace("（验收）", "") } : field,
        ),
      },
    },
  });
  return saved.copy.brand.fields.every((field) => !field.value.includes("（验收）"));
});
await check("网站内容", "改一份文案不会动案例与特色课程", async () => {
  const content = await api.site.publicContent();
  const before = [
    JSON.stringify(content.siteContent.casesPage),
    JSON.stringify(content.siteContent.featuredPage),
  ];
  const saved = await api.site.saveBlocks({ copy: content.siteContent.copy });
  return [
    JSON.stringify(saved.casesPage) === before[0],
    JSON.stringify(saved.featuredPage) === before[1],
  ];
}, (value: boolean[]) => value.every((item) => item === true));
await check("网站内容", "字段键重复被拒", async () => {
  const content = await api.site.publicContent();
  const brand = content.siteContent.copy.brand;
  try {
    await api.site.saveBlocks({
      copy: {
        ...content.siteContent.copy,
        brand: { ...brand, fields: [...brand.fields, { id: "", key: "phone", value: "x" }] },
      },
    });
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("出现了两次") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");

let acceptanceCourseId = "";
/* ── 1.55 课程挂到维度上（v28）── */
/*
 * 台账里的课是枚举出来的，课程类型是维度 —— 这一节验两者在**真实 HTTP** 上接上了：
 * 每门课都挂着学段与学科（迁移 / 新建 / 同步三条路都要挂上），挂悬空引用会被拒。
 */
await check("课程", "库里的课程都挂上了维度（学段 + 学科）", async () => {
  const courses = await api.courses.list();
  const unlinked = courses.filter((course) => (course.subjectIds ?? []).length === 0);
  return [courses.length, unlinked.map((course) => course.name)];
}, (value: unknown[]) => (value[0] as number) > 0 && (value[1] as unknown[]).length === 0);
await check("课程", "挂的学科都是课程类型里存在的行", async () => {
  const [courses, catalog] = [await api.courses.list(), await api.catalog.list()];
  const ids = new Set(catalog.subjects.map((subject) => subject.id));
  return courses.flatMap((course) => (course.subjectIds ?? []).filter((id) => !ids.has(id)));
}, (value: unknown[]) => value.length === 0);
await check("课程", "新建一门课并挂上维度（学段 + 学科）", async () => {
  const catalog = await api.catalog.list();
  const stage = catalog.stages[0];
  const subject = catalog.subjects.find((item) => item.stageIds.includes(stage?.id ?? ""));
  const created = await api.courses.create({
    name: "验收·挂维度的课", partitionId: "", forms: [], status: "开放", note: "", path: "",
    tags: [], target: "", order: 990, intro: "", siteKind: "不展示", origin: "后台", createdAt: "",
    stageIds: [stage?.id ?? ""], subjectIds: [subject?.id ?? ""], moduleIds: [],
  });
  acceptanceCourseId = created.id;
  return [created.stageIds.length, created.subjectIds.length];
}, (value: number[]) => value[0] === 1 && value[1] === 1);
await check("课程", "挂一个不存在的学科会被拒（不是静默保存）", async () => {
  try {
    await api.courses.create({
      name: "验收·挂错维度", partitionId: "", forms: [], status: "开放", note: "", path: "",
      tags: [], target: "", order: 991, intro: "", siteKind: "不展示", origin: "后台", createdAt: "",
      stageIds: [], subjectIds: ["subj_不存在"], moduleIds: [],
    });
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("不存在的学科") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("课程", "收尾：删掉验收建的那门课", async () => {
  if (acceptanceCourseId === "") return true;
  await api.courses.remove(acceptanceCourseId);
  return (await api.courses.list()).some((course) => course.id === acceptanceCourseId) === false;
});

/* ── 1.6 课程类型（五张维度表：加学段 / 加学科 / 加模块 / 加班型）── */
/*
 * 这一节按机构在后台的真实顺序走一遍：读 → 加一个学段 + 学科 + 模块 + 班型 → 再读确认落库
 * → 非法的一份被拒（人数区间反向 / 悬空引用）→ 恢复种子收尾。
 *
 * 收尾**必须回到种子**：验收用的就是这个机构自己的库，留着「验收学段」会让后面每次构站
 * 都多出一截，而且下一次验收时 `subjects` 里会多一条重名的行（id 是写死的）。
 */
await check("课程类型", "维度表读得到（四张表都在）", async () => {
  const catalog = await api.catalog.list();
  return [catalog.stages.length, catalog.formats.length, catalog.modules.length];
}, (value: number[]) => (value[0] ?? 0) > 0 && (value[1] ?? 0) > 0 && (value[2] ?? 0) > 0);
await check("课程类型", "班型与报价里的班级类型是同一套（一件事只有一套写法）", async () => {
  const catalog = await api.catalog.list();
  const pricing = await api.pricing.get();
  return catalog.formats.map((item) => item.name).join("|") === pricing.classTypes.map((item) => item.name).join("|");
});
await check("课程类型", "加一个学段 + 学科 + 模块 + 班型，整份保存", async () => {
  const catalog = await api.catalog.list();
  const draft = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  draft.stages.push({ id: "st_验收学段", name: "验收学段", order: 99, note: "验收用，跑完恢复种子" });
  draft.subjects.push({
    id: "subj_验收学科", name: "验收学科", kind: "学科", parentIds: [], order: 99,
    stageIds: ["st_验收学段"], note: "",
  });
  draft.modules.push({
    id: "mod_验收学科·验收模块", parentId: "", subjectId: "subj_验收学科", name: "验收模块",
    kind: "能力点", order: 1, stageIds: ["st_验收学段"],
  });
  draft.formats.push({ id: "fmt_验收班型", name: "验收班型", minSize: 5, maxSize: 5, mode: "系数", order: 99 });
  const saved = await api.catalog.save(draft);
  return [
    saved.stages.some((item) => item.id === "st_验收学段"),
    saved.subjects.some((item) => item.name === "验收学科"),
    saved.modules.some((item) => item.name === "验收模块"),
    saved.formats.some((item) => item.name === "验收班型"),
  ];
}, (value: boolean[]) => value.every(Boolean));
await check("课程类型", "改动真的落库了（再读一次还在）", async () => {
  const catalog = await api.catalog.list();
  return (
    catalog.stages.some((item) => item.name === "验收学段") &&
    catalog.formats.some((item) => item.name === "验收班型")
  );
});
await check("课程类型", "班级人数区间写反会被拒（不是静默保存）", async () => {
  const catalog = await api.catalog.list();
  const draft = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  draft.formats[0]!.minSize = 0;
  try {
    await api.catalog.save(draft);
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("最少人数") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("课程类型", "悬空引用会被拒（引用了不存在的学段）", async () => {
  const catalog = await api.catalog.list();
  const draft = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  draft.subjects[0]!.stageIds = ["st_不存在"];
  try {
    await api.catalog.save(draft);
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("不存在的学段") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("课程类型", "保存写了操作日志", async () => {
  const logs = await api.logs.list();
  return logs.some((item) => item.entity === "课程类型");
});
await check("课程类型", "恢复种子（收尾：验收加的那几行必须清掉）", async () => {
  const restored = await api.catalog.resetToSeed();
  return [
    restored.stages.some((item) => item.name === "验收学段"),
    restored.subjects.some((item) => item.name === "验收学科"),
    restored.formats.some((item) => item.name === "验收班型"),
  ];
}, (value: boolean[]) => value.every((item) => item === false));

/* ── 1.7 开放矩阵（哪些「学科 × 模块 × 班型 × 交付」的组合真的开）── */
/*
 * 按机构在后台的真实顺序走一遍：读 → 批量开放两条组合 → 解析确认 → 非法的一份被拒
 * → 再读确认落库 → 收尾清除自己加的那些（这是机构自己的库，验完要回到原样）。
 *
 * 注意挑学科时要**排掉分组**（「外语等级考试」那种桶也在 `subjects` 里，
 * 但它不是能开课的学科，也没有模块）—— 自检第 31 节专门钉着这件事。
 */
const offersBefore = await api.offers.list();
const groupIdsOf = (catalog: { subjects: Array<{ id: string; parentIds: string[] }> }): Set<string> =>
  new Set(catalog.subjects.flatMap((item) => item.parentIds));

await check("开放矩阵", "组合表读得到（稀疏：可能一条都没有）", async () => Array.isArray(offersBefore));

await check("开放矩阵", "批量开放两条组合（页面上的批量勾选走的就是这一条保存）", async () => {
  const catalog = await api.catalog.list();
  const groups = groupIdsOf(catalog);
  const subject = catalog.subjects.find((item) => !groups.has(item.id));
  const firstModule = catalog.modules.find((item) => item.subjectId === subject?.id);
  const format = catalog.formats[0];
  if (subject === undefined || firstModule === undefined || format === undefined) return null;
  const keys = [
    { subjectId: subject.id, moduleId: "", formatId: format.id },
    { subjectId: subject.id, moduleId: firstModule.id, formatId: format.id },
  ];
  const saved = await api.offers.save(applyDecision(offersBefore, keys, "open", new Date().toISOString()));
  return [saved.length, saved.every((offer) => offer.open)];
}, (value: unknown[]) => value[0] === 2 && value[1] === true);

await check("开放矩阵", "解析：开的算 open、另一个班型仍是没设过", async () => {
  const catalog = await api.catalog.list();
  const groups = groupIdsOf(catalog);
  const subject = catalog.subjects.find((item) => !groups.has(item.id));
  const format = catalog.formats[0];
  const other = catalog.formats.find((item) => item.id !== format?.id);
  if (subject === undefined || format === undefined || other === undefined) return ["?", "?"];
  const index = offersByKey(await api.offers.list());
  return [
    resolveOffer(index, { subjectId: subject.id, moduleId: "", formatId: format.id }),
    resolveOffer(index, { subjectId: subject.id, moduleId: "", formatId: other.id }),
  ];
}, (value: string[]) => value[0] === "open" && value[1] === "unset");

await check("开放矩阵", "明确关闭是第三态（不是把行删掉）", async () => {
  const catalog = await api.catalog.list();
  const groups = groupIdsOf(catalog);
  const subject = catalog.subjects.find((item) => !groups.has(item.id));
  const key = {
    subjectId: subject?.id ?? "",
    moduleId: "",
    formatId: catalog.formats[0]?.id ?? "",
  };
  const current = await api.offers.list();
  const closed = await api.offers.save(applyDecision(current, [key], "closed", new Date().toISOString()));
  return [
    closed.length,
    resolveOffer(offersByKey(closed), key),
  ];
}, (value: unknown[]) => value[0] === 2 && value[1] === "closed");

await check("开放矩阵", "引用不存在的班型会被拒（不是静默保存）", async () => {
  const offers = await api.offers.list();
  const only = offers[0];
  if (only === undefined) return "没有可用的组合";
  try {
    await api.offers.save([{ ...only, formatId: "fmt_不存在" }]);
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("不存在的班型") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");

await check("开放矩阵", "保存写了操作日志", async () => {
  const logs = await api.logs.list();
  return logs.some((item) => item.entity === "开放矩阵");
});

await check("开放矩阵", "清除收尾（回到验收前的状态）", async () => {
  const before = new Set(offersBefore.map(offerKey));
  const current = await api.offers.list();
  const added = current
    .filter((offer) => !before.has(offerKey(offer)))
    .map((offer) => ({
      subjectId: offer.subjectId,
      moduleId: offer.moduleId,
      formatId: offer.formatId,
    }));
  const cleared = await api.offers.save(applyDecision(current, added, "unset", new Date().toISOString()));
  return cleared.length;
}, (n: number) => n === offersBefore.length);

/* ── 2 教室 ── */
let classroomId = "";
await check("教室", "新建教室（含可用时段）", async () => {
  const created = await api.classrooms.create({
    name: "验收教室", capacity: 6, kind: "上课用教室", note: "",
    // v30：校区（自由文本）。验收一律先给一个非空值，下面再验"存进去能读回来"
    campus: "验收校区",
    availability: [{ id: "a1", weekdays: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00" }],
  });
  classroomId = created.id;
  return created;
}, (r: { name: string; campus: string }) => r.name === "验收教室" && r.campus === "验收校区");
await check("教室", "修改教室容量", async () => (await api.classrooms.update(classroomId, { capacity: 8 }))?.capacity === 8);
/*
 * 校区（v30）：**改一次、再整份提交一次**，两次都读回来核对。
 * 第二次刻意走"页面表单那条路"的形状（把读到的整条记录原样交回去 + `expectedVersion`）——
 * 教师/教室表单是整份覆盖，新字段跟着一起交上来，写错一处就会静默丢掉。
 */
await check("教室", "改校区并读回来（v30 新字段）", async () => {
  await api.classrooms.update(classroomId, { campus: "验收校区·改" });
  const after = (await api.classrooms.list()).find((room) => room.id === classroomId);
  return after?.campus ?? "（读不到这间教室）";
}, (campus: string) => campus === "验收校区·改");
await check("教室", "整份提交（页面表单那样交回整条）时校区不丢", async () => {
  const current = (await api.classrooms.get(classroomId))!;
  const saved = await api.classrooms.update(
    classroomId,
    { ...current, capacity: 7, campus: "验收校区·整份" } as Omit<typeof current, "id" | "version">,
    { expectedVersion: current.version },
  );
  return [(await api.classrooms.get(classroomId))?.capacity, saved?.campus];
}, (value: unknown[]) => value[0] === 7 && value[1] === "验收校区·整份");
/*
 * v31 收紧：**校区必填**（机构原话「校区必须填」）。
 * 三条都要真写一遍：
 *   ① 校区 + 纯教室名 → 落库两格分开，**显示拼回「校区·教室名」**；
 *   ② 教室名里粘着校区（老表那种写法）→ 拆开，显示与原来一字不差（**先拆后判**：
 *      校区那一格空着但名称里带着校区，因此不算"空校区"，仍然能建 —— 与批量导入同一条口径）；
 *   ③ **空校区被拒**（空串与空格串都拒，错误里点名「校区」），而且**一条都没建进去** ——
 *      这正是"校区必须填"要挡住的那种状态，也是下面 ④ 那句"把校区补上"的反面。
 */
await check("教室", "校区 + 纯教室名：落库分开、显示拼成「校区·教室名」", async () => {
  const current = (await api.classrooms.get(classroomId))!;
  const saved = await api.classrooms.update(
    classroomId,
    { ...current, name: "验收教室3", campus: "沐阳教育" } as Omit<typeof current, "id" | "version">,
    { expectedVersion: current.version },
  );
  return [saved?.campus, saved?.name, classroomLabel(saved!)];
}, (value: unknown[]) =>
  value[0] === "沐阳教育" && value[1] === "验收教室3" && value[2] === "沐阳教育·验收教室3");
await check("教室", "老表那种合并写法（名称里带「校区·」）会被拆开，显示不变", async () => {
  // 交上去的是老表里那串合并写法（校区那一格空着）
  const submitted = "沐阳教育·验收老格式教室";
  const created = await api.classrooms.create({
    name: submitted, kind: "上课用教室", campus: "", capacity: 4, availability: [], note: "",
  });
  // 存下来的是两格，拼回去必须与交上去那一串**一字不差**（机构要的"显示格式不变"）
  return [created.campus, created.name, classroomLabel(created), submitted];
}, (value: unknown[]) =>
  value[0] === "沐阳教育" && value[1] === "验收老格式教室" &&
  value[2] === value[3] && value[2] === "沐阳教育·验收老格式教室");
/*
 * 空校区被拒（v31 收紧）。两档都真写一遍，两件都要验到：
 *   · **报错原话**里点名「校区」与「必填」（只判"抛错了"不够 —— 抛的是别的错也过）；
 *   · **库里一条都没多**（拒绝路径写进去半截数据，比不拒绝更难查）。
 */
await check("教室", "空校区被拒：空串与空格串都拒，且一条都没建进去", async () => {
  const messages: string[] = [];
  for (const campus of ["", "   "]) {
    try {
      await api.classrooms.create({
        name: "验收无校区教室", kind: "上课用教室", campus, capacity: 4, availability: [], note: "",
      });
      messages.push(`（「${campus}」被接受了，没有报错）`);
    } catch (cause) {
      messages.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const leaked = (await api.classrooms.list()).filter((room) => room.name === "验收无校区教室").length;
  return { messages, leaked };
}, (value: { messages: string[]; leaked: number }) =>
  value.leaked === 0 &&
  value.messages.every((message) => message.includes("校区") && message.includes("必填")));

/* ── 3 教师 ── */
let teacherId = "";
await check("教师", "新建教师（可带科目用课程名）", async () => {
  const created = await api.teachers.create({
    name: "验收老师", role: "数学", subjects: ["围棋", "初中数学"], phone: "138", active: true,
    years: "", summary: "", bio: "", recommendation: "", order: 900, siteVisible: false,
    origin: "后台", kind: "教师",
    // v30：用工性质与招聘渠道。新建就给非空值，读回来核对
    employment: "兼职", source: "验收来源·朋友介绍",
  });
  teacherId = created.id;
  return created;
}, (t: { subjects: string[]; employment: string; source: string }) =>
  t.subjects.includes("围棋") && t.employment === "兼职" && t.source === "验收来源·朋友介绍");
await check("教师", "在职教师列表", async () => (await api.teachers.listActive()).some((t) => t.id === teacherId));
/*
 * v30 的两个内部字段（机构要的「全职/兼职」与「教师来源」）：真实写、真实读回来。
 *
 * 三件都要验到，因为它们是三种不同的失败形态：
 *   ① 合法值改得动、读得回来（后端字段没丢）；
 *   ② **整份提交**（页面表单那样把整条记录交回去）时新字段不丢 —— 教师表单是整份覆盖，
 *      少交一个字段就会把它清掉，而这种丢失**看起来一切正常**；
 *   ③ 非法取值被服务端**拒绝**，而且库里那条**一点没变**（拒绝时不许写进去半截）。
 */
await check("教师", "改「全职 / 兼职」与「来源」并读回来（v30 新字段）", async () => {
  await api.teachers.update(teacherId, { employment: "全职", source: "验收来源·校招" });
  const after = (await api.teachers.get(teacherId))!;
  return [after.employment, after.source];
}, (value: unknown[]) => value[0] === "全职" && value[1] === "验收来源·校招");
await check("教师", "整份提交（页面表单那样交回整条）时新字段不丢", async () => {
  const current = (await api.teachers.get(teacherId))!;
  const saved = await api.teachers.update(
    teacherId,
    { ...current, role: "验收职务", employment: "兼职", source: "验收来源·朋友介绍" } as Omit<
      typeof current,
      "id" | "version"
    >,
    { expectedVersion: current.version },
  );
  return [saved?.role, saved?.employment, saved?.source];
}, (value: unknown[]) =>
  value[0] === "验收职务" && value[1] === "兼职" && value[2] === "验收来源·朋友介绍");
await check("教师", "非法的「全职 / 兼职」被服务端拒绝，且库里那条一点没变", async () => {
  const before = (await api.teachers.get(teacherId))!;
  let rejection = "没有报错（非法值被接受了）";
  try {
    /*
     * 故意传一个类型上不允许的值：这一条验的正是**运行时那道闸**
     * （`/api/call` 的 args 原样进服务层，编译期拦不住别处来的请求）。
     */
    await api.teachers.update(teacherId, { employment: "临时工" as never });
  } catch (cause) {
    rejection = cause instanceof Error ? cause.message : String(cause);
  }
  const after = (await api.teachers.get(teacherId))!;
  return [rejection.includes("全职"), after.employment, after.version === before.version];
}, (value: unknown[]) => value[0] === true && value[1] === "兼职" && value[2] === true);

/* ── 4 学生与报课收费 ── */
let studentId = "";
let enrollmentId = "";
await check("学生", "建档", async () => {
  const created = await api.students.create({
    name: "验收学生", grade: "初二", guardian: "138-0000-0000", subjects: [], profile: {},
    enrollments: [], status: "在读", note: "",
  });
  studentId = created.id;
  return created;
}, (s: { name: string }) => s.name === "验收学生");
/*
 * v32：**生日 + 两本跨学科教材**（机构原话：「新建学生应该有一个年级、生日以及
 * 现阶段使用的教材（可以有多本，因为一个学生可能有多个科目）」）。
 *
 * 这一条走的是**真实 HTTP 写入**，因此它验的不只是服务层：教材存的是模块 id、
 * 生日落在**同一条记录**的 `profile.birthDate`（不是新字段），两条都要读回来一致。
 * 教材取的是**真实课程类型**里的两本、**两个不同学科**（跨学科正是机构说的那种情形）。
 */
await check("学生", "建档：生日 + 两本跨学科教材（v32）", async () => {
  const first = acceptCatalog.modules[0];
  const second = acceptCatalog.modules.find((item) => item.subjectId !== first?.subjectId);
  const created = await api.students.create({
    name: "验收教材学生", grade: "初二", guardian: "", status: "在读", note: "",
    textbooks: [first?.id ?? "", second?.id ?? ""],
    profile: { birthDate: "2012-05-06" },
    enrollments: [],
  });
  const readBack = (await api.students.get(created.id))!;
  return {
    同一条记录: readBack.id === created.id,
    教材: readBack.textbooks,
    跨学科: first?.subjectId !== second?.subjectId,
    生日: readBack.profile.birthDate,
    采集表只有生日: JSON.stringify(Object.keys(readBack.profile)) === JSON.stringify(["birthDate"]),
    显示: textbookSummary(acceptCatalog, readBack.textbooks),
  };
}, (v: {
  同一条记录: boolean; 教材: string[]; 跨学科: boolean; 生日: string;
  采集表只有生日: boolean; 显示: string;
}) =>
  v.同一条记录 && v.跨学科 &&
  v.采集表只有生日 &&
  v.生日 === "2012-05-06" &&
  // 显示出来的一行必须带学科（`学科·模块名、学科·模块名`），否则看不出是哪一科的教材
  v.显示.split("、").length === 2 &&
  v.显示.split("、").every((part) => part.includes("·")) &&
  !v.显示.includes("已失效教材"));
/*
 * 服务层那道闸（v32）：写**名字**（`物理·必修教材`）而不是模块 id 时必须被拒，
 * 而且要把"本库里它是哪个 id"说出来 —— 只说"错了"等于让人对着一个字符串发呆。
 */
await check("学生", "教材写成名字会被拒，并指出正规写法", async () => {
  const before = (await api.students.list()).length;
  try {
    await api.students.create({
      name: "验收·不该建出来", grade: "初二", guardian: "", status: "在读", note: "",
      textbooks: ["物理·必修教材"], profile: {}, enrollments: [],
    });
    return { 拒绝: false, 原话: "", 学生数没变: false };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    /*
     * ⚠️ 查这个 id 必须**锁学科**：叫「必修教材」的模块有 9 个（数学 / 物理 / 化学…），
     * 只按名字查会查到别的学科那一本（原先查成了数学的），断言于是必然不通过 ——
     * 而产品行为其实是对的。夹具写的是「物理·必修教材」，这里就查**物理**那一本。
     */
    const physicsId = acceptCatalog.subjects.find((item) => item.name === "物理")?.id ?? "";
    const resolved =
      acceptCatalog.modules.find(
        (item) => item.name === "必修教材" && item.subjectId === physicsId,
      )?.id ?? "";
    return {
      拒绝: true,
      原话: message,
      指出正规写法: message.includes("模块 id") && resolved !== "" && message.includes(resolved),
      学生数没变: (await api.students.list()).length === before,
    };
  }
}, (v: { 拒绝: boolean; 指出正规写法: boolean; 学生数没变: boolean }) =>
  v.拒绝 && v.指出正规写法 && v.学生数没变);
/*
 * 批量导入的「教材」列（v32）：真实走一次 `/api/call` 的 `imports.apply` ——
 * 合法写法（`学科·模块名`）落库成模块 id；重名的模块名（`必修教材`）那一行被拒，
 * 报告里点出行号并说清"没说清是哪个学科"。
 */
await check("学生", "批量导入「教材」列：认写法、拦重名", async () => {
  const duplicated = acceptCatalog.modules.find(
    (item) => acceptCatalog.modules.filter((other) => other.name === item.name).length >= 2,
  );
  const csv = [
    "姓名,年级,教材",
    "验收·导入教材学生,初二,物理·必修教材|数学·八年级教材",
    `验收·导入教材学生2,初二,${duplicated?.name ?? "必修教材"}`,
  ].join("\n") + "\n";
  const applied = await api.imports.apply({ entity: "students", text: csv, fileName: "验收-教材.csv" });
  const imported = (await api.students.list()).find((item) => item.name === "验收·导入教材学生");
  return {
    新增: applied.added,
    问题行: applied.problems.map((item) => item.line),
    拒绝理由: applied.problems[0]?.reason ?? "",
    教材: imported?.textbooks ?? [],
  };
}, (v: { 新增: number; 问题行: number[]; 拒绝理由: string; 教材: string[] }) =>
  v.新增 === 1 &&
  v.问题行.join(",") === "3" &&
  v.拒绝理由.includes("没说清是哪个学科") &&
  v.教材.length === 2 &&
  v.教材.every((id) => id.startsWith("mod_") && id.includes("·")));
/*
 * v33：学生的「来源」（机构原话：「**学生信息里面再添加一个"来源"我自己填写内容**」）。
 *
 * 口径：**获客来源**（这个学生从哪来的：转介绍 / 朋友介绍 / 地推 / 抖音…），
 * **自由文本、机构自己填、不做固定枚举**，**可以留空**。
 * ⚠️ **此来源非彼来源**：教师档案里那个 `source` 是**招聘渠道**（人事口径），
 * 上面第 3 节那几条验的是它 —— 两件事、两处校验，不许合并。见 `PROJECT.md` E19。
 *
 * 这一条走的是**真实 HTTP 写入**，因此验的不只是服务层：落库 → 读回一致，
 * 而且**前后空白被服务端 trim 掉**（脚本故意带空格：人从 Excel 里复制粘贴就是这个样子）。
 */
await check("学生", "建档：带「来源」（v33，获客渠道）", async () => {
  const created = await api.students.create({
    name: "验收来源学生", grade: "初二", guardian: "", status: "在读", note: "",
    // 前后各带几个空格：服务端必须 trim 掉（不是原样存「  朋友介绍  」）
    source: "  朋友介绍  ",
    textbooks: [], profile: {}, enrollments: [],
  });
  const readBack = (await api.students.get(created.id))!;
  const inList = (await api.students.list()).find((item) => item.id === created.id);
  return {
    同一条记录: readBack.id === created.id,
    建档返回值: created.source,
    读回来: readBack.source,
    列表里: inList?.source ?? "（列表里找不到）",
    已去空白: created.source === "朋友介绍" && readBack.source === "朋友介绍",
  };
}, (v: { 同一条记录: boolean; 建档返回值: string; 读回来: string; 列表里: string; 已去空白: boolean }) =>
  v.同一条记录 &&
  v.已去空白 &&
  // 三个出口（建档返回值 / 详情 / 列表）必须读的是同一个值
  v.读回来 === "朋友介绍" &&
  v.列表里 === "朋友介绍");
/*
 * 改一次再读回，顺带验两件事：
 *   ① 编辑那条路走的是**同一个写入闸**（trim 同样生效）；
 *   ② **只改一个字段的 patch 不丢这个字段** —— 页面上点一下改状态，
 *      或在详情里记一条作业，都不该让来源凭空消失。
 */
await check("学生", "来源改一次再读回（且只改别的字段时不丢）", async () => {
  const target = (await api.students.list()).find((item) => item.name === "验收来源学生")!;
  const edited = await api.students.update(target.id, { source: "  地推-校门口  " });
  const afterEdit = (await api.students.get(target.id))!;
  // 只改一个别的字段（状态）：patch 里根本没有 source
  const onlyStatus = await api.students.update(target.id, { status: "暂停" });
  const afterStatus = (await api.students.get(target.id))!;
  return {
    改完返回: edited?.source ?? "",
    改完读回: afterEdit.source,
    改状态之后: afterStatus.source,
    状态也改了: onlyStatus?.status ?? "",
  };
}, (v: { 改完返回: string; 改完读回: string; 改状态之后: string; 状态也改了: string }) =>
  v.改完返回 === "地推-校门口" &&
  v.改完读回 === "地推-校门口" &&
  v.状态也改了 === "暂停" &&
  // 只改状态的那一次不许把来源一起清掉
  v.改状态之后 === "地推-校门口");
/*
 * 建档时就报课（一个学生多门、每门节数各自独立）。
 * 「数学 10 节、英语 20 节」是最常见的报名说法，因此这里同时验两件事：
 * 两门各自的节数不能串（不是并成一条、也不是都记成第一个数），
 * 以及每门都留下一条「报课」流水（账本不能是空的）。
 */
await check("学生", "建档并报多门课（含课时流水）", async () => {
  const created = await api.students.create({
    name: "验收多门学生", grade: "初三", guardian: "", status: "在读", note: "", profile: {},
    enrollments: [
      { subject: "验收科目A", lessons: 10, form: "一对一", teacherId },
      { subject: "验收科目B", lessons: 20, form: "一对二" },
    ],
  });
  const ledgers = await Promise.all(
    created.enrollments.map((item) => api.transactions.listByEnrollment(item.id)),
  );
  return {
    counts: created.enrollments.map((item) => item.totalLessons),
    forms: created.enrollments.map((item) => item.form),
    teachers: created.enrollments.map((item) => item.teacherId === teacherId),
    kinds: ledgers.map((rows) => rows.map((row) => [row.kind, row.delta])),
  };
}, (result: {
  counts: number[];
  forms: string[];
  teachers: boolean[];
  kinds: Array<Array<[string, number]>>;
}) =>
  result.counts.join(",") === "10,20" &&
  // 每门课各自的班型与指定教师都要落对（这是界面上一行一行选出来的）
  result.forms.join("|") === "一对一|一对二" &&
  result.teachers.join(",") === "true,false" &&
  result.kinds.every(
    (rows, index) =>
      rows.length === 1 && rows[0]?.[0] === "报课" && rows[0]?.[1] === (index === 0 ? 10 : 20),
  ));
await check("学生", "信息采集表保存", async () => (await api.students.saveProfile(studentId, { school: "验收中学" }))?.profile.school === "验收中学");
await check("学生", "报课（真实字段 lessons）", async () => {
  const updated = await api.students.enroll(studentId, {
    subject: "围棋", form: "一对一", teacherId, lessons: 4, startedAt: iso(0),
    note: "", unitPrice: 200, agreedAmount: 800, paidNow: 800, method: "微信",
  });
  enrollmentId = updated?.enrollments[0]?.id ?? "";
  return updated?.enrollments[0];
}, (e: { totalLessons: number; paidAmount: number } | undefined) => e?.totalLessons === 4 && e?.paidAmount === 800);
await check("学生", "续费", async () => {
  const updated = await api.students.renewEnrollment(studentId, enrollmentId, 2, "续费", { amount: 400, method: "微信", agreedDelta: 400 });
  return updated?.enrollments[0];
}, (e: { totalLessons: number; paidAmount: number } | undefined) => e?.totalLessons === 6 && e?.paidAmount === 1200);
await check("收费", "记一笔独立退款", async () => {
  await api.payments.record({ studentId, enrollmentId, amount: 100, kind: "退款", method: "微信", note: "验收" });
  const student = await api.students.get(studentId);
  return student?.enrollments[0]?.paidAmount;
}, (paid: number) => paid === 1100);
await check("收费", "退费试算（两种口径）", async () => {
  const student = await api.students.get(studentId);
  const total = student?.enrollments[0]?.totalLessons ?? 0;
  return { total, remaining: total - (student?.enrollments[0]?.usedLessons ?? 0) };
}, (v: { total: number }) => v.total === 6);

/* ── 4.5 按周批量排课（页面上的「按周批量排课」面板走的就是这两个方法）── */
await check("课程安排", "按周批量排课：预检只算不写", async () => {
  const before = (await api.lessons.list()).length;
  const plan = await api.lessons.planSeries({
    subject: "围棋", form: "一对一", teacherId, classroomId, studentIds: [studentId],
    durationMinutes: 60, status: "已排", note: "验收批量排课", startDate: "2027-06-07",
    weekdays: [1], time: "16:00", count: 4,
  });
  return { items: plan.items.length, changed: (await api.lessons.list()).length - before, schedulable: plan.schedulable };
}, (v: { items: number; changed: number; schedulable: number }) =>
  v.items === 4 && v.changed === 0 && v.schedulable === 4);
await check("课程安排", "按周批量排课：写入并跳过冲突", async () => {
  const input = {
    subject: "围棋", form: "一对一", teacherId, classroomId, studentIds: [studentId],
    durationMinutes: 60, status: "已排" as const, note: "验收批量排课", startDate: "2027-06-07",
    weekdays: [1], time: "16:00", count: 4,
  };
  const first = await api.lessons.createSeries(input);
  // 再排一遍：课时已被第一遍占用（封顶），因此这次生成的节数可能变少 —— 断言不变量而不是写死数字
  const secondPlan = await api.lessons.planSeries(input);
  const again = await api.lessons.createSeries(input);
  return {
    created: first.created,
    againCreated: again.created,
    skipped: again.skipped.length,
    planned: secondPlan.items.length,
    schedulable: secondPlan.schedulable,
  };
}, (v: { created: number; againCreated: number; skipped: number; planned: number; schedulable: number }) =>
  // 第一遍排上 4 节；第二遍一节都不重复建，且预检里生成的每一节都被跳过（都撞已有安排）
  v.created === 4 && v.againCreated === 0 && v.schedulable === 0 && v.skipped === v.planned);

/* ── 5 课程安排（排课 / 改课 / 标记已上 / 冲突 / 补课）── */
let lessonId = "";
await check("课程安排", "排课", async () => {
  const created = await api.lessons.create({
    subject: "围棋", form: "一对一", teacherId, classroomId, studentIds: [studentId],
    startsAt: iso(1, 10), durationMinutes: 60, status: "已排", note: "", makeupForLessonId: "",
  });
  lessonId = created.id;
  return created;
}, (l: { id: string }) => l.id !== "");
await check("课程安排", "改课（时间后移 1 小时）", async () => {
  const moved = await api.lessons.update(lessonId, { startsAt: iso(1, 11) });
  return moved?.startsAt;
}, (v: string) => new Date(v).getHours() === 11);
await check("课程安排", "冲突检测（同一教师同一时段）", async () => {
  // LessonInput 是完整课节形状（不是只传几个字段）
  const report = await api.lessons.findConflicts({
    id: "", subject: "围棋", form: "一对一", teacherId, classroomId,
    studentIds: [studentId], startsAt: iso(1, 11), durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "",
  });
  return Array.isArray(report) ? report.length : report;
}, (v: unknown) => (Array.isArray(v) ? v.length > 0 : JSON.stringify(v).length > 2));
await check("课程安排", "课堂记录（提前请假）", async () => api.lessonRecords.save({
  lessonId, studentId, attendance: "请假", leaveRequestedAt: iso(0, 10), focus: "高", interaction: "一般", rating: 4, note: "",
}));
await check("课程安排", "标记已上（不扣课时：提前请假）", async () => (await api.students.get(studentId))?.enrollments[0]?.usedLessons, (n: number | undefined) => n === 0);
/*
 * 这条原先写的是 `(await api.lessons.markCompleted(lessonId)).skipped === false` ——
 * **什么都没断言**：`skipped` 是数组（永远不等于 false），而 `check()` 在没有 `expect`
 * 时只看"抛没抛错"，所以那个 false 被丢掉了。类型检查开起来之后当场暴露。
 *
 * 现在断言真正要验的事：**提前请假 → 一个都没扣**，而且原因写在 skipped 里
 * （`skipped` 不是"失败"，是"这节课没扣课时，以及为什么"）。
 */
await check(
  "课程安排",
  "标记已上：提前请假 → 一个都没扣，且原因写着请假",
  async () => {
    const result = await api.lessons.markCompleted(lessonId);
    return { deducted: result.deducted.length, reasons: result.skipped.map((item) => item.reason).join("；") };
  },
  (v: { deducted: number; reasons: string }) => v.deducted === 0 && v.reasons.includes("请假"),
);
await check("课程安排", "安排补课", async () => {
  const makeup = await api.lessons.createMakeup({
    originalLessonId: lessonId, startsAt: iso(3, 10), durationMinutes: 60,
    teacherId, classroomId, studentIds: [studentId], note: "验收补课",
  });
  return makeup;
}, (m: { makeupForLessonId: string } | null) => m !== null && m.makeupForLessonId === lessonId);
await check("课程安排", "待补课清单", async () => Array.isArray(await api.lessons.pendingMakeups()));
await check("课程安排", "挪课建议", async () => Array.isArray(await api.lessons.suggestMoves(lessonId)));

/* ── 6 日历 / 课表与占用 ── */
/*
 * 月视图读的是**整张月格子**（含前后补齐的天，最长 42 天）—— 与周视图同一个方法
 * （`lessons.listBetween`），但区间大一个量级，因此单独验一条：
 * 区间查询在"一个多月"的跨度上照样回得来（页面上那 42 格不会有一片假空）。
 */
await check("日历", "月视图区间（一个多月）能查到课", async () => {
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const gridStart = new Date(from);
  gridStart.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  const rows = await api.lessons.listBetween(gridStart, gridEnd);
  return [Array.isArray(rows), Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000)];
}, (value: unknown[]) => value[0] === true && (value[1] as number) >= 35);

await check("日历", "按周取课（listBetween）", async () => Array.isArray(await api.lessons.listBetween(new Date(iso(-3)), new Date(iso(10)))));
await check("课表与占用", "按教师取课", async () => (await api.lessons.listByTeacher(teacherId)).length > 0);
await check("课表与占用", "按教室取课", async () => (await api.lessons.listByClassroom(classroomId)).length > 0);
await check("课表与占用", "按日取课", async () => Array.isArray(await api.lessons.listByDate(new Date(iso(1, 11)))));

/* ── 7 咨询 ── */
let inquiryId = "";
await check("咨询", "登记咨询", async () => {
  const created = await api.inquiries.create({
    studentName: "验收咨询", grade: "初三", guardian: "139", subject: "初中数学",
    durationMinutes: 60, intervalWeeks: 1, plannedLessons: 3, startsAt: iso(2, 17),
    candidates: [{ id: "c1", weekday: isoWeekdayOf(new Date(iso(2, 17))), start: "17:00" }],
    preferredTeacherId: teacherId, preferredClassroomId: classroomId, skipDates: [], status: "待确认", note: "",
  });
  inquiryId = created.id;
  return created;
}, (i: { id: string }) => i.id !== "");
await check("咨询", "可行性判定", async () => {
  const report = await api.inquiries.evaluate(inquiryId);
  return { slots: report?.slots?.length ?? 0, anyOk: report?.slots?.some((s) => s.ok) ?? false };
}, (v: { slots: number }) => v.slots > 0);
await check("咨询", "放弃咨询", async () => (await api.inquiries.abandon(inquiryId, "验收结束"))?.status === "已放弃");
/*
 * 回归断言（2026-09-25 那次「验收永不结束」的根因）：
 *
 * 星期几传成 `getDay()` 的 0 时，服务端必须**当场拒绝**，而不是转死自己的事件循环。
 * 卡死时的表现很特别 —— 所有接口（连 `/health`）都不再应答、临时库再无写入、
 * 验收既不报错也不结束。所以这里要断两件事：
 *   ① 这一调被拒，且话里说清「星期几要用 1–7」；
 *   ② 拒绝之后服务端**还活着**（再读一次列表拿得到）—— 真卡死时这一条不会有回应。
 */
let probeInquiryId = "";
await check("咨询", "星期几传 getDay() 的 0：当场拒绝，且服务端不会被它转死", async () => {
  const probe = await api.inquiries.create({
    studentName: "验收咨询（星期几写成 0）", grade: "初三", guardian: "139", subject: "初中数学",
    durationMinutes: 60, intervalWeeks: 1, plannedLessons: 3, startsAt: iso(2, 17),
    candidates: [{ id: "c1", weekday: 0, start: "17:00" }], // 特意写错：0 = getDay() 的周日（正确是 7）
    preferredTeacherId: teacherId, preferredClassroomId: classroomId, skipDates: [], status: "待确认", note: "",
  });
  probeInquiryId = probe.id;
  let rejected = "";
  try {
    await api.inquiries.evaluate(probe.id);
    rejected = "没有被拒绝";
  } catch (cause) {
    rejected = cause instanceof Error ? cause.message : String(cause);
  }
  const stillThere = (await api.inquiries.list()).some((item) => item.id === probe.id);
  return { rejected, stillThere };
}, (v: { rejected: string; stillThere: boolean }) =>
  v.rejected.includes("星期几") && v.rejected.includes("1–7") && v.stillThere);
// 探针用完就按产品口径收尾，别把垃圾留在临时库里（后面的「待跟进」等按状态筛数据）
await check("咨询", "探针咨询收尾（放弃）", async () =>
  (await api.inquiries.abandon(probeInquiryId, "回归探针用完"))?.status === "已放弃");

/* ── 8 统计 / 待跟进 / 今日 ── */
await check("今日概览", "today()", async () => typeof (await api.today()).lessonCount === "number");
await check("统计", "stats(月份)", async () => typeof (await api.stats(new Date())) === "object");
await check("待跟进", "followups()", async () => Array.isArray(await api.followups()));
await check("收费", "finance(月份)", async () => typeof (await api.finance(new Date())) === "object");

/* ── 9 报价 ── */
await check("报价", "读配置", async () => (await api.pricing.get()).stages.length > 0);
/*
 * 给「围棋」定价（用来验"按课程名就能试算"这条链路）。
 *
 * ⚠️ **分组名必须是真实存在的顶级栏目名**（2026-09 口径：报价的分组名 = 网站栏目名，
 * 见 PROJECT.md 的 E15）。这里原先随手编了一个「兴趣才艺」当阶段名 —— 那是**上面**
 * 建栏目时用的名字，而那条栏目后来被 `update` 改过名、围棋也被 `setPartition`
 * 挪走了（再往下围棋本身还被删掉）：编出来的名字与任何一个栏目都对不上。
 * 老口径（分组 = 学段）下这不算错，新口径下它就是一条**错的口径示范** ——
 * 报价页上会因此多出一个课程页上根本不存在的"栏目"。
 *
 * 现在改成用**真实的栏目名**：围棋是兴趣课，放「课外兴趣」；
 * 并顺带断一次"这一组真的是一个顶级栏目"（夹具前提，缺了当场说清而不是静默通过）。
 */
await check("报价", "给课程库的课定价", async () => {
  const current = await api.pricing.get();
  const stages = [...current.stages];
  const column = (await api.coursePartitions.list()).find(
    (item) => item.parentId === "" && item.name === "课外兴趣",
  );
  const columnName = column?.name ?? "";
  if (columnName === "") return "临时库里没有「课外兴趣」这个顶级栏目，验收夹具不对";
  const target = stages.find((s) => s.name === columnName);
  if (target === undefined) {
    stages.push({ name: columnName, courses: [{ name: "围棋", basePrice: 200, available: true, courseId }] });
  } else {
    target.courses.push({ name: "围棋", basePrice: 200, available: true, courseId });
  }
  const saved = await api.pricing.update({ ...current, stages });
  // 顺带验新口径：围棋那一组的组名就是它挂的那个顶级栏目名
  const group = saved.stages.find((s) => s.courses.some((course) => course.name === "围棋"));
  return group?.name === columnName && saved.stages.some((s) => s.name === columnName);
}, (ok: boolean) => ok === true);
await check("报价", "试算（含新定价的课）", async () => (await api.pricing.quote({
  courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5,
})).ok);
await check("报价", "教师课时费", async () => (await api.pricing.teacherFee({
  courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5, students: 1,
})).ok);
await check("报价", "导出 Markdown", async () => (await api.pricing.exportMarkdown()).includes("学习阶段"));
/*
 * v29 之后的三条新口径（对着**真实库**验，不看类型）：
 *   1. 配置里不再有 `subjects` 这一维（迁移会把老库那个字段删掉）；
 *   2. `pricing.quote` **不接受科目也能算出价** —— 参数里压根没有科目这一项；
 *   3. 教师课时费的「课程单价」= **基础价**（不再乘任何系数）。
 * 顺带验导出里不再写 `#### 科目:`：机构替换内容文件时不会带回去一行没人读的条目。
 */
await check("报价", "配置里没有 subjects（科目那一维已删）", async () =>
  Object.keys(await api.pricing.get()).filter((key) => key === "subjects"), (keys: string[]) => keys.length === 0);
await check("报价", "导出里不再有「#### 科目:」那一行", async () =>
  (await api.pricing.exportMarkdown()).includes("#### 科目"), (found: boolean) => found === false);
await check("报价", "不带科目也能算价（新公式：基础价 × 人数系数 × 时长）", async () => {
  const pricing = await api.pricing.get();
  const stage = pricing.stages.find((item) => item.courses.some((course) => course.available));
  const course = stage?.courses.find((item) => item.available);
  const oneToOne = pricing.classTypes.find((item) => item.name === "一对一");
  const quote = await api.pricing.quote({
    courseName: course?.name ?? "",
    classTypeName: "一对一",
    durationName: pricing.durations[0]?.name ?? "",
    lessons: 5,
  });
  // 一对一的人数系数是 1，因此课单价应当**正好等于基础价 × 时长**（课上到几小时就乘几）
  const hours = pricing.durations[0]?.hours ?? 1;
  return [quote.ok, quote.unitPrice, (course?.basePrice ?? 0) * hours * (oneToOne?.coefficient ?? 1)];
}, (value: [boolean, number, number]) =>
  value[0] === true && Math.abs(value[1] - value[2]) < 0.01);
await check("报价", "教师课时费的「课程单价」就是基础价", async () => {
  const pricing = await api.pricing.get();
  const stage = pricing.stages.find((item) => item.courses.some((course) => course.available));
  const course = stage?.courses.find((item) => item.available);
  const fee = await api.pricing.teacherFee({
    courseName: course?.name ?? "",
    classTypeName: "一对一",
    durationName: pricing.durations[0]?.name ?? "",
    lessons: 5,
    students: 1,
  });
  return [fee.ok, fee.hourlyPrice, course?.basePrice ?? 0];
}, (value: [boolean, number, number]) =>
  value[0] === true && Math.abs(value[1] - value[2]) < 0.01);
/*
 * 班型的名称只有一个真源（课程类型的维度表，v25）：
 * 在「课程类型」里改个名，报价读出来、按新名字试算、导出 Markdown 三处都要跟着变。
 * 收尾把名字改回去（这是机构自己的库）。
 */
const formatRenamed = await (async () => {
  const catalog = await api.catalog.list();
  const target = catalog.formats.find((item) => item.name === "一对三");
  if (target === undefined) return null;
  const draft = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  draft.formats.find((item) => item.id === target.id)!.name = "一对三（验收改名）";
  await api.catalog.save(draft);
  return { id: target.id, original: target.name };
})();
await check("报价", "班型改名之后报价里读到的是新名字（名称以课程类型为准）", async () => {
  if (formatRenamed === null) return "没有一对三";
  const pricing = await api.pricing.get();
  return pricing.classTypes.map((item) => item.name);
}, (names: string[]) => names.includes("一对三（验收改名）"));
await check("报价", "按新名字试算算得出来（改名最容易漏的一处）", async () => {
  if (formatRenamed === null) return false;
  const pricing = await api.pricing.get();
  const stage = pricing.stages.find((item) => item.courses.some((course) => course.available));
  const course = stage?.courses.find((item) => item.available);
  // 试算只发课程 / 班型 / 时长 / 节数 —— 科目那一维 v29 删掉了，这里连传的地方都没有
  const quote = await api.pricing.quote({
    courseName: course?.name ?? "",
    classTypeName: "一对三（验收改名）",
    durationName: pricing.durations[0]?.name ?? "",
    lessons: 10,
    studentCount: 1,
    classCost: 0,
  });
  return quote.ok;
});
await check("报价", "导出的 Markdown 用的是维度表里的名字", async () => {
  if (formatRenamed === null) return false;
  return (await api.pricing.exportMarkdown()).includes("一对三（验收改名）");
});
await check("报价", "只接受课程类型里存在的班型", async () => {
  const current = await api.pricing.get();
  const broken = JSON.parse(JSON.stringify(current)) as typeof current;
  broken.classTypes[0]!.formatId = "fmt_不存在";
  try {
    await api.pricing.update(broken);
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("已经不存在了") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("报价", "改回原名（收尾）", async () => {
  if (formatRenamed === null) return false;
  const catalog = await api.catalog.list();
  const draft = JSON.parse(JSON.stringify(catalog)) as typeof catalog;
  draft.formats.find((item) => item.id === formatRenamed.id)!.name = formatRenamed.original;
  await api.catalog.save(draft);
  const pricing = await api.pricing.get();
  return pricing.classTypes.some((item) => item.name === formatRenamed.original);
});

/* ── 10 数据与备份 / 搜索 / 日志 ── */
await check("数据与备份", "导出全部数据", async () => (await api.exportDatabase()).students.length > 0);
// 批量导入（页面上的「批量导入」面板走的就是这个方法）
/*
 * v31 收紧后「校区」是**必填列**，因此这两条导入夹具也要带上校区列
 * （不带的话行校验会拒掉它们，断言会红 —— 而那是**对的**，不该为了让用例通过而放宽必填）。
 */
await check("数据与备份", "批量导入：CSV 导入教室", async () => {
  const csv = [
    "名称,用途,校区,容量,备注",
    "验收教室A,上课用教室,验收校区,6,批量导入自检",
    "验收教室B,自习室,验收校区,4,",
  ].join("\r\n");
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv, fileName: "验收.csv" });
  return { ok: outcome.ok, added: outcome.added };
}, (v: { ok: boolean; added: number }) => v.ok && v.added === 2);
await check("数据与备份", "批量导入：重复导入不重复加", async () => {
  const csv = "名称,用途,校区,容量,备注\r\n验收教室A,上课用教室,验收校区,6,批量导入自检\r\n";
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv });
  return { added: outcome.added, skipped: outcome.skipped.length };
}, (v: { added: number; skipped: number }) => v.added === 0 && v.skipped === 1);
/*
 * 「先拆后判」的真实验收（v31 收紧，机构原话「校区必须填」）。
 *
 * 这一份 CSV **只有「名称」一列** —— 就是老表那种写法（名字里带着「校区·教室名」）。
 * 判据必须落在**拆分之后**：拆出来的校区让每一行都通过，一条都不许拒。
 * 判在拆分之前的话，这份名单会被**整份拒掉**，而它本来是能导的
 * （"把旧表再导一次"正是机构最常做的事）。
 */
await check("数据与备份", "批量导入：只写名称列的旧名单（名字里带「·」）先拆后过", async () => {
  const csv = [
    "名称,用途",
    "沐阳教育·验收旧表教室1,上课用教室",
    "全慧教育·验收旧表教室2,自习室",
  ].join("\r\n");
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv, fileName: "验收旧表.csv" });
  const rooms = await api.classrooms.list();
  const one = rooms.find((room) => room.name === "验收旧表教室1");
  const two = rooms.find((room) => room.name === "验收旧表教室2");
  return {
    added: outcome.added,
    problems: outcome.problems.length,
    one: [one?.campus, one?.name],
    two: [two?.campus, two?.name],
  };
}, (v: { added: number; problems: number; one: string[]; two: string[] }) =>
  v.added === 2 && v.problems === 0 &&
  v.one.join("|") === "沐阳教育|验收旧表教室1" &&
  v.two.join("|") === "全慧教育|验收旧表教室2");
await check("数据与备份", "批量导入：JSON 导入教师", async () => {
  const json = JSON.stringify([{ name: "验收老师甲", subjects: ["初中数学"], role: "授课教师", active: true }]);
  const outcome = await api.imports.apply({ entity: "teachers", text: json });
  const created = (await api.teachers.list()).find((teacher) => teacher.name === "验收老师甲");
  return { added: outcome.added, subjects: created?.subjects ?? [] };
}, (v: { added: number; subjects: string[] }) => v.added === 1 && v.subjects.length === 1);
await check("数据与备份", "批量导入：冲突先体检、不写入", async () => {
  const before = (await api.teachers.list()).length;
  const csv = "姓名,职务\r\n验收老师甲,改过的职务\r\n";
  const asked = await api.imports.apply({ entity: "teachers", text: csv, onConflict: "ask" });
  return { needsDecision: asked.needsDecision, changed: (await api.teachers.list()).length - before, conflicts: asked.conflicts.length };
}, (v: { needsDecision: boolean; changed: number; conflicts: number }) =>
  v.needsDecision === true && v.changed === 0 && v.conflicts === 1);
await check("数据与备份", "批量导入：覆盖 / 跳过 / 保留两份", async () => {
  const csv = "姓名,职务\r\n验收老师甲,新职务\r\n";
  const overwritten = await api.imports.apply({ entity: "teachers", text: csv, onConflict: "overwrite" });
  const role = (await api.teachers.list()).find((t) => t.name === "验收老师甲")?.role;
  const skipped = await api.imports.apply({ entity: "teachers", text: csv });
  const duplicated = await api.imports.apply({ entity: "teachers", text: csv, onConflict: "duplicate" });
  const hasCopy = (await api.teachers.list()).some((t) => t.name === "验收老师甲（2）");
  return { overwritten: overwritten.overwritten, role, skipped: skipped.skipped.length, duplicated: duplicated.duplicated, hasCopy };
}, (v: { overwritten: number; role?: string; skipped: number; duplicated: number; hasCopy: boolean }) =>
  v.overwritten === 1 && v.role === "新职务" && v.skipped === 1 && v.duplicated === 1 && v.hasCopy);
/*
 * 「从网站导入教师资料」已经删掉（机构口径：现在都以后端为主，与 v32 删掉课程那两个同理）。
 * 它当年覆盖的**三条口径仍然要验**：AI 智能体也在档案里、带着资料、且**不进排课下拉**。
 *
 * 现在改走**那条保留下来的正路**（批量导入 CSV）来造这条记录 —— 这样这一项验的是
 * "AI 智能体在系统里的口径"，而不是"某个已经删掉的按钮还能不能点"。
 */
await check("数据与备份", "AI 智能体：批量导入后在档案里、带资料、不进排课下拉", async () => {
  const csv =
    "姓名,职务,可带科目,类型,一句话简介,详细介绍\r\n" +
    "验收AI助手,试课诊断,全科诊断,AI,验收用的一句话,验收用的一段详细介绍\r\n";
  const outcome = await api.imports.apply({ entity: "teachers", text: csv });
  const teachers = await api.teachers.list();
  const schedulable = await api.teachers.listActive();
  const ai = teachers.filter((teacher) => teacher.kind === "AI");
  return {
    added: outcome.added,
    aiCount: ai.length,
    aiHasProfile: ai.every((teacher) => teacher.bio !== "" && teacher.summary !== ""),
    aiSchedulable: schedulable.some((teacher) => teacher.kind === "AI"),
  };
}, (v: { added: number; aiCount: number; aiHasProfile: boolean; aiSchedulable: boolean }) =>
  v.added === 1 && v.aiCount >= 1 && v.aiHasProfile && v.aiSchedulable === false);
await check("数据与备份", "批量导入：缺少必填列时拒绝且不写入", async () => {
  const before = (await api.classrooms.list()).length;
  const outcome = await api.imports.apply({ entity: "classrooms", text: "房间名,容量\r\n漏了表头,6\r\n" });
  return { ok: outcome.ok, changed: (await api.classrooms.list()).length - before };
}, (v: { ok: boolean; changed: number }) => v.ok === false && v.changed === 0);

/* ── 10.5 每天自动备份：机构「先做 1：备份能在后台恢复」────────────────────────
 *
 * ## 为什么这件事必须在**真实后端**上验收
 *
 * 「清单」与「恢复」都要**读写服务端机器上的文件**（`server/backups/`），因此它们
 * 在内存伪后端上根本跑不了（`available: false`）—— 那是这一页唯一"必须在后端上才成立"
 * 的功能。断言的是端到端那一条链：
 *
 *   造一份备份 → 改坏当前数据 → 恢复 → **逐条比对回到备份那一刻** → 另存的那一份存在且能被再恢复
 *
 * ## 绝不碰 `server/backups/`
 *
 * 备份目录用**这次临时服务的一次性临时目录**（`accept-run.mts` 通过
 * `NEXGENEDU_BACKUP_DIR` 同时交给服务端与本脚本）。真实的 `server/backups/` 里
 * 每一份都是机构的退路，验收碰一下都不行 —— 这句纪律靠"指向同一个临时目录"落地，
 * 而不是靠"记得别写"。
 */
const acceptBackupDir = process.env.NEXGENEDU_BACKUP_DIR ?? "";
const acceptBackupFiles = createNodeDailyBackupFiles({
  dir: acceptBackupDir,
  snapshotKey: SNAPSHOT_KEY,
  schemaVersion: listMigrations().at(-1)?.version ?? 0,
});
const acceptKeeperName = "验收·恢复前就有的学生";
let acceptKeeperId = "";
let acceptBackupName = "";
let acceptSpoiledId = "";
/** **备份那一刻**的学生姓名清单（恢复之后要逐条对回来的就是它）。 */
let acceptNamesAtBackup = "";

await check("数据与备份", "每天自动备份：清单读得出来，而且看的就是临时备份目录", async () => {
  const list = await api.dailyBackups.list();
  return { available: list.available, dir: list.dir, reason: list.reason };
}, (v: { available: boolean; dir: string; reason: string }) =>
  v.available === true && v.dir === acceptBackupDir);

await check("数据与备份", "每天自动备份：造一份夹具备份（内容 = 现在这一刻的库）", async () => {
  const keeper = await api.students.create({
    name: acceptKeeperName, grade: "初二", guardian: "138-0000-9999",
    status: "在读", note: "验收夹具（每天自动备份）", profile: {},
  });
  acceptKeeperId = keeper.id;
  acceptNamesAtBackup = JSON.stringify((await api.students.list()).map((item) => item.name));
  const snapshot = JSON.stringify(await api.exportDatabase());
  acceptBackupName = acceptBackupFiles.writeSnapshot(snapshot);
  const list = await api.dailyBackups.list();
  const entry = list.files.find((item) => item.name === acceptBackupName);
  return { name: acceptBackupName, problem: entry?.problem ?? "不在清单里", students: entry?.counts?.students ?? -1 };
}, (v: { name: string; problem: string; students: number }) =>
  v.problem === "" && v.students > 0);

await check("数据与备份", "每天自动备份：未确认时恢复被拒，而且什么都不发生", async () => {
  const before = (await api.students.list()).length;
  const result = await api.dailyBackups.restore(acceptBackupName, { confirmed: false });
  return { ok: result.ok, changed: (await api.students.list()).length - before, error: result.ok === false ? result.error : "" };
}, (v: { ok: boolean; changed: number; error: string }) =>
  v.ok === false && v.changed === 0 && v.error.includes("二次确认"));

await check("数据与备份", "每天自动备份：改坏之后再恢复，库里逐条回到备份那一刻", async () => {
  const spoiled = await api.students.create({
    name: "验收·恢复后该消失的学生", grade: "高一", guardian: "138-0000-8888",
    status: "在读", note: "验收夹具（每天自动备份）", profile: {},
  });
  acceptSpoiledId = spoiled.id;
  const result = await api.dailyBackups.restore(acceptBackupName, { confirmed: true });
  /*
   * ⚠️ **恢复成功 = 所有人的会话被作废**（E22 续，机构原话：「恢复后让所有人重新登录」）——
   * 验收脚本手上那个令牌立刻失效。因此这里**重新登录一次**再往下比对：
   * 少了这一步，下面每一条断言都会变成 401「登录已过期」，而那种红会让人以为是恢复坏了。
   *
   * 刻意**不**为了用例能过去掉"作废会话"（那等于把机构要的安全性质删掉），
   * 也不改成"用另外的账号"糊过去 —— 重新登录才是真实使用里发生的那件事。
   */
  forgetScriptLogin();
  if (result.ok === false) return { error: result.error };
  const names = JSON.stringify((await api.students.list()).map((item) => item.name));
  const list = await api.dailyBackups.list();
  return {
    error: "",
    // 逐条比对（不是"看起来像"）：姓名清单与备份那一刻**逐字相同**
    names,
    namesAtBackup: acceptNamesAtBackup,
    preRestore: result.preRestore,
    preRestoreInList: list.files.some((item) => item.name === result.preRestore && item.problem === ""),
    note: result.note,
    reloginRequired: result.reloginRequired,
    sessionsCleared: result.sessionsCleared,
    counts: JSON.stringify(result.after) === JSON.stringify(result.before) ? "竟然一样" : "变了（对的）",
  };
}, (v: { error: string; names: string; namesAtBackup: string; preRestoreInList: boolean; note: string; counts: string; reloginRequired: boolean; sessionsCleared: number }) =>
  v.error === "" &&
  v.names === v.namesAtBackup &&
  v.names.includes("验收·恢复前就有的学生") &&
  v.names.includes("验收·恢复后该消失的学生") === false &&
  v.preRestoreInList === true &&
  v.counts === "变了（对的）" &&
  v.note.includes("现在用的是") &&
  /*
   * ② 机构点的那一条：恢复成功之后**所有人都要重新登录**（包括点这一下的人），
   * 而返回里必须带上这句话与作废的会话数 —— 界面据此给出明确提示、把人送去登录页。
   */
  v.reloginRequired === true &&
  v.sessionsCleared >= 1 &&
  v.note.includes("所有人都需要重新登录"));

await check("数据与备份", "每天自动备份：恢复写了操作日志（从哪个文件、多少条 → 多少条）", async () => {
  const logs = await api.logs.list(50);
  const record = logs.find((item) => item.action === "恢复每日备份");
  return { found: record !== undefined, summary: record?.summary ?? "", target: record?.targetId ?? "" };
}, (v: { found: boolean; summary: string; target: string }) =>
  v.found === true && v.target === acceptBackupName && v.summary.includes("→") && v.summary.includes(acceptBackupName));

await check("数据与备份", "收尾：删掉这一节的夹具学生", async () => {
  for (const id of [acceptKeeperId, acceptSpoiledId]) {
    if (id === "") continue;
    // 恢复已经把"改坏"那个学生删掉了（它不在备份里），因此这里删不到是正常的
    await api.students.remove(id).catch(() => false);
  }
  // 只数**这一节**那两个夹具（验收别处也造了「验收·」开头的记录，不能一起数）
  return (await api.students.list()).filter(
    (item) => item.name === acceptKeeperName || item.name === "验收·恢复后该消失的学生",
  ).length;
}, (v: number) => v === 0);

/* ── 10.6 「立刻备份一份」与「升级前快照」（机构当场点的另两条）──────────────────
 *
 * 机构原话：
 *   > ① 「**也纳入界面 + 加上限（推荐）**」 —— 那 99 份「升级前快照」也要能在界面上
 *   >    看见并恢复，并给它们一个保留份数上限；
 *   > ③ 「**加『立刻备份一份』按钮**」。
 *
 * 为什么这两条也要在**真实后端**上验收：它们碰的都是**服务端机器上的文件**
 * （生成一份新备份 / 读一份升级前快照并整库恢复），在内存伪后端上根本跑不了
 * （`available: false`）。验收在这里验的是"用户点那两下真的会发生什么"：
 * 目录里多/少一份、清单前后对照、以及**恢复之后所有人被踢下线**这一条副作用。
 *
 * ⚠️ 与 §10.5 同一条纪律：备份目录一律是**这次临时服务的一次性临时目录**
 * （`accept-run.mts` 通过 `NEXGENEDU_BACKUP_DIR` 同时交给服务端与脚本），
 * **绝不碰 `server/backups/`**。
 */

await check("数据与备份", "立刻备份一份：点完目录真的多一份，而且已有的备份一份没动", async () => {
  const before = await api.dailyBackups.list();
  const beforeNames = before.files.map((item) => item.name);
  const result = await api.dailyBackups.takeNow();
  if (result.ok === false) return { error: result.error };
  const after = await api.dailyBackups.list();
  const afterNames = after.files.map((item) => item.name);
  return {
    error: "",
    file: result.file,
    // 新那一份确实在清单里（命名规则认得出它）
    inList: afterNames.includes(result.file),
    // 清单里原来那些**一份都没少**（这一步只该"多一份"，不该删谁）
    missing: beforeNames.filter((name) => !afterNames.includes(name)),
    added: afterNames.filter((name) => !beforeNames.includes(name)),
    // 新那一份是「每日备份」这一类（不是升级前快照）
    kind: after.files.find((item) => item.name === result.file)?.kind ?? "不在清单里",
    // 读得出摘要（用户点它就能恢复）
    readable: after.files.find((item) => item.name === result.file)?.problem === "",
    removed: result.removed,
    note: result.note,
  };
}, (v: { error: string; file: string; inList: boolean; missing: string[]; added: string[]; kind: string; readable: boolean; removed: string[]; note: string }) =>
  v.error === "" &&
  v.file.startsWith("nexgenedu-") &&
  v.inList === true &&
  v.missing.length === 0 &&
  v.added.length === 1 &&
  v.added[0] === v.file &&
  v.kind === "daily" &&
  v.readable === true &&
  v.removed.length === 0 &&
  v.note.includes(v.file));

await check("数据与备份", "立刻备份一份：写了操作日志（谁手动备了一份）", async () => {
  const logs = await api.logs.list(20);
  const record = logs.find((item) => item.action === "立刻备份");
  return { found: record !== undefined, target: record?.targetId ?? "" };
}, (v: { found: boolean; target: string }) => v.found === true && v.target.startsWith("nexgenedu-"));

/*
 * 「升级前快照」：机构要的"升级出问题我自己能退"。
 *
 * 夹具刻意用**当前库这一份**（名字换成 `nexgenedu-migrate-<时间戳>.db`）：
 * 这样"恢复它"这一步在数据上是幂等的（内容与现在完全一样），验收不会因为
 * 一次整库替换把后面几节依赖的数据弄乱；而"这一类文件能不能被清单认出来、
 * 能不能恢复、恢复之后会不会踢人"这三件事全都验到了。
 * （"版本比当前旧要沿迁移链升上来"那条正常路径由 `npm run check` 第 54 节正面覆盖 ——
 * 那里用一份**真的 v1 老结构**快照，验收这边不必再造一份老库。）
 */
const acceptMigrateName = migrationBackupName(new Date(2022, 4, 5, 6, 7, 8, 9));
if (acceptBackupDir !== "") {
  // `acceptBackupDir` 为空说明这一轮没拿到临时备份目录（正常用 `npm run accept` 一定有）：
  // 那时**不要**去建文件（会落到一个来路不明的路径上），让下面那几条断言如实报"不在清单里"。
  const snapshot = JSON.stringify(await api.exportDatabase());
  const raw = new SqliteDatabase(`${acceptBackupDir}/${acceptMigrateName}`);
  try {
    raw.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    raw.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(SNAPSHOT_KEY, snapshot);
  } finally {
    raw.close();
  }
}

await check("数据与备份", "升级前快照：也在清单里，类型标识是「升级前快照」，摘要读得出来", async () => {
  const list = await api.dailyBackups.list();
  const entry = list.files.find((item) => item.name === acceptMigrateName);
  return {
    found: entry !== undefined,
    kind: entry?.kind ?? "没有这一项",
    problem: entry?.problem ?? "没有这一项",
    students: entry?.counts?.students ?? -1,
    keepMigrate: list.keep.migrate,
    keepDaily: list.keep.daily,
  };
}, (v: { found: boolean; kind: string; problem: string; students: number; keepMigrate: number; keepDaily: number }) =>
  v.found === true && v.kind === "migrate" && v.problem === "" && v.students >= 0 &&
  // 保留份数由服务端给（界面不写死）：升级前快照 10 份、每日备份 90 份
  v.keepMigrate === 10 && v.keepDaily === 90);

await check("数据与备份", "升级前快照：点「恢复这一份」真的能退回去，而且所有人都要重新登录", async () => {
  const namesBefore = JSON.stringify((await api.students.list()).map((item) => item.id));
  const result = await api.dailyBackups.restore(acceptMigrateName, { confirmed: true });
  /*
   * ⚠️ 恢复成功 = 会话被整体作废（包括验收自己）：先重新登录，再往下比对与收尾。
   * 这一句与 §10.5 里那一句是同一件事的两处（很容易漏 —— 漏了后面全变 401）。
   */
  forgetScriptLogin();
  if (result.ok === false) return { error: result.error };
  const namesAfter = JSON.stringify((await api.students.list()).map((item) => item.id));
  return {
    error: "",
    kind: result.kind,
    // 恢复的是"当前库这一份"，因此数据逐条没变 —— 这正好证明恢复这条路走通了
    unchanged: namesBefore === namesAfter,
    reloginRequired: result.reloginRequired,
    note: result.note,
    preRestore: result.preRestore,
  };
}, (v: { error: string; kind: string; unchanged: boolean; reloginRequired: boolean; note: string; preRestore: string }) =>
  v.error === "" &&
  v.kind === "migrate" &&
  v.unchanged === true &&
  v.reloginRequired === true &&
  v.note.includes("退回升级前") &&
  v.note.includes("所有人都需要重新登录") &&
  v.note.includes(v.preRestore));

/*
 * ── 节假日（后台「节假日」页）────────────────────────────────────────────────
 *
 * 这一页走的不是 `api.*`，而是服务端自己的两条路由（`GET /api/holidays`、
 * `POST /api/holidays/refresh`）—— 与账号管理同一类，因此**必须单独验收**：
 * 光验 `api.*` 永远碰不到它们。
 *
 * 令牌：这张表要登录，而验收脚本没有登录界面 —— 用运行器给的账号在**这一次**里
 * 换一个令牌（与 `lib/backend/remote.ts` 的做法一致），不依赖任何浏览器存储。
 *
 * ⚠️ **这里只读**：临时后端没有设 `NEXGENEDU_HOLIDAY_DIR`，所以它读的就是仓库里那份
 * `data/holidays/*.json`（顺带验收了"进仓库的那份数据本身是通过校验的"）。
 * 因此**不要在这里调 `POST /api/holidays/refresh`** —— 那会把抓取结果写进仓库。
 * 抓取链路的行为覆盖在 `scripts/check.mts` 第 16 节（用注入的替身网络 + 临时目录）。
 */
const holidayToken = await (async (): Promise<string> => {
  const response = await fetch(`${remoteBase()}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.NEXGENEDU_ADMIN_USER ?? "",
      password: process.env.NEXGENEDU_ADMIN_PASSWORD ?? "",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { token?: unknown };
  return typeof body.token === "string" ? body.token : "";
})();
const holidayRoute = async (path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${remoteBase()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${holidayToken}` },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body };
};

await check("节假日", "换到令牌（否则下面几条验的是 401）", async () => holidayToken !== "");
await check(
  "节假日",
  "读表：年份、逐日表、校验结论都在",
  async () => {
    const { status, body } = await holidayRoute("/api/holidays");
    const view = (body.view ?? {}) as Record<string, unknown>;
    const years = (view.years ?? []) as Array<{ year: number; days: unknown[]; verdict: { agree: boolean } }>;
    return {
      status,
      ok: body.ok,
      年份数: years.length,
      每一天都有: years.every((item) => item.days.length > 0),
      全部通过校验: years.every((item) => item.verdict.agree === true),
      坏文件: (view.errors ?? []) as unknown[],
    };
  },
  (v: { status: number; ok: unknown; 年份数: number; 每一天都有: boolean; 全部通过校验: boolean; 坏文件: unknown[] }) =>
    v.status === 200 && v.ok === true && v.年份数 > 0 && v.每一天都有 && v.全部通过校验 && v.坏文件.length === 0,
);
await check(
  "节假日",
  "路径写错时给一句能照着改的话（而不是含混的 403）",
  async () => (await holidayRoute("/api/holidays", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
  (v: number) => v === 405,
);
await check("搜索", "全局搜索命中学生", async () => (await api.search("验收")).length > 0);
await check("日志", "操作日志有记录", async () => (await api.logs.list(50)).length > 0);

/* ── 11 寒暑假段（「日历」页「假期与作息」页签）── */
/*
 * 机构口径：寒暑假起止**每年手动录入**（按学段），落在段内的每一天按假期作息
 * （＝周末那一组时段）。这一节走真实 HTTP：读 → 存两段 → 校验被拒 → 读回来一致 → 收尾清空。
 */
const vacationsBefore = await api.vacations.list();
await check("寒暑假", "读寒暑假段（初始为空或已有）", async () => Array.isArray(vacationsBefore));
await check("寒暑假", "存两段（寒假 + 暑假，按学段）", async () => {
  const catalog = await api.catalog.list();
  const stageId = catalog.stages[0]?.id ?? "";
  const saved = await api.vacations.save([
    { id: "vac-accept-1", name: "寒假", kind: "寒假", stageIds: [stageId], startDate: "2026-01-20", endDate: "2026-02-25", note: "验收用" },
    { id: "vac-accept-2", name: "暑假", kind: "暑假", stageIds: [stageId], startDate: "2026-07-06", endDate: "2026-08-31", note: "验收用" },
  ]);
  return saved.map((item) => item.name);
}, (names: string[]) => names.join("|") === "寒假|暑假");
await check("寒暑假", "读回来一致（真的落库了）", async () => {
  const rows = await api.vacations.list();
  return rows.map((item) => `${item.name} ${item.startDate}~${item.endDate}`);
}, (rows: string[]) => rows.length === 2 && rows[1] === "暑假 2026-07-06~2026-08-31");
await check("寒暑假", "起止写反会被拒（不是静默保存）", async () => {
  const catalog = await api.catalog.list();
  const stageId = catalog.stages[0]?.id ?? "";
  try {
    await api.vacations.save([
      { id: "vac-bad", name: "写反了", kind: "其他", stageIds: [stageId], startDate: "2026-05-01", endDate: "2026-01-01", note: "" },
    ]);
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("早于开始日期") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("寒暑假", "没勾学段也会被拒", async () => {
  try {
    await api.vacations.save([
      { id: "vac-nostage", name: "没学段", kind: "其他", stageIds: [], startDate: "2026-01-01", endDate: "2026-01-10", note: "" },
    ]);
    return "没有被拒绝";
  } catch (cause) {
    return cause instanceof Error && cause.message.includes("没有勾学段") ? "已拒绝" : cause;
  }
}, (text: string) => text === "已拒绝");
await check("寒暑假", "保存写了操作日志", async () => {
  const logs = await api.logs.list();
  return logs.some((item) => item.entity === "寒暑假");
});
await check("寒暑假", "收尾：回到验收前的状态", async () => api.vacations.save(vacationsBefore), (rows: unknown[]) => rows.length === vacationsBefore.length);

/* ── 11.5 排课串：「仅此一次 / 此后所有」（v34）── */
/*
 * 机构原话：「**再添加一个可以取消/修改单次排课和取消/修改该学生后续所有排课，
 * 相当于就是 Apple 日历功能的全部复刻**」。
 *
 * 这一节是**真实后端上的完整读写一遍**（逐页验收的意义就在这里）：
 *   建一串 → 「此后所有」整体平移时间 → **逐条读回比对** → 标一节「已上」再改一遍
 *   （已上必须逐字节不动）→ 取消其中一节 → 再读回 → 冲突时**整体拒绝且零写入**。
 * 数据用**这一节自己造的**学生 / 老师 / 一串课（科目「验收串课」是新的，
 * 因此"同一学生 + 同一科目 + 同一班型"圈出来的只有这一串，断言不受别处的夹具干扰）。
 *
 * 收尾走测试后端的夹具通道（`/api/test-hooks/remove-fixture`）：这一串里有一节
 * 已经「已上」、扣过课时，按产品规矩（"有账就不许删"）本来就删不掉 ——
 * 那条护栏是对的，因此这里绕的是测试那一道门，而不是放宽产品规矩。
 */
const seriesRunToken = await (async (): Promise<string> => {
  const response = await fetch(`${remoteBase()}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.NEXGENEDU_ADMIN_USER ?? "",
      password: process.env.NEXGENEDU_ADMIN_PASSWORD ?? "",
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { token?: unknown };
  return typeof body.token === "string" ? body.token : "";
})();
const removeFixture = async (entity: string, id: string): Promise<boolean> => {
  const response = await fetch(`${remoteBase()}/api/test-hooks/remove-fixture`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${seriesRunToken}` },
    body: JSON.stringify({ entity, id }),
  });
  const body = (await response.json().catch(() => ({}))) as { removed?: unknown };
  return response.ok && body.removed === true;
};

const seriesStudent = await api.students.create({
  name: "验收排课串学生", grade: "初二", guardian: "", status: "在读", note: "", profile: {},
  /*
   * 科目用**既有的「围棋」**：验收那位老师登记的可带科目就是「围棋 / 初中数学」
   * （科目对不上时每一节都会被判「教师未登记这门科目」而跳过 —— 第一版就踩了这个）。
   * 学生是**新造的**，因此"同一学生 + 同一科目 + 同一班型"圈出来的只有这一串，
   * 与 4.5 / 5 那几节围棋课（别的学生）不会互相干扰。
   */
  enrollments: [{ subject: "围棋", lessons: 12 }],
});
const seriesFixtureLessonIds: string[] = [];
const seriesTeacher = await api.teachers.create({
  name: "验收串老师", subjects: [], role: "", phone: "", active: true, years: "",
  summary: "", bio: "", recommendation: "", order: 999, siteVisible: false,
  origin: "后台", kind: "教师", employment: "", source: "",
});
const seriesInput = {
  subject: "围棋", form: "一对一", teacherId, classroomId,
  studentIds: [seriesStudent.id], durationMinutes: 60, status: "已排" as const,
  note: "验收排课串", startDate: "2027-09-06", weekdays: [1], time: "14:00", count: 4,
};
const loadSeries = async () =>
  (await api.lessons.listByStudent(seriesStudent.id))
    .filter((lesson) => lesson.seriesId !== "")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

await check("排课串", "建一串：四节课带同一个串身份（真实 HTTP 写入）", async () => {
  const outcome = await api.lessons.createSeries(seriesInput);
  const rows = await loadSeries();
  for (const lesson of rows) seriesFixtureLessonIds.push(lesson.id);
  return { created: outcome.created, seriesId: outcome.seriesId, rows: rows.length, ids: [...new Set(rows.map((l) => l.seriesId))] };
}, (v: { created: number; seriesId: string; rows: number; ids: string[] }) =>
  v.created === 4 && v.rows === 4 && v.ids.length === 1 && v.ids[0] === v.seriesId && v.seriesId.startsWith("s_"));

await check("排课串", "此后所有：整体平移时间 → 逐条读回比对", async () => {
  const before = await loadSeries();
  const anchor = before[0]!;
  const shifted = new Date(new Date(anchor.startsAt).getTime() + 2 * 86_400_000).toISOString();
  const outcome = await api.lessons.updateSeries({
    lessonId: anchor.id,
    scope: "following",
    patch: { startsAt: shifted },
  });
  const after = await loadSeries();
  return {
    changed: outcome.changed.length,
    // 逐条比对：每一节的新时间都必须**正好**是原来的 +2 天（整体平移，不是都设成同一时刻）
    deltas: before.map((lesson, index) =>
      Math.round((new Date(after[index]!.startsAt).getTime() - new Date(lesson.startsAt).getTime()) / 86_400_000),
    ),
    versions: after.map((lesson) => lesson.version),
  };
}, (v: { changed: number; deltas: number[]; versions: number[] }) =>
  v.changed === 4 && v.deltas.join(",") === "2,2,2,2" && v.versions.every((n) => n >= 2));

await check("排课串", "「已上」的课是账：改「此后所有」时逐字节不动，而且报出来", async () => {
  const rows = await loadSeries();
  const past = rows[1]!;
  await api.lessons.markCompleted(past.id);
  const beforePast = JSON.stringify((await api.lessons.get(past.id))!);
  const anchor = rows[0]!;
  const preview = await api.lessons.seriesPreview({ lessonId: anchor.id, scope: "following", action: "cancel" });
  const outcome = await api.lessons.updateSeries({
    lessonId: anchor.id,
    scope: "following",
    patch: { note: "验收·此后所有" },
  });
  return {
    affected: preview.affected.length,
    completed: preview.completed.length,
    changed: outcome.changed.length,
    reported: outcome.completed.length,
    pastUnchanged: JSON.stringify((await api.lessons.get(past.id))!) === beforePast,
  };
}, (v: { affected: number; completed: number; changed: number; reported: number; pastUnchanged: boolean }) =>
  v.affected === 3 && v.completed === 1 && v.changed === 3 && v.reported === 1 && v.pastUnchanged);

await check("排课串", "取消其中一节 → 再读回（只动这一节）", async () => {
  const rows = await loadSeries();
  const target = rows[3]!;
  await api.lessons.cancelSeries({ lessonId: target.id, scope: "single", reason: "验收取消" });
  const after = await loadSeries();
  return {
    status: after.find((lesson) => lesson.id === target.id)?.status,
    others: after.filter((lesson) => lesson.id !== target.id).map((lesson) => lesson.status),
    note: after.find((lesson) => lesson.id === target.id)?.note,
    ledger: (await api.transactions.listByEnrollment(seriesStudent.enrollments[0]!.id)).length,
  };
}, (v: { status: string; others: string[]; note: string; ledger: number }) =>
  v.status === "已取消" && v.others.join(",") === "已排,已上,已排" && v.note.includes("验收取消"));

await check("排课串", "冲突时**整体拒绝且零写入**，显式 skip 才只跳过节", async () => {
  const rows = await loadSeries();
  const first = rows.find((lesson) => lesson.status === "已排")!;
  // 在**这一节**的时段放一节挡路课（同一位新老师 + 同一间教室）
  const blocker = await api.lessons.create({
    subject: "验收挡路课", form: "", teacherId: seriesTeacher.id, classroomId,
    studentIds: [], startsAt: first.startsAt, durationMinutes: 60, status: "已排",
    note: "验收挡路", makeupForLessonId: "",
  });
  seriesFixtureLessonIds.push(blocker.id);
  const beforeBytes = JSON.stringify(await api.lessons.list());
  let rejected = "";
  try {
    await api.lessons.updateSeries({ lessonId: first.id, scope: "single", patch: { teacherId: seriesTeacher.id } });
  } catch (cause) {
    rejected = cause instanceof Error ? cause.message : String(cause);
  }
  const zeroWrite = JSON.stringify(await api.lessons.list()) === beforeBytes;
  const skipped = await api.lessons.updateSeries({
    lessonId: first.id, scope: "following", patch: { teacherId: seriesTeacher.id }, onConflict: "skip",
  });
  return {
    rejected: rejected.includes("整体没有改动"),
    zeroWrite,
    changed: skipped.changed.length,
    skipped: skipped.skipped.length,
  };
}, (v: { rejected: boolean; zeroWrite: boolean; changed: number; skipped: number }) =>
  v.rejected && v.zeroWrite && v.changed === 1 && v.skipped === 1);

await check("排课串", "收尾：摘掉这一节造的夹具（学生 / 老师 / 课）", async () => {
  const removed: boolean[] = [];
  for (const id of seriesFixtureLessonIds) removed.push(await removeFixture("lessons", id));
  removed.push(await removeFixture("students", seriesStudent.id));
  removed.push(await removeFixture("teachers", seriesTeacher.id));
  const left = (await api.lessons.list()).filter((lesson) =>
    seriesFixtureLessonIds.includes(lesson.id),
  );
  const studentLeft = (await api.students.list()).some((item) => item.id === seriesStudent.id);
  return { removed: removed.every(Boolean), left: left.length, studentLeft };
}, (v: { removed: boolean; left: number; studentLeft: boolean }) =>
  v.removed && v.left === 0 && v.studentLeft === false);

/* ── 输出 ── */
const byPage = new Map<string, Result[]>();
for (const r of results) {
  const list = byPage.get(r.page) ?? [];
  list.push(r);
  byPage.set(r.page, list);
}
let failed = 0;
for (const [page, list] of byPage) {
  const bad = list.filter((r) => !r.ok);
  failed += bad.length;
  console.log(`${bad.length === 0 ? "✅" : "❌"} ${page}（${list.length - bad.length}/${list.length}）`);
  for (const r of bad) console.log(`     ✗ ${r.label} —— ${r.note}`);
}
console.log(`\n合计：${results.length - failed}/${results.length} 通过${failed === 0 ? "（逐页验收全部通过）" : `，${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
