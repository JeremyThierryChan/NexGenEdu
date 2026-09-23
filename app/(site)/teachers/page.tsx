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

  // 真人与 AI 智能体分开展示：两类角色性质不同，
  // 混在一个网格里容易让家长误以为智能体也是授课教师。
  const humans = teachers.filter((teacher) => teacher.kind === "teacher");
  const agents = teachers.filter((teacher) => teacher.kind === "ai");

  return (
    <>
      <PageHeader
        eyebrow={heading.eyebrow}
        title={heading.title}
        description={heading.description}
      />

      <Container>
        {/*
          一位教师都没有（没连后端、或没人勾「在宣传网站展示」）时给一句空状态。
          标题区**照常显示**（机构口径：骨架在、条目空）—— 页面上只剩一个标题
          会让人以为这一页坏了，所以这里必须说话。
        */}
        {humans.length === 0 && (
          <Section className="pb-0">
            <p className="rounded-lg border border-dashed border-ink-300 bg-ink-50 px-5 py-6 text-sm leading-relaxed text-ink-500">
              暂无展示中的教师。教师资料由后台维护，构站时连上后端就会显示出来。
            </p>
          </Section>
        )}

        {/* 授课教师：可点击跳转到下方对应详情 */}
        <Section>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {humans.map((teacher) => (
              <TeacherCard
                key={teacher.id}
                teacher={teacher}
                href={`#${encodeURIComponent(teacher.id)}`}
              />
            ))}
          </div>
        </Section>

        {/* AI 智能体：与真人教师分开，并在标题里说明用途 */}
        {agents.length > 0 && (
          <Section
            title="AI 学习伙伴"
            description="两位 AI 智能体分别负责试课诊断与阶段跟踪，作为教师的辅助工具，不直接授课，也不替代教师的判断。"
            className="border-t border-ink-200"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {agents.map((agent) => (
                <TeacherCard
                  key={agent.id}
                  agent={agent}
                  href={`#${encodeURIComponent(agent.id)}`}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 教师详情 */}
        <Section className="border-t border-ink-200">
          <div className="space-y-12">
            {teachers.map((teacher) => (
              <article
                key={teacher.id}
                id={teacher.id}
                className="scroll-mt-24 border-b border-ink-100 pb-12 last:border-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-xl font-medium text-ink-900">{teacher.name}</h2>
                  {teacher.kind === "ai" && <Badge tone="accent">AI 智能体</Badge>}
                </div>
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
                {teacher.recommendation !== "" && (
                  <p className="mt-5 max-w-2xl rounded-md bg-brand-50 px-4 py-3 text-sm leading-relaxed text-brand-800">
                    <span className="font-medium">推荐理由　</span>
                    {teacher.recommendation}
                  </p>
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
