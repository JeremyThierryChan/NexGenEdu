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
const names = ["content", "pricing", "faq", "cases", "schedule"];

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
 */
export const ${name}Source = \`${escaped}\`;
`;

  writeFileSync(path.join(targetDir, `${name}.ts`), out, "utf8");
  console.log(`  生成 data/site/${name}.ts（${source.length} 字符）`);
}

console.log("完成");
