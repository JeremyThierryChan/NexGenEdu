import type { Conflict } from "./import";

/**
 * **两阶段导入**：先体检，再按结论写入。
 *
 * ## 为什么要单独一个模块
 *
 * 界面上"先看清会动到哪些记录、再决定"这个流程，当时被写了两遍（文件导入、从网站导入），
 * 而其中一遍**漏了第二步**：体检发现没有冲突时直接返回，于是"点了没反应、数据也没进来"
 * —— 这正是真实反馈里那个 bug。
 *
 * （"从网站导入"那一路 v36 已随"以后端为主"整块删掉；`runTwoPhaseImport` 现在只有
 * 文件导入一个调用方 —— **但这段流程仍然值得单独存在**：它是那个 bug 的唯一防线。）
 *
 * 根因不是"手滑"，而是这段流程只存在于组件里、**无法被自检覆盖**（项目里没有前端测试浏览器）。
 * 抽成这个纯函数之后，`npm run check` 就能钉住它的两条关键性质：
 *   1. 体检说"需要人决定"时，**绝不能写入**；
 *   2. 体检说"没有冲突"时，**必须接着写入**（否则用户看到"检查完成"却什么都没发生）。
 */

export type ImportReportLike = {
  ok: boolean;
  /** 体检阶段要求人工决定冲突（此时什么都没写）。 */
  needsDecision?: boolean;
  conflicts?: Conflict[];
  error?: string;
};

export type TwoPhaseOutcome<Report extends ImportReportLike> =
  /** 有冲突：交给界面显示冲突、让人选，**尚未写入**。 */
  | { status: "needs-decision"; conflicts: Conflict[] }
  /** 已经写入（或体检/写入本身失败）：报告直接给界面显示。 */
  | { status: "done"; report: Report };

/**
 * 跑一次两阶段导入。
 *
 * `ask` 与 `write` 由调用方提供（同一个接口的两次调用，只是策略不同）——
 * 这样"体检"与"写入"不会各写一遍、各漏一步。
 */
export async function runTwoPhaseImport<Report extends ImportReportLike>(
  io: { ask: () => Promise<Report>; write: () => Promise<Report> },
): Promise<TwoPhaseOutcome<Report>> {
  const checked = await io.ask();

  // 体检本身失败（例如缺少必填列）：不写入，把报告交回去让界面说明原因
  if (checked.ok !== true) return { status: "done", report: checked };

  if (checked.needsDecision === true) {
    return { status: "needs-decision", conflicts: checked.conflicts ?? [] };
  }

  // 关键一步：体检通过 ≠ 已导入。这里必须再写一次。
  const written = await io.write();
  return { status: "done", report: written };
}
