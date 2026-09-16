import type { Metadata } from "next";
import Image from "next/image";
import { CourseCard } from "@/components/courses/CourseCard";
import { FeatureCard } from "@/components/site/FeatureCard";
import { TeacherCard } from "@/components/teachers/TeacherCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import {
  getCoursesPage,
  getHomeContent,
  getHomeSectionHeadings,
  getSiteBrand,
  getTeachersPage,
} from "@/lib/data/site";

/** 首页 metadata 来自 data/site/content.md。 */
export function generateMetadata(): Metadata {
  const brand = getSiteBrand();
  const home = getHomeContent();
  return {
    title: home.title,
    description: `${brand.brandNameZh}（${brand.brandName}）—— ${home.subtitle}。${brand.description}`,
  };
}

/**
 * 教学特色图标。
 * 图标与文案分离：数据文件只提供文字，图标按顺序从下面取，
 * 因此调整特色条目不需要改数据文件格式，也允许条目数与图标数不同。
 */
const FEATURE_ICONS = [
  <svg key="1" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="13.5" cy="8" r="2" />
    <path d="M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M12 12.5c2.5-.4 5 .7 5 3.5" strokeLinecap="round" />
  </svg>,
  <svg key="2" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 3.5h12v13H4z" strokeLinejoin="round" />
    <path d="M7 7h6M7 10h6M7 13h3" strokeLinecap="round" />
  </svg>,
  <svg key="3" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M3 16V9M8 16V4M13 16v-5M18 16H2" strokeLinecap="round" />
  </svg>,
  <svg key="4" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
    <path d="M3 8.5h14M7 3v3M13 3v3" strokeLinecap="round" />
  </svg>,
] as const;

export default function HomePage() {
  const home = getHomeContent();
  const headings = getHomeSectionHeadings();
  const { teachers } = getTeachersPage();
  const { courses } = getCoursesPage();

  return (
    <>
      {/* 首屏 */}
      <section className="border-b border-ink-200 bg-ink-50">
        <Container className="py-20 sm:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-brand-600">{home.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {home.title}
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-ink-600">{home.subtitle}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href={home.primaryCta.href} size="lg">
                {home.primaryCta.label}
              </ButtonLink>
              <ButtonLink href={home.secondaryCta.href} size="lg" variant="outline">
                {home.secondaryCta.label}
              </ButtonLink>
            </div>
          </div>

          {/*
            首屏数据独立成一行：条目数量与文字长度会随运营调整，
            放成整行后 2–5 条都能自动铺满，不会出现半行空格。
          */}
          <dl className="mt-14 grid gap-px overflow-hidden rounded-lg border border-ink-200 bg-ink-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {home.stats.map((stat) => (
              <div key={stat.title} className="bg-white px-5 py-6">
                <dt className="text-xs text-ink-500">{stat.title}</dt>
                <dd className="mt-2 text-base font-medium leading-snug text-ink-900 tabular">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      {/* 教学特色 */}
      <Container>
        <Section
          eyebrow={headings.features.eyebrow}
          title={headings.features.title}
          description={headings.features.description}
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {home.features.map((feature, index) => (
              <FeatureCard
                key={feature.title}
                icon={FEATURE_ICONS[index % FEATURE_ICONS.length]}
                title={feature.title}
                description={feature.value}
              />
            ))}
          </div>
        </Section>
      </Container>

      {/* 课程 */}
      <div className="border-y border-ink-200 bg-ink-50">
        <Container>
          <Section
            eyebrow={headings.courses.eyebrow}
            title={headings.courses.title}
            description={headings.courses.description}
          >
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {home.courses.map((entry) => {
                // 首页只显示学科名与标签，详情链接到 courses.md 中的对应课程。
                const detail = courses.find((course) => course.nameZh === entry.title);
                return (
                  <CourseCard
                    key={entry.title}
                    title={entry.title}
                    tag={entry.value}
                    href={detail === undefined ? "/courses" : `/courses#${encodeURIComponent(detail.id)}`}
                    linkLabel="查看课程详情"
                  />
                );
              })}
            </div>
            <p className="mt-6">
              <ButtonLink href={headings.coursesLink.href} variant="outline" size="sm">
                {headings.coursesLink.label}
              </ButtonLink>
            </p>
          </Section>
        </Container>
      </div>

      {/* 教师 */}
      <Container>
        <Section
          eyebrow={headings.teachers.eyebrow}
          title={headings.teachers.title}
          description={headings.teachers.description}
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {teachers.slice(0, 3).map((teacher) => (
              <TeacherCard
                key={teacher.id}
                teacher={teacher}
                href={`/teachers#${encodeURIComponent(teacher.id)}`}
              />
            ))}
          </div>
          <p className="mt-6">
            <ButtonLink href={headings.teachersLink.href} variant="outline" size="sm">
              {headings.teachersLink.label}
            </ButtonLink>
          </p>
        </Section>

        {/* 教室环境 */}
        <Section
          eyebrow={headings.classrooms.eyebrow}
          title={headings.classrooms.title}
          description={headings.classrooms.description}
          className="border-t border-ink-200"
        >
          <div className="grid gap-5 sm:grid-cols-3">
            {home.classrooms.map((room) => (
              <figure key={room.title} className="overflow-hidden rounded-lg border border-ink-200">
                {room.value === "" ? (
                  // 尚未上传照片时显示中性图片位（photo 文件名为空）
                  <div
                    className="flex aspect-4/3 items-center justify-center bg-ink-100 text-ink-300"
                    aria-hidden
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
                      <circle cx="8.5" cy="9.5" r="1.5" />
                      <path d="M3.5 17l5-4.5 4 3.5 3-2.5 5 4" />
                    </svg>
                  </div>
                ) : (
                  <Image
                    src={`/images/${room.value}`}
                    alt={room.title}
                    width={640}
                    height={480}
                    className="aspect-4/3 w-full object-cover"
                  />
                )}
                <figcaption className="bg-white px-4 py-3 text-sm text-ink-700">
                  {room.title}
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      </Container>

      {/* 底部行动号召 */}
      <div className="bg-brand-800">
        <Container className="flex flex-col items-start justify-between gap-6 py-14 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-medium text-white sm:text-2xl">
              {home.cta.title}
            </h2>
            <p className="mt-2 text-sm text-brand-100">{home.cta.description}</p>
          </div>
          <ButtonLink href={home.cta.href} size="lg" variant="secondary">
            {home.cta.label}
          </ButtonLink>
        </Container>
      </div>
    </>
  );
}
