"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { api } from "@/lib/backend/api";
import { CLASS_HOURS_PER_DAY, describeMinutes, describeRate } from "@/lib/backend/stats";
import { formatDayLabel, weekDays } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

type StatsData = Awaited<ReturnType<typeof api.stats>>;

/**
 * 统计。
 *
 * 三个数字要回答的是**决策问题**，不是「给老板看的报表」：
 *   - 教室利用率与空档：这间教室值不值？该加教室，还是把课挪到别的时段？
 *   - 教师课时：谁排满了、谁还空着？
 *   - 退课与流失：学生在什么阶段退、原因集中在哪里？
 */
export default function AdminStatsPage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setData(await api.stats(anchor));
    setLoading(false);
  }, [anchor]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = weekDays(anchor);
  const peak = data?.hourly.reduce(
    (max, row) => (row.count > (max?.count ?? 0) ? row : max),
    data.hourly[0],
  );

  return (
    <>
      <PageHeading
        title="统计"
        description="教室利用率与空档、教师课时分布、退课与流失。"
      />

      <DataNotice onRefresh={load} />

      {/* 周切换 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setAnchor(shiftWeeks(anchor, -1))}>
          ← 上一周
        </Button>
        <span className="text-sm text-ink-800">
          {formatDayLabel(days[0] ?? new Date())} – {formatDayLabel(days[6] ?? new Date())}
        </span>
        <Button size="sm" variant="outline" onClick={() => setAnchor(shiftWeeks(anchor, 1))}>
          下一周 →
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date())}>
          本周
        </Button>
        {loading && <span className="text-xs text-ink-400">加载中…</span>}
      </div>

      {/* 本周规模 */}
      <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="本周课次" value={`${data?.summary.lessonCount ?? 0} 节`} />
        <Stat label="课时总量" value={describeMinutes(data?.summary.minutes ?? 0)} />
        <Stat label="涉及学生" value={`${data?.summary.studentCount ?? 0} 人`} />
        <Stat label="上课教师" value={`${data?.summary.teacherCount ?? 0} 位`} />
        <Stat
          label="取消的课"
          value={`${data?.summary.cancelled ?? 0} 节`}
          tone={(data?.summary.cancelled ?? 0) > 0 ? "warning" : "normal"}
        />
      </dl>

      {/* 教室利用率 */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white">
        <header className="border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-medium text-ink-900">教室利用率</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            可用时长按教室自己的「可用时段」算；没设时段的按上课时间估算（每天{" "}
            {CLASS_HOURS_PER_DAY} 小时，即 8:00–22:00 —— 教室能不能用取决于能不能上课，
            而不是前台有没有人）。只统计未取消的课。
          </p>
        </header>

        <ul className="divide-y divide-ink-100">
          {(data?.rooms ?? []).map((room) => (
            <li key={room.classroom.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-sm font-medium text-ink-900">{room.classroom.name}</span>
                <span className="text-xs text-ink-500">{room.classroom.kind}</span>
                <span className="text-xs tabular text-ink-600">
                  {room.lessonCount} 节 · {describeMinutes(room.bookedMinutes)} / 可用{" "}
                  {describeMinutes(room.availableMinutes)}
                </span>
                <span
                  className={cn(
                    "ml-auto text-sm font-medium tabular",
                    room.rate >= 0.6
                      ? "text-warning-600"
                      : room.rate >= 0.3
                        ? "text-ink-800"
                        : "text-ink-400",
                  )}
                >
                  {describeRate(room.rate)}
                </span>
              </div>

              {/* 利用率条：比数字更容易一眼比较 */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  className={cn(
                    "h-full rounded-full",
                    room.rate >= 0.6 ? "bg-warning-500" : "bg-brand-500",
                  )}
                  style={{ width: `${Math.min(100, Math.round(room.rate * 100))}%` }}
                />
              </div>

              {room.idleDays.length > 0 && (
                <p className="mt-1.5 text-xs text-ink-400">
                  空档日：{room.idleDays.map((key) => formatDayLabel(new Date(`${key}T00:00:00`))).join("、")}
                </p>
              )}
            </li>
          ))}
          {!loading && (data?.rooms.length ?? 0) === 0 && (
            <li className="px-4 py-4 text-sm text-ink-500">还没有登记场地。</li>
          )}
        </ul>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        {/* 时段分布 */}
        <section className="rounded-lg border border-ink-200 bg-white">
          <header className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-medium text-ink-900">时段分布</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              {peak !== undefined
                ? `最忙的是 ${peak.hour}:00 前后（${peak.count} 节）—— 如果这个时段已经排满，加时段比加教室更有效。`
                : "本周还没有排课。"}
            </p>
          </header>
          <ul className="px-4 py-3">
            {(data?.hourly ?? []).map((row) => {
              const max = peak?.count ?? 1;
              return (
                <li key={row.hour} className="flex items-center gap-3 py-1">
                  <span className="w-12 shrink-0 text-xs tabular text-ink-500">{row.hour}:00</span>
                  <span className="h-3 flex-1 overflow-hidden rounded-sm bg-ink-50">
                    <span
                      className="block h-full rounded-sm bg-brand-400"
                      style={{ width: `${Math.max(4, Math.round((row.count / max) * 100))}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs tabular text-ink-600">
                    {row.count} 节
                  </span>
                </li>
              );
            })}
            {!loading && (data?.hourly.length ?? 0) === 0 && (
              <li className="py-4 text-sm text-ink-500">本周还没有排课。</li>
            )}
          </ul>
        </section>

        {/* 教师课时 */}
        <section className="rounded-lg border border-ink-200 bg-white">
          <header className="border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-medium text-ink-900">教师课时（本周）</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              用于看谁排满了、谁还空着；「平均人数」偏大说明这位老师以小班/大班为主。
            </p>
          </header>
          <ul className="divide-y divide-ink-100">
            {(data?.teachers ?? []).map((row) => (
              <li key={row.teacher.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm text-ink-800">{row.teacher.name}</span>
                  <span className="text-xs tabular text-ink-600">
                    {row.lessonCount} 节 · {describeMinutes(row.minutes)}
                  </span>
                  <span className="text-xs text-ink-500">
                    {row.studentCount} 名学生 · 平均 {row.avgStudents} 人/节
                  </span>
                </div>
                {row.bySubject.length > 0 && (
                  <p className="mt-1 text-xs text-ink-400">
                    {row.bySubject
                      .map((item) => `${item.subject} ${item.lessonCount} 节`)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
            {!loading && (data?.teachers.length ?? 0) === 0 && (
              <li className="px-4 py-4 text-sm text-ink-500">还没有教师档案。</li>
            )}
          </ul>
        </section>
      </div>

      {/* 退课与流失 */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white">
        <header className="border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-medium text-ink-900">退课与流失</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            关注「平均已上比例」：如果退课集中在学到两三成的时候，问题多半出在入门期，
            而不是快学完时。退课原因来自退课时填的备注。
          </p>
        </header>

        <dl className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="已退课报课" value={`${data?.churn.refundedCount ?? 0} 条`} />
          <Stat
            label="退课时平均已上"
            value={`${data?.churn.avgUsedLessons ?? 0} 节`}
            hint={`占购买的 ${Math.round((data?.churn.avgUsedRatio ?? 0) * 100)}%`}
          />
          <Stat label="退掉的剩余课时" value={`${data?.churn.refundedRemaining ?? 0} 节`} tone="warning" />
          <Stat label="暂停 / 结课学生" value={`${data?.churn.pausedOrFinished ?? 0} 人`} />
        </dl>

        <div className="grid gap-6 border-t border-ink-100 px-4 py-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-ink-600">按科目</h3>
            {(data?.churn.bySubject.length ?? 0) === 0 ? (
              <p className="mt-1.5 text-sm text-ink-500">还没有退课记录。</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {data?.churn.bySubject.map((row) => (
                  <li key={row.subject} className="flex justify-between text-xs text-ink-600">
                    <span>{row.subject}</span>
                    <span className="tabular">{row.count} 条</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-medium text-ink-600">按原因</h3>
            {(data?.churn.byReason.length ?? 0) === 0 ? (
              <p className="mt-1.5 text-sm text-ink-500">
                还没有填写原因。退课时在确认框里写一句原因，这里就能看到分布。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {data?.churn.byReason.map((row) => (
                  <li key={row.reason} className="flex justify-between gap-3 text-xs text-ink-600">
                    <span className="min-w-0 truncate">{row.reason}</span>
                    <span className="shrink-0 tabular">{row.count} 条</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </>
  );
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
        className={cn(
          "mt-1 text-xl font-medium tabular",
          tone === "warning" ? "text-warning-600" : "text-ink-900",
        )}
      >
        {value}
      </dd>
      {hint !== undefined && <dd className="mt-0.5 text-xs text-ink-400">{hint}</dd>}
    </div>
  );
}

function shiftWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}
