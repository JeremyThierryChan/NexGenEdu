"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  api,
  type Classroom,
  type Lesson,
  type SeriesConflictMode,
  type SeriesPatch,
  type SeriesPreview,
  type SeriesScope,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
// 教室名的唯一显示口径（「校区·教室名」，v31）
import { classroomLabel } from "@/lib/backend/classrooms";
import { remainingTotal } from "@/lib/backend/enrollment";

/**
 * **「仅此一次 / 此后所有」那一步 + 确认框**（v34，机构原话：
 * 「**再添加一个可以取消/修改单次排课和取消/修改该学生后续所有排课，
 * 相当于就是 Apple 日历功能的全部复刻**」）。
 *
 * ## 它做两件事，顺序不能反
 *
 *   1. **问范围**：仅此一次 / 此后所有（Apple 日历那两个选项）；
 *   2. **二次确认**：把"这一下会影响什么"整份摊出来 —— 会动到哪几节（日期 + 学生数）、
 *      哪几节是「已上」被排除在外、哪几节会撞课。机构系统的既有纪律：
 *      **危险动作要先看得见**，"会影响什么"不许在点完之后才知道。
 *
 * ## 口径（一处也不在这里另写）
 *
 * 影响范围与冲突都由服务层算（`api.lessons.seriesPreview`），这个组件**只显示**
 * 服务端返回的那一份 —— 前端自己算一遍等于口径有了第二处实现。
 *
 * ## 老数据为什么只给「仅此一次」
 *
 * `seriesId === ""`（不属于任何循环串：老数据、一次性排课、单节补课）时不显示
 * 「此后所有」，并把原因写在旁边。**不猜串**：用"科目+老师+教室+学生+每周同一天"
 * 去反推一串，猜错一次就会把不相关的课一起改掉/取消掉
 * （理由见 `lib/backend/version.ts` 的 v34 那条）。那种情况走
 * 学生详情页的「这个学生此后的课」—— 意图明确、不需要猜。
 *
 * ## `onSingle`
 *
 * 「仅此一次」交给调用方走**原来那条单节路径**（`api.lessons.update`，
 * 带乐观锁 `expectedVersion`）—— 与以前一个字都不差；只有「此后所有」才走
 * `api.lessons.updateSeries` / `cancelSeries`。
 */
