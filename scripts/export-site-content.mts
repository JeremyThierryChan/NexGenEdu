/**
 * **把后台（SQLite 库）里的网站内容导出回 `data/site/*.md`**。
 *
 * 为什么需要它：宣传网站是**静态导出**的，而线上（GitHub Actions → Pages）那台机器
 * **连不上后端**（工作流里设了 `SITE_CONTENT_SOURCE=template`）——
 * 也就是说**线上读的就是 `data/site/*.md` 这六个文件**。
 * 机构的口径是「网站上有显示的内容都要和后台同步，这样我的后台才有用」，
 * 于是有了这条命令：库 → 文件，一次写回，提交推送之后 CI 照旧构站。
 *
 * 用法（后端要在跑）：
 *
 *   npm run site:export             写回六个文件（只写真的变了的），然后跑 `sync-content`
 *   npm run site:export -- --check  只比对不写盘；六个文件与后台不一致时退出码 1
 *
 * 也可以指定后端地址：`SITE_API_BASE=http://127.0.0.1:4000 npm run site:export`
 *
 * 退出码：0 = 已写出（或 `--check` 下完全一致）；1 = `--check` 下不一致；2 = 连不上后端。
 *
 * 导出之后这六个文件就是**导出产物**：后台为准，手工改动会在下次导出时被覆盖。
 * 因此文件头会被追加一行醒目提醒（反复导出不会重复追加）。
 *
 * `--check` 是给「推送前确认网站与后台同步了」用的：
 * 它回答的是"现在跑一次导出，会不会改到文件"，也就是"线上那份是不是最新的"。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  SITE_EXPORT_FILES,
  SITE_EXPORT_LABELS,
  exportSiteMarkdown,
  type SiteExportFile,
} from "@/lib/backend/site-export";
import type { PublicSite } from "@/lib/backend/public-site";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "data", "site");
const checkOnly = process.argv.includes("--check");
const base = (process.env.SITE_API_BASE ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

/** 读一个现有文件（读不到就是空串：导出仍能进行，只是拿不到说明文字）。 */
function readExisting(name: SiteExportFile): string {
  try {
    return readFileSync(path.join(targetDir, `${name}.md`), "utf8");
  } catch {
    return "";
  }
}

/** 行级差异条数（不是严格的 diff，只用来告诉人"改了多少"）。 */
function countChanges(before: string, after: string): { added: number; removed: number } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const counts = new Map<string, number>();
  for (const line of beforeLines) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of afterLines) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return { added, removed };
}

const response = await fetch(`${base}/api/public/site`);
if (!response.ok) {
  console.error(`连不上后端（${base}）：HTTP ${response.status}`);
  console.error("先把后端跑起来（npm run server）再导出 —— 导出要问的就是它。");
  process.exit(2);
}
const body = (await response.json()) as { ok: boolean; data: PublicSite };
if (body.ok !== true) {
  console.error("后端返回不合法：", JSON.stringify(body).slice(0, 200));
  process.exit(2);
}

const existing = {} as Record<SiteExportFile, string>;
for (const name of SITE_EXPORT_FILES) existing[name] = readExisting(name);

const result = exportSiteMarkdown({ site: body.data, existing });

console.log(`\n后台（${base}）  →  data/site/*.md\n`);
for (const name of SITE_EXPORT_FILES) {
  const before = existing[name];
  const after = result.files[name];
  if (before === after) {
    console.log(`  ✓ ${SITE_EXPORT_LABELS[name]}：一致，没动`);
    continue;
  }
  const { added, removed } = countChanges(before, after);
  const marker = checkOnly ? "✗" : "→";
  console.log(`  ${marker} ${SITE_EXPORT_LABELS[name]}：不一致（＋${String(added)} 行 / －${String(removed)} 行）`);
}

for (const note of result.notes) console.log(`\n· ${note}`);
if (result.warnings.length > 0) {
  console.log(`\n⚠ 下面 ${String(result.warnings.length)} 项，库里有、但内容文件表达不了（没有写进文件）：`);
  for (const warning of result.warnings) console.log(`    - ${warning}`);
}

if (checkOnly) {
  if (result.changed.length === 0) {
    console.log("\n→ 网站内容与后台一致（线上那份就是最新的）。\n");
    process.exit(0);
  }
  console.log(
    `\n→ 有 ${String(result.changed.length)} 个文件与后台不一致：` +
      `${result.changed.join("、")}\n` +
      "  推送前先跑一次 `npm run site:export`（不带 --check）写回文件，再 `git add data/site/*.md data/site/*.ts` 提交。\n",
  );
  process.exit(1);
}

/*
 * **护栏：文件不见了 / 是空的 / 页面标记没认出来 → 一个字都不写。**
 *
 * 这几种情况下生成出来的是一份"没有页面"的残骸（可能只有两行），而写盘是静默的 ——
 * 一次误操作就把机构那份内容文件（连同里面写给人看的说明）抹掉。
 * 宁可让命令停在这里，让人先把文件找回来。
 */
if (result.unsafe.length > 0) {
  console.error("\n✗ 有文件不敢写（先把它找回来再导出）：");
  for (const item of result.unsafe) {
    console.error(`    - data/site/${item.file}.md：${item.reason}`);
  }
  console.error(
    "\n  这几个文件的页面标记（`## 页面: xxx`）是导出定位内容的唯一依据，" +
      "认不出来时导出的是一份残骸 —— 写下去等于把文件抹了。\n" +
      "  文件被删或改坏：`git checkout -- data/site/<文件名>.md` 找回上一版；" +
      "确实是新文件：手工按现有文件的格式建好（至少要有 `## 页面: xxx`），再导出。\n",
  );
  process.exit(2);
}

for (const name of result.changed) {
  writeFileSync(path.join(targetDir, `${name}.md`), result.files[name], "utf8");
}
console.log(
  result.changed.length === 0
    ? "\n  没有文件需要写（后台与文件本来就一致）。"
    : `\n  已写回 ${String(result.changed.length)} 个文件：${result.changed.map((name) => `${name}.md`).join("、")}`,
);

/*
 * 接着跑 `npm run sync-content`：`data/site/*.ts` 是由 `.md` 生成的（页面的构建依赖），
 * 不跑这一步，dev 与构站读到的还是旧内容 —— 而 `npm run check` 校验的也是生成出来的 `.ts`。
 */
console.log("\n接着生成 data/site/*.ts（npm run sync-content）……");
const synced = spawnSync("npm", ["run", "sync-content"], { cwd: root, stdio: "inherit" });
if (synced.status !== 0) {
  console.error("\n✗ sync-content 失败：内容文件已写好，但 .ts 没跟着更新，请先处理上面的报错。");
  process.exit(1);
}

console.log(
  "\n完成。下一步：\n" +
    "  · 核对两边的口径（可选）：npm run site:diff\n" +
    "  · 提交并推送：git add data/site/*.md data/site/*.ts && git commit -m \"content(网站): 从后台导出网站内容\"\n" +
    "  · 推送后 CI 照旧构站，线上那份读的就是这六个文件。\n",
);
