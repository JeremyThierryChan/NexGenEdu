"use client";

import { useEffect, useMemo, useState } from "react";
import { NumberInput, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { api, type Classroom, type InquirySlot, type Teacher } from "@/lib/backend/api";
// 教室名的唯一显示口径（「校区·教室名」，v31）
import { classroomLabel } from "@/lib/backend/classrooms";
import { getStandardSlots } from "@/lib/backend/options";
import { weekdayLabel } from "@/lib/backend/inquiry";
import { cn } from "@/lib/utils/cn";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

/**
 * 咨询登记表。
 *
 * 对应「家长在电话里说的那些话」：想上什么课、什么时候有空、多久上一次、
 * 想指定老师还是随便安排。填完点「判定可行性」，系统会算出每个候选时段
 * 能不能排下**整串课**（不是只排一次）。
 *
 * 时段允许任意填（家长可能说「周六 15:30」），但旁边给一排**学校标准时段**的
 * 快捷按钮 —— 那些值直接从「时间安排」页的内容里读，不在这里另抄一份。
 */
export function InquiryForm({
  onCreated,
  onCancel,
}: {
  onCreated: (inquiryId: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [studentName, setStudentName] = useState("");
  const [grade, setGrade] = useState("");
  const [guardian, setGuardian] = useState("");
  const [subject, setSubject] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("90");
  const [intervalWeeks, setIntervalWeeks] = useState("1");
  const [plannedLessons, setPlannedLessons] = useState("12");
  const [startsAt, setStartsAt] = useState(() => toDateInput(new Date()));
  const [preferredTeacherId, setPreferredTeacherId] = useState("");
  const [preferredClassroomId, setPreferredClassroomId] = useState("");
  const [note, setNote] = useState("");

  const [slots, setSlots] = useState<Array<{ id: string; weekday: string; start: string }>>([
    { id: "c1", weekday: "6", start: "10:00" },
  ]);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [skipInput, setSkipInput] = useState("");
  const [quickWeekday, setQuickWeekday] = useState("6");

  // 科目候选来自课程库（网站课程 + 机构自己加的课），见 useSubjectOptions
  const { names: subjects } = useSubjectOptions();
  const standardSlots = useMemo(() => getStandardSlots(), []);

  useEffect(() => {
    void Promise.all([api.teachers.listActive(), api.classrooms.list()]).then(
      ([teacherList, classroomList]) => {
        setTeachers(teacherList);
        setClassrooms(classroomList);
      },
    );
  }, []);

  function addSlot(weekday: string, start: string) {
    setSlots((current) => [
      ...current,
      { id: `c${Date.now().toString(36)}`, weekday, start },
    ]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (studentName.trim() === "") return setError("请填学生姓名。");
    if (subject.trim() === "") return setError("请填想上的科目。");
    if (slots.length === 0) return setError("至少给一个候选时段。");
    for (const slot of slots) {
      if (!/^\d{1,2}:\d{2}$/.test(slot.start.trim())) {
        return setError(`时间「${slot.start}」格式不对，应为 HH:MM。`);
      }
    }
    const count = Math.trunc(Number(plannedLessons));
    if (!Number.isFinite(count) || count <= 0) return setError("计划节数要大于 0。");

    setSubmitting(true);
    setError("");

    const candidates: InquirySlot[] = slots.map((slot) => ({
      id: slot.id,
      weekday: Number(slot.weekday),
      start: slot.start.trim().padStart(5, "0"),
    }));

    const created = await api.inquiries.create({
      studentName: studentName.trim(),
      grade: grade.trim(),
      guardian: guardian.trim(),
      subject: subject.trim(),
      durationMinutes: Math.trunc(Number(durationMinutes)) || 90,
      intervalWeeks: Math.trunc(Number(intervalWeeks)) || 1,
      plannedLessons: count,
      startsAt: new Date(`${startsAt}T00:00:00`).toISOString(),
      candidates,
      preferredTeacherId,
      preferredClassroomId,
      skipDates,
      status: "待确认",
      note: note.trim(),
    });

    setSubmitting(false);
    await onCreated(created.id);
  }

  return (
    <form onSubmit={submit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="学生姓名"
          value={studentName}
          onChange={(event) => setStudentName(event.target.value)}
          placeholder="例如 王小明"
          required
        />
        <TextField
          label="年级"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
          placeholder="例如 初二"
        />
        <TextField
          label="家长联系方式"
          value={guardian}
          onChange={(event) => setGuardian(event.target.value)}
        />
        <TextField
          label="想上的科目"
          hint="从课程名里选，或直接填"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          list="inquiry-subject-options"
          placeholder="例如 初中数学"
          required
        />
        <SelectInput
          label="每次时长"
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(event.target.value)}
          options={[
            { value: "60", label: "60 分钟" },
            { value: "90", label: "90 分钟" },
            { value: "120", label: "120 分钟" },
          ]}
        />
        <SelectInput
          label="频率"
          value={intervalWeeks}
          onChange={(event) => setIntervalWeeks(event.target.value)}
          options={[
            { value: "1", label: "每周一次" },
            { value: "2", label: "每两周一次" },
          ]}
        />
        <NumberInput
          label="计划节数"
          suffix="节"
          value={plannedLessons}
          onChange={(event) => setPlannedLessons(event.target.value)}
          min={1}
          hint="决定要占未来多少个时段"
        />
        <TextField
          label="从哪天开始"
          type="date"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">指定教师</span>
          <select
            value={preferredTeacherId}
            onChange={(event) => setPreferredTeacherId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">不限（按当周课时量推荐）</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-600">指定场地</span>
          <select
            value={preferredClassroomId}
            onChange={(event) => setPreferredClassroomId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">不限</option>
            {classrooms.map((room) => (
              <option key={room.id} value={room.id}>
                {classroomLabel(room)}（{room.capacity} 人）
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 候选时段 */}
      <fieldset className="mt-4 rounded-md border border-ink-200 px-3 py-3">
        <legend className="px-1 text-xs font-medium text-ink-600">
          家长给的候选时段（按优先级从上到下试，第一个能排下的就用它）
        </legend>

        <ul className="space-y-2">
          {slots.map((slot, index) => (
            <li key={slot.id} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-ink-400">第 {index + 1} 选</span>
              <select
                value={slot.weekday}
                onChange={(event) =>
                  setSlots((current) =>
                    current.map((item) =>
                      item.id === slot.id ? { ...item, weekday: event.target.value } : item,
                    ),
                  )
                }
                className="rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500"
              >
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <option key={day} value={`${day}`}>
                    {weekdayLabel(day)}
                  </option>
                ))}
              </select>
              <input
                type="time"
                value={slot.start}
                onChange={(event) =>
                  setSlots((current) =>
                    current.map((item) =>
                      item.id === slot.id ? { ...item, start: event.target.value } : item,
                    ),
                  )
                }
                className="rounded-md border border-ink-300 px-2 py-1 text-sm tabular outline-none focus:border-brand-500"
              />
              {slots.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSlots((current) => current.filter((item) => item.id !== slot.id))}
                  className="text-xs text-ink-500 transition-colors hover:text-danger-600"
                >
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
          <Button type="button" size="sm" variant="outline" onClick={() => addSlot(quickWeekday, "10:00")}>
            + 再加一个候选
          </Button>
          <span className="text-xs text-ink-400">常用时段（点一下按当前选中的星期填入）：</span>
          <select
            value={quickWeekday}
            onChange={(event) => setQuickWeekday(event.target.value)}
            className="rounded-md border border-ink-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand-500"
          >
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <option key={day} value={`${day}`}>
                {weekdayLabel(day)}
              </option>
            ))}
          </select>
          {standardSlots.map((slot) => (
            <button
              key={slot.start}
              type="button"
              onClick={() => addSlot(quickWeekday, slot.start)}
              className={cn(
                "rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-600 transition-colors",
                "hover:border-brand-300 hover:text-brand-700",
              )}
            >
              {slot.start}
            </button>
          ))}
        </div>
      </fieldset>

      {/* 跳过周 */}
      <fieldset className="mt-3 rounded-md border border-ink-200 px-3 py-3">
        <legend className="px-1 text-xs font-medium text-ink-600">
          跳过的日期（假期、考试周等；跳过后往后顺延，总节数不变）
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={skipInput}
            onChange={(event) => setSkipInput(event.target.value)}
            className="rounded-md border border-ink-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              if (skipInput === "" || skipDates.includes(skipInput)) return;
              setSkipDates((current) => [...current, skipInput].sort());
              setSkipInput("");
            }}
          >
            添加
          </Button>
          {skipDates.map((date) => (
            <span
              key={date}
              className="flex items-center gap-1.5 rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-700"
            >
              {date}
              <button
                type="button"
                onClick={() => setSkipDates((current) => current.filter((item) => item !== date))}
                className="text-ink-400 transition-colors hover:text-danger-600"
              >
                ×
              </button>
            </span>
          ))}
          {skipDates.length === 0 && <span className="text-xs text-ink-400">未设置</span>}
        </div>
      </fieldset>

      <div className="mt-3">
        <TextAreaField
          label="备注"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如 家长希望先试听一次；孩子周三有别的课"
        />
      </div>

      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "登记中…" : "登记并判定可行性"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>

      <datalist id="inquiry-subject-options">
        {subjects.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </form>
  );
}

function toDateInput(date: Date): string {
  const pad = (value: number) => `${value}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
