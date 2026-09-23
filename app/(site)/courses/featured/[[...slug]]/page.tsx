import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CourseColumnCardTile } from "@/components/courses/CourseColumns";
import { CourseTree } from "@/components/courses/CourseTree";
import { PageHeader } from "@/components/site/PageHeader";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { findFeaturedCourse, getAllFeaturedCourses, getFeaturedContent } from "@/lib/data/featured";
import { getFormSubjectGroups } from "@/lib/data/site";
import { renderMarkdown } from "@/lib/markdown";
import { COURSES_HREF, courseHref, courseTrail } from "@/lib/site/featured-routes";
import Link from "next/link";

/**
 * 特色课程页面。
 *
 * 用可选 catch-all 路由同时承载两种情况：
 *   /courses/featured                                → 总览（列出全部课程）
 *   /courses/featured/课内辅导                        → 一级课程
 *   /courses/featured/课内辅导/小班课（4-8人）             → 二级课程
 *   /courses/featured/课内辅导/小班课（4-8人）/精品小升初   → 三级课程
 *
 * 每门课程都有自己的独立页面与面包屑，内容来自 data/site/featured.md。
 */
type PageProps = {
  params: Promise<{ slug?: string[] }>;
};

/**
 * 路径参数需要解码后再查表。
 * 中文课程名在 URL 里是百分号编码的，Next 传入的仍是编码后的值。
 */
function decodeSlug(slug: string[]): string[] {
  return slug.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      // 非法编码时按原值处理，交由查表失败走 404
      return segment;
    }
  });
}

/**
 * 静态导出需要显式列出全部路径。
 * 空数组表示总览页，其余每门课程一个路径（含各级）。
 */
export function generateStaticParams(): Array<{ slug: string[] }> {
  return [
    { slug: [] },
    ...getAllFeaturedCourses().map((course) => ({ slug: course.path })),
  ];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug: rawSlug = [] } = await params;
  const slug = decodeSlug(rawSlug);

  if (slug.length === 0) {
    const content = getFeaturedContent();
    return { title: content.title, description: content.description };
  }

  const found = findFeaturedCourse(slug);
  if (found === null) return { title: "课程未找到" };

  const position = found.course.fields.find((field) => field.title === "课程定位");
  return {
    title: found.course.name,
    description: position?.value ?? `${found.course.name} 课程说明`,
  };
}

export default async function FeaturedCoursePage({ params }: PageProps) {
  const { slug: rawSlug = [] } = await params;
  const slug = decodeSlug(rawSlug);

  // ── 总览 ──────────────────────────────────────────────────────────────
  if (slug.length === 0) {
    const content = getFeaturedContent();
    return (
      <>
        <PageHeader
          eyebrow={content.eyebrow}
          title={content.title}
          description={content.description}
        >
          <Breadcrumbs
            className="mt-6"
            items={[
              { label: "首页", href: "/" },
              { label: "课程", href: COURSES_HREF },
              { label: "特色课程" },
            ]}
          />
        </PageHeader>

        <Container>
          <Section>
            <CourseTree courses={content.courses} />
          </Section>

          {content.notice !== "" && (
            <Section className="pt-0">
              <p className="max-w-2xl rounded-md bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
                {content.notice}
              </p>
            </Section>
          )}
        </Container>
      </>
    );
  }

  // ── 单门课程 ──────────────────────────────────────────────────────────
  const found = findFeaturedCourse(slug);
  if (found === null) notFound();

  const { course, trail } = found;
  /*
   * 反向关联：这个班型下有哪些学科开设。
   * 关系来自课程卡片行里的 `· 班型:`，所以卡片上改了班型，这里自动跟着变。
   */
  const subjectGroups = getFormSubjectGroups(course.name);
  const subjectCount = subjectGroups.reduce(
    (total, group) => total + group.subgroups.reduce((n, sub) => n + sub.cards.length, 0),
    0,
  );

  return (
    <>
      <PageHeader eyebrow="特色课程" title={course.name}>
        <Breadcrumbs className="mt-6" items={courseTrail(trail)} />
      </PageHeader>

      <Container>
        <Section contentClassName="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div>
            {/* 课程字段：适合对象 / 课程定位 / 主要做法 / 可以期待 */}
            {course.fields.length > 0 && (
              <dl className="space-y-5">
                {course.fields.map((field) => (
                  <div key={field.title}>
                    <dt className="text-sm font-medium text-ink-900">{field.title}</dt>
                    <dd className="mt-1.5 max-w-2xl leading-relaxed text-ink-600">
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {course.body !== "" && (
              <div
                className={
                  "mt-8 max-w-2xl border-t border-ink-100 pt-8 leading-relaxed text-ink-600 " +
                  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
                  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
                  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
                }
                // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                dangerouslySetInnerHTML={{ __html: renderMarkdown(course.body) }}
              />
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="inline-flex h-10 items-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800"
              >
                咨询这门课
              </Link>
              <Link
                href="/quote"
                className="inline-flex h-10 items-center rounded-md border border-ink-300 px-4 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
              >
                查看价格
              </Link>
            </div>
          </div>

          {/* 侧栏：下级课程 */}
          {course.children.length > 0 && (
            <aside className="rounded-lg border border-ink-200 bg-white p-5">
              <h2 className="text-sm font-medium text-ink-900">更具体的班型</h2>
              <ul className="mt-3 space-y-2">
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
            </aside>
          )}
        </Section>

        {/*
          开设这个班型的科目：32 门课平铺成一列会很长、不好找，
          因此按「阶段（栏目）→ 子栏目」分组，用与课程总览一致的卡片网格。
        */}
        {subjectGroups.length > 0 && (
          <Section
            className="border-t border-ink-200"
            title="开设这个班型的科目"
            description={`共 ${subjectCount} 门课，按阶段分组；点卡片进入该科目的课程内容。`}
          >
            <div className="space-y-9">
              {subjectGroups.map((group) => (
                <section key={group.column}>
                  <h3 className="mb-5 text-lg font-medium text-ink-900">
                    <Link
                      href={group.columnHref}
                      className="transition-colors hover:text-brand-700"
                    >
                      {group.column} →
                    </Link>
                  </h3>
                  <div className="space-y-6">
                    {group.subgroups.map((subgroup) => (
                      <div key={subgroup.title}>
                        {/* 只有一个分组、且组名与栏目名相同时不重复标题 */}
                        {subgroup.title !== "" &&
                          !(group.subgroups.length === 1 && subgroup.title === group.column) && (
                            <h4 className="mb-3 text-sm font-medium text-ink-700">
                              {subgroup.title}
                            </h4>
                          )}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                          {subgroup.cards.map((card) => (
                            <CourseColumnCardTile key={card.path} card={card} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Section>
        )}
      </Container>
    </>
  );
}
