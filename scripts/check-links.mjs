/**
 * 构建产物校验：站内链接与锚点。
 *
 * 放在构建之后运行。课程卡片改成「一张卡片一个页面」之后，站内链接数量成倍增长
 * （卡片、卡片内标签、关联课程、面包屑…），而静态托管没有服务端路由兜底：
 * 链接写错不会报错，只会让访客点进 404 页面。
 *
 * 因此这里逐个访问 out 下的每个 HTML，把站内链接全部取出来验证：
 *   1. 目标页面文件存在（目录形式 URL → <路径>/index.html）；
 *   2. 带锚点时，锚点 id 必须真的出现在目标页面里（防止「跳过去但停在页首」）。
 *
 * 只检查站内绝对链接；外链、静态资源与纯锚点（#xxx）不在此列。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "out");

/**
 * 允许暂时不存在的站内路径。
 *
 * 教务后台的课程安排 / 日历还没实现，侧边栏已经有入口，
 * 点进去会显示内部版 404 —— 这是刻意的，
 * 不计入失败；实现之后把它们从这里删掉即可。
 */
const ALLOWED_MISSING = [
  "/admin/lessons/",
  "/admin/calendar/",
];

if (!existsSync(outDir)) {
  console.error("✗ 未找到 out/ —— 请先构建（npm run build）");
  process.exit(1);
}

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );

/** HTML 实体还原：`&amp;` 在 href 里很常见（如「3D建模 &amp; 3D打印」）。 */
const decodeEntities = (value) =>
  value.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

/** 目录形式 URL → out 下的文件路径。 */
const fileFor = (url) => (url === "/" ? path.join(outDir, "index.html") : path.join(outDir, `${url}index.html`));

const files = walk(outDir).filter((file) => file.endsWith(".html"));

/** 每个页面里的 id 集合（先剥掉 <script>：RSC 数据里也带着这些字符串）。 */
const idsByUrl = new Map();
for (const file of files) {
  const url = file.replace(outDir, "").replace(/index\.html$/, "");
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  idsByUrl.set(url, new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => decodeEntities(m[1]))));
}

let checked = 0;
const problems = [];

for (const file of files) {
  const source = file.replace(outDir, "");
  const html = readFileSync(file, "utf8").replace(/<script[\s\S]*?<\/script>/g, "");

  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = decodeEntities(match[1]);
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    // 静态资源不是页面
    if (/\.(css|js|m?js|png|jpe?g|svg|ico|webp|txt|xml|json|woff2?)$/.test(href.split("#")[0])) continue;

    checked += 1;

    const [rawPath, fragment] = href.split("#");
    const withoutBase = rawPath.startsWith(basePath) && basePath !== ""
      ? rawPath.slice(basePath.length) || "/"
      : rawPath;
    const url = withoutBase.endsWith("/") ? withoutBase : `${withoutBase}/`;

    if (!existsSync(fileFor(url))) {
      if (!ALLOWED_MISSING.includes(url)) problems.push(`${source} → ${href}（页面不存在）`);
      continue;
    }

    if (fragment === undefined) continue;
    const ids = idsByUrl.get(url) ?? new Set();
    if (!ids.has(decodeURIComponent(fragment))) {
      problems.push(`${source} → ${href}（锚点不存在）`);
    }
  }
}

const unique = [...new Set(problems)];
console.log(`  站内链接 ${checked} 个，问题 ${unique.length} 个`);
for (const problem of unique) console.log(`  ✗ ${problem}`);
console.log(`\n站内链接校验：${unique.length === 0 ? "全部通过" : `${unique.length} 项失败`}`);
process.exit(unique.length === 0 ? 0 : 1);
