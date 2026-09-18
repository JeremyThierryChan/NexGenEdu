"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { NumberInput, Panel, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, type Classroom, type Lesson } from "@/lib/backend/api";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";

/**
 * 教室模块。
 *
 * 关注的是「场地够不够用」：每个教室的容量、今天排了几节、当前是否在用。
 * 冲突检测（同一教室 / 同一教师时间重叠）放在课程安排模块里做，
 * 这里只呈现占用情况，并把「今天该教室的课」列出来。
 */
export default function AdminClassroomsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [roomList, lessonList] = await Promise.all([
      api.classrooms.list(),
      api.lessons.list(),
    ]);
    setClassrooms(roomList);
    setLessons(lessonList);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 每个教室今天的课（按开始时间升序）。 */
  const todayByRoom = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    const todayKey = new Date().toDateString();
    for (const lesson of lessons) {
      if (new Date(lesson.startsAt).toDateString() !== todayKey) continue;
      map.set(lesson.classroomId, [...(map.get(lesson.classroomId) ?? []), lesson]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [lessons]);

  async function remove(room: Classroom) {
    const count = lessons.filter((lesson) => lesson.classroomId === room.id).length;
    const extra = count > 0 ? `\n该教室还有 ${count} 节课，删除后这些课会查不到教室。` : "";
    if (!window.confirm(`删除教室「${room.name}」？${extra}`)) return;
    await api.classrooms.remove(room.id);
    setOpenId((current) => (current === room.id ? null : current));
    await load();
  }

  return (
    <>
      <PageHeading title="教室" description="教室容量、今天的排课与占用时段。" />

      <DataNotice onReset={load} />

      {creating && (
        <Panel className="mt-6" title="新增教室">
          <ClassroomForm
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
          {loading ? "加载中…" : `${classrooms.length} 个场地`}
        </span>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? "收起表单" : "新增教室"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {classrooms.map((room) => {
          const todays = todayByRoom.get(room.id) ?? [];
          const totalMinutes = todays.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
          return (
            <section key={room.id} className="rounded-lg border border-ink-200 bg-white">
              <header className="flex items-start justify-between gap-2 border-b border-ink-100 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-ink-900">{room.name}</h2>
                  <p className="mt-0.5 text-xs text-ink-500">
                    容量 {room.capacity} 人
                    {room.note !== "" && ` · ${room.note}`}
                  </p>
                </div>
                <span className="shrink-0 rounded-sm bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                  今天 {todays.length} 节 · {Math.round((totalMinutes / 60) * 10) / 10} 小时
                </span>
              </header>

              <div className="px-4 py-3">
                {todays.length === 0 ? (
                  <p className="text-sm text-ink-500">今天空闲。</p>
                ) : (
                  <ul className="space-y-1.5">
                    {todays.map((lesson) => (
                      <li key={lesson.id} className="flex gap-3 text-xs">
                        <span className="w-24 shrink-0 font-mono tabular text-ink-900">
                          {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
                        </span>
                        <span className="min-w-0 truncate text-ink-600">
                          {lesson.subject}
                          <span className="ml-1.5 text-ink-400">{lesson.status}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <footer className="flex flex-wrap gap-3 border-t border-ink-100 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === room.id ? null : room.id)}
                  className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                >
                  {openId === room.id ? "收起全部排课" : "查看全部排课"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(editingId === room.id ? null : room.id)}
                  className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                >
                  {editingId === room.id ? "收起" : "编辑"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(room)}
                  className="text-xs text-ink-500 transition-colors hover:text-danger-600"
                >
                  删除
                </button>
              </footer>

              {editingId === room.id && (
                <div className="border-t border-ink-100">
                  <ClassroomForm
                    classroom={room}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      await load();
                    }}
                  />
                </div>
              )}
            </section>
          );
        })}

        {!loading && classrooms.length === 0 && (
          <p className="rounded-lg border border-ink-200 bg-white px-4 py-8 text-center text-sm text-ink-500 sm:col-span-2 lg:col-span-3">
            还没有登记教室。
          </p>
        )}
      </div>

      {openId !== null && (
        <RoomSchedule
          className="mt-6"
          classroomId={openId}
          classroomName={classrooms.find((item) => item.id === openId)?.name ?? ""}
        />
      )}
    </>
  );
}

/** 某个教室的全部排课。 */
function RoomSchedule({
  classroomId,
  classroomName,
  className,
}: {
  classroomId: string;
  classroomName: string;
  className?: string;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.lessons.listByClassroom(classroomId).then((list) => {
      if (!cancelled) setLessons(list);
    });
    return () => {
      cancelled = true;
    };
  }, [classroomId]);

  return (
    <Panel
      className={className}
      title={`${classroomName}的排课`}
      description={lessons === null ? "加载中…" : `共 ${lessons.length} 节。`}
    >
      {lessons !== null && lessons.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {lessons.map((lesson) => (
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
          {lessons === null ? "加载中…" : "这个场地还没有排课。"}
        </p>
      )}
    </Panel>
  );
}

/** 教室表单：新建与编辑共用。 */
function ClassroomForm({
  classroom,
  onCancel,
  onSaved,
}: {
  classroom?: Classroom;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = classroom !== undefined;
  const [name, setName] = useState(classroom?.name ?? "");
  const [capacity, setCapacity] = useState(`${classroom?.capacity ?? 8}`);
  const [note, setNote] = useState(classroom?.note ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("教室名称必填。");
      return;
    }

    setPending(true);
    setError("");

    const payload = {
      name: name.trim(),
      capacity: Math.max(1, Math.trunc(Number(capacity) || 1)),
      note: note.trim(),
    };

    if (editing) await api.classrooms.update(classroom.id, payload);
    else await api.classrooms.create(payload);

    setPending(false);
    await onSaved();
  }

  return (
    <form onSubmit={onSubmit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 301 教室"
          required
        />
        <NumberInput
          label="容量"
          suffix="人"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          min={1}
        />
        <TextField
          label="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如 白板 + 投影"
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
