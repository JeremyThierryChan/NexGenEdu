"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { api, type Classroom, type Lesson, type Student, type Teacher } from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";

/**
 * 学生详情（列表下方展开）。
 *
 * 回答三个问题：
 *   1. 还剩多少节课（并给出 ±1 节 的正常入口）；
 *   2. 接下来什么时候上课、在哪、跟谁；
 *   3. 有什么备注需要注意。
 *
 * 课时调整走 api.students.adjustLessons()，而不是「读出来加一下再整体写回」：
 * 将来接服务端时扣课时必须是服务端的一次原子操作（还要记账），
 * 页面按这个签名调用就不用改。
 */
export function StudentDetail({
  studentId,
  onChanged,
  className,
}: {
  studentId: string;
  onChanged: () => void | Promise<void>;
  className?: string;
}) {
  const [student, setStudent] = useState<Student | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const [detail, studentLessons, teacherList, classroomList] = await Promise.all([
      api.students.get(studentId),
      api.lessons.listByStudent(studentId),
      api.teachers.list(),
      api.classrooms.list(),
    ]);
    setStudent(detail);
    setLessons(studentLessons);
    setTeachers(teacherList);
    setClassrooms(classroomList);
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function adjust(delta: number) {
    setPending(true);
    await api.students.adjustLessons(studentId, delta);
    setPending(false);
    await load();
    await onChanged();
  }

  if (student === null) {
    return (
      <section className={className}>
        <p className="rounded-lg border border-ink-200 bg-white px-4 py-6 text-sm text-ink-400">
          加载中…
        </p>
      </section>
    );
  }

  const now = Date.now();
  const upcoming = lessons.filter(
    (lesson) => new Date(lesson.startsAt).getTime() >= now && lesson.status !== "已取消",
  );
  const past = lessons.filter(
    (lesson) => new Date(lesson.startsAt).getTime() < now || lesson.status === "已上",
  );

  return (
    <section className={`rounded-lg border border-ink-200 bg-white ${className ?? ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink-900">
            {student.name}
            <span className="ml-2 text-xs font-normal text-ink-500">
              {student.grade} · {student.status}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            家长：{student.guardian !== "" ? student.guardian : "未填写"}
            {student.subjects.length > 0 && ` · 报读：${student.subjects.join("、")}`}
          </p>
        </div>

        {/* 课时：数字 + 正常增减入口 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">剩余课时</span>
          <span
            className={
              student.remainingLessons <= 5
                ? "text-lg font-medium tabular text-warning-600"
                : "text-lg font-medium tabular text-ink-900"
            }
          >
            {student.remainingLessons}
          </span>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void adjust(-1)}>
            上课 −1
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void adjust(1)}>
            续课 +1
          </Button>
        </div>
      </header>

      <div className="grid gap-6 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div>
          <h3 className="text-xs font-medium text-ink-600">接下来的课（{upcoming.length} 节）</h3>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">
              还没有排课，可以到
              <Link
                href="/admin/lessons"
                className="mx-1 text-brand-700 transition-colors hover:text-brand-800"
              >
                课程安排
              </Link>
              里添加。
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-ink-100 rounded-md border border-ink-100">
              {upcoming.slice(0, 6).map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="w-32 text-xs text-ink-900">
                    {formatDayLabel(lesson.startsAt)} {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                  </span>
                  <span className="text-sm text-ink-800">{lesson.subject}</span>
                  <span className="text-xs text-ink-500">
                    {teachers.find((item) => item.id === lesson.teacherId)?.name ?? "—"} ·{" "}
                    {classrooms.find((item) => item.id === lesson.classroomId)?.name ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {past.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-medium text-ink-600">
                已上 / 已过期（{past.length} 节）
              </h3>
              <ul className="mt-2 divide-y divide-ink-100 rounded-md border border-ink-100">
                {past.slice(-4).reverse().map((lesson) => (
                  <li key={lesson.id} className="flex gap-x-3 px-3 py-2 text-xs text-ink-500">
                    <span className="w-32">
                      {formatDayLabel(lesson.startsAt)} {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                    </span>
                    <span>{lesson.subject}</span>
                    <span>{lesson.status}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-ink-600">备注</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-600">
            {student.note !== "" ? student.note : "（未填写）"}
          </p>
          <p className="mt-4 text-xs text-ink-400">
            建档时间：{formatDayLabel(student.createdAt)}
          </p>
        </div>
      </div>
    </section>
  );
}
