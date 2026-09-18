"use client";

import { useState } from "react";
import { NumberInput, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { api, STUDENT_STATUSES, type Student } from "@/lib/backend/api";

/**
 * 学生表单：新建与编辑共用。
 *
 * 几个刻意的处理：
 * - 「报读科目」用逗号分隔的自由文本 + 站点已有课程名作为候选（datalist），
 *   既快又不容易写错科目标签；
 * - 剩余课时在**编辑**时可以手改（补录历史数据用），但日常增减走详情页的
 *   「±1 节」按钮 —— 那是扣课时的正常入口；
 * - 提交时做基本校验（姓名 / 年级必填），错误就地显示，不用弹窗。
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
  const [subjects, setSubjects] = useState((student?.subjects ?? []).join("、"));
  const [remainingLessons, setRemainingLessons] = useState(
    `${student?.remainingLessons ?? 0}`,
  );
  const [status, setStatus] = useState<Student["status"]>(student?.status ?? "在读");
  const [note, setNote] = useState(student?.note ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim() === "" || grade.trim() === "") {
      setError("姓名与年级必填。");
      return;
    }

    setPending(true);
    setError("");

    const payload = {
      name: name.trim(),
      grade: grade.trim(),
      guardian: guardian.trim(),
      subjects: subjects
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== ""),
      remainingLessons: Math.max(0, Math.trunc(Number(remainingLessons) || 0)),
      status,
      note: note.trim(),
    };

    if (editing) await api.students.update(student.id, payload);
    else await api.students.create(payload);

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
        <TextField
          label="报读科目"
          hint="用顿号或逗号分隔，例如「初中数学、初中物理」"
          value={subjects}
          onChange={(event) => setSubjects(event.target.value)}
          list="student-subject-options"
        />
        <NumberInput
          label="剩余课时"
          suffix="节"
          value={remainingLessons}
          onChange={(event) => setRemainingLessons(event.target.value)}
          hint={editing ? "补录历史数据时手改；日常增减用详情页的 ±1 节" : undefined}
        />
        <SelectInput
          label="状态"
          value={status}
          onChange={(event) => setStatus(event.target.value as Student["status"])}
          options={STUDENT_STATUSES.map((value) => ({ value, label: value }))}
        />
      </div>

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
          {pending ? "保存中…" : editing ? "保存修改" : "建档"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
