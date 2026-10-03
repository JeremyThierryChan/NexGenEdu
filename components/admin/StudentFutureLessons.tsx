"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { NumberInput, SelectInput, TextField } from "@/components/admin/AdminFields";
import { LessonSeriesScopeDialog } from "@/components/admin/LessonSeriesScopeDialog";
import {
  api,
  type Classroom,
  type Lesson,
  type SeriesPatch,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import { formatTimeRange } from "@/lib/backend/format";
import { classroomLabel } from "@/lib/backend/classrooms";

/**
 * **「这个学生此后的课」**（v34）—— 机构最常用的那个场景：**学生不来了**。
 *
 * 机构原话：「**再添加一个可以取消/修改单次排课和取消/修改该学生后续所有排课，
 * 相当于就是 Apple 日历功能的全部复刻**」。排课页那两个选项是从"一节课"出发的；
 * 这一块是从"一个学生"出发的 —— 说的其实是同一件事，但入口不同：
 * 前台接待真正会说的是"**XX 不来上了，后面的课都取消掉**"。
 *
 * ## 为什么这一块在老数据上也能用
 *
 * 老课没有串身份（迁移不猜串，见 `VERSION_NOTES` 的 v34），因此排课页那些课上
 * **不给**「此后所有」。但"这个学生此后的课"是机构自己指着某个学生说的，
 * **意图明确**、不需要反推一串 —— 所以它按业务口径圈范围
 * （同一学生 + 同一科目 + 同一班型、从这一节起、只动「已排（还没上）」的），
 * 走服务层同一套方法（`api.lessons.seriesPreview` / `cancelSeries` / `updateSeries`）。
 *
 * ## 两条与机构约定一致的口径（这里只显示，不另算）
 *
 *   - **取消**一位学生：小组课里只把 TA 从名单里移出；去掉最后一个才整节取消；
 *   - **修改**：改的是**整节**（一节小组课的时间是共享的，不能只给一个学生改），
 *     因此这一块改一串时会**连带同班的其他人** —— 界面上明说。
 *   - **过去的课是账**：已经上过的一节都不动（确认框里会明确列出来）。
 */
export function StudentFutureLessons({
  student,
  onChanged,
}: {
  student: Student;
  onChanged: () => void | Promise<void>;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [open, setOpen] = useState(false);
  /** 正在处理的那一组（锚点＝这一组里最早的一节还没上的课）。 */
  const [target, setTarget] = useState<{
    lesson: Lesson;
    action: "cancel" | "update";
    label: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  // 「改」那一组要填的东西（留空＝不改这一项）
  const [editTeacher, setEditTeacher] = useState("");
  const [editClassroom, setEditClassroom] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editNote, setEditNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [lessonList, teacherList, classroomList] = await Promise.all([
      api.lessons.listByStudent(student.id),
      api.teachers.listActive(),
      api.classrooms.list(),
    ]);
    setLessons(lessonList);
    setTeachers(teacherList);
    setClassrooms(classroomList);
  }, [student.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 按「科目 + 班型」分组 —— 这正是服务层圈"此后所有"的口径
   * （同一学生 + 同一科目 + 同一班型），因此界面上的分组与真正会动的范围**对得上**。
   * 只列**还没上**（状态「已排」）的：已上的课不在这件事的范围里。
   */
  const groups = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of lessons ?? []) {
      if (lesson.status !== "已排") continue;
      const key = `${lesson.subject}\u0000${lesson.form}`;
      map.set(key, [...(map.get(key) ?? []), lesson]);
    }
    return [...map.values()]
      .map((items) =>
        items.slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      )
      .sort((a, b) => (a[0]?.startsAt ?? "").localeCompare(b[0]?.startsAt ?? ""));
  }, [lessons]);

  const teacherName = (id: string) =>
    teachers.find((item) => item.id === id)?.name ?? "（教师）";
  const classroomName = (id: string) => {
    const room = classrooms.find((item) => item.id === id);
    return room === undefined ? "（教室）" : classroomLabel(room);
  };

  /** 把"改"那一组填的东西收成一个补丁（没填的项不发）。 */
  function buildPatch(anchor: Lesson): SeriesPatch | null {
    const patch: SeriesPatch = {};
    if (editTime.trim() !== "") {
      const at = new Date(editTime);
      if (Number.isNaN(at.getTime())) {
        setError("新的开始时间格式不对（例如 2026-10-08T17:00）。");
        return null;
      }
      patch.startsAt = at.toISOString();
    }
    if (editTeacher !== "") patch.teacherId = editTeacher;
    if (editClassroom !== "") patch.classroomId = editClassroom;
    if (editDuration.trim() !== "") {
      const minutes = Math.trunc(Number(editDuration));
      if (!Number.isFinite(minutes) || minutes < 15) {
        setError("时长至少 15 分钟。");
        return null;
      }
      patch.durationMinutes = minutes;
    }
    if (editNote.trim() !== "") patch.note = editNote.trim();
    if (Object.keys(patch).length === 0) {
      setError("请至少填一项要改的内容（时间 / 教师 / 教室 / 时长 / 备注）。");
      return null;
    }
    setError("");
    void anchor;
    return patch;
  }

  const busy = lessons === null;

  return (
    <section className="mt-5 rounded-md border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2.5">
        <div>
          <h3 className="text-sm font-medium text-ink-900">这个学生此后的课</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            学生不来了：这里可以一次取消 TA 在这一门课上的后续排课（换老师 / 改时间同理）。
            已经上过的课一节都不动。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen((value) => !value);
            setTarget(null);
            setError("");
          }}
        >
          {open ? "收起" : "展开"}
        </Button>
      </header>

      {open && (
        <div className="px-3 py-3">
          {busy ? (
            <p className="text-sm text-ink-400">加载中…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-ink-500">这个学生目前没有「还没上」的课。</p>
          ) : (
            <>
              <ul className="divide-y divide-ink-100 rounded-md border border-ink-100">
                {groups.map((items) => {
                  const first = items[0];
                  if (first === undefined) return null;
                  const label = `${first.subject}${first.form !== "" ? ` · ${first.form}` : ""}`;
                  return (
                    <li key={label} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <span className="text-sm text-ink-800">{label}</span>
                      <span className="text-xs text-ink-500">
                        {items.length} 节 · 第一节 {formatTimeRange(first.startsAt, first.durationMinutes)} · {teacherName(first.teacherId)} / {classroomName(first.classroomId)}
                      </span>
                      <span className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTarget({ lesson: first, action: "cancel", label });
                            setError("");
                          }}
                          className="text-xs text-ink-500 transition-colors hover:text-warning-600"
                        >
                          取消这一门此后的课
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTarget({ lesson: first, action: "update", label });
                            setError("");
                          }}
                          className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                        >
                          改这一门此后的课
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>

              {target !== null && (
                <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/60 px-3 py-3">
                  <p className="text-sm text-ink-800">
                    {target.action === "cancel" ? "取消" : "修改"}「{target.label}」此后的课
                    <span className="ml-2 text-xs text-ink-500">
                      从 {formatTimeRange(target.lesson.startsAt, target.lesson.durationMinutes)} 这一节起
                    </span>
                  </p>

                  {target.action === "cancel" ? (
                    <div className="mt-2 max-w-md">
                      <TextField
                        label="取消原因（可不填）"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="例如 学生转学 / 家长说暂停"
                      />
                      <p className="mt-1 text-xs text-ink-500">
                        小组课里<strong className="font-medium">只有这个学生</strong>被移出名单；如果这节课没有别的学生了，才整节取消。
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <TextField
                          label="新的开始时间"
                          type="datetime-local"
                          value={editTime}
                          onChange={(event) => setEditTime(event.target.value)}
                          hint="留空＝时间不动；填了则整串按差量平移"
                        />
                        <SelectInput
                          label="教师"
                          value={editTeacher}
                          onChange={(event) => setEditTeacher(event.target.value)}
                          options={[
                            { value: "", label: "不改" },
                            ...teachers.map((item) => ({ value: item.id, label: item.name })),
                          ]}
                        />
                        <SelectInput
                          label="教室"
                          value={editClassroom}
                          onChange={(event) => setEditClassroom(event.target.value)}
                          options={[
                            { value: "", label: "不改" },
                            ...classrooms.map((item) => ({
                              value: item.id,
                              label: classroomLabel(item),
                            })),
                          ]}
                        />
                        <NumberInput
                          label="时长"
                          suffix="分钟"
                          value={editDuration}
                          onChange={(event) => setEditDuration(event.target.value)}
                          step={15}
                          min={15}
                        />
                      </div>
                      <div className="mt-3">
                        <TextField
                          label="备注（可不填）"
                          value={editNote}
                          onChange={(event) => setEditNote(event.target.value)}
                          placeholder="例如 换成线上课"
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        修改的是<strong className="font-medium">整节</strong>课 —— 小组课的时间是共享的，
                        因此会连带同班的其他人一起改。
                      </p>
                    </>
                  )}

                  {error !== "" && (
                    <p role="alert" className="mt-2 text-xs text-danger-600">
                      {error}
                    </p>
                  )}

                  {/*
                    选完范围之后仍然是同一套确认框（列出将影响的每一节、已上的被排除、
                    冲突怎么办）—— 与学生入口共用一个组件，口径只有一处。
                  */}
                  {target.action === "cancel" ? (
                    <LessonSeriesScopeDialog
                      lesson={target.lesson}
                      mode="student"
                      action="cancel"
                      studentId={student.id}
                      reason={reason}
                      students={[student]}
                      teachers={teachers}
                      classrooms={classrooms}
                      onClose={() => setTarget(null)}
                      onSingle={async () => {
                        // `mode: "student"` 下范围固定是"此后所有"，单节这条路用不到；
                        // 留着它只是为了满足同一个组件的接口（不会被调用）。
                      }}
                      onDone={async () => {
                        setTarget(null);
                        await load();
                        await onChanged();
                      }}
                    />
                  ) : (
                    <StudentFutureUpdateFlow
                      anchor={target.lesson}
                      buildPatch={() => buildPatch(target.lesson)}
                      students={[student]}
                      teachers={teachers}
                      classrooms={classrooms}
                      onCancel={() => setTarget(null)}
                      onDone={async () => {
                        setTarget(null);
                        setEditTeacher("");
                        setEditClassroom("");
                        setEditTime("");
                        setEditDuration("");
                        setEditNote("");
                        await load();
                        await onChanged();
                      }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * 「改这一门此后的课」：先把表单收成补丁，再交给同一个确认框。
 *
 * 单独一小层是为了让确认框**只在补丁有效时才挂上去** —— 补丁无效（时间格式错、
 * 一项都没填）时不要渲染一个"将影响 0 节"的框把人引向歧途。
 */
function StudentFutureUpdateFlow({
  anchor,
  buildPatch,
  students,
  teachers,
  classrooms,
  onCancel,
  onDone,
}: {
  anchor: Lesson;
  buildPatch: () => SeriesPatch | null;
  students: Student[];
  teachers: Teacher[];
  classrooms: Classroom[];
  onCancel: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [patch, setPatch] = useState<SeriesPatch | null>(null);
  const [error, setError] = useState("");

  if (patch === null) {
    return (
      <div className="mt-2">
        {error !== "" && (
          <p role="alert" className="mb-2 text-xs text-danger-600">
            {error}
          </p>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const value = buildPatch();
            if (value === null) {
              setError("先填至少一项要改的内容，再点这里。");
              return;
            }
            setError("");
            setPatch(value);
          }}
        >
          下一步：看看会影响哪些课
        </Button>
      </div>
    );
  }

  return (
    <LessonSeriesScopeDialog
      lesson={anchor}
      mode="student"
      action="update"
      patch={patch}
      students={students}
      teachers={teachers}
      classrooms={classrooms}
      onClose={() => {
        setPatch(null);
        onCancel();
      }}
      onSingle={async () => {
        // 同上面那条：`mode: "student"` 的范围固定是"此后所有"
      }}
      onDone={async () => {
        setPatch(null);
        await onDone();
      }}
    />
  );
}
