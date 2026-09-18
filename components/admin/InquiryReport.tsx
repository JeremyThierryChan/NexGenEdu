"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  api,
  type Classroom,
  type FeasibilityReport,
  type Inquiry,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

/**
 * 可行性报告。
 *
 * 每个候选时段一行：能不能排下**整串课**；不能的话说清「挡路的是谁」，
 * 并给出按「改动最小」排序的替代方案。
 *
 * 两条界面原则：
 *   1. **挡住已有课的时候，先显示受影响的已有学生**，再让人决定动不动它 ——
 *      移动别人的课是有代价的（那位学生的时间可能更难调）；
 *   2. **两个方向都摆在眼前**：要么新学生换时段（采用替代方案），
 *      要么已有课挪走（列出可挪的时间）。由人选择，系统不替他决定。
 */
export function InquiryReport({
  inquiry,
  onChanged,
}: {
  inquiry: Inquiry;
  onChanged: () => void | Promise<void>;
}) {
  const [report, setReport] = useState<FeasibilityReport | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [result, teacherList, classroomList, studentList] = await Promise.all([
      api.inquiries.evaluate(inquiry.id),
      api.teachers.list(),
      api.classrooms.list(),
      api.students.list(),
    ]);
    setReport(result);
    setTeachers(teacherList);
    setClassrooms(classroomList);
    setStudents(studentList);
  }, [inquiry.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const teacherName = (id: string) => teachers.find((item) => item.id === id)?.name ?? "—";
  const roomName = (id: string) => classrooms.find((item) => item.id === id)?.name ?? "—";
  const studentNames = (ids: string[]) =>
    ids.map((id) => students.find((item) => item.id === id)?.name ?? id).join("、");

  async function accept(slotId: string, teacherId: string, classroomId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    const result = await api.inquiries.accept(inquiry.id, {
      slotId,
      teacherId,
      classroomId,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`已按这个方案建出 ${result.lessonIds.length} 节课，线索标记为「已安排」。`);
    await load();
    await onChanged();
  }

  if (report === null) {
    return <p className="px-4 py-4 text-sm text-ink-400">正在判定…</p>;
  }

  return (
    <div className="px-4 py-4">
      <p className="text-xs text-ink-500">
        {inquiry.subject} · 每次 {inquiry.durationMinutes} 分钟 ·{" "}
        {inquiry.intervalWeeks === 1 ? "每周一次" : "每两周一次"} · 共{" "}
        {inquiry.plannedLessons} 节
        {inquiry.skipDates.length > 0 && ` · 跳过 ${inquiry.skipDates.length} 天`}
      </p>

      {message !== "" && (
        <p className="mt-3 rounded-md border border-success-100 bg-success-50 px-3 py-2 text-sm text-success-600">
          {message}
        </p>
      )}
      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {report.slots.map((slot, index) => {
          const source = inquiry.candidates.find((item) => item.id === slot.slotId);
          return (
            <li
              key={slot.slotId}
              className={cn(
                "rounded-lg border px-3.5 py-3",
                slot.ok ? "border-success-100 bg-success-50/40" : "border-warning-200 bg-warning-50/40",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-xs text-ink-400">第 {index + 1} 选</span>
                <span className="text-sm font-medium text-ink-900">
                  {slot.label}
                  {source !== undefined && inquiry.durationMinutes > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-ink-500">
                      （{inquiry.durationMinutes} 分钟）
                    </span>
                  )}
                </span>
                {slot.ok ? (
                  <span className="rounded-sm border border-success-100 bg-success-50 px-1.5 py-0.5 text-[11px] text-success-600">
                    可以排
                  </span>
                ) : (
                  <span className="rounded-sm border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                    排不下
                  </span>
                )}

                {slot.ok && slot.assignment !== null && (
                  <>
                    <span className="text-xs text-ink-600">
                      {teacherName(slot.assignment.teacherId)} · {roomName(slot.assignment.classroomId)}
                    </span>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void accept(slot.slotId, slot.assignment!.teacherId, slot.assignment!.classroomId)
                      }
                    >
                      采用这个方案
                    </Button>
                  </>
                )}
              </div>

              <p className="mt-1.5 text-xs text-ink-500">
                排在这些日子：{slot.dates.map((date) => formatDayLabel(new Date(`${date}T00:00:00`))).join("、")}
                {inquiry.plannedLessons > slot.dates.length && ` …共 ${inquiry.plannedLessons} 节`}
              </p>

              {/* 挡路的是谁：先看受影响的学生，再决定动不动它 */}
              {!slot.ok &&
                slot.blockers.map((blocker, blockerIndex) => (
                  <div
                    key={`${blocker.kind}-${blockerIndex}`}
                    className="mt-2 rounded-md border border-warning-200 bg-white px-3 py-2"
                  >
                    <p className="text-sm text-warning-600">
                      {blocker.kind}：{blocker.detail}
                    </p>
                    {blocker.lessonId !== "" && (
                      <BlockingLesson
                        lessonId={blocker.lessonId}
                        teacherName={teacherName(blocker.teacherId)}
                        roomName={roomName(blocker.classroomId)}
                        studentNames={studentNames(blocker.studentIds)}
                        busy={busy}
                        onMoved={async (change) => {
                          setMessage(`已把挡路的课${change}，正在重新判定…`);
                          await load();
                        }}
                      />
                    )}
                  </div>
                ))}

              {/* 最接近的方案 */}
              {!slot.ok && slot.alternatives.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-ink-600">最接近的方案（按改动最小排序）</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {slot.alternatives.map((alternative) => (
                      <li
                        key={`${alternative.slot.weekday}-${alternative.slot.start}-${alternative.assignment.teacherId}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600"
                      >
                        <span>{alternative.change}</span>
                        <span className="text-ink-500">
                          {teacherName(alternative.assignment.teacherId)} ·{" "}
                          {roomName(alternative.assignment.classroomId)}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            /*
                             * 采用替代方案前，先把它的时段加到候选里 ——
                             * accept 是按 slotId 找时段的，而替代方案的时段
                             * 原本不在候选列表里。这样也顺带把「最后实际用了
                             * 哪个时段」留在了线索记录里。
                             */
                            void (async () => {
                              const slotId = `alt_${alternative.slot.weekday}_${alternative.slot.start}`;
                              const exists = inquiry.candidates.some((item) => item.id === slotId);
                              if (!exists) {
                                await api.inquiries.update(inquiry.id, {
                                  candidates: [
                                    ...inquiry.candidates,
                                    { id: slotId, weekday: alternative.slot.weekday, start: alternative.slot.start },
                                  ],
                                });
                              }
                              await accept(
                                slotId,
                                alternative.assignment.teacherId,
                                alternative.assignment.classroomId,
                              );
                            })();
                          }}
                          className="text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-60"
                        >
                          采用这个方案 →
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!slot.ok && slot.alternatives.length === 0 && (
                <p className="mt-2 text-xs text-ink-500">
                  这个时段附近没有可用的替代方案 —— 可能需要调整频率或先安排老师/场地。
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 挡路的那节课：显示它是什么、谁在上，并提供「挪走」的候选时间。
 *
 * 这是「协调已有学生」的那一半 —— 另一条路是让新学生换时段（采用替代方案）。
 * 系统只把两条路的代价摆出来，决定权在人。
 */
function BlockingLesson({
  lessonId,
  teacherName,
  roomName,
  studentNames,
  busy,
  onMoved,
}: {
  lessonId: string;
  teacherName: string;
  roomName: string;
  studentNames: string;
  busy: boolean;
  onMoved: (change: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [moves, setMoves] = useState<Array<{ startsAt: string; change: string }> | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api.lessons.suggestMoves(lessonId).then((result) => {
      if (!cancelled) setMoves(result);
    });
    return () => {
      cancelled = true;
    };
  }, [lessonId, open]);

  async function applyMove(startsAt: string, change: string) {
    setMoving(true);
    await api.lessons.update(lessonId, { startsAt });
    setMoving(false);
    await onMoved(change);
  }

  return (
    <div className="mt-1.5">
      <p className="text-xs text-ink-500">
        挡路的课：{teacherName} · {roomName}
        {studentNames !== "" && ` · 学生：${studentNames}`}
      </p>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-1 text-xs text-brand-700 transition-colors hover:text-brand-800"
      >
        {open ? "收起" : "协调已有学生：把这节课挪走 →"}
      </button>

      {open && (
        <div className="mt-1.5 rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
          {moves === null ? (
            <p className="text-xs text-ink-400">正在找可挪的时间…</p>
          ) : moves.length === 0 ? (
            <p className="text-xs text-ink-500">这节课附近没有可挪的时间。</p>
          ) : (
            <ul className="space-y-1">
              {moves.map((move) => (
                <li key={move.startsAt} className="flex flex-wrap items-center gap-x-3 text-xs">
                  <span className="text-ink-600">{move.change}</span>
                  <span className="text-ink-400">
                    {formatDayLabel(move.startsAt)} {formatTimeRange(move.startsAt, 60)}
                  </span>
                  <button
                    type="button"
                    disabled={moving || busy}
                    onClick={() => void applyMove(move.startsAt, `挪到 ${move.change}`)}
                    className="text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-60"
                  >
                    挪到这里（不影响新学生）
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[11px] text-ink-400">
            移动会改变这位已有学生的上课时间；挪完这里会自动重新判定。
          </p>
        </div>
      )}
    </div>
  );
}
