"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { PageHeading } from "@/components/ui/PageHeading";
import {
  api,
  type Classroom,
  type Lesson,
  type SiteCopyBlock,
  type Teacher,
  type VacationPeriod,
} from "@/lib/backend/api";
import {
  dateKey,
  formatDayLabel,
  formatTimeRange,
  formatTime,
  isSameMonth,
  monthGrid,
  shiftMonths,
  weekDays,
} from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";
import { countLessons } from "@/lib/backend/lesson-stats";
import { LoadFailure } from "@/components/admin/LoadFailure";
import { HolidayTablePanel } from "@/components/admin/HolidayTablePanel";
import { VacationPanel } from "@/components/admin/VacationPanel";
import { loadHolidayTable } from "@/lib/backend/holidays-client";
import { dayPlanFor, windowsFromSchedule, type DayPlan, type WindowGroup } from "@/lib/backend/calendar-plan";
import type { HolidayDay } from "@/lib/backend/holidays";

/**
 * 日历（按周查看）+ 假期与作息 —— 一页两个页签。
 *
 * ## 为什么这两件事在一页（机构要求）
 *
 * 「日历」看的是"这一周哪几天有课"，「节假日」看的是"哪一天是什么日子" ——
 * 这是同一件事的两半：看周视图的人**必须**知道某天是法定假日、调休上班日还是寒暑假，
 * 否则"为什么这天白天排不了课"只能靠记忆。因此 v28 把原来那个独立的「节假日」页
 * 并进来，导航里也只剩「日历」一条。
 *
 * ## 每一天按哪一组时段（口径见 `lib/backend/calendar-plan.ts`）
 *
 *   工作日（学期内）      → 工作日组（放学后 + 晚上）
 *   周末（学期内）        → 周末组
 *   **调休上班日**        → 工作日组（学生要上学，白天排不了）
 *   **法定假日**          → 周末组（机构照常上课，白天可以排）
 *   **寒暑假段内**        → 周末组（每天都可以排；机构口径：作息与周末相同）
 *
 * ## 这一页仍然只读
 *
 * 用途与「课程安排」不同：那里是**操作**某一天的课，这里是**看全局**。
 * 因此这一页刻意不做增删改：点某天的课只是选中那一天，在下方列出当天的课程，
 * 需要改动时再到「课程安排」里操作（避免同一份数据两处可改、两套校验）。
 *
 * **这一版不接排课**（机构明确"后续的排课再另外安排"）：页面上标出"这天按哪一组时段"，
 * `lib/backend/recurrence.ts` 的日期生成一行都没动 —— 页面上也把这件事写出来了，
 * 免得有人以为录了寒暑假、排课就自动按假期作息排了。
 */
