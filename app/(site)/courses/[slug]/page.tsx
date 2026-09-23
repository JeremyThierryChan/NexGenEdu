import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/site/PageHeader";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { CourseColumnPage } from "@/components/courses/CourseColumnPage";
import {
  COLUMN_PATHS,
  getAllCourseColumnSlugs,
  getAllCoursePageSlugs,
  getCourseColumnPageData,
  getCoursePageData,
} from "@/lib/data/site";
import { renderMarkdown } from "@/lib/markdown";
import {
  COURSES_HREF,
  FEATURED_INDEX_HREF,
  cardPageHref,
} from "@/lib/site/featured-routes";
import type { CourseColumnCard } from "@/lib/types/site";

/**
 * 课程页：一个动态段承载两层内容。
 *
 *   /courses/<栏目路径>   → 学段（栏目）页：这一阶段各科目的简介
 *   /courses/<卡片路径>   → 课程卡片页：这门课的具体内容
 *
 * 两层用同一段路径，靠路径表区分：栏目路径（primary / junior / senior /
 * languages / interests / adults）与卡片路径不重叠，自检会校验这一点，
 * 避免哪天有人把卡片路径写成栏目路径导致某一层被遮住。
 *
 * 课程卡片页：`/courses/<路径>`。
 *
 * 一张卡片 = 一个页面 = **一门课的一段正文**（2026-09 起，机构要求「课程全都按照课程库里的来」）。
 * 正文里的级别 / 技能不再各占一个锚点，而是渲染成正文里的 `### 小标题`
 * （高中物理 → 学考 / 选考；雅思 → 听力 / 口语 / 阅读 / 写作；日语 → N5 / N4 / N3；
 * A1–B2；3D 建模的三个软件…），因此页面上只有「这门课」一个锚点，页内不再有阶段导航。
 *
 * 页面还要回答「这门课和其他课什么关系」，所以底部给出两组入口：
 * 同一学科的其他学段（小学语文 → 初中语文 / 高中语文），
 * 以及同栏目（同子栏目）的其他课程。
 */
type PageProps = {
  params: Promise<{ slug: string }>;
};

/**
 * 课程正文的排版样式：Markdown 渲染出的 p / ul / li / strong / h3 统一在此约束。
 *
 * `h3` 那几条是随「一门课一段正文」一起加的：正文里的小标题（`### 学考｜合格考基础`）
 * 由 `renderMarkdown` 渲染成 `<h3>`，而 Tailwind 的 preflight 把 h1–h6 重置成
 * `font-size: inherit; font-weight: inherit` —— 不在这里补样式，级别名跟正文长得
 * 一模一样，看不出是小标题（也就等于"级别信息看不见了"）。
 */
const PROSE_CLASS =
  "mt-4 max-w-2xl leading-relaxed text-ink-600 " +
  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_h3]:mt-7 [&_h3:first-child]:mt-0 [&_h3]:text-base [&_h3]:font-medium [&_h3]:text-ink-900";

/**
 * 静态导出的路径清单：栏目页（primary / junior / …）与课程卡片页各一条。
 *
 * ## 为什么一张卡片都没有时要给一个哨兵路径
 *
 * 卡片是**后端数据**（课程库）。后端没连上时那五块是**空白**（机构口径），
 * 于是这里算出来是空数组 —— 而 `output: "export"` **不接受** `generateStaticParams()`
 * 返回空数组（构建直接失败：`Page "/courses/[slug]" is missing "generateStaticParams()"`）。
 *
 * 空数组意味着"这个路由一个页面都没有"，而静态导出必须至少落一个文件，因此给一个
 * **哨兵路径**：它取不到任何数据 → 页面里 `notFound()` → 导出的是一份 404 内容。
 * 也就是说：没连后端时这些卡片页**不存在**（点进去是 404），而不是"存在但空白"。
 */
const EMPTY_SLUG_SENTINEL = "__empty__";

