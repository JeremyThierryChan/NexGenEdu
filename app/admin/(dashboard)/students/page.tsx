"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { useAuth, rolesOrAll } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { Panel } from "@/components/admin/AdminFields";
import { BulkImport } from "@/components/admin/BulkImport";
import { StudentForm } from "@/components/admin/StudentForm";
import { StudentDetail } from "@/components/admin/StudentDetail";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, type Catalog, type Lesson, type Student } from "@/lib/backend/api";
import { remainingTotal } from "@/lib/backend/enrollment";
import { FOLLOWUP_RULES } from "@/lib/backend/followup";
import { LoadFailure } from "@/components/admin/LoadFailure";
// 教材的唯一显示口径（`学科·模块名`，v32）
import { textbookSummary } from "@/lib/backend/textbooks";

/**
 * **教材未填**的待补小标（v32）：虚线边框 + 灰底 + 更浅的字色。
 *
 * 与教师卡片上的「用工未填」/「来源未填」、教室卡片上的「校区未填」**同一档样式、同一个思路**
 * （机构口径：「没填的时候也看得出来」）：教材不是必填，但"这个孩子现在在读哪几本"
 * 是排课与备课要看的一条信息 —— 没填就该像个待办，而不是一片空白。
 *
 * 与已填的教材**必须一眼分得开**（这一条比好看重要）：同一个样式的话，
 * 「教材未填」会被读成"这个学生在读一本叫『教材未填』的教材"—— 一条**假的学业信息**
 * 比不显示更糟。`scripts/check.mts` §49 盯着"这一页与另外两页用的是同一个类"。
 */
const TEXTBOOK_TODO_CLASS =
  "rounded-sm border border-dashed border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[10px] text-ink-400";

/** 灰标上的悬停提示：告诉人"去哪儿补"（这一行末尾那个「编辑」就是入口）。 */
const TEXTBOOK_TODO_HINT = "点编辑补教材";

/**
 * **来源未填**的待补小标（v33）：与上面那一档**逐字节相同的类名**，不是"看起来差不多"。
 *
 * 为什么不另立一套样式：机构看的是**待办**这件事本身。学生这一页上现在有两个待办灰标
 * （「教材未填」「来源未填」），它们与教师卡片的「用工未填 / 来源未填」、教室卡片的
 * 「校区未填」是同一档东西 —— 同一个类名，机构读到的就是"又缺了一条该补的信息"。
 * 各写一套（哪怕只是颜色差一点）会被读成**两个不同的待办**。
 *
 * ⚠️ 这里那个「来源」是**获客来源**（学生从哪来的）；教师页上的「来源未填」是
 * **招聘渠道**（人从哪招来的）—— 同名不同义，两个字段互不影响。
 * `scripts/check.mts` §50 盯着"学生列表 / 学生详情 / 教师页用的是同一个类"。
 */
const SOURCE_TODO_CLASS = TEXTBOOK_TODO_CLASS;

/** 灰标上的悬停提示：告诉人"去哪儿补这一条"。 */
const SOURCE_TODO_HINT = "点编辑补来源（这个学生从哪来的）";

/**
 * 学生模块。
 *
 * 目标是「10 秒内知道一个学生的状态」：报了什么、还剩几节课、什么时候上、有什么备注。
 * 因此一屏之内给到：搜索 + 列表（剩余课时不足的标红）+ 展开详情（排课与课时调整）。
 *
 * 数据全部走伪后端服务（lib/backend/api.ts），页面不碰存储细节。
 */
