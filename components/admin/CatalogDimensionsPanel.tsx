"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CONTROL_CLASS, Panel } from "@/components/admin/AdminFields";
import { DataNotice } from "@/components/admin/DataNotice";
import { LoadFailure } from "@/components/admin/LoadFailure";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import {
  api,
  CATALOG_MODULE_KINDS,
  CATALOG_SUBJECT_KINDS,
  type Catalog,
  type CatalogFormat,
  type CatalogModule,
  type CatalogOffer,
  type CatalogStage,
  type CatalogSubject,
} from "@/lib/backend/api";
import { assignCatalogIds, catalogGroups, catalogSummary, validateCatalog } from "@/lib/backend/catalog";
import { offersOfDimension } from "@/lib/backend/offers";
import { catalogId, catalogSeedSummary } from "@/lib/backend/catalog-seed";
import { cn } from "@/lib/utils/cn";

/**
 * 课程类型（后台）—— 学段 / 学科与项目 / 内容模块 / 班型这四个**维度**。
 *
 * ## 为什么不是"课程清单"
 *
 * 机构那份清单铺开有 400 多条叶子，但它们全是这四个维度的**乘积**
 * （一门课 = 学段 × 学科 / 项目 × 内容模块 × 班型）。要是按"一门课一条记录"来存：
 *
 *   - 加一个语种 / 加一级等级，记录数就翻倍；
 *   - AI 排课与诊断推荐只能靠"一个诊断项硬绑几门课"来对付；
 *   - 改一次班型名字要在几百条记录里改一遍。
 *
 * 维度法把这件事反过来：**维度是数据，组合按需解析**。这一页管的就是那四张维度表。
 *
 * **刻意没有"交付形态"这一维**（v26 更正）：网课 / 网课+答疑 / 托管 这些是**独立的项目**
 * （在「学科与项目」里，类别选「项目」），与按学段的课程没有组合关系。
 *
 * ## 这一页能做什么（机构的要求：能加课、能设每一个组合的开放）
 *
 *   - 加 / 改名 / 排序 / 删除四个维度里的任意一行；
 *   - 内容模块带类别（教材进度 / 能力点 / 语言等级），诊断推荐按类别筛；
 *   - 学科挂在哪个学段开、属于哪个分组，都在行上勾。
 *
 * 组合本身（"小学 · 语文 · 一对一 · 网课"这一条要不要开、多少钱）在 P2 的
 * 「开放矩阵」里勾 —— 那一块要等这一份维度表稳定下来再做，否则矩阵的行列会天天变。
 *
 * ## 保存是**整份替换**
 *
 * 与课程库那种"逐条编辑 + 乐观锁"不同：维度表是配置，页面上的操作是
 * "在这份草稿上改 → 一次保存"。整份写避免了"改了三处、只有两处落库"。
 * 因此校验（`validateCatalog`）在这一页上**实时显示**：红字出现时不要保存。
 */
type TabKey = "stages" | "subjects" | "modules" | "formats";

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: "stages", label: "学段", hint: "机构清单的第一层：小学 / 初中 / 高中 / 大学 / 其他类型" },
  { key: "subjects", label: "学科与项目", hint: "语文、数学、雅思、托管项目…（学科与学段解耦，勾学段即可）" },
  { key: "modules", label: "内容模块", hint: "教材进度 / 能力点 / 语言等级（诊断推荐按类别筛）" },
  { key: "formats", label: "班型", hint: "全系统唯一口径 —— 报价的班级系数按它算" },
];

/** 重排用的公共动作：把下标 `from` 与 `to` 换位（越界就原样返回）。 */
function swap<T>(rows: readonly T[], from: number, to: number): T[] {
  const next = [...rows];
  const moved = next[from];
  const other = next[to];
  if (moved === undefined || other === undefined) return next;
  next[from] = other;
  next[to] = moved;
  return next;
}

