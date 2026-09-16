import type { Metadata } from "next";
import { EstimateForm } from "@/components/pricing/EstimateForm";
import { Container } from "@/components/ui/Container";
import { getPricingOptions } from "@/lib/data/pricing";

/** 报价页选项来自 data/site/pricing.md。 */
export function generateMetadata(): Metadata {
  return {
    title: "智能报价",
    description: "选择科目、学习阶段与开班人数，立即查看参考课时价格。",
  };
}

/**
 * 智能报价页面。
 *
 * 页面只负责取值与展示：选项来自 data/site/pricing.md，
 * 计算逻辑在 lib/pricing/quote.ts（公式调整只改那一个文件）。
 */
export default function QuotePage() {
  const options = getPricingOptions();

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
              选择科目、学习阶段与开班人数，立即得到参考课时价格。人数越少单个学生的价格越高。
            </p>
          </div>
        </Container>
      </div>

      <Container>
        <div className="grid gap-8 py-14 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <EstimateForm options={options} />
        </div>
      </Container>
    </>
  );
}
