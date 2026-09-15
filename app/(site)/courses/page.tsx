import type { Metadata } from "next";
import { EmptyState } from "@/components/site/EmptyState";
import { PageHeader } from "@/components/site/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "课程",
  description: "数学、英语、物理、化学等学科课程设置与适合年级。",
};

/** 课程列表：Phase 3 接入 lib/data 后替换为 data/site/courses/*.md 的真实内容。 */
export default function CoursesPage() {
  return (
    <>
      <PageHeader
        eyebrow="课程"
        title="按学科与学段设置的课程"
        description="每个学科按基础巩固、同步提高、考前冲刺三个阶段组织内容，学生按测评结果进入合适阶段。"
      />

      <Container>
        <Section>
          <EmptyState
            title="课程数据待接入"
            description="课程内容将以 Markdown 维护在 data/site/courses 下，Phase 3 完成后在此自动呈现课程名称、适合年级与教学内容。"
            action={
              <ButtonLink href="/contact" variant="outline" size="sm">
                咨询课程安排
              </ButtonLink>
            }
          />
        </Section>
      </Container>
    </>
  );
}
