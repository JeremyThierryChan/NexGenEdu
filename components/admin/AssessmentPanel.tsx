"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Assessment } from "@/lib/backend/api";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/admin/AdminFields";

import { formatDayLabel } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

/**
 * 阶段测评（按次）。
 *
 * 采集表里的阶段测评是「本次分数 / 上次分数 / 趋势 / 薄弱知识点」。
 * 这里做了两件事：
 *   1. **上次分数与趋势由服务算**：新增时自动带出同科目上一条的分数，
 *      页面不自己去找上一条（补录旧数据时顺序容易对不上）；
 *   2. 按科目分组展示趋势，因为「数学在涨、英语在跌」比「最近三次的分数」
 *      更有用。
 */
export function AssessmentPanel({ studentId }: { studentId: string }) {
  const [records, setRecords] = useState<Assessment[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setRecords(await api.assessments.listByStudent(studentId));
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 按科目分组（记录已按日期倒序）。 */
  const bySubject = useMemo(() => {
    const map = new Map<string, Assessment[]>();
    for (const record of records ?? []) {
      map.set(record.subject, [...(map.get(record.subject) ?? []), record]);
    }
    return [...map];
  }, [records]);

  async function remove(record: Assessment) {
    if (!window.confirm(`删除 ${formatDayLabel(record.date)} 的${record.subject}测评记录？`)) return;
    await api.assessments.remove(record.id);
    await load();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="text-sm text-ink-600">
          {records === null ? "加载中…" : `共 ${records.length} 次测评，覆盖 ${bySubject.length} 个科目`}
        </p>
        <Button size="sm" onClick={() => setAdding((value) => !value)}>
          {adding ? "收起" : "记一次测评"}
        </Button>
      </div>

      {adding && (
        <div className="border-b border-ink-100 bg-ink-50/60">
          <AssessmentForm
            studentId={studentId}
            onCancel={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await load();
            }}
          />
        </div>
      )}

      {bySubject.length > 0 ? (
        <div className="space-y-4 px-4 py-4">
          {bySubject.map(([subject, list]) => {
            const latest = list[0]!;
            const trend = trendOf(latest);
            return (
              <section key={subject}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-sm font-medium text-ink-900">{subject}</h3>
                  <span className="text-sm tabular text-ink-900">{latest.score} 分</span>
                  <TrendLabel trend={trend} />
                  {latest.previousScore !== null && (
                    <span className="text-xs text-ink-400">上次 {latest.previousScore} 分</span>
                  )}
                  {latest.weakPoints !== "" && (
                    <span className="text-xs text-ink-500">薄弱：{latest.weakPoints}</span>
                  )}
                </div>

                <ul className="mt-1.5 divide-y divide-ink-100 rounded-md border border-ink-100">
                  {list.map((record) => (
                    <li key={record.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-xs">
                      <span className="w-24 text-ink-500">{formatDayLabel(record.date)}</span>
                      <span className="tabular text-ink-800">{record.score}</span>
                      <TrendLabel trend={trendOf(record)} compact />
                      {record.note !== "" && <span className="text-ink-500">{record.note}</span>}
                      <button
                        type="button"
                        onClick={() => void remove(record)}
                        className="ml-auto text-ink-500 transition-colors hover:text-danger-600"
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        records !== null && (
          <p className="px-4 py-6 text-sm text-ink-500">还没有测评记录，点右上角记一次。</p>
        )
      )}
    </div>
  );
}

/** 趋势：与上一次分数比较。 */
function trendOf(record: Assessment): "up" | "flat" | "down" | "first" {
  if (record.previousScore === null) return "first";
  if (record.score > record.previousScore) return "up";
  if (record.score < record.previousScore) return "down";
  return "flat";
}

function TrendLabel({ trend, compact = false }: { trend: ReturnType<typeof trendOf>; compact?: boolean }) {
  if (trend === "first") {
    return compact ? null : <span className="text-xs text-ink-400">首次</span>;
  }
  const map = {
    up: { text: "↑", className: "text-success-600" },
    flat: { text: "→", className: "text-ink-500" },
    down: { text: "↓", className: "text-danger-600" },
  } as const;
  const item = map[trend];
  return <span className={cn("text-xs", item.className)}>{item.text}</span>;
}

/** 记录一次测评。 */
function AssessmentForm({
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
  const [score, setScore] = useState("");
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
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0) {
      setError("分数必须是不小于 0 的数字。");
      return;
    }

    setPending(true);
    setError("");
    await api.assessments.add({
      studentId,
      subject: subject.trim(),
      date: new Date(`${date}T18:00:00`).toISOString(),
      score: value,
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
          list="assessment-subject-options"
          placeholder="例如 初中数学"
          required
        />
        <TextField
          label="本次分数"
          value={score}
          onChange={(event) => setScore(event.target.value)}
          required
        />
        <TextField
          label="测评日期"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <TextField
          label="薄弱知识点"
          value={weakPoints}
          onChange={(event) => setWeakPoints(event.target.value)}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <TextAreaField
            label="备注"
            hint="上次分数与趋势会按同科目的上一条记录自动带出，不用手填。"
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

      <datalist id="assessment-subject-options">
        {subjects.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </form>
  );
}
