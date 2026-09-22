"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { NumberInput, Panel, TextField } from "@/components/admin/AdminFields";
import { BulkImport } from "@/components/admin/BulkImport";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import {
  api,
  CLASSROOM_KINDS,
  type Classroom,
  type ClassroomAvailability,
  type ClassroomKind,
  type Lesson,
} from "@/lib/backend/api";
import {
  WEEKDAY_LABELS,
  describeAvailability,
  describeWeekdays,
  toMinutes,
} from "@/lib/backend/availability";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

/**
 * 教室模块。
 *
 * 每个场地有三层信息：
 *   1. **用途**：上课用教室 / 自习室 —— 前者按班型排课，后者是学生自习的座位；
 *   2. **容量**：可容纳人数（自习室即座位数）；
 *   3. **可用时段**：一周中哪几天、哪个时间段开放；**留空表示不限**。
 *
 * 可用时段不只是展示：排课时会检查「这节课是否落在教室开放时间内」，
 * 落在开放时间之外会在保存前提示（见 components/admin/LessonForm.tsx）。
 */
export default function AdminClassroomsPage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // 批量导入面板（与「新增」表单互斥，避免同屏两个大面板）
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"全部" | ClassroomKind>("全部");

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

  const visible = useMemo(
    () =>
      kindFilter === "全部" ? classrooms : classrooms.filter((room) => room.kind === kindFilter),
    [classrooms, kindFilter],
  );

  /** 每个场地今天的课（按开始时间升序）。 */
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
    const extra = count > 0 ? `\n该场地还有 ${count} 节课，删除后这些课会查不到场地。` : "";
    if (!window.confirm(`删除「${room.name}」？${extra}`)) return;
    await api.classrooms.remove(room.id);
    setOpenId((current) => (current === room.id ? null : current));
    await load();
  }

  return (
    <>
      <PageHeading
        title="教室"
        description="上课用教室与自习室：容量、可用时段，以及今天的排课。"
      />

      <DataNotice onRefresh={load} />

      {creating && (
        <Panel
          className="mt-6"
          title="新增场地"
          description="可用时段留空表示不限（营业时间内都可用）。"
        >
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
        <div className="flex gap-1">
          {(["全部", ...CLASSROOM_KINDS] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind)}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                kindFilter === kind
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-ink-600 hover:bg-ink-100",
              )}
            >
              {kind}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-500">
          {loading ? "加载中…" : `${visible.length} 个场地`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* 次要样式：导入是低频操作，不该和每天点的「新增」长得一样 */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating(false);
              setImporting((value) => !value);
            }}
          >
            {importing ? "收起导入" : "批量导入"}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setImporting(false);
              setCreating((value) => !value);
            }}
          >
            {creating ? "收起表单" : "新增场地"}
          </Button>
        </div>
      </div>

            {importing && (
        <BulkImport fixedEntity="classrooms" onImported={async () => { await load(); }} />
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((room) => {
          const todays = todayByRoom.get(room.id) ?? [];
          const totalMinutes = todays.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
          return (
            <section key={room.id} className="rounded-lg border border-ink-200 bg-white">
              <header className="border-b border-ink-100 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-medium text-ink-900">{room.name}</h2>
                  <span className={kindClass(room.kind)}>{room.kind}</span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {room.kind === "自习室" ? `${room.capacity} 个座位` : `容纳 ${room.capacity} 人`}
                  {room.note !== "" && ` · ${room.note}`}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  可用时段：{describeAvailability(room.availability)}
                </p>
              </header>

              <div className="px-4 py-3">
                <p className="text-xs text-ink-500">
                  今天 {todays.length} 节 · {Math.round((totalMinutes / 60) * 10) / 10} 小时
                </p>
                {todays.length === 0 ? (
                  <p className="mt-1.5 text-sm text-ink-500">今天空闲。</p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
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

        {!loading && visible.length === 0 && (
          <p className="rounded-lg border border-ink-200 bg-white px-4 py-8 text-center text-sm text-ink-500 sm:col-span-2 lg:col-span-3">
            {classrooms.length === 0 ? "还没有登记场地。" : `没有「${kindFilter}」类型的场地。`}
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

function kindClass(kind: ClassroomKind): string {
  return kind === "自习室"
    ? "shrink-0 rounded-sm border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-600"
    : "shrink-0 rounded-sm border border-brand-100 bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700";
}

/** 某个场地的全部排课。 */
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
                {formatDayLabel(lesson.startsAt)}{" "}
                {formatTimeRange(lesson.startsAt, lesson.durationMinutes)}
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

/** 时段行 id：只在表单内部使用，不需要持久化语义。 */
let rowSeq = 0;
function newRowId(): string {
  rowSeq += 1;
  return `row_${Date.now().toString(36)}_${rowSeq}`;
}

/**
 * 场地表单：新建与编辑共用。
 *
 * 「可用时段」做成可增删的行：一行 = 若干星期 + 一个时间段，
 * 覆盖「周一至周五 17:00–21:00」这种最常见的写法；一行都不加就是「不限时段」。
 */
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
  const [kind, setKind] = useState<ClassroomKind>(classroom?.kind ?? "上课用教室");
  const [capacity, setCapacity] = useState(`${classroom?.capacity ?? 8}`);
  const [note, setNote] = useState(classroom?.note ?? "");
  const [rows, setRows] = useState<ClassroomAvailability[]>(
    classroom?.availability.map((row) => ({ ...row })) ?? [],
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /*
   * 乐观锁（v17）：打开表单时读到的那一版。存成 state 而不是提交时读
   * `classroom.version` —— 父组件的列表一刷新，那个 prop 就是新对象了，
   * 用新版本提交等于把锁关掉（永远对得上）。保存成功后用返回的记录更新它。
   */
  const [version, setVersion] = useState(classroom?.version ?? 1);

  function addRow() {
    setRows((current) => [
      ...current,
      { id: newRowId(), weekdays: [1, 2, 3, 4, 5], start: "17:00", end: "21:30" },
    ]);
  }

  function updateRow(id: string, patch: Partial<ClassroomAvailability>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (name.trim() === "") {
      setError("名称必填。");
      return;
    }
    // 时段行必须选星期且结束晚于开始，否则排课时的可用性判断会失效
    for (const row of rows) {
      if (row.weekdays.length === 0) {
        setError(`时段「${row.start}–${row.end}」没有选择星期。`);
        return;
      }
      const start = toMinutes(row.start);
      const end = toMinutes(row.end);
      if (start === null || end === null || end <= start) {
        setError(`时段「${row.start}–${row.end}」不合法：结束时间必须晚于开始时间。`);
        return;
      }
    }

    setPending(true);
    setError("");

    const payload = {
      name: name.trim(),
      kind,
      capacity: Math.max(1, Math.trunc(Number(capacity) || 1)),
      availability: rows,
      note: note.trim(),
    };

    try {
      if (editing) {
        /*
         * 整份提交（连**可用时段**一起交上来），而可用时段直接决定排课冲突判定：
         * 被别人静默盖掉就会出现"排了一节本该排不进去的课"。因此带上读到的版本，
         * 冲突时把服务端原话显示在下面同一个 error 位置。
         */
        const saved = await api.classrooms.update(classroom.id, payload, { expectedVersion: version });
        if (saved !== null) setVersion(saved.version);
      } else {
        await api.classrooms.create(payload);
      }
    } catch (cause) {
      // 冲突（409）与参数错（400）都在这里显示服务端原话，不另造一套提示
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
      setPending(false);
      return;
    }

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
          placeholder="例如 301 教室 / 自习区"
          required
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">用途</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ClassroomKind)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {CLASSROOM_KINDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <NumberInput
          label={kind === "自习室" ? "座位数" : "容纳人数"}
          suffix="人"
          value={capacity}
          onChange={(event) => setCapacity(event.target.value)}
          min={1}
        />
      </div>

      {/* 可用时段 */}
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-ink-600">
            可用时段{rows.length === 0 && "（留空 = 不限时段）"}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            + 添加时段
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="mt-1.5 text-xs text-ink-400">不限时段：营业时间内都可以排课。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-ink-200 bg-white px-3 py-2"
              >
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_LABELS.map((day) => {
                    const checked = row.weekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        aria-pressed={checked}
                        onClick={() =>
                          updateRow(row.id, {
                            weekdays: checked
                              ? row.weekdays.filter((value) => value !== day.value)
                              : [...row.weekdays, day.value].sort((a, b) => a - b),
                          })
                        }
                        className={cn(
                          "size-7 rounded-md text-xs transition-colors",
                          checked
                            ? "bg-brand-50 font-medium text-brand-700"
                            : "text-ink-500 hover:bg-ink-100",
                        )}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>

                <span className="text-xs text-ink-400">{describeWeekdays(row.weekdays)}</span>

                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={row.start}
                    onChange={(event) => updateRow(row.id, { start: event.target.value })}
                    className="rounded-md border border-ink-300 px-2 py-1 text-xs tabular outline-none focus:border-brand-500"
                  />
                  <span className="text-xs text-ink-400">–</span>
                  <input
                    type="time"
                    value={row.end}
                    onChange={(event) => updateRow(row.id, { end: event.target.value })}
                    className="rounded-md border border-ink-300 px-2 py-1 text-xs tabular outline-none focus:border-brand-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="ml-auto text-xs text-ink-500 transition-colors hover:text-danger-600"
                >
                  删除这一行
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3">
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
