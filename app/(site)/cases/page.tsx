import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { getCasesContent, getReviewsContent } from "@/lib/data/pages";
import { renderMarkdown } from "@/lib/markdown";
import { REVIEW_GROUPS } from "@/lib/types/site";
import type { CaseItem } from "@/lib/types/site";

export function generateMetadata(): Metadata {
  const content = getCasesContent();
  return { title: content.title, description: content.description };
}

/** 正文排版样式：Markdown 渲染出的段落与列表统一在此约束。 */
const PROSE_CLASS =
  "mt-3 leading-relaxed text-ink-600 " +
  "[&_li]:mt-1.5 [&_p]:mt-3 [&_p:first-child]:mt-0 " +
  "[&_strong]:font-medium [&_strong]:text-ink-800 " +
  "[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5";

/**
 * 概要行上露出来的短字段。
 *
 * 一条案例收起来之后，家长要能**一眼判断值不值得展开**：年级、科目与
 * 「入学水平 → 当前水平」这三样最有用。其余字段（辅导周期、主要问题…）留在展开后的详情里，
 * 免得概要行变成第二份正文。
 */
const SUMMARY_FIELDS = ["年级", "科目"];

/** 概要行里那几段「短字段」（只留非空的）。 */
function summaryFields(item: CaseItem): string[] {
  const parts: string[] = [];
  for (const name of SUMMARY_FIELDS) {
    const value = item.fields.find((field) => field.title === name)?.value ?? "";
    if (value !== "") parts.push(value);
  }
  if (item.from !== "" && item.to !== "") parts.push(`${item.from} → ${item.to}`);
  return parts;
}

/**
 * 学生案例页面。内容来自 `data/site/cases.md`（后台「网站内容」页维护）。
 *
 * 案例用原生 `<details>/<summary>` **默认全部收起**（机构要求"改成可以折叠"）：
 * 与常见问题页同一套写法 —— 不用客户端 JS、可被浏览器搜索命中、打印时能展开，
 * 箭头用 `group-open:rotate-45`。评价（家长 / 学生）跟在案例之后，
 * **不做折叠**（评价短，直接看得见更有用）。
 */
