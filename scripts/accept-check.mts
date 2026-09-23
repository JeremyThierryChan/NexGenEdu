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
import { applyDecision, offerKey, offersByKey, resolveOffer } from "../lib/backend/offers.ts";
import { isRemoteMode, remoteBase } from "../lib/backend/remote.ts";

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

/* ── 1 课程库（含分区）── */
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
    name: "围棋", partitionId: subId, forms: ["一对一定制课"], origin: "后台",
    status: "开放", note: "验收用", createdAt: new Date().toISOString(),
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
await check("课程库", "修改课程", async () => (await api.courses.update(courseId, { note: "已改" })).note === "已改");
await check("课程库", "从网站同步课程", async () => (await api.courses.syncFromSite()).total > 0);
await check("课程库", "重复同步不重复添加", async () => (await api.courses.syncFromSite()).added.length === 0);

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
  await api.site.saveContent(content.siteContent);
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

/* ── 1.6 课程类型（五张维度表：加学段 / 加学科 / 加模块 / 加班型）── */
/*
 * 这一节按机构在后台的真实顺序走一遍：读 → 加一个学段 + 学科 + 模块 + 班型 → 再读确认落库
 * → 非法的一份被拒（人数区间反向 / 悬空引用）→ 恢复种子收尾。
 *
 * 收尾**必须回到种子**：验收用的就是这个机构自己的库，留着「验收学段」会让后面每次构站
 * 都多出一截，而且下一次验收时 `subjects` 里会多一条重名的行（id 是写死的）。
 */
await check("课程类型", "维度表读得到（五张表都在）", async () => {
  const catalog = await api.catalog.list();
  return [catalog.stages.length, catalog.formats.length, catalog.deliveries.length];
}, (value: number[]) => value[0] > 0 && value[1] > 0 && value[2] > 0);
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
  const delivery = catalog.deliveries[0];
  if (subject === undefined || firstModule === undefined || format === undefined || delivery === undefined) return null;
  const keys = [
    { subjectId: subject.id, moduleId: "", formatId: format.id, deliveryId: delivery.id },
    { subjectId: subject.id, moduleId: firstModule.id, formatId: format.id, deliveryId: delivery.id },
  ];
  const saved = await api.offers.save(applyDecision(offersBefore, keys, "open", new Date().toISOString()));
  return [saved.length, saved.every((offer) => offer.open)];
}, (value: unknown[]) => value[0] === 2 && value[1] === true);

await check("开放矩阵", "解析：开的算 open、另一条交付形态仍是没设过", async () => {
  const catalog = await api.catalog.list();
  const groups = groupIdsOf(catalog);
  const subject = catalog.subjects.find((item) => !groups.has(item.id));
  const format = catalog.formats[0];
  const delivery = catalog.deliveries[0];
  const other = catalog.deliveries.find((item) => item.id !== delivery?.id);
  if (subject === undefined || format === undefined || delivery === undefined || other === undefined) {
    return ["?", "?"];
  }
  const index = offersByKey(await api.offers.list());
  return [
    resolveOffer(index, { subjectId: subject.id, moduleId: "", formatId: format.id, deliveryId: delivery.id }),
    resolveOffer(index, { subjectId: subject.id, moduleId: "", formatId: format.id, deliveryId: other.id }),
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
    deliveryId: catalog.deliveries[0]?.id ?? "",
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
      deliveryId: offer.deliveryId,
    }));
  const cleared = await api.offers.save(applyDecision(current, added, "unset", new Date().toISOString()));
  return cleared.length;
}, (n: number) => n === offersBefore.length);

/* ── 2 教室 ── */
let classroomId = "";
await check("教室", "新建教室（含可用时段）", async () => {
  const created = await api.classrooms.create({
    name: "验收教室", capacity: 6, kind: "上课用教室", note: "",
    availability: [{ id: "a1", weekdays: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "22:00" }],
  });
  classroomId = created.id;
  return created;
}, (r: { name: string }) => r.name === "验收教室");
await check("教室", "修改教室容量", async () => (await api.classrooms.update(classroomId, { capacity: 8 })).capacity === 8);

/* ── 3 教师 ── */
let teacherId = "";
await check("教师", "新建教师（可带科目用课程名）", async () => {
  const created = await api.teachers.create({ name: "验收老师", role: "数学", subjects: ["围棋", "初中数学"], phone: "138", active: true });
  teacherId = created.id;
  return created;
}, (t: { subjects: string[] }) => t.subjects.includes("围棋"));
await check("教师", "在职教师列表", async () => (await api.teachers.listActive()).some((t) => t.id === teacherId));

