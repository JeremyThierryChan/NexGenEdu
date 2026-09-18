"use client";

import { useEffect, useMemo, useState } from "react";
import { NumberInput, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import {
  api,
  LESSON_STATUSES,
  type Classroom,
  type ConflictReport,
  type Lesson,
  type LessonInput,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import { getFormOptions, getSubjectOptions } from "@/lib/backend/options";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";

/**
 * 排课表单：新建与编辑共用，带**冲突检测**。
 *
 * 冲突分三类（教师 / 教室 / 学生）分别提示，因为处理方式不同：
 * 教师与教室冲突要改时间或换人换教室；学生冲突多是「同一个学生被排了两节」。
 * 有冲突时保存按钮禁用 —— 排课工具的底线是不让明显错误的课进系统。
 *
 * 冲突检查走服务层（api.lessons.findConflicts），页面不做时间重叠计算：
 * 真实服务端必须再校验一次，客户端检查只是体验。
 */
export function LessonForm({
  lesson,
  defaultDate,
  onCancel,
  onSaved,
}: {
  lesson?: Lesson;
  /** 新建时的默认日期（表单所在的当前日期）。 */
  defaultDate: Date;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = lesson !== undefined;

  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const initialDate = useMemo(() => {
    const source = lesson !== undefined ? new Date(lesson.startsAt) : defaultDate;
    return {
      date: `${source.getFullYear()}-${pad(source.getMonth() + 1)}-${pad(source.getDate())}`,
      time: `${pad(source.getHours())}:${pad(source.getMinutes())}`,
    };
  }, [defaultDate, lesson]);

  const [date, setDate] = useState(initialDate.date);
  const [time, setTime] = useState(initialDate.time);
  const [duration, setDuration] = useState(`${lesson?.durationMinutes ?? 60}`);
  const [subject, setSubject] = useState(lesson?.subject ?? "");
  const [form, setForm] = useState(lesson?.form ?? "");
  const [teacherId, setTeacherId] = useState(lesson?.teacherId ?? "");
  const [classroomId, setClassroomId] = useState(lesson?.classroomId ?? "");
  const [studentIds, setStudentIds] = useState<string[]>(lesson?.studentIds ?? []);
  const [status, setStatus] = useState<Lesson["status"]>(lesson?.status ?? "已排");
  const [note, setNote] = useState(lesson?.note ?? "");

  const subjectOptions = useMemo(() => getSubjectOptions(), []);
  const formOptions = useMemo(() => getFormOptions(), []);

  useEffect(() => {
    void Promise.all([api.students.list(), api.teachers.listActive(), api.classrooms.list()]).then(
      ([studentList, teacherList, classroomList]) => {
        setStudents(studentList);
        setTeachers(teacherList);
        setClassrooms(classroomList);
        // 新建时给一个合理默认值：第一位在职教师 + 第一个教室
        setTeacherId((current) => (current !== "" ? current : (teacherList[0]?.id ?? "")));
        setClassroomId((current) => (current !== "" ? current : (classroomList[0]?.id ?? "")));
      },
    );
  }, []);

  /** 组装当前表单对应的排课入参（冲突检查与保存共用，避免两处口径不一致）。 */
  function buildInput(): LessonInput | null {
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) return null;
    return {
      id: lesson?.id,
      subject: subject.trim(),
      form: form.trim(),
      teacherId,
      classroomId,
      studentIds,
      startsAt: startsAt.toISOString(),
      durationMinutes: Math.max(15, Math.trunc(Number(duration) || 60)),
      status,
      note: note.trim(),
    };
  }

  /** 表单变化即重新检查冲突（轻量：只算时间重叠，跑在本地服务层）。 */
  useEffect(() => {
    const input = buildInput();
    if (input === null || input.teacherId === "" || input.classroomId === "") {
      setConflicts(null);
      return;
    }

    let cancelled = false;
    setChecking(true);
    void api.lessons.findConflicts(input).then((report) => {
      if (!cancelled) {
        setConflicts(report);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildInput 依赖上面每个字段，这里逐项列出更直观
  }, [date, time, duration, teacherId, classroomId, studentIds, status, lesson]);

  const hasConflict = (conflicts?.total ?? 0) > 0;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input = buildInput();
    if (input === null) {
      setError("日期或时间格式不对。");
      return;
    }
    if (input.subject === "") {
      setError("科目必填。");
      return;
    }
    if (input.studentIds.length === 0) {
      setError("至少要选一位学生。");
      return;
    }
    if (hasConflict) {
      setError(
        conflicts?.classroomClosed === true
          ? "所选教室在该时段不开放，请先调整时间或场地。"
          : "存在时间冲突，请先调整。",
      );
      return;
    }

    setPending(true);
    setError("");

    if (editing) {
      // 编辑：id 不进 patch（服务端以路径参数为准）
      const patch: Partial<LessonInput> = { ...input };
      delete patch.id;
      await api.lessons.update(lesson.id, patch);
    } else {
      const payload: Partial<LessonInput> = { ...input };
      delete payload.id;
      await api.lessons.create(payload as Omit<LessonInput, "id">);
    }

    setPending(false);
    await onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="日期"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          required
        />
        <TextField
          label="开始时间"
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
          required
        />
        <NumberInput
          label="时长"
          suffix="分钟"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          step={15}
          min={15}
        />
        <SelectInput
          label="状态"
          value={status}
          onChange={(event) => setStatus(event.target.value as Lesson["status"])}
          options={LESSON_STATUSES.map((value) => ({ value, label: value }))}
        />

        <TextField
          label="科目"
          hint="可手填，也可从候选项里选"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          list="lesson-subject-options"
          placeholder="例如 初中数学"
          required
        />
        <TextField
          label="班型"
          value={form}
          onChange={(event) => setForm(event.target.value)}
          list="lesson-form-options"
          placeholder="例如 一对一定制课"
        />
        <SelectInput
          label="教师"
          value={teacherId}
          onChange={(event) => setTeacherId(event.target.value)}
          options={teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))}
        />
        <SelectInput
          label="教室"
          value={classroomId}
          onChange={(event) => setClassroomId(event.target.value)}
          options={classrooms.map((room) => ({
            value: room.id,
            label:
              room.kind === "自习室"
                ? `${room.name}（自习室 · ${room.capacity} 座）`
                : `${room.name}（${room.capacity} 人）`,
          }))}
        />
      </div>

      {/* 学生多选 */}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium text-ink-600">
          上课学生（已选 {studentIds.length} 位）
        </legend>
        <div className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-ink-200 bg-white p-2">
          {students.length === 0 ? (
            <p className="px-1 py-2 text-sm text-ink-500">还没有学生档案。</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {students.map((student) => {
                const checked = studentIds.includes(student.id);
                return (
                  <label
                    key={student.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-ink-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setStudentIds((current) =>
                          checked
                            ? current.filter((id) => id !== student.id)
                            : [...current, student.id],
                        )
                      }
                    />
                    <span className="min-w-0 truncate text-ink-800">{student.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-400">
                      剩 {student.remainingLessons}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </fieldset>

      <div className="mt-3">
        <TextAreaField
          label="备注"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如 本次讲二次函数压轴题"
        />
      </div>

      {/* 冲突提示 */}
      {checking && <p className="mt-3 text-xs text-ink-400">正在检查时间冲突…</p>}
      {!checking && hasConflict && conflicts !== null && (
        <div className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2.5">
          <p className="text-sm font-medium text-warning-600">
            {conflicts.classroomClosed
              ? "所选教室在该时段不开放"
              : `时间冲突：${conflicts.teacher.length > 0 ? `教师 ${conflicts.teacher.length} 处` : ""}${
                  conflicts.classroom.length > 0
                    ? `${conflicts.teacher.length > 0 ? "、" : ""}教室 ${conflicts.classroom.length} 处`
                    : ""
                }${
                  conflicts.students.length > 0
                    ? `${conflicts.teacher.length + conflicts.classroom.length > 0 ? "、" : ""}学生 ${conflicts.students.length} 处`
                    : ""
                }`}
          </p>
          {conflicts.classroomClosed && (
            <p className="mt-1 text-xs text-warning-600">
              这个时间段落在该场地的可用时段之外。可以去
              <a href="/admin/classrooms" className="mx-1 underline">
                教室
              </a>
              里调整它的可用时段，或者换一个场地 / 改时间。
            </p>
          )}
          <ul className="mt-1.5 space-y-1 text-xs text-warning-600">
            {conflicts.teacher.map((item) => (
              <li key={`t-${item.id}`}>
                教师：{formatDayLabel(item.startsAt)} {formatTimeRange(item.startsAt, item.durationMinutes)} {item.subject}
              </li>
            ))}
            {conflicts.classroom.map((item) => (
              <li key={`c-${item.id}`}>
                教室：{formatDayLabel(item.startsAt)} {formatTimeRange(item.startsAt, item.durationMinutes)} {item.subject}
              </li>
            ))}
            {conflicts.students.map((item) => (
              <li key={`s-${item.studentId}-${item.lesson.id}`}>
                学生：
                {students.find((student) => student.id === item.studentId)?.name ?? item.studentId}
                {" 在 "}
                {formatDayLabel(item.lesson.startsAt)}{" "}
                {formatTimeRange(item.lesson.startsAt, item.lesson.durationMinutes)}
                {" 已有 "}
                {item.lesson.subject}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error !== "" && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" disabled={pending || hasConflict}>
          {pending ? "保存中…" : editing ? "保存修改" : "排课"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>

      <datalist id="lesson-subject-options">
        {subjectOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="lesson-form-options">
        {formOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </form>
  );
}

function pad(value: number): string {
  return `${value}`.padStart(2, "0");
}
