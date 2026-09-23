"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { NumberField } from "@/components/ui/NumberField";
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
 * 联动关系：学习阶段 → 课程 → 人数（班型）。上级变化时下级自动清空，
 * 避免出现「阶段与课程不匹配」的组合。
 * 报课节数与每节课时长由用户直接填写 / 选择。
 *
 * **没有「科目」这一步**（机构口径：那一维的系数可以删掉）：以前这里在下拉里
 * 再选一次科目，只为了让公式多乘一个系数；现在家长走到课程就直接选人数（班型）。
 */
export function EstimateForm({ data }: EstimateFormProps) {
  const [stageName, setStageName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [classTypeName, setClassTypeName] = useState("");
  const [durationName, setDurationName] = useState("");
  const [lessons, setLessons] = useState("");
  const [studentCount, setStudentCount] = useState("");
  const [classCost, setClassCost] = useState("");

  const stage = data.stages.find((item) => item.name === stageName) ?? null;
  const course = stage?.courses.find((item) => item.name === courseName) ?? null;
  const classType = data.classTypes.find((item) => item.name === classTypeName) ?? null;
  const duration = data.durations.find((item) => item.name === durationName) ?? null;

  /** 把「暂未开放」的选项渲染为禁选，并标注出来。 */
  const toOptions = (items: Array<{ name: string; available: boolean }>): SelectOption[] =>
    items.map((item) => ({
      value: item.name,
      label: item.available ? item.name : `${item.name}（暂未开放）`,
      disabled: !item.available,
    }));

  const isCostShare = classType?.mode === "cost-share";
  const lessonsNumber = Number.parseInt(lessons, 10);

  /** 三项核心选择是否完成（不含节数）。 */
  const coreReady = course !== null && classType !== null && duration !== null;

  const result = useMemo(() => {
    if (course === null || classType === null || duration === null) return null;
    if (!course.available) return null;
    return calculateQuote({
      course,
      classType,
      duration,
      lessons: Number.isFinite(lessonsNumber) ? lessonsNumber : 0,
      studentCount: Number.parseFloat(studentCount),
      classCost: Number.parseFloat(classCost),
    });
  }, [course, classType, duration, lessonsNumber, studentCount, classCost]);

  const reset = () => {
    setStageName("");
    setCourseName("");
    setClassTypeName("");
    setDurationName("");
    setLessons("");
    setStudentCount("");
    setClassCost("");
  };

  return (
    <>
      {/* 选择区 */}
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

          <Select
            label="人数（班型）"
            placeholder="请选择人数与班型"
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
              <NumberField
                label={data.labels.classSizeLabel}
                suffix="人"
                min={1}
                value={studentCount}
                onChange={(event) => setStudentCount(event.target.value)}
                placeholder="例如 12"
              />
              <NumberField
                label={data.labels.classCostLabel}
                suffix="元"
                min={0}
                value={classCost}
                onChange={(event) => setClassCost(event.target.value)}
                placeholder="例如 2400"
              />
              <p className="text-xs leading-relaxed text-ink-500 sm:col-span-2">
                {data.labels.classCostHint}
              </p>
            </div>
          )}

          <Select
            label={data.labels.durationLabel}
            placeholder="请选择每节课时长"
            options={data.durations.map((item) => ({ value: item.name, label: item.name }))}
            value={durationName}
            onChange={(event) => setDurationName(event.target.value)}
          />

          <NumberField
            label={data.labels.lessonsLabel}
            hint={data.labels.lessonsHint}
            suffix="节"
            min={1}
            value={lessons}
            onChange={(event) => setLessons(event.target.value)}
            placeholder="例如 20"
          />
        </div>

        <div className="mt-6">
          <Button type="button" variant="outline" onClick={reset}>
            {data.labels.reset}
          </Button>
        </div>
      </div>

      {/* 结果区 */}
      <div className="space-y-5 lg:sticky lg:top-24">
        {result === null ? (
          <div className="rounded-lg border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink-500">
              完成上方选择并填写节数后，这里会显示参考价格。
            </p>
            {coreReady && lessons === "" && (
              <p className="mt-2 text-xs text-ink-400">还需填写报课节数</p>
            )}
          </div>
        ) : !result.ok ? (
          <div className="rounded-lg border border-warning-500/40 bg-warning-50 px-6 py-8">
            <p className="text-sm text-warning-600">{result.reason}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-ink-200 bg-white p-6">
            <h2 className="text-sm font-medium text-ink-900">{data.labels.result}</h2>

            {/* 课单价：家长最关心的一项，单位用「/ 节」而不是「/ 课时」，避免换算困惑 */}
            <div className="mt-5">
              <p className="text-xs text-ink-500">{data.labels.unitPriceLabel}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight text-brand-800 tabular">
                  ¥{result.unitPrice}
                </span>
                <span className="text-sm text-ink-500">{data.labels.unit}</span>
              </div>
            </div>

            {/* 总价 */}
            <div className="mt-4 rounded-md bg-ink-50 px-4 py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink-600">{data.labels.totalLabel}</span>
                <span className="text-lg font-medium text-ink-900 tabular">
                  ¥{result.totalPrice}
                </span>
              </div>
              <p className="mt-2 border-t border-ink-200/70 pt-2 text-xs text-ink-500">
                {result.lessons} 节正课 ¥{result.lessonsPrice}
                {result.trialFree ? " + 试课 免费" : ` + 试课 ¥${result.trialFee}`}
              </p>
            </div>

            {result.trialFree ? (
              <p className="mt-3 text-sm text-success-600">
                报课满 10 节，本次试课免费
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-600">
                试课按课程原价 ¥{result.trialFee} 收取；若试课后报课满 10 节，试课费用予以免除
              </p>
            )}

            <dl className="mt-6 space-y-2.5 border-t border-ink-100 pt-5 text-sm">
              {result.breakdown.map((item) => (
                <div key={item.label} className="flex justify-between gap-4">
                  <dt className="text-ink-500">{item.label}</dt>
                  <dd className="text-right text-ink-700 tabular">{item.value}</dd>
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

        {/* 试课（独立产品，不参与课时公式） */}
        {data.trial !== null && (
          <div className="rounded-lg border border-ink-200 bg-white px-5 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm font-medium text-ink-900">{data.trial.name}</span>
              <span className="text-sm text-ink-600">{data.trial.priceLabel}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              试课后报课满 10 节则试课免费；未满 10 节按课程原价收取。
            </p>
          </div>
        )}
      </div>
    </>
  );
}