export function CatalogDimensionsPanel() {
  const [saved, setSaved] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<TabKey>("stages");
  /** 开放组合（只用来算"删这一行会牵动几条"，编辑在「开放矩阵」页）。 */
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  /** 「内容模块」只看一个学科：98 个模块平铺出来没法用（也拖慢这一页）。 */
  const [moduleSubjectId, setModuleSubjectId] = useState("");
  const notice = useActionNotice();

  const roles = rolesOrAll(useAuth());
  const canSave = canCallMethod(roles, "catalog.save");
  const canReset = canCallMethod(roles, "catalog.resetToSeed");

  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet === true) setRefreshing(true);
    else setLoading(true);
    try {
      /*
       * 一起读组合表：**删除维度会让引用它的开放组合失效**，服务层会连带清掉它们
       * （见 `catalog.save` 的注释），所以删除前要能说清"这一删会牵动几条"。
       */
      const [data, offers] = await Promise.all([api.catalog.list(), api.offers.list()]);
      setSaved(data);
      setDraft(data);
      setOffers(offers);
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "读不到课程类型。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 就地改草稿：改的是副本，保存前不影响库里那一份。 */
  const edit = useCallback((change: (next: Catalog) => void) => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as Catalog;
      change(next);
      return next;
    });
  }, []);

  const dirty = useMemo(
    () => saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    [draft, saved],
  );

  /** 实时校验：红字出现时不要保存（服务端也会拦，但那时已经白填了一屏）。 */
  const problems = useMemo(() => (draft === null ? [] : validateCatalog(draft)), [draft]);

  const groups = useMemo(() => (draft === null ? [] : catalogGroups(draft)), [draft]);

  /** 可以挂模块的学科（分组自己不是学科，不参与）。 */
  const moduleSubjects = useMemo(() => {
    if (draft === null) return [];
    const groupIds = new Set(groups.map((group) => group.id));
    return draft.subjects.filter((subject) => !groupIds.has(subject.id));
  }, [draft, groups]);

  // 学科列表变化（新增 / 删除 / 整份刷新）时，模块页签的当前学科要落到一个存在的学科上
  useEffect(() => {
    if (moduleSubjects.length === 0) return;
    if (!moduleSubjects.some((subject) => subject.id === moduleSubjectId)) {
      setModuleSubjectId(moduleSubjects[0]?.id ?? "");
    }
  }, [moduleSubjectId, moduleSubjects]);

  const moduleCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of draft?.modules ?? []) {
      map.set(item.subjectId, (map.get(item.subjectId) ?? 0) + 1);
    }
    return map;
  }, [draft]);

  async function save(): Promise<void> {
    if (draft === null) return;
    /*
     * 保存前补 id：草稿上**新加的行** id 是空串（`addRow` 刻意不生成，见
     * `assignCatalogIds` 的注释）。补完之后服务端的 `validateCatalog` 才能判重名与悬空引用。
     */
    const payload = JSON.parse(JSON.stringify(draft)) as Catalog;
    assignCatalogIds(payload, catalogId);

    await notice.run(
      async () => await api.catalog.save(payload),
      (next) => {
        setSaved(next);
        setDraft(next);
        return `已保存：${catalogSummary(next)}。`;
      },
    );
  }

  async function resetToSeed(): Promise<void> {
    const seed = catalogSeedSummary();
    const ok = window.confirm(
      "恢复成机构那份清单的种子？后台改过的维度会全部丢失，恢复后是：" +
        `${String(seed.stages)} 个学段 / ${String(seed.subjects)} 个学科项目 / ` +
        `${String(seed.modules)} 个内容模块 / ${String(seed.formats)} 个班型。`,
    );
    if (!ok) return;
    await notice.run(
      async () => await api.catalog.resetToSeed(),
      (next) => {
        setSaved(next);
        setDraft(next);
        return `已恢复成种子：${catalogSummary(next)}。`;
      },
    );
  }

  if (loading) {
    return (
      <>
        <p className="mt-6 text-sm text-ink-400">加载中…</p>
      </>
    );
  }

  if (draft === null) {
    return (
      <>
        {/* 重试走安静刷新：页面上已经有"读不到"这句话，不必再换成"加载中…" */}
        <LoadFailure error={loadError} onRetry={() => void load({ quiet: true })} />
      </>
    );
  }

  const activeTab = TABS.find((item) => item.key === tab) ?? TABS[0]!;
  const selectedModules = draft.modules
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.subjectId === moduleSubjectId);

  return (
    <>

      <div className="mt-4">
        <DataNotice onRefresh={() => void load({ quiet: true })} />
      </div>

      {/* 口径说明：为什么这里没有"一条条课程" */}
      <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-700">
        <strong className="font-medium">这里维护的是「维度」，不是一条条课程。</strong>
        一门课是上面四个维度的一次组合（例如「小学 · 语文 · 一年级 · 一对一」）。
        组合不写在这里 —— 全铺开有四百多条，加一个语种就翻一倍。哪些组合开放、按什么价，
        在下一步的<span className="mx-1 rounded bg-white px-1">开放矩阵</span>里勾选。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canSave ? (
          <Button onClick={() => void save()} disabled={notice.pending || !dirty || problems.length > 0}>
            {notice.pending ? "保存中…" : dirty ? "保存修改" : "已保存"}
          </Button>
        ) : (
          <span className="text-xs text-ink-500">
            你的角色（{roles.join(" · ")}）只能看：改课程类型归 {methodOwnerText("catalog.save")}
          </span>
        )}
        {canReset && (
          <Button variant="outline" onClick={() => void resetToSeed()} disabled={notice.pending}>
            恢复种子
          </Button>
        )}
        {refreshing && <span className="text-xs text-ink-400">刷新中…</span>}
        <span className="text-xs text-ink-500">
          {catalogSummary(draft)}
          {draft.seededAt === "" ? "" : ` · 种子灌入 ${draft.seededAt.slice(0, 10)}`}
          {problems.length > 0 ? " · 有需要先修的问题" : ""}
        </span>
      </div>

      <div className="mt-3">
        <ActionNoticeView notice={notice} />
      </div>

      {problems.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 rounded-md border border-danger-100 bg-danger-50 px-5 py-2.5 text-xs text-danger-600">
          {problems.slice(0, 12).map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
          {problems.length > 12 && <li>还有 {problems.length - 12} 条同类问题…</li>}
        </ul>
      )}

      {/* ── 四个维度用页签切换（一屏一个，避免几张长表堆在一起） ── */}
      <div className="mt-5 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              tab === item.key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-ink-200 bg-white text-ink-600 hover:border-ink-300",
            )}
          >
            {item.label}
            <span className="ml-1.5 text-xs text-ink-400">{String(countOf(draft, item.key))}</span>
          </button>
        ))}
      </div>

      <Panel
        className="mt-4 mb-8"
        title={activeTab.label}
        description={activeTab.hint}
        actions={
          canSave ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => addRow(tab, moduleSubjectId, edit)}
            >
              新增
            </Button>
          ) : undefined
        }
      >
        {tab === "stages" && (
          <Table
            headers={["名称", "说明（只给自己看）", "顺序", ""]}
            rows={draft.stages.map((stage, index) => ({
              key: stage.id === "" ? `new-stage-${String(index)}` : stage.id,
              cells: [
                <CellInput
                  key="name"
                  value={stage.name}
                  disabled={!canSave}
                  placeholder="学段名"
                  onChange={(value) => edit((next) => void (next.stages[index]!.name = value))}
                />,
                <CellInput
                  key="note"
                  value={stage.note}
                  disabled={!canSave}
                  placeholder="例如：本机构小学只做三到六年级"
                  onChange={(value) => edit((next) => void (next.stages[index]!.note = value))}
                />,
                <Reorder
                  key="order"
                  index={index}
                  total={draft.stages.length}
                  disabled={!canSave}
                  onMove={(delta) => edit((next) => void (next.stages = swap(next.stages, index, index + delta)))}
                />,
                <RemoveButton
                  key="remove"
                  disabled={!canSave}
                  label={`学段「${stage.name}」`}
                  onRemove={() => confirmRemove(`学段「${stage.name}」`, () => edit((next) => removeStage(next, index)))}
                />,
              ],
            }))}
          />
        )}

        {tab === "subjects" &&
          subjectSections(draft, groups).map((section) => (
            <section key={section.groupId === "" ? "__top" : section.groupId} className="border-b border-ink-100 last:border-0">
              <h3 className="px-4 pt-3 text-xs font-medium text-ink-600">
                {section.groupName}
                <span className="ml-1.5 text-ink-400">（{section.rows.length} 项）</span>
              </h3>
              <Table
                headers={["名称", "类别", "所属分组", "开设学段", "顺序", ""]}
                rows={section.rows.map(({ subject, index }) => ({
                  key: subject.id === "" ? `new-subject-${String(index)}` : subject.id,
                  cells: [
                    <CellInput
                      key="name"
                      value={subject.name}
                      disabled={!canSave}
                      placeholder="学科或项目名"
                      onChange={(value) => edit((next) => void (next.subjects[index]!.name = value))}
                    />,
                    <CellSelect
                      key="kind"
                      value={subject.kind}
                      disabled={!canSave}
                      options={CATALOG_SUBJECT_KINDS.map((kind) => ({ value: kind, label: kind }))}
                      onChange={(value) =>
                        edit((next) => void (next.subjects[index]!.kind = value as CatalogSubject["kind"]))
                      }
                    />,
                    <CellSelect
                      key="parent"
                      value={subject.parentIds[0] ?? ""}
                      disabled={!canSave}
                      options={[
                        { value: "", label: "（顶层）" },
                        ...groups.map((group) => ({ value: group.id, label: group.name })),
                      ]}
                      onChange={(value) =>
                        edit((next) => void (next.subjects[index]!.parentIds = value === "" ? [] : [value]))
                      }
                    />,
                    <StagePicker
                      key="stages"
                      stages={draft.stages}
                      value={subject.stageIds}
                      disabled={!canSave}
                      onChange={(stageIds) => edit((next) => void (next.subjects[index]!.stageIds = stageIds))}
                    />,
                    <Reorder
                      key="order"
                      index={index}
                      total={draft.subjects.length}
                      disabled={!canSave}
                      onMove={(delta) =>
                        edit((next) => void (next.subjects = swap(next.subjects, index, index + delta)))
                      }
                    />,
                    <RemoveButton
                      key="remove"
                      disabled={!canSave}
                      label={`学科「${subject.name}」`}
                      onRemove={() =>
                        confirmRemove(
                          `学科「${subject.name}」` +
                            (draft.modules.filter((item) => item.subjectId === subject.id).length === 0
                              ? ""
                              : `（它下面还有 ${String(draft.modules.filter((item) => item.subjectId === subject.id).length)} 个内容模块，会一起删掉）`),
                          () => edit((next) => removeSubject(next, index)),
                          offersOfDimension(offers, "subject", subject.id).length,
                        )
                      }
                    />,
                  ],
                }))}
              />
            </section>
          ))}

        {tab === "modules" && (
          <div className="px-4 py-4">
            <div className="max-w-sm">
              <CellSelect
                value={moduleSubjectId}
                disabled={false}
                options={moduleSubjects.map((subject) => ({
                  value: subject.id,
                  label: `${subject.name}（${String(moduleCounts.get(subject.id) ?? 0)} 个模块）`,
                }))}
                onChange={setModuleSubjectId}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              模块按学科分开维护：两个学科各有一个「听力」，那是两条互不相干的模块
              （学科不需要它时删掉即可）。
            </p>

            {moduleSubjectId === "" ? (
              <p className="mt-4 text-sm text-ink-400">还没有学科，先在「学科与项目」里加一个。</p>
            ) : selectedModules.length === 0 ? (
              <p className="mt-4 text-sm text-ink-400">
                这个学科还没有内容模块。没有模块的学科也能开课（组合只用到学科那一层），
                但诊断推荐需要模块才能说清「补的是哪一块」。
              </p>
            ) : (
              <Table
                className="mt-3"
                headers={["名称", "类别", "适用学段", "顺序", ""]}
                rows={selectedModules.map(({ item, index }) => ({
                  key: item.id === "" ? `new-module-${String(index)}` : item.id,
                  cells: [
                    <CellInput
                      key="name"
                      value={item.name}
                      disabled={!canSave}
                      placeholder="例如：七年级教材 / 阅读 / CEFR-B1"
                      onChange={(value) => edit((next) => void (next.modules[index]!.name = value))}
                    />,
                    <CellSelect
                      key="kind"
                      value={item.kind}
                      disabled={!canSave}
                      options={CATALOG_MODULE_KINDS.map((kind) => ({ value: kind, label: kind }))}
                      onChange={(value) =>
                        edit((next) => void (next.modules[index]!.kind = value as CatalogModule["kind"]))
                      }
                    />,
                    <StagePicker
                      key="stages"
                      stages={draft.stages}
                      value={item.stageIds}
                      disabled={!canSave}
                      onChange={(stageIds) => edit((next) => void (next.modules[index]!.stageIds = stageIds))}
                    />,
                    <Reorder
                      key="order"
                      index={index}
                      total={draft.modules.length}
                      disabled={!canSave}
                      onMove={(delta) => edit((next) => void (next.modules = swap(next.modules, index, index + delta)))}
                    />,
                    <RemoveButton
                      key="remove"
                      disabled={!canSave}
                      label={`模块「${item.name}」`}
                      onRemove={() =>
                        confirmRemove(
                          `模块「${item.name}」`,
                          () => edit((next) => removeModule(next, index)),
                          offersOfDimension(offers, "module", item.id).length,
                        )
                      }
                    />,
                  ],
                }))}
              />
            )}
          </div>
        )}

        {tab === "formats" && (
          <Table
            headers={["名称", "最少人数", "最多人数", "计价模式", "顺序", ""]}
            rows={draft.formats.map((format, index) => ({
              key: format.id === "" ? `new-format-${String(index)}` : format.id,
              cells: [
                <CellInput
                  key="name"
                  value={format.name}
                  disabled={!canSave}
                  placeholder="班型名"
                  onChange={(value) => edit((next) => void (next.formats[index]!.name = value))}
                />,
                <CellNumber
                  key="min"
                  value={format.minSize}
                  disabled={!canSave}
                  onChange={(value) => edit((next) => void (next.formats[index]!.minSize = value))}
                />,
                <CellNumber
                  key="max"
                  value={format.maxSize}
                  disabled={!canSave}
                  onChange={(value) => edit((next) => void (next.formats[index]!.maxSize = value))}
                />,
                <CellSelect
                  key="mode"
                  value={format.mode}
                  disabled={!canSave}
                  options={[
                    { value: "系数", label: "系数（按人数打折）" },
                    { value: "分摊", label: "分摊（按人数平分）" },
                  ]}
                  onChange={(value) =>
                    edit((next) => void (next.formats[index]!.mode = value as CatalogFormat["mode"]))
                  }
                />,
                <Reorder
                  key="order"
                  index={index}
                  total={draft.formats.length}
                  disabled={!canSave}
                  onMove={(delta) => edit((next) => void (next.formats = swap(next.formats, index, index + delta)))}
                />,
                <RemoveButton
                  key="remove"
                  disabled={!canSave}
                  label={`班型「${format.name}」`}
                  onRemove={() =>
                    confirmRemove(
                      `班型「${format.name}」`,
                      () => edit((next) => removeFormat(next, index)),
                      offersOfDimension(offers, "format", format.id).length,
                    )
                  }
                />,
              ],
            }))}
          />
        )}

              </Panel>

      <p className="mb-8 text-xs leading-relaxed text-ink-500">
        保存后，后台各处的「班型」下拉与课程库的「可开班型」立刻按这份表走；
        宣传网站上的展示要**重新构站**（<code className="rounded bg-ink-50 px-1">npm run build</code>）才更新。
        删一个维度之前先确认没有课程 / 报课 / 排课还在引用它：服务端会拦住悬空引用，
        但「已经没人用了」这件事只有你知道。
      </p>
    </>
  );
}

