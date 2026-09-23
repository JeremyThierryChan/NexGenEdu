"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AssessmentPanel } from "@/components/admin/AssessmentPanel";
import { EnrollmentPanel } from "@/components/admin/EnrollmentPanel";
import { HomeworkPanel } from "@/components/admin/HomeworkPanel";
import { StudentProfileForm } from "@/components/admin/StudentProfileForm";
import { StudentProfileView } from "@/components/admin/StudentProfileView";
import { api, type Classroom, type Lesson, type Student, type Teacher } from "@/lib/backend/api";
import { remainingTotal } from "@/lib/backend/enrollment";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";
import { FOLLOWUP_RULES } from "@/lib/backend/followup";

/**
 * 学生详情。
 *
 * 信息量大，因此分三个页签，避免一屏拉出上千像素：
 *   1. **报课与课时**：一门课一条记录，可报课 / 续费 / 退课（上课扣课时在课程安排页）；
 *   2. **信息采集表**：六节档案字段，可查看与填写；
 *   3. **排课记录**：这个学生接下来的课与已上记录。
 *
 * 页签而不是长滚动：老师找「还剩多少课时」和找「心理状态」是两个场景，
 * 不该在同一个滚动条里互相挤。
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
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [tab, setTab] = useState<
    "enrollments" | "profile" | "lessons" | "homework" | "assessments"
  >("enrollments");
  const [editingProfile, setEditingProfile] = useState(false);

  const load = useCallback(async () => {
    const [detail, teacherList] = await Promise.all([api.students.get(studentId), api.teachers.list()]);
    setStudent(detail);
    setTeachers(teacherList);
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
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

  const total = remainingTotal(student.enrollments);

  return (
    <section className={cn("rounded-lg border border-ink-200 bg-white", className)}>
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
            {student.subjects.length > 0 && ` · 在读：${student.subjects.join("、")}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-500">剩余课时</span>
          <span
            className={cn(
              "text-lg font-medium tabular",
              total <= FOLLOWUP_RULES.lowLessons ? "text-warning-600" : "text-ink-900",
            )}
          >
            {total}
          </span>
        </div>
      </header>

      {/* 页签 */}
      <div className="flex gap-1 border-b border-ink-100 px-3 py-2">
        {(
          [
            ["enrollments", "报课与课时"],
            ["profile", "信息采集表"],
            ["lessons", "排课记录"],
            ["homework", "作业记录"],
            ["assessments", "阶段测评"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-sm transition-colors",
              tab === key ? "bg-brand-50 font-medium text-brand-700" : "text-ink-600 hover:bg-ink-100",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "enrollments" && (
        <EnrollmentPanel student={student} teachers={teachers} onChanged={refresh} />
      )}

      {tab === "profile" &&
        (editingProfile ? (
          <StudentProfileForm
            student={student}
            onCancel={() => setEditingProfile(false)}
            onSaved={refresh}
          />
        ) : (
          <StudentProfileView student={student} onEdit={() => setEditingProfile(true)} />
        ))}

      {tab === "lessons" && <StudentLessons studentId={student.id} />}
      {tab === "homework" && <HomeworkPanel studentId={student.id} />}
      {tab === "assessments" && <AssessmentPanel studentId={student.id} />}
    </section>
  );
}

/** 学生的排课记录（接下来的课 / 已上）。 */
function StudentLessons({ studentId }: { studentId: string }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.lessons.listByStudent(studentId),
      api.teachers.list(),
      api.classrooms.list(),
    ]).then(([lessonList, teacherList, classroomList]) => {
      if (cancelled) return;
      setLessons(lessonList);
      setTeachers(teacherList);
      setClassrooms(classroomList);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (lessons === null) return <p className="px-4 py-6 text-sm text-ink-400">加载中…</p>;

  const now = Date.now();
  const upcoming = lessons.filter(
    (lesson) => new Date(lesson.startsAt).getTime() >= now && lesson.status !== "已取消",
  );
  const past = lessons.filter((lesson) => !upcoming.includes(lesson));

  return (
    <div className="px-4 py-4">
      <h3 className="text-xs font-medium text-ink-600">接下来的课（{upcoming.length} 节）</h3>
      {upcoming.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">
          还没有排课，可以到
          <Link href="/admin/lessons" className="mx-1 text-brand-700 transition-colors hover:text-brand-800">
            课程安排
          </Link>
          里添加。
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-ink-100 rounded-md border border-ink-100">
          {upcoming.slice(0, 8).map((lesson) => (
            <li key={lesson.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="w-36 text-xs text-ink-900">
                {formatDayLabel(lesson.startsAt)}{" "}
                {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
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
          <h3 className="mt-5 text-xs font-medium text-ink-600">已上 / 已过期（{past.length} 节）</h3>
          <ul className="mt-2 divide-y divide-ink-100 rounded-md border border-ink-100">
            {past.slice(-6).reverse().map((lesson) => (
              <li key={lesson.id} className="flex gap-x-3 px-3 py-2 text-xs text-ink-500">
                <span className="w-36">
                  {formatDayLabel(lesson.startsAt)}{" "}
                  {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                </span>
                <span>{lesson.subject}</span>
                <span className="ml-auto">{lesson.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
