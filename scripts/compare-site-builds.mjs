/**
 * 比较两份构站产物的**页面正文**（去掉标签与脚本后的可见文字）。
 *
 * 用途：验证"后端那条路"与"模版那条路"在**同一份内容**下产出同样的页面 ——
 * 这是这套功能最要紧的性质，也是唯一能证明"网站以后端为准"不会悄悄改变页面长相的办法。
 *
 * 用法：
 *   npm run build                          # 后端在跑 → 后端模式
 *   cp -r out /tmp/out-backend
 *   SITE_CONTENT_SOURCE=template npm run build
 *   cp -r out /tmp/out-template
 *   node scripts/compare-site-builds.mjs /tmp/out-backend /tmp/out-template
 *
 * 为什么不去比 JS/CSS 资源：后端模式的产物里**内嵌了那份快照数据**（页面要读它），
 * 因此资源哈希必然不同。要证明的是"页面显示的东西一样"，那就比正文文本。
 *
 * 注意：这只在**两边内容相同**时有意义。库里改过内容、模版没跟着改时，
 * 差异是**正常的**（那正是"以后端为准"的意思），脚本会把差异原文打出来供人判断。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const [dirA, dirB] = process.argv.slice(2);
if (dirA === undefined || dirB === undefined) {
  console.error("用法：node scripts/compare-site-builds.mjs <产物目录A> <产物目录B>");
  process.exit(2);
}

/** 比对的页面（覆盖：首页、教师、课程总览、栏目页、卡片页、特色课程、报价）。 */
const PAGES = [
  "index.html",
  "teachers/index.html",
  "courses/index.html",
  "courses/primary/index.html",
  "courses/junior/index.html",
  "courses/senior/index.html",
  "courses/languages/index.html",
  "courses/junior-math/index.html",
  "courses/senior-physics/index.html",
  "courses/gaokao-languages/index.html",
  "courses/featured/index.html",
  "quote/index.html",
];

/** 去掉脚本/样式/标签，只留下人能看到的那段文字。 */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

let differences = 0;

for (const page of PAGES) {
  const fileA = path.join(dirA, page);
  const fileB = path.join(dirB, page);
  if (!existsSync(fileA) || !existsSync(fileB)) {
    console.log(`· ${page} —— 有一侧没有这个页面，跳过`);
    continue;
  }

  const a = visibleText(readFileSync(fileA, "utf8"));
  const b = visibleText(readFileSync(fileB, "utf8"));
  if (a === b) {
    console.log(`✓ ${page}  正文一致（${a.length} 字符）`);
    continue;
  }

  differences += 1;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  console.log(`✗ ${page}  正文不同（${a.length} vs ${b.length} 字符）`);
  console.log(`     第一处差异在第 ${i} 个字符：`);
  console.log(`     A: …${a.slice(Math.max(0, i - 50), i + 90)}…`);
  console.log(`     B: …${b.slice(Math.max(0, i - 50), i + 90)}…`);
}

if (differences === 0) {
  console.log("\n两种来源构出来的页面正文一致（内容相同的前提下，这是应有的结果）");
} else {
  console.log(`\n${differences} 个页面正文不同（若库里改过内容、模版没同步，这是正常的）`);
}
process.exit(0);
