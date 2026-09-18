import type { Metadata } from "next";
import Link from "next/link";
import { CourseColumns } from "@/components/courses/CourseColumns";
import { PageHeader } from "@/components/site/PageHeader";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { CourseTree } from "@/components/courses/CourseTree";
import { getFeaturedContent } from "@/lib/data/featured";
import { getCoursesPage } from "@/lib/data/site";
import { FEATURED_INDEX_HREF } from "@/lib/site/featured-routes";

/** 课程页内容来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const { heading } = getCoursesPage();
  return { title: heading.title, description: heading.description };
}

export default function CoursesPage() {
  const { heading, columns } = getCoursesPage();
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
          description="点卡片进入这门课的页面；卡片里的标签是同一页面内的不同阶段。"
          className="border-t border-ink-200 pb-0"
        >
          <CourseColumns columns={columns} />
        </Section>

        {/*
          课程详情已改为「一张卡片一个页面」：点课程总览里的卡片或标签，
          进入 /courses/<路径>，卡片上的标签是那个页面里的不同阶段。
          因此这里不再内联渲染全部学科正文，也不再需要页内锚点。
        */}
      </Container>
    </>
  );
}
