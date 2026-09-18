"use client";

import { useState } from "react";
import { SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { api, STUDENT_STATUSES, type Student } from "@/lib/backend/api";

/**
 * 学生表单（基础信息）：新建与编辑共用。
 *
 * 这里只放「快速建档」需要的字段。**报读科目与课时不在这里**：
 * 它们由「报课记录」决定（见「报课与课时」面板），
 * 信息采集表的几十个字段在「信息采集表」面板里填。
 *
 * 这样分的理由：建档时家长通常只给得出姓名、年级、联系方式，
 * 其余信息是在沟通过程中逐步补齐的 —— 表单不该一上来就要八十个字段。
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
      status,
      note: note.trim(),
    };

    if (editing) await api.students.update(student.id, payload);
    else await api.students.create({ ...payload, profile: {} });

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

      <p className="mt-3 text-xs text-ink-500">
        {editing
          ? "报读科目与课时在下方「报课与课时」里维护；信息采集表在「信息采集表」里填写。"
          : "建档后可以在详情里报课（记录科目与课时），并填写信息采集表。"}
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
          {pending ? "保存中…" : editing ? "保存修改" : "建档"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