export default function AdminCalendarPage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 读不出来时的原因（审计抓到的那条：这里原先没有 try/catch ——
   * 后端没开 / 登录过期 / 权限不足时 setLoading(false) 永远走不到，界面就停在「加载中…」）。
   */
  const [loadError, setLoadError] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>(() => dateKey(new Date()));
  /** 页签：周视图 / 假期与作息（机构要求把"日历"与"节假日"放在一起）。 */
  const [tab, setTab] = useState<"week" | "policy">("week");
  /**
   * 节假日表 + 寒暑假段 + 「时间安排」那一块文案。
   *
   * 三样都只用来**判定与展示**（哪一天按哪一组时段），不参与周视图的课程查询 ——
   * 因此它们的失败**不该**让周视图读不出来：分开取、各自降级。
   */
  const [holidaysByYear, setHolidaysByYear] = useState<Map<number, HolidayDay[]>>(new Map());
  const [vacations, setVacations] = useState<VacationPeriod[]>([]);
  const [schedule, setSchedule] = useState<SiteCopyBlock | undefined>(undefined);

  /**
   * 看课页签里的**缩放级别**：周 / 月。
   *
   * 为什么不把它做成第三个页签：周视图与月视图是**同一件事的两个缩放级别**
   * （同一条数据、同一个"选中某一天看明细"面板），页签留给"不同的事"
   * （看课 / 假期与作息）。分开成页签的话，选中的那天在两个页签里会各记一份。
   */
  const [zoom, setZoom] = useState<"week" | "month">("week");

  const days = useMemo(() => weekDays(anchor), [anchor]);
  /** 月视图的日期格子（含前后补齐的天，总是 7 的倍数）。 */
  const grid = useMemo(() => (zoom === "month" ? monthGrid(anchor) : []), [zoom, anchor]);

  /**
   * 这次要读哪一段课程。
   *
   * 周视图读 7 天；月视图读**整张格子**（含前后补齐的几天）—— 不补齐的话，
   * 格子右上角那几格会显示"0 节"，而那里其实是有课的（只是没读进来），
   * 这种"看起来空着"比报错更难查。
   */
  const range = useMemo(() => {
    if (zoom === "month" && grid.length > 0) {
      return { from: grid[0] ?? anchor, to: grid[grid.length - 1] ?? anchor };
    }
    return { from: days[0] ?? anchor, to: days[6] ?? anchor };
  }, [zoom, grid, days, anchor]);

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时**不进加载态**，因此不会在"点一下就地动作"
   * 的同一瞬间把列表换成加载中、把页面高度塌掉 —— 页高一塌，浏览器就会把滚动位置夹回顶部
   * （§15.3 里那条真实反馈）。首屏（useEffect 里那一次）仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    try {
      const [rangeLessons, teacherList, classroomList] = await Promise.all([
        api.lessons.listBetween(range.from, range.to),
        api.teachers.list(),
        api.classrooms.list(),
      ]);
      setLessons(rangeLessons);
      setTeachers(teacherList);
      setClassrooms(classroomList);
      setLoading(false);

      setLoadError("");
    } catch (cause) {
      /*
       * 失败要把话说出来：服务端那句通常写着「该找谁 / 该先做什么」（403 说角色、
       * 400 说哪个参数不对），比界面自己编一句准。**屏幕上的旧数据不动** ——
       * 它可能是对的，只是这次没刷新成功。
       */
      setLoadError(
        cause instanceof Error && cause.message.trim() !== ""
          ? cause.message
          : `读取失败（${String(cause)}）—— 请重试；仍然不行就去看后端日志。`,
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 读"日历口径"要用的三样：节假日表、寒暑假段、「时间安排」那一块文案。
   *
   * 刻意与周视图**分开取**且**失败静默降级**：这三样只决定"那天按哪一组时段"，
   * 拿不到时页面仍然要能看课（退回"按星期几"判），而不是整页报错 ——
   * 反过来（拿不到课程就整页空）才是更糟的那个方向。
   */
  const loadPolicy = useCallback(async () => {
    try {
      const outcome = await loadHolidayTable();
      if (outcome.ok) {
        const map = new Map<number, HolidayDay[]>();
        for (const year of outcome.table.years) map.set(year.year, year.days);
        setHolidaysByYear(map);
      }
    } catch {
      // 静默：节假日表读不到时按"没有这张表"处理（下面的判定会明说依据）
    }
    try {
      setVacations(await api.vacations.list());
    } catch {
      // 同上
    }
    try {
      const content = await api.site.publicContent();
      setSchedule(content.siteContent.copy?.schedule);
    } catch {
      // 同上：时段读不到时页面上会写"没读到这一组时段"
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  /** 这一天的判定（哪一组时段）。节假日表按年份取，缺那一年就退回按星期几判。 */
  const planOf = useCallback(
    (date: string): DayPlan =>
      dayPlanFor(date, {
        holidays: holidaysByYear.get(Number(date.slice(0, 4))) ?? [],
        vacations,
      }),
    [holidaysByYear, vacations],
  );

  /** 两组时段的具体时间（从「网站内容 → 时间安排」读）。 */
  const windowLookups = useMemo(() => {
    const groups: WindowGroup[] = ["工作日", "周末"];
    return new Map(groups.map((group) => [group, windowsFromSchedule(schedule, group)]));
  }, [schedule]);

  /** 一组时段的短说明（页面上每天栏头下面那一行）。 */
  const windowsHint = useCallback(
    (group: WindowGroup): string => {
      const lookup = windowLookups.get(group);
      if (lookup === undefined || lookup.missing || lookup.windows.length === 0) return `${group}组（时段没读到）`;
      const first = lookup.windows[0];
      const last = lookup.windows[lookup.windows.length - 1];
      return `${group}组 ${first?.start ?? ""}–${last?.end ?? ""}（${String(lookup.windows.length)} 段）`;
    },
    [windowLookups],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const key = dateKey(lesson.startsAt);
      map.set(key, [...(map.get(key) ?? []), lesson]);
    }
    return map;
  }, [lessons]);

  const selected = byDay.get(selectedKey) ?? [];
  const selectedPlan = planOf(selectedKey);
  const todayKey = dateKey(new Date());
  /**
   * 当前可见区间（周或月）里有几天是法定假日 / 调休上班日 / 寒暑假（页面上那句话用它）。
   * 月视图用整张格子算 —— 与"读进来的课程"是同一个区间，数字不会对不上。
   */
  const visibleDays = zoom === "month" && grid.length > 0 ? grid : days;
  const spanPlans = visibleDays.map((day) => planOf(dateKey(day)));
  const holidayDays = spanPlans.filter((plan) => plan.kind === "holiday").length;
  const makeupDays = spanPlans.filter((plan) => plan.kind === "makeup").length;
  const vacationDays = spanPlans.filter((plan) => plan.kind === "vacation").length;

  return (
    <>
      <PageHeading
        title="日历"
        description="按周查看排课密度与空档；「假期与作息」页签里是节假日表与寒暑假段。"
      />

      {/*
        页签而不是两块长内容叠在一起：周视图本身就有好几屏（七天卡片 + 当天明细），
        节假日表也有好几屏（逐日表 + 来源校验 + 抓取结果），叠起来要滚很久。
        非周视图的那个页签**不挂** DataNotice 的刷新 —— 它有自己的读法（见 loadPolicy）。
      */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            { key: "week", label: "看课（周 / 月）" },
            { key: "policy", label: "假期与作息" },
          ] as const
        ).map((item) => (
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
          </button>
        ))}
      </div>

      {tab === "policy" ? (
        <>
          <VacationPanel schedule={schedule} />
          <HolidayTablePanel />
        </>
      ) : (
        <>
      <DataNotice
        onRefresh={async () => {
          // 安静刷新：周视图一直挂着，刷新不该把整块塌成一行（见 load 的说明）
          await load({ quiet: true });
          await loadPolicy();
        }}
      />

      {loadError !== "" && (
        <LoadFailure
          error={loadError}
          onRetry={() => void load({ quiet: true })}
          className="mt-4"
        />
      )}

      {/* 缩放级别 + 前后翻页 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {/*
          周 / 月是同一件事的两个缩放级别，因此放在**看课**这一块里，而不是各占一个页签
          （页签留给"不同的事"：看课 / 假期与作息）。切换时锚点不动 ——
          从"9月23日那一周"切到月，看到的就是 9 月。
        */}
        <div className="flex overflow-hidden rounded-md border border-ink-300">
          {(
            [
              { key: "week", label: "周" },
              { key: "month", label: "月" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setZoom(item.key)}
              className={cn(
                "px-3 py-1 text-sm transition-colors",
                zoom === item.key ? "bg-brand-50 text-brand-700" : "bg-white text-ink-600 hover:bg-ink-50",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {zoom === "week" ? (
          <>
            <button type="button" onClick={() => setAnchor(shiftWeeks(anchor, -1))} className={navButtonClass}>
              ← 上一周
            </button>
            <button type="button" onClick={() => setAnchor(new Date())} className={navButtonClass}>
              本周
            </button>
            <button type="button" onClick={() => setAnchor(shiftWeeks(anchor, 1))} className={navButtonClass}>
              下一周 →
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setAnchor(shiftMonths(anchor, -1))} className={navButtonClass}>
              ← 上一月
            </button>
            <button type="button" onClick={() => setAnchor(new Date())} className={navButtonClass}>
              本月
            </button>
            <button type="button" onClick={() => setAnchor(shiftMonths(anchor, 1))} className={navButtonClass}>
              下一月 →
            </button>
          </>
        )}

        <span className="text-xs text-ink-500">
          {zoom === "week"
            ? `${formatDayLabel(days[0] ?? new Date())} – ${formatDayLabel(days[6] ?? new Date())}`
            : `${String((grid[0] ?? anchor).getFullYear())} 年 ${String(anchor.getMonth() + 1)} 月`}
          {" · "}
          {zoom === "week" ? "本周" : "本月"} {countLessons(lessons).active} 节
          {holidayDays > 0 && ` · 假日 ${String(holidayDays)} 天`}
          {makeupDays > 0 && ` · 调休上班 ${String(makeupDays)} 天`}
          {vacationDays > 0 && ` · 假期 ${String(vacationDays)} 天`}
          {loading && " · 加载中…"}
        </span>
      </div>

      {/*
        ── 月视图 ──
        一张"周 × 7"的表：先看哪天忙、哪天有假日/调休/寒暑假，再点某天看明细。
        格子里只放最必要的三样（日号、节数、日子徽标），课程标题放在 tooltip 里 ——
        42 个格子都塞标题的话，这一屏会糊成一片（要看内容就点开那一天，下面就是明细）。
      */}
      {zoom === "month" && (
        <div className="mt-4 rounded-lg border border-ink-200 bg-white">
          <div className="grid grid-cols-7 border-b border-ink-100 text-center text-[11px] text-ink-500">
            {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
              <span key={label} className="px-2 py-1.5">
                {label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.map((day) => {
              const key = dateKey(day);
              const dayLessons = byDay.get(key) ?? [];
              const plan = planOf(key);
              const inMonth = isSameMonth(day, anchor);
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              const badgeClass =
                plan.kind === "holiday"
                  ? "border-danger-100 bg-danger-50 text-danger-600"
                  : plan.kind === "makeup"
                    ? "border-warning-100 bg-warning-50 text-warning-700"
                    : plan.kind === "vacation"
                      ? "border-brand-200 bg-brand-50 text-brand-700"
                      : "border-ink-200 bg-white text-ink-400";

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  title={[
                    formatDayLabel(day),
                    plan.label,
                    windowsHint(plan.windowGroup),
                    dayLessons.length === 0
                      ? "没有排课"
                      : dayLessons.map((lesson) => `${formatTime(lesson.startsAt)} ${lesson.subject}`).join("、"),
                  ].join(" · ")}
                  className={cn(
                    "min-h-[5.5rem] border-b border-r border-ink-100 px-2 py-1.5 text-left transition-colors last:border-r-0",
                    inMonth ? "bg-white" : "bg-ink-50",
                    isSelected && "ring-1 ring-inset ring-brand-400",
                    isToday && !isSelected && "bg-brand-50",
                    "hover:bg-brand-50/60",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-1">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        inMonth ? (isToday ? "text-brand-700" : "text-ink-700") : "text-ink-400",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {plan.kind !== "workday" && plan.kind !== "weekend" && (
                      <span className={cn("rounded-sm border px-1 text-[10px]", badgeClass)}>{plan.badge}</span>
                    )}
                  </span>
                  {dayLessons.length > 0 && (
                    <span className="mt-1 block text-[11px] text-ink-600">
                      {dayLessons.length} 节
                      <span className="ml-1 text-ink-400">
                        {Math.round(dayLessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0) / 6) / 10} 小时
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 周视图 */}
      {zoom === "week" && (
      <div className="mt-4 grid gap-2 lg:grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day);
          const dayLessons = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;
          const plan = planOf(key);
          const badgeClass =
            plan.kind === "holiday"
              ? "border-danger-100 bg-danger-50 text-danger-600"
              : plan.kind === "makeup"
                ? "border-warning-100 bg-warning-50 text-warning-700"
                : plan.kind === "vacation"
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-500";

          return (
            <section
              key={key}
              className={cn(
                "rounded-lg border bg-white",
                isSelected ? "border-brand-400" : "border-ink-200",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedKey(key)}
                title={plan.reason}
                className={cn(
                  "w-full rounded-t-lg px-3 py-2 text-left",
                  isToday ? "bg-brand-50" : "bg-ink-50",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isToday ? "text-brand-700" : "text-ink-600",
                    )}
                  >
                    {formatDayLabel(day)}
                  </span>
                  <span className="text-xs text-ink-400">{dayLessons.length}</span>
                </span>
                {/*
                  「这一天按哪一组时段」— 这一行是这次改动的重点：看周视图的人必须知道
                  某天是法定假日（照常上课、白天能排）、调休上班日（学生要上学、只能晚上）
                  还是寒暑假（每天都能排）。判定只有一份（lib/backend/calendar-plan.ts）。
                */}
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", badgeClass)}>
                    {plan.badge}
                  </span>
                  {plan.kind === "holiday" || plan.kind === "makeup" ? (
                    <span className="truncate text-[11px] text-ink-500">{plan.label}</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-ink-400">
                  {windowsHint(plan.windowGroup)}
                </span>
              </button>

              <ul className="space-y-1.5 p-2">
                {dayLessons.map((lesson) => (
                  <li key={lesson.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(key)}
                      className={cn(
                        "block w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:border-brand-300",
                        lesson.status === "已取消"
                          ? "border-ink-100 bg-ink-50 text-ink-400 line-through"
                          : lesson.status === "已上"
                            ? "border-success-100 bg-success-50 text-success-600"
                            : "border-ink-200 bg-white text-ink-700",
                      )}
                    >
                      <span className="block font-mono tabular">
                        {formatTime(lesson.startsAt)}
                      </span>
                      <span className="mt-0.5 block truncate">{lesson.subject}</span>
                      <span className="mt-0.5 block truncate text-[11px] opacity-80">
                        {teachers.find((t) => t.id === lesson.teacherId)?.name ?? "—"} ·{" "}
                        {classrooms.find((c) => c.id === lesson.classroomId)?.name ?? "—"}
                      </span>
                    </button>
                  </li>
                ))}

                {dayLessons.length === 0 && (
                  <li className="px-2 py-3 text-center text-xs text-ink-400">空档</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
      )}

      {/* 选中那天的明细 */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-medium text-ink-900">
            {formatDayLabel(new Date(`${selectedKey}T00:00:00`))}
            {zoom === "month" && !isSameMonth(new Date(`${selectedKey}T00:00:00`), anchor) && (
              <span className="ml-2 text-[11px] font-normal text-ink-400">（不在本月）</span>
            )}
            <span className="ml-2 rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] font-normal text-ink-600">
              {selectedPlan.label} · {windowsHint(selectedPlan.windowGroup)}
            </span>
            <span className="ml-2 text-xs font-normal text-ink-500">
              {selected.length} 节 ·{" "}
              {Math.round(
                (selected.reduce((sum, lesson) => sum + lesson.durationMinutes, 0) / 60) * 10,
              ) / 10}{" "}
              小时
            </span>
          </h2>
          <a
            href="/admin/lessons"
            className="text-xs text-brand-700 transition-colors hover:text-brand-800"
          >
            到课程安排里修改 →
          </a>
        </header>

        {selected.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-500">这一天没有排课。</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {selected.map((lesson) => (
              <li key={lesson.id} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-2.5">
                <span className="w-28 font-mono text-xs tabular text-ink-900">
                  {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                </span>
                <span className="text-sm text-ink-800">{lesson.subject}</span>
                <span className="text-xs text-ink-500">{lesson.form}</span>
                <span className="text-xs text-ink-500">
                  {teachers.find((t) => t.id === lesson.teacherId)?.name ?? "—"} ·{" "}
                  {classrooms.find((c) => c.id === lesson.classroomId)?.name ?? "—"}
                </span>
                <span className="ml-auto text-xs text-ink-400">{lesson.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
        </>
      )}
    </>
  );
}

const navButtonClass =
  "rounded-md border border-ink-300 bg-white px-2.5 py-1 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700";

function shiftWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}
