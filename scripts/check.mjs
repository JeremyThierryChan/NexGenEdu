/**
 * 内容与报价自检入口（npm run check）。
 *
 * 以 Node 直接运行 TypeScript 源码来校验数据层与报价公式，
 * 并注册一个最小解析器让 `@/` 别名可用（Next 的 tsconfig paths 只在打包时生效）。
 *
 * 为什么需要它：此前解析器层级出错时，构建依然成功、首页也正常，
 * 只有课程正文是空的 —— 这类问题靠肉眼发现太晚。
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RESOLVE_SOURCE = `
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = ${JSON.stringify(ROOT)};

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = path.join(ROOT, specifier.slice(2));
    for (const candidate of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const dir = path.dirname(fileURLToPath(context.parentURL));
    for (const ext of [".ts", ".tsx"]) {
      if (existsSync(path.join(dir, specifier + ext))) return nextResolve(specifier + ext, context);
    }
  }
  return nextResolve(specifier, context);
}
`;

// 通过 data: URL 注册 loader，避免额外文件与路径拼接问题
register(`data:text/javascript,${encodeURIComponent(RESOLVE_SOURCE)}`, import.meta.url);

await import(pathToFileURL(path.join(ROOT, "scripts", "check.mts")).href);
