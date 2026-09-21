"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { Panel } from "@/components/admin/AdminFields";
import { LessonForm } from "@/components/admin/LessonForm";
import { LessonSeriesForm } from "@/components/admin/LessonSeriesForm";
import { LessonRecordPanel } from "@/components/admin/LessonRecordPanel";
import { PendingMakeups } from "@/components/admin/PendingMakeups";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import {
  api,
  type Classroom,
  type Lesson,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import { dateKey, formatDayLabel, formatTimeRange } from "@/lib/backend/format";

/**
 * 课程安排（按天排课）。
 *
 * 默认显示今天，可以切换日期。每节课可以：
 *   - **标记已上**：状态改为「已上」并按课时扣减（幂等，重复点不会重复扣）；
 *   - 取消 / 编辑 / 删除。
 *
 * 「标记已上」是后台最核心的业务动作，因此它走服务层的
 * api.lessons.markCompleted()，而不是页面自己改状态再逐个扣课时 ——
 * 将来接服务端时，这个动作必须由服务端在一个事务里完成。
 */
export default function AdminLessonsPage() {
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // 按周批量排课面板（与「新增排课」互斥，避免同屏两个大面板）
  const [series, setSeries] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const day = new Date(`${date}T00:00:00`);
    const [dayLessons, teacherList, classroomList, studentList] = await Promise.all([
      api.lessons.listByDate(day),
      api.teachers.list(),
      api.classrooms.list(),
      api.students.list(),
    ]);
    setLessons(dayLessons);
    setTeachers(teacherList);
    setClassrooms(classroomList);
    setStudents(studentList);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  // 支持从全局搜索直达某一天：/admin/lessons?date=2026-09-18
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("date");
    if (value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value);
  }, []);

  const teacherName = (id: string) => teachers.find((item) => item.id === id)?.name ?? "—";
  const classroomName = (id: string) => classrooms.find((item) => item.id === id)?.name ?? "—";
  const studentNames = (ids: string[]) =>
    ids.map((id) => students.find((item) => item.id === id)?.name ?? "—").join("、");

  async function markCompleted(lesson: Lesson) {
    const result = await api.lessons.markCompleted(lesson.id);
    if (result.alreadyCompleted) {
      setNotice("这节课之前已经标记过「已上」，没有重复扣课时。");
    } else {
      const detail = result.deducted
        .map((item) => `${students.find((s) => s.id === item.studentId)?.name ?? item.studentId} 剩 ${item.remainingLessons} 节`)
        .join("、");
      setNotice(`已标记「已上」，扣课时：${detail !== "" ? detail : "无学生"}`);
    }
    await load();
  }

  async function setStatus(lesson: Lesson, status: Lesson["status"]) {
    const wasCompleted = lesson.status === "已上";
    await api.lessons.update(lesson.id, { status });
    // 状态从「已上」改回去时，服务层会按流水把课时退回，这里如实告知
    if (wasCompleted && status !== "已上") {
      setNotice("已撤销「已上」状态，这节课扣掉的课时已按流水退回。");
    }
    await load();
  }

  async function remove(lesson: Lesson) {
    if (!window.confirm(`删除 ${lesson.subject}（${formatTimeRange(lesson.startsAt, lesson.durationMinutes)}）？`)) {
      return;
    }
    await api.lessons.remove(lesson.id);
    await load();
  }

  const totalMinutes = lessons
    .filter((lesson) => lesson.status !== "已取消")
    .reduce((sum, lesson) => sum + lesson.durationMinutes, 0);

  const isToday = date === toDateInput(new Date());

  return (
    <>
      <PageHeading
        title="课程安排"
        description="按天排课：谁上、在哪上、跟谁上，并在保存前检查时间冲突。"
      />

      <DataNotice onRefresh={load} />

      {/* 日期切换 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setDate(shiftDate(date, -1))}>
          ← 前一天
        </Button>
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <Button size="sm" variant="outline" onClick={() => setDate(shiftDate(date, 1))}>
          后一天 →
        </Button>
        {!isToday && (
          <Button size="sm" variant="ghost" onClick={() => setDate(toDateInput(new Date()))}>
            回到今天
          </Button>
        )}
        <span className="text-xs text-ink-500">
          {formatDayLabel(new Date(`${date}T00:00:00`))} · {lessons.length} 节 ·{" "}
          {Math.round((totalMinutes / 60) * 10) / 10} 小时
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* 按周批量排课：一次排一串（每周二、五 17:00 × N 节），冲突的跳过并说明 */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating(false);
              setSeries((value) => !value);
            }}
          >
            {series ? "收起批量排课" : "按周批量排课"}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setSeries(false);
              setCreating((value) => !value);
            }}
          >
            {creating ? "收起表单" : "新增排课"}
          </Button>
        </div>
      </div>

      {series && (
        <Panel
          className="mt-4"
          title="按周批量排课"
          description="例如「每周二、五 17:00，先排 20 节」：先预览每一节、看清有没有冲突，再写入（冲突的跳过并说明）。调休与临时加课请手动单节处理。"
        >
          <LessonSeriesForm
            teachers={teachers}
            classrooms={classrooms}
            students={students}
            onCancel={() => setSeries(false)}
            onDone={async () => {
              await load();
            }}
          />
        </Panel>
      )}

      {notice !== "" && (
        <p className="mt-4 flex items-start justify-between gap-3 rounded-md border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-600">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            className="shrink-0 text-xs underline"
          >
            知道了
          </button>
        </p>
      )}

      {creating && (
        <Panel className="mt-4" title="新增排课" description="保存前会自动检查教师 / 教室 / 学生的时间冲突。">
          <LessonForm
            defaultDate={new Date(`${date}T00:00:00`)}
            onCancel={() => setCreating(false)}
            onSaved={async () => {
              setCreating(false);
              await load();
            }}
          />
        </Panel>
      )}

      {/* 待补课：缺课之后需要一个收口的地方，否则它会散在老师的记忆里 */}
      <section className="mt-4 rounded-lg border border-ink-200 bg-white">
        <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
          待补课
        </h2>
        <PendingMakeups onChanged={load} />
      </section>

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 font-medium">科目 / 班型</th>
              <th className="px-4 py-2.5 font-medium">教师</th>
              <th className="px-4 py-2.5 font-medium">教室</th>
              <th className="px-4 py-2.5 font-medium">学生</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => (
              <Fragment key={lesson.id}>
              <tr className="border-b border-ink-50 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs tabular text-ink-900">
                  {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-ink-900">{lesson.subject}</span>
                  {lesson.form !== "" && (
                    <span className="ml-2 text-xs text-ink-500">{lesson.form}</span>
                  )}
                  {lesson.note !== "" && (
                    <span className="mt-0.5 block text-xs text-ink-400">{lesson.note}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink-700">{teacherName(lesson.teacherId)}</td>
                <td className="px-4 py-2.5 text-ink-700">{classroomName(lesson.classroomId)}</td>
                <td className="px-4 py-2.5 text-ink-600">{studentNames(lesson.studentIds)}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={lesson.status} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-2">
                    {lesson.status !== "已上" && (
                      <button
                        type="button"
                        onClick={() => void markCompleted(lesson)}
                        className="text-xs text-success-600 transition-colors hover:underline"
                      >
                        标记已上
                      </button>
                    )}
                    {lesson.status === "已排" && (
                      <button
                        type="button"
                        onClick={() => void setStatus(lesson, "已取消")}
                        className="text-xs text-ink-500 transition-colors hover:text-warning-600"
                      >
                        取消
                      </button>
                    )}
                    {lesson.status === "已取消" && (
                      <button
                        type="button"
                        onClick={() => void setStatus(lesson, "已排")}
                        className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                      >
                        恢复
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRecordId(recordId === lesson.id ? null : lesson.id)}
                      className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                    >
                      {recordId === lesson.id ? "收起记录" : "课堂记录"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === lesson.id ? null : lesson.id)}
                      className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                    >
                      {editingId === lesson.id ? "收起" : "编辑"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(lesson)}
                      className="text-xs text-ink-500 transition-colors hover:text-danger-600"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
              {/* 课堂记录：采集表要求「每节课后由上课老师填写」，因此挂在课节下面 */}
              {recordId === lesson.id && (
                <tr className="border-b border-ink-50 bg-ink-50/60">
                  <td colSpan={7} className="p-0">
                    <LessonRecordPanel lesson={lesson} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}

            {!loading && lessons.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-500">
                  {formatDayLabel(new Date(`${date}T00:00:00`))}还没有排课。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <Panel className="mt-4" title="编辑排课">
          <LessonForm
            lesson={lessons.find((item) => item.id === editingId) ?? undefined}
            defaultDate={new Date(`${date}T00:00:00`)}
            onCancel={() => setEditingId(null)}
            onSaved={async () => {
              setEditingId(null);
              await load();
            }}
          />
        </Panel>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Lesson["status"] }) {
  const tone =
    status === "已上"
      ? "border-success-100 bg-success-50 text-success-600"
      : status === "已取消"
        ? "border-ink-200 bg-ink-50 text-ink-500"
        : "border-brand-100 bg-brand-50 text-brand-700";
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${tone}`}>{status}</span>
  );
}

/** Date → 「YYYY-MM-DD」（用于 input[type=date] 与比较）。 */
function toDateInput(date: Date): string {
  return dateKey(date);
}

/** 在 YYYY-MM-DD 上加减天数。 */
function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}
