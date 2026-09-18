"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { DataNotice } from "@/components/admin/DataNotice";
import { api, type Classroom, type Lesson, type Teacher } from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange, dateKey, weekDays } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

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

  const load = useCallback(async () => {
    setLoading(true);
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

  const totalMinutes = filtered
    .filter((lesson) => lesson.status !== "已取消")
    .reduce((sum, lesson) => sum + lesson.durationMinutes, 0);

  /** 本周每间教室 / 每位教师的课次与时长，用于总览一行。 */
  const summary = useMemo(() => {
    return (tab === "teacher" ? teachers : classrooms).map((item) => {
      const own = lessons.filter((lesson) =>
        tab === "teacher"
          ? lesson.teacherId === item.id
          : lesson.classroomId === item.id,
      );
      return {
        id: item.id,
        name: item.name,
        count: own.length,
        hours: Math.round((own.reduce((sum, lesson) => sum + lesson.durationMinutes, 0) / 60) * 10) / 10,
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

      <DataNotice onReset={load} />

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
          {focusName} 本周 {filtered.length} 节 · {Math.round((totalMinutes / 60) * 10) / 10} 小时
        </span>
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
                <span className="text-xs text-ink-400">{dayLessons.length}</span>
              </header>
              <ul className="space-y-1.5 p-2">
                {dayLessons.map((lesson) => (
                  <li
                    key={lesson.id}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs",
                      lesson.status === "已取消"
                        ? "border-ink-100 bg-ink-50 text-ink-400 line-through"
                        : lesson.status === "已上"
                          ? "border-success-100 bg-success-50 text-success-600"
                          : "border-ink-200 text-ink-700",
                    )}
                  >
                    <span className="block font-mono tabular">
                      {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                    </span>
                    <span className="mt-0.5 block truncate">{lesson.subject}</span>
                    <span className="mt-0.5 block truncate text-[11px] opacity-80">
                      {tab === "teacher"
                        ? classrooms.find((item) => item.id === lesson.classroomId)?.name
                        : teachers.find((item) => item.id === lesson.teacherId)?.name}
                    </span>
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
              {row.count === 0 && <span className="text-xs text-ink-400">本周无课</span>}
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
