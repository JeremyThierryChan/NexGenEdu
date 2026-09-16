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
        {/* 快速跳转：课程较多时方便直接定位 */}
        <Section className="pb-0">
          <div className="flex flex-wrap gap-2">
            {courses.map((course) => (
              <CourseCard
                key={course.id}
                title={course.nameZh}
                href={`#${encodeURIComponent(course.id)}`}
                linkLabel="查看详情"
                className="w-40 p-4"
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
                <div
                  className="mt-4 max-w-2xl leading-relaxed text-ink-600 [&_li]:mt-1.5 [&_p]:mt-3 [&_strong]:font-medium [&_strong]:text-ink-800 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
                  // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(course.content) }}
                />
              </article>
            ))}
          </div>
        </Section>
      </Container>
    </>
  );
}
