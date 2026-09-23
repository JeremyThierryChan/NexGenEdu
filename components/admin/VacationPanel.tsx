"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { api, type Catalog, type SiteCopyBlock, type VacationPeriod } from "@/lib/backend/api";
import {
  validateVacations,
  vacationOverlaps,
  windowsFromSchedule,
  type WindowGroup,
} from "@/lib/backend/calendar-plan";
import { sortedStages } from "@/lib/backend/catalog";

/**
 * 假期与作息（后台「日历」页「假期与作息」页签里的一块）。
 *
 * ## 这一块管什么
 *
 *   1. **寒暑假段**（手动录入，按学段）：机构口径是"起止日期每次手动输入"，
 *      因此这里不做任何推算（不按农历、不按往年）；录入之后
 *      `lib/backend/calendar-plan.ts` 会把落在段内的每一天判成"假期作息"；
 *   2. **两组上课时段**（只读）：直接读「网站内容 → 时间安排」里那两组 ——
 *      机构原话是「作息和现在的周末上课时间完全一样」，
 *      再造一份配置必然与网站上公布的时间漂开（家长看到的时间与排课用的时间不一致）。
 *      因此这里只显示 + 给一个「去改」的入口。
 *
 * ## 这一版不改排课
 *
 * 机构明确「后续的排课再另外安排」：本面板只把"哪天适用哪一组时段"摆出来，
 * 批量排课的日期生成（`lib/backend/recurrence.ts`）一行都没动。页面上也这么写着 ——
 * 不写清的话，人会以为"录了寒暑假，排课就自动按假期排了"（那种误会要等到排错课才发现）。
 */