/* ── 4 学生与报课收费 ── */
let studentId = "";
let enrollmentId = "";
await check("学生", "建档", async () => {
  const created = await api.students.create({
    name: "验收学生", grade: "初二", guardian: "138-0000-0000", subjects: [], profile: {},
    enrollments: [], status: "在读", note: "", createdAt: new Date().toISOString(),
  });
  studentId = created.id;
  return created;
}, (s: { name: string }) => s.name === "验收学生");
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
      { subject: "验收科目A", lessons: 10, form: "一对一定制课", teacherId },
      { subject: "验收科目B", lessons: 20, form: "一对二 / 一对三小组课" },
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
  result.forms.join("|") === "一对一定制课|一对二 / 一对三小组课" &&
  result.teachers.join(",") === "true,false" &&
  result.kinds.every(
    (rows, index) =>
      rows.length === 1 && rows[0]?.[0] === "报课" && rows[0]?.[1] === (index === 0 ? 10 : 20),
  ));
await check("学生", "信息采集表保存", async () => (await api.students.saveProfile(studentId, { school: "验收中学" })).profile.school === "验收中学");
await check("学生", "报课（真实字段 lessons）", async () => {
  const updated = await api.students.enroll(studentId, {
    subject: "围棋", form: "一对一定制课", teacherId, lessons: 4, startedAt: iso(0),
    note: "", unitPrice: 200, agreedAmount: 800, paidNow: 800, method: "微信",
  });
  enrollmentId = updated.enrollments[0].id;
  return updated.enrollments[0];
}, (e: { totalLessons: number; paidAmount: number }) => e.totalLessons === 4 && e.paidAmount === 800);
await check("学生", "续费", async () => {
  const updated = await api.students.renewEnrollment(studentId, enrollmentId, 2, "续费", { amount: 400, method: "微信", agreedDelta: 400 });
  return updated.enrollments[0];
}, (e: { totalLessons: number; paidAmount: number }) => e.totalLessons === 6 && e.paidAmount === 1200);
await check("收费", "记一笔独立退款", async () => {
  await api.payments.record({ studentId, enrollmentId, amount: 100, kind: "退款", method: "微信", note: "验收" });
  const student = await api.students.get(studentId);
  return student.enrollments[0].paidAmount;
}, (paid: number) => paid === 1100);
await check("收费", "退费试算（两种口径）", async () => {
  const student = await api.students.get(studentId);
  const total = student.enrollments[0].totalLessons;
  return { total, remaining: total - student.enrollments[0].usedLessons };
}, (v: { total: number }) => v.total === 6);

/* ── 4.5 按周批量排课（页面上的「按周批量排课」面板走的就是这两个方法）── */
await check("课程安排", "按周批量排课：预检只算不写", async () => {
  const before = (await api.lessons.list()).length;
  const plan = await api.lessons.planSeries({
    subject: "围棋", form: "一对一定制课", teacherId, classroomId, studentIds: [studentId],
    durationMinutes: 60, status: "已排", note: "验收批量排课", startDate: "2027-06-07",
    weekdays: [1], time: "16:00", count: 4,
  });
  return { items: plan.items.length, changed: (await api.lessons.list()).length - before, schedulable: plan.schedulable };
}, (v: { items: number; changed: number; schedulable: number }) =>
  v.items === 4 && v.changed === 0 && v.schedulable === 4);
await check("课程安排", "按周批量排课：写入并跳过冲突", async () => {
  const input = {
    subject: "围棋", form: "一对一定制课", teacherId, classroomId, studentIds: [studentId],
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
    subject: "围棋", form: "一对一定制课", teacherId, classroomId, studentIds: [studentId],
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
    id: "", subject: "围棋", form: "一对一定制课", teacherId, classroomId,
    studentIds: [studentId], startsAt: iso(1, 11), durationMinutes: 60,
    status: "已排", note: "", makeupForLessonId: "",
  });
  return Array.isArray(report) ? report.length : report;
}, (v: unknown) => (Array.isArray(v) ? v.length > 0 : JSON.stringify(v).length > 2));
await check("课程安排", "课堂记录（提前请假）", async () => api.lessonRecords.save({
  lessonId, studentId, attendance: "请假", leaveRequestedAt: iso(0, 10), focus: "高", interaction: "好", rating: 4, note: "",
}));
await check("课程安排", "标记已上（不扣课时：提前请假）", async () => (await api.students.get(studentId)).enrollments[0].usedLessons, (n: number) => n === 0);
await check("课程安排", "标记已上动作", async () => (await api.lessons.markCompleted(lessonId)).skipped === false);
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
    candidates: [{ id: "c1", weekday: new Date(iso(2, 17)).getDay(), start: "17:00" }],
    preferredTeacherId: teacherId, preferredClassroomId: classroomId, skipDates: [], status: "待确认", note: "",
  });
  inquiryId = created.id;
  return created;
}, (i: { id: string }) => i.id !== "");
await check("咨询", "可行性判定", async () => {
  const report = await api.inquiries.evaluate(inquiryId);
  return { slots: report?.slots?.length ?? 0, anyOk: report?.slots?.some((s) => s.ok) ?? false };
}, (v: { slots: number }) => v.slots > 0);
await check("咨询", "放弃咨询", async () => (await api.inquiries.abandon(inquiryId, "验收结束")).status === "已放弃");

