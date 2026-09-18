"use client";

import { useCallback, useEffect, useState } from "react";
import { SUBMISSION_OPTIONS, api, type HomeworkRecord } from "@/lib/backend/api";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/admin/AdminFields";
import { useMemo } from "react";

import { formatDayLabel } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

/**
 * 作业记录（按次）。
 *
 * 采集表里的作业记录是「日期 / 科目 / 提交情况 / 正确率 / 本次错题知识点」，
 * 属于**多次记录**，因此挂学生而不是塞进档案字段。
 *
 * 界面顺带算两个老师真正想知道的东西：提交率与平均正确率 ——
 * 逐条看记录只能看到「这一次」，统计才能看出「最近在退步」。
 */
export function HomeworkPanel({ studentId }: { studentId: string }) {
  const [records, setRecords] = useState<HomeworkRecord[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRecords(await api.homework.listByStudent(studentId));
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const list = records ?? [];
    if (list.length === 0) return null;
    const submitted = list.filter((item) => item.submission !== "未交").length;
    const scored = list.filter((item) => item.accuracy >= 0);
    const average = scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, item) => sum + item.accuracy, 0) / scored.length);
    const weak = list.filter((item) => item.weakPoints.trim() !== "").slice(0, 3);
    return { count: list.length, submitted, average, weak };
  }, [records]);

  async function remove(record: HomeworkRecord) {
    if (!window.confirm(`删除 ${formatDayLabel(record.date)} 的${record.subject}作业记录？`)) return;
    await api.homework.remove(record.id);
    await load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="text-sm text-ink-600">
          {records === null ? (
            "加载中…"
          ) : stats === null ? (
            "还没有作业记录"
          ) : (
            <>
              共 {stats.count} 次 · 按时/迟交 {stats.submitted} 次
              {stats.average !== null && (
                <>
                  {" · 平均正确率 "}
                  <span className="font-medium tabular text-ink-900">{stats.average}%</span>
                </>
              )}
            </>
          )}
        </p>
        <Button size="sm" onClick={() => setAdding((value) => !value)}>
          {adding ? "收起" : "记一次作业"}
        </Button>
      </div>

      {adding && (
        <div className="border-b border-ink-100 bg-ink-50/60">
          <HomeworkForm
            studentId={studentId}
            onCancel={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await load();
            }}
          />
        </div>
      )}

      {stats !== null && stats.weak.length > 0 && (
        <p className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500">
          近期错题知识点：{stats.weak.map((item) => item.weakPoints).join("、")}
        </p>
      )}

      {records !== null && records.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {records.map((record) => (
            <li key={record.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <span className="w-28 text-xs text-ink-500">{formatDayLabel(record.date)}</span>
              <span className="text-sm text-ink-800">{record.subject}</span>
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 text-[11px]",
                  record.submission === "按时"
                    ? "border-success-100 bg-success-50 text-success-600"
                    : record.submission === "迟交"
                      ? "border-warning-100 bg-warning-50 text-warning-600"
                      : "border-danger-100 bg-danger-50 text-danger-600",
                )}
              >
                {record.submission}
              </span>
              {record.accuracy >= 0 && (
                <span className="text-xs tabular text-ink-600">正确率 {record.accuracy}%</span>
              )}
              {record.weakPoints !== "" && (
                <span className="text-xs text-ink-500">错题：{record.weakPoints}</span>
              )}
              <button
                type="button"
                onClick={() => void remove(record)}
                className="ml-auto text-xs text-ink-500 transition-colors hover:text-danger-600"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        records !== null && (
          <p className="px-4 py-6 text-sm text-ink-500">还没有作业记录，点右上角记一次。</p>
        )
      )}
    </div>
  );
}

/** 记录一次作业。 */
function HomeworkForm({
  studentId,
  onCancel,
  onSaved,
}: {
  studentId: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  // 科目候选来自课程库（网站课程 + 机构自己加的课），见 useSubjectOptions
  const { names: subjects } = useSubjectOptions();
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submission, setSubmission] = useState<HomeworkRecord["submission"]>("按时");
  const [accuracy, setAccuracy] = useState("");
  const [weakPoints, setWeakPoints] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (subject.trim() === "") {
      setError("科目必填。");
      return;
    }
    const value = accuracy.trim() === "" ? -1 : Math.trunc(Number(accuracy));
    if (value !== -1 && (Number.isNaN(value) || value < 0 || value > 100)) {
      setError("正确率填 0–100，或留空表示未统计。");
      return;
    }

    setPending(true);
    setError("");
    await api.homework.create({
      studentId,
      subject: subject.trim(),
      date: new Date(`${date}T20:00:00`).toISOString(),
      submission,
      accuracy: value,
      weakPoints: weakPoints.trim(),
      note: note.trim(),
    });
    setPending(false);
    await onSaved();
  }

  return (
    <form onSubmit={submit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="科目"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          list="homework-subject-options"
          placeholder="例如 初中数学"
          required
        />
        <TextField
          label="日期"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">提交情况</span>
          <select
            value={submission}
            onChange={(event) => setSubmission(event.target.value as HomeworkRecord["submission"])}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {SUBMISSION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="正确率"
          hint="留空表示未统计"
          value={accuracy}
          onChange={(event) => setAccuracy(event.target.value)}
          placeholder="85"
        />
        <TextField
          label="本次错题知识点"
          value={weakPoints}
          onChange={(event) => setWeakPoints(event.target.value)}
          placeholder="例如 二次函数最值"
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <TextAreaField
            label="备注"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>

      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>

      <datalist id="homework-subject-options">
        {subjects.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </form>
  );
}
