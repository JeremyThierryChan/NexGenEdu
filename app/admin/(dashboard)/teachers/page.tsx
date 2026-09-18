"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { Panel, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, type Lesson, type Teacher } from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";

/**
 * 教师模块。
 *
 * 与宣传网站的教师页分工不同：那里是给家长看的介绍，这里是排课用的档案
 * （可带科目、联系方式、在职状态、当前排课量）。
 *
 * 「在职」开关很重要：离职教师保留档案但不出现在排课下拉里，
 * 因此列表里可以直接切换，不必删除历史记录。
 */
export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [teacherList, lessonList] = await Promise.all([
      api.teachers.list(),
      api.lessons.list(),
    ]);
    setTeachers(teacherList);
    setLessons(lessonList);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 每位教师的排课量（今日 / 全部）。 */
  const load_ = useMemo(() => {
    const todayKey = new Date().toDateString();
    const counts = new Map<string, { today: number; total: number }>();
    for (const lesson of lessons) {
      const current = counts.get(lesson.teacherId) ?? { today: 0, total: 0 };
      current.total += 1;
      if (new Date(lesson.startsAt).toDateString() === todayKey) current.today += 1;
      counts.set(lesson.teacherId, current);
    }
    return counts;
  }, [lessons]);

  async function toggleActive(teacher: Teacher) {
    await api.teachers.update(teacher.id, { active: !teacher.active });
    await load();
  }

  async function remove(teacher: Teacher) {
    const count = load_.get(teacher.id)?.total ?? 0;
    const extra = count > 0 ? `\nTA 还有 ${count} 节课记录，删除后这些课会查不到老师。` : "";
    if (!window.confirm(`删除教师「${teacher.name}」？${extra}\n如果只是不带课了，建议把「在职」关掉而不是删除。`)) return;
    await api.teachers.remove(teacher.id);
    setOpenId((current) => (current === teacher.id ? null : current));
    await load();
  }

  return (
    <>
      <PageHeading
        title="教师"
        description="教师档案、可带科目、在职状态与排课量。"
      />

      <DataNotice onReset={load} />

      {creating && (
        <Panel className="mt-6" title="新增教师" description="科目请与课程名用同一套叫法，便于排课与前台一致。">
          <TeacherForm
            onCancel={() => setCreating(false)}
            onSaved={async () => {
              setCreating(false);
              await load();
            }}
          />
        </Panel>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-xs text-ink-500">
          {loading
            ? "加载中…"
            : `${teachers.length} 位教师（在职 ${teachers.filter((t) => t.active).length} 位）`}
        </span>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? "收起表单" : "新增教师"}
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-2.5 font-medium">姓名</th>
              <th className="px-4 py-2.5 font-medium">职务</th>
              <th className="px-4 py-2.5 font-medium">可带科目</th>
              <th className="px-4 py-2.5 font-medium">今日 / 全部课次</th>
              <th className="px-4 py-2.5 font-medium">在职</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((teacher) => (
              <tr key={teacher.id} className="border-b border-ink-50 last:border-0">
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === teacher.id ? null : teacher.id)}
                    className="text-left font-medium text-ink-900 transition-colors hover:text-brand-700"
                  >
                    {teacher.name}
                    <span className="ml-1.5 text-xs text-ink-400">
                      {openId === teacher.id ? "▲" : "▼"}
                    </span>
                  </button>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{teacher.role !== "" ? teacher.role : "—"}</td>
                <td className="px-4 py-2.5 text-ink-600">{teacher.subjects.join("、") || "—"}</td>
                <td className="px-4 py-2.5 tabular text-ink-700">
                  {load_.get(teacher.id)?.today ?? 0} / {load_.get(teacher.id)?.total ?? 0}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => void toggleActive(teacher)}
                    className={
                      teacher.active
                        ? "rounded-sm border border-success-100 bg-success-50 px-1.5 py-0.5 text-[11px] text-success-600"
                        : "rounded-sm border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500"
                    }
                  >
                    {teacher.active ? "在职" : "离职"}
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === teacher.id ? null : teacher.id)}
                      className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                    >
                      {editingId === teacher.id ? "收起" : "编辑"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(teacher)}
                      className="text-xs text-ink-500 transition-colors hover:text-danger-600"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && teachers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                  还没有教师档案。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <Panel className="mt-4" title="编辑教师">
          <TeacherForm
            teacher={teachers.find((item) => item.id === editingId) ?? undefined}
            onCancel={() => setEditingId(null)}
            onSaved={async () => {
              setEditingId(null);
              await load();
            }}
          />
        </Panel>
      )}

      {openId !== null && (
        <TeacherLessons
          className="mt-6"
          teacherId={openId}
          teacherName={teachers.find((item) => item.id === openId)?.name ?? ""}
        />
      )}
    </>
  );
}

/** 教师排课清单（按时间升序）。 */
function TeacherLessons({
  teacherId,
  teacherName,
  className,
}: {
  teacherId: string;
  teacherName: string;
  className?: string;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.lessons.listByTeacher(teacherId).then((list) => {
      if (!cancelled) setLessons(list);
    });
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  const upcoming = (lessons ?? []).filter(
    (lesson) => new Date(lesson.startsAt).getTime() >= Date.now() && lesson.status !== "已取消",
  );

  return (
    <Panel
      className={className}
      title={`${teacherName}的课`}
      description={lessons === null ? "加载中…" : `共 ${lessons.length} 节，其中 ${upcoming.length} 节待上。`}
    >
      {lessons !== null && lessons.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {lessons.slice(0, 10).map((lesson) => (
            <li key={lesson.id} className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-2">
              <span className="w-40 text-xs text-ink-900">
                {formatDayLabel(lesson.startsAt)} {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
              </span>
              <span className="text-sm text-ink-800">{lesson.subject}</span>
              <span className="text-xs text-ink-500">{lesson.form}</span>
              <span className="ml-auto text-xs text-ink-400">{lesson.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-ink-500">
          {lessons === null ? "加载中…" : "还没有给这位教师排课。"}
        </p>
      )}
    </Panel>
  );
}

/** 教师表单：新建与编辑共用。 */
function TeacherForm({
  teacher,
  onCancel,
  onSaved,
}: {
  teacher?: Teacher;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = teacher !== undefined;
  const [name, setName] = useState(teacher?.name ?? "");
  const [role, setRole] = useState(teacher?.role ?? "");
  const [subjects, setSubjects] = useState((teacher?.subjects ?? []).join("、"));
  const [phone, setPhone] = useState(teacher?.phone ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("姓名必填。");
      return;
    }

    setPending(true);
    setError("");

    const payload = {
      name: name.trim(),
      role: role.trim(),
      subjects: subjects
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter((item) => item !== ""),
      phone: phone.trim(),
      active: teacher?.active ?? true,
    };

    if (editing) await api.teachers.update(teacher.id, payload);
    else await api.teachers.create(payload);

    setPending(false);
    await onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="姓名"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 陈老师"
          required
        />
        <TextField
          label="职务"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="例如 全科教师"
        />
        <TextField
          label="可带科目"
          hint="顿号或逗号分隔"
          value={subjects}
          onChange={(event) => setSubjects(event.target.value)}
          placeholder="数学、物理"
        />
        <TextField
          label="联系方式"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
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
          {pending ? "保存中…" : editing ? "保存修改" : "新增"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
