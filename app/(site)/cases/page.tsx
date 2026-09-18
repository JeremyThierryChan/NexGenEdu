import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getCasesContent } from "@/lib/data/pages";
import { renderMarkdown } from "@/lib/markdown";

export function generateMetadata(): Metadata {
  const content = getCasesContent();
  return { title: content.title, description: content.description };
}

/** 正文排版样式：Markdown 渲染出的段落与列表统一在此约束。 */
const PROSE_CLASS =
  "mt-3 leading-relaxed text-ink-600 " +
  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5";

/** 学生案例页面。内容来自 data/site/cases.md。 */
export default function CasesPage() {
  const content = getCasesContent();

  return (
    <>
      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        description={content.description}
      />

      <Container>
        <Section contentClassName="space-y-8">
          {content.cases.map((item) => {
            // 「入学水平 → 当前水平」单独做成对比块，家长最关心这两项
            const contrast = item.from !== "" && item.to !== "";
            const restFields = item.fields.filter(
              (field) => field.title !== "入学水平" && field.title !== "当前水平",
            );

            return (
              <article
                key={item.id}
                id={item.id}
                className="rounded-lg border border-ink-200 bg-white p-6 sm:p-8"
              >
                <h2 className="text-lg font-medium text-ink-900 sm:text-xl">
                  {item.title}
                </h2>

                {contrast && (
                  <div className="mt-5 flex flex-wrap items-center gap-4 rounded-md bg-brand-50 px-5 py-4">
                    <div>
                      <p className="text-xs text-brand-700">入学水平</p>
                      <p className="mt-1 text-base font-medium text-brand-900 tabular">
                        {item.from}
                      </p>
                    </div>
                    <span className="text-brand-400" aria-hidden>
                      →
                    </span>
                    <div>
                      <p className="text-xs text-brand-700">当前水平</p>
                      <p className="mt-1 text-base font-medium text-brand-900 tabular">
                        {item.to}
                      </p>
                    </div>
                  </div>
                )}

                {restFields.length > 0 && (
                  <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    {restFields.map((field) => (
                      <div key={field.title}>
                        <dt className="text-ink-500">{field.title}</dt>
                        <dd className="mt-1 text-ink-800">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {item.story !== "" && (
                  <div
                    className={PROSE_CLASS}
                    // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.story) }}
                  />
                )}
              </article>
            );
          })}
        </Section>

        {content.notice !== "" && (
          <Section className="pt-0">
            <p className="max-w-2xl rounded-md bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
              {content.notice}
            </p>
          </Section>
        )}
      </Container>
    </>
  );
}
