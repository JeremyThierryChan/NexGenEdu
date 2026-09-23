"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { DataNotice } from "@/components/admin/DataNotice";
import { LoadFailure } from "@/components/admin/LoadFailure";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { api, type Catalog, type CatalogOffer } from "@/lib/backend/api";
import {
  applyDecision,
  buildMatrix,
  danglingOffers,
  offerKey,
  offersByKey,
  offersSummary,
  type OfferColumn,
  type OfferDecision,
  type OfferKey,
  type OfferRow,
} from "@/lib/backend/offers";
import { catalogSummary, sortedStages } from "@/lib/backend/catalog";
import { cn } from "@/lib/utils/cn";

/**
 * 开放矩阵（后台）—— 哪些「学科 × 内容模块 × 班型」的组合真的开放。
 *
 * ## 为什么这一页与「课程类型」分开
 *
 * 「课程类型」维护**维度**（可以有哪些学段 / 学科 / 模块 / 班型），
 * 这一页回答**组合**（本机构开哪些）。维度是坐标系（几个月动一次），
 * 组合是经营决定（每次开新班都要看），而且两者的页面形态完全不同
 * （几张列表 vs 一张矩阵）。
 *
 * ## 矩阵的形状（组合三个维度，表格只有两维）
 *
 * ```
 *            一对一   一对二   一对三   一对多（4-8）   班课（9-20）
 * 语文         ✓        ✗
 * （不分模块）
 *   一年级     ✓        ✓
 * ```
 *
 *   行 = 学科 + 它的内容模块（`moduleId` 空的那一行＝"不细分模块"）
 *   列 = 班型
 *
 * 学段只用来**筛行**（不进组合键：学段 + 学科 + 模块已经唯一确定了一门课，见 `offers.ts`）。
 *
 * **没有"交付形态"这一维**（v26 更正）：网课 / 网课+答疑 / 托管 这些是**独立的项目**
 * （在「学科与项目」里，类别是「项目」），与按学段的课程没有组合关系 ——
 * 因此矩阵里不会出现"小学语文 × 网课"这种格子，那种课在系统里是另一个学科/项目。
 *
 * ## 三种格子状态
 *
 * 没设置（空格）／开放（✓）／明确关闭（✗）。点一下在
 * 没设置 → 开放 → 明确关闭 → 没设置 之间循环 —— "勾错了"必须能退回：
 * 两个状态的话，机构按错一次"全选"就再也擦不掉了。
 *
 * ## 保存
 *
 * 与「课程类型」同一套做法：整份读（`offers.list`）、整份写（`offers.save`），
 * 批量勾选是**页面上的纯函数**（`applyDecision`）—— 不为每种批量动作加一个接口，
 * 也就不存在"单条能存、批量被拒"。
 */

/** 三种状态的格子符号（别处不用，因此留在这里）。 */
const GLYPH: Record<OfferDecision, string> = { unset: "", open: "✓", closed: "✗" };

/**
 * 一格（矩阵的行 × 列）对应的组合键。
 *
 * 刻意只在这一处把"行 + 列"翻译成四个维度 id，然后交给 `offers.ts` 的 `offerKey`
 * 拼字符串 —— 键的格式只有那一份实现（自己在这儿再拼一遍，改格式时必然漏掉一处）。
 */
const keyOf = (row: OfferRow, column: OfferColumn): OfferKey => ({
  subjectId: row.subjectId,
  moduleId: row.moduleId,
  formatId: column.formatId,
});

