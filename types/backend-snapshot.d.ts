/**
 * `data/site/.backend-snapshot.ts` 的模块声明。
 *
 * 那个文件由 `scripts/sync-site-data.mjs` **在构站前生成**，且未纳入版本库
 * （与 `.sync-stamp.ts` 同一套做法：内容是构建期数据，进版本库只会制造提交噪音）。
 * 于是 CI 全新 checkout、还没跑同步脚本时它会不存在 —— 这份声明让类型检查照常通过，
 * 实际构建流程里它总是先被生成。
 *
 * **三个导出都要在这里同步**：TS 会优先用这份 `declare module`，漏一个就会出现
 * "明明生成了却说没有这个导出"（`backendSiteSource` 就是这么漏过一次）。
 */
declare module "@/data/site/.backend-snapshot" {
  import type { PublicSite } from "@/lib/backend/public-site";

  /** 构站那一刻从后端拿到的公开数据；`null` 表示这次没连上后端。 */
  export const backendSiteSnapshot: PublicSite | null;
  /**
   * 这一份内容该怎么用（口径见 `scripts/sync-site-data.mjs` 的文件头）：
   *   - `backend` —— 连上了后端，那五块（教师 / 课程卡片 / 课程正文 / 报价 / 学生案例）用库里的；
   *   - `blank` —— 没连上，那五块**空白**；
   *   - `template` —— 显式要求用 `data/site/*.md` 模版。
   */
  export const backendSiteSource: "backend" | "blank" | "template";
  /** 这份快照从哪来（构建日志与排查用）。 */
  export const backendSiteNote: string;
}
