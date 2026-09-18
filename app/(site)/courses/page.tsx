import type { Metadata } from "next";
import { CourseCard } from "@/components/courses/CourseCard";
import { PageHeader } from "@/components/site/PageHeader";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getFeaturedContent } from "@/lib/data/featured";
import { getCoursesPage } from "@/lib/data/site";
import { FEATURED_INDEX_HREF, courseHref } from "@/lib/site/featured-routes";
import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";

/** 课程页内容来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const { heading } = getCoursesPage();
  return { title: heading.title, description: heading.description };
}

/**
 * 从学段小节标题里取出学段名，用于卡片标签。
 * 「初中数学｜建立数学模型」→「初中」；语言类课程（雅思 / 法语等）无此形式，返回空串。
 */
function bandLabel(title: string): string {
  const match = /^(小学|初中|高中)/.exec(title.trim());
  return match?.[1] ?? "";
}

/** 课程正文的排版样式：Markdown 渲染出的 p / ul / li / strong 统一在此约束。 */
const PROSE_CLASS =
  "mt-3 max-w-2xl leading-relaxed text-ink-600 " +
  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5";

export default function CoursesPage() {
  const { heading, courses } = getCoursesPage();
  const featured = getFeaturedContent();

  return (
    <>
      <PageHeader
        eyebrow={heading.eyebrow}
        title={heading.title}
        description={heading.description}
      />

      <Container>
        {/*
          学科总览：学段以标签并排显示，同一学科的小学 / 初中 / 高中可直接对比。
          用 compact 尺寸并把列数提到 4 列（宽屏），17 个学科能一屏看完，
          不必滚动就能发现有哪些学科、各有哪些学段。
        */}
        <Section className="pb-0">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {courses.map((course) => (
              <CourseCard
                key={course.id}
                title={course.nameZh}
                bands={course.bands.map((band) => bandLabel(band.title))}
                href={`#${encodeURIComponent(course.id)}`}
                linkLabel="查看学段说明"
                compact
              />
            ))}
          </div>
        </Section>

        <Section className="border-t border-ink-200">
          <div className="space-y-12">
            {courses.map((course) => (
              <article
                key={course.id}
                id={course.id}
                className="scroll-mt-24 border-b border-ink-100 pb-12 last:border-0 last:pb-0"
              >
                <h2 className="text-xl font-medium text-ink-900">{course.nameZh}</h2>

                {/* 导语：课程名与第一个学段小节之间的文字 */}
                {course.lead !== "" && (
                  <div
                    className={PROSE_CLASS}
                    // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(course.lead) }}
                  />
                )}

                {/* 学段小节：小学 / 初中 / 高中各一段 */}
                {course.bands.length > 0 && (
                  <div className="mt-6 space-y-6">
                    {course.bands.map((band) => (
                      <section
                        key={band.title}
                        className="rounded-lg border border-ink-200 bg-white p-5"
                      >
                        <h3 className="text-base font-medium text-ink-900">{band.title}</h3>
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
        {/* 特色课程：按需求（而非按学科）选课的入口 */}
        <Section
          title="特色课程"
          description={featured.description}
          className="border-t border-ink-200"
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.courses.map((course) => (
              <div
                key={course.slug}
                className="rounded-lg border border-ink-200 bg-white p-6"
              >
                <h3 className="text-base font-medium text-ink-900">
                  <Link
                    href={courseHref(course.path)}
                    className="transition-colors hover:text-brand-700"
                  >
                    {course.name}
                  </Link>
                </h3>
                {course.fields
                  .filter((field) => field.title === "课程定位")
                  .map((field) => (
                    <p key={field.title} className="mt-2 text-sm leading-relaxed text-ink-600">
                      {field.value}
                    </p>
                  ))}
                {course.children.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {course.children.map((child) => (
                      <li key={child.slug}>
                        <Link
                          href={courseHref(child.path)}
                          className="text-sm text-brand-700 transition-colors hover:text-brand-800"
                        >
                          {child.name} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <p className="mt-6">
            <Link
              href={FEATURED_INDEX_HREF}
              className="inline-flex h-8 items-center rounded-md border border-ink-300 px-3 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              查看特色课程全部班型
            </Link>
          </p>
        </Section>
      </Container>
    </>
  );
}
