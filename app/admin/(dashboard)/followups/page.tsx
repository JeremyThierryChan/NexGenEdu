"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { api, type FollowUpItem } from "@/lib/backend/api";
import { FOLLOWUP_RULES, followUpsToText, summarizeFollowUps } from "@/lib/backend/followup";
import { cn } from "@/lib/utils/cn";

/**
 * 待跟进。
 *
 * 这些信号本来就躺在数据里（课时、欠费、作业、测评、出勤），但要靠人一样样去翻，
 * 结果通常是「想起来才看」。这一页的价值是**不用想**：打开就是今天该联系谁。
 *
 * 每条都带一段可直接复制的话术草稿 —— 但刻意是「草稿」：
 * 里面填好了具体数字，发之前请自己看一遍，别让家长收到机器味的话。
 */
export default function AdminFollowUpsPage() {
  const [items, setItems] = useState<FollowUpItem[] | null>(null);
  const [filter, setFilter] = useState<string>("全部");
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setItems(await api.followups());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeFollowUps(items ?? []), [items]);
  const kinds = ["全部", ...summary.map((row) => row.kind)];
  const visible = useMemo(
    () => (items ?? []).filter((item) => filter === "全部" || item.kind === filter),
    [filter, items],
  );

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      // 剪贴板不可用（http 或权限被拒）时退化为「选中让人手动复制」
      window.prompt("复制下面的内容：", text);
    }
  }

  const urgent = (items ?? []).filter((item) => item.severity === "紧急").length;

  return (
    <>
      <PageHeading
        title="待跟进"
        description="需要主动联系家长的学生：课时、欠费、作业、测评、出勤与排课。"
      />

      <DataNotice onReset={load} />

      {/* 概览 */}
      <dl className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
          <dt className="text-xs text-ink-500">需要跟进的学生</dt>
          <dd className="mt-1 text-xl font-medium tabular text-ink-900">
            {loading ? "…" : new Set((items ?? []).map((item) => item.studentId)).size}
          </dd>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
          <dt className="text-xs text-ink-500">待办条数</dt>
          <dd className="mt-1 text-xl font-medium tabular text-ink-900">
            {loading ? "…" : (items ?? []).length}
          </dd>
        </div>
        <div className="rounded-lg border border-warning-100 bg-warning-50 px-4 py-3">
          <dt className="text-xs text-warning-600">其中紧急（欠费 / 课时见底）</dt>
          <dd className="mt-1 text-xl font-medium tabular text-warning-600">
            {loading ? "…" : urgent}
          </dd>
        </div>
        <div className="rounded-lg border border-ink-200 bg-white px-4 py-3">
          <dt className="text-xs text-ink-500">规则阈值</dt>
          <dd className="mt-1 text-xs leading-relaxed text-ink-500">
            课时 ≤ {FOLLOWUP_RULES.lowLessons} 节提醒、≤ {FOLLOWUP_RULES.lowLessonsUrgent} 节紧急；
            未来 {FOLLOWUP_RULES.staleLessonDays} 天无课算久未排课
          </dd>
        </div>
      </dl>

      {/* 筛选 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {kinds.map((kind) => {
          const row = summary.find((item) => item.kind === kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setFilter(kind)}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                filter === kind
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-ink-600 hover:bg-ink-100",
              )}
            >
              {kind}
              {row !== undefined && <span className="ml-1 text-xs text-ink-400">{row.count}</span>}
            </button>
          );
        })}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={visible.length === 0}
            onClick={() => void copy(followUpsToText(visible), "all")}
          >
            {copied === "all" ? "已复制" : "复制整份清单"}
          </Button>
        </div>
      </div>

      {/* 清单 */}
      <div className="mt-4 space-y-3">
        {visible.map((item) => (
          <article
            key={`${item.studentId}-${item.kind}`}
            className={cn(
              "rounded-lg border bg-white p-4",
              item.severity === "紧急" ? "border-warning-200" : "border-ink-200",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <SeverityBadge severity={item.severity} />
              <span className="text-sm font-medium text-ink-900">{item.studentName}</span>
              <span className="text-xs text-ink-500">{item.kind}</span>
              <span className="min-w-0 flex-1 text-xs text-ink-600">{item.reason}</span>
              <button
                type="button"
                onClick={() => void copy(item.message, `${item.studentId}-${item.kind}`)}
                className="shrink-0 rounded-md border border-ink-300 px-2.5 py-1 text-xs text-ink-700 transition-colors hover:border-brand-400 hover:text-brand-700"
              >
                {copied === `${item.studentId}-${item.kind}` ? "已复制" : "复制话术"}
              </button>
            </div>

            <p className="mt-2 text-xs text-ink-500">建议：{item.action}</p>

            {/* 话术草稿：只读展示，方便先看一遍再复制 */}
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-ink-50 px-3 py-2 text-sm leading-relaxed text-ink-700">
              {item.message}
            </p>
          </article>
        ))}

        {!loading && visible.length === 0 && (
          <p className="rounded-lg border border-ink-200 bg-white px-4 py-8 text-center text-sm text-ink-500">
            {filter === "全部" ? "没有需要跟进的学生。" : `没有「${filter}」类的待办。`}
          </p>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-400">
        话术是按数据自动生成的草稿：数字已经填好，但发之前请自己看一遍。
        规则与阈值集中在
        <code className="mx-1 rounded bg-ink-100 px-1">lib/backend/followup.ts</code>
        的 FOLLOWUP_RULES，觉得太松或太紧改那一处即可。
      </p>
    </>
  );
}

function SeverityBadge({ severity }: { severity: FollowUpItem["severity"] }) {
  const tone =
    severity === "紧急"
      ? "border-warning-200 bg-warning-50 text-warning-600"
      : severity === "提醒"
        ? "border-brand-100 bg-brand-50 text-brand-700"
        : "border-ink-200 bg-ink-50 text-ink-600";
  return (
    <span className={cn("shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px]", tone)}>
      {severity}
    </span>
  );
}
