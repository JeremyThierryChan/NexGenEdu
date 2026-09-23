/**
 * **构站时取一次后端数据**：把"网站内容从哪来"这件事定在构建那一刻。
 *
 * ## 为什么是构建时（而不是访客的浏览器里）
 *
 * 宣传网站是**静态导出**（`next.config.ts` 的 `output: "export"`），托管在 GitHub Pages
 * 这类只有静态文件的地方 —— 那种环境里**没有后端**，也不该让每个访客为了看课程介绍
 * 去请求一台机器。构建时取一次数据，页面照旧是纯静态产物：SEO、首屏、离线可用性都不变。
 *
 * ## 两态：要么全用后端，要么全用模版
 *
 * 判断只有一个问题：**这次构建所在的环境能不能连上后端**。
 *   - 能（拿到一份结构合法的公开数据）→ 整站用库里的数据；
 *   - 不能（没起后端 / 超时 / 非 200 / 结构不对）→ 整站用 `data/site/*.md` 模版。
 *
 * **没有第三种状态**：早先还有一层"仓库快照"（`npm run site:snapshot` 导出的
 * `data/site/site-snapshot.json`）—— 它带来的是一个很难解释的现象：明明没起后端，
 * 页面上却是上次从库里导出的内容。那一层已经删掉（机构确认：没连上就是模版）。
 * 判定与页面的取数规则一致（见 `lib/site/backend-source.ts` 的文件头）。
 *
 * | 环境变量 | 行为 |
 * | --- | --- |
 * | `SITE_CONTENT_SOURCE=auto`（默认） | 能连上就用后端，连不上用模版 |
 * | `SITE_CONTENT_SOURCE=backend` | 必须用后端；连不上就**让构建失败** |
 * | `SITE_CONTENT_SOURCE=template` | 强制用模版（GitHub Pages 走这条，本地想验证模版长相也用） |
 * | `SITE_API_STRICT=1` | `auto` 模式下连不上也**让构建失败**（正式部署建议打开，免得悄悄发一版模版） |
 * | `SITE_API_BASE` | 后端地址（默认 `http://127.0.0.1:4000`，也会读 `NEXT_PUBLIC_API_BASE`） |
 *
 * ## 空块要在**日志里**说出来
 *
 * 连上后端之后，某一块为空（没人勾「网站上展示」、课程库没有卡片、课程正文还没导入…）
 * 一律**按空渲染**，不再回落模版 —— 但构站日志会逐块打印条数，空的那些直接写明。
 * "这一块为什么是空的"必须能在日志里看到，否则机构只会看到空页面然后来问。
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "data", "site", ".backend-snapshot.ts");

const mode = (process.env.SITE_CONTENT_SOURCE ?? "auto").trim() || "auto";
const base = (
  process.env.SITE_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://127.0.0.1:4000"
).replace(/\/+$/, "");
const strict = process.env.SITE_API_STRICT === "1";

if (!["auto", "backend", "template"].includes(mode)) {
  console.error(`[site-data] SITE_CONTENT_SOURCE 只能是 auto / backend / template（收到「${mode}」）`);
  if (mode === "snapshot") {
    console.error(
      "[site-data] `snapshot` 模式已经删掉：网站内容只有两态 —— 连上后端就用库，连不上就用模版。",
    );
  }
  process.exit(1);
}

/**
 * 写快照并打印结果。
 *
 * `source` 是**这一份内容该怎么用**，三个取值（口径见文件头）：
 *   - `backend`：连上了后端 → 那五块用库里的数据；
 *   - `blank`：没连上 → 那五块**空白**（机构要求：需要后端数据的地方就该是空的）；
 *   - `template`：显式要求用模版（`SITE_CONTENT_SOURCE=template`，本地对照用）。
 */
function write(data, note, source) {
  writeFileSync(
    target,
    `/**
 * 本文件由 scripts/sync-site-data.mjs 生成，请勿手工编辑，也未纳入版本库。
 *
 * 内容：构站那一刻从后端拿到的公开数据（教师 / 课程 / 课程正文 / 报价 / 学生案例），
 * 以及这次构站**该怎么用**它们（\`backendSiteSource\`）：
 *   - \`backend\` —— 连上了后端，那五块用库里的数据；
 *   - \`blank\` —— 没连上，那五块**空白**（不是回落到模版：需要后端数据的部分就该是空的）；
 *   - \`template\` —— 显式要求用 data/site/*.md 模版（SITE_CONTENT_SOURCE=template）。
 * 来源说明：${note}
 */
export const backendSiteSnapshot = ${JSON.stringify(data, null, 2)};

/** 这一份内容该怎么用（\`backend\` / \`blank\` / \`template\`）。 */
export const backendSiteSource = ${JSON.stringify(source)};

/** 这份快照是从哪来的（只用于构建日志与排查，页面不显示）。 */
export const backendSiteNote = ${JSON.stringify(note)};
`,
    "utf8",
  );
}

if (mode === "template") {
  write(null, "按 SITE_CONTENT_SOURCE=template 强制使用模版", "template");
  console.log("[site-data] 本次网站数据来源：**模版**（SITE_CONTENT_SOURCE=template，显式指定）");
  process.exit(0);
}

