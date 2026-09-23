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
import { api, type Lesson, type Student } from "@/lib/backend/api";
import { remainingTotal } from "@/lib/backend/enrollment";
import { FOLLOWUP_RULES } from "@/lib/backend/followup";
import { LoadFailure } from "@/components/admin/LoadFailure";

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
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-2.5 font-medium">姓名</th>
              <th className="px-4 py-2.5 font-medium">年级</th>
              <th className="px-4 py-2.5 font-medium">报读科目</th>
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
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-500">
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
            student={students.find((item) => item.id === editingId) ?? undefined}
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