export default function AdminStudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  /*
   * 课程类型（v32）：学生列表上那列「教材」要把模块 id 显示成 `学科·模块名`。
   *
   * 与教师、教室那两页读"参考数据"是同一件事；取不到就只影响这一列的写法
   * （下面渲染的是"…"），列表本身照常显示 —— 不该因为读不到维度表就整页空掉。
   */
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  /**
   * 读不出来时的原因（审计抓到的那条：这里原先没有 try/catch ——
   * 后端没开 / 登录过期 / 权限不足时 setLoading(false) 永远走不到，界面就停在「加载中…」）。
   */
  const [loadError, setLoadError] = useState("");
  const [creating, setCreating] = useState(false);
  // 批量导入面板（与「新增」表单互斥，避免同屏两个大面板）
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 写操作的提示（删除被护栏拦下时，把服务端那句原话显示出来）。 */
  const notice = useActionNotice();
  /*
   * 这个角色的动作能力：**直接问服务端用的那个判定函数**（`canCallMethod`），
   * 不另建一张页面专用的权限表 —— 两张表迟早分叉，而分叉的表现就是
   * "按钮看得见、点了 403、界面还什么都不说"（审计实测到的那一类）。
   */
  const auth = useAuth();
  const roles = rolesOrAll(auth);
  const canCreate = canCallMethod(roles, "students.create");
  const canUpdate = canCallMethod(roles, "students.update");
  const canRemove = canCallMethod(roles, "students.remove");
  const canImport = canCallMethod(roles, "imports.apply");

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时**不进加载态**，因此不会在"点一下就地动作"
   * 的同一瞬间把列表换成加载中、把页面高度塌掉 —— 页高一塌，浏览器就会把滚动位置夹回顶部
   * （§15.3 里那条真实反馈）。首屏（useEffect 里那一次）仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    try {
      const [studentList, lessonList] = await Promise.all([
        api.students.list(),
        api.lessons.list(),
      ]);
      setStudents(studentList);
      setLessons(lessonList);
      setLoading(false);

      setLoadError("");
    } catch (cause) {
      /*
       * 失败要把话说出来：服务端那句通常写着「该找谁 / 该先做什么」（403 说角色、
       * 400 说哪个参数不对），比界面自己编一句准。**屏幕上的旧数据不动** ——
       * 它可能是对的，只是这次没刷新成功。
       */
      setLoadError(
        cause instanceof Error && cause.message.trim() !== ""
          ? cause.message
          : `读取失败（${String(cause)}）—— 请重试；仍然不行就去看后端日志。`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * 课程类型读一次（教材那一列要用它把模块 id 换成 `学科·模块名`）。
   *
   * 单独一个 effect 而不是并进 `load()`：`load()` 是"业务数据刷新"，
   * 而课程类型是参考数据（改它之后要刷新的是课程类型页），混在一起会让每次点删除
   * 都多读一份维度表。失败也不进 `loadError` —— 那一列的写法是次要信息，
   * 不该把"读取失败"的红条挂在整页上。
   */
  useEffect(() => {
    let alive = true;
    void api.catalog
      .list()
      .then((data) => {
        if (alive) setCatalog(data);
      })
      .catch(() => {
        // 读不到课程类型时那一列显示"…"，其余一切照旧
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * 支持从全局搜索直达：/admin/students?studentId=xxx 会直接展开这位学生的详情。
   * 刻意用 window.location 而不是 useSearchParams —— 后者在静态导出下会触发
   * CSR bailout，把整页从预渲染的 HTML 里踢出去。
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("studentId");
    if (id !== null && id !== "") setOpenId(id);
  }, []);

  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (text === "") return students;
    return students.filter((student) =>
      [student.name, student.grade, student.guardian, student.status, ...student.subjects]
        .join(" ")
        .toLowerCase()
        .includes(text),
    );
  }, [keyword, students]);

  /** 每个学生排了几节课（用于列表里一眼看出有没有排课）。 */
  const lessonCountByStudent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lesson of lessons) {
      for (const id of lesson.studentIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [lessons]);

  /**
   * **已经在用的获客来源**（v33）：给表单里「来源」那一格挂的 `<datalist>` 用。
   *
   * 来源是**自由文本**（机构要自己填，不做固定枚举），但同一个渠道被写成
   * 「朋友介绍」「熟人介绍」「朋友推荐」三种，按渠道统计就失效了 ——
   * 因此把已在用的值提示出来复用，同时不拦着写新的。
   * 真源就是学生列表上那一列，不另存一份"渠道清单"（与教师页的 `sourceOptions` 同一个做法）。
   *
   * ⚠️ 这里收集的是**学生**的获客来源，与教师页那份（招聘渠道）是两件事，**不要合并** ——
   * 合并之后"地推招来几个学生"和"招来几个老师"就再也分不开了。
   */
  const sourceOptions = useMemo(() => {
    const values = new Set<string>();
    for (const student of students) {
      /*
       * `?? ""` 不是防御性编程的洁癖，是这条真实情况：**后端进程是启动时加载代码的**，
       * 因此"前端已经重建、后端还跑着改动之前的进程"这一刻，`students.list()` 返回的
       * 记录里**没有** `source`。没有兜底的话 `undefined.trim()` 会让整个学生页白屏 ——
       * 而机构此刻正在用这套系统。兜成空串＝"还没填"，与迁移给老库补的值同一个状态。
       */
      const value = (student.source ?? "").trim();
      if (value !== "") values.add(value);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "zh"));
  }, [students]);

  /**
   * 删除学生。
   *
   * **服务端会拦下"名下有账"的学生**（收款、课时流水、课堂记录、测评、作业、排课 ——
   * 见 `lib/backend/api.ts` 的 `studentDeleteRefusal`），拦下时会把"还有哪些记录、该怎么办"
   * 写在错误里。所以这里：① 确认框里先说清"有账就删不掉"；② 走 `notice.run` 把服务端那句
   * **原话显示出来**（裸 `await` 会让它变成无人接的拒绝，用户只看到"点了没反应"）。
   */
  async function remove(student: Student) {
    const count = lessonCountByStudent.get(student.id) ?? 0;
    const extra = count > 0 ? `\nTA 还有 ${count} 节排课。` : "";
    if (
      !window.confirm(
        `删除「${student.name}」？${extra}\n` +
          "名下有收款、课时流水、课堂记录、测评或作业时，系统不会删，并会告诉你先做什么" +
          "（那些记录删掉之后会失去主人）。只是不再来上课的话，把状态改成「结课」更合适。",
      )
    ) {
      return;
    }
    const removed = await notice.run(() => api.students.remove(student.id));
    if (removed === null) return;
    setOpenId((current) => (current === student.id ? null : current));
    await load({ quiet: true });
  }

  return (
    <>
      <PageHeading
        title="学生"
        description="学生档案、报读科目、剩余课时与排课情况。"
      />

      <DataNotice
        onRefresh={async () => {
          // 安静刷新（见 load 的说明）
          await load({ quiet: true });
        }}
      />

      {loadError !== "" && (
        <LoadFailure
          error={loadError}
          onRetry={() => void load({ quiet: true })}
          className="mt-4"
        />
      )}
      {/* 一次写操作的结果（删除被护栏拦下时，服务端那句原话显示在这里） */}
      <ActionNoticeView notice={notice} className="mt-4" />


      {/* 新增表单 */}

      {importing && canImport && (
        <BulkImport fixedEntity="students" onImported={async () => { await load({ quiet: true }); }} />
      )}
      {creating && canCreate && (
        <Panel
          className="mt-6"
          title="新增学生"
          description="填好姓名与年级即可建档，其余字段可以以后再补。"
        >
          <StudentForm
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
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索姓名 / 年级 / 科目 / 家长联系方式"
          className="w-full max-w-xs rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <span className="text-xs text-ink-500">
          {loading ? "加载中…" : `${visible.length} / ${students.length} 人`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/*
            没有权限的按钮**不渲染**（而不是渲染出来点了 403）：审计实测普通教师会看到
            「新增学生 / 删除 / 编辑」，点下去没有任何反应（裸 await 的拒绝没人接）。
            这里再补一句"这件事归谁"，让人知道该找谁，而不是以为系统坏了。
          */}
          {canImport && (
            /* 次要样式：导入是低频操作，不该和每天点的「新增」长得一样 */
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
          )}
          {canCreate && (
            <Button
              size="sm"
              onClick={() => {
                setImporting(false);
                setCreating((value) => !value);
              }}
            >
              {creating ? "收起表单" : "新增学生"}
            </Button>
          )}
          {!canCreate && (
            <span className="text-xs text-ink-500">
              你的角色（{roles.join(" · ")}）是只读的：建档 / 改档案归{" "}
              {methodOwnerText("students.create")}
            </span>
          )}
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        {/*
          列宽：加「教材」（v32）与「来源」（v33）之后是**九列**。
          `min-w` 跟着从 720px 提到 880px —— 不提的话，窄屏上那九列会被浏览器挤到
          一格只放两三个字（姓名列折成两行、"初中数学、初中英语"每行一个科目），
          读起来比左右滚动难受得多。外面那层 `overflow-x-auto` 本来就在，
          因此宽屏不受影响、窄屏左右滚动。
        */}
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-2.5 font-medium">姓名</th>
              <th className="px-4 py-2.5 font-medium">年级</th>
              <th className="px-4 py-2.5 font-medium">报读科目</th>
              {/* 现阶段使用的教材（v32）：多本时按 `学科·模块名` 列出来，没填挂待补灰标 */}
              <th className="px-4 py-2.5 font-medium">教材</th>
              {/* 来源（v33，**获客来源**）：没填挂待补灰标 */}
              <th className="px-4 py-2.5 font-medium">来源</th>
              <th className="px-4 py-2.5 font-medium">剩余课时</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">家长</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((student) => (
              <tr key={student.id} className="border-b border-ink-50 last:border-0">
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === student.id ? null : student.id)}
                    className="text-left font-medium text-ink-900 transition-colors hover:text-brand-700"
                  >
                    {student.name}
                    <span className="ml-1.5 text-xs text-ink-400">
                      {openId === student.id ? "▲" : "▼"}
                    </span>
                  </button>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{student.grade}</td>
                <td className="px-4 py-2.5 text-ink-600">
                  {student.subjects.join("、") || "—"}
                </td>
                <td className="px-4 py-2.5">
                  {/*
                    教材（v32）：**没填时挂一个待补灰标**，不是留成空白格 ——
                    空白格会被读成"这一页不显示教材"，而机构要的是"还差这一条，去补"。
                    显示口径走 `textbookSummary`（带学科：`数学·八年级教材、物理·必修教材`），
                    因为「必修教材」在数学/物理/化学…下都有，不带学科认不出是哪本。
                  */}
                  {catalog === null ? (
                    <span className="text-ink-400">…</span>
                  ) : student.textbooks.length === 0 ? (
                    <span className={TEXTBOOK_TODO_CLASS} title={TEXTBOOK_TODO_HINT}>
                      教材未填
                    </span>
                  ) : (
                    <span className="text-ink-600">{textbookSummary(catalog, student.textbooks)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {/*
                    来源（v33，**获客来源**：这个学生从哪来的）。

                    与教材那一列同一个思路：**没填时挂一个待补灰标**，不是留成空白格 ——
                    空白格会被读成"这一页不显示来源"，而机构要的是"还差这一条，去补"。
                    灰标里那两个字「来源未填」是**一个状态**，不是一条渠道名；
                    它与教师页上的「来源未填」（招聘渠道）同名但不相干（见 `SOURCE_TODO_CLASS`）。

                    值是自由文本，原样显示（不做任何改写：机构写「抖音来的」就显示「抖音来的」）——
                    显示口径只有这一处，条目多到要看分布时走导出那张表去统计。
                  */}
                  {/*
                    值为空时挂灰标。`?? ""` 兜的是"后端进程还是改动之前那一份"这种时刻
                    （记录里没有 `source` 这个键）—— 没有它，`undefined.trim()` 会让整页白屏，
                    而机构正在用；见 `sourceOptions` 那一段的说明。
                  */}
                  {(student.source ?? "").trim() === "" ? (
                    <span className={SOURCE_TODO_CLASS} title={SOURCE_TODO_HINT}>
                      来源未填
                    </span>
                  ) : (
                    <span className="text-ink-600">{student.source}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {(() => {
                    // 课时按科目记账，这里显示合计（明细在详情的「报课与课时」里）
                    const remaining = remainingTotal(student.enrollments);
                    return (
                      <>
                        <span
                          className={
                            remaining <= FOLLOWUP_RULES.lowLessons
                              ? "tabular font-medium text-warning-600"
                              : "tabular text-ink-700"
                          }
                        >
                          {remaining} 节
                        </span>
                        <span className="ml-1.5 text-[11px] text-ink-400">
                          {student.enrollments.filter((item) => item.status === "在读").length} 门
                        </span>
                        {remaining <= FOLLOWUP_RULES.lowLessons && student.status === "在读" && (
                          <span className="ml-1.5 text-[11px] text-warning-600">需提醒</span>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={student.status} />
                </td>
                <td className="px-4 py-2.5 text-ink-600">{student.guardian}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    {/* 没有权限就不渲染（见上面那段说明）：点了 403 而界面不说话，最容易被当成"系统坏了" */}
                    {canUpdate && (
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === student.id ? null : student.id)}
                        className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                      >
                        {editingId === student.id ? "收起" : "编辑"}
                      </button>
                    )}
                    {canRemove && (
                    <button
                      type="button"
                      onClick={() => void remove(student)}
                      className="text-xs text-ink-500 transition-colors hover:text-danger-600"
                    >
                      删除
                    </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && visible.length === 0 && (
              <tr>
                {/* 列数 = 表头那九个：姓名 / 年级 / 报读科目 / 教材 / 来源 / 剩余课时 / 状态 / 家长 / 操作 */}
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-500">
                  {students.length === 0
                    ? "还没有学生档案，点右上角「新增学生」建档。"
                    : "没有匹配的学生。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 编辑表单 */}
      {editingId !== null && (
        <Panel className="mt-4" title="编辑学生">
          <StudentForm
            /*
             * `key` 不是装饰：表单里姓名 / 年级 / 生日 / 教材 / 版本号都是
             * `useState(student?…)` 的**初始化器**（只在挂载时算一次）。
             * 没有这个 key，"编辑 A → 直接点 B 的编辑"不会重新挂载，
             * 表单里留着的还是 **A 的值**（版本号也是 A 的）——
             * 保存时要么把 A 的资料写到 B 上，要么被乐观锁拒绝却让人看不懂为什么。
             * 换成学生 id 就让每次编辑都是干净的一次挂载。
             */
            key={editingId}
            student={students.find((item) => item.id === editingId) ?? undefined}
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

      {/* 详情：排课与课时调整 */}
      {openId !== null && (
        <StudentDetail
          className="mt-6"
          studentId={openId}
          onChanged={() => void load({ quiet: true })}
        />
      )}
    </>
  );
}

function StatusBadge({ status }: { status: Student["status"] }) {
  const tone =
    status === "在读"
      ? "border-success-100 bg-success-50 text-success-600"
      : status === "暂停"
        ? "border-warning-100 bg-warning-50 text-warning-600"
        : "border-ink-200 bg-ink-50 text-ink-500";
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${tone}`}>{status}</span>
  );
}
