"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { DataNotice } from "@/components/admin/DataNotice";
import { api, type Classroom, type Lesson, type Teacher } from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange, dateKey, weekDays } from "@/lib/backend/format";
import {
  buildDayTimeline,
  formatGapDuration,
  gapText,
  totalGapMinutes,
} from "@/lib/backend/timetable";
import { getClassHoursWindow } from "@/lib/backend/options";
import { createIcs, downloadTextFile, stampForFilename } from "@/lib/backend/backup";
import { cn } from "@/lib/utils/cn";
import { countLessons } from "@/lib/backend/lesson-stats";

/**
 * 空档计算选项：窗口取自站点内容的「上课时间」，因此课前 / 课后两段空档
 * 会随内容改动而变（改内容 → 重新构建 → 课表跟着变），不在代码里写死时间。
 */
const GAP_OPTIONS = { window: getClassHoursWindow() };

/**
 * 课表与占用。
 *
 * 排课之后最常被问的两件事：
 *   1. **某位老师这周什么时候有课**（教师课表）—— 直接看下一周怎么排；
 *   2. **哪间教室什么时候空着**（教室占用）—— 接新学生时先找空档。
 *
 * 两件事共用同一批数据、同一个周视图，因此放在一个页面里用页签切换，
 * 而不是做成两个各写一遍的周网格。
 *
 * 阅读方式与「日历」不同：日历看整体密度，这里按**人**和**房间**拆开看。
 */
