/**
 * **构站时取一次后端数据**：把"网站内容从哪来"这件事定在构建那一刻。
 *
 * ## 为什么是构建时（而不是访客的浏览器里）
 *
 * 宣传网站是**静态导出**（`next.config.ts` 的 `output: "export"`），托管在 GitHub Pages
 * 这类只有静态文件的地方 —— 那种环境里**没有后端**，也不该让每个访客为了看课程介绍
 * 去请求一台机器。构建时取一次数据，页面照旧是纯静态产物：SEO、首屏、离线可用性都不变。
 *
 * 于是判断只有一个问题：**这次构建所在的环境能不能连上后端**。
 *   - 本机开发 / 正式部署（后端在这台机器或内网里）→ 能连上 → 用库里的数据生成页面；
 *   - GitHub Actions 构 Pages（那台机器上没有后端）→ 连不上 → 整体回落到模版文件。
 *
 * ## 三种模式
 *
 * | 环境变量 | 行为 |
 * | --- | --- |
 * | `SITE_CONTENT_SOURCE=auto`（默认） | 能连上就用后端，连不上用模版 |
 * | `SITE_CONTENT_SOURCE=backend` | 必须用后端；连不上就**让构建失败** |
 * | `SITE_CONTENT_SOURCE=template` | 强制用模版（想验证模版长相时用） |
 * | `SITE_API_STRICT=1` | `auto` 模式下连不上也**让构建失败**（防止"以为用了后端，其实是模版"） |
 * | `SITE_API_BASE` | 后端地址（默认 `http://127.0.0.1:4000`，也会读 `NEXT_PUBLIC_API_BASE`） |
 *
 * 生成的东西：`data/site/.backend-snapshot.ts`（未纳入版本库，与 `.sync-stamp.ts` 同一套做法），
 * 内容是后端那一份 `PublicSite` 或 `null`。
 *
 * 每次都会打印一行"本次网站数据来源"—— 这是这类功能最容易出的隐形故障：
 * 以为在用后端，其实是模版，而且页面上看不出来。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "data", "site", ".backend-snapshot.ts");

const mode = (process.env.SITE_CONTENT_SOURCE ?? "auto").trim() || "auto";
/** 上一次 `npm run site:snapshot` 导出的那份（提交进版本库，Pages 就靠它）。 */
const snapshotFile = path.join(root, "data", "site", "site-snapshot.json");
const base = (
  process.env.SITE_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://127.0.0.1:4000"
).replace(/\/+$/, "");
const strict = process.env.SITE_API_STRICT === "1";

if (!["auto", "backend", "snapshot", "template"].includes(mode)) {
  console.error(
    `[site-data] SITE_CONTENT_SOURCE 只能是 auto / backend / snapshot / template（收到「${mode}」）`,
  );
  process.exit(1);
}

