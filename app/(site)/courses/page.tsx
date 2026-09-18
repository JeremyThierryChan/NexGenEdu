import type { Metadata } from "next";
import { CourseColumns } from "@/components/courses/CourseColumns";
import { PageHeader } from "@/components/site/PageHeader";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { CourseTree } from "@/components/courses/CourseTree";
import { getFeaturedContent } from "@/lib/data/featured";
import { getCoursesPage } from "@/lib/data/site";
import { FEATURED_INDEX_HREF } from "@/lib/site/featured-routes";
import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";

/** 课程页内容来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const { heading } = getCoursesPage();
  return { title: heading.title, description: heading.description };
}

/**
 * 从学段小节标题取出锚点名：取「｜」前的部分。
 * 「小学语文｜建立阅读与表达的基础」→「小学语文」
 */
function bandAnchor(title: string): string {
  return title.split("｜")[0]?.trim() ?? title;
}

/** 课程正文的排版样式：Markdown 渲染出的 p / ul / li / strong 统一在此约束。 */
const PROSE_CLASS =
  "mt-3 max-w-2xl leading-relaxed text-ink-600 " +
  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5";

export default function CoursesPage() {
  const { heading, courses, columns, electiveTitle, electiveGroups } = getCoursesPage();
  const featured = getFeaturedContent();

  return (
    <>
      <PageHeader
        eyebrow={heading.eyebrow}
        title={heading.title}
        description={heading.description}
      />

      <Container>
        {/* 特色课程：按需求（而非按学科）选课。放在最前，
            因为「按目标选课」比「按学科浏览」更接近家长的实际决策路径。 */}
        <Section title="特色课程" description={featured.description}>
          <CourseTree courses={featured.courses} level={3} />
          <p className="mt-6">
            <Link
              href={FEATURED_INDEX_HREF}
              className="inline-flex h-8 items-center rounded-md border border-ink-300 px-3 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              查看特色课程全部班型
            </Link>
          </p>
        </Section>

        {/*
          课程总览：栏目 → 子标题 → 卡片，与首页共用同一份结构
          （「页面: 全站 → 课程栏目」）。一张卡片 = 一门课程，
          卡片与标签都跳到下方课程详情里的对应小节。
        */}
        <Section
          title="课程总览"
          description="点卡片或卡片内的标签，可跳到下方对应课程的说明。"
          className="border-t border-ink-200 pb-0"
        >
          <CourseColumns columns={columns} />
        </Section>

        {/* 课程详情：每个小节都带锚点 id，
            课程栏目里的卡片与标签借此跳到对应小节（如「小学语文」「高中物理学考」）。 */}
        <Section title="课程详情">
          <div className="space-y-12">
            {courses.map((course) => (
              <article
                key={course.id}
                id={course.id}
                className="scroll-mt-24 border-b border-ink-100 pb-12 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-xl font-medium text-ink-900">{course.nameZh}</h3>
                  {course.unavailable && (
                    <span className="rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                      暂未开放
                    </span>
                  )}
                </div>

                {course.lead !== "" && (
                  <div
                    className={PROSE_CLASS}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(course.lead) }}
                  />
                )}

                {course.bands.length > 0 && (
                  <div className="mt-6 space-y-6">
                    {course.bands.map((band) => (
                      <section
                        key={band.title}
                        id={bandAnchor(band.title)}
                        className="scroll-mt-24 rounded-lg border border-ink-200 bg-white p-5"
                      >
                        <h4 className="text-base font-medium text-ink-900">{band.title}</h4>
                        <div
                          className={PROSE_CLASS}
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(band.content) }}
                        />
                      </section>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </Section>

        {/* 选修课程：按栏目分节（外语 / 课外兴趣 / 成人课程），与首页卡片栏目一致。
            每门课带锚点 id，首页标签可跳到对应课程。 */}
        {electiveGroups.length > 0 && (
          <Section title={electiveTitle} className="border-t border-ink-200">
            <div className="space-y-10">
              {electiveGroups.map((group) => (
                <div key={group.title}>
                  {/* 只剩一个分组时不再重复一次标题（组名与区块标题相同） */}
                  {electiveGroups.length > 1 && (
                    <h3 className="text-base font-medium text-ink-900">{group.title}</h3>
                  )}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {group.items.map((course) => (
                      <div
                        key={course.id}
                        id={course.id}
                        className="scroll-mt-24 rounded-lg border border-ink-200 bg-white p-5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-medium text-ink-900">{course.name}</h4>
                          {!course.available && (
                            <span className="shrink-0 rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                              暂未开放
                            </span>
                          )}
                        </div>
                        {course.description !== "" && (
                          <p className="mt-2 text-xs leading-relaxed text-ink-600">
                            {course.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </Container>
    </>
  );
}
