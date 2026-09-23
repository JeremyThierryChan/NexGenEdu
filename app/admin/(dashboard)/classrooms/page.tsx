"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
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
// 教室名的**唯一显示口径**（「校区·教室名」），与"输入时分开填"配套 —— 见 §7 的说明
import { classroomLabel } from "@/lib/backend/classrooms";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

/**
 * 教室模块。
 *
 * 每个场地有四层信息：
 *   1. **校区**：这间房在哪个校区（自由文本，可留空）—— 与教室名**分开输入**，
 *      显示时由 `classroomLabel` 拼成「校区·教室名」（机构口径：**输入分开、显示不变**，v31）；
 *   2. **用途**：上课用教室 / 自习室 —— 前者按班型排课，后者是学生自习的座位；
 *   3. **容量**：可容纳人数（自习室即座位数）；
 *   4. **可用时段**：一周中哪几天、哪个时间段开放；**留空表示不限**。
 *
 * 可用时段不只是展示：排课时会检查「这节课是否落在教室开放时间内」，
 * 落在开放时间之外会在保存前提示（见 components/admin/LessonForm.tsx）。
 *
 * 全页**只有标题与确认框显示教室名**，两处都走 `classroomLabel` ——
 * 其余地方只出现容量 / 时段这类数字，不会出现"半个教室名"。
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
  /** 写操作的提示（删除被护栏拦下时，把服务端那句原话显示出来）。 */
  const notice = useActionNotice();
  const [kindFilter, setKindFilter] = useState<"全部" | ClassroomKind>("全部");

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时**不进加载态**，因此不会在"点一下就地动作"
   * 的同一瞬间把列表换成加载中、把页面高度塌掉 —— 页高一塌，浏览器就会把滚动位置夹回顶部
   * （§15.3 里那条真实反馈）。首屏（useEffect 里那一次）仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
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

  /** 支持从全局搜索直达：/admin/classrooms?classroomId=xxx 直接展开那间教室（理由同教师页）。 */
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("classroomId");
    if (value !== null && value !== "") setOpenId(value);
  }, []);

  const visible = useMemo(
    () =>
      kindFilter === "全部" ? classrooms : classrooms.filter((room) => room.kind === kindFilter),
    [classrooms, kindFilter],
  );

  /**
   * **已在用的校区**（v30）：给表单里那个 `<datalist>` 用。
   *
   * 从当前列表收集（而不是单独存一份"校区清单"）：校区的真源就是教室里那一列，
   * 另存一份就多一处要对齐的地方。去空白、去重、排序 —— 排序是为了让下拉的顺序
   * 与"库里谁先建"无关（否则新加一间房就会让候选值的顺序变来变去）。
   */
  const campusOptions = useMemo(() => {
    const names = new Set<string>();
    for (const room of classrooms) {
      const campus = room.campus.trim();
      if (campus !== "") names.add(campus);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "zh"));
  }, [classrooms]);

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

  /** 删除教室：有排课时服务端会拦下（见 `classroomDeleteRefusal`），并建议改用「停用」。 */
  async function remove(room: Classroom) {
    const count = lessons.filter((lesson) => lesson.classroomId === room.id).length;
    const extra = count > 0 ? `\n该场地还有 ${count} 节课。` : "";
    if (
      !window.confirm(
        `删除「${classroomLabel(room)}」？${extra}\n` +
          "还有排课时系统不会删（那些课会查不到场地、利用率也没法算）——\n" +
          "不再使用的话，建议改成「停用」而不是删除。",
      )
    ) {
      return;
    }
    const removed = await notice.run(() => api.classrooms.remove(room.id));
    if (removed === null) return;
    setOpenId((current) => (current === room.id ? null : current));
    await load({ quiet: true });
  }

  return (
    <>
      <PageHeading
        title="教室"
        description="上课用教室与自习室：容量、可用时段，以及今天的排课。"
      />

      <DataNotice
        onRefresh={async () => {
          // 安静刷新（见 load 的说明）
          await load({ quiet: true });
        }}
      />

      {/* 一次写操作的结果（删除被护栏拦下时，服务端那句原话显示在这里） */}
      <ActionNoticeView notice={notice} className="mt-4" />

      {creating && (
        <Panel
          className="mt-6"
          title="新增场地"
          description="校区与教室名称分开填（显示时拼成「校区·教室名」）；可用时段留空表示不限（营业时间内都可用）。"
        >
          <ClassroomForm
            campusOptions={campusOptions}
            onCancel={() => setCreating(false)}
            onSaved={async () => {
              setCreating(false);
              // 安静刷新：新增完不清空列表、不塌页高（见 load 的说明）
              await load({ quiet: true });
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
        <BulkImport fixedEntity="classrooms" onImported={async () => { await load({ quiet: true }); }} />
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((room) => {
          const todays = todayByRoom.get(room.id) ?? [];
          const totalMinutes = todays.reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
          return (
            <section key={room.id} className="rounded-lg border border-ink-200 bg-white">
              <header className="border-b border-ink-100 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  {/*
                    卡片标题用 `classroomLabel`（v31）：**显示格式与机构原来看到的一模一样**
                    ——「校区·教室名」（例如「沐阳教育·教室1」），没填校区时就是纯教室名。
                    机构的口径是"输入分开、显示不变"，因此这一行**不再单独印一遍「校区 …」**：
                    同一条信息不重复两遍（信息在标题里已经全了）。
                  */}
                  <h2 className="text-sm font-medium text-ink-900">{classroomLabel(room)}</h2>
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
                    campusOptions={campusOptions}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      setEditingId(null);
                      // 安静刷新：编辑保存完不清空列表、不塌页高（见 load 的说明）
                      await load({ quiet: true });
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
          classroomName={(() => {
            const room = classrooms.find((item) => item.id === openId);
            return room === undefined ? "" : classroomLabel(room);
          })()}
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
  campusOptions,
  onCancel,
  onSaved,
}: {
  classroom?: Classroom;
  /** 已在用的校区（父组件从列表里收集），供 `<datalist>` 提示；空数组表示一个都还没登记 */
  campusOptions: string[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = classroom !== undefined;
  const [name, setName] = useState(classroom?.name ?? "");
  const [kind, setKind] = useState<ClassroomKind>(classroom?.kind ?? "上课用教室");
  /*
   * 校区（v30）：**自由文本**，但给一个 `<datalist>` 把**已在用的校区**列出来
   * （候选值由父组件从当前列表里收集后传进来）—— 自由文本的坑是同一个校区被写成
   * 「城西校区」「城西」「西校区」三种，统计与筛选当场失效；让它可复用、但不强制。
   */
  const [campus, setCampus] = useState(classroom?.campus ?? "");
  const [capacity, setCapacity] = useState(`${classroom?.capacity ?? 8}`);
  const [note, setNote] = useState(classroom?.note ?? "");
  const [rows, setRows] = useState<ClassroomAvailability[]>(
    classroom?.availability.map((row) => ({ ...row })) ?? [],
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /**
   * `<datalist>` 的 id：用 React 的 `useId`（不是写死的字符串）——
   * 同屏可能出现两个表单（「新增场地」面板与某间房的编辑表单），
   * 写死的 id 会让两个 datalist 撞名，浏览器只认第一个，候选值就串了。
   */
  const campusListId = useId();
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
      setError("教室名称必填（校区可以留空，教室名不行 —— 它是排课与冲突判定里认这间房的依据）。");
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
      // 校区（v30）：自由文本，只去前后空白（口径在服务端 normalizeClassroomRecord 里也是"只 trim"）
      campus: campus.trim(),
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
        {/*
          「教室名称」只填**房间本身**的名字（v31）：校区在右边那一格单独填，
          显示时由 `classroomLabel` 拼成「校区·教室名」。
          placeholder 刻意**不再**写「301 教室 / 自习区」那种带校区感的完整叫法，
          免得引导人把「沐阳教育·教室1」整串填进来（填了也会被归一拆开，但那是兜底、不是用法）。
        */}
        <TextField
          label="教室名称"
          hint="只填房间名；校区在右边单独填，显示时会拼成「校区·教室名」"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 教室1 / 落地房四楼小"
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
        <TextField
          label="校区"
          hint="与教室名称分开填（显示时拼成「校区·教室名」）。已登记过的校区会提示出来，可直接选；也可以写新的（例如 城西校区 / 总校）"
          value={campus}
          onChange={(event) => setCampus(event.target.value)}
          placeholder="例如 城西校区 / 总校"
          list={campusOptions.length > 0 ? campusListId : undefined}
        />
      </div>

      {/*
        「已在用的校区」候选值（v30）。放在表单里、**不在 label 里面**：
        `<datalist>` 只提供候选，不显示在页面上，但塞进 `<label>` 里会让读屏软件
        把它当成这个字段的一部分念出来。没有任何已登记校区时**整块不渲染** ——
        一个空的 datalist 没意义，而下拉箭头会让第一次用的人以为"这里能选"。
      */}
      {campusOptions.length > 0 && (
        <datalist id={campusListId}>
          {campusOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}

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
