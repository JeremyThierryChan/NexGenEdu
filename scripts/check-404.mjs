/**
 * 构建产物校验：自定义 404 页面。
 *
 * 放在构建之后运行，因为 404 的产物形式（out/404.html）
 * 由静态导出决定，只有构建完才能检查。
 * 目的是防止「改了 404 但产物没更新 / 文案丢失 / 链接带错 basePath」。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "out", "404.html");

if (!existsSync(file)) {
  console.error("✗ 未找到 out/404.html —— 静态导出未生成 404 页面");
  process.exit(1);
}

const html = readFileSync(file, "utf8");

// 站内链接前缀取决于本次构建是否注入 NEXT_PUBLIC_BASE_PATH：
// CI 部署时带 /NexGenEdu，本地直接 build 则没有。
// 这里原先硬编码 /NexGenEdu，导致本地构建后必然误报一项失败。
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const siteLink = new RegExp(
  `href="${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(courses|quote|faq|cases|schedule)/"`,
);

const checks = [
  ["自定义标题", html.includes("这一页还没学到")],
  ["页码意象文案", html.includes("还没印上去的页码")],
  ["站内目录区块", html.includes("站内目录")],
  ["返回首页入口", html.includes("回到首页")],
  ["页头品牌（含页脚 Layout 未被绕过）", html.includes("NexGenEdu")],
  ["页脚版权", html.includes("保留所有权利")],
  [`站内链接前缀（basePath="${basePath}"）`, siteLink.test(html)],
  ["未残留默认 Next 404 文案", !html.includes("This page could not be found")],
];

let failed = 0;
for (const [label, pass] of checks) {
  if (!pass) failed += 1;
  console.log(`  ${pass ? "✓" : "✗"} ${label}`);
}
console.log(`\n404 产物校验：${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