/**
 * 学科按分组分节展示。
 *
 * 编辑界面要**一次看全**（所以与网站上的"按学段逐层展开"不同）：这里只按
 * `parentIds` 分节，没归组的统一放进「（不分组的学科 / 项目）」。
 * 学段那件事在每一行的「开设学段」里勾，不在这里再分一层。
 */
function subjectSections(
  catalog: Catalog,
  groups: CatalogSubject[],
): Array<{ groupId: string; groupName: string; rows: Array<{ subject: CatalogSubject; index: number }> }> {
  const withIndex = catalog.subjects.map((subject, index) => ({ subject, index }));
  const groupIds = new Set(groups.map((group) => group.id));
  const sections = [
    {
      groupId: "",
      groupName: "（不分组的学科 / 项目）",
      rows: withIndex.filter(({ subject }) => subject.parentIds.every((id) => !groupIds.has(id))),
    },
    ...groups.map((group) => ({
      groupId: group.id,
      groupName: group.name,
      rows: withIndex.filter(({ subject }) => subject.parentIds.includes(group.id)),
    })),
  ];
  // 空分组仍然显示（那是"分组还在、下面暂时没东西"），但空的那一节不必占位
  return sections.filter((section) => section.rows.length > 0 || section.groupId !== "");
}

function countOf(catalog: Catalog, tab: TabKey): number {
  if (tab === "stages") return catalog.stages.length;
  if (tab === "subjects") return catalog.subjects.length;
  if (tab === "modules") return catalog.modules.length;
  return catalog.formats.length;
}

