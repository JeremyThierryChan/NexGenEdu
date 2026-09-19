"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, type Classroom, type Lesson, type Teacher } from "@/lib/backend/api";
import {
  dateKey,
  formatDayLabel,
  formatTimeRange,
  formatTime,
  weekDays,
} from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

/**
 * 日历（按周查看）。
 *
 * 用途与「课程安排」不同：那里是**操作**某一天的课，这里是**看全局**
 * ——这一周哪几天忙、哪个时段被占满、有没有空档。
 *
 * 因此这一页刻意不做增删改：点某天的课只是选中那一天，在下方列出当天的课程，
 * 需要改动时再到「课程安排」里操作（避免同一份数据两处可改、两套校验）。
 */
export default function AdminCalendarPage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string>(() => dateKey(new Date()));

  const days = useMemo(() => weekDays(anchor), [anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    const from = days[0] ?? new Date();
    const to = days[6] ?? new Date();
    const [weekLessons, teacherList, classroomList] = await Promise.all([
      api.lessons.listBetween(from, to),
      api.teachers.list(),
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

  const byDay = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const key = dateKey(lesson.startsAt);
      map.set(key, [...(map.get(key) ?? []), lesson]);
    }
    return map;
  }, [lessons]);

  const selected = byDay.get(selectedKey) ?? [];
  const todayKey = dateKey(new Date());

  return (
    <>
      <PageHeading title="日历" description="按周查看排课密度与空档，点某天看当天的课。" />

      <DataNotice onRefresh={load} />

      {/* 周切换 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setAnchor(shiftWeeks(anchor, -1))}
          className={navButtonClass}
        >
          ← 上一周
        </button>
        <button type="button" onClick={() => setAnchor(new Date())} className={navButtonClass}>
          本周
        </button>
        <button
          type="button"
          onClick={() => setAnchor(shiftWeeks(anchor, 1))}
          className={navButtonClass}
        >
          下一周 →
        </button>
        <span className="text-xs text-ink-500">
          {formatDayLabel(days[0] ?? new Date())} – {formatDayLabel(days[6] ?? new Date())} ·
          本周 {lessons.length} 节
          {loading && " · 加载中…"}
        </span>
      </div>

      {/* 周视图 */}
      <div className="mt-4 grid gap-2 lg:grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day);
          const dayLessons = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;

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
                className={cn(
                  "flex w-full items-baseline justify-between gap-2 rounded-t-lg px-3 py-2 text-left",
                  isToday ? "bg-brand-50" : "bg-ink-50",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-medium",
                    isToday ? "text-brand-700" : "text-ink-600",
                  )}
                >
                  {formatDayLabel(day)}
                </span>
                <span className="text-xs text-ink-400">{dayLessons.length}</span>
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

      {/* 选中那天的明细 */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-medium text-ink-900">
            {formatDayLabel(new Date(`${selectedKey}T00:00:00`))}
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
  );
}

const navButtonClass =
  "rounded-md border border-ink-300 bg-white px-2.5 py-1 text-sm text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700";

function shiftWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}
