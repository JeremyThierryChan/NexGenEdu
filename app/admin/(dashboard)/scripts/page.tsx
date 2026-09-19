"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/admin/AdminFields";
import { api, type Student } from "@/lib/backend/api";
import {
  SCRIPT_GROUPS,
  SCRIPT_VARS,
  fillScript,
  filterScripts,
  missingPlaceholders,
  scriptsToText,
  summarizeScripts,
  type Script,
} from "@/lib/backend/scripts";
import { cn } from "@/lib/utils/cn";

/**
 * 话术专区。
 *
 * 机构日常要说的话（接待、报价、试课、请假、续费、欠费、退费、投诉…）在这里按场景摆好，
 * 点一下就能复制发出。三件事决定了这一页的形态：
 *
 *   1. **是草稿，不是逐字稿**：里面填好了具体数字，但发之前必须自己看一遍 ——
 *      家长收到机器味的话，比收到一句朴素的话更糟；
 *   2. **口径与系统一致**：请假 24 小时、试课满 10 节免费、只报 1 节加收 10%、
 *      两种退费口径 —— 这些数字写在 `lib/backend/scripts.ts` 里，
 *      与扣课时 / 报价的实现同一个版本，`npm run check` 盯着它们；
 *   3. **内部信息不进话术**：教师分成、教师课时费、机构留存这类内容一条都不会出现在这里
 *      （自检里有断言逐条扫描），因为这些字是发给家长的。
 */