/** 新增一行：id 留空，保存前由 `assignCatalogIds` 按名字补（见那里的注释）。 */
function addRow(
  tab: TabKey,
  moduleSubjectId: string,
  edit: (change: (next: Catalog) => void) => void,
): void {
  edit((next) => {
    if (tab === "stages") {
      const stage: CatalogStage = { id: "", name: "", order: next.stages.length + 1, note: "" };
      next.stages.push(stage);
      return;
    }
    if (tab === "subjects") {
      const subject: CatalogSubject = {
        id: "",
        name: "",
        kind: "学科",
        parentIds: [],
        order: next.subjects.length + 1,
        stageIds: next.stages[0] === undefined ? [] : [next.stages[0].id],
        note: "",
      };
      next.subjects.push(subject);
      return;
    }
    if (tab === "modules") {
      const item: CatalogModule = {
        id: "",
        parentId: "",
        subjectId: moduleSubjectId,
        name: "",
        kind: "教材进度",
        order: next.modules.length + 1,
        stageIds: next.stages[0] === undefined ? [] : [next.stages[0].id],
      };
      next.modules.push(item);
      return;
    }
    if (tab === "formats") {
      const format: CatalogFormat = {
        id: "",
        name: "",
        minSize: 1,
        maxSize: 1,
        mode: "系数",
        order: next.formats.length + 1,
      };
      next.formats.push(format);
      return;
    }
  });
}

