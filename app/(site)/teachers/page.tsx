import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { TeacherCard } from "@/components/teachers/TeacherCard";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getTeachersPage } from "@/lib/data/site";
import { renderMarkdown } from "@/lib/markdown";

/** 教师页内容来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const { heading } = getTeachersPage();
  return { title: heading.title, description: heading.description };
}

export default function TeachersPage() {
  const { heading, teachers } = getTeachersPage();

  return (
    <>
      <PageHeader
        eyebrow={heading.eyebrow}
        title={heading.title}
        description={heading.description}
      />

      <Container>
        {/* 教师列表：可点击跳转到下方对应详情 */}
        <Section>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {teachers.map((teacher) => (
              <TeacherCard
                key={teacher.id}
                teacher={teacher}
                href={`#${encodeURIComponent(teacher.id)}`}
              />
            ))}
          </div>
        </Section>

        {/* 教师详情 */}
        <Section className="border-t border-ink-200">
          <div className="space-y-12">
            {teachers.map((teacher) => (
              <article
                key={teacher.id}
                id={teacher.id}
                className="scroll-mt-24 border-b border-ink-100 pb-12 last:border-0 last:pb-0"
              >
                <h2 className="text-xl font-medium text-ink-900">{teacher.name}</h2>
                <p className="mt-1 text-sm text-ink-500">
                  {[teacher.role, teacher.years].filter((part) => part !== "").join(" ｜ ")}
                </p>
                {teacher.subjects.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {teacher.subjects.map((subject) => (
                      <Badge key={subject} tone="brand">
                        {subject}
                      </Badge>
                    ))}
                  </div>
                )}
                {teacher.bio !== "" && (
                  <div
                    className="mt-4 max-w-2xl leading-relaxed text-ink-600 [&_p]:mt-3 [&_strong]:font-medium [&_strong]:text-ink-800"
                    // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(teacher.bio) }}
                  />
                )}
              </article>
            ))}
          </div>
        </Section>
      </Container>
    </>
  );
}
