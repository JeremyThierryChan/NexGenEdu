"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ATTENDANCE_OPTIONS,
  FOCUS_OPTIONS,
  INTERACTION_OPTIONS,
  api,
  type Lesson,
  type LessonRecord,
  type Student,
} from "@/lib/backend/api";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

/**
 * 课堂记录（一节课的每个学生一条）。
 *
 * 采集表里写明「每节课后由上课老师填写」，因此入口就放在课程安排的每一节课上：
 * 展开某节课 → 给这节的学生逐个填出勤 / 专注度 / 互动 / 状态评分 / 备注。
 *
 * 保存走 upsert（lessonId + studentId 唯一）：
 * 老师改完再保存必须**更新同一条**，而不是多出一条 —— 这是这类表单最容易写错的地方。
 */
export function LessonRecordPanel({ lesson }: { lesson: Lesson }) {
  const [records, setRecords] = useState<LessonRecord[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [draft, setDraft] = useState<Record<string, LessonRecordDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState("");

  const load = useCallback(async () => {
    const [recordList, studentList] = await Promise.all([
      api.lessonRecords.listByLesson(lesson.id),
      api.students.list(),
    ]);
    setRecords(recordList);
    setStudents(studentList);

    // 表单初值：已有记录用记录值，没有则用默认值（到课 / 中 / 一般 / 3 分）
    const next: Record<string, LessonRecordDraft> = {};
    for (const studentId of lesson.studentIds) {
      const existing = recordList.find((item) => item.studentId === studentId);
      next[studentId] = existing
        ? {
            attendance: existing.attendance,
            focus: existing.focus,
            interaction: existing.interaction,
            rating: `${existing.rating}`,
            note: existing.note,
          }
        : { attendance: "到课", focus: "中", interaction: "一般", rating: "3", note: "" };
    }
    setDraft(next);
  }, [lesson.id, lesson.studentIds]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(studentId: string) {
    const value = draft[studentId];
    if (value === undefined) return;

    setSavingId(studentId);
    await api.lessonRecords.save({
      lessonId: lesson.id,
      studentId,
      attendance: value.attendance,
      focus: value.focus,
      interaction: value.interaction,
      rating: Math.min(5, Math.max(1, Math.trunc(Number(value.rating) || 3))),
      note: value.note.trim(),
    });
    setSavingId(null);
    setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    await load();
  }

  if (records === null) {
    return <p className="px-4 py-3 text-xs text-ink-400">加载中…</p>;
  }

  return (
    <div className="px-4 py-3">
      <p className="text-xs text-ink-500">
        课后填写；同一节课同一位学生只有一条记录，重复保存是更新。
        {savedAt !== "" && <span className="ml-2 text-success-600">已保存（{savedAt}）</span>}
      </p>

      <ul className="mt-2 space-y-2">
        {lesson.studentIds.map((studentId) => {
          const value = draft[studentId];
          if (value === undefined) return null;
          const existing = records.find((item) => item.studentId === studentId);
          const name = students.find((item) => item.id === studentId)?.name ?? studentId;

          return (
            <li key={studentId} className="rounded-md border border-ink-200 bg-white px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="w-28 shrink-0 text-sm font-medium text-ink-900">{name}</span>

                <Choice
                  label="出勤"
                  options={ATTENDANCE_OPTIONS}
                  value={value.attendance}
                  onChange={(next) => setDraft((d) => ({ ...d, [studentId]: { ...value, attendance: next as LessonRecord["attendance"] } }))}
                />
                <Choice
                  label="专注"
                  options={FOCUS_OPTIONS}
                  value={value.focus}
                  onChange={(next) => setDraft((d) => ({ ...d, [studentId]: { ...value, focus: next as LessonRecord["focus"] } }))}
                />
                <Choice
                  label="互动"
                  options={INTERACTION_OPTIONS}
                  value={value.interaction}
                  onChange={(next) =>
                    setDraft((d) => ({
                      ...d,
                      [studentId]: { ...value, interaction: next as LessonRecord["interaction"] },
                    }))
                  }
                />

                <label className="flex items-center gap-1.5 text-xs text-ink-600">
                  状态评分
                  <select
                    value={value.rating}
                    onChange={(event) =>
                      setDraft((d) => ({ ...d, [studentId]: { ...value, rating: event.target.value } }))
                    }
                    className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
                  >
                    {[1, 2, 3, 4, 5].map((score) => (
                      <option key={score} value={score}>
                        {score}
                      </option>
                    ))}
                  </select>
                </label>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingId === studentId}
                  onClick={() => void save(studentId)}
                  className="ml-auto"
                >
                  {savingId === studentId ? "保存中…" : existing !== undefined ? "更新记录" : "保存记录"}
                </Button>
              </div>

              <input
                value={value.note}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, [studentId]: { ...value, note: event.target.value } }))
                }
                placeholder="本次课堂表现 / 需要跟进的地方"
                className="mt-2 w-full rounded-md border border-ink-200 px-2 py-1 text-xs outline-none focus:border-brand-500"
              />

              {existing !== undefined && (
                <p className="mt-1 text-[11px] text-ink-400">
                  上次保存：评分 {existing.rating} · {existing.note !== "" ? existing.note : "无备注"}
                </p>
              )}
            </li>
          );
        })}

        {lesson.studentIds.length === 0 && (
          <li className="text-xs text-ink-500">这节课还没有学生，先在排课里选学生。</li>
        )}
      </ul>
    </div>
  );
}

type LessonRecordDraft = {
  attendance: LessonRecord["attendance"];
  focus: LessonRecord["focus"];
  interaction: LessonRecord["interaction"];
  rating: string;
  note: string;
};

/** 一排互斥选项（出勤 / 专注 / 互动）。 */
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-600">
      {label}
      <span className="flex gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[11px] transition-colors",
              value === option
                ? "border-brand-200 bg-brand-50 text-brand-700"
                : "border-ink-200 text-ink-600 hover:bg-ink-50",
            )}
          >
            {option}
          </button>
        ))}
      </span>
    </span>
  );
}
