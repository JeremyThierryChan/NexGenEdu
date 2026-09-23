"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { Panel, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { BulkImport } from "@/components/admin/BulkImport";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, type Lesson, type Teacher, type TeacherEmployment } from "@/lib/backend/api";
import { TEACHER_EMPLOYMENTS, TEACHER_KINDS } from "@/lib/backend/types";
import { formatDayLabel, formatTimeRange } from "@/lib/backend/format";

/**
 * 教师模块。
 *
 * 与宣传网站的教师页分工不同：那里是给家长看的介绍，这里是排课用的档案
 * （可带科目、联系方式、在职状态、当前排课量）。
 *
 * 「在职」开关很重要：离职教师保留档案但不出现在排课下拉里，
 * 因此列表里可以直接切换，不必删除历史记录。
 *
 * 两个**人事字段**（「全职 / 兼职」与「来源（招聘渠道）」）在列表上是**两态**的：
 * 填了显示值，没填显示一个灰色的待办小标（「用工未填」/「来源未填」）——
 * 机构口径是「**教师信息我自己在后台填，更希望没填的时候也看得出来**」，
 * 因此这里刻意不是"没填就不显示"（那样没人知道还缺多少人的信息）。
 */

/**
 * 已填的人事字段：白底描边小标（与其它已填信息同一档）。
 *
 * 两个字段共用一份样式，是为了让「填了」在卡片上看起来都是同一件事 ——
 * 各写一套的话，机构会以为其中一个字段"更重要"或"没生效"。
 */
const HR_FILLED_CLASS =
  "rounded-sm border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] text-ink-600";

/**
 * **未填**的人事字段：虚线边框 + 灰底 + 更浅的字色 —— 读起来像"待办"，不像一个值。
 *
 * 与 `HR_FILLED_CLASS` **必须一眼分得开**（这一条比好看重要）：
 * 同一个样式的话，「用工未填」会被当成这个人的用工性质（一条**假的人事信息**），
 * 而机构正是拿这两个字段算排课量与成本的。
 */
const HR_TODO_CLASS =
  "rounded-sm border border-dashed border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] text-ink-400";

/** 灰标上的悬停提示：告诉人"去哪儿补"（点姓名那一列就是展开档案的入口）。 */
const HR_TODO_HINT = "点姓名展开就能填";

