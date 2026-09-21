/**
 * `data/site/.backend-snapshot.ts` 的模块声明。
 *
 * 那个文件由 `scripts/sync-site-data.mjs` **在构站前生成**，且未纳入版本库
 * （与 `.sync-stamp.ts` 同一套做法：内容是构建期数据，进版本库只会制造提交噪音）。
 * 于是 CI 全新 checkout、还没跑同步脚本时它会不存在 —— 这份声明让类型检查照常通过，
 * 实际构建流程里它总是先被生成。
 */
declare module "@/data/site/.backend-snapshot" {
  import type { PublicSite } from "@/lib/backend/public-site";

  /** 构站那一刻从后端拿到的公开数据；`null` 表示用模版。 */
  export const backendSiteSnapshot: PublicSite | null;
  /** 这份快照从哪来（构建日志与排查用）。 */
  export const backendSiteNote: string;
}