/* ── 8 统计 / 待跟进 / 今日 ── */
await check("今日概览", "today()", async () => typeof (await api.today()).lessonCount === "number");
await check("统计", "stats(月份)", async () => typeof (await api.stats(new Date())) === "object");
await check("待跟进", "followups()", async () => Array.isArray(await api.followups()));
await check("收费", "finance(月份)", async () => typeof (await api.finance(new Date())) === "object");

/* ── 9 报价 ── */
await check("报价", "读配置", async () => (await api.pricing.get()).stages.length > 0);
await check("报价", "给课程库的课定价", async () => {
  const current = await api.pricing.get();
  const stages = [...current.stages];
  const target = stages.find((s) => s.name === "兴趣才艺");
  if (target === undefined) stages.push({ name: "兴趣才艺", courses: [{ name: "围棋", basePrice: 200, available: true, courseId }] });
  else target.courses.push({ name: "围棋", basePrice: 200, available: true, courseId });
  return (await api.pricing.update({ ...current, stages })).stages.length;
}, (n: number) => n > 0);
await check("报价", "试算（含新定价的课）", async () => (await api.pricing.quote({
  courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5,
})).ok);
await check("报价", "教师课时费", async () => (await api.pricing.teacherFee({
  courseName: "围棋", classTypeName: "一对一", durationName: "1 小时", lessons: 5, students: 1,
})).ok);
await check("报价", "导出 Markdown", async () => (await api.pricing.exportMarkdown()).includes("学习阶段"));
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
  const quote = await api.pricing.quote({
    courseName: course?.name ?? "",
    subjectName: pricing.subjects.find((item) => item.stageName === stage?.name)?.name ?? "",
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
await check("数据与备份", "批量导入：CSV 导入教室", async () => {
  const csv = [
    "名称,用途,容量,备注",
    "验收教室A,上课用教室,6,批量导入自检",
    "验收教室B,自习室,4,",
  ].join("\r\n");
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv, fileName: "验收.csv" });
  return { ok: outcome.ok, added: outcome.added };
}, (v: { ok: boolean; added: number }) => v.ok && v.added === 2);
await check("数据与备份", "批量导入：重复导入不重复加", async () => {
  const csv = "名称,用途,容量,备注\r\n验收教室A,上课用教室,6,批量导入自检\r\n";
  const outcome = await api.imports.apply({ entity: "classrooms", text: csv });
  return { added: outcome.added, skipped: outcome.skipped.length };
}, (v: { added: number; skipped: number }) => v.added === 0 && v.skipped === 1);
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
await check("数据与备份", "从网站导入教师资料（含 AI）", async () => {
  // 网站上有真人教师与 AI 智能体，且都带资料（教龄 / 简介 / 详细介绍）
  const imported = await api.imports.fromSite({ entity: "teachers", onConflict: "skip" });
  const teachers = await api.teachers.list();
  const schedulable = await api.teachers.listActive();
  const chen = teachers.find((teacher) => teacher.name === "陈老师");
  const ai = teachers.filter((teacher) => teacher.kind === "AI");
  return {
    added: imported.added,
    chenHasProfile: chen !== undefined && chen.bio !== "" && chen.years !== "",
    aiCount: ai.length,
    aiHasProfile: ai.every((teacher) => teacher.bio !== ""),
    aiSchedulable: schedulable.some((teacher) => teacher.kind === "AI"),
  };
}, (v: { added: number; chenHasProfile: boolean; aiCount: number; aiHasProfile: boolean; aiSchedulable: boolean }) =>
  v.added >= 1 && v.chenHasProfile && v.aiCount >= 1 && v.aiHasProfile && v.aiSchedulable === false);
await check("数据与备份", "批量导入：缺少必填列时拒绝且不写入", async () => {
  const before = (await api.classrooms.list()).length;
  const outcome = await api.imports.apply({ entity: "classrooms", text: "房间名,容量\r\n漏了表头,6\r\n" });
  return { ok: outcome.ok, changed: (await api.classrooms.list()).length - before };
}, (v: { ok: boolean; changed: number }) => v.ok === false && v.changed === 0);
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
