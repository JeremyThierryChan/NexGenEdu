/**
 * **把库里的网站内容导出到仓库**（让 GitHub Pages 那份也跟着更新）。
 *
 * ## 为什么需要它
 *
 * Pages 的产物是 GitHub Actions 构的，那台机器上**没有后端**，因此它永远走
 * "回落"那条路。仓库里能回落到什么，取决于这个命令最后一次导出了什么：
 *
 *   - 从没跑过 → 回落到 `data/site/*.md` **模版**（仓库里手维护的那份）；
 *   - 跑过 → 回落到 `data/site/site-snapshot.json`（**库里的内容**，提交进版本库）。
 *
 * 于是"后台改了教师 / 课程 / 正文 / 报价"之后，想让公开网站也跟上就是两步：
 * 跑一次这个命令 → 提交。不想让 Pages 显示库里的内容，就别跑（Pages 保持模版）。
 *
 * 用法：`npm run site:snapshot`（后端要在跑；地址可用 SITE_API_BASE 指定）
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "data", "site", "site-snapshot.json");
const base = (
  process.env.SITE_API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  "http://127.0.0.1:4000"
).replace(/\/+$/, "");

let data;
try {
  const response = await fetch(`${base}/api/public/site`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body?.ok !== true || body?.data === undefined) throw new Error("返回内容不合法");
  data = body.data;
} catch (cause) {
  console.error(
    `[site:snapshot] 连不上后端（${base}）：${cause instanceof Error ? cause.message : String(cause)}`,
  );
  console.error("[site:snapshot] 先把后端跑起来（npm run server），再执行这个命令。");
  process.exit(1);
}

const bands = data.siteContent.coursePage.subjects.reduce(
  (sum, subject) => sum + (subject.bands?.length ?? 0),
  0,
);
if (bands === 0) {
  console.error(
    "[site:snapshot] 后端还没有课程正文，导出去只会让 Pages 上的课程页变空。\n" +
      "[site:snapshot] 先到后台「课程库 → 从网站导入内容」把正文补上，再执行这个命令。",
  );
  process.exit(1);
}

/*
 * 存成 JSON 而不是回写 Markdown：Markdown 是要**人读**的格式（段落、注释、短字段），
 * 从结构化数据反生成出来的 Markdown 会丢掉注释与排版，而且 diff 会很难看 ——
 * 那是"两套真源"的老问题。快照就是快照，格式与公开接口一致。
 */
writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");

const cards = data.courses.filter((course) => course.path !== "" && course.siteKind !== "不展示").length;
console.log(
  `[site:snapshot] 已导出到 data/site/site-snapshot.json —— ` +
    `${data.teachers.filter((teacher) => teacher.active && teacher.siteVisible).length} 位网站教师 / ` +
    `${cards} 张课程卡片 / ${data.siteContent.coursePage.subjects.length} 个学科 / ${bands} 个小节 / ` +
    `${data.pricing.stages.length} 个报价阶段`,
);
console.log("[site:snapshot] 提交这个文件，GitHub Pages 下次部署就会用上它的内容。");
