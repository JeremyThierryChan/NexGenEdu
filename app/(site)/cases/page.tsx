import type { Metadata } from "next";
import { PageHeader } from "@/components/site/PageHeader";
import { ReviewQuote } from "@/components/site/ReviewQuote";
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

                    {/*
                      任课老师（v38）：机构原话「**在每个学生卡片的右下角写上任课老师**」。
                      放在展开区域的**最后、右对齐**（text-right）= 卡片右下角；
                      收起时看不到（那是 `summary` 的地盘，只放"一眼判断要不要展开"的短字段）。
                      **空串时整行不渲染** —— 不留「任课老师：」这种半截文案。
                    */}
                    {item.teacher !== "" && (
                      <p className="mt-5 text-right text-xs text-ink-400">
                        任课老师：{item.teacher}
                      </p>
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
                  /*
                   * 评价卡片：**多列布局（masonry 效果）**，不再用等高 grid（v40）。
                   *
                   * 机构原话：「**每列卡片的高度左右卡片不需要完全相同，可以错开**」。
                   *
                   * 为什么不用 grid：`grid sm:grid-cols-2` 的同一行两张卡被默认拉伸成
                   * **一样高**（`align-items: stretch`），长短不一的评价看着别扭。
                   * 多列布局（`columns-2`）里每张卡按**自己的内容高度**排，左右自然错开。
                   *
                   * ⚠️ **两处必须自己补的东西**（多列布局不自动给）：
                   *   1. **纵向间距** —— `gap-4` 在多列布局里只变成 `column-gap`，
                   *      卡片之间不会有上下间距，因此每张卡带 `mb-4`；
                   *   2. **`break-inside-avoid`** —— 否则一张卡会被从中间劈到下一列。
                   *
                   * ⚠️ **顺序的取舍（机构要知道）**：多列布局是**列优先**填充 ——
                   * 先填满第一列、再填第二列；而 grid 是**行优先**（左→右、再下一行）。
                   * 也就是说切过来之后**第 2 条会跑到左列第二条**，而不是右列第一条。
                   * 这是这个效果的固有代价；若机构更在意行序，改回
                   * `grid gap-4 sm:grid-cols-2 items-start`（卡片各自高度、每行顶对齐）即可。
                   * 另外：多列的高度是浏览器**按内容平衡**算出来的，因此分列点由各卡高度决定，
                   * 不一定是"正好一半"。
                   *
                   * ⚠️ **顶部对齐是这个写法的天然结果，不要用偏移去做错开**（机构：
                   * 「**但是最上面的卡片顶部得对齐**」）。多列布局里**每一列的第一张卡都从
                   * 列顶开始**，两列顶部天然齐平；错开只发生在下面的卡片之间（各自高度不同）。
                   * 因此这里刻意**没有** `first:mt-*` / `odd:mt-*` / `translate-y-*` 之类的
                   * "造错开"手段 —— 一旦有人为了"更错落"给第 2、4 张卡加偏移，顶部就歪了。
                   * 卡片间距是**每张卡统一的 `mb-4`**（不是只给偶数张加）。
                   */
                  <div className="mt-4 sm:columns-2 sm:gap-4">
                    {items.map((item) => (
                      <figure
                        key={item.id}
                        /*
                         * 卡片内容与内部样式不变；只把"拉伸等高"的那三个工具类去掉
                         * （`flex h-full flex-col justify-between` 存在的唯一目的就是
                         * 把同行的卡拉到一样高、把署名行压到底部 —— 正是这一版要去掉的效果），
                         * 换成多列布局要的两样：`break-inside-avoid` + `mb-4`（纵向间距）。
                         */
                        className="mb-4 break-inside-avoid rounded-lg border border-ink-200 bg-white p-5"
                      >
                        {/*
                          评价正文走通用的双语卡片组件（v37）：有原文时多一个
                          「看原文 / 看译文」小按钮，没有原文时**不加前缀、不显示按钮**。
                          组件是 `"use client"`，因此这一页其余部分不受影响。
                        */}
                        <ReviewQuote
                          text={item.quote}
                          original={item.original}
                          originalLanguage={item.originalLanguage}
                        />
                        <figcaption className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
                          <span className="text-ink-700">{item.author}</span>
                          {item.subject !== "" && <span className="ml-2">· {item.subject}</span>}
                          {item.description !== "" && (
                            <span className="mt-1 block text-ink-400">{item.description}</span>
                          )}
                          {/*
                            任课老师（v39）：机构答「**评价卡片也加**」—— 与学生案例卡片
                            同一套口径（v38），显示在卡片**右下角**的小字。
                            放成署名那一行**之后单独一行、右对齐**：既不挤乱署名 / 科目 / 补充，
                            又正好落在卡片底部右下角（figcaption 是这张卡片的最后一块）。
                            **空串时整行不渲染** —— 不留「任课老师：」这种半截文案。
                          */}
                          {item.teacher !== "" && (
                            <p className="mt-2 text-right text-xs text-ink-400">
                              任课老师：{item.teacher}
                            </p>
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
