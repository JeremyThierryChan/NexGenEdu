"use client";

import { useCallback, useEffect, useState } from "react";
import { DataNotice } from "@/components/admin/DataNotice";
import { InquiryForm } from "@/components/admin/InquiryForm";
import { InquiryReport } from "@/components/admin/InquiryReport";
import { Panel } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { PageHeading } from "@/components/ui/PageHeading";
import { api, INQUIRY_STATUSES, type Inquiry, type InquiryStatus } from "@/lib/backend/api";
import { formatDayLabel } from "@/lib/backend/format";
import { cn } from "@/lib/utils/cn";

/**
 * 咨询。
 *
 * 家长打电话来问「每周六上午十点、能不能排」——这一页就是当场回答那个问题的工具：
 * 登记 → 判定 → 采用（或放弃），并且把线索留下来。
 *
 * 为什么值得单独一页：这类问答以前靠脑子记，事后要么翻聊天记录，
 * 要么干脆忘了答应过什么。
 */
export default function AdminInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"全部" | InquiryStatus>("待确认");

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时**不进加载态**，因此不会在"点一下就地动作"
   * 的同一瞬间把列表换成加载中、把页面高度塌掉 —— 页高一塌，浏览器就会把滚动位置夹回顶部
   * （§15.3 里那条真实反馈）。首屏（useEffect 里那一次）仍然用加载态：那时本来就没有内容可保。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet !== true) setLoading(true);
    setInquiries(await api.inquiries.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible =
    filter === "全部" ? inquiries : inquiries.filter((item) => item.status === filter);
  const selected = inquiries.find((item) => item.id === selectedId) ?? null;

  async function abandon(inquiry: Inquiry) {
    const reason = window.prompt(
      `放弃「${inquiry.studentName}」这条咨询？可以写一句原因（会记在备注里）：`,
      "",
    );
    if (reason === null) return;
    await api.inquiries.abandon(inquiry.id, reason);
    await load({ quiet: true });
  }

  async function remove(inquiry: Inquiry) {
    if (!window.confirm(`删除「${inquiry.studentName}」这条咨询记录？`)) return;
    await api.inquiries.remove(inquiry.id);
    if (selectedId === inquiry.id) setSelectedId("");
    await load({ quiet: true });
  }

  return (
    <>
      <PageHeading
        title="咨询"
        description="家长咨询登记与排课可行性：这个安排能不能接，不能的话最接近的方案是什么。"
      />

      <DataNotice
        onRefresh={async () => {
          // 安静刷新（见 load 的说明）
          await load({ quiet: true });
        }}
      />

      {creating && (
        <Panel
          className="mt-6"
          title="登记咨询"
          description="把家长说的填进来，点「登记并判定可行性」就会算出每个候选时段能不能排下整串课。"
        >
          <InquiryForm
            onCancel={() => setCreating(false)}
            onCreated={async (id) => {
              setCreating(false);
              setSelectedId(id);
              setFilter("全部");
              await load({ quiet: true });
            }}
          />
        </Panel>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["全部", ...INQUIRY_STATUSES] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm transition-colors",
                filter === status
                  ? "bg-brand-50 font-medium text-brand-700"
                  : "text-ink-600 hover:bg-ink-100",
              )}
            >
              {status}
              {status !== "全部" && (
                <span className="ml-1 text-xs text-ink-400">
                  {inquiries.filter((item) => item.status === status).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-500">
          {loading ? "加载中…" : `${visible.length} / ${inquiries.length} 条`}
        </span>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating((value) => !value)}>
            {creating ? "收起表单" : "登记咨询"}
          </Button>
        </div>
      </div>

      {/* 线索列表 */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200 bg-white">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-2.5 font-medium">学生</th>
              <th className="px-4 py-2.5 font-medium">科目</th>
              <th className="px-4 py-2.5 font-medium">安排</th>
              <th className="px-4 py-2.5 font-medium">候选时段</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((inquiry) => (
              <tr key={inquiry.id} className="border-b border-ink-50 last:border-0">
                <td className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedId(selectedId === inquiry.id ? "" : inquiry.id)}
                    className="text-left font-medium text-ink-900 transition-colors hover:text-brand-700"
                  >
                    {inquiry.studentName}
                    {inquiry.grade !== "" && (
                      <span className="ml-1.5 text-xs font-normal text-ink-400">{inquiry.grade}</span>
                    )}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-ink-700">{inquiry.subject}</td>
                <td className="px-4 py-2.5 text-xs text-ink-600">
                  {inquiry.intervalWeeks === 1 ? "每周一次" : "每两周一次"} ·{" "}
                  {inquiry.durationMinutes} 分钟 · {inquiry.plannedLessons} 节
                </td>
                <td className="px-4 py-2.5 text-xs text-ink-600">
                  {inquiry.candidates.length} 个（{inquiry.candidates
                    .map((slot) => slot.start)
                    .join(" / ")}）
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={inquiry.status} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    {inquiry.status === "待确认" && (
                      <button
                        type="button"
                        onClick={() => void abandon(inquiry)}
                        className="text-xs text-ink-500 transition-colors hover:text-warning-600"
                      >
                        放弃
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void remove(inquiry)}
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
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                  {inquiries.length === 0
                    ? "还没有咨询记录，点右上角「登记咨询」。"
                    : `没有「${filter}」状态的咨询。`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 选中一条：可行性报告 */}
      {selected !== null && (
        <Panel
          className="mt-4"
          title={`${selected.studentName} · ${selected.subject}`}
          description={`登记于 ${formatDayLabel(selected.createdAt)}${
            selected.note !== "" ? ` · ${selected.note}` : ""
          }`}
          actions={
            selected.status === "已安排" ? (
              <span className="text-xs text-success-600">
                已安排 {selected.scheduledLessonIds.length} 节课
              </span>
            ) : undefined
          }
        >
          <InquiryReport inquiry={selected} onChanged={() => void load({ quiet: true })} />
        </Panel>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: InquiryStatus }) {
  const tone =
    status === "已安排"
      ? "border-success-100 bg-success-50 text-success-600"
      : status === "已放弃"
        ? "border-ink-200 bg-ink-50 text-ink-500"
        : "border-brand-100 bg-brand-50 text-brand-700";
  return <span className={cn("rounded-sm border px-1.5 py-0.5 text-[11px]", tone)}>{status}</span>;
}
