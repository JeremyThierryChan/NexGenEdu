/**
 * 让服务端也能 import 项目里的 TS 源码（`@/` 别名 + 省略扩展名的相对导入）。
 *
 * 为什么需要它：后端必须**复用** `lib/backend/*` 的纯函数（课时记账、金额、
 * 请假规则…），而不是在服务端再写一套 —— 两套口径迟早不一致，而这里是钱和课时。
 *
 * 与 `scripts/check.mjs` 用的是同一套解析规则：`@/` → 项目根，相对路径补 `.ts/.tsx`。
 */
import { register } from "node:module";
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
    for (const ext of [".ts", ".tsx", ".mts"]) {
      if (existsSync(path.join(dir, specifier + ext))) {
        return nextResolve(specifier + ext, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(RESOLVE_SOURCE)}`);
