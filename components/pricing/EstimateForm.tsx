"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { PricingData } from "@/lib/data/pricing";
import { calculateQuote } from "@/lib/pricing/quote";

type EstimateFormProps = {
  data: PricingData;
};

/**
 * 报价表单。
 *
 * 只负责：保存选择、调用 lib/pricing/quote.ts、展示结果。
 * 选项清单来自 data/site/pricing.md，公式来自 lib/pricing/quote.ts，
 * 因此调价或改公式都不需要改本组件。
 *
 * 联动关系：学习阶段 → 课程 / 科目 → 班级类型 → 报课数量。
 * 上级变化时下级自动清空，避免出现「阶段与科目不匹配」的组合。
 */
export function EstimateForm({ data }: EstimateFormProps) {
  const [stageName, setStageName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [classTypeName, setClassTypeName] = useState("");
  const [tierName, setTierName] = useState("");
  const [studentCount, setStudentCount] = useState("");
  const [classCost, setClassCost] = useState("");

  const stage = data.stages.find((item) => item.name === stageName) ?? null;
  const subjectGroup = data.subjectGroups.find((item) => item.name === stageName) ?? null;
  const course = stage?.courses.find((item) => item.name === courseName) ?? null;
  const subject = subjectGroup?.subjects.find((item) => item.name === subjectName) ?? null;
  const classType = data.classTypes.find((item) => item.name === classTypeName) ?? null;
  const tier = data.purchaseTiers.find((item) => item.name === tierName) ?? null;

  /** 把「暂未开放」的选项渲染为禁选，并标注出来。 */
  const toOptions = (
    items: Array<{ name: string; available: boolean }>,
  ): SelectOption[] =>
    items.map((item) => ({
      value: item.name,
      label: item.available ? item.name : `${item.name}（暂未开放）`,
      disabled: !item.available,
    }));

  const isCostShare = classType?.mode === "cost-share";

  /** 该阶段是否有科目可选（出国考试 / 专业英语 / 成人兴趣没有科目分组）。 */
  const subjectsRequired = (subjectGroup?.subjects.length ?? 0) > 0;

  const result = useMemo(() => {
    if (course === null || classType === null || tier === null) return null;
    if (!course.available) return null;
    // 有科目分组时必须选择科目；没有科目分组的阶段直接计算
    if (subjectsRequired && (subject === null || !subject.available)) return null;
    return calculateQuote({
      course,
      subject: subjectsRequired ? subject : null,
      classType,
      tier,
      studentCount: Number.parseFloat(studentCount),
      classCost: Number.parseFloat(classCost),
    });
  }, [course, subject, subjectsRequired, classType, tier, studentCount, classCost]);

  const reset = () => {
    setStageName("");
    setCourseName("");
    setSubjectName("");
    setClassTypeName("");
    setTierName("");
    setStudentCount("");
    setClassCost("");
  };

  return (
    <>
      {/* 计算器 */}
      <div className="rounded-lg border border-ink-200 bg-white p-6">
        <h2 className="text-base font-medium text-ink-900">{data.labels.calculatorTitle}</h2>
        <p className="mt-1 text-sm text-ink-500">{data.labels.calculatorHint}</p>

        <div className="mt-6 space-y-5">
          <Select
            label="学习阶段"
            placeholder="请选择学习阶段"
            options={toOptions(data.stages)}
            value={stageName}
            onChange={(event) => {
              setStageName(event.target.value);
              setCourseName("");
              setSubjectName("");
            }}
          />

          <Select
            label="课程（决定基础价）"
            placeholder={stage === null ? "请先选择学习阶段" : "请选择课程"}
            options={toOptions(stage?.courses ?? [])}
            value={courseName}
            disabled={stage === null}
            onChange={(event) => setCourseName(event.target.value)}
          />

          {/* 只有存在科目分组的阶段才显示科目下拉 */}
          {subjectsRequired && (
            <Select
              label="科目"
              placeholder="请选择科目"
              options={toOptions(subjectGroup?.subjects ?? [])}
              value={subjectName}
              onChange={(event) => setSubjectName(event.target.value)}
            />
          )}

          <Select
            label="班级类型"
            placeholder="请选择班级类型"
            options={data.classTypes.map((item) => ({ value: item.name, label: item.name }))}
            value={classTypeName}
            onChange={(event) => {
              setClassTypeName(event.target.value);
              setStudentCount("");
              setClassCost("");
            }}
          />

          {isCostShare && (
            <div className="grid gap-5 rounded-md bg-ink-50 p-4 sm:grid-cols-2">
              <label className="block">
                <span className="block text-sm font-medium text-ink-800">
                  {data.labels.classSizeLabel}
                </span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={studentCount}
                  onChange={(event) => setStudentCount(event.target.value)}
                  placeholder="例如 12"
                  className="mt-2 w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-ink-800">
                  {data.labels.classCostLabel}
                </span>
                <input
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={classCost}
                  onChange={(event) => setClassCost(event.target.value)}
                  placeholder="例如 2400"
                  className="mt-2 w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </label>
              <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">
                {data.labels.classCostHint}
              </p>
            </div>
          )}

          <Select
            label="报课数量"
            placeholder="请选择报课数量"
            options={data.purchaseTiers.map((item) => ({ value: item.name, label: item.name }))}
            value={tierName}
            onChange={(event) => setTierName(event.target.value)}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={reset}>
            {data.labels.reset}
          </Button>
        </div>
      </div>

      {/* 结果 */}
      <div className="lg:sticky lg:top-24">
        {result === null ? (
          <div className="rounded-lg border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink-500">
              完成上方选择后，这里会显示参考价格。
            </p>
          </div>
        ) : !result.ok ? (
          <div className="rounded-lg border border-warning-500/40 bg-warning-50 px-6 py-8">
            <p className="text-sm text-warning-600">{result.reason}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-ink-200 bg-white p-6">
            <h2 className="text-sm font-medium text-ink-900">{data.labels.result}</h2>

            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-brand-800 tabular">
                ¥{result.unitPrice}
              </span>
              <span className="text-sm text-ink-500">{data.labels.unit}</span>
            </div>

            <div className="mt-4 flex items-baseline justify-between gap-4 rounded-md bg-ink-50 px-4 py-3">
              <span className="text-sm text-ink-600">
                {data.labels.totalLabel}（{result.lessons} 节）
              </span>
              <span className="text-lg font-medium text-ink-900 tabular">
                ¥{result.totalPrice}
              </span>
            </div>

            {result.includesTrial && (
              <p className="mt-3 text-sm text-success-600">含 1 次免费试课</p>
            )}

            <dl className="mt-6 space-y-2.5 border-t border-ink-100 pt-5 text-sm">
              {result.breakdown.map((item) => (
                <div key={item.label} className="flex justify-between gap-4">
                  <dt className="text-ink-500">{item.label}</dt>
                  <dd className="text-ink-700 tabular">{item.value}</dd>
                </div>
              ))}
            </dl>

            {data.labels.formulaNote !== "" && (
              <p className="mt-6 rounded-md bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
                {data.labels.formulaNote}
              </p>
            )}

            <Link
              href="/contact"
              className="mt-6 inline-block text-sm text-brand-700 transition-colors hover:text-brand-800"
            >
              想了解具体方案？联系我们 →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