/** 读仓库里的快照（`npm run site:snapshot` 导出的那份）；没有就不能用。 */
function readRepoSnapshot() {
  if (!existsSync(snapshotFile)) return { ok: false, reason: "仓库里没有 site-snapshot.json" };
  try {
    const data = JSON.parse(readFileSync(snapshotFile, "utf8"));
    const bands = (data.siteContent?.coursePage?.subjects ?? []).reduce(
      (sum, subject) => sum + (subject.bands?.length ?? 0),
      0,
    );
    if (bands === 0) return { ok: false, reason: "快照里没有课程正文" };
    return { ok: true, data, bands };
  } catch (cause) {
    return { ok: false, reason: `快照读不出来：${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/** 写快照并打印结果。`data` 为 null 表示用模版。 */
function write(data, note) {
  writeFileSync(
    target,
    `/**
 * 本文件由 scripts/sync-site-data.mjs 生成，请勿手工编辑，也未纳入版本库。
 *
 * 内容：构站那一刻从后端拿到的公开数据（教师 / 课程 / 课程正文 / 报价）；
 * \`null\` 表示这次构建没有连上后端 —— 网站会整体回落到 data/site/*.md 模版。
 * 来源说明：${note}
 */
export const backendSiteSnapshot = ${JSON.stringify(data, null, 2)};

/** 这份快照是从哪来的（只用于构建日志与排查，页面不显示）。 */
export const backendSiteNote = ${JSON.stringify(note)};
`,
    "utf8",
  );
}

if (mode === "template") {
  write(null, "按 SITE_CONTENT_SOURCE=template 强制使用模版");
  console.log("[site-data] 本次网站数据来源：**模版**（SITE_CONTENT_SOURCE=template）");
  process.exit(0);
}

if (mode === "snapshot") {
  const snapshot = readRepoSnapshot();
  if (!snapshot.ok) {
    console.error(`[site-data] 要求用仓库快照，但用不了：${snapshot.reason}`);
    console.error("[site-data] 先跑一次 npm run site:snapshot（后端要在跑）把快照导出来。");
    process.exit(1);
  }
  write(snapshot.data, "仓库快照 data/site/site-snapshot.json");
  console.log(
    `[site-data] 本次网站数据来源：**仓库快照** —— ${snapshot.data.siteContent.coursePage.subjects.length} 个学科 / ${snapshot.bands} 个小节`,
  );
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
     * 三道体检。宁可判成"连不上"而回落模版，也不要把一份半截数据烤进页面：
     * 线上出现空课程页比显示旧模版糟糕得多。
     */
    if (!Array.isArray(data.teachers) || !Array.isArray(data.courses)) {
      return { ok: false, reason: "缺 teachers / courses" };
    }
    if (!data.siteContent?.coursePage || !Array.isArray(data.siteContent.coursePage.subjects)) {
      return { ok: false, reason: "缺 siteContent.coursePage" };
    }
    const bands = data.siteContent.coursePage.subjects.reduce(
      (sum, subject) => sum + (subject.bands?.length ?? 0),
      0,
    );
    if (bands === 0) {
      // 后端还没导入过课程正文 → 用模版（并在下面把这句原因打出来，别让人猜）
      return { ok: false, reason: "后端还没有课程正文（可在后台「课程库 → 从网站导入内容」补）" };
    }
    return { ok: true, data, bands };
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    clearTimeout(timer);
  }
}

const result = await fetchPublic();

if (result.ok) {
  const cards = result.data.courses.filter((course) => course.path !== "" && course.siteKind !== "不展示");
  const subjects = result.data.siteContent.coursePage.subjects.length;
  const note = `后端 ${base}（${new Date().toISOString()}）`;
  write(result.data, note);
  console.log(
    `[site-data] 本次网站数据来源：**后端** ${base} —— ` +
      // 口径与教师页一致（在职 **且** 允许在网站展示）：日志说 7、页面显示 4 会让人怀疑日志
      `${result.data.teachers.filter((teacher) => teacher.active && teacher.siteVisible).length} 位网站教师 / ` +
      `${cards.length} 张课程卡片 / ${subjects} 个学科 / ${result.bands} 个小节 / ` +
      `${result.data.pricing.stages.length} 个报价阶段`,
  );
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
 * `auto` 模式的回落顺序：后端 → 仓库快照 → 模版。
 *
 * 中间这一层就是给 GitHub Pages 准备的：Actions 上连不上后端，但仓库里如果有
 * `npm run site:snapshot` 导出的那份，Pages 就能显示**库里的内容**而不是手写的模版。
 * 三层都取不到才退回模版（那时候仓库本来就只有模版）。
 */
const repoSnapshot = readRepoSnapshot();
if (repoSnapshot.ok) {
  write(repoSnapshot.data, `仓库快照（${why}）`);
  console.log(
    `[site-data] 本次网站数据来源：**仓库快照**（${why}）—— ` +
      `${repoSnapshot.data.siteContent.coursePage.subjects.length} 个学科 / ${repoSnapshot.bands} 个小节`,
  );
  process.exit(0);
}

write(null, `模版（${why}；${repoSnapshot.reason}）`);
console.log(`[site-data] 本次网站数据来源：**模版** —— ${why}；${repoSnapshot.reason}`);
