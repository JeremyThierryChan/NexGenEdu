"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DataNotice } from "@/components/admin/DataNotice";
import {
  buildDayTimeline,
  formatGapDuration,
  gapText,
  totalGapMinutes,
} from "@/lib/backend/timetable";
import { getClassHoursWindow } from "@/lib/backend/options";
import { PageHeading } from "@/components/ui/PageHeading";
import { FOLLOWUP_RULES } from "@/lib/backend/followup";
import { LoadFailure } from "@/components/admin/LoadFailure";
import {
  api,
  type Classroom,
  type Lesson,
  type Student,
  type Teacher,
  type TodaySummary,
} from "@/lib/backend/api";

/**
 * 今日概览。
 *
 * 回答后台的第一组问题（「10 秒内知道今天谁上课、在哪上课、老师是谁、还剩多少课时」）：
 *   1. 今天有哪些课（时间 / 科目 / 班型 / 教师 / 教室 / 学生）
 *   2. 每个教室今天排了几节
 *   3. 哪些学生课时不足
 *   4. 档案规模（学生 / 在职教师）
 *
 * 数据来自伪后端服务（lib/backend/api.ts），因此这里是客户端组件：
 * 先渲染加载态，挂载后再取数。
 */
/** 空档计算选项：窗口取自站点内容的「上课时间」（课前 / 课后两段按它算）。 */
const GAP_OPTIONS = { window: getClassHoursWindow() };