function removeStage(catalog: Catalog, index: number): void {
  catalog.stages.splice(index, 1);
}

/**
 * 删学科：挂在它下面的模块、以及"我这个分组"的归属要一起清掉。
 * 不清的话保存时全是悬空引用 —— 那时报的错会指向一堆看起来无关的行。
 */
function removeSubject(catalog: Catalog, index: number): void {
  const target = catalog.subjects[index];
  if (target === undefined) return;
  catalog.subjects.splice(index, 1);
  catalog.modules = catalog.modules.filter((item) => item.subjectId !== target.id);
  for (const subject of catalog.subjects) {
    subject.parentIds = subject.parentIds.filter((id) => id !== target.id);
  }
}

function removeModule(catalog: Catalog, index: number): void {
  catalog.modules.splice(index, 1);
}

function removeFormat(catalog: Catalog, index: number): void {
  catalog.formats.splice(index, 1);
}

/**
 * 删除前的确认。
 *
 * `affected` 是**引用这一行的开放组合条数**（「开放矩阵」页里勾过的那些）：
 * 保存时会连同它们一起清掉（服务层做了这件事并把条数写进日志），
 * 因此这里必须先说清 —— 删除一个班型顺带清掉 20 条组合，是机构要知道的代价。
 */
function confirmRemove(label: string, remove: () => void, affected = 0): void {
  const tail =
    affected === 0
      ? ""
      : `\n\n它还被 ${String(affected)} 条开放组合引用着（「开放矩阵」页里勾过的），保存后会连同那些设置一起清除。`;
  if (window.confirm(`删除${label}？保存之后才生效。${tail}`)) remove();
}

