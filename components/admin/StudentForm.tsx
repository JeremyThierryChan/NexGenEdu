"use client";

import { useEffect, useMemo, useState } from "react";
import { SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { Button } from "@/components/ui/Button";
import { getFormOptions } from "@/lib/backend/options";
import { api, STUDENT_STATUSES, type Student, type Teacher } from "@/lib/backend/api";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

/**
 * 学生表单（基础信息）：新建与编辑共用。
 *
 * 这里只放「快速建档」需要的字段。信息采集表的几十个字段在「信息采集表」面板里填。
 *
 * **报课在新建时可以一并填**（可多门，每门节数各自独立）：家长来报名时说的就是
 * 「数学 10 节、英语 20 节」，先建档再逐门点「报课」是重复劳动。编辑时这块不显示 ——
 * 已有报课记录在「报课与课时」里维护（那里有续费、退课、收款，别在表单里改账）。
 *
 * 金额刻意不在这里收：报课的「约定应缴 / 实收」要按班型定价算，而且可能分期，
 * 建档时先记科目与课时，钱到「报课与课时 → 收款」里记 —— 钱的入口只留一个。
 */
export function StudentForm({
  student,
  onCancel,
  onSaved,
}: {
  student?: Student;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = student !== undefined;

  const [name, setName] = useState(student?.name ?? "");
  const [grade, setGrade] = useState(student?.grade ?? "");
  const [guardian, setGuardian] = useState(student?.guardian ?? "");
  const [status, setStatus] = useState<Student["status"]>(student?.status ?? "在读");
  const [note, setNote] = useState(student?.note ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  /*
   * 报课（只有新建时用）：勾选的科目 + 每门各自的节数。
   *
   * 节数用字符串存，因为输入框允许「先删空再补数字」，中间态不是合法数字。
   */
  const { options: subjectOptions } = useSubjectOptions();
  const formOptions = useMemo(() => getFormOptions(), []);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [lessonsBySubject, setLessonsBySubject] = useState<Record<string, string>>({});
  const [bulkLessons, setBulkLessons] = useState("10");
  const [form, setForm] = useState(() => getFormOptions()[0] ?? "");
  const [teacherId, setTeacherId] = useState("");

  useEffect(() => {
    if (editing) return;
    let alive = true;
    void api.teachers
      .listActive()
      .then((rows) => {
        if (alive) setTeachers(rows);
      })
      .catch(() => {
        // 取不到教师只是少一个可选项，不该让建档打不开
      });
    return () => {
      alive = false;
    };
  }, [editing]);

  const lessonsOf = (subject: string) => lessonsBySubject[subject] ?? bulkLessons;
  const totalLessons = picked.reduce((sum, subject) => {
    const value = Number(lessonsOf(subject));
    return sum + (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
  }, 0);

  function applyBulk() {
    setLessonsBySubject(Object.fromEntries(picked.map((subject) => [subject, bulkLessons])));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim() === "" || grade.trim() === "") {
      setError("姓名与年级必填。");
      return;
    }

    /*
     * 报课数据先在界面上拦一遍（服务端还会再拦一次）。
     * 界面这层是为了即时反馈：填错了立刻说，不用等一次往返。
     */
    const enrollments = picked.map((subject) => ({
      subject,
      lessons: Math.trunc(Number(lessonsOf(subject))),
      form,
      teacherId,
    }));
    for (const item of enrollments) {
      if (!Number.isFinite(item.lessons) || item.lessons <= 0) {
        setError(`「${item.subject}」的课时数要填大于 0 的整数。`);
        return;
      }
    }

    setPending(true);
    setError("");

    const payload = {
      name: name.trim(),
      grade: grade.trim(),
      guardian: guardian.trim(),
      status,
      note: note.trim(),
    };

    try {
      if (editing) await api.students.update(student.id, payload);
      else await api.students.create({ ...payload, profile: {}, enrollments });
    } catch (cause) {
      // 服务端拒绝的理由（例如同一门科目报了两次）要原样显示出来
      setPending(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }

    setPending(false);
    await onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="姓名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 示例·李同学"
          required
        />
        <TextField
          label="年级"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
          placeholder="例如 初二 / 小学五年级"
          required
        />
        <TextField
          label="家长联系方式"
          value={guardian}
          onChange={(event) => setGuardian(event.target.value)}
          placeholder="电话或微信"
        />
        <SelectInput
          label="状态"
          value={status}
          onChange={(event) => setStatus(event.target.value as Student["status"])}
          options={STUDENT_STATUSES.map((value) => ({ value, label: value }))}
        />
      </div>

      {/* 报课（只有新建时显示）：勾选科目 + 每门各自的节数 */}
      {!editing && (
        <div className="mt-4 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
          <p className="text-xs font-medium text-ink-700">报课科目与课时（选填，可多门）</p>
          <p className="mt-1 text-xs text-ink-500">
            勾选科目、填节数，建档时就一起把课时记上 —— 例如数学 10 节、英语 20 节。
            金额与收款等家长付款后在「报课与课时 → 收款」里补记（那里也支持分期）。
          </p>

          <div className="mt-2">
            <MultiSelect
              label="报课科目"
              hint="可多选；候选取自课程库（网站课程 + 机构自建课程）"
              options={subjectOptions.map((option) => ({
                value: option.name,
                group: option.category,
              }))}
              value={picked}
              onChange={setPicked}
              placeholder="点击勾选科目（可多门）"
            />
          </div>

          {picked.length > 0 && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex items-center gap-1.5 text-xs text-ink-600">
                  统一节数
                  <input
                    type="number"
                    min={1}
                    value={bulkLessons}
                    onChange={(event) => setBulkLessons(event.target.value)}
                    className="w-16 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={applyBulk}>
                    应用到所有科目
                  </Button>
                </label>
                <span className="text-xs text-ink-500">
                  已选 {picked.length} 门 · 合计 {totalLessons} 节
                </span>
              </div>

              <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-md border border-ink-200 bg-white">
                {picked.map((subject) => (
                  <li key={subject} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{subject}</span>
                    <input
                      type="number"
                      min={1}
                      value={lessonsOf(subject)}
                      aria-label={`${subject} 的课时数`}
                      onChange={(event) =>
                        setLessonsBySubject((current) => ({
                          ...current,
                          [subject]: event.target.value,
                        }))
                      }
                      className="w-20 rounded-md border border-ink-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                    <span className="text-xs text-ink-500">节</span>
                    <button
                      type="button"
                      onClick={() => setPicked((current) => current.filter((item) => item !== subject))}
                      className="text-xs text-ink-400 transition-colors hover:text-danger-600"
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextField
                  label="班型"
                  value={form}
                  onChange={(event) => setForm(event.target.value)}
                  list="student-enroll-form-options"
                  hint="这几门先按同一个班型录入，建档后可在「报课与课时」里逐门改"
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
                    {teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-ink-400">
                    多门课先用同一位；要分开带，建档后在「报课与课时」里逐门改
                  </span>
                </label>
              </div>
              <datalist id="student-enroll-form-options">
                {formOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-500">
        {editing
          ? "报读科目与课时在下方「报课与课时」里维护；信息采集表在「信息采集表」里填写。"
          : "不勾科目也可以先建档（之后在详情里报课）；信息采集表可以以后再填。"}
      </p>

      <div className="mt-3">
        <TextAreaField
          label="备注"
          hint="薄弱点、家长诉求、上课习惯等，只在后台可见。"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      {error !== "" && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "保存中…" : editing ? "保存修改" : picked.length > 0 ? `建档并报课（${picked.length} 门）` : "建档"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