export function generateStaticParams(): Array<{ slug: string }> {
  const slugs = [...getAllCourseColumnSlugs(), ...getAllCoursePageSlugs()];
  return slugs.length > 0
    ? slugs.map((slug) => ({ slug }))
    : [{ slug: EMPTY_SLUG_SENTINEL }];
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const key = decodeURIComponent(slug);

  const data = getCoursePageData(key);
  if (data !== null) {
    return {
      title: data.card.title,
      description: data.intro !== "" ? data.intro : `${data.card.title} 课程说明`,
    };
  }

  const columnPage = getCourseColumnPageData(key);
  if (columnPage !== null) {
    return {
      title: `课程 · ${columnPage.title}`,
      description: `${columnPage.title}开设的科目与课程。`,
    };
  }

  return { title: "课程未找到" };
}

export default async function CourseSlugPage({ params }: PageProps) {
  const { slug } = await params;
  const key = decodeURIComponent(slug);

  // ── 学段（栏目）页 ────────────────────────────────────────────────────
  const columnPage = getCourseColumnPageData(key);
  if (columnPage !== null) {
    return (
      <>
        <PageHeader
          eyebrow="课程"
          title={columnPage.title}
          description={`${columnPage.title}开设的科目与课程，点科目名进入该科目的课程内容。`}
        >
          <Breadcrumbs
            className="mt-6"
            items={[
              { label: "首页", href: "/" },
              { label: "课程", href: COURSES_HREF },
              { label: columnPage.title },
            ]}
          />
        </PageHeader>

        <Container>
          <Section>
            <CourseColumnPage data={columnPage} />
          </Section>
        </Container>
      </>
    );
  }

  // ── 课程卡片页 ────────────────────────────────────────────────────────
  const data = getCoursePageData(key);
  if (data === null) notFound();

  const { card, column, subgroup, intro, overview, stages, sameSubject, sameColumn, forms, teachers } =
    data;

  return (
    <>
      <PageHeader
        eyebrow={subgroup !== "" ? `${column} · ${subgroup}` : column}
        title={card.title}
        description={intro !== "" ? intro : undefined}
      >
        <Breadcrumbs
          className="mt-6"
          items={[
            { label: "首页", href: "/" },
            { label: "课程", href: COURSES_HREF },
            // 栏目指向学段页（这一阶段各科目的简介），子栏目没有独立页面，留在末级
            {
              label: column,
              href: COLUMN_PATHS[column] !== undefined ? `/courses/${COLUMN_PATHS[column]}` : COURSES_HREF,
            },
            ...(subgroup !== "" ? [{ label: subgroup }] : []),
            { label: card.title },
          ]}
        />
      </PageHeader>

      <Container>
        {/*
          阶段导航：一门课有多个并列阶段时才需要（老结构下 高中物理 → 学考 / 选考）。
          现在一门课只有一段正文、级别写在正文的小标题里，因此这块平时不渲染；
          保留它是因为「卡片名与学科分组同名」的取法仍可能给出多个锚点。
        */}
        {stages.length > 1 && (
          <Section compact className="border-b border-ink-100">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="text-sm text-ink-500">本课程包含</span>
              {stages.map((stage) => (
                <a
                  key={stage.anchor}
                  href={`#${encodeURIComponent(stage.anchor)}`}
                  className="text-sm text-brand-700 transition-colors hover:text-brand-800"
                >
                  {stage.title.split("｜")[0]}
                </a>
              ))}
            </div>
          </Section>
        )}

        {/* 课程说明：老结构下卡片自带的总览小节（如雅思的总览），现在恒为 null —— 见 getCoursePageData */}
        {overview !== null && (
          <Section compact className="border-b border-ink-100 pt-10">
            <article id={overview.anchor} className="scroll-mt-24 max-w-3xl">
              <h2 className="text-lg font-medium text-ink-900">{overview.title}</h2>
              <div
                className={PROSE_CLASS}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(overview.body) }}
              />
            </article>
          </Section>
        )}

        {/* 课程正文：一门课一段，锚点就是课程名；级别 / 技能是正文里的 `### 小标题` */}
        <Section>
          <div className="space-y-10">
            {stages.map((stage) => (
              <article
                key={stage.anchor}
                id={stage.anchor}
                className="scroll-mt-24 rounded-lg border border-ink-200 bg-white p-6 sm:p-7"
              >
                <h2 className="text-lg font-medium text-ink-900">{stage.title}</h2>
                {stage.body !== "" && (
                  <div
                    className={PROSE_CLASS}
                    // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(stage.body) }}
                  />
                )}
              </article>
            ))}

            {/* 没有阶段内容（例如尚未开放的选修课）时给出说明，而不是留白 */}
            {stages.length === 0 && (
              <p className="max-w-2xl rounded-md bg-ink-50 px-4 py-3 text-sm leading-relaxed text-ink-500">
                这门课的详细安排还在整理中，可以先联系我们了解开课时间与班型。
              </p>
            )}
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
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
            <Link
              href={COURSES_HREF}
              className="inline-flex h-10 items-center rounded-md border border-ink-300 px-4 text-sm text-ink-800 transition-colors hover:border-brand-400 hover:text-brand-700"
            >
              返回课程总览
            </Link>
          </div>
        </Section>

        {/* 开设班型：同一门课按人数分成几种班型，都来自「特色课程」里的班型 */}
        {forms.length > 0 && (
          <Section className="border-t border-ink-200">
            <h2 className="text-sm font-medium text-ink-900">这门课开设的班型</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-500">
              同一门课可以按人数选择班型，人数越少教师给到单个学生的注意力越多。
            </p>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {forms.map((form) => (
                <li
                  key={form}
                  className="rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm font-medium text-ink-900"
                >
                  {form}
                </li>
              ))}
            </ul>
            <p className="mt-4">
              <Link
                href={FEATURED_INDEX_HREF}
                className="text-sm text-brand-700 transition-colors hover:text-brand-800"
              >
                查看各班型的具体说明 →
              </Link>
            </p>
          </Section>
        )}

        {/* 谁来上这门课：按教师页的「科目」字段匹配，匹配不到就说明以咨询确认为准 */}
        <Section className={forms.length > 0 ? "pt-0" : "border-t border-ink-200"}>
          <h2 className="text-sm font-medium text-ink-900">这门课谁来上</h2>
          {teachers.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {teachers.map((teacher) => (
                <li
                  key={teacher.id}
                  className="rounded-lg border border-ink-200 bg-white p-4"
                >
                  <Link
                    href={`/teachers#${encodeURIComponent(teacher.id)}`}
                    className="text-sm font-medium text-ink-900 transition-colors hover:text-brand-700"
                  >
                    {teacher.name}
                  </Link>
                  {teacher.role !== "" && (
                    <p className="mt-1 text-xs text-ink-500">{teacher.role}</p>
                  )}
                  {teacher.summary !== "" && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-600">
                      {teacher.summary}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600">
              授课教师会按学生的年级与薄弱环节安排，具体以咨询确认为准。
            </p>
          )}
        </Section>

        {/* 与其他阶段的关联 */}
        {(sameSubject.length > 0 || sameColumn.length > 0) && (
          <Section className="border-t border-ink-200">
            <div className="grid gap-10 lg:grid-cols-2">
              {sameSubject.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-ink-900">
                    同一学科的其他学段
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    同一门学科按学段分开上课，下面是相邻的学段，便于看清进阶路径。
                  </p>
                  <RelatedCards cards={sameSubject} />
                </div>
              )}

              {sameColumn.length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-ink-900">
                    {subgroup !== "" ? `${subgroup}的其他课程` : `${column}的其他课程`}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    同一栏目下的其他课程，按同样的方式上课。
                  </p>
                  <RelatedCards cards={sameColumn} />
                </div>
              )}
            </div>
          </Section>
        )}
      </Container>
    </>
  );
}

/** 关联课程入口：小卡片，整块可点。 */
function RelatedCards({ cards }: { cards: CourseColumnCard[] }) {
  return (
    <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
      {cards.map((card) => (
        <li key={card.path}>
          <Link
            href={cardPageHref(card.path)}
            className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3.5 py-2.5 text-sm font-medium text-ink-900 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            {card.title}
            {card.unavailable && (
              <span className="shrink-0 rounded-sm border border-warning-100 bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-600">
                暂未开放
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