export default function CasesPage() {
  const content = getCasesContent();
  const reviews = getReviewsContent();

  /*
   * 声明（「案例均经家长同意后发布，学生姓名已做隐去处理。」）放在**页面最上面**：
   * 机构看到它孤零零跟在案例列表后面、与列表之间空出 64–80px（`Section` 自带的
   * `py-16 sm:py-20` 两段相叠），要求「**这部分直接放到页面第一部分以小字的形式吧**」。
   * 于是挪进 `PageHeader` 的 children 槽位（它渲染在说明文字下方，间距 28px），用 `text-xs` 小字；
   * 没有内容时传 `null` —— `PageHeader` 那边用 `!= null` 判断，不会留下空的间距块。
   */
  return (
    <>
      <PageHeader
        eyebrow={content.eyebrow}
        title={content.title}
        description={content.description}
      >
        {content.notice !== "" ? (
          <p className="text-xs leading-relaxed text-ink-500">{content.notice}</p>
        ) : null}
      </PageHeader>

      <Container>
        {/* 没有案例时说话（标题区照常显示）：见教师页同一处说明 */}
        {content.cases.length === 0 && (
          <Section className="pb-0">
            <p className="rounded-lg border border-dashed border-ink-300 bg-ink-50 px-5 py-6 text-sm leading-relaxed text-ink-500">
              案例整理中。案例内容由后台「网站内容」页维护，构站时连上后端就会显示出来。
            </p>
          </Section>
        )}

        {content.cases.length > 0 && (
          <Section contentClassName="space-y-4">
            {content.cases.map((item) => {
              // 「入学水平 → 当前水平」单独做成对比块，家长最关心这两项
              const contrast = item.from !== "" && item.to !== "";
              const restFields = item.fields.filter(
                (field) => field.title !== "入学水平" && field.title !== "当前水平",
              );
              // 概要行上的短字段（收起来时判断"要不要展开"就看这几样）
              const brief = summaryFields(item);

              return (
                /* 每条案例一个 <details>、默认收起（**不写 `open`**）：点开才看详情 */
                <details
                  key={item.id}
                  id={item.id}
                  className="group rounded-lg border border-ink-200 bg-white"
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-5 marker:content-none sm:px-8">
                    <span className="min-w-0">
                      <span className="block text-lg font-medium text-ink-900 sm:text-xl">
                        {item.title}
                      </span>
                      {brief.length > 0 && (
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                          {brief.map((part, index) => (
                            <span
                              key={`${String(index)}-${part}`}
                              className="rounded-sm bg-ink-50 px-2 py-0.5 tabular"
                            >
                              {part}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span
                      className="mt-1 shrink-0 text-ink-400 transition-transform group-open:rotate-45"
                      aria-hidden
                    >
                      ＋
                    </span>
                  </summary>

                  <div className="border-t border-ink-100 px-6 pb-6 pt-5 sm:px-8">
                    {contrast && (
                      <div className="flex flex-wrap items-center gap-4 rounded-md bg-brand-50 px-5 py-4">
                        <div>
                          <p className="text-xs text-brand-700">入学水平</p>
                          <p className="mt-1 text-base font-medium text-brand-900 tabular">
                            {item.from}
                          </p>
                        </div>
                        <span className="text-brand-400" aria-hidden>
                          →
                        </span>
                        <div>
                          <p className="text-xs text-brand-700">当前水平</p>
                          <p className="mt-1 text-base font-medium text-brand-900 tabular">
                            {item.to}
                          </p>
                        </div>
                      </div>
                    )}

                    {restFields.length > 0 && (
                      <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        {restFields.map((field) => (
                          <div key={field.title}>
                            <dt className="text-ink-500">{field.title}</dt>
                            <dd className="mt-1 text-ink-800">{field.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {item.story !== "" && (
                      <div
                        className={PROSE_CLASS}
                        // 内容来自项目自己的 Markdown 文件，renderMarkdown 内部已做 HTML 转义。
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(item.story) }}
                      />
                    )}
                  </div>
                </details>
              );
            })}
          </Section>
        )}

        {/*
          家长 / 学生评价：跟在同一页的案例之后，分「家长评价 / 学生评价」两组。
          **不做折叠** —— 评价短，直接看得见才有用；折叠反而要人多点一次。
          内容来自后台「网站内容」页的评价编辑区（v35 起在库里）。
        */}
        <Section className="border-t border-ink-200" contentClassName="space-y-8">
          <div>
            {reviews.eyebrow !== "" && (
              <p className="text-xs font-medium tracking-wide text-brand-700">{reviews.eyebrow}</p>
            )}
            <h2 className="mt-1 text-lg font-medium text-ink-900 sm:text-xl">{reviews.title}</h2>
            {reviews.description !== "" && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
                {reviews.description}
              </p>
            )}
          </div>

          {reviews.reviews.length === 0 && (
            <p className="rounded-lg border border-dashed border-ink-300 bg-ink-50 px-5 py-6 text-sm leading-relaxed text-ink-500">
              评价整理中。评价内容由后台「网站内容」页维护，构站时连上后端就会显示出来。
            </p>
          )}

          {REVIEW_GROUPS.map((group) => {
            const items = reviews.reviews.filter((item) => item.group === group.key);
            return (
              <div key={group.key}>
                <h3 className="text-base font-medium text-ink-900">{group.label}</h3>
                {items.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-400">
                    {reviews.reviews.length === 0
                      ? `这一组还没有${group.label}。`
                      : `暂时没有${group.label}。`}
                  </p>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {items.map((item) => (
                      <figure
                        key={item.id}
                        className="flex h-full flex-col justify-between rounded-lg border border-ink-200 bg-white p-5"
                      >
                        <blockquote className="whitespace-pre-line text-sm leading-relaxed text-ink-700">
                          {item.quote}
                        </blockquote>
                        <figcaption className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
                          <span className="text-ink-700">{item.author}</span>
                          {item.subject !== "" && <span className="ml-2">· {item.subject}</span>}
                          {item.description !== "" && (
                            <span className="mt-1 block text-ink-400">{item.description}</span>
                          )}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {reviews.notice !== "" && (
            <p className="max-w-2xl rounded-md bg-ink-50 px-4 py-3 text-xs leading-relaxed text-ink-500">
              {reviews.notice}
            </p>
          )}
        </Section>
      </Container>
    </>
  );
}