export default function AdminTimetablePage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [tab, setTab] = useState<"teacher" | "classroom">("teacher");
  const [focusId, setFocusId] = useState("");
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => weekDays(anchor), [anchor]);

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时**不进加载态**，因此不会在"点一下就地动作"
   * 的同一瞬间把列表换成加载中、把页面高度塌掉 —— 页高一塌，浏览器就会把滚动位置夹回顶部
   * （§15.3 里那条真实反馈）。首屏（useEffect 里那一次）仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    const from = days[0] ?? new Date();
    const to = days[6] ?? new Date();
    const [weekLessons, teacherList, classroomList] = await Promise.all([
      api.lessons.listBetween(from, to),
      api.teachers.listActive(),
      api.classrooms.list(),
    ]);
    setLessons(weekLessons);
    setTeachers(teacherList);
    setClassrooms(classroomList);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  // 切换页签时给一个合理默认焦点
  useEffect(() => {
    if (tab === "teacher" && focusId === "") setFocusId(teachers[0]?.id ?? "");
    if (tab === "classroom" && focusId === "") setFocusId(classrooms[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在意页签变化
  }, [tab, teachers, classrooms]);

  /** 按天分组（区间内的课）。 */
  const byDay = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const key = dateKey(lesson.startsAt);
      map.set(key, [...(map.get(key) ?? []), lesson]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [lessons]);

  const filtered = useMemo(
    () =>
      tab === "teacher"
        ? lessons.filter((lesson) => lesson.teacherId === focusId)
        : lessons.filter((lesson) => lesson.classroomId === focusId),
    [focusId, lessons, tab],
  );

  const filteredByDay = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of filtered) {
      const key = dateKey(lesson.startsAt);
      map.set(key, [...(map.get(key) ?? []), lesson]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [filtered]);

  // 焦点行与下面的"本周总览"必须同一口径（取消的课不算），否则同一屏两个数会打架
  const focusCounts = countLessons(filtered);

  /** 本周每间教室 / 每位教师的课次与时长，用于总览一行。 */
  const summary = useMemo(() => {
    return (tab === "teacher" ? teachers : classrooms).map((item) => {
      const own = lessons.filter((lesson) =>
        tab === "teacher"
          ? lesson.teacherId === item.id
          : lesson.classroomId === item.id,
      );
      const counts = countLessons(own);
      return {
        id: item.id,
        name: item.name,
        count: counts.active,
        cancelled: counts.cancelled,
        hours: Math.round((counts.activeMinutes / 60) * 10) / 10,
      };
    });
  }, [classrooms, lessons, tab, teachers]);

  const focusName =
    (tab === "teacher"
      ? teachers.find((item) => item.id === focusId)?.name
      : classrooms.find((item) => item.id === focusId)?.name) ?? "";

  return (
    <>
      <PageHeading
        title="课表与占用"
        description="按周查看某位教师的课表，或某间教室的占用与空档。"
      />

      <DataNotice
        onRefresh={async () => {
          // 安静刷新（见 load 的说明）
          await load({ quiet: true });
        }}
      />

      {/* 周切换 + 页签 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(
            [
              ["teacher", "教师课表"],
              ["classroom", "教室占用"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setFocusId("");
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                tab === key ? "bg-brand-50 font-medium text-brand-700" : "text-ink-600 hover:bg-ink-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => setAnchor(shiftWeeks(anchor, -1))} className={navButton}>
          ← 上一周
        </button>
        <button type="button" onClick={() => setAnchor(new Date())} className={navButton}>
          本周
        </button>
        <button type="button" onClick={() => setAnchor(shiftWeeks(anchor, 1))} className={navButton}>
          下一周 →
        </button>
        <span className="text-xs text-ink-500">
          {formatDayLabel(days[0] ?? new Date())} – {formatDayLabel(days[6] ?? new Date())}
          {loading && " · 加载中…"}
        </span>
      </div>

      {/* 选择焦点对象 */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-600">
          {tab === "teacher" ? "教师" : "教室"}
          <select
            value={focusId}
            onChange={(event) => setFocusId(event.target.value)}
            className="rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {(tab === "teacher" ? teachers : classrooms).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-ink-500">
          {focusName} 本周 {focusCounts.active} 节 ·{" "}
          {Math.round((focusCounts.activeMinutes / 60) * 10) / 10} 小时
          {focusCounts.cancelled > 0 ? `（另有 ${focusCounts.cancelled} 节已取消）` : ""}
        </span>
        {/* 导出当前焦点的本周课表：老师把它导进手机日历，就不用来后台查课 */}
        <Button
          size="sm"
          variant="outline"
          disabled={loading || filtered.length === 0}
          onClick={() => {
            const ics = createIcs(
              filtered.map((lesson) => ({
                uid: `lesson-${lesson.id}@nexgenedu`,
                title: `${lesson.subject}${lesson.form !== "" ? ` · ${lesson.form}` : ""}`,
                location:
                  tab === "teacher"
                    ? (classrooms.find((item) => item.id === lesson.classroomId)?.name ?? "")
                    : (teachers.find((item) => item.id === lesson.teacherId)?.name ?? ""),
                description: tab === "classroom" ? "" : "来自 NexGenEdu 教务后台",
                startsAt: lesson.startsAt,
                durationMinutes: lesson.durationMinutes,
              })),
              `${focusName} 课表`,
            );
            downloadTextFile(
              `课表-${focusName}-${stampForFilename()}.ics`,
              ics,
              "text/calendar",
            );
          }}
        >
          导出本周课表（ICS）
        </Button>
      </div>

      {/* 本周课表网格 */}
      <div className="mt-4 grid gap-2 lg:grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day);
          const dayLessons = filteredByDay.get(key) ?? [];
          const isToday = key === dateKey(new Date());
          return (
            <section key={key} className="rounded-lg border border-ink-200 bg-white">
              <header
                className={cn(
                  "flex items-baseline justify-between gap-2 rounded-t-lg px-3 py-2",
                  isToday ? "bg-brand-50" : "bg-ink-50",
                )}
              >
                <span className={cn("text-xs font-medium", isToday ? "text-brand-700" : "text-ink-600")}>
                  {formatDayLabel(day)}
                </span>
                <span className="text-xs text-ink-400">
                  {dayLessons.length}
                  {(() => {
                    const idle = totalGapMinutes(dayLessons, GAP_OPTIONS);
                    return idle > 0 ? ` · 空 ${formatGapDuration(idle)}` : "";
                  })()}
                </span>
              </header>
              <ul className="space-y-1.5 p-2">
                {buildDayTimeline(dayLessons, GAP_OPTIONS).map((item) =>
                  item.kind === "gap" ? (
                    /*
                     * 空档卡片：课表上唯一没写出来的信息。
                     * 「两节课中间空着多久」决定了能不能再接一个学生 / 安排补课。
                     */
                    <li
                      key={`gap-${item.gap.beforeLessonId}`}
                      title={`${item.gap.rangeLabel} 空着`}
                      className="flex items-baseline justify-between gap-2 rounded-md border border-dashed border-ink-300 bg-ink-50 px-2 py-1 text-[11px] text-ink-500"
                    >
                      <span className="font-mono tabular text-ink-400">
                        {item.gap.rangeLabel}
                      </span>
                      <span>{gapText(item.gap)}</span>
                    </li>
                  ) : (
                    <li
                      key={item.lesson.id}
                      className={cn(
                        "rounded-md border px-2 py-1.5 text-xs",
                        item.lesson.status === "已取消"
                          ? "border-ink-100 bg-ink-50 text-ink-400 line-through"
                          : item.lesson.status === "已上"
                            ? "border-success-100 bg-success-50 text-success-600"
                            : "border-ink-200 text-ink-700",
                      )}
                    >
                      <span className="block font-mono tabular">
                        {formatTimeRange(item.lesson.startsAt, item.lesson.durationMinutes)}
                      </span>
                      <span className="mt-0.5 block truncate">{item.lesson.subject}</span>
                      <span className="mt-0.5 block truncate text-[11px] opacity-80">
                        {tab === "teacher"
                          ? classrooms.find((entry) => entry.id === item.lesson.classroomId)?.name
                          : teachers.find((entry) => entry.id === item.lesson.teacherId)?.name}
                      </span>
                    </li>
                  ),
                )}
                {dayLessons.length === 0 && (
                  <li className="px-2 py-3 text-center text-xs text-ink-400">空档</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {/* 本周总览：谁最忙 / 哪间教室最紧 */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white">
        <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
          本周总览（{tab === "teacher" ? "按教师" : "按教室"}）
        </h2>
        <ul className="divide-y divide-ink-100">
          {summary.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setFocusId(row.id)}
                className={cn(
                  "text-sm transition-colors",
                  row.id === focusId ? "font-medium text-brand-700" : "text-ink-800 hover:text-brand-700",
                )}
              >
                {row.name}
              </button>
              <span className="text-xs tabular text-ink-600">{row.count} 节</span>
              <span className="text-xs tabular text-ink-500">{row.hours} 小时</span>
              {row.cancelled > 0 && (
                <span className="text-xs text-ink-400">（另有 {row.cancelled} 节已取消，未计入）</span>
              )}
              {row.count === 0 && row.cancelled === 0 && <span className="text-xs text-ink-400">本周无课</span>}
            </li>
          ))}
        </ul>
      </section>

      {/* 本周全部课程（区间内、未按焦点过滤）——用于核对没有排漏 */}
      <p className="mt-4 text-xs text-ink-400">
        本周全部课程 {byDay.size > 0 ? lessons.length : 0} 节（含所有{tab === "teacher" ? "教师" : "教室"}）。
      </p>
    </>
  );
}

const navButton =
  "rounded-md border border-ink-300 bg-white px-2.5 py-1 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700";

function shiftWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}