/** 假期段按开始日期排序（页面上按时间读）。 */
function sortPeriods(rows: readonly VacationPeriod[]): VacationPeriod[] {
  return [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
}

/** 一段覆盖多少天（含首尾）—— 让机构一眼看出自己有没有填错月份。 */
function daySpan(start: string, end: string): number {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * `schedule` 是「网站内容 → 时间安排」那一块文案（从 `api.site.publicContent()` 读来）。
 * 本面板不自己去取：它只管显示与编辑寒暑假段，时段那一块是**只读的引用**。
 */
export function VacationPanel({ schedule }: { schedule: SiteCopyBlock | undefined }) {
  const [saved, setSaved] = useState<VacationPeriod[] | null>(null);
  const [draft, setDraft] = useState<VacationPeriod[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const notice = useActionNotice();

  const roles = rolesOrAll(useAuth());
  const canWrite = canCallMethod(roles, "vacations.save");

  const load = useCallback(async () => {
    try {
      const [periods, dimensions] = await Promise.all([api.vacations.list(), api.catalog.list()]);
      setSaved(periods);
      setDraft(periods);
      setCatalog(dimensions);
    } catch (cause) {
      notice.fail(cause instanceof Error ? cause.message : "读不到寒暑假段。");
    } finally {
      setLoading(false);
    }
    // notice 每次渲染都是新对象，不放进依赖（放进会让 load 每次都变 → 无限循环）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    [draft, saved],
  );

  const problems = useMemo(
    () => (draft === null || catalog === null ? [] : validateVacations(draft, catalog)),
    [draft, catalog],
  );
  const overlaps = useMemo(() => (draft === null ? [] : vacationOverlaps(draft)), [draft]);

  const stageOptions = useMemo(
    () => (catalog === null ? [] : sortedStages(catalog).map((stage) => stage.name)),
    [catalog],
  );
  const stageNameToId = useMemo(
    () => new Map((catalog?.stages ?? []).map((stage) => [stage.name, stage.id] as const)),
    [catalog],
  );
  const stageIdToName = useMemo(
    () => new Map((catalog?.stages ?? []).map((stage) => [stage.id, stage.name] as const)),
    [catalog],
  );

  /** 两组时段：从「课程时间安排」那一块文案里读（读不到时 `missing`，下面会明说）。 */
  const windows = useMemo(() => {
    const groups: WindowGroup[] = ["工作日", "周末"];
    return groups.map((group) => windowsFromSchedule(schedule, group));
  }, [schedule]);

  function edit(change: (rows: VacationPeriod[]) => void): void {
    setDraft((prev) => {
      if (prev === null) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as VacationPeriod[];
      change(next);
      return next;
    });
    notice.clear();
  }

  function addPeriod(): void {
    const year = new Date().getFullYear();
    edit((rows) => {
      rows.push({
        id: "",
        name: "寒假",
        kind: "寒假",
        stageIds: [],
        // 起止留空、由机构自己填：预填一个"看起来很像"的日期，很容易被当成系统算出来的
        startDate: `${String(year)}-01-20`,
        endDate: `${String(year)}-02-20`,
        note: "",
      });
    });
  }

  /** 复制某一段（少填几个日期：寒假/暑假每年形状差不多）。 */
  function duplicate(row: VacationPeriod): void {
    edit((rows) => {
      rows.push({ ...row, id: "", name: `${row.name}（复制）` });
    });
  }

  async function save(): Promise<void> {
    if (draft === null) return;
    await notice.run(
      async () => await api.vacations.save(draft),
      (next) => {
        setSaved(next);
        setDraft(next);
        return next.length === 0 ? "已保存：寒暑假段清空。" : `已保存 ${String(next.length)} 段。`;
      },
    );
  }

  return (
    <Panel
      className="mt-4"
      title="寒暑假段（手动录入，按学段）"
      description="落在段内的每一天都按「假期作息」= 与周末同一组时段（机构口径：作息和现在的周末上课时间完全一样）。起止日期每年自己填，系统不推算。"
      actions={
        canWrite ? (
          <>
            <Button variant="outline" size="sm" onClick={addPeriod}>
              新增一段
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={notice.pending || !dirty || problems.length > 0}>
              {notice.pending ? "保存中…" : dirty ? "保存修改" : "已保存"}
            </Button>
          </>
        ) : (
          <span className="text-xs text-ink-500">
            你的角色（{roles.join(" · ")}）只能看：改寒暑假段归 {methodOwnerText("vacations.save")}
          </span>
        )
      }
    >
      <div className="space-y-3 px-4 py-4">
        <ActionNoticeView notice={notice} />

        {loading ? (
          <p className="text-sm text-ink-400">加载中…</p>
        ) : (draft ?? []).length === 0 ? (
          <p className="text-sm text-ink-400">
            还没有录入任何寒暑假段。没有录的时候，日历上每一天都只按「星期几」判定
            （工作日 / 周末），与今天的行为一致。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                  {["名称", "类别", "学段", "起", "止", "天数", ""].map((header) => (
                    <th key={header} className="px-2 py-2 font-normal">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortPeriods(draft ?? []).map((row) => {
                  const index = (draft ?? []).findIndex((item) => item === row || item.id === row.id);
                  const span = daySpan(row.startDate, row.endDate);
                  return (
                    <tr key={row.id === "" ? `new-${String(index)}` : row.id} className="border-b border-ink-50 last:border-0">
                      <td className="px-2 py-2 align-top">
                        <input
                          className="w-36 rounded-md border border-ink-300 px-2 py-1 text-sm"
                          value={row.name}
                          disabled={!canWrite}
                          onChange={(event) => edit((rows) => void (rows[index]!.name = event.target.value))}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <select
                          className="rounded-md border border-ink-300 bg-white px-2 py-1 text-sm"
                          value={row.kind}
                          disabled={!canWrite}
                          onChange={(event) =>
                            edit((rows) => void (rows[index]!.kind = event.target.value as VacationPeriod["kind"]))
                          }
                        >
                          {["寒假", "暑假", "其他"].map((kind) => (
                            <option key={kind} value={kind}>
                              {kind}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <MultiSelect
                          label=""
                          options={stageOptions.map((name) => ({ value: name }))}
                          value={row.stageIds.map((id) => stageIdToName.get(id) ?? id)}
                          onChange={(names) =>
                            edit(
                              (rows) =>
                                void (rows[index]!.stageIds = names
                                  .map((name) => stageNameToId.get(name) ?? "")
                                  .filter((id) => id !== "")),
                            )
                          }
                          placeholder="选择学段"
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="date"
                          className="rounded-md border border-ink-300 px-2 py-1 text-sm"
                          value={row.startDate}
                          disabled={!canWrite}
                          onChange={(event) => edit((rows) => void (rows[index]!.startDate = event.target.value))}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="date"
                          className="rounded-md border border-ink-300 px-2 py-1 text-sm"
                          value={row.endDate}
                          disabled={!canWrite}
                          onChange={(event) => edit((rows) => void (rows[index]!.endDate = event.target.value))}
                        />
                      </td>
                      <td className="px-2 py-2 align-top text-xs text-ink-500">
                        {span > 0 ? `${String(span)} 天` : "—"}
                      </td>
                      <td className="px-2 py-2 align-top text-xs">
                        {canWrite ? (
                          <span className="flex gap-2">
                            <button
                              type="button"
                              className="text-ink-500 hover:text-brand-700"
                              onClick={() => duplicate(row)}
                            >
                              复制
                            </button>
                            <button
                              type="button"
                              className="text-ink-500 hover:text-danger-600"
                              onClick={() =>
                                edit((rows) => {
                                  rows.splice(index, 1);
                                })
                              }
                            >
                              删除
                            </button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {problems.length > 0 && (
          <ul className="list-disc space-y-1 rounded-md border border-danger-100 bg-danger-50 px-5 py-2.5 text-xs text-danger-600">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {overlaps.length > 0 && (
          <div className="rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
            <p className="font-medium">有重叠的段（允许，但确认一下）：</p>
            {overlaps.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p className="mt-1">重叠的那几天会按「最早开始」的那一段显示。</p>
          </div>
        )}

        {/* 两组时段：只读，来源是「网站内容 → 时间安排」 */}
        <div className="rounded-md border border-ink-200 bg-ink-50 px-3.5 py-3">
          <p className="text-xs font-medium text-ink-700">两组上课时段（只读）</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            来源是「网站内容 → 时间安排」里那两组 —— 网站上公布的时间与这里判定的口径**必须是同一份**，
            因此这里不给第二套配置。
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {windows.map((lookup) => (
              <div key={lookup.group} className="rounded-md border border-ink-200 bg-white px-3 py-2">
                <p className="text-xs font-medium text-ink-700">
                  {lookup.group}组
                  {lookup.groupTitle === "" ? "" : `（${lookup.groupTitle}）`}
                </p>
                {lookup.missing ? (
                  <p className="mt-1 text-xs leading-relaxed text-warning-700">
                    没读到这一组时段。请到
                    <Link href="/admin/content" className="mx-1 underline">
                      「网站内容 → 时间安排」
                    </Link>
                    确认分组标题里含「{lookup.group}」与「排课」。
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-600">
                    {lookup.windows.map((window) => (
                      <li key={`${window.label}-${window.raw}`}>
                        {window.label}：{window.raw}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            <Link href="/admin/content" className="underline">
              去「网站内容 → 时间安排」改时段
            </Link>
          </p>
        </div>

        {/*
          口径：这一版**不改排课**（机构明确"后续的排课再另外安排"）。
          不写清的话，人会以为录了寒暑假、排课就自动按假期作息排了。
        */}
        <p className="text-xs leading-relaxed text-ink-500">
          <strong className="font-medium">这一版只把口径摆出来，不改排课。</strong>
          批量排课（「课程安排」页）现在仍然按你说的「每周几 + 几点」生成，
          教室可用时段也仍按每间教室自己配的算 —— 遇到假期与调休请照旧手动挪课。
          等排课那一步接上这份判定之后，页面上的提示会跟着改。
        </p>
      </div>
    </Panel>
  );
}
