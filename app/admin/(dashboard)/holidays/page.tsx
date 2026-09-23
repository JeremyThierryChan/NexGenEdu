"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { DataNotice } from "@/components/admin/DataNotice";
import { useAuth, rolesOrAll } from "@/components/admin/AuthContext";
import { canAccess, HOLIDAY_ACTION_ACCESS } from "@/lib/auth/roles";
import { formatMonthDay } from "@/lib/backend/format";
import {
  holidayWeekdayLabel,
  parseDateKey,
  summarizeHolidayYear,
  type HolidayDay,
} from "@/lib/backend/holidays";
import {
  loadHolidayTable,
  refreshHolidayYears,
  type HolidayRefreshResult,
  type HolidayTableView,
} from "@/lib/backend/holidays-client";

/**
 * 节假日（法定节假日与调休上班日的年度表）。
 *
 * ## 这一页解决的是什么（以及**不**解决什么）
 *
 * 机构要知道"哪天是法定假日、哪天是调休上班日"：家长会问、排课要看、
 * 节假日前后是旺季（假期里白天能排课，而调休上班的那几个周末学生要上学、
 * 白天的课得挪到晚上）。
 *
 * **它不会改排课**：批量排课（`lib/backend/recurrence.ts`）与教室可用时段
 * （`isWithinAvailability`）这一版仍然"按星期几"算，遇到调休与节假日**手动处理**
 * —— 这句话写在四处（`recurrence.ts`、`LessonSeriesForm.tsx`、使用手册、后台API约定），
 * 这一页出现之后它们**依然成立**。页面上必须把这件事写在显眼处（下面那句提示），
 * 否则会有人以为"排课已经自动跳过假期了"，而那种误会要等到家长投诉才会被发现。
 *
 * 为什么先做"只读的表"：把这张表接进排课要先把"假期到底是上课还是停课"定下来
 * （机构已定方向：假期按假期作息、调休上班日按工作日作息），
 * 半截做了比不做更危险 —— 排课会静默地少排或排错，而"少排了一节课"没有任何提示。
 *
 * ## 数据从哪来
 *
 * 后端抓两个公开来源（Apple 的「中国大陆节假日」日历 + 国务院公告口径的 JSON）、
 * **逐日比对一致才写入**（`data/holidays/<年>.json`）。这一页把两个来源的地址、
 * 内容指纹、校验结论都显示出来 —— 这种数据一年只看一两次，不把"它的出处与校验结果"
 * 摆出来，就没有人会去核对它。
 */

/** 逐日表按月份分组（一年 39 天的表摊平了不好找，按月份分段后一眼能扫完）。 */
function byMonth(days: HolidayDay[]): { month: number; days: HolidayDay[] }[] {
  const groups = new Map<number, HolidayDay[]>();
  for (const day of days) {
    const month = Number(day.date.slice(5, 7));
    const list = groups.get(month) ?? [];
    list.push(day);
    groups.set(month, list);
  }
  return [...groups.entries()]
    .map(([month, list]) => ({ month, days: list }))
    .sort((a, b) => a.month - b.month);
}

/**
 * 「2026-02-15」→「2月15日」。
 *
 * 先解析成**本地**日期再交给 `formatMonthDay`：直接传字符串的话，
 * `new Date("2026-02-15")` 按 UTC 午夜解析、再用本地 `getDate()` 读 ——
 * 在 UTC 以西的时区会显示成 2 月 14 日。这份表里全是本地日历日，必须按本地算。
 */
function monthDay(date: string): string {
  const parsed = parseDateKey(date);
  return parsed === null ? date : formatMonthDay(parsed);
}

