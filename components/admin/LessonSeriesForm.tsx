"use client";

import { useMemo, useState } from "react";
import { NumberInput, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { Button } from "@/components/ui/Button";
import {
  api,
  LESSON_STATUSES,
  type Classroom,
  type Lesson,
  type SeriesPlan,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import { useFormOptions } from "@/components/admin/useFormOptions";
import { remainingOf } from "@/lib/backend/enrollment";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

/**
 * **按周批量排课**：一次排一串（例如"每周二、五 17:00，先来 20 节"）。
 *
 * ## 为什么是这个流程（预览 → 确认 → 写入）
 *
 * 学生报了 20 节，一节一节排要点二十次；但"自动排"最怕的是**硬塞**：
 * 把课塞进已被占用的时间，事后要一节节去查。所以这里的顺序是：
 *
 *   1. **预检**（`lessons.planSeries`，只算不写）：列出将生成的每一节，
 *      并标出哪一节撞了谁（教师 / 教室 / 学生 / 教室不开放 / 超容量 / 科目不符）；
 *   2. **你确认**（可以改星期几、时间、节数，再预检一次）；
 *   3. **写入**（`lessons.createSeries`）：能排的排上，**冲突的跳过并逐条说明**。
 *
 * 预检与写入用的是**同一套冲突判定**，所以"预览说能排、写入说不行"不会发生。
 *
 * ## 节数不用你数
 *
 * 默认填**建议节数** = 该科目剩余课时 − 已排未上（多人班课取剩余最少的那位）。
 * 剩余课时来自报课记录，不需要人去翻。
 *
 * ## 不处理的事（刻意的边界）
 *
 * **调休、节假日、寒暑假不自动跳过** —— 就是"按星期几往后数"。
 * 这类情况手动处理：挪课改单节时间，缺课走「待补课」。
 */
export function LessonSeriesForm({
  teachers,
  classrooms,
  students,
  onDone,
  onCancel,
}: {
  teachers: Teacher[];
  classrooms: Classroom[];
  students: Student[];
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
  // 班型候选：来自课程类型维度表（一对一 / 一对二 / 一对三 / 一对多（4-8）/ 班课（9-20））
  const formOptions = useFormOptions();
  const { options: subjectOptions } = useSubjectOptions();

  const [subject, setSubject] = useState("");
  const [form, setForm] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [duration, setDuration] = useState("90");
  const [status, setStatus] = useState<Lesson["status"]>("已排");
  const [note, setNote] = useState("按周批量排课");

  const [startDate, setStartDate] = useState(() => toDateInput(new Date()));
  const [weekdays, setWeekdays] = useState<number[]>([6]);
  const [time, setTime] = useState("17:00");
  const [count, setCount] = useState("8");

  const [plan, setPlan] = useState<SeriesPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  /** 选中的学生在这个科目上还剩多少节（多人时取最少的那位，班课按同一份课表走）。 */
  const remaining = useMemo(() => {
    const picked = students.filter((student) => studentIds.includes(student.id));
    if (picked.length === 0 || subject.trim() === "") return null;
    const each = picked.map((student) =>
      student.enrollments
        .filter((enrollment) => enrollment.status === "在读" && enrollment.subject === subject.trim())
        .reduce((sum, enrollment) => sum + remainingOf(enrollment), 0),
    );
    return Math.min(...each);
  }, [students, studentIds, subject]);

  const input = useMemo(
    () => ({
      subject: subject.trim(),
      form,
      teacherId,
      classroomId,
      studentIds,
      durationMinutes: Math.max(15, Math.trunc(Number(duration) || 0)),
      status,
      note,
      startDate,
      weekdays,
      time,
      count: Math.max(0, Math.trunc(Number(count) || 0)),
    }),
    [subject, form, teacherId, classroomId, studentIds, duration, status, note, startDate, weekdays, time, count],
  );

  function validate(): string {
    if (input.subject === "") return "科目必填。";
    if (input.teacherId === "") return "请选教师（冲突检查要按教师判）。";
    if (input.classroomId === "") return "请选教室。";
    if (input.studentIds.length === 0) return "至少选一位学生。";
    if (input.weekdays.length === 0) return "至少选一个星期几。";
    if (input.count === 0) return "节数要大于 0。";
    return "";
  }

  async function onPreview() {
    const problem = validate();
    if (problem !== "") {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setPlan(await api.lessons.planSeries(input));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setError("");
    try {
      const outcome = await api.lessons.createSeries(input);
      const range =
        outcome.first === ""
          ? ""
          : `（${outcome.first.slice(0, 10)} 起，到 ${outcome.last.slice(0, 10)}）`;
      setMessage(
        `已排 ${outcome.created} 节${range}` +
          (outcome.skipped.length > 0 ? `；跳过 ${outcome.skipped.length} 节（原因见下）` : ""),
      );
      setPlan(outcome.plan);
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="科目"
          hint="与报课记录的科目一致，才能对上剩余课时"
          list="series-subject-options"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            setPlan(null);
          }}
          required
        />
        <datalist id="series-subject-options">
          {subjectOptions.map((option) => (
            <option key={option.name} value={option.name} />
          ))}
        </datalist>
        <SelectInput
          label="班型"
          value={form}
          onChange={(event) => setForm(event.target.value)}
          /*
           * 当前值不在候选里时（老数据里的「一对一定制课」这类旧写法，或者机构刚把
           * 某个班型改名）把它**补在最前面**，否则浏览器会显示第一项「（不填）」，
           * 保存时那次静默替换就会把班型改掉、而没人按过它。
           */
          options={[
            { value: "", label: "（不填）" },
            ...(form !== "" && !formOptions.includes(form)
              ? [{ value: form, label: `${form}（旧写法）` }]
              : []),
            ...formOptions.map((value) => ({ value, label: value })),
          ]}
        />
        <SelectInput
          label="教师"
          value={teacherId}
          onChange={(event) => {
            setTeacherId(event.target.value);
            setPlan(null);
          }}
          options={[
            { value: "", label: "（请选择）" },
            ...teachers
              .filter((teacher) => teacher.kind !== "AI")
              .map((teacher) => ({ value: teacher.id, label: teacher.name })),
          ]}
        />
        <SelectInput
          label="教室"
          value={classroomId}
          onChange={(event) => {
            setClassroomId(event.target.value);
            setPlan(null);
          }}
          options={[
            { value: "", label: "（请选择）" },
            ...classrooms.map((room) => ({ value: room.id, label: room.name })),
          ]}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <MultiSelect
          label="上课学生"
          hint="可按姓名搜索；班课一次多选"
          options={students.map((student) => ({
            value: student.id,
            group: student.grade === "" ? undefined : student.grade,
          }))}
          value={studentIds}
          onChange={(value) => {
            setStudentIds(value);
            setPlan(null);
          }}
          placeholder="点击选择学生"
        />
        <div className="text-xs leading-relaxed text-ink-500">
          {remaining === null
            ? "选好学生与科目后，这里会显示该科目还剩多少节课。"
            : `该科目剩余课时：${remaining} 节${studentIds.length > 1 ? "（多人班课按剩余最少的那位算）" : ""}`}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 px-3 py-3">
        <p className="text-xs font-medium text-ink-700">按周重复</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="起排日期"
            hint="当天符合星期几就算第一节"
            type="date"
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
              setPlan(null);
            }}
          />
          <TextField
            label="开始时间"
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              setPlan(null);
            }}
          />
          <NumberInput
            label="时长"
            suffix="分钟"
            step={15}
            min={15}
            value={duration}
            onChange={(event) => {
              setDuration(event.target.value);
              setPlan(null);
            }}
          />
          <NumberInput
            label="排多少节"
            hint={remaining === null ? "课时够不够由服务端复核" : `该科目剩 ${remaining} 节，超了会被砍到能排的节数`}
            min={1}
            max={200}
            value={count}
            onChange={(event) => {
              setCount(event.target.value);
              setPlan(null);
            }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-600">每周几</span>
          {[1, 2, 3, 4, 5, 6, 7].map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => {
                setWeekdays((prev) =>
                  prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day].sort(),
                );
                setPlan(null);
              }}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                weekdays.includes(day)
                  ? "border-brand-500 bg-white font-medium text-brand-800"
                  : "border-ink-200 bg-white text-ink-600 hover:border-brand-300"
              }`}
            >
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"][day - 1]}
            </button>
          ))}
          <SelectInput
            label="状态"
            className="ml-2"
            value={status}
            onChange={(event) => setStatus(event.target.value as Lesson["status"])}
            options={LESSON_STATUSES.map((value) => ({ value, label: value }))}
          />
        </div>

        <TextAreaField
          label="备注"
          className="mt-3"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {plan !== null && plan.shortageMessage !== "" && (
        <p className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm leading-relaxed text-warning-600">
          {plan.shortageMessage}
          （规则：**课时不够就不排课** —— 免得欠账；先续费或报课再加排。）
        </p>
      )}

      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}
      {message !== "" && (
        <p className="mt-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{message}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void onPreview()} disabled={busy}>
          {busy ? "处理中…" : "预览（先看看排在哪几天）"}
        </Button>
        <Button onClick={() => void onConfirm()} disabled={busy || plan === null || plan.schedulable === 0}>
          排入这 {plan?.schedulable ?? 0} 节
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <span className="text-xs text-ink-400">
          冲突的节会**跳过并说明**，不会硬塞；排完仍可单节改时间。
        </span>
      </div>

      {plan !== null && (
        <div className="mt-3 rounded-md border border-ink-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-3 py-2 text-xs">
            <span className="font-medium text-ink-800">
              预检：{plan.items.length} 节中能排 {plan.schedulable} 节
              {plan.blocked > 0 ? `，有 ${plan.blocked} 节撞了别的安排（会跳过）` : "，都没有冲突"}
            </span>
            <span className="text-ink-500">
              该科目剩余 {plan.remainingLessons} 节 · 已排未上 {plan.alreadyScheduled} 节 ·
              建议排 {plan.suggestedCount} 节
            </span>
            {plan.cappedBy > 0 && (
              /*
               * 课时不足时必须明说"少排了多少、是谁不够" ——
               * 静默少排是另一种形式的欠账：人会以为排上了。
               */
              <span className="text-danger-600">
                你填了 {plan.requestedCount} 节，按剩余课时只排 {plan.items.length} 节（少 {plan.cappedBy} 节）
              </span>
            )}
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-ink-100 text-ink-500">
                  <th className="px-3 py-1.5 font-medium">#</th>
                  <th className="px-3 py-1.5 font-medium">时间</th>
                  <th className="px-3 py-1.5 font-medium">能不能排</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((item, index) => (
                  <tr key={item.startsAt} className="border-b border-ink-50 last:border-0">
                    <td className="px-3 py-1.5 text-ink-400">{index + 1}</td>
                    <td className="px-3 py-1.5 text-ink-800">{item.dayLabel}</td>
                    <td className="px-3 py-1.5">
                      {item.ok ? (
                        <span className="text-success-600">可排</span>
                      ) : (
                        <span className="text-danger-600">跳过：{item.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function pad(value: number): string {
  return `${value}`.padStart(2, "0");
}

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
