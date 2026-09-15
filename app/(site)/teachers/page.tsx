import type { Metadata } from "next";
import { EmptyState } from "@/components/site/EmptyState";
import { PageHeader } from "@/components/site/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";

export const metadata: Metadata = {
  title: "教师团队",
  description: "授课教师的科目、教学经验与教学风格。",
};

/** 教师列表：Phase 3 接入 lib/data 后读取 data/teachers/*.md。 */
export default function TeachersPage() {
  return (
    <>
      <PageHeader
        eyebrow="教师"
        title="负责的教师团队"
        description="所有授课教师均具备三年以上一线教学经验，熟悉本地中高考命题方向。"
      />

      <Container>
        <Section>
          <EmptyState
            title="教师数据待接入"
            description="教师资料将以 Markdown 维护在 data/teachers 下，Phase 3 完成后在此展示姓名、教授科目与教学简介。"
            action={
              <ButtonLink href="/contact" variant="outline" size="sm">
                咨询教师安排
              </ButtonLink>
            }
          />
        </Section>
      </Container>
    </>
  );
}
