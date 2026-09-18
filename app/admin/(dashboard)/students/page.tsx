"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { Panel } from "@/components/admin/AdminFields";
import { StudentForm } from "@/components/admin/StudentForm";
import { StudentDetail } from "@/components/admin/StudentDetail";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, type Lesson, type Student } from "@/lib/backend/api";
import { remainingTotal } from "@/lib/backend/enrollment";

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
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [studentList, lessonList] = await Promise.all([
      api.students.list(),
      api.lessons.list(),
    ]);
    setStudents(studentList);
    setLessons(lessonList);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function remove(student: Student) {
    const count = lessonCountByStudent.get(student.id) ?? 0;
    const extra = count > 0 ? `\nTA 还有 ${count} 节排课，删除后这些课的学生名单里也会消失。` : "";
    if (!window.confirm(`删除「${student.name}」？${extra}`)) return;
    await api.students.remove(student.id);
    setOpenId((current) => (current === student.id ? null : current));
    await load();
  }

  return (
    <>
      <PageHeading
        title="学生"
        description="学生档案、报读科目、剩余课时与排课情况。"
      />

      <DataNotice onReset={load} />

      {/* 新增表单 */}
      {creating && (
        <Panel
          className="mt-6"
          title="新增学生"
          description="填好姓名与年级即可建档，其余字段可以以后再补。"
        >
          <StudentForm
            onCancel={() => setCreating(false)}
            onSaved={async () => {
              setCreating(false);
              await load();
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
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? "收起表单" : "新增学生"}
          </Button>
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
                            remaining <= 5
                              ? "tabular font-medium text-warning-600"
                              : "tabular text-ink-700"
                          }
                        >
                          {remaining} 节
                        </span>
                        <span className="ml-1.5 text-[11px] text-ink-400">
                          {student.enrollments.filter((item) => item.status === "在读").length} 门
                        </span>
                        {remaining <= 5 && student.status === "在读" && (
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
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === student.id ? null : student.id)}
                      className="text-xs text-brand-700 transition-colors hover:text-brand-800"
                    >
                      {editingId === student.id ? "收起" : "编辑"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(student)}
                      className="text-xs text-ink-500 transition-colors hover:text-danger-600"
                    >
                      删除
                    </button>
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
              await load();
            }}
          />
        </Panel>
      )}

      {/* 详情：排课与课时调整 */}
      {openId !== null && (
        <StudentDetail
          className="mt-6"
          studentId={openId}
          onChanged={load}
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
