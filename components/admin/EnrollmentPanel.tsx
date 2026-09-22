"use client";

import { useEffect, useMemo, useState } from "react";
import { TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import {
  type EnrollmentEdit,
  type EnrollmentEditResult,
  type EnrollmentEditScope,
  PAYMENT_METHODS,
  api,
  type Enrollment,
  type LessonTransaction,
  type Payment,
  type PaymentMethod,
  type Student,
  type Teacher,
} from "@/lib/backend/api";
import {
  DEFAULT_REFUND_POLICY_ID,
  REFUND_POLICIES,
  calculateRefund,
  discountAmount,
  formatMoney,
  outstandingAmount,
} from "@/lib/backend/finance";
import { cn } from "@/lib/utils/cn";
import { remainingOf, remainingTotal } from "@/lib/backend/enrollment";
import { formatDayLabel } from "@/lib/backend/format";
import { getFormOptions } from "@/lib/backend/options";
import { useSubjectOptions } from "@/components/admin/useSubjectOptions";

/**
 * 报课与课时面板。
 *
 * 课时是**按科目**记账的（一门课一条报课记录），因此这里的三个动作对应三种真实业务：
 *   - **报课**：新开一条记录（科目 / 班型 / 课时 / 教师 / 日期）；
 *   - **续费**：给已有记录累加课时（会留下流水，家长对账时有据可查）；
 *   - **退课**：把记录标为已退课并记下日期 —— **不删除**，否则课时去向说不清。
 *
 * 上课扣课时不在这里：那发生在「课程安排」页的「标记已上」，
 * 扣哪一条由上课的科目决定（见 lib/backend/enrollment.ts）。
 */
export function EnrollmentPanel({
  student,
  teachers,
  onChanged,
}: {
  student: Student;
  teachers: Teacher[];
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<LessonTransaction[]>([]);
  const [paymentsByEnrollment, setPaymentsByEnrollment] = useState<Payment[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.transactions.listByStudent(student.id),
      /*
       * 收款记录**单独兜住失败**（Phase B 的行级范围）：
       * 普通教师看得到自己学生的课时流水，但**看不到钱** —— 服务端对
       * `payments.*` 一律回 403。如果让这一条把 `Promise.all` 带崩，
       * 教师连**课时流水**（他本该看得见的那部分）都显示不出来了，
       * 而且 `useEffect` 里的失败没人接住，界面会出现未处理的报错。
       *
       * 因此这里的语义是"钱这一块你本来就不该看到，那就当作没有收款记录"：
       * 教师看到的是空的收款区（金额字段服务端也已经剥成 0），
       * 而技术 / 财务 / 招生账号走的是同一条成功路径，行为与以前完全一样。
       */
      api.payments.listByStudent(student.id).catch(() => [] as Payment[]),
    ]).then(([rows, payments]) => {
      if (cancelled) return;
      setTransactions(rows);
      setPaymentsByEnrollment(payments);
    });
    return () => {
      cancelled = true;
    };
  }, [student.id, student.enrollments]);

  const total = remainingTotal(student.enrollments);
  const owed = student.enrollments
    .filter((item) => item.status === "在读")
    .reduce((sum, item) => sum + outstandingAmount(item), 0);
  const active = student.enrollments.filter((item) => item.status === "在读");
  // 科目候选来自课程库（网站课程 + 机构自己加的课），见 useSubjectOptions
  const { names: subjectOptions } = useSubjectOptions();
  const formOptions = useMemo(() => getFormOptions(), []);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    await action();
    setPending(false);
    await onChanged();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="text-sm text-ink-600">
          {owed > 0 && (
            <span className="mr-3 rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-xs text-warning-600">
              欠费 {formatMoney(owed)}
            </span>
          )}
          剩余课时合计{" "}
          <span className={total <= 5 ? "font-medium tabular text-warning-600" : "font-medium tabular text-ink-900"}>
            {total}
          </span>{" "}
          节
          <span className="ml-2 text-xs text-ink-400">
            在读 {active.length} 门 / 全部 {student.enrollments.length} 门
          </span>
        </p>
        <Button size="sm" onClick={() => setAdding((value) => !value)}>
          {adding ? "收起" : "报课"}
        </Button>
      </div>

      {adding && (
        <div className="border-b border-ink-100 bg-ink-50/60">
          <EnrollForm
            subjectOptions={subjectOptions}
            formOptions={formOptions}
            teachers={teachers}
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await run(() => api.students.enroll(student.id, input));
              setAdding(false);
            }}
            pending={pending}
          />
        </div>
      )}

      {student.enrollments.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-500">
          还没有报课记录。点右上角「报课」记录科目与课时，之后上课时才能扣课时。
        </p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {student.enrollments.map((enrollment) => (
            <EnrollmentRow
              key={enrollment.id}
              enrollment={enrollment}
              teacherName={teachers.find((t) => t.id === enrollment.teacherId)?.name ?? ""}
              expanded={expandedId === enrollment.id}
              onToggle={() => setExpandedId(expandedId === enrollment.id ? null : enrollment.id)}
              pending={pending}
              transactions={transactions.filter((item) => item.enrollmentId === enrollment.id)}
              payments={paymentsByEnrollment.filter((item) => item.enrollmentId === enrollment.id)}
              onRenew={(lessons, amount, method) =>
                run(() =>
                  api.students.renewEnrollment(student.id, enrollment.id, lessons, "续费", {
                    amount,
                    method,
                  }),
                )
              }
              onRecordPayment={(amount, kind, method, note) =>
                run(() =>
                  api.payments.record({
                    studentId: student.id,
                    enrollmentId: enrollment.id,
                    amount,
                    kind,
                    method,
                    note,
                  }),
                )
              }
              onRefund={(refundAmount, method, policyId) =>
                run(() =>
                  api.students.refundEnrollment(student.id, enrollment.id, "退课", {
                    amount: refundAmount,
                    method,
                    policyName: REFUND_POLICIES.find((item) => item.id === policyId)?.name ?? "",
                  }),
                )
              }
              teachers={teachers}
              formOptions={formOptions}
              onEdit={async (patch, scope) => {
                const result = await api.students.updateEnrollment(
                  student.id,
                  enrollment.id,
                  patch,
                  scope,
                );
                await onChanged();
                return result;
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 一条报课记录。 */
function EnrollmentRow({
  enrollment,
  teacherName,
  expanded,
  onToggle,
  pending,
  transactions,
  payments,
  onRenew,
  onRecordPayment,
  onRefund,
  onEdit,
  teachers,
  formOptions,
}: {
  enrollment: Enrollment;
  teacherName: string;
  expanded: boolean;
  onToggle: () => void;
  pending: boolean;
  /** 这条报课的课时流水（含上课扣减与撤销记录）。 */
  transactions: LessonTransaction[];
  /** 这条报课的收款 / 退款流水。 */
  payments: Payment[];
  onRenew: (lessons: number, amount: number, method: PaymentMethod) => void | Promise<void>;
  onRecordPayment: (
    amount: number,
    kind: Payment["kind"],
    method: PaymentMethod,
    note: string,
  ) => void | Promise<void>;
  onRefund: (refundAmount: number, method: PaymentMethod, policyId: string) => void | Promise<void>;
  /** 改报课：返回结果（顺带改了几节、跳过了哪几节），由行内直接显示。 */
  onEdit: (patch: EnrollmentEdit, scope: EnrollmentEditScope) => Promise<EnrollmentEditResult>;
  /** 改报课表单要用的候选：教师与班型。 */
  teachers: Teacher[];
  formOptions: string[];
}) {
  const remaining = remainingOf(enrollment);
  const refunded = enrollment.status === "已退课";
  const [panel, setPanel] = useState<"renew" | "pay" | "refund" | "edit" | null>(null);
  const [editResult, setEditResult] = useState<EnrollmentEditResult | null>(null);
  const [policyId, setPolicyId] = useState(DEFAULT_REFUND_POLICY_ID);
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("微信");
  const [renewLessons, setRenewLessons] = useState("10");

  const refundPreview = calculateRefund(enrollment, policyId);
  const moneyFields = (defaultAmount: number) => (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        value={amountInput === "" ? `${Math.round(defaultAmount)}` : amountInput}
        onChange={(event) => setAmountInput(event.target.value)}
        className="w-24 rounded-md border border-ink-300 px-2 py-1 text-xs tabular outline-none focus:border-brand-500"
      />
      <select
        value={method}
        onChange={(event) => setMethod(event.target.value as PaymentMethod)}
        className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
      >
        {PAYMENT_METHODS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </span>
  );

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="text-left text-sm font-medium text-ink-900 transition-colors hover:text-brand-700"
        >
          {enrollment.subject !== "" ? enrollment.subject : "未指定科目"}
          <span className="ml-1.5 text-xs text-ink-400">{expanded ? "▲" : "▼"}</span>
        </button>

        {enrollment.form !== "" && (
          <span className="text-xs text-ink-500">{enrollment.form}</span>
        )}
        {teacherName !== "" && <span className="text-xs text-ink-500">{teacherName}</span>}

        <span className={refunded ? "text-xs text-ink-400" : "text-xs text-ink-600"}>
          已购 {enrollment.totalLessons} · 已上 {enrollment.usedLessons} ·
          <span className={refunded ? "ml-1" : remaining <= 5 ? "ml-1 font-medium text-warning-600" : "ml-1"}>
            剩 {remaining}
          </span>
        </span>
        {enrollment.agreedAmount > 0 && (
          <span className="text-xs text-ink-500">
            实收 {formatMoney(enrollment.paidAmount)} / 约定 {formatMoney(enrollment.agreedAmount)}
            {outstandingAmount(enrollment) > 0 && (
              <span className="ml-1 text-warning-600">
                欠 {formatMoney(outstandingAmount(enrollment))}
              </span>
            )}
          </span>
        )}

        {refunded ? (
          <span className="rounded-sm border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">
            已退课
          </span>
        ) : (
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setPanel(panel === "edit" ? null : "edit")}
              className="text-xs text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-60"
            >
              改报课
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setPanel(panel === "renew" ? null : "renew")}
              className="text-xs text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-60"
            >
              续费
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setPanel(panel === "pay" ? null : "pay")}
              className="text-xs text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-60"
            >
              记收款 / 退款
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setPanel(panel === "refund" ? null : "refund")}
              className="text-xs text-ink-500 transition-colors hover:text-danger-600 disabled:opacity-60"
            >
              退课
            </button>
          </span>
        )}
      </div>

      {/* 改报课：像手机日历那样选范围（这条 / 这条及以后），过去的永不改 */}
      {panel === "edit" && !refunded && (
        <EnrollEditForm
          enrollment={enrollment}
          teachers={teachers}
          formOptions={formOptions}
          pending={pending}
          onCancel={() => setPanel(null)}
          onSubmit={async (patch, scope) => {
            const result = await onEdit(patch, scope);
            setEditResult(result);
            setPanel(null);
          }}
        />
      )}

      {/* 上一次「改报课」的结果：改了哪几节、跳过了哪几节、有几节是过去的 */}
      {editResult !== null && panel !== "edit" && (
        <div className="mt-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-600">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink-700">已改报课</span>
            <span>{editResult.changes.join("；") || "（没有改动）"}</span>
            <button
              type="button"
              onClick={() => setEditResult(null)}
              className="ml-auto text-[11px] text-ink-400 hover:text-ink-600"
            >
              知道了
            </button>
          </div>
          {(editResult.updatedLessons.length > 0 ||
            editResult.skippedLessons.length > 0 ||
            editResult.pastLessons > 0) && (
            <p className="mt-1 text-[11px] text-ink-500">
              后续课节：改了 {editResult.updatedLessons.length} 节 · 跳过{" "}
              {editResult.skippedLessons.length} 节 · 已过去（含已上）
              {editResult.pastLessons} 节未动
            </p>
          )}
          {editResult.skippedLessons.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-warning-600">
              {editResult.skippedLessons.map((item) => (
                <li key={item.id}>
                  {formatDayLabel(item.startsAt)}：{item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 续费：加课时 + 收款 */}
      {panel === "renew" && !refunded && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-600">
          <span>续费</span>
          <input
            type="number"
            min={1}
            value={renewLessons}
            onChange={(event) => setRenewLessons(event.target.value)}
            className="w-16 rounded-md border border-ink-300 px-2 py-1 text-xs tabular outline-none focus:border-brand-500"
          />
          <span>节，收款</span>
          {moneyFields(Number(renewLessons) * enrollment.unitPrice)}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const count = Math.trunc(Number(renewLessons) || 0);
              const amount = amountInput === "" ? count * enrollment.unitPrice : Number(amountInput);
              setPanel(null);
              setAmountInput("");
              void onRenew(count, amount, method);
            }}
            className="rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
          >
            确认续费
          </button>
        </div>
      )}

      {/* 补记收款 / 退款（分期付款、无课时的费用） */}
      {panel === "pay" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-600">
          <span>记一笔</span>
          {moneyFields(outstandingAmount(enrollment) > 0 ? outstandingAmount(enrollment) : 0)}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const amount = Number(amountInput);
              setPanel(null);
              setAmountInput("");
              if (Number.isFinite(amount) && amount > 0) {
                void onRecordPayment(amount, "收款", method, "补记收款");
              }
            }}
            className="rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
          >
            记收款
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const amount = Number(amountInput);
              setPanel(null);
              setAmountInput("");
              if (Number.isFinite(amount) && amount > 0) {
                void onRecordPayment(amount, "退款", method, "手工退款");
              }
            }}
            className="rounded-md border border-ink-300 px-2.5 py-1 text-xs text-ink-700 transition-colors hover:border-danger-400 hover:text-danger-600 disabled:opacity-60"
          >
            记退款
          </button>
        </div>
      )}

      {/* 退课：先选退费口径，看清明细再确认 */}
      {panel === "refund" && !refunded && (
        <div className="mt-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2">
          <p className="text-xs font-medium text-warning-600">
            退课后退费 {formatMoney(refundPreview.refund)}
          </p>
          <p className="mt-0.5 text-xs text-warning-600">口径：{refundPreview.formula}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <select
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value)}
              className="rounded-md border border-ink-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand-500"
            >
              {REFUND_POLICIES.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
            <span className="text-ink-500">
              {REFUND_POLICIES.find((item) => item.id === policyId)?.description}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setPanel(null);
                void onRefund(refundPreview.refund, method, policyId);
              }}
              className="rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
            >
              确认退课并退款
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setPanel(null);
                // 只退课、不涉及退款（例如课时已上完）
                void onRefund(0, method, policyId);
              }}
              className="rounded-md border border-ink-300 px-2.5 py-1 text-xs text-ink-700 transition-colors hover:border-brand-400 disabled:opacity-60"
            >
              只退课，不退款
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-2 rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2">
          <p className="text-xs text-ink-500">
            报课日期：{formatDayLabel(enrollment.startedAt)}
            {enrollment.endedAt !== "" && ` · 退课日期：${formatDayLabel(enrollment.endedAt)}`}
          </p>
          {enrollment.note !== "" && (
            <p className="mt-1 text-xs text-ink-500">备注：{enrollment.note}</p>
          )}
          {/* 金额明细：标价 / 优惠 / 约定 / 实收 / 欠费 */}
          {enrollment.agreedAmount > 0 && (
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-ink-500 sm:grid-cols-2">
              <div>
                标价：{formatMoney(enrollment.totalLessons * enrollment.unitPrice)}
                <span className="ml-1 text-ink-400">
                  （{enrollment.totalLessons} 节 × {formatMoney(enrollment.unitPrice)}）
                </span>
              </div>
              <div>优惠：{formatMoney(discountAmount(enrollment))}</div>
              <div>约定应缴：{formatMoney(enrollment.agreedAmount)}</div>
              <div>
                实收：{formatMoney(enrollment.paidAmount)}
                {outstandingAmount(enrollment) > 0 && (
                  <span className="ml-1 text-warning-600">
                    欠 {formatMoney(outstandingAmount(enrollment))}
                  </span>
                )}
              </div>
            </dl>
          )}

          <p className="mt-2 text-xs font-medium text-ink-600">
            课时流水（{transactions.length} 笔）
          </p>
          {transactions.length === 0 ? (
            <p className="mt-1 text-xs text-ink-400">还没有流水。</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {transactions.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "text-xs",
                    item.reversedAt !== "" ? "text-ink-300 line-through" : "text-ink-500",
                  )}
                >
                  {formatDayLabel(item.at)} · {item.kind} {item.delta > 0 ? `+${item.delta}` : item.delta} 节
                  {item.note !== "" && ` · ${item.note}`}
                  {item.reversedAt !== "" && " · 已撤销"}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[11px] text-ink-400">
            上课扣减会记录关联的课节；撤销「已上」时按流水退回，撤销记录保留可追溯。
          </p>

          <p className="mt-2 text-xs font-medium text-ink-600">
            收款流水（{payments.length} 笔）
          </p>
          {payments.length === 0 ? (
            <p className="mt-1 text-xs text-ink-400">还没有收款记录。</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {payments.map((item) => (
                <li key={item.id} className="text-xs text-ink-500">
                  {formatDayLabel(item.at)} · {item.kind} {formatMoney(item.amount)} · {item.method}
                  {item.note !== "" && ` · ${item.note}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** 报课表单。 */
/**
 * **改报课**表单（班型 / 指定教师 / 单价 / 约定应缴 / 备注 + 影响范围）。
 *
 * 范围那两项刻意照手机日历的说法写：改日程时它会问"只改这一次 / 改这次及以后"，
 * 这里对应"只改这条记录 / 这条及以后的课"。**过去的永不改** ——
 * 已上的课与时间已过的课都不动（那是发生过的事实，改了账与课表就对不上）。
 *
 * 科目与课时不在这个表单里：科目是"这节课扣哪条报课"的匹配键，改了它会与已排的课、
 * 账本里的流水对不上（报错科目请退课后重报）；课时只走「续费 / 调整」，那两条会写课时流水。
 */
function EnrollEditForm({
  enrollment,
  teachers,
  formOptions,
  pending,
  onCancel,
  onSubmit,
}: {
  enrollment: Enrollment;
  teachers: Teacher[];
  formOptions: string[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (patch: EnrollmentEdit, scope: EnrollmentEditScope) => void | Promise<void>;
}) {
  const [form, setForm] = useState(enrollment.form);
  const [teacherId, setTeacherId] = useState(enrollment.teacherId);
  const [unitPrice, setUnitPrice] = useState(String(enrollment.unitPrice));
  const [agreedAmount, setAgreedAmount] = useState(String(enrollment.agreedAmount));
  const [note, setNote] = useState(enrollment.note);
  // 默认"这条及以后"：换老师/换班型时，后续的课本来就要跟着改
  const [scope, setScope] = useState<EnrollmentEditScope>("future-lessons");

  return (
    <div className="mt-2 rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-600">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          班型
          <select
            value={form}
            onChange={(event) => setForm(event.target.value)}
            className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
          >
            {(form !== "" && !formOptions.includes(form) ? [form, ...formOptions] : formOptions).map(
              (option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ),
            )}
            <option value="">（还没定）</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          指定教师
          <select
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
          >
            <option value="">不指定</option>
            {teachers
              .filter((teacher) => teacher.active)
              .map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          单价
          <input
            type="number"
            min={0}
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            className="w-20 rounded-md border border-ink-300 px-2 py-1 text-xs tabular outline-none focus:border-brand-500"
          />
        </label>
        <label className="flex items-center gap-1.5">
          约定应缴
          <input
            type="number"
            min={0}
            value={agreedAmount}
            onChange={(event) => setAgreedAmount(event.target.value)}
            className="w-24 rounded-md border border-ink-300 px-2 py-1 text-xs tabular outline-none focus:border-brand-500"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          备注
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-64 rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
          />
        </label>
      </div>

      <fieldset className="mt-2">
        <legend className="text-[11px] text-ink-500">改动影响到哪里（像手机日历改日程）：</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`scope-${enrollment.id}`}
              checked={scope === "enrollment"}
              onChange={() => setScope("enrollment")}
            />
            只改这条报课记录（已排的课一节不动）
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name={`scope-${enrollment.id}`}
              checked={scope === "future-lessons"}
              onChange={() => setScope("future-lessons")}
            />
            这条报课记录 + 后续还没上的课（**已上过的与过去的课都不改**）
          </label>
        </div>
      </fieldset>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            void onSubmit(
              {
                form,
                teacherId,
                unitPrice: Math.max(0, Number(unitPrice) || 0),
                agreedAmount: Math.max(0, Number(agreedAmount) || 0),
                note,
              },
              scope,
            )
          }
          className="rounded-md bg-brand-700 px-2.5 py-1 text-xs text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
        >
          保存改动
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 transition-colors hover:border-ink-300 disabled:opacity-60"
        >
          取消
        </button>
        <span className="text-[11px] text-ink-400">
          科目与课时不在这里改：科目报错请「退课」后重报，课时走「续费 / 调整」。
        </span>
      </div>
    </div>
  );
}

function EnrollForm({
  subjectOptions,
  formOptions,
  teachers,
  onSubmit,
  onCancel,
  pending,
}: {
  subjectOptions: string[];
  formOptions: string[];
  teachers: Teacher[];
  onSubmit: (input: {
    subject: string;
    form: string;
    teacherId: string;
    lessons: number;
    startedAt: string;
    note: string;
    unitPrice: number;
    agreedAmount: number;
    paidNow: number;
    method: PaymentMethod;
  }) => void | Promise<void>;
  onCancel: () => void;
  pending: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [form, setForm] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [lessons, setLessons] = useState("10");
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [unitPrice, setUnitPrice] = useState("200");
  const [agreedAmount, setAgreedAmount] = useState("2000");
  const [paidNow, setPaidNow] = useState("2000");
  const [method, setMethod] = useState<PaymentMethod>("微信");
  const [error, setError] = useState("");

  /** 课时或单价变了就给出默认的「约定应缴 = 课时 × 单价」，管理员可以改成谈定价。 */
  function syncAgreed(nextLessons: string, nextUnitPrice: string) {
    const count = Number(nextLessons);
    const price = Number(nextUnitPrice);
    if (!Number.isFinite(count) || !Number.isFinite(price)) return;
    setAgreedAmount(`${Math.round(count * price)}`);
    setPaidNow(`${Math.round(count * price)}`);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (subject.trim() === "") {
      setError("科目必填。");
      return;
    }
    const count = Math.trunc(Number(lessons));
    if (!Number.isFinite(count) || count <= 0) {
      setError("课时数必须是大于 0 的整数。");
      return;
    }

    setError("");
    await onSubmit({
      subject: subject.trim(),
      form: form.trim(),
      teacherId,
      lessons: count,
      startedAt: new Date(`${startedAt}T00:00:00`).toISOString(),
      note,
      unitPrice: Math.max(0, Number(unitPrice) || 0),
      agreedAmount: Math.max(0, Number(agreedAmount) || 0),
      paidNow: Math.max(0, Number(paidNow) || 0),
      method,
    });
  }

  return (
    <form onSubmit={submit} className="px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="科目"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          list="enrollment-subject-options"
          placeholder="例如 初中数学"
          required
        />
        <TextField
          label="班型"
          value={form}
          onChange={(event) => setForm(event.target.value)}
          list="enrollment-form-options"
          placeholder="例如 一对一定制课"
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">指定教师</span>
          <select
            value={teacherId}
            onChange={(event) => setTeacherId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">不指定</option>
            {teachers
              .filter((teacher) => teacher.active)
              .map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
          </select>
        </label>
        <TextField
          label="课时数"
          type="number"
          min={1}
          value={lessons}
          onChange={(event) => {
            setLessons(event.target.value);
            syncAgreed(event.target.value, unitPrice);
          }}
          hint="本次报课购买的节数"
          required
        />
        <TextField
          label="单价"
          hint="元 / 节（标价）"
          type="number"
          min={0}
          value={unitPrice}
          onChange={(event) => {
            setUnitPrice(event.target.value);
            syncAgreed(lessons, event.target.value);
          }}
        />
        <TextField
          label="约定应缴"
          hint="谈定总额，可低于标价（优惠）"
          type="number"
          min={0}
          value={agreedAmount}
          onChange={(event) => setAgreedAmount(event.target.value)}
        />
        <TextField
          label="本次实收"
          hint="分期付款时可以只填一部分"
          type="number"
          min={0}
          value={paidNow}
          onChange={(event) => setPaidNow(event.target.value)}
        />
        <label className="block">
          <span className="text-xs font-medium text-ink-600">收款方式</span>
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className="mt-1 block w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {PAYMENT_METHODS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="报课日期"
          type="date"
          value={startedAt}
          onChange={(event) => setStartedAt(event.target.value)}
        />
        <TextAreaField
          label="备注"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如 家长要求每周两次"
        />
      </div>

      {error !== "" && (
        <p role="alert" className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "保存中…" : "确认报课"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          取消
        </Button>
      </div>

      <datalist id="enrollment-subject-options">
        {subjectOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <datalist id="enrollment-form-options">
        {formOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </form>
  );
}