export function LessonSeriesScopeDialog({
  lesson,
  mode,
  action,
  patch,
  studentId,
  reason,
  students = [],
  teachers = [],
  classrooms = [],
  onClose,
  onSingle,
  onDone,
}: {
  lesson: Lesson;
  /**
   * `lesson`：在排课页点一节课（要问"仅此一次 / 此后所有"）；
   * `student`：在学生详情页的「这个学生此后的课」入口（范围已经是"这个学生"，
   * 因此不问范围，只确认会发生什么）。
   */
  mode: "lesson" | "student";
  action: "update" | "cancel";
  /** 仅 `action: "update"`：要改成的样子（给服务端预演冲突）。 */
  patch?: SeriesPatch;
  /** 仅"只取消某位学生"时给。 */
  studentId?: string;
  /** 取消原因（可空）。 */
  reason?: string;
  students?: Student[];
  teachers?: Teacher[];
  classrooms?: Classroom[];
  onClose: () => void;
  /** 「仅此一次」怎么落库（调用方的原路径）。 */
  onSingle: () => Promise<void>;
  /** 成功之后的收尾（刷新列表）。 */
  onDone: () => void | Promise<void>;
}) {
  const seriesAvailable = (lesson.seriesId ?? "") !== "";
  const [scope, setScope] = useState<SeriesScope>(
    mode === "student" ? "following" : "single",
  );
  const [preview, setPreview] = useState<SeriesPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /** 冲突怎么办：默认整体拒绝（`reject`），"跳过"必须由人**显式**选。 */
  const [onConflict, setOnConflict] = useState<SeriesConflictMode>("reject");

  const patchKey = JSON.stringify(patch ?? {});

  /*
   * 拉预览。范围 / 补丁 / 学生一变就重新算一次 —— 因此"选完之后看到的那份"
   * 就是"确认之后会发生的那一份"（两处共用服务端同一套判定）。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const value = await api.lessons.seriesPreview({
        lessonId: lesson.id,
        scope,
        action,
        ...(action === "update" ? { patch: patch ?? {} } : {}),
        ...(studentId !== undefined ? { studentId } : {}),
      });
      setPreview(value);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "算不出会影响什么，请刷新后重试。");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- patchKey 是 patch 的稳定写法
  }, [action, lesson.id, patchKey, scope, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const studentName = (id: string) =>
    students.find((item) => item.id === id)?.name ?? "（学生）";
  const teacherName = (id: string) =>
    teachers.find((item) => item.id === id)?.name ?? "（教师）";
  const classroomName = (id: string) => {
    const room = classrooms.find((item) => item.id === id);
    return room === undefined ? "（教室）" : classroomLabel(room);
  };

  async function confirm() {
    setPending(true);
    setError("");
    try {
      if (scope === "single") {
        // 仅此一次：走调用方原来那条路（乐观锁与日志口径都不变）
        await onSingle();
      } else if (action === "cancel") {
        await api.lessons.cancelSeries({
          lessonId: lesson.id,
          scope,
          ...(studentId !== undefined ? { studentId } : {}),
          ...(reason !== undefined && reason.trim() !== "" ? { reason } : {}),
        });
      } else {
        await api.lessons.updateSeries({
          lessonId: lesson.id,
          scope,
          patch: patch ?? {},
          onConflict,
        });
      }
      await onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "没有改成功，请刷新后重试。");
      setPending(false);
      // 失败之后重新算一次：库里的状况可能已经与刚才不同了
      void load();
    }
  }

  const conflicts = preview?.conflicts ?? [];
  const willWrite = preview?.affected.length ?? 0;
  const completed = preview?.completed ?? [];

  return (
    <div
      className="mt-4 rounded-lg border border-warning-100 bg-warning-50/60 px-4 py-4"
      role="dialog"
      aria-label={action === "cancel" ? "确认取消排课" : "确认修改排课"}
    >
      <h3 className="text-sm font-medium text-ink-900">
        {action === "cancel" ? "取消排课" : "修改排课"}
        <span className="ml-2 text-xs font-normal text-ink-500">
          {lesson.subject}
          {lesson.form !== "" ? ` · ${lesson.form}` : ""}
        </span>
      </h3>

      {/* 第 1 步：范围（Apple 日历那两个选项） */}
      {mode === "lesson" ? (
        <div className="mt-3">
          <p className="text-xs text-ink-600">这一次要改的是：</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setScope("single")}
              className={optionClass(scope === "single")}
            >
              仅此一次
            </button>
            {/* 老数据（不属于循环串）**不给**「此后所有」，并说明原因 */}
            {seriesAvailable ? (
              <button
                type="button"
                onClick={() => setScope("following")}
                className={optionClass(scope === "following")}
              >
                此后所有
              </button>
            ) : (
              <span className="rounded-md border border-dashed border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-500">
                这节课不属于循环串（老数据），只能选「仅此一次」
              </span>
            )}
          </div>
          {seriesAvailable && (
            <p className="mt-1.5 text-xs text-ink-500">
              「此后所有」＝ 这个学生在这门课/这个班型上、从这一节起的课（已经上过的一节都不动）。
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-600">
          范围：这个学生<b>此后</b>的课（同一科目 + 同一班型，从第一节还没上的课起）。
        </p>
      )}

      {/* 第 2 步：会发生什么 */}
      <div className="mt-3 rounded-md border border-ink-200 bg-white px-3 py-2.5">
        {loading ? (
          <p className="text-xs text-ink-400">正在算会影响哪些课…</p>
        ) : preview === null ? (
          <p className="text-xs text-ink-400">算不出影响范围（见下面的原因）。</p>
        ) : (
          <>
            <p className="text-sm text-ink-800">
              将影响 <strong className="font-medium">{willWrite}</strong> 节
              {action === "cancel" ? "（取消）" : "（修改）"}
              {preview.studentIds.length > 0 && (
                <span className="ml-2 text-xs text-ink-500">
                  涉及 {preview.studentIds.map(studentName).join("、")}
                </span>
              )}
            </p>
            {preview.teacherIds.length > 0 && (
              <p className="mt-0.5 text-xs text-ink-500">
                教师：{preview.teacherIds.map(teacherName).join("、")} · 教室：
                {preview.classroomIds.map(classroomName).join("、")}
              </p>
            )}
            {willWrite > 0 ? (
              <ul className="mt-1.5 max-h-44 space-y-0.5 overflow-y-auto text-xs text-ink-600">
                {preview.affected.map((item) => (
                  <li key={item.id} className="flex gap-2">
                    <span className="w-40 shrink-0">{item.dayLabel}</span>
                    <span>
                      {item.studentIds.length} 位学生
                      {item.studentIds.length > 0 && (
                        <span className="text-ink-400">
                          （{item.studentIds.map(studentName).join("、")}）
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-ink-500">范围内没有可动的课（都是已上或已取消的）。</p>
            )}

            {/* 「已上」的课：**明确报出来**，不是悄悄跳过（过去的课是账） */}
            {completed.length > 0 && (
              <p className="mt-2 rounded-sm border border-dashed border-ink-200 bg-ink-50 px-2 py-1.5 text-xs text-ink-500">
                其中 {completed.length} 节<strong className="font-medium">已经上过</strong>，不会被改动（过去的课是账）：
                {completed
                  .slice(0, 3)
                  .map((item) => item.dayLabel)
                  .join("、")}
                {completed.length > 3 ? "…" : ""}
              </p>
            )}
            {preview.excluded.length > 0 && (
              <p className="mt-1 text-xs text-ink-400">
                另有 {preview.excluded.length} 节已经取消过，不再处理。
              </p>
            )}
          </>
        )}
      </div>

      {/* 冲突：默认整体拒绝；"跳过"必须显式选 */}
      {conflicts.length > 0 && (
        <div className="mt-3 rounded-md border border-warning-200 bg-white px-3 py-2.5">
          <p className="text-sm font-medium text-warning-600">
            有 {conflicts.length} 节会撞课
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-warning-600">
            {conflicts.slice(0, 5).map((item) => (
              <li key={item.id}>
                {item.dayLabel}：{item.reason}
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-1 text-xs text-ink-700">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name={`series-conflict-${lesson.id}`}
                checked={onConflict === "reject"}
                onChange={() => setOnConflict("reject")}
              />
              <span>
                有冲突就<strong className="font-medium">整体不动</strong>（默认）—— 一节都不写，回去先改时间/换老师/换教室。
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name={`series-conflict-${lesson.id}`}
                checked={onConflict === "skip"}
                onChange={() => setOnConflict("skip")}
              />
              <span>跳过有冲突的那几节，其余的照做（只会动没冲突的那些）。</span>
            </label>
          </div>
        </div>
      )}

      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          /*
           * 预览拿不到时**仍然允许"仅此一次"**：那一条走的是调用方原来那条单节路径
           * （不依赖这个新接口）。这样一来，即使后端还没重启到这一版（三个新方法还是 404），
           * 机构也照样能改/取消一节课 —— 只是"此后所有"要等后端更新。
           * "此后所有"则必须等预览成功：范围与冲突都还没看清就不能动手。
           */
          disabled={pending || loading || (preview === null && scope !== "single") || (preview !== null && willWrite === 0)}
          onClick={() => void confirm()}
        >
          {pending
            ? "处理中…"
            : `确认${action === "cancel" ? "取消" : "修改"}${willWrite > 0 ? ` ${willWrite} 节` : ""}`}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>
          返回
        </Button>
        <span className="text-xs text-ink-400">
          剩余课时{lesson.studentIds.length === 1 ? "：" : "（第一位学生）："}
          {(() => {
            const first = students.find((item) => item.id === lesson.studentIds[0]);
            return first === undefined ? "—" : remainingTotal(first.enrollments);
          })()}
          （取消的课不占课时）
        </span>
      </div>
    </div>
  );
}

function optionClass(active: boolean): string {
  return [
    "rounded-md border px-2.5 py-1 text-sm transition-colors",
    active
      ? "border-brand-400 bg-white font-medium text-brand-700"
      : "border-ink-300 bg-white text-ink-600 hover:border-brand-300",
  ].join(" ");
}
