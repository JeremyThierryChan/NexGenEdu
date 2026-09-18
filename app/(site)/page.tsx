import type { Metadata } from "next";
import Image from "next/image";
import { CourseTree } from "@/components/courses/CourseTree";
import { FeatureCard } from "@/components/site/FeatureCard";
import { TeacherCard } from "@/components/teachers/TeacherCard";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getFeaturedContent } from "@/lib/data/featured";
import { getCasesContent } from "@/lib/data/pages";
import {
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

/**
 * 生成案例摘要：去掉 Markdown 标记，按字数截断。
 * 只有真正被截断时才加省略号，避免短案例出现多余的「…」。
 */
function excerpt(text: string, maxLength: number): string {
  const plain = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}

/**
 * 首页课程卡片的栏目顺序。
 *
 * 按学段从低到高排列，再排外语 —— 家长通常先看孩子当前学段。
 * 栏目名来自 content.md 卡片上的「栏目」字段，改数据即可调整归属。
 */
export default function HomePage() {
  const home = getHomeContent();
  const headings = getHomeSectionHeadings();
  const { teachers } = getTeachersPage();
  const { cases } = getCasesContent();
  const featured = getFeaturedContent();

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
            首屏数据独立成一行。

            分隔线用「单元格自带边框互相重叠」实现，不用「容器底色 + gap-px 露出底色」：
            后者在条目数填不满最后一行时（缩放或增删条目都会出现），
            空位会露出整片灰底色，看起来像多余的色块。
            这里每格给 1px 边框并用 -ml/-mt 吃掉相邻边框，空位保持白色。
          */}
          <dl className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {home.stats.map((stat) => (
              <div
                key={stat.title}
                className="-ml-px -mt-px border border-ink-200 px-5 py-6"
              >
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

      {/* 教师 */}
      <Container>
        <Section
          eyebrow={headings.teachers.eyebrow}
          title={headings.teachers.title}
          description={headings.teachers.description}
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* 首页教师卡片只展示真人教师，AI 智能体在教师页单独分区 */}
            {teachers
              .filter((teacher) => teacher.kind === "teacher")
              .slice(0, 3)
              .map((teacher) => (
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

        {/* 学生案例：摘录前两条，更多跳转到案例页 */}
        {cases.length > 0 && (
          <Section
            eyebrow={home.cases.eyebrow}
            title={home.cases.title}
            description={home.cases.description}
            className="border-t border-ink-200"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              {cases.slice(0, 2).map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-ink-200 bg-white p-6"
                >
                  <h3 className="text-base font-medium text-ink-900">{item.title}</h3>
                  {item.from !== "" && item.to !== "" && (
                    <p className="mt-3 text-sm text-ink-600">
                      <span className="tabular">{item.from}</span>
                      <span className="mx-2 text-ink-400" aria-hidden>
                        →
                      </span>
                      <span className="font-medium tabular text-brand-800">{item.to}</span>
                    </p>
                  )}
                  <p className="mt-3 text-sm leading-relaxed text-ink-600">
                    {excerpt(item.story, 90)}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-6">
              <ButtonLink href={home.cases.cta.href} variant="outline" size="sm">
                {home.cases.cta.label}
              </ButtonLink>
            </p>
          </Section>
        )}

        {/* 试课体验：家长最关心的"能不能先试试"，紧接学生案例之后 */}
        {home.trial.title !== "" && (
          <Section
            eyebrow={home.trial.eyebrow}
            title={home.trial.title}
            description={home.trial.description}
            className="border-t border-ink-200"
          >
            <div className="rounded-lg border border-ink-200 bg-white p-6 sm:p-8">
              {home.trial.points.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-3">
                  {home.trial.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-sm text-ink-700">
                      <span className="mt-0.5 shrink-0 text-brand-600" aria-hidden>
                        ✓
                      </span>
                      {point}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <ButtonLink href={home.trial.cta.href} size="sm">
                  {home.trial.cta.label}
                </ButtonLink>
                <ButtonLink href="/contact" size="sm" variant="outline">
                  预约试课
                </ButtonLink>
              </div>
            </div>
          </Section>
        )}

      {/* 课程：按班型展示（一对一定制课、一对二/三小组课、一对多小班课、
          大班课、晚托管、周中预习课），不按学科 —— 首页回答「怎么上课」，
          学科与学段的完整清单在课程页的「课程总览」。 */}
      <div className="border-y border-ink-200 bg-ink-50">
        <Container>
          <Section
            eyebrow={headings.courses.eyebrow}
            title={headings.courses.title}
            description={headings.courses.description}
          >
            <CourseTree courses={featured.courses} level={3} />
          </Section>

          <Section compact className="pt-0">
            <ButtonLink href={headings.coursesLink.href} variant="outline" size="sm">
              {headings.coursesLink.label}
            </ButtonLink>
          </Section>
        </Container>
      </div>

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
