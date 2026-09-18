import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/site/PageHeader";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getAllCoursePageSlugs, getCoursePageData } from "@/lib/data/site";
import { renderMarkdown } from "@/lib/markdown";
import { COURSES_HREF, cardPageHref } from "@/lib/site/featured-routes";
import type { CourseColumnCard } from "@/lib/types/site";

/**
 * 课程卡片页：`/courses/<路径>`。
 *
 * 一张卡片 = 一个页面。卡片上的标签**不是**独立页面，而是同一页面内的阶段
 * （高中物理 → 学考 / 选考；雅思 → 口语 / 听力 / 阅读 / 写作），
 * 因此每个阶段在这里渲染成一个带锚点的小节，页面内的阶段导航互跳。
 *
 * 页面还要回答「这门课和其他阶段什么关系」，所以底部给出两组入口：
 * 同一学科的其他学段（小学语文 → 初中语文 / 高中语文），
 * 以及同栏目（同子栏目）的其他课程。
 */
type PageProps = {
  params: Promise<{ slug: string }>;
};

/** 课程正文的排版样式：Markdown 渲染出的 p / ul / li / strong 统一在此约束。 */
const PROSE_CLASS =
  "mt-4 max-w-2xl leading-relaxed text-ink-600 " +
  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5";

export function generateStaticParams(): Array<{ slug: string }> {
  return getAllCoursePageSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = getCoursePageData(decodeURIComponent(slug));
  if (data === null) return { title: "课程未找到" };

  return {
    title: data.card.title,
    description: data.intro !== "" ? data.intro : `${data.card.title} 课程说明`,
  };
}

export default async function CourseCardPage({ params }: PageProps) {
  const { slug } = await params;
  const data = getCoursePageData(decodeURIComponent(slug));
  if (data === null) notFound();

  const { card, column, subgroup, intro, overview, stages, sameSubject, sameColumn } = data;

  return (
    <>
      <PageHeader
        eyebrow={subgroup !== "" ? `${column} · ${subgroup}` : column}
        title={card.title}
        description={intro !== "" ? intro : undefined}
      >
        <Breadcrumbs
          className="mt-6"
          items={[
            { label: "首页", href: "/" },
            { label: "课程", href: COURSES_HREF },
            { label: column, href: COURSES_HREF },
            ...(subgroup !== ""
              ? [{ label: subgroup, href: COURSES_HREF }]
              : []),
            { label: card.title },
          ]}
        />
      </PageHeader>

      <Container>
        {/* 阶段导航：卡片上的标签即本页的几个阶段，页内互跳 */}
        {stages.length > 1 && (
          <Section compact className="border-b border-ink-100">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-sm text-ink-500">本课程包含</span>
              {stages.map((stage) => (
                <a
                  key={stage.anchor}
                  href={`#${encodeURIComponent(stage.anchor)}`}
                  className="text-sm text-brand-700 transition-colors hover:text-brand-800"
                >
                  {stage.title.split("｜")[0]}
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* 课程说明：卡片自带的总览小节（如雅思的总览），不属于任何标签 */}
        {overview !== null && (
          <Section compact className="border-b border-ink-100 pt-10">
            <article id={overview.anchor} className="scroll-mt-24 max-w-3xl">
              <h2 className="text-lg font-medium text-ink-900">{overview.title}</h2>
              <div
                className={PROSE_CLASS}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(overview.body) }}
              />
            </article>
          </Section>
        )}

        {/* 阶段小节：每个标签一段，锚点用于页内跳转 */}
        <Section>
          <div className="space-y-10">
            {stages.map((stage) => (
              <article
                key={stage.anchor}
                id={stage.anchor}
                className="scroll-mt-24 rounded-lg border border-ink-200 bg-white p-6 sm:p-7"
              >
                <h2 className="text-lg font-medium text-ink-900">{stage.title}</h2>
                {stage.body !== "" && (
                  <div
                    className={PROSE_CLASS}
                    // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(stage.body) }}
                  />
                )}
              </article>
            ))}

            {/* 没有阶段内容（例如尚未开放的选修课）时给出说明，而不是留白 */}
            {stages.length === 0 && (
              <p className="max-w-2xl rounded-md bg-ink-50 px-4 py-3 text-sm leading-relaxed text-ink-500">
                这门课的详细安排还在整理中，可以先联系我们了解开课时间与班型。
              </p>
            )}
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/contact"
              className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800"
            >
              咨询这门课
            </Link>
            <Link
              href="/quote"
              className="inline-flex h-10 items-center rounded-md border border-ink-300 px-4 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              查看价格
            </Link>
            <Link
              href={COURSES_HREF}
              className="inline-flex h-10 items-center rounded-md border border-ink-300 px-4 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              返回课程总览
            </Link>
          </div>
        </Section>

        {/* 与其他阶段的关联 */}
        {(sameSubject.length > 0 || sameColumn.length > 0) && (
          <Section className="border-t border-ink-200">
            <div className="grid gap-10 lg:grid-cols-2">
              {sameSubject.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-ink-900">
                    同一学科的其他学段
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    同一门学科按学段分开上课，下面是相邻的学段，便于看清进阶路径。
                  </p>
                  <RelatedCards cards={sameSubject} />
                </div>
              )}

              {sameColumn.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-ink-900">
                    {subgroup !== "" ? `${subgroup}的其他课程` : `${column}的其他课程`}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    同一栏目下的其他课程，按同样的方式上课。
                  </p>
                  <RelatedCards cards={sameColumn} />
                </div>
              )}
            </div>
          </Section>
        )}
      </Container>
    </>
  );
}

/** 关联课程入口：小卡片，整块可点。 */
function RelatedCards({ cards }: { cards: CourseColumnCard[] }) {
  return (
    <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
      {cards.map((card) => (
        <li key={card.path}>
          <Link
            href={cardPageHref(card.path)}
            className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm font-medium text-ink-900 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            {card.title}
            {card.unavailable && (
              <span className="shrink-0 rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                暂未开放
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
