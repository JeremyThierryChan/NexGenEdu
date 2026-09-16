import type { Metadata } from "next";
import { CourseCard } from "@/components/courses/CourseCard";
import { PageHeader } from "@/components/site/PageHeader";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getCoursesPage } from "@/lib/data/site";
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

  return (
    <>
      <PageHeader
        eyebrow={heading.eyebrow}
        title={heading.title}
        description={heading.description}
      />

      <Container>
        {/* 学科总览：学段以标签并排显示，同一学科的小学 / 初中 / 高中可直接对比 */}
        <Section className="pb-0">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <CourseCard
                key={course.id}
                title={course.nameZh}
                bands={course.bands.map((band) => bandLabel(band.title))}
                href={`#${encodeURIComponent(course.id)}`}
                linkLabel="查看学段说明"
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
      </Container>
    </>
  );
}