export default function AdminOffersPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [saved, setSaved] = useState<CatalogOffer[] | null>(null);
  const [draft, setDraft] = useState<CatalogOffer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  /** 只显示某个学段（矩阵 3000+ 格，默认落在第一个学段）。 */
  const [stageId, setStageId] = useState("");
  const [keyword, setKeyword] = useState("");
  const notice = useActionNotice();

  const roles = rolesOrAll(useAuth());
  const canSave = canCallMethod(roles, "offers.save");

  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet === true) setRefreshing(true);
    else setLoading(true);
    try {
      const [dimensions, offers] = await Promise.all([api.catalog.list(), api.offers.list()]);
      setCatalog(dimensions);
      setSaved(offers);
      setDraft(offers);
      setStageId((current) => current || (sortedStages(dimensions)[0]?.id ?? ""));
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "读不到开放矩阵。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    [draft, saved],
  );

  const matrix = useMemo(() => (catalog === null ? null : buildMatrix(catalog)), [catalog]);
  const index = useMemo(() => offersByKey(draft ?? []), [draft]);

  /**
   * **失效的组合**：引用了维度表里已经不在的行。
   *
   * 正常路径下不会有（在「课程类型」页删维度时，`catalog.save` 会把受影响的组合一起清掉
   * 并写进日志）；这些是**从外部进来的不一致数据**（手改过的导出、半份恢复）。
   * 必须单独列出来：它们在矩阵里看不见（行或列已经没了），却会让保存整份被拒 ——
   * 没有这一块，机构会卡在"一保存就报错、但找不到改哪一格"。
   */
  const dangling = useMemo(
    () => (catalog === null ? [] : danglingOffers(draft ?? [], catalog)),
    [catalog, draft],
  );

  const danglingKeys = useMemo(
    () =>
      dangling.map((offer) => ({
        subjectId: offer.subjectId,
        moduleId: offer.moduleId,
        formatId: offer.formatId,
      })),
    [dangling],
  );

  /** 当前筛选下要显示的行。 */
  const visibleRows = useMemo(() => {
    if (matrix === null) return [];
    const key = keyword.trim();
    return matrix.rows.filter((row) => {
      if (stageId !== "" && !row.stageIds.includes(stageId)) return false;
      if (key === "") return true;
      return row.subjectName.includes(key) || row.moduleName.includes(key);
    });
  }, [matrix, stageId, keyword]);

  /** 按学科分段（一个学科一行标题 + 它的模块行），矩阵读起来才成块。 */
  const sections = useMemo(() => {
    const list: Array<{ subjectId: string; subjectName: string; rows: OfferRow[] }> = [];
    for (const row of visibleRows) {
      const last = list.at(-1);
      if (last !== undefined && last.subjectId === row.subjectId) last.rows.push(row);
      else list.push({ subjectId: row.subjectId, subjectName: row.subjectName, rows: [row] });
    }
    return list;
  }, [visibleRows]);

  const counts = useMemo(() => {
    let open = 0;
    let closed = 0;
    let total = 0;
    for (const row of visibleRows) {
      for (const column of matrix?.columns ?? []) {
        total += 1;
        const found = index.get(offerKey(keyOf(row, column)));
        if (found === undefined) continue;
        if (found.open) open += 1;
        else closed += 1;
      }
    }
    return { open, closed, unset: total - open - closed, total };
  }, [visibleRows, matrix, index]);

  /** 改格子 / 批量：都走同一个纯函数，只是键的集合不同。 */
  const decide = useCallback((keys: OfferKey[], decision: OfferDecision) => {
    setDraft((prev) => (prev === null ? prev : applyDecision(prev, keys, decision, new Date().toISOString())));
  }, []);

  /** 当前筛选下、匹配 `pick` 的那些列 × 全部可见行的组合键。 */
  const keysFor = useCallback(
    (pick: (column: OfferColumn) => boolean, rows: OfferRow[] = visibleRows): OfferKey[] =>
      rows.flatMap((row) => (matrix?.columns ?? []).filter(pick).map((column) => keyOf(row, column))),
    [matrix, visibleRows],
  );

  /** 某一格点一下：没设置 → 开放 → 明确关闭 → 没设置。 */
  const cycle = useCallback(
    (key: OfferKey, current: OfferDecision) => {
      decide([key], current === "unset" ? "open" : current === "open" ? "closed" : "unset");
    },
    [decide],
  );

  async function save(): Promise<void> {
    if (draft === null) return;
    await notice.run(
      async () => await api.offers.save(draft),
      (next) => {
        setSaved(next);
        setDraft(next);
        return `已保存：${offersSummary(next)}。`;
      },
    );
  }

  if (loading) {
    return (
      <>
        <PageHeading title="开放矩阵" description="哪些课程组合真的开放。" />
        <p className="mt-6 text-sm text-ink-400">加载中…</p>
      </>
    );
  }

  if (catalog === null || draft === null || matrix === null) {
    return (
      <>
        <PageHeading title="开放矩阵" description="哪些课程组合真的开放。" />
        {/* 重试走安静刷新：页面上已经写着"读不到"，不必再换成"加载中…" */}
        <LoadFailure error={loadError} onRetry={() => void load({ quiet: true })} />
      </>
    );
  }

  const stages = sortedStages(catalog);
  const stageName = stages.find((stage) => stage.id === stageId)?.name ?? "";

  return (
    <>
      <PageHeading
        title="开放矩阵"
        description="勾出本机构真正开的组合：行是学科与内容模块，列是班型。"
      />

      <div className="mt-4">
        <DataNotice onRefresh={() => void load({ quiet: true })} />
      </div>

      <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-700">
        <strong className="font-medium">这一页决定 AI 排课与诊断推荐能不能用。</strong>
        维度表说「可以有哪些维度」，这里说「本机构开哪些组合」。三种格子：
        <span className="mx-1 rounded bg-white px-1">空格＝还没设过</span>
        <span className="mx-1 rounded bg-white px-1">✓＝开放</span>
        <span className="mx-1 rounded bg-white px-1">✗＝明确关闭</span>
        ，点一下依次循环（按错了因此能退回「还没设过」）。
        「<span className="mx-1 rounded bg-white px-1">（不分模块）</span>」那一行是「这门课不细分到模块」的组合，同样是合法的一条 ——
        诊断推荐才需要模块那一层。
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {canSave ? (
          <Button onClick={() => void save()} disabled={notice.pending || !dirty}>
            {notice.pending ? "保存中…" : dirty ? "保存修改" : "已保存"}
          </Button>
        ) : (
          <span className="text-xs text-ink-500">
            你的角色（{roles.join(" · ")}）只能看：勾开放矩阵归 {methodOwnerText("offers.save")}
          </span>
        )}
        {refreshing && <span className="text-xs text-ink-400">刷新中…</span>}
        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          学段
          <select
            className="rounded-md border border-ink-300 bg-white px-2 py-1 text-sm"
            value={stageId}
            onChange={(event) => setStageId(event.target.value)}
          >
            <option value="">全部学段</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          筛学科 / 模块
          <input
            className="w-40 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm"
            placeholder="例如 语文 / 阅读"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <span className="text-xs text-ink-500">
          当前 {visibleRows.length} 行 × {matrix.columns.length} 列：开放 {counts.open} ·
          明确关闭 {counts.closed} · 还没设 {counts.unset}
        </span>
      </div>

      <div className="mt-3">
        <ActionNoticeView notice={notice} />
      </div>

      <Panel
        className="mt-4 mb-8"
        title="批量勾选（只作用于当前筛选出来的格子）"
        description={
          stageId === ""
            ? "现在选的是「全部学段」，批量动作会作用到所有行 —— 想只改一段，先在上面选一个学段。"
            : `作用于「${stageName}」这一段当前显示的行。`
        }
        actions={
          canSave ? (
            <>
              <Button variant="outline" size="sm" onClick={() => decide(keysFor(() => true), "open")}>
                全部开放
              </Button>
              <Button variant="outline" size="sm" onClick={() => decide(keysFor(() => true), "closed")}>
                全部关闭
              </Button>
              <Button variant="outline" size="sm" onClick={() => decide(keysFor(() => true), "unset")}>
                全部清除设置
              </Button>
            </>
          ) : undefined
        }
      >
        {canSave ? (
          <div className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-xs text-ink-500">按班型整片勾：</span>
              {catalog.formats.map((format) => (
                <span key={format.id} className="flex items-center gap-1">
                  <span className="text-xs text-ink-700">{format.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => decide(keysFor((column) => column.formatId === format.id), "open")}
                  >
                    全开
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => decide(keysFor((column) => column.formatId === format.id), "closed")}
                  >
                    全关
                  </Button>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="px-4 py-3 text-xs text-ink-500">只读：批量勾选归 {methodOwnerText("offers.save")}。</p>
        )}
      </Panel>

      {/* 失效组合的出口：不列出来的话，它们会让保存整份被拒，而矩阵里看不到它们 */}
      {dangling.length > 0 && (
        <Panel
          className="mt-4"
          title={`失效的组合（${String(dangling.length)} 条）`}
          description="它们引用的学科 / 模块 / 班型在课程类型里已经不在了，因此在下面的矩阵里看不见 —— 但只要还在，保存就会被拒。"
          actions={
            canSave ? (
              <Button variant="outline" size="sm" onClick={() => decide(danglingKeys, "unset")}>
                清除这些失效设置
              </Button>
            ) : undefined
          }
        >
          <ul className="space-y-1 px-4 py-3 text-xs text-ink-600">
            {dangling.slice(0, 20).map((offer) => (
              <li key={offer.id} className="font-mono">
                {offer.subjectId} · {offer.moduleId === "" ? "（不分模块）" : offer.moduleId} ·{" "}
                {offer.formatId} —— {offer.open ? "开放" : "明确关闭"}
              </li>
            ))}
            {dangling.length > 20 && <li>还有 {dangling.length - 20} 条…</li>}
          </ul>
        </Panel>
      )}

      <Panel
        className="mt-4 mb-8"
        title="矩阵"
        description={`维度表：${catalogSummary(catalog)} · 组合表：${offersSummary(draft)}`}
      >
        {visibleRows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-400">
            这一段没有匹配的学科 / 模块（换个学段，或清掉筛选关键字）。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">
              <thead>
                <tr className="text-xs text-ink-600">
                  <th className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-normal">
                    学科 / 模块
                  </th>
                  {matrix.columns.map((column) => (
                    <th
                      key={column.formatId}
                      className="border-l border-ink-100 px-3 py-2 text-center font-medium"
                    >
                      {column.formatName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.subjectId}>
                    <tr className="bg-ink-50">
                      <th className="sticky left-0 z-10 bg-ink-50 px-4 py-1.5 text-left text-xs font-medium text-ink-700">
                        {section.subjectName}
                        <span className="ml-1.5 font-normal text-ink-400">（{section.rows.length} 行）</span>
                      </th>
                      <td colSpan={matrix.columns.length} className="px-2 py-1.5 text-[11px] text-ink-400">
                        {canSave ? (
                          <span className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              className="hover:text-brand-700"
                              onClick={() => decide(keysFor(() => true, section.rows), "open")}
                            >
                              本学科全开
                            </button>
                            <button
                              type="button"
                              className="hover:text-brand-700"
                              onClick={() => decide(keysFor(() => true, section.rows), "closed")}
                            >
                              本学科全关
                            </button>
                            <button
                              type="button"
                              className="hover:text-brand-700"
                              onClick={() => decide(keysFor(() => true, section.rows), "unset")}
                            >
                              清除本学科设置
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={`${section.subjectId}-${row.moduleId}`} className="border-t border-ink-50">
                        <th className="sticky left-0 z-10 bg-white px-4 py-1 text-left text-xs font-normal text-ink-600">
                          {row.moduleId === "" ? "（不分模块）" : row.moduleName}
                        </th>
                        {matrix.columns.map((column) => {
                          const found = index.get(offerKey(keyOf(row, column)));
                          const decision: OfferDecision =
                            found === undefined ? "unset" : found.open ? "open" : "closed";
                          const label = `${row.subjectName} ${row.moduleName === "" ? "不分模块" : row.moduleName} ${column.formatName}`;
                          return (
                            <td
                              key={`${row.moduleId}-${column.formatId}`}
                              className="px-1 py-1 text-center"
                            >
                              <button
                                type="button"
                                disabled={!canSave}
                                onClick={() => cycle(keyOf(row, column), decision)}
                                title={
                                  decision === "unset"
                                    ? `${label}：还没设过，点一下＝开放`
                                    : decision === "open"
                                      ? `${label}：开放，点一下＝明确关闭`
                                      : `${label}：明确关闭，点一下＝清除设置`
                                }
                                aria-pressed={decision === "open"}
                                aria-label={label}
                                className={cn(
                                  "h-6 w-6 rounded-sm border text-xs transition-colors disabled:opacity-50",
                                  decision === "open" && "border-brand-500 bg-brand-500 text-white",
                                  decision === "closed" && "border-ink-300 bg-ink-100 text-ink-500",
                                  decision === "unset" && "border-ink-200 bg-white text-ink-300 hover:border-brand-300",
                                )}
                              >
                                {GLYPH[decision]}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="mb-8 text-xs leading-relaxed text-ink-500">
        保存之后这份组合表就是「本机构开什么」的唯一口径：AI 排课与诊断推荐按它判定
        （<code className="rounded bg-ink-50 px-1">resolveOffer</code>）。
        新增维度（加一个班型、加一个模块）之后，新冒出来的格子是「还没设过」——
        那正是需要你回来看一眼的信号。**价格仍然在「报价」页**（课程价与班型系数），
        这一页只管开放与否。
      </p>
    </>
  );
}