export default function AdminScriptsPage() {
  const [group, setGroup] = useState("全部");
  const [keyword, setKeyword] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [subject, setSubject] = useState("");
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setStudents(await api.students.list());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeScripts(), []);
  const visible = useMemo(() => filterScripts({ group, keyword }), [group, keyword]);

  const student = useMemo(
    () => students.find((item) => item.id === studentId) ?? null,
    [studentId, students],
  );

  /** 这名学生还在读的报课记录（切科目、算剩余课时都用它）。 */
  const activeEnrollments = useMemo(
    () => (student?.enrollments ?? []).filter((enrollment) => enrollment.endedAt === ""),
    [student],
  );

  /**
   * 套用到学生时用的变量。
   *
   * 只填**系统里查得到的**：学生姓名、科目、剩余课时。老师 / 时间 / 金额这些
   * 因场景不同而不同，留空让使用者自己补 —— 猜错比空着更糟（例如把「{老师}」
   * 猜成某位老师，发出去就是错的）。
   */
  const vars = useMemo<Record<string, string>>((): Record<string, string> => {
    if (student === null) return {} as Record<string, string>;
    const target =
      subject === ""
        ? activeEnrollments[0]
        : activeEnrollments.find((enrollment) => enrollment.subject === subject);
    const remaining =
      target === undefined
        ? activeEnrollments.reduce(
            (sum, enrollment) => sum + Math.max(0, enrollment.totalLessons - enrollment.usedLessons),
            0,
          )
        : Math.max(0, target.totalLessons - target.usedLessons);
    return {
      学生: student.name,
      家长: `${student.name}家长`,
      科目: target?.subject ?? "",
      剩余课时: String(remaining),
    };
  }, [activeEnrollments, student, subject]);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      // 剪贴板不可用（http 或权限被拒）时退化为「显示出来让人手动复制」
      window.prompt("复制下面的内容：", text);
    }
  }

  return (
    <>
      <PageHeading
        title="话术"
        description="接待、报价、试课、请假、续费、欠费、反馈、投诉、退费、教师相关的说法，按场景摆好，点一下就能复制。"
      />

      <div className="mt-4 rounded-md border border-ink-200 bg-white px-3.5 py-2.5 text-xs leading-relaxed text-ink-600">
        这些是<strong className="font-medium text-ink-800">通用草稿</strong>，不是逐字稿：
        里面的数字已经按我们的口径填好，但
        <strong className="font-medium text-ink-800">发之前请自己看一遍</strong>
        ，该改的称呼、时间、语气按实际情况改。另外这里不会出现教师分成、机构留存这类
        内部信息 —— 这些话是发给家长的。
      </div>

      {/* ── 套用到某个学生 ── */}
      <Panel
        className="mt-4"
        title="套用到某个学生"
        description="选一名学生，话术里的 {学生} {科目} {剩余课时} 会自动填好；老师、时间、金额这些由你自己补。"
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-800">学生</span>
            <select
              value={studentId}
              onChange={(event) => {
                setStudentId(event.target.value);
                setSubject("");
              }}
              className="h-10 w-full rounded-md border border-ink-300 px-3 text-sm outline-none focus:border-brand-400"
            >
              <option value="">（不套用，直接复制原稿）</option>
              {students.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.grade === "" ? "" : `（${item.grade}）`}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-800">科目</span>
            <select
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={student === null || activeEnrollments.length === 0}
              className="h-10 w-full rounded-md border border-ink-300 px-3 text-sm outline-none focus:border-brand-400 disabled:bg-ink-50 disabled:text-ink-400"
            >
              <option value="">（这名学生的第一个在读科目）</option>
              {activeEnrollments.map((enrollment) => (
                <option key={enrollment.id} value={enrollment.subject}>
                  {enrollment.subject}
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs leading-relaxed text-ink-500">
            {loading ? (
              "加载学生名单…"
            ) : student === null ? (
              "不选学生时复制的是原稿，占位符会原样留着（如 {学生}），发之前记得替换。"
            ) : activeEnrollments.length === 0 ? (
              <span className="text-warning-600">
                {student.name} 没有在读的报课记录，剩余课时会按 0 算 —— 先去「学生」页确认报课情况。
              </span>
            ) : (
              <>
                会用到的值：
                {SCRIPT_VARS.filter((item) => vars[item.key] !== undefined).map((item) => (
                  <span key={item.key} className="ml-1.5 inline-block rounded-sm bg-ink-100 px-1.5 py-0.5">
                    {item.key} = {vars[item.key]}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      </Panel>

      {/* ── 筛选 ── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索场景或话术内容…"
          className="h-9 min-w-56 flex-1 rounded-md border border-ink-200 px-3 text-sm outline-none focus:border-brand-400"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copy(scriptsToText(visible), "__all__")}
          disabled={visible.length === 0}
        >
          {copied === "__all__" ? "已复制" : `复制全部（${visible.length} 条）`}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setGroup("全部")}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs transition-colors",
            group === "全部"
              ? "border-brand-400 bg-brand-50 text-brand-700"
              : "border-ink-200 text-ink-600 hover:border-ink-300",
          )}
        >
          全部 {summary.scripts}
        </button>
        {SCRIPT_GROUPS.map((item) => {
          const count = summary.perGroup.find((row) => row.id === item.id)?.count ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              title={item.purpose}
              onClick={() => setGroup(item.id)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                group === item.id
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-ink-200 text-ink-600 hover:border-ink-300",
              )}
            >
              {item.name} {count}
            </button>
          );
        })}
      </div>

      {group !== "全部" && (
        <p className="mt-2 text-xs text-ink-500">
          {SCRIPT_GROUPS.find((item) => item.id === group)?.purpose ?? ""}
        </p>
      )}

      {/* ── 话术卡片 ── */}
      {visible.length === 0 ? (
        <p className="mt-6 rounded-lg border border-ink-200 bg-white px-4 py-6 text-sm text-ink-500">
          没有匹配的话术。换个关键字，或点上面的「全部」。
        </p>
      ) : (
        <div className="mt-4 mb-8 space-y-3">
          {visible.map((script) => (
            <ScriptCard
              key={script.id}
              script={script}
              vars={vars}
              copied={copied === script.id}
              onCopy={(text) => void copy(text, script.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** 一条话术的卡片：场景、什么时候用、成稿、该说与不该说、复制按钮。 */
function ScriptCard({
  script,
  vars,
  copied,
  onCopy,
}: {
  script: Script;
  vars: Record<string, string>;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  const filled = fillScript(script, vars);
  const missing = missingPlaceholders(script, vars);
  const groupName = SCRIPT_GROUPS.find((item) => item.id === script.group)?.name ?? "";

  return (
    <Panel
      title={script.title}
      description={`${groupName === "" ? "" : `${groupName} · `}什么时候用：${script.when}`}
      actions={
        <Button size="sm" variant={copied ? "secondary" : "primary"} onClick={() => onCopy(filled)}>
          {copied ? "已复制" : "复制"}
        </Button>
      }
    >
      <div className="space-y-3 px-4 py-4">
        {/* 成稿：等宽浅底，方便一眼看出是「可以直接发的原文」 */}
        <pre className="whitespace-pre-wrap rounded-md border border-ink-200 bg-ink-50 px-3 py-2.5 font-sans text-sm leading-relaxed text-ink-800">
          {filled}
        </pre>

        {missing.length > 0 && (
          <p className="text-xs text-warning-600">
            还需要自己补：
            {missing.map((name) => (
              <span key={name} className="ml-1.5 inline-block rounded-sm bg-warning-50 px-1.5 py-0.5">
                {"{"}
                {name}
                {"}"}
              </span>
            ))}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-success-100 bg-success-50/60 px-3 py-2">
            <p className="text-xs font-medium text-success-600">该说的重点</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-700">
              {script.tips.say.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-danger-100 bg-danger-50/60 px-3 py-2">
            <p className="text-xs font-medium text-danger-600">不该说的</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-700">
              {script.tips.avoid.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Panel>
  );
}
