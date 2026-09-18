"use client";

import { useMemo, useState } from "react";
import { TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { api, type Enrollment, type Student, type Teacher } from "@/lib/backend/api";
import { remainingOf, remainingTotal } from "@/lib/backend/enrollment";
import { formatDayLabel } from "@/lib/backend/format";
import { getFormOptions, getSubjectOptions } from "@/lib/backend/options";

/**
 * 报课与课时面板。
 *
 * 课时是**按科目**记账的（一门课一条报课记录），因此这里的三个动作对应三种真实业务：
 *   - **报课**：新开一条记录（科目 / 班型 / 课时 / 教师 / 日期）；
 *   - **续费**：给已有记录累加课时（会留下流水，家长对账时有据可查）；
 *   - **退课**：把记录标为已退课并记下日期 —— **不删除**，否则课时去向说不清。
 *
 * 上课扣课时不在这里：那发生在「课程安排」页的「标记已上」，
 * 扣哪一条由上课的科目决定（见 lib/backend/enrollment.ts）。
 */
export function EnrollmentPanel({
  student,
  teachers,
  onChanged,
}: {
  student: Student;
  teachers: Teacher[];
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const total = remainingTotal(student.enrollments);
  const active = student.enrollments.filter((item) => item.status === "在读");
  const subjectOptions = useMemo(() => getSubjectOptions(), []);
  const formOptions = useMemo(() => getFormOptions(), []);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    await action();
    setPending(false);
    await onChanged();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="text-sm text-ink-600">
          剩余课时合计{" "}
          <span className={total <= 5 ? "font-medium tabular text-warning-600" : "font-medium tabular text-ink-900"}>
            {total}
          </span>{" "}
          节
          <span className="ml-2 text-xs text-ink-400">
            在读 {active.length} 门 / 全部 {student.enrollments.length} 门
          </span>
        </p>
        <Button size="sm" onClick={() => setAdding((value) => !value)}>
          {adding ? "收起" : "报课"}
        </Button>
      </div>

      {adding && (
        <div className="border-b border-ink-100 bg-ink-50/60">
          <EnrollForm
            subjectOptions={subjectOptions}
            formOptions={formOptions}
            teachers={teachers}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await run(() => api.students.enroll(student.id, input));
              setAdding(false);
            }}
            pending={pending}
          />
        </div>
      )}

      {student.enrollments.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-500">
          还没有报课记录。点右上角「报课」记录科目与课时，之后上课时才能扣课时。
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {student.enrollments.map((enrollment) => (
            <EnrollmentRow
              key={enrollment.id}
              enrollment={enrollment}
              teacherName={teachers.find((t) => t.id === enrollment.teacherId)?.name ?? ""}
              expanded={expandedId === enrollment.id}
              onToggle={() => setExpandedId(expandedId === enrollment.id ? null : enrollment.id)}
              pending={pending}
              onRenew={(lessons) =>
                run(() =>
                  api.students.renewEnrollment(student.id, enrollment.id, lessons, "续费"),
                )
              }
              onRefund={() => {
                if (
                  !window.confirm(
                    `确认退课「${enrollment.subject}」？\n退课后不再计入剩余课时，记录会保留（可查历史）。`,
                  )
                ) {
                  return;
                }
                return run(() => api.students.refundEnrollment(student.id, enrollment.id, "退课"));
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 一条报课记录。 */
function EnrollmentRow({
  enrollment,
  teacherName,
  expanded,
  onToggle,
  pending,
  onRenew,
  onRefund,
}: {
  enrollment: Enrollment;
  teacherName: string;
  expanded: boolean;
  onToggle: () => void;
  pending: boolean;
  onRenew: (lessons: number) => void | Promise<void>;
  onRefund: () => void | Promise<void>;
}) {
  const remaining = remainingOf(enrollment);
  const refunded = enrollment.status === "已退课";

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="text-left text-sm font-medium text-ink-900 transition-colors hover:text-brand-700"
        >
          {enrollment.subject !== "" ? enrollment.subject : "未指定科目"}
          <span className="ml-1.5 text-xs text-ink-400">{expanded ? "▲" : "▼"}</span>
        </button>

        {enrollment.form !== "" && (
          <span className="text-xs text-ink-500">{enrollment.form}</span>
        )}
        {teacherName !== "" && <span className="text-xs text-ink-500">{teacherName}</span>}

        <span className={refunded ? "text-xs text-ink-400" : "text-xs text-ink-600"}>
          已购 {enrollment.totalLessons} · 已上 {enrollment.usedLessons} ·
          <span className={refunded ? "ml-1" : remaining <= 5 ? "ml-1 font-medium text-warning-600" : "ml-1"}>
            剩 {remaining}
          </span>
        </span>

        {refunded ? (
          <span className="rounded-sm border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
            已退课
          </span>
        ) : (
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => void onRenew(10)}
              className="text-xs text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-60"
            >
              续费 +10 节
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void onRefund()}
              className="text-xs text-ink-500 transition-colors hover:text-danger-600 disabled:opacity-60"
            >
              退课
            </button>
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2">
          <p className="text-xs text-ink-500">
            报课日期：{formatDayLabel(enrollment.startedAt)}
            {enrollment.endedAt !== "" && ` · 退课日期：${formatDayLabel(enrollment.endedAt)}`}
          </p>
          {enrollment.note !== "" && (
            <p className="mt-1 text-xs text-ink-500">备注：{enrollment.note}</p>
          )}
          <p className="mt-2 text-xs font-medium text-ink-600">流水</p>
          <ul className="mt-1 space-y-0.5">
            {enrollment.history.map((item, index) => (
              <li key={`${item.at}-${index}`} className="text-xs text-ink-500">
                {formatDayLabel(item.at)} · {item.kind}
                {item.lessons !== 0 && ` ${item.lessons} 节`}
                {item.note !== "" && ` · ${item.note}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** 报课表单。 */
function EnrollForm({
  subjectOptions,
  formOptions,
  teachers,
  onSubmit,
  onCancel,
  pending,
}: {
  subjectOptions: string[];
  formOptions: string[];
  teachers: Teacher[];
  onSubmit: (input: {
    subject: string;
    form: string;
    teacherId: string;
    lessons: number;
    startedAt: string;
    note: string;
  }) => void | Promise<void>;
  onCancel: () => void;
  pending: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [form, setForm] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [lessons, setLessons] = useState("10");
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (subject.trim() === "") {
      setError("科目必填。");
      return;
    }
    const count = Math.trunc(Number(lessons));
    if (!Number.isFinite(count) || count <= 0) {
      setError("课时数必须是大于 0 的整数。");
      return;
    }

    setError("");
    await onSubmit({
      subject: subject.trim(),
      form: form.trim(),
      teacherId,
      lessons: count,
      startedAt: new Date(`${startedAt}T00:00:00`).toISOString(),
      note,
    });
  }

  return (
    <form onSubmit={submit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="科目"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          list="enrollment-subject-options"
          placeholder="例如 初中数学"
          required
        />
        <TextField
          label="班型"
          value={form}
          onChange={(event) => setForm(event.target.value)}
          list="enrollment-form-options"
          placeholder="例如 一对一定制课"
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">指定教师</span>
          <select
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">不指定</option>
            {teachers
              .filter((teacher) => teacher.active)
              .map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
          </select>
        </label>
        <TextField
          label="课时数"
          type="number"
          min={1}
          value={lessons}
          onChange={(event) => setLessons(event.target.value)}
          hint="本次报课购买的节数"
          required
        />
        <TextField
          label="报课日期"
          type="date"
          value={startedAt}
          onChange={(event) => setStartedAt(event.target.value)}
        />
        <TextAreaField
          label="备注"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如 家长要求每周两次"
        />
      </div>

      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "保存中…" : "确认报课"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>

      <datalist id="enrollment-subject-options">
        {subjectOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="enrollment-form-options">
        {formOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </form>
  );
}