export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // 批量导入面板（与「新增」表单互斥，避免同屏两个大面板）
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 写操作的提示（删除被护栏拦下时，把服务端那句原话显示出来）。 */
  const notice = useActionNotice();

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时**不进加载态**，因此不会在"点一下就地动作"
   * 的同一瞬间把列表换成加载中、把页面高度塌掉 —— 页高一塌，浏览器就会把滚动位置夹回顶部
   * （§15.3 里那条真实反馈）。首屏（useEffect 里那一次）仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
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

  /*
   * 支持从全局搜索直达：/admin/teachers?teacherId=xxx 直接展开这位老师。
   *
   * 全局搜索的文案写着"点进去直达"，而这里原先不读参数 —— 点一条教师结果只是跳到页顶，
   * 还得自己找人（同一个组件里"学生 / 排课"却是真直达，对比之下更像坏了）。
   * 用 `window.location` 而不是 `useSearchParams`：后者在静态导出下会触发 CSR bailout
   * （与 students / lessons 两页同一个理由）。
   */
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("teacherId");
    if (value !== null && value !== "") setOpenId(value);
  }, []);

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

  /**
   * **已在用的招聘渠道**（v30）：给表单里那个 `<datalist>` 用。
   *
   * 来源是**自由文本**（机构现在没定死渠道清单），但同一个渠道被写成
   * 「朋友介绍」「熟人介绍」「朋友推荐」三种，按渠道统计就失效了 ——
   * 因此把已在用的值提示出来复用，同时不拦着写新的。
   * 真源就是教师列表上那一列，不另存一份"渠道清单"。
   */
  const sourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const teacher of teachers) {
      const source = teacher.source.trim();
      if (source !== "") values.add(source);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "zh"));
  }, [teachers]);

  async function toggleActive(teacher: Teacher) {
    await api.teachers.update(teacher.id, { active: !teacher.active });
    // 安静刷新：表格一直挂着，切在职状态不该把整张表塌成一行（见 load 的说明）
    await load({ quiet: true });
  }

  /**
   * 删除教师。
   *
   * **服务端会拦下"名下有排课"的教师**（见 `lib/backend/api.ts` 的 `teacherDeleteRefusal`），
   * 并建议改用「停用」——离职不等于抹掉历史，课时费还要按记录核算。
   * 这里走 `notice.run` 把服务端那句原话显示出来（裸 `await` 会让它变成没人接的拒绝）。
   */
  async function remove(teacher: Teacher) {
    const count = load_.get(teacher.id)?.total ?? 0;
    const extra = count > 0 ? `\nTA 还有 ${count} 节课记录。` : "";
    if (
      !window.confirm(
        `删除教师「${teacher.name}」？${extra}\n` +
          "名下有排课时系统不会删（那些课会查不到老师、课时费也没法核算）——\n" +
          "如果只是不带课了，建议把「在职」关掉而不是删除。",
      )
    ) {
      return;
    }
    const removed = await notice.run(() => api.teachers.remove(teacher.id));
    if (removed === null) return;
    setOpenId((current) => (current === teacher.id ? null : current));
    await load({ quiet: true });
  }

  return (
    <>
      <PageHeading
        title="教师"
        description="教师档案、可带科目、在职状态与排课量。"
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
        <Panel className="mt-6" title="新增教师" description="科目请与课程名用同一套叫法，便于排课与前台一致。">
          <TeacherForm
            sourceOptions={sourceOptions}
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
        <span className="text-xs text-ink-500">
          {loading
            ? "加载中…"
            : `${teachers.length} 位教师（在职 ${teachers.filter((t) => t.active).length} 位）`}
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
            {creating ? "收起表单" : "新增教师"}
          </Button>
        </div>
      </div>

            {importing && (
        <BulkImport fixedEntity="teachers" onImported={async () => { await load({ quiet: true }); }} />
      )}

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
                  {/* 类型与资料：导入进来的介绍要看得见，否则"导了也白导" */}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {teacher.kind === "AI" && (
                      <span className="rounded-sm border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-800">
                        AI
                      </span>
                    )}
                    {teacher.years !== "" && (
                      <span className="text-[11px] text-ink-400">教龄 {teacher.years}</span>
                    )}
                    {/*
                      用工性质（v30）与「来源（招聘渠道）」这两个**人事字段**：
                      **填了显示值、没填显示灰标**（机构口径：「教师信息我自己在后台填，
                      更希望没填的时候也看得出来」—— 没填的那个是**待办**，得提醒人去补）。

                      两态样式刻意差开一档（这一条比"好看"重要）：
                        · 填了 → 白底描边（`HR_FILLED_CLASS`），与其它已填信息同一档；
                        · 没填 → **虚线边框 + 灰底 + 更浅的字色**（`HR_TODO_CLASS`）+ `title` 提示。
                      不差开的话，那个灰标会被读成"这个人的用工性质叫『用工未填』" ——
                      一条**假的人事信息**比不显示更糟（机构正是拿这两个字段算排课量与成本的）。

                      顺序：`AI` → `教龄 …` → 用工性质 → 来源。
                      待办灰标**排在 AI 与教龄之后**：身份与资历是"这个人是谁"，
                      待办是"还缺一条信息"，缺的不该抢在身份前面。
                    */}
                    {teacher.employment === "" ? (
                      <span className={HR_TODO_CLASS} title={HR_TODO_HINT}>
                        用工未填
                      </span>
                    ) : (
                      <span className={HR_FILLED_CLASS}>{teacher.employment}</span>
                    )}
                    {/*
                      「来源」＝**招聘渠道**（v30，人事口径）：这位老师是怎么来的。
                      它与 `Teacher.origin`（"这条档案当初从哪来"）**是两个东西**，
                      因此两边都改名避让：这一格叫「来源」、`origin` 那个小标**已经不显示了**
                      （见下面那段说明）。两者在中文里都像"来源"，但界面上一处会把它写清。
                    */}
                    {teacher.source === "" ? (
                      <span className={HR_TODO_CLASS} title={HR_TODO_HINT}>
                        来源未填
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-400">来源 {teacher.source}</span>
                    )}
                    {/*
                      卡片上**不再显示 `origin`（网站 / 后台）那个小标**（机构口径：
                      「教师标签里的『网站导入』能删掉吗？」）。

                      为什么可以删：v36 把「从网站导入教师」那个入口整块删掉之后，
                      **以后不会再有新的档案是「网站」来源** —— 这个标只会出现在当年那几条
                      老记录上（真实库里 5 位教师中 4 位是 `网站`），留着只是噪声，
                      而且它还容易和上面那个人事的「来源（招聘渠道）」撞名。

                      为什么**字段本身保留**：`origin` 记的是"**这条档案当初从哪来**"，
                      那是一段历史事实 —— 删字段要动数据库形状（迁移 / 导出 / 导入 / 断言
                      全都用它），而"不假造历史"比"界面上少一个标"重要得多。
                      字段仍然在 `types.ts` 里、仍然由迁移与导入维护、导出时也照旧带出去。
                    */}
                  </div>
                  {teacher.summary !== "" && (
                    <p className="mt-1 max-w-md text-[11px] leading-relaxed text-ink-500">
                      {teacher.summary}
                    </p>
                  )}
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
            sourceOptions={sourceOptions}
            onCancel={() => setEditingId(null)}
            onSaved={async () => {
              setEditingId(null);
              // 安静刷新（见 load 的说明）
              await load({ quiet: true });
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
      description={
        lessons === null
          ? "加载中…"
          : `共 ${lessons.length} 节（含已取消），其中 ${upcoming.length} 节待上；` +
            `下面列出最近 ${Math.min(10, lessons.length)} 节`
      }
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
  sourceOptions,
  onCancel,
  onSaved,
}: {
  teacher?: Teacher;
  /** 已在用的招聘渠道（父组件从列表里收集），供「来源」那个 `<datalist>` 提示 */
  sourceOptions: string[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const editing = teacher !== undefined;
  const [name, setName] = useState(teacher?.name ?? "");
  const [role, setRole] = useState(teacher?.role ?? "");
  const [subjects, setSubjects] = useState<string[]>(teacher?.subjects ?? []);
  /*
   * 可带科目用复选下拉：候选来自课程库（网站课程 + 机构自己加的课），
   * 不再让人手打 —— 手打最容易出现「围棋」与「围棋课」这种两个名字的同一门课。
   */
  const { options: subjectOptions } = useSubjectOptions();
  const [phone, setPhone] = useState(teacher?.phone ?? "");
  // 资料字段（v13）：网站教师页上就写着这几项，在这里照填（或走「批量导入」）
  const [years, setYears] = useState(teacher?.years ?? "");
  const [summary, setSummary] = useState(teacher?.summary ?? "");
  const [bio, setBio] = useState(teacher?.bio ?? "");
  /*
   * 推荐理由与网站显示顺序（v14）。
   *
   * 网站教师页在"能连上后端"时读的就是这两个字段（见 docs/技术架构.md §10.1）：
   * 推荐理由是首页/教师卡片上那句「为什么推荐他」，顺序决定谁排前面
   * （越小越靠前，留空按 999 排在最后）。
   */
  const [recommendation, setRecommendation] = useState(teacher?.recommendation ?? "");
  /*
   * 「在宣传网站展示」（v16）。默认：网站导进来的勾上，机构自己建的**不勾** ——
   * 网站以库为准之后，内部老师的档案不该自己跑到宣传页上去。
   */
  const [siteVisible, setSiteVisible] = useState(teacher?.siteVisible ?? false);
  const [order, setOrder] = useState(String(teacher?.order ?? ""));
  const [kind, setKind] = useState<string>(teacher?.kind ?? "教师");
  /*
   * 用工性质与来源（v30）：机构要的两个**内部**字段。
   *
   * `employment` 的 state 用空串表示「未填」——它就是服务端认的第三档取值，
   * 不在前端另造一个 `undefined` / `null`（否则要写两套"空"的判据）。
   * `source` 是**招聘渠道**（人是怎么招来的），与上面的 `origin`（这条档案从哪来）
   * 是两件事：`origin` 是只读的技术来源（**界面上已经不显示了**，见列表那段说明），
   * 这里这一格是人事口径、由人自己填。
   */
  const [employment, setEmployment] = useState<TeacherEmployment | "">(teacher?.employment ?? "");
  const [source, setSource] = useState(teacher?.source ?? "");
  const sourceListId = useId();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  /*
   * 乐观锁（v17）：**打开表单时读到的那一版**。
   *
   * 为什么存成 state、而不是提交时读 `teacher.version`：这个 `teacher` 是父组件
   * 从列表里查出来的（`teachers.find(...)`），列表一刷新它就是个新对象 ——
   * 那时读到的版本已经不是"我这份表单内容"对应的版本了，用它提交等于把锁关掉。
   * 保存成功后用服务端返回的记录把这里更新掉，免得下一次保存对着自己的成功报冲突。
   */
  const [version, setVersion] = useState(teacher?.version ?? 1);

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
      subjects: subjects.map((item) => item.trim()).filter((item) => item !== ""),
      phone: phone.trim(),
      active: teacher?.active ?? true,
      years: years.trim(),
      summary: summary.trim(),
      bio: bio.trim(),
      recommendation: recommendation.trim(),
      siteVisible,
      // 留空按 999（排在最后）；不是数字就当没填，不让 NaN 进库
      order: Number.isFinite(Number(order)) && order.trim() !== "" ? Number(order) : 999,
      kind: kind === "AI" ? ("AI" as const) : ("教师" as const),
      /*
       * 新建的档案来源是"后台"；老档案保留原来的值（编辑资料不该改掉它的来历）。
       * 这个字段**界面上已经不显示了**，但照旧写：它是"这条档案当初从哪来"的历史事实，
       * 导出/迁移仍然要用（见列表里那段完整说明）。
       */
      origin: teacher?.origin ?? ("后台" as const),
      // v30：整份提交 → 这两个字段也跟着一起交（服务端会复核「全职 / 兼职」的取值）
      employment,
      source: source.trim(),
    };

    try {
      if (editing) {
        /*
         * 教师表单是整份提交（十来个字段一起交上来），因此带上读到的版本：
         * 别人先改过同一位教师时，服务端会拒绝（409），而不是把对方改的盖掉。
         * 冲突文案就是服务端原话，由下面同一个 error 位置显示。
         */
        const saved = await api.teachers.update(teacher.id, payload, { expectedVersion: version });
        if (saved !== null) setVersion(saved.version);
      } else {
        await api.teachers.create(payload);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
      setPending(false);
      return;
    }

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
        <MultiSelect
          label="可带科目"
          hint="从课程库里勾选（排课时只列这些科目）"
          options={subjectOptions.map((option) => ({
            value: option.name,
            group: option.category === "" ? undefined : option.category,
          }))}
          value={subjects}
          onChange={setSubjects}
          placeholder="点击勾选可带科目"
        />
        <TextField
          label="联系方式"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <TextField
          label="教龄"
          hint="例如「5 年」（自由填写）"
          value={years}
          onChange={(event) => setYears(event.target.value)}
        />
        <SelectInput
          label="类型"
          hint="AI 是智能体：留在档案里，但不进排课下拉"
          options={TEACHER_KINDS.map((value) => ({ value, label: value }))}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        />
        {/*
          「全职 / 兼职」（v30，机构要的）。**三档**：未填 / 全职 / 兼职 ——
          「未填」必须是能选回来的一项，否则人一旦点错（或从"没填"变成填了）
          就再也回不到"未填"，只能随便选一个，把"没登记"变成一条假的人事信息。
        */}
        <SelectInput
          label="全职 / 兼职"
          hint="未填就是没登记过（老档案迁移过来都是未填）"
          options={[
            { value: "", label: "未填" },
            ...TEACHER_EMPLOYMENTS.map((value) => ({ value, label: value })),
          ]}
          value={employment}
          // 候选值就是 TEACHER_EMPLOYMENTS + 未填，因此这里的断言与 `<option>` 集合严格一致
          onChange={(event) => setEmployment(event.target.value as TeacherEmployment | "")}
        />
        <TextField
          label="来源"
          hint="招聘渠道：这位老师是怎么招来的（招聘网站 / 朋友介绍 / 内部推荐 / 校招 / 其他）；可留空"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="例如 朋友介绍"
          list={sourceOptions.length > 0 ? sourceListId : undefined}
        />
      </div>

      {/*
        「已在用的来源」候选值（v30）：来源是自由文本，但同一个渠道写成几种叫法会让
        按渠道统计失效，因此把已在用的值提示出来。放在表单里、不在 label 里面
        （与教室页那个校区 datalist 同一处做法与理由）；一个都还没填时整块不渲染。
      */}
      {sourceOptions.length > 0 && (
        <datalist id={sourceListId}>
          {sourceOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextField
          label="一句话简介"
          hint="列表里显示（网站教师页的「一句话」）"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
        <TextField
          label="推荐理由"
          hint="网站上「为什么推荐这位教师」那一句；留空则网站不显示"
          value={recommendation}
          onChange={(event) => setRecommendation(event.target.value)}
          placeholder="例如 同一教师，不同科目，学生无需适应多个老师"
        />
        <TextField
          label="网站显示顺序"
          hint="越小越靠前；留空按最后（网站教师页与首页教师卡片按它排）"
          type="number"
          value={order}
          onChange={(event) => setOrder(event.target.value)}
          placeholder="例如 1"
        />
        <TextAreaField
          label="详细介绍"
          hint="网站教师页的完整介绍会导入到这里；可留空"
          rows={4}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
        />
        <label className="flex items-start gap-2 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-2 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={siteVisible}
            onChange={(event) => setSiteVisible(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            在宣传网站上展示这位教师
            <span className="mt-0.5 block text-[11px] text-ink-400">
              勾上才会出现在网站教师页与首页教师卡片（网站能连上后端构站时以这里为准）；
              内部老师不必勾。
            </span>
          </span>
        </label>
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
