"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { NumberInput, Panel, SelectInput, TextField } from "@/components/admin/AdminFields";
import { api } from "@/lib/backend/api";
import {
  PRICING_SOURCE_ADMIN,
  validatePricingConfig,
  type PricingConfig,
  type QuoteResult,
} from "@/lib/backend/pricing";
import { formatMoney } from "@/lib/backend/finance";
import { cn } from "@/lib/utils/cn";

/**
 * 报价（后台）。
 *
 * 报价原先只有宣传页上那个计算器，规则还写死在代码里：调价要改代码、重新构建，
 * 家长打电话来时也只能切到宣传页点一遍。这一页解决三件事：
 *
 *   1. **改价**：基础价、科目系数、班级系数、时长乘数、手续费与试课规则都是数据；
 *   2. **试算**：当场按家长说的方案算出课时价与总价（含试课怎么收）；
 *   3. **导出**：伪后端的数据只在这台电脑上，导出成与 `data/site/pricing.md`
 *      同构的片段替换进内容文件，价格才真正上线 —— 这一页顶部把这件事说清楚了。
 *
 * 校验放在保存时由服务层复核（`api.pricing.update`），前端这一层只是提前提示；
 * 系数写成 0 会让所有报价变 0，不能让这种配置进库。
 */
export default function AdminPricingPage() {
  const [saved, setSaved] = useState<PricingConfig | null>(null);
  const [draft, setDraft] = useState<PricingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [exported, setExported] = useState("");
  const [copied, setCopied] = useState(false);

  // 试算器
  const [courseName, setCourseName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [classTypeName, setClassTypeName] = useState("");
  const [durationName, setDurationName] = useState("");
  const [lessons, setLessons] = useState(10);
  const [studentCount, setStudentCount] = useState(12);
  const [classCost, setClassCost] = useState(2400);
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const config = await api.pricing.get();
    setSaved(config);
    setDraft(config);
    setCourseName((current) => current || (config.stages[0]?.courses[0]?.name ?? ""));
    setClassTypeName((current) => current || (config.classTypes[0]?.name ?? ""));
    setDurationName((current) => current || (config.durations[0]?.name ?? ""));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 就地改草稿：改的是副本，保存前不影响已存配置。 */
  const edit = useCallback((change: (next: PricingConfig) => void) => {
    setDraft((prev) => {
      if (prev === null) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as PricingConfig;
      change(next);
      return next;
    });
  }, []);

  const dirty = useMemo(
    () => saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft),
    [draft, saved],
  );

  const stageOfCourse = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of draft?.stages ?? []) {
      for (const course of stage.courses) map.set(course.name, stage.name);
    }
    return map;
  }, [draft]);

  const subjectsOfCourse = useMemo(() => {
    const stageName = stageOfCourse.get(courseName);
    return (draft?.subjects ?? []).filter((subject) => subject.stageName === stageName);
  }, [courseName, draft, stageOfCourse]);

  const selectedClassType = draft?.classTypes.find((item) => item.name === classTypeName);

  // 换课程时科目要跟着换（科目是分阶段的，小学的「英语」与高中的「英语」是两条）
  useEffect(() => {
    if (!subjectsOfCourse.some((subject) => subject.name === subjectName)) {
      setSubjectName(subjectsOfCourse[0]?.name ?? "");
    }
  }, [subjectName, subjectsOfCourse]);

  async function save() {
    if (draft === null) return;
    setProblems(validatePricingConfig(draft));
    setSaving(true);
    setMessage("");
    try {
      const next = await api.pricing.update(draft);
      setSaved(next);
      setDraft(next);
      setMessage("已保存。别忘了导出并替换内容文件，家长看到的报价页才会更新。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  async function resetToContent() {
    if (!window.confirm("恢复为站点内容（data/site/pricing.md）里的价格？后台改过的价格会丢失。")) {
      return;
    }
    const next = await api.pricing.reset();
    setSaved(next);
    setDraft(next);
    setMessage("已恢复为站点内容里的价格。");
  }

  async function runQuote() {
    const result = await api.pricing.quote({
      courseName,
      subjectName,
      classTypeName,
      durationName,
      lessons,
      studentCount,
      classCost,
    });
    setQuote(result);
  }

  async function exportMarkdown() {
    const text = await api.pricing.exportMarkdown();
    setExported(text);
    setCopied(false);
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exported);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (loading || draft === null) {
    return (
      <>
        <PageHeading title="报价" description="加载中…" />
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="报价"
        description="基础价与系数是算钱的依据：改完保存，再用试算器核对一遍，最后导出替换内容文件。"
      />
      <DataNotice
        onReset={() => {
          void load();
        }}
      />

      {/* 伪后端的边界：必须写在最显眼的地方 */}
      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <strong className="font-medium">这里的价格暂时只有这台电脑能看到。</strong>
        后台数据存在浏览器本地，而家长看到的报价页读的是内容文件
        <code className="mx-1 rounded bg-white/70 px-1">data/site/pricing.md</code>
        。改完价格后请点「导出配置」，把导出的片段替换进该文件（页面文案字段不要动），
        才会真正上线。接上服务端后，这一步会自动消失。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "保存中…" : dirty ? "保存修改" : "已保存"}
        </Button>
        <Button variant="outline" onClick={() => void exportMarkdown()}>
          导出配置
        </Button>
        <Button variant="outline" onClick={() => void resetToContent()}>
          恢复为站点内容
        </Button>
        <span className="text-xs text-ink-500">
          来源：{draft.source}
          {draft.updatedAt === "" ? "" : ` · 最后修改 ${draft.updatedAt.slice(0, 16).replace("T", " ")}`}
          {draft.source === PRICING_SOURCE_ADMIN ? "（未导出上线）" : ""}
        </span>
      </div>

      {message !== "" && (
        <p className="mt-2 text-xs leading-relaxed text-ink-600">{message}</p>
      )}
      {problems.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 rounded-md border border-red-300 bg-red-50 px-5 py-2.5 text-xs text-red-800">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {/* ── 试算器：家长打电话来的时候用 ── */}
      <Panel
        title="试算"
        description="按家长说的方案算一遍。试课费按课程原价收，不带系数与手续费。"
        className="mt-5"
      >
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectInput
            label="课程"
            value={courseName}
            onChange={(event) => setCourseName(event.target.value)}
            options={draft.stages.flatMap((stage) =>
              stage.courses.map((course) => ({
                value: course.name,
                label: `${stage.name} · ${course.name}${
                  course.basePrice === null ? "（未开放）" : ` ¥${course.basePrice}`
                }`,
              })),
            )}
          />
          <SelectInput
            label="科目"
            hint={subjectsOfCourse.length === 0 ? "该阶段不分科目，按系数 1 计" : undefined}
            value={subjectName}
            onChange={(event) => setSubjectName(event.target.value)}
            options={
              subjectsOfCourse.length === 0
                ? [{ value: "", label: "（不分科目）" }]
                : subjectsOfCourse.map((subject) => ({
                    value: subject.name,
                    label: `${subject.name}（×${subject.coefficient}）`,
                  }))
            }
          />
          <SelectInput
            label="班型"
            value={classTypeName}
            onChange={(event) => setClassTypeName(event.target.value)}
            options={draft.classTypes.map((item) => ({
              value: item.name,
              label:
                item.mode === "cost-share"
                  ? `${item.name}（费用 ÷ 人数）`
                  : `${item.name}（×${item.coefficient ?? 1}）`,
            }))}
          />
          <SelectInput
            label="每节课时长"
            value={durationName}
            onChange={(event) => setDurationName(event.target.value)}
            options={draft.durations.map((item) => ({
              value: item.name,
              label: `${item.name}（×${item.multiplier}）`,
            }))}
          />
          <NumberInput
            label="报课节数"
            hint={`满 ${draft.rules.freeTrialMinLessons} 节试课免费`}
            min={1}
            value={lessons}
            onChange={(event) => setLessons(Number(event.target.value))}
          />
          {selectedClassType?.mode === "cost-share" && (
            <>
              <NumberInput
                label="班级人数"
                min={1}
                value={studentCount}
                onChange={(event) => setStudentCount(Number(event.target.value))}
              />
              <NumberInput
                label="教师课时总费用"
                suffix="元"
                min={0}
                value={classCost}
                onChange={(event) => setClassCost(Number(event.target.value))}
              />
            </>
          )}
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => void runQuote()}>
              算一下
            </Button>
          </div>
        </div>

        {quote !== null && (
          <div className="border-t border-ink-100 px-4 py-4">
            {quote.ok ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  <p className="text-sm text-ink-600">
                    课单价{" "}
                    <strong className="text-lg font-medium text-ink-900">
                      {formatMoney(quote.unitPrice)}
                    </strong>
                    <span className="text-ink-400"> / 节</span>
                  </p>
                  <p className="text-sm text-ink-600">
                    {quote.lessons} 节正课 {formatMoney(quote.lessonsPrice)}
                  </p>
                  <p className="text-sm text-ink-600">
                    试课 {quote.trialFree ? "免费" : formatMoney(quote.trialFee)}
                  </p>
                  <p className="text-sm text-ink-600">
                    合计{" "}
                    <strong className="text-lg font-medium text-brand-800">
                      {formatMoney(quote.totalPrice)}
                    </strong>
                  </p>
                </div>
                <ul className="mt-3 grid gap-1 text-xs text-ink-500 sm:grid-cols-2 lg:grid-cols-3">
                  {quote.breakdown.map((item) => (
                    <li key={item.label} className="flex justify-between gap-3">
                      <span>{item.label}</span>
                      <span className="text-ink-700">{item.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-red-700">{quote.reason}</p>
            )}
          </div>
        )}
      </Panel>

      {/* ── 基础价 ── */}
      <Panel
        title="基础价"
        description="每门课「一对一、1 小时、报 2 节及以上」的价格（元 / 节），所有换算都从它开始。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          {draft.stages.map((stage, stageIndex) => (
            <div key={stage.name}>
              <h3 className="mb-2 text-xs font-medium text-ink-500">{stage.name}</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {stage.courses.map((course, courseIndex) => (
                  <div key={course.name} className="rounded-md border border-ink-200 px-3 py-2.5">
                    <p className="mb-2 text-sm text-ink-800">{course.name}</p>
                    <div className="flex items-end gap-2">
                      <NumberInput
                        label=""
                        suffix="元 / 节"
                        min={0}
                        disabled={!course.available}
                        value={course.basePrice ?? ""}
                        onChange={(event) =>
                          edit((next) => {
                            const target = next.stages[stageIndex]?.courses[courseIndex];
                            if (target === undefined) return;
                            const value = event.target.value;
                            target.basePrice = value === "" ? 0 : Number(value);
                          })
                        }
                      />
                      <label className="flex shrink-0 items-center gap-1.5 pb-2 text-xs text-ink-500">
                        <input
                          type="checkbox"
                          checked={!course.available}
                          onChange={(event) =>
                            edit((next) => {
                              const target = next.stages[stageIndex]?.courses[courseIndex];
                              if (target === undefined) return;
                              target.available = !event.target.checked;
                              if (!target.available) target.basePrice = null;
                            })
                          }
                        />
                        暂未开放
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── 系数 ── */}
      <Panel
        title="科目系数与班级系数"
        description="科目系数管「同一阶段里哪个科目更贵」，班级系数管「人越多每人越便宜」。系数 1 表示不加价。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          {draft.stages.map((stage) => {
            const subjects = draft.subjects.filter((subject) => subject.stageName === stage.name);
            if (subjects.length === 0) return null;
            return (
              <div key={stage.name}>
                <h3 className="mb-2 text-xs font-medium text-ink-500">
                  {stage.name} · 科目系数
                </h3>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {subjects.map((subject) => (
                    <NumberInput
                      key={`${stage.name}-${subject.name}`}
                      label={subject.name}
                      step={0.05}
                      min={0.05}
                      value={subject.coefficient}
                      onChange={(event) =>
                        edit((next) => {
                          const target = next.subjects.find(
                            (item) => item.name === subject.name && item.stageName === stage.name,
                          );
                          if (target === undefined) return;
                          target.coefficient = Number(event.target.value);
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}

          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-500">班级系数</h3>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {draft.classTypes.map((classType, index) => (
                <div key={classType.name}>
                  {classType.mode === "cost-share" ? (
                    <p className="rounded-md border border-dashed border-ink-300 px-3 py-2 text-xs leading-relaxed text-ink-500">
                      <span className="text-ink-700">{classType.name}</span>
                      <br />
                      按「教师课时总费用 ÷ 班级人数」分摊，不用系数。
                    </p>
                  ) : (
                    <NumberInput
                      label={classType.name}
                      step={0.05}
                      min={0.05}
                      value={classType.coefficient ?? 1}
                      onChange={(event) =>
                        edit((next) => {
                          const target = next.classTypes[index];
                          if (target === undefined) return;
                          target.coefficient = Number(event.target.value);
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── 时长与规则 ── */}
      <Panel
        title="课时时长与计费规则"
        description="时长乘数按 1 小时为基准；手续费与试课门槛就是公式里那两个会变的数字。"
        className="mt-5"
      >
        <div className="space-y-5 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {draft.durations.map((duration, index) => (
              <div key={duration.name} className="rounded-md border border-ink-200 px-3 py-2.5">
                <p className="mb-2 text-sm text-ink-800">{duration.name}</p>
                <div className="flex gap-2">
                  <NumberInput
                    label="小时"
                    step={0.5}
                    min={0.5}
                    value={duration.hours}
                    onChange={(event) =>
                      edit((next) => {
                        const target = next.durations[index];
                        if (target === undefined) return;
                        target.hours = Number(event.target.value);
                      })
                    }
                  />
                  <NumberInput
                    label="乘数"
                    step={0.1}
                    min={0.1}
                    value={duration.multiplier}
                    onChange={(event) =>
                      edit((next) => {
                        const target = next.durations[index];
                        if (target === undefined) return;
                        target.multiplier = Number(event.target.value);
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <NumberInput
              label="只报 1 节的手续费"
              hint="报 2 节及以上不加收"
              suffix="%"
              min={0}
              max={100}
              value={draft.rules.singleLessonFeePercent}
              onChange={(event) =>
                edit((next) => {
                  next.rules.singleLessonFeePercent = Number(event.target.value);
                })
              }
            />
            <NumberInput
              label="试课免费门槛"
              hint="报课达到该节数则试课免费"
              suffix="节"
              min={1}
              value={draft.rules.freeTrialMinLessons}
              onChange={(event) =>
                edit((next) => {
                  next.rules.freeTrialMinLessons = Number(event.target.value);
                })
              }
            />
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={draft.rules.chargeTrialWhenNotFree}
                  onChange={(event) =>
                    edit((next) => {
                      next.rules.chargeTrialWhenNotFree = event.target.checked;
                    })
                  }
                />
                未达门槛时按课程原价收 1 节试课费
              </label>
            </div>
          </div>
        </div>
      </Panel>

      {/* ── 其他项目 ── */}
      <Panel
        title="其他项目"
        description="按学期 / 按期的独立产品（晚辅导、特色网课），不参与课时公式，报价页单独列出。"
        className="mt-5"
      >
        <div className="space-y-4 px-4 py-4">
          {draft.otherItems.map((item, itemIndex) => (
            <div key={item.name} className="rounded-md border border-ink-200 px-3 py-2.5">
              <p className="mb-2 text-sm text-ink-800">{item.name}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {item.details.map((detail, detailIndex) => (
                  <TextField
                    key={`${item.name}-${detail.title}`}
                    label={detail.title}
                    value={detail.value}
                    onChange={(event) =>
                      edit((next) => {
                        const target = next.otherItems[itemIndex]?.details[detailIndex];
                        if (target === undefined) return;
                        target.value = event.target.value;
                      })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          {draft.trial !== null && (
            <p className="text-xs text-ink-500">
              试课：{draft.trial.name} · {draft.trial.priceLabel}（试课费按课程原价收，
              这一行只是报价页上的文案）
            </p>
          )}
        </div>
      </Panel>

      {/* ── 导出 ── */}
      <Panel
        title="导出配置（上线用）"
        description="把下面这段替换 data/site/pricing.md 里「## 学习阶段」及其后的部分，页面文案字段不要动。"
        className="mt-5 mb-8"
      >
        <div className="px-4 py-4">
          {exported === "" ? (
            <p className="text-xs text-ink-500">
              点上方「导出配置」生成。导出内容与内容文件同构，`npm run check`
              会把它回读一遍，确保导出的价格能被解析、且与这里的配置一致。
            </p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => void copyExport()}>
                  {copied ? "已复制" : "复制"}
                </Button>
                <span className="text-xs text-ink-500">
                  包含 {draft.stages.reduce((sum, stage) => sum + stage.courses.length, 0)} 门课、
                  {draft.subjects.length} 个科目系数、{draft.classTypes.length} 种班型与计费规则。
                </span>
              </div>
              <textarea
                readOnly
                rows={14}
                value={exported}
                className={cn(
                  "w-full rounded-md border border-ink-200 bg-ink-50 p-3 font-mono text-xs leading-relaxed text-ink-700",
                )}
              />
            </>
          )}
        </div>
      </Panel>
    </>
  );
}
