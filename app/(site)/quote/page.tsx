import type { Metadata } from "next";
import { EstimateForm } from "@/components/pricing/EstimateForm";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getPricingData } from "@/lib/data/pricing";

export const metadata: Metadata = {
  title: "智能报价",
  description:
    "选择学习阶段、课程、科目、班级类型与报课数量，即时查看参考课时价格与合计费用。",
};

/**
 * 智能报价页面。
 *
 * 页面只负责取值与展示：
 *   可选项与价格 → data/site/pricing.md
 *   计算公式     → lib/pricing/quote.ts
 */
export default function QuotePage() {
  const data = getPricingData();

  return (
    <>
      <div className="border-b border-ink-200 bg-ink-50">
        <Container className="py-14 sm:py-16">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-brand-600">智能报价</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              按需求查看参考价格
            </h1>
            <p className="mt-5 text-base leading-relaxed text-ink-600">
              选择学习阶段与课程确定基础价，再选择班级类型与报课数量，即可看到参考课时价与合计费用。
              班级人数越少，单人费用越高。
            </p>
          </div>
        </Container>
      </div>

      <Container>
        <div className="grid gap-8 py-14 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start">
          <EstimateForm data={data} />
        </div>

        {data.otherItems.length > 0 && (
          <Section title={data.labels.otherTitle} className="border-t border-ink-200">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.otherItems.map((item) => (
                <div key={item.name} className="rounded-lg border border-ink-200 bg-white p-6">
                  <h3 className="text-base font-medium text-ink-900">{item.name}</h3>
                  <dl className="mt-4 space-y-2 text-sm">
                    {item.details.map((detail) => (
                      <div key={detail.title} className="flex justify-between gap-4">
                        <dt className="text-ink-500">{detail.title}</dt>
                        <dd className="text-right text-ink-800 tabular">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </Section>
        )}
      </Container>
    </>
  );
}
