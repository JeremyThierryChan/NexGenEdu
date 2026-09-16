"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import type { PricingOptions } from "@/lib/data/pricing";
import { calculateQuote } from "@/lib/pricing/quote";

type EstimateFormProps = {
  options: PricingOptions;
};

/**
 * 报价表单。
 *
 * 只负责三件事：保存三项选择、调用 lib/pricing/quote.ts 计算、展示结果。
 * 公式不在本组件内，选项也不在本组件内（来自 data/site/pricing.md），
 * 因此调整价格或公式都不需要改这里。
 */
export function EstimateForm({ options }: EstimateFormProps) {
  const [subjectName, setSubjectName] = useState("");
  const [stageName, setStageName] = useState("");
  const [classSizeName, setClassSizeName] = useState("");

  const subject = options.subjects.find((item) => item.name === subjectName) ?? null;
  const stage = options.stages.find((item) => item.name === stageName) ?? null;
  const classSize = options.classSizes.find((item) => item.name === classSizeName) ?? null;

  const ready = subject !== null && stage !== null && classSize !== null;
  const result =
    ready && subject && stage && classSize
      ? calculateQuote({ subject, stage, classSize })
      : null;

  const toSelectOptions = (items: PricingOptions["subjects"]) =>
    items.map((item) => ({ value: item.name, label: item.name }));

  const reset = () => {
    setSubjectName("");
    setStageName("");
    setClassSizeName("");
  };

  return (
    <>
      {/* 选择区 */}
      <div className="rounded-lg border border-ink-200 bg-white p-6">
        <div className="space-y-5">
          <Select
            label={options.labels.subject}
            placeholder="请选择科目"
            options={toSelectOptions(options.subjects)}
            value={subjectName}
            onChange={(event) => setSubjectName(event.target.value)}
          />
          <Select
            label={options.labels.stage}
            placeholder="请选择学习阶段"
            options={toSelectOptions(options.stages)}
            value={stageName}
            onChange={(event) => setStageName(event.target.value)}
          />
          <Select
            label={options.labels.classSize}
            placeholder="请选择开班人数"
            hint="人数越少，单个学生的价格越高"
            options={toSelectOptions(options.classSizes)}
            value={classSizeName}
            onChange={(event) => setClassSizeName(event.target.value)}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => {
              // 三项都已选择时结果会自动出现，这里主要用于让按钮有明确反馈。
            }}
            disabled={!ready}
          >
            {options.labels.submit}
          </Button>
          <Button type="button" variant="outline" onClick={reset} disabled={!ready && subjectName === "" && stageName === "" && classSizeName === ""}>
            {options.labels.reset}
          </Button>
        </div>
      </div>

      {/* 结果区 */}
      <div className="lg:sticky lg:top-24">
        {result === null ? (
          <div className="rounded-lg border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink-500">
              选择上面三项后，这里会显示参考价格。
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-ink-200 bg-white p-6">
            <h2 className="text-sm font-medium text-ink-900">{options.labels.result}</h2>

            <div className="mt-5 flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-brand-800 tabular">
                ¥{result.unitPrice}
              </span>
              <span className="text-sm text-ink-500">/ 课时</span>
            </div>

            <dl className="mt-6 space-y-3 border-t border-ink-100 pt-5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">{options.labels.subject}</dt>
                <dd className="text-ink-800">{subject?.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">{options.labels.stage}</dt>
                <dd className="text-ink-800">{stage?.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-500">{options.labels.classSize}</dt>
                <dd className="text-ink-800">{classSize?.name}</dd>
              </div>
            </dl>

            {result.breakdown.length > 0 && (
              <div className="mt-6 border-t border-ink-100 pt-5">
                <p className="text-xs font-medium text-ink-500">价格构成</p>
                <dl className="mt-3 space-y-2 text-sm">
                  {result.breakdown.map((item) => (
                    <div key={item.label} className="flex justify-between gap-4">
                      <dt className="text-ink-500">{item.label}</dt>
                      <dd className="text-ink-700 tabular">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {options.formulaNote !== "" && (
              <p className="mt-6 rounded-md bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
                {options.formulaNote}
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
