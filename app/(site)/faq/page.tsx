import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getFaqContent } from "@/lib/data/pages";
import { renderMarkdown } from "@/lib/markdown";

export function generateMetadata(): Metadata {
  const content = getFaqContent();
  return { title: content.title, description: content.description };
}

/**
 * 常见问题页面。内容来自 data/site/faq.md。
 *
 * 用原生 <details>/<summary> 做折叠：无需客户端 JS、可被浏览器搜索命中、
 * 打印时也能展开，比自建折叠组件更可靠。
 */
export default function FaqPage() {
  const content = getFaqContent();

  return (
    <>
      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        description={content.description}
      />

      <Container>
        {/*
          没连后端时：**分组标题照常显示、问答为空**（机构口径：骨架在、条目空）——
          这里给一句空状态，否则只有一行标题会让人以为页面坏了。
        */}
        {content.count === 0 && (
          <Section className="pb-0">
            <p className="rounded-lg border border-dashed border-ink-300 bg-ink-50 px-5 py-6 text-sm leading-relaxed text-ink-500">
              暂无常见问题。以下分组标题是页面结构，问答内容由后台「网站内容」页维护 ——
              构站时连上后端就会显示出来。
            </p>
          </Section>
        )}

        <Section contentClassName="space-y-10">
          {content.groups.map((group) => (
            <div key={group.title}>
              <h2 className="text-base font-medium text-ink-900">{group.title}</h2>
              {group.items.length === 0 ? (
                <p className="mt-3 text-sm text-ink-400">这一组暂时没有问题。</p>
              ) : (
              <div className="mt-4 divide-y divide-ink-100 overflow-hidden rounded-lg border border-ink-200 bg-white">
                {group.items.map((item) => (
                  <details key={item.question} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-medium text-ink-900 marker:content-none">
                      <span>{item.question}</span>
                      <span
                        className="mt-0.5 shrink-0 text-ink-400 transition-transform group-open:rotate-45"
                        aria-hidden
                      >
                        ＋
                      </span>
                    </summary>
                    <div
                      className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600 [&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 [&_strong]:font-medium [&_strong]:text-ink-800 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
                      // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.answer) }}
                    />
                  </details>
                ))}
              </div>
              )}
            </div>
          ))}
        </Section>

        <Section className="border-t border-ink-200 content-center" contentClassName="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-base font-medium text-ink-900">还有其它问题？</h2>
            <p className="mt-1 text-sm text-ink-600">
              直接电话或微信联系我们，说明学生的年级与科目，我们会给出具体建议。
            </p>
          </div>
          <ButtonLink href="/contact" className="shrink-0">
            联系我们
          </ButtonLink>
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
