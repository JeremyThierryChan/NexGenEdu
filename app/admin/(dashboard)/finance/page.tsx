"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { api, type Payment, type Student } from "@/lib/backend/api";
import { REFUND_POLICIES, formatMoney } from "@/lib/backend/finance";
import { formatDayLabel } from "@/lib/backend/format";
import { LoadFailure } from "@/components/admin/LoadFailure";

/**
 * 收费。
 *
 * 回答三个问题：
 *   1. **这个月收了多少**（收款 / 退款 / 净额，按支付方式拆开）；
 *   2. **谁还欠着钱**（欠费清单，按金额排序）；
 *   3. **退课要退多少**（每种退费口径算出多少，写清公式 —— 免得解释不清）。
 *
 * 欠费刻意**不按月切分**：它是一笔「还没收到的钱」，跨月存在，
 * 按月切会让 1 月欠的费在 2 月的报表里凭空消失。
 */
export default function AdminFinancePage() {
  const [month, setMonth] = useState(() => new Date());
  const [data, setData] = useState<Awaited<ReturnType<typeof api.finance>> | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  /** 读不出来时的原因（原先没有 try/catch：读失败会停在「加载中…」，什么都不说）。 */
  const [loadError, setLoadError] = useState("");

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
      const [finance, studentList] = await Promise.all([api.finance(month), api.students.list()]);
      setData(finance);
      setStudents(studentList);
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
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const studentName = (id: string) => students.find((item) => item.id === id)?.name ?? "—";

  return (
    <>
      <PageHeading
        title="收费"
        description="本月收入、收款流水、欠费清单与退费口径。"
      />

      <DataNotice
        onRefresh={async () => {
          // 安静刷新：收款流水与欠费清单一直挂着，刷新不该把它们塌成一行（见 load 的说明）
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

      {/* 月份切换 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(month, -1))}>
          ← 上个月
        </Button>
        <span className="text-sm text-ink-800">{data?.month ?? "…"}</span>
        <Button size="sm" variant="outline" onClick={() => setMonth(shiftMonth(month, 1))}>
          下个月 →
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMonth(new Date())}>
          回到本月
        </Button>
        {loading && <span className="text-xs text-ink-400">加载中…</span>}
      </div>

      {/* 收入概览 */}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="本月收款" value={formatMoney(data?.summary.received ?? 0)} tone="success" />
        <Stat label="本月退款" value={formatMoney(data?.summary.refunded ?? 0)} tone="danger" />
        <Stat label="本月净收入" value={formatMoney(data?.summary.net ?? 0)} />
        <Stat label="欠费合计" value={formatMoney(data?.outstandingTotal ?? 0)} tone="warning" />
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* 收款流水 */}
        <section className="rounded-lg border border-ink-200 bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-medium text-ink-900">
              收款流水（{data?.summary.count ?? 0} 笔）
            </h2>
            <span className="text-xs text-ink-500">
              本月净额 {formatMoney(data?.summary.net ?? 0)}
            </span>
          </header>

          {data === null || data.recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-500">
              {loading ? "加载中…" : "本月还没有收款记录。收款在「学生 → 报课与课时」里记录。"}
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.recent.map((payment: Payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="w-24 text-xs text-ink-500">{formatDayLabel(payment.at)}</span>
                  <Link
                    href="/admin/students"
                    className="text-sm text-ink-800 transition-colors hover:text-brand-700"
                  >
                    {studentName(payment.studentId)}
                  </Link>
                  <span
                    className={
                      payment.kind === "退款"
                        ? "text-sm tabular text-danger-600"
                        : "text-sm tabular text-success-600"
                    }
                  >
                    {payment.kind === "退款" ? "-" : "+"}
                    {formatMoney(payment.amount)}
                  </span>
                  <span className="text-xs text-ink-500">{payment.method}</span>
                  {payment.note !== "" && (
                    <span className="text-xs text-ink-400">{payment.note}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* 按支付方式 */}
          <section className="rounded-lg border border-ink-200 bg-white">
            <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
              按收款方式
            </h2>
            {data === null || data.summary.byMethod.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">本月无收款。</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.summary.byMethod.map((row) => (
                  <li key={row.method} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-ink-800">{row.method}</span>
                    <span className="text-sm tabular text-ink-600">
                      {formatMoney(row.amount)}
                      <span className="ml-2 text-xs text-ink-400">{row.count} 笔</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 欠费清单 */}
          <section className="rounded-lg border border-ink-200 bg-white">
            <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
              欠费清单（{data?.outstanding.length ?? 0} 条）
            </h2>
            {data === null || data.outstanding.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">
                {loading ? "加载中…" : "没有欠费。"}
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.outstanding.map((row) => (
                  <li key={row.enrollment.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink-800">
                        {row.student.name}
                      </span>
                      <span className="text-xs text-ink-400">{row.enrollment.subject}</span>
                    </span>
                    <span className="shrink-0 text-sm tabular text-warning-600">
                      {formatMoney(row.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* 退费口径说明 */}
      <section className="mt-6 rounded-lg border border-ink-200 bg-white">
        <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-medium text-ink-900">
          退费口径
        </h2>
        <div className="px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-500">
            退课时会按选定的口径算出应退金额并写明公式；两种口径的结果通常不同，
            确认前能先看到数字。要换成你们的实际规则，改
            <code className="mx-1 rounded bg-ink-100 px-1">lib/backend/finance.ts</code>
            里的策略即可，服务层与界面都从那一处取。
          </p>
          <ul className="mt-3 space-y-3">
            {REFUND_POLICIES.map((policy) => (
              <li key={policy.id} className="rounded-md border border-ink-100 px-3 py-2">
                <p className="text-sm text-ink-800">{policy.name}</p>
                <p className="mt-0.5 text-xs text-ink-500">{policy.description}</p>
                <p className="mt-1 font-mono text-[11px] text-ink-400">
                  {/*
                    示例里的"实收"刻意与"约定"不同（1800 约定、1600 实收）：
                    退费按**实收**算 —— 欠着钱的报课退课时，不能退出没收到过的钱。
                  */}
                  示例：报课 10 节、单价 ¥200、约定 ¥1800、实收 ¥1600、已上 3 节 → 退{" "}
                  {formatMoney(
                    policy.calculate({
                      totalLessons: 10,
                      usedLessons: 3,
                      agreedAmount: 1800,
                      paidAmount: 1600,
                      unitPrice: 200,
                    }).refund,
                  )}
                  （
                  {
                    policy.calculate({
                      totalLessons: 10,
                      usedLessons: 3,
                      agreedAmount: 1800,
                      paidAmount: 1600,
                      unitPrice: 200,
                    }).formula
                  }
                  ）
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "success" | "danger" | "warning";
}) {
  const toneClass = {
    normal: "text-ink-900",
    success: "text-success-600",
    danger: "text-danger-600",
    warning: "text-warning-600",
  }[tone];

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className={`mt-1 text-xl font-medium tabular ${toneClass}`}>{value}</dd>
    </div>
  );
}

function shiftMonth(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}
