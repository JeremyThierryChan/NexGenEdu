/**
 * 把 data/site/*.md 编译为 TypeScript 模块（data/site/*.ts）。
 *
 * 为什么需要这一步：
 *   直接 `import "x.md"` 依赖打包器规则，而 Next 内置的 .md 处理会把
 *   `·`（U+00B7）序列化成非法的 `\xb7` 转义，导致构建产物语法错误。
 *   改为生成 .ts 模块后：编码由本脚本保证、文件是原生模块
 *   （dev 下自动重新编译、可热更新），正式构建不依赖任何自定义 loader。
 *
 * 用法：修改 content.md / pricing.md 之后执行 `npm run sync-content`。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetDir = path.join(root, "data", "site");
const names = ["content", "pricing", "faq", "cases", "schedule", "featured"];

// 独立的同步时间戳文件：每次同步都不同，用于强制打包器重新编译。
// 放在单独文件且未纳入版本库，避免每次同步都修改内容文件造成提交噪音。
writeFileSync(
  path.join(targetDir, ".sync-stamp.ts"),
  `/** 本文件由 scripts/sync-content.mjs 生成，请勿手工编辑，也未纳入版本库。 */\nexport const syncStamp = ${JSON.stringify(new Date().toISOString())};\n`,
  "utf8",
);

for (const name of names) {
  const source = readFileSync(path.join(targetDir, `${name}.md`), "utf8");

  // 生成模板字面量：转义反斜杠、反引号与 ${ ——避免内容被当成插值
  const escaped = source
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  const out = `/**
 * 本文件由 scripts/sync-content.mjs 自动生成，请勿手工编辑。
 * 内容来源：data/site/${name}.md —— 修改后执行 npm run sync-content。
 *
 * 这里额外引入一个同步时间戳（data/site/.sync-stamp.ts，未纳入版本库）：
 * 生成的内容是纯字符串常量，内容改回原样后与上一次编译结果逐字节相同，
 * 打包器会判定「未变化」而跳过重新编译，页面继续使用旧产物
 * （表现为内容改好了却仍是旧的，需重启开发服务器）。
 * 把时间戳放在单独文件里，就既能强制缓存失效，又不会让每次同步都改动本文件。
 * 该文件未纳入版本库，因此类型检查依赖 types/sync-stamp.d.ts 的模块声明。
 */
import { syncStamp } from "./.sync-stamp";

// 该文件未纳入版本库，CI 全新 checkout 时可能不存在，因此保留兜底值
export const ${name}SyncedAt = syncStamp ?? "unbuilt";
export const ${name}Source = \`${escaped}\`;
`;

  writeFileSync(path.join(targetDir, `${name}.ts`), out, "utf8");
  console.log(`  生成 data/site/${name}.ts（${source.length} 字符）`);
}

console.log("完成");