export default function AdminTodayPage() {
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * 读不出来时的原因（审计抓到的那条：这里原先没有 try/catch ——
   * 后端没开 / 登录过期 / 权限不足时 setLoading(false) 永远走不到，界面就停在「加载中…」）。
   */
  const [loadError, setLoadError] = useState("");

  /**
   * 读数据（今日概览）。
   *
   * `quiet: true` = **安静刷新**：页面上已经有内容时**不进加载态**，因此不会在动作发生的
   * 同一瞬间把页面高度塌掉 —— 「今日课程」「课时预警」这两块都是 `loading ? '加载中…' : 列表`，
   * 刷新时若切进加载态，整块会从很高塌成一行，浏览器随即把滚动位置夹回顶部（§15.3，真实反馈）。
   * 首屏（useEffect 里那一次）仍然用加载态 —— 那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    try {
      const [today, todayLessons, teacherList, studentList, classroomList] = await Promise.all([
        api.today(),
        api.lessons.listByDate(new Date()),
        api.teachers.list(),
        api.students.list(),
        api.classrooms.list(),
      ]);
      setSummary(today);
      setLessons(todayLessons);
      setTeachers(teacherList);
      setStudents(studentList);
      setClassrooms(classroomList);
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

  const teacherName = (id: string) => teachers.find((item) => item.id === id)?.name ?? "—";
  const classroomName = (id: string) =>
    classrooms.find((item) => item.id === id)?.name ?? "—";
  const studentNames = (ids: string[]) =>
    ids.map((id) => students.find((item) => item.id === id)?.name ?? "—").join("、");

  const hours = Math.round(((summary?.totalMinutes ?? 0) / 60) * 10) / 10;

  return (
    <>
      <PageHeading
        title="今日概览"
        description="今天有哪些课程、各教室是否空闲、哪些学生课时不足。"
      />

      <DataNotice
        onRefresh={async () => {
          // 安静刷新：手动刷新同样不该把「今日课程」「课时预警」两块塌成一行（见 load 的说明）
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

      {/* 四个数字，一眼看到规模 */}
      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="今日课程"
          value={loading ? "…" : `${summary?.lessonCount ?? 0} 节`}
          hint={`合计 ${hours} 小时`}
        />
        <Stat
          label="今日授课教师"
          value={loading ? "…" : `${summary?.teacherCount ?? 0} 位`}
          hint={`在职 ${summary?.activeTeacherCount ?? 0} 位`}
        />
        <Stat
          label="学生档案"
          value={loading ? "…" : `${summary?.studentCount ?? 0} 人`}
          hint="含暂停 / 结课"
        />
        <Stat
          label="课时预警"
          value={loading ? "…" : `${summary?.lowLessonStudents.length ?? 0} 人`}
          hint={`剩余 ≤ ${FOLLOWUP_RULES.lowLessons} 节（最少的那一门）`}
          tone={(summary?.lowLessonStudents.length ?? 0) > 0 ? "warning" : "normal"}
        />
      </dl>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        {/* 今日课程 */}
        <section className="rounded-lg border border-ink-200 bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-medium text-ink-900">
              今日课程
              {lessons.length > 0 && (
                <span className="ml-2 text-xs font-normal text-ink-500">
                  {lessons.length} 节
                  {totalGapMinutes(lessons, GAP_OPTIONS) > 0 &&
                    ` · 空 ${formatGapDuration(totalGapMinutes(lessons, GAP_OPTIONS))}`}
                </span>
              )}
            </h2>
            <Link
              href="/admin/lessons"
              className="text-xs text-brand-700 transition-colors hover:text-brand-800"
            >
              课程安排 →
            </Link>
          </header>

          {loading ? (
            <p className="px-4 py-8 text-sm text-ink-400">加载中…</p>
          ) : lessons.length === 0 ? (
            <p className="px-4 py-8 text-sm text-ink-500">
              今天没有排课，可以到
              <Link
                href="/admin/lessons"
                className="mx-1 text-brand-700 transition-colors hover:text-brand-800"
              >
                课程安排
              </Link>
              里添加。
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {buildDayTimeline(lessons, GAP_OPTIONS).map((item) =>
                item.kind === "gap" ? (
                  /*
                   * 空档：今天没人上课的时间段（课前 / 课间 / 课后）。
                   * 它决定了「还能不能接一个新学生、安排一节补课」，
                   * 因此和课程一样列在这里 —— 今天的空闲时间也是一种资源。
                   */
                  <li
                    key={`gap-${item.gap.kind}-${item.gap.startMinutes}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-ink-50/60 px-4 py-2"
                  >
                    <span className="w-24 font-mono text-xs tabular text-ink-400">
                      {item.gap.rangeLabel}
                    </span>
                    <span className="text-xs text-ink-500">{gapText(item.gap)}</span>
                  </li>
                ) : (
                  <li
                    key={item.lesson.id}
                    className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <span className="w-24 font-mono text-sm tabular text-ink-900">
                      {timeRange(item.lesson.startsAt, item.lesson.durationMinutes)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-ink-900">
                        {item.lesson.subject}
                      </span>
                      <span className="ml-2 text-xs text-ink-500">{item.lesson.form}</span>
                      <span className="mt-1 block text-xs text-ink-500">
                        {teacherName(item.lesson.teacherId)} ·{" "}
                        {classroomName(item.lesson.classroomId)} ·{" "}
                        {studentNames(item.lesson.studentIds)}
                      </span>
                    </span>
                    <StatusTag status={item.lesson.status} />
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* 教室占用 */}
          <section className="rounded-lg border border-ink-200 bg-white">
            <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
              教室今天的排课
            </h2>
            <ul className="divide-y divide-ink-100">
              {(summary?.classroomUsage ?? []).map(({ classroom, lessonCount }) => (
                <li key={classroom.id} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-ink-800">
                    {classroom.name}
                    <span className="ml-2 text-xs text-ink-400">{classroom.capacity} 人</span>
                  </span>
                  <span className="text-sm tabular text-ink-600">{lessonCount} 节</span>
                </li>
              ))}
              {!loading && (summary?.classroomUsage.length ?? 0) === 0 && (
                <li className="px-4 py-3 text-sm text-ink-500">还没有登记教室。</li>
              )}
            </ul>
          </section>

          {/* 课时预警 */}
          <section className="rounded-lg border border-ink-200 bg-white">
            <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
              课时预警
            </h2>
            {(summary?.lowLessonStudents.length ?? 0) === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">
                {loading ? "加载中…" : "没有课时不足的学生。"}
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {summary?.lowLessonStudents.map(({ student, remainingLessons }) => (
                  <li key={student.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-800">{student.name}</span>
                      <span className="text-xs text-ink-400">
                        {student.grade} · {student.guardian}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular text-warning-600">
                      剩 {remainingLessons} 节
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function timeRange(startsAt: string, durationMinutes: number): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const format = (date: Date) =>
    `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
  return `${format(start)}–${format(end)}`;
}

function Stat({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "normal" | "warning";
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd
        className={
          tone === "warning"
            ? "mt-1 text-xl font-medium tabular text-warning-600"
            : "mt-1 text-xl font-medium tabular text-ink-900"
        }
      >
        {value}
      </dd>
      {hint !== undefined && <dd className="mt-0.5 text-xs text-ink-400">{hint}</dd>}
    </div>
  );
}

function StatusTag({ status }: { status: Lesson["status"] }) {
  const tone =
    status === "已上"
      ? "border-success-100 bg-success-50 text-success-600"
      : status === "已取消"
        ? "border-ink-200 bg-ink-50 text-ink-500"
        : "border-brand-100 bg-brand-50 text-brand-700";
  return (
    <span className={`shrink-0 self-start rounded-sm border px-1.5 py-0.5 text-[11px] ${tone}`}>
      {status}
    </span>
  );
}