/** 简易表格（后台这些表都是"一行若干控件"，不需要排序 / 分页）。 */
function Table({
  headers,
  rows,
  className,
}: {
  headers: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className={cn("px-4 py-6 text-sm text-ink-400", className)}>
        还没有内容，点右上角「新增」加一条。
      </p>
    );
  }
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[50rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
            {headers.map((header, index) => (
              <th key={`${header}-${String(index)}`} className="px-4 py-2 font-normal">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-ink-50 last:border-0">
              {row.cells.map((cell, index) => (
                <td key={`${row.key}-${String(index)}`} className="px-4 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/*
 * 表格里的控件：表头已经写了字段名，因此不再用 `TextField`（它的标签在上，
 * 空标签也占一行高度）。样式仍取自 `AdminFields` 的 `CONTROL_CLASS`（只有一处定义）。
 */
function CellInput({
  value,
  disabled,
  placeholder,
  onChange,
}: {
  value: string;
  disabled: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className={cn(CONTROL_CLASS, "min-w-[7rem]")}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function CellNumber({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      className={cn(CONTROL_CLASS, "w-20")}
      value={Number.isFinite(value) ? value : 1}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function CellSelect({
  value,
  disabled,
  options,
  onChange,
}: {
  value: string;
  disabled: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className={cn(CONTROL_CLASS, "min-w-[7rem]")}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** 上移 / 下移（顺序就是后台与网站上的展示顺序）。 */
function Reorder({
  index,
  total,
  disabled,
  onMove,
}: {
  index: number;
  total: number;
  disabled: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
        title="上移"
        className="rounded border border-ink-200 px-1.5 py-0.5 text-xs text-ink-500 hover:border-ink-300 disabled:opacity-40"
      >
        ↑
      </button>
      <button
        type="button"
        disabled={disabled || index === total - 1}
        onClick={() => onMove(1)}
        title="下移"
        className="rounded border border-ink-200 px-1.5 py-0.5 text-xs text-ink-500 hover:border-ink-300 disabled:opacity-40"
      >
        ↓
      </button>
    </span>
  );
}

function RemoveButton({
  disabled,
  label,
  onRemove,
}: {
  disabled: boolean;
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRemove}
      title={`删除${label}`}
      className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:border-danger-100 hover:text-danger-600 disabled:opacity-40"
    >
      删除
    </button>
  );
}

/** 「在哪些学段开」的勾选（就 5 个学段，平铺比下拉直观）。 */
function StagePicker({
  stages,
  value,
  disabled,
  onChange,
}: {
  stages: CatalogStage[];
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  if (stages.length === 0) return <span className="text-xs text-ink-400">先加学段</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {stages.map((stage) => {
        const on = value.includes(stage.id);
        return (
          <button
            key={stage.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((id) => id !== stage.id) : [...value, stage.id])}
            className={cn(
              "rounded-sm border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-40",
              on
                ? "border-brand-400 bg-brand-50 text-brand-700"
                : "border-ink-200 text-ink-500 hover:border-ink-300",
            )}
          >
            {stage.name === "" ? "（新学段）" : stage.name}
          </button>
        );
      })}
    </span>
  );
}