export default function AdminHolidaysPage() {
  const auth = useAuth();
  const roles = rolesOrAll(auth);
  /** 能不能抓取：读的是 `lib/auth/roles.ts` 那一份（与后端同一个来源）。 */
  const canRefresh = canAccess(roles, HOLIDAY_ACTION_ACCESS["holidays.refresh"] ?? []);

  const [table, setTable] = useState<HolidayTableView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<HolidayRefreshResult[]>([]);
  /** 正在看哪一年（默认：今年；今年没有数据时退回有数据的最近一年）。 */
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  /**
   * 读表。
   *
   * `quiet: true` = **安静刷新**：页面上已经有表时**不进加载态** —— 加载态与"读不出来"
   * 那一屏共用（`if (table === null)` 才换整页），刷新时把高度塌掉就可能让浏览器
   * 把滚动位置夹回顶部（见使用手册 §15.3）。首屏那一次仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    try {
      const outcome = await loadHolidayTable();
      if (!outcome.ok) {
        setLoadError(outcome.error);
        setTable(null);
        return;
      }
      setLoadError("");
      setTable(outcome.table);
    } catch (cause) {
      setLoadError(`读取节假日表时出错：${cause instanceof Error ? cause.message : String(cause)}`);
      setTable(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 抓取（技术管理员）。抓完**总是**重读整表：年份可能变多，也可能什么都没写成。 */
  async function refresh(): Promise<void> {
    setRefreshing(true);
    setError("");
    setMessage("");
    setResults([]);
    try {
      const outcome = await refreshHolidayYears();
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setResults(outcome.results);
      setTable(outcome.table);
      const written = outcome.results.filter((item) => item.status === "written");
      const published = outcome.results.filter((item) => item.status === "not-published");
      setMessage(
        written.length > 0
          ? `已抓取并写入：${written.map((item) => `${item.year} 年（${item.dayCount} 天）`).join("、")}。`
          : published.length === outcome.results.length
            ? "两个来源都还没有下一年的安排 —— 国务院通常在上一年 11 月公布，这是正常情况。"
            : "这次没有写入任何年份（原因见下面的逐条结果）。",
      );
    } catch (cause) {
      setError(`抓取出错：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setRefreshing(false);
    }
  }

  const years = useMemo(() => table?.years ?? [], [table]);
  /**
   * 可选的年份：**只有真的抓到数据的那些**（降序，最近的在前）。
   *
   * 刻意**不放**"该有却没有"的年份（例如还没公布的明年）。一个测试出来的教训：
   * 早先把它们一起放进来，于是每年 1 月（今年刚过、数据还是去年的）默认会选中"今年"，
   * 而那一年没有数据 —— 页面就只剩上面那张概览表，人会以为这个功能坏了。
   * 缺哪一年由上面那条提示单独说，比混进年份按钮里清楚得多。
   */
  const yearChoices = useMemo(() => years.map((item) => item.year).sort((a, b) => b - a), [years]);

  const current = useMemo(() => {
    if (selectedYear === null) return years[years.length - 1] ?? null;
    return years.find((item) => item.year === selectedYear) ?? null;
  }, [years, selectedYear]);

  /*
   * 选中的那一年。默认"今年"（`coverage.currentYear`）；这一年没有数据时退回**最近有数据的**
   * 那一年 —— 默认选一个空年份会让第一次打开这一页的人看到一片"没有数据"，
   * 而其实旁边那几年是有的（`yearChoices` 里只有有数据的年份，这条判断因此总是能成立）。
   */
  useEffect(() => {
    if (yearChoices.length === 0) return;
    setSelectedYear((previous) => {
      if (previous !== null && yearChoices.includes(previous)) return previous;
      const thisYear = table?.coverage.currentYear;
      if (thisYear !== undefined && yearChoices.includes(thisYear)) return thisYear;
      return yearChoices[0] ?? null;
    });
  }, [yearChoices, table]);

  /** 读不出来时**不能白屏**：把服务端（或网络）那句原话显示出来。 */
  if (table === null) {
    return (
      <>
        <PageHeading title="节假日" description="法定节假日与调休上班日的年度表。" />
        <Panel
          className="mt-6"
          title={loading ? "正在读取节假日表…" : "这一页打不开"}
          description="这张表存在后端那台机器上，因此要先连上后端。"
        >
          <div className="space-y-3 px-4 py-4">
            {!loading && (
              <>
                <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
                  {loadError === "" ? "节假日表读不出来（原因未知）。" : loadError}
                </p>
                <p className="text-xs leading-relaxed text-ink-500">
                  这张表本身<strong className="font-medium">不依赖外网</strong>（读的是后端机器上已经抓下来的文件），所以打不开多半是后端没在跑或登录过期 ——
                  两者都能在顶栏看到。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void load({ quiet: true })}>
                    重试
                  </Button>
                  <Link
                    href="/admin"
                    className="inline-flex h-8 items-center rounded-md border border-ink-300 px-3 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
                  >
                    回今日概览
                  </Link>
                </div>
              </>
            )}
          </div>
        </Panel>
      </>
    );
  }

  const summary = current === null ? null : summarizeHolidayYear(current.days);
  const missing = table.coverage.missing;

  return (
    <>
      <PageHeading
        title="节假日"
        description="法定节假日与调休上班日的年度表：两个公开来源逐日比对一致才写入。"
      />

      {/*
        `DataNotice` 不接受 className（它的版式由自己那一份最小高度管着，见
        `lib/admin/notice-layout.ts`），所以间距由外面这层 div 给。
        传入的刷新走**安静刷新**：这一页已经有表时不该进加载态（理由见 load 的说明）。
      */}
      <div className="mt-4">
        <DataNotice onRefresh={() => load({ quiet: true })} />
      </div>

      {/*
        这句话是这一页最重要的一行：没有它，看到"调休上班日"的人会以为排课已经自动处理了。
        与 `recurrence.ts` / `LessonSeriesForm.tsx` / 使用手册 / 后台API约定 里那四句
        「调休与节假日请手动处理」是同一件事，界面上必须说清。
      */}
      <div className="mt-4 rounded-md border border-accent-300 bg-accent-50 px-4 py-3 text-sm leading-relaxed text-ink-800">
        <p className="font-medium">这张表只供查看，不会自动改排课。</p>
        <p className="mt-1">
          「课程安排」里的批量排课仍然是<strong className="font-medium">按星期几往后数</strong>
          （不识别调休、节假日、寒暑假），教室可用时段也是按星期几配的 ——
          遇到调休与节假日，请像现在这样<strong className="font-medium">手动处理</strong>
          （挪课改单节时间、缺课走「待补课」）。
        </p>
      </div>

      {missing.length > 0 && (
        <p className="mt-3 rounded-md border border-ink-200 bg-white px-4 py-3 text-xs leading-relaxed text-ink-600">
          <strong className="font-medium text-ink-800">
            {missing.join("、")} 年还没有数据。
          </strong>{" "}
          国务院通常在上一年 11 月公布次年安排，公布前没有数据是正常的（本系统<strong className="font-medium">不会</strong>把「没有数据」
          当成「全年无假期」）。{canRefresh ? "等公布后点下面的「重新抓取」即可。" : "公布后请让技术管理员抓取一次。"}
        </p>
      )}

      {table.errors.length > 0 && (
        <div className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <p className="font-medium">有 {table.errors.length} 个年份的文件读不出来：</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed">
            {table.errors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed">
            这些年份<strong className="font-medium">不会</strong>被当成「没有假期」，因此这里必须显眼 —— 静默少一年，排课就会照着错的日历走。
          </p>
        </div>
      )}

      {message !== "" && (
        <p role="status" className="mt-4 rounded-md border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {message}
        </p>
      )}
      {error !== "" && (
        <p role="alert" className="mt-4 rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-600">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <Panel className="mt-4" title="这次抓取的结果" description="逐条列出每年的结局与两个来源的状态。">
          <div className="space-y-3 px-4 py-4">
            {results.map((item) => (
              <div key={item.year} className="rounded-md border border-ink-200 px-3 py-2">
                <p className="text-sm font-medium text-ink-800">
                  {item.year} 年：{STATUS_TEXT[item.status]}
                  {item.status === "written" ? `（${item.dayCount} 天）` : ""}
                </p>
                {item.error !== "" && <p className="mt-1 text-xs leading-relaxed text-ink-600">{item.error}</p>}
                <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-ink-500">
                  {item.sources.map((source) => (
                    <li key={source.id}>
                      {source.ok ? "✓" : "✗"} {source.label}：
                      {source.ok ? `${source.days} 天　${source.fingerprint}` : source.note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {canRefresh && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" aria-disabled={refreshing} className={refreshing ? "pointer-events-none opacity-60" : ""} onClick={() => void refresh()}>
            {refreshing ? "抓取中…" : "重新抓取（今年与明年）"}
          </Button>
          <span className="text-xs leading-relaxed text-ink-500">
            抓的是 {table.sources.map((source) => source.label).join(" 与 ")}
            ，两个来源逐日比对一致才会写入
            {table.sources.some((source) => source.mirrorCount > 0)
              ? "（每个来源都配了备用地址，主地址不通时自动换一个）"
              : ""}
            。
          </span>
        </div>
      )}

      <Panel
        className="mt-6"
        title="各年份一览"
        description="放假 = 法定假日；调休上班 = 周末被调成工作日的那些天。"
      >
        <div className="overflow-x-auto px-4 py-4">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                <th className="py-2 pr-3 font-medium">年份</th>
                <th className="py-2 pr-3 font-medium">放假</th>
                <th className="py-2 pr-3 font-medium">调休上班</th>
                <th className="py-2 pr-3 font-medium">最长连休</th>
                <th className="py-2 pr-3 font-medium">抓取时间</th>
                <th className="py-2 font-medium">来源校验</th>
              </tr>
            </thead>
            <tbody>
              {years.map((item) => {
                const info = summarizeHolidayYear(item.days);
                return (
                  <tr key={item.year} className="border-b border-ink-100 last:border-0">
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setSelectedYear(item.year)}
                        className={
                          current?.year === item.year
                            ? "font-medium text-brand-700 underline"
                            : "text-ink-700 underline-offset-2 hover:text-brand-700 hover:underline"
                        }
                      >
                        {item.year}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-ink-700">{info.offDays} 天</td>
                    <td className="py-2 pr-3 text-ink-700">{info.workDays} 天</td>
                    <td className="py-2 pr-3 text-ink-700">{info.longestOff} 天</td>
                    <td className="py-2 pr-3 text-xs text-ink-500">{item.fetchedAt.slice(0, 10)}</td>
                    <td className="py-2 text-xs text-ink-500">
                      {item.verdict.agree ? "两个来源一致" : <span className="text-danger-600">未通过校验</span>}
                    </td>
                  </tr>
                );
              })}
              {years.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-sm text-ink-500">
                    还没有任何年份的数据。
                    {canRefresh ? "点上面的「重新抓取」从公开来源取一次。" : "请让技术管理员抓取一次。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {current !== null && summary !== null && (
        <Panel
          className="mt-6"
          title={`${current.year} 年　放假 ${summary.offDays} 天 · 调休上班 ${summary.workDays} 天 · 最长连休 ${summary.longestOff} 天`}
          description={`两个来源：${current.sources.map((source) => `${source.label}（${source.days} 天）`).join("；")}　抓取于 ${current.fetchedAt.slice(0, 10)}`}
        >
          <div className="space-y-5 px-4 py-4">
            <div>
              <p className="text-xs font-medium text-ink-600">连休（放假）</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {summary.offBlocks.map((block) => (
                  <li
                    key={`${block.from}-${block.to}`}
                    className="rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs text-brand-900"
                  >
                    {block.names.join(" + ")}　{monthDay(block.from)}
                    {block.to === block.from ? "" : `–${monthDay(block.to)}`}　共 {block.days} 天
                  </li>
                ))}
                {summary.offBlocks.length === 0 && <li className="text-xs text-ink-500">这一年没有放假数据。</li>}
              </ul>
            </div>

            {summary.workBlocks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ink-600">调休上班（这些周末要上班/上学）</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {summary.workBlocks.map((block) => (
                    <li
                      key={block.from}
                      className="rounded-md border border-accent-300 bg-accent-50 px-3 py-1.5 text-xs text-ink-800"
                    >
                      {monthDay(block.from)}（{holidayWeekdayLabel(block.from)}）
                      {block.names.length > 0 ? `　${block.names.join(" + ")}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-4">
              {byMonth(current.days).map((group) => (
                <div key={group.month}>
                  <p className="text-xs font-medium text-ink-600">{group.month} 月</p>
                  <table className="mt-1 w-full border-collapse text-sm">
                    <tbody>
                      {group.days.map((day) => (
                        <tr key={`${day.date}-${day.kind}`} className="border-b border-ink-100 last:border-0">
                          <td className="w-28 py-1.5 pr-3 text-ink-700">{monthDay(day.date)}</td>
                          <td className="w-14 py-1.5 pr-3 text-xs text-ink-500">{holidayWeekdayLabel(day.date)}</td>
                          <td className="py-1.5 pr-3 text-ink-700">{day.name}</td>
                          <td className="w-24 py-1.5 text-xs">
                            <span
                              className={
                                day.kind === "放假"
                                  ? "rounded bg-brand-100 px-1.5 py-0.5 text-brand-800"
                                  : "rounded bg-accent-100 px-1.5 py-0.5 text-ink-800"
                              }
                            >
                              {day.kind}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-ink-200 px-3 py-2 text-xs leading-relaxed text-ink-500">
              <p className="font-medium text-ink-600">这份数据是怎么来的</p>
              <ul className="mt-1 space-y-0.5">
                {current.sources.map((source) => (
                  <li key={source.id}>
                    {source.ok ? "✓" : "✗"} {source.label}：{source.days} 天　{source.fingerprint}
                    <br />
                    <span className="break-all">{source.url}</span>
                  </li>
                ))}
              </ul>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {current.verdict.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <p className="mt-2">
                文件：<span className="break-all">{table.dir}/{current.year}.json</span>
                　（这份表可以手工改：改完刷新这一页即可，读的时候会校验，坏数据会明确报错。）
              </p>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

/** 抓取结局的中文说法（与服务端 `status` 一一对应）。 */
const STATUS_TEXT: Record<HolidayRefreshResult["status"], string> = {
  written: "已写入",
  checked: "校验通过（未写入）",
  "not-published": "还没有公布",
  rejected: "没有通过校验（未写入任何东西）",
};