/** 拉一次公开数据；超时或非 200 都算"连不上"。 */
async function fetchPublic() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${base}/api/public/site`, { signal: controller.signal });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const body = await response.json();
    if (body?.ok !== true || body?.data === undefined) {
      return { ok: false, reason: `返回内容不合法（${JSON.stringify(body).slice(0, 80)}）` };
    }
    const data = body.data;
    /*
     * 体检只看**结构**，不看"内容多不多"。
     *
     * 这是两态的关键：结构不对（拿到的不是这个接口该给的东西）＝"连不上"；
     * 而"连上了但某一块是空的"（没人勾网站展示、课程库没卡片、正文还没导入）
     * **不再是回落理由** —— 那属于机构自己的数据状态，页面如实显示为空，
     * 构站日志逐块报数（见下面的 `reportBlocks`）。早先这里把"没有课程正文"
     * 判成"连不上"，于是机构看到的是模版，却以为在用库里的数据。
     */
    if (!Array.isArray(data.teachers) || !Array.isArray(data.courses)) {
      return { ok: false, reason: "缺 teachers / courses" };
    }
    if (!Array.isArray(data.partitions)) {
      return { ok: false, reason: "缺 partitions（后端版本太旧？）" };
    }
    if (!data.siteContent?.coursePage || !Array.isArray(data.siteContent.coursePage.subjects)) {
      return { ok: false, reason: "缺 siteContent.coursePage" };
    }
    if (!data.pricing || !Array.isArray(data.pricing.stages)) {
      return { ok: false, reason: "缺 pricing.stages" };
    }
    return { ok: true, data };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    clearTimeout(timer);
  }
}

const result = await fetchPublic();

/**
 * 逐块报数（并挑出空块）。
 *
 * 为什么必须在**构建日志**里做这件事：两态之后"这一块是空的"就照空渲染，
 * 页面上不会再有"悄悄换成模版"的痕迹 —— 那正是它该有的样子，但也意味着
 * 机构唯一的线索就是这行日志。空块要单独列出来，并说清大概去哪补。
 */
function reportBlocks(data) {
  // 口径与教师页、课程卡片一致：日志说 7、页面显示 4 会让人怀疑日志
  const teachers = data.teachers.filter((teacher) => teacher.active && teacher.siteVisible).length;
  const cards = data.courses.filter((course) => course.path !== "" && course.siteKind !== "不展示").length;
  const electiveCards = data.courses.filter((course) => course.siteKind === "选修").length;
  const subjects = data.siteContent.coursePage.subjects.length;
  const bands = data.siteContent.coursePage.subjects.reduce(
    (sum, subject) => sum + (subject.bands?.length ?? 0),
    0,
  );
  const stages = data.pricing.stages.length;

  console.log(
    `[site-data] 本次网站数据来源：**后端** ${base} —— ` +
      `${teachers} 位网站教师 / ${cards} 张课程卡片 / ${data.partitions.length} 个课程分区 / ` +
      `${subjects} 个学科 / ${bands} 个小节 / ${stages} 个报价阶段 / ${electiveCards} 门选修课`,
  );

  const empty = [];
  if (teachers === 0) empty.push("教师页（后台「教师」里勾上「在宣传网站展示」）");
  if (cards === 0) empty.push("课程卡片（课程库里给课填「卡片路径」，或点一次「从网站同步课程」）");
  if (subjects === 0) empty.push("课程正文（后台「课程库 → 从网站导入内容」）");
  if (stages === 0) empty.push("报价（后台「报价」里配阶段与价格）");
  if (empty.length > 0) {
    console.log(
      "[site-data] ⚠ 上面这些块**在库里是空的，网站会照空显示**（两态口径：连上后端就不再回落模版）：" +
        empty.join("；"),
    );
  }
  return { teachers, cards, subjects, bands, stages };
}

if (result.ok) {
  write(result.data, `后端 ${base}（${new Date().toISOString()}）`, "backend");
  reportBlocks(result.data);
  process.exit(0);
}

const why = `连不上 ${base}：${result.reason}`;
if (mode === "backend" || strict) {
  console.error(`[site-data] 要求用后端数据，但${why}`);
  console.error(
    "[site-data] 处理办法：先把后端跑起来（npm run server）；" +
      "确实想用模版构站就设 SITE_CONTENT_SOURCE=template。",
  );
  process.exit(1);
}

/*
 * 连不上 → 那五块**空白**（教师页 / 课程卡片 / 课程正文 / 报价 / 学生案例）。
 *
 * 这是机构确认的口径：**需要后端数据的地方，没连上后端就该是空的** ——
 * 换成模版会让人分不清页面上看到的到底是库里的还是文件里的（而那正是要消灭的）。
 * 其余页面（首页文案 / 关于 / 联系 / FAQ / 课表 / 特色课程 / 品牌与联系方式）本来就只在模版里，
 * 它们照常显示。想让那五块也显示模版内容（本地对照、或确实要发一份模版站）：
 * `SITE_CONTENT_SOURCE=template npm run build`。
 */
write(null, `空白（${why}）`, "blank");
console.log(`[site-data] 本次网站数据来源：**空白** —— ${why}`);
console.log(
  "[site-data] 库里才有的那几块（教师页 / 课程卡片 / 课程正文 / 报价 / 学生案例 / 特色课程）" +
    "这一版**会是空的**；想改看模版：SITE_CONTENT_SOURCE=template npm run build（或 npm run dev）。",
);
