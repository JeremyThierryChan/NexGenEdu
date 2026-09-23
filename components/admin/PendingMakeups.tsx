"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { NumberInput, TextField } from "@/components/admin/AdminFields";
import {
  api,
  type Classroom,
  type ConflictReport,
  type Lesson,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";
// 教室名的唯一显示口径（「校区·教室名」，v31）
import { classroomLabel } from "@/lib/backend/classrooms";

type PendingRow = {
  original: Lesson;
  student: Student;
  record: { attendance: string; leaveRequestedAt: string };
  reason: string;
};

/**
 * 待补课。
 *
 * 「缺了课」这件事必须有个地方收口，否则它会散在老师的记忆里：
 * 这一块列出所有「请假 / 旷课但还没补」的学生，并直接给一个安排补课的入口 ——
 * 补课表单会走同一套冲突检查（教师 / 教室 / 学生 / 容量 / 教室可用时段）。
 *
 * 顺带把课时口径写清楚：补课是一节真实占用教师与教室的课，因此**扣 1 节**。
 * 于是「提前请假（没扣）+ 补课（扣 1）」= 正常上一节课；
 * 「临时缺课（扣 1）+ 补课（扣 1）」= 扣 2 节 —— 这正是 24 小时规则的威慑力。
 */
export function PendingMakeups({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [openId, setOpenId] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setRows((await api.lessons.pendingMakeups()) as PendingRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null) {
    return <p className="px-4 py-3 text-xs text-ink-400">加载中…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-ink-500">
        没有待补课。老师在「课堂记录」里标了请假或旷课后，会出现在这里。
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      {notice !== "" && (
        <p className="mb-2 rounded-md border border-success-100 bg-success-50 px-3 py-2 text-xs text-success-600">
          {notice}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((row) => {
          const key = `${row.original.id}-${row.student.id}`;
          return (
            <li key={key} className="rounded-md border border-ink-200 bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-sm font-medium text-ink-900">{row.student.name}</span>
                <span className="text-xs text-ink-600">{row.original.subject}</span>
                <span className="text-xs text-ink-500">
                  原课 {formatDayLabel(row.original.startsAt)}{" "}
                  {formatTimeRange(row.original.startsAt, row.original.durationMinutes)}
                </span>
                <span
                  className={
                    row.record.attendance === "旷课"
                      ? "rounded-sm border border-danger-100 bg-danger-50 px-1.5 py-0.5 text-[11px] text-danger-600"
                      : "rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600"
                  }
                >
                  {row.record.attendance}
                </span>
                <span className="min-w-0 flex-1 text-xs text-ink-500">{row.reason}</span>
                <Button
                  size="sm"
                  variant={openId === key ? "outline" : "primary"}
                  onClick={() => setOpenId(openId === key ? "" : key)}
                >
                  {openId === key ? "收起" : "安排补课"}
                </Button>
              </div>

              {openId === key && (
                <MakeupForm
                  original={row.original}
                  student={row.student}
                  onCancel={() => setOpenId("")}
                  onDone={async () => {
                    setOpenId("");
                    setNotice(`已为 ${row.student.name} 安排补课（扣 1 节）。`);
                    await load();
                    await onChanged?.();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
        补课是一节真实占用教师与教室的课，标记已上时按正常规则扣 1 节。
        提前请假（未扣课时）+ 补课 = 共扣 1 节；临时缺课（已扣）+ 补课 = 共扣 2 节。
      </p>
    </div>
  );
}

/** 补课表单：默认沿用原课的教师、教室与时长，可改。 */
function MakeupForm({
  original,
  student,
  onCancel,
  onDone,
}: {
  original: Lesson;
  student: Student;
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [date, setDate] = useState(() => toDateInput(nextWeekday(new Date(), original.startsAt)));
  const [time, setTime] = useState(() => toTimeInput(original.startsAt));
  const [duration, setDuration] = useState(`${original.durationMinutes}`);
  const [teacherId, setTeacherId] = useState(original.teacherId);
  const [classroomId, setClassroomId] = useState(original.classroomId);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void Promise.all([api.teachers.listActive(), api.classrooms.list()]).then(
      ([teacherList, classroomList]) => {
        setTeachers(teacherList);
        setClassrooms(classroomList);
      },
    );
  }, []);

  /** 补课时间默认取「原课同一时刻的下一周」，避免又排在同一时间上。 */
  function startsAtIso(): string {
    return new Date(`${date}T${time}:00`).toISOString();
  }

  // 时间或人选一变就重新检查冲突（与排课表单同一套规则）
  useEffect(() => {
    let cancelled = false;
    const iso = startsAtIso();
    if (Number.isNaN(new Date(iso).getTime())) {
      setConflicts(null);
      return;
    }
    void api.lessons
      .findConflicts({
        subject: original.subject,
        form: original.form,
        teacherId,
        classroomId,
        studentIds: [student.id],
        startsAt: iso,
        durationMinutes: Math.max(15, Math.trunc(Number(duration) || original.durationMinutes)),
        status: "已排",
        note: "",
        makeupForLessonId: original.id,
      })
      // 同上：普通教师拿不到冲突结论（服务端拒绝，理由见 docs/后台API约定.md §三），
      // 当作"没有提示"处理，别让失败冒成未处理的 Promise 错误
      .catch(() => null)
      .then((report) => {
        if (!cancelled) setConflicts(report);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 依赖逐项列出，startsAtIso 由它们推导
  }, [classroomId, date, duration, original, student.id, teacherId, time]);

  const hasConflict = (conflicts?.total ?? 0) > 0;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasConflict) {
      setError("存在冲突或校验未通过，请先调整时间、教师或教室。");
      return;
    }

    setPending(true);
    setError("");
    const created = await api.lessons.createMakeup({
      originalLessonId: original.id,
      startsAt: startsAtIso(),
      durationMinutes: Math.max(15, Math.trunc(Number(duration) || original.durationMinutes)),
      teacherId,
      classroomId,
      studentIds: [student.id],
      note: `补课 · ${student.name}`,
    });
    setPending(false);

    if (created === null) {
      setError("原课不存在，无法建立补课。");
      return;
    }
    await onDone();
  }

  return (
    <form onSubmit={submit} className="mt-2 rounded-md border border-ink-100 bg-ink-50/60 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <TextField label="开始时间" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        <NumberInput
          label="时长"
          suffix="分钟"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          step={15}
          min={15}
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">教师</span>
          <select
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-600">教室</span>
          <select
            value={classroomId}
            onChange={(e) => setClassroomId(e.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
          >
            {classrooms.map((room) => (
              <option key={room.id} value={room.id}>
                {/* 教室名走唯一显示口径（「校区·教室名」，v31） */}
                {classroomLabel(room)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasConflict && conflicts !== null && (
        <p className="mt-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-xs text-warning-600">
          这个时间有冲突：教师 {conflicts.teacher.length} 处、教室 {conflicts.classroom.length} 处、
          学生 {conflicts.students.length} 处
          {conflicts.classroomClosed && "、教室该时段不开放"}
          {conflicts.overCapacity !== null && "、超过场地容量"}
        </p>
      )}

      {error !== "" && (
        <p role="alert" className="mt-2 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending || hasConflict}>
          {pending ? "安排中…" : "确认补课（扣 1 节）"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function toDateInput(date: Date): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 原课的「下一周同一天同一时刻」：补课默认不排在原课同一时间。 */
function nextWeekday(from: Date, originalIso: string): Date {
  const original = new Date(originalIso);
  const target = new Date(from);
  target.setDate(target.getDate() + 7);
  target.setHours(original.getHours(), original.getMinutes(), 0, 0);
  return target;
}
