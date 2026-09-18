/**
 * 同步时间戳模块的类型声明。
 *
 * `data/site/.sync-stamp.ts` 由 scripts/sync-content.mjs 生成，且**未纳入版本库**
 * （它每次同步都会变，提交它只会制造无意义的 diff）。
 *
 * 但生成的内容文件会 import 它，因此 CI 在全新 checkout 上做类型检查时
 * 会遇到「找不到模块」。这里提供声明让类型检查通过（构造与类型检查都通过）。
 */
declare module "*/\.sync-stamp" {
  /** 同步时间戳（ISO 字符串）。文件不存在时为 undefined。 */
  export const syncStamp: string | undefined;
}
