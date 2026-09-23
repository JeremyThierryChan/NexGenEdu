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
import { useFormOptions } from "@/components/admin/useFormOptions";
import { remainingTotal } from "@/lib/backend/enrollment";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

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
  /*
   * 乐观锁（v17）：打开这节课的表单时读到的版本。
   *
   * 存成 state 而不是提交时读 `lesson.version`：父组件的列表刷新之后那个 prop
   * 已经是新对象了（老师刚标了"已上"、或别人改过时间），用它提交等于把锁关掉。
   */
  const [version, setVersion] = useState(lesson?.version ?? 1);

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
  // 已经排了但还没上的课（算"还能排几节"时要扣掉它们，才能与服务端口径一致）
  const [scheduled, setScheduled] = useState<Lesson[]>([]);
  const [status, setStatus] = useState<Lesson["status"]>(lesson?.status ?? "已排");
  const [note, setNote] = useState(lesson?.note ?? "");

  // 科目候选来自课程库（网站课程 + 机构自己加的课），见 useSubjectOptions
  const { names: subjectOptions } = useSubjectOptions();
  const formOptions = useFormOptions();

  useEffect(() => {
    void Promise.all([
      api.students.list(),
      api.teachers.listActive(),
      api.classrooms.list(),
      api.lessons.list(),
    ]).then(
      ([studentList, teacherList, classroomList, lessonList]) => {
        setStudents(studentList);
        setScheduled(lessonList);
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
      // 普通排课不带补课关联（补课走 api.lessons.createMakeup）
      makeupForLessonId: lesson?.makeupForLessonId ?? "",
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
    /*
     * 冲突提示是**给有排课权限的人**用的（服务端对普通教师拒绝 findConflicts：
     * 那份结论里会点名别的教师与别的学生，属于行级范围要挡住的东西，见
     * docs/后台API约定.md §三）。教师这边就当作"没有提示" ——
     * 关键是不能让这次失败冒成未处理的 Promise 错误（那会让整块表单看着像坏了）。
     */
    void api.lessons
      .findConflicts(input)
      .catch(() => null)
      .then((report) => {
        if (cancelled) return;
        setConflicts(report);
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildInput 依赖上面每个字段，这里逐项列出更直观
  }, [date, time, duration, teacherId, classroomId, studentIds, status, lesson]);

  const hasConflict = (conflicts?.total ?? 0) > 0;

  /**
   * **课时够不够**（规则：课时不够就不排课）。
   *
   * 与服务端 `insufficientLessons` 用同一套口径：该科目**在读**报课的剩余课时，
   * 减去已排未上的节数（编辑这节课时把自己排除）。
   * 界面先算一次是为了让人在点保存之前就知道 —— 但真正的保证在服务端（它会再算一次）。
   */
  const shortOfLessons = useMemo(() => {
    const text = subject.trim();
    if (text === "" || studentIds.length === 0) return [];
    return studentIds
      .map((id) => students.find((student) => student.id === id))
      .filter((student): student is Student => student !== undefined)
      .map((student) => {
        const remaining = student.enrollments
          .filter((enrollment) => enrollment.status === "在读" && enrollment.subject.trim() === text)
          .reduce((sum, enrollment) => sum + Math.max(0, enrollment.totalLessons - enrollment.usedLessons), 0);
        const already = scheduled.filter(
          (item) =>
            item.id !== lesson?.id &&
            item.status === "已排" &&
            item.subject.trim() === text &&
            item.studentIds.includes(student.id),
        ).length;
        return { student, affordable: Math.max(0, remaining - already) };
      })
      .filter((item) => item.affordable < 1);
  }, [students, studentIds, subject, scheduled, lesson?.id]);

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
    if (shortOfLessons.length > 0) {
      setError(
        `课时不足：${shortOfLessons.map((item) => `${item.student.name}（还能排 0 节）`).join("、")}。` +
        "请先到学生的「报课与课时」页续费或报课，再来排这一节。",
      );
      return;
    }
    if (hasConflict) {
      setError(
        conflicts?.classroomClosed === true
          ? "所选教室在该时段不开放，请先调整时间或场地。"
          : conflicts?.overCapacity != null
            ? "学生数超过场地容量，请换场地或拆课。"
            : "存在冲突或校验未通过，请先按上方提示调整。",
      );
      return;
    }

    setPending(true);
    setError("");

    try {
      if (editing) {
        // 编辑：id 不进 patch（服务端以路径参数为准）
        const patch: Partial<LessonInput> = { ...input };
        delete patch.id;
        /*
         * 带上读到的版本（乐观锁，v17）：这节课可能刚被标成「已上」、或被别人挪了时间，
         * 那时服务端会拒绝（409），界面上把服务端原话显示在下面同一个 error 位置 ——
         * 而不是让"保存成功"背后把对方改的东西悄悄盖掉。
         */
        const saved = await api.lessons.update(lesson.id, patch, { expectedVersion: version });
        if (saved !== null) setVersion(saved.version);
      } else {
        const payload: Partial<LessonInput> = { ...input };
        delete payload.id;
        await api.lessons.create(payload as Omit<LessonInput, "id">);
      }
    } catch (cause) {
      // 冲突（409）与课时不足、参数错都在这里显示服务端原话
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
      setPending(false);
      return;
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
                      剩 {remainingTotal(student.enrollments)}
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
      {shortOfLessons.length > 0 && (
        <p className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm leading-relaxed text-warning-600">
          <strong className="font-medium">课时不足，先不排：</strong>
          {shortOfLessons.map((item) => item.student.name).join("、")} 在「{subject.trim()}」上已经没有可排的课时了
          （剩余课时减去已排未上）。请先续费/报课 —— 这条规则是为了**不产生欠账**。
        </p>
      )}

      {!checking && hasConflict && conflicts !== null && (
        <div className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2.5">
          <p className="text-sm font-medium text-warning-600">
            {conflicts.classroomClosed
              ? "所选教室在该时段不开放"
              : conflicts.overCapacity !== null
                ? "学生数超过场地容量"
                : conflicts.teacherSubjectMismatch &&
                    conflicts.teacher.length + conflicts.classroom.length + conflicts.students.length === 0
                  ? "任课教师的科目与这节课不符"
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
          {conflicts.overCapacity !== null && (
            <p className="mt-1 text-xs text-warning-600">
              选了 {conflicts.overCapacity.students} 位学生，但这间场地只能坐{" "}
              {conflicts.overCapacity.capacity} 人。请换更大的场地，或拆成两节课。
            </p>
          )}
          {conflicts.teacherSubjectMismatch && (
            <p className="mt-1 text-xs text-warning-600">
              所选教师的「可带科目」里没有「{subject}」。如果不是笔误，可以先到
              <a href="/admin/teachers" className="mx-1 underline">
                教师
              </a>
              里补上这门科目。
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
        <Button type="submit" size="sm" disabled={pending || hasConflict || shortOfLessons.length > 0}>
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
