"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { DataNotice } from "@/components/admin/DataNotice";
import { LoadFailure } from "@/components/admin/LoadFailure";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { api, type SiteContentBlocks } from "@/lib/backend/api";
import { SITE_COPY_KEYS, SITE_COPY_LABELS } from "@/lib/backend/site-copy-model";
import { SiteCopyEditor } from "@/components/admin/SiteCopyEditor";
import { REVIEW_GROUPS } from "@/lib/types/site";
import type {
  SiteCase,
  SiteCasesPage,
  SiteCopyBlock,
  SiteCopyKey,
  SiteFaqGroup,
  SiteFaqPage,
  SiteFeaturedCourse,
  SiteFeaturedPage,
  SiteReview,
  SiteReviewsPage,
} from "@/lib/backend/api";
import { FeaturedCoursesEditor } from "@/components/admin/FeaturedCoursesEditor";

/**
 * 「网站内容」页的草稿。
 *
 * 与 `SiteContentBlocks` 只差一处：**评价块可能读不到**（后端比程序旧、不认识
 * `site.getBlocks`，或这一页拿到了公开快照那份——不能编辑实名）。
 * 那种情况下它是 `null`，页面显示"读不到评价"并**不把评价交上去**
 * （交上去等于用"我读不到"去覆盖库里那份，正是这一页最不该做的事）。
 */
type ContentDraft = Omit<SiteContentBlocks, "reviewsPage"> & {
  reviewsPage: SiteReviewsPage | null;
};

/**
 * 网站内容（宣传网站上那些**对外文案**）。
 *
 * ## 这一页管什么、不管什么
 *
 * 管：**学生案例**（`/cases` 页与首页那块案例区的内容来源）。
 * 不管：课程正文（学科 → 小节）在「课程库」页 —— 它和卡片靶点、报价在同一张表单里，
 *      改一处要看另一处；两块内容因此各有一个页面、各有一个保存方法
 *      （`site.saveBlocks` / `site.saveContent`），互不覆盖（见 `lib/backend/api.ts` 的注释）。
 *
 * ## 为什么案例要进库（机构明确要求"以后端为主"）
 *
 * 案例原先只在 `data/site/cases.md` 里：改一条分数要打开文件、改完还要重新构站，
 * 而招生老师在后台根本看不到这些内容 —— 而案例恰恰是**要经常更新**的东西
 * （新学生进来、老案例过时）。
 *
 * ## 与网站的关系（页面上也写着）
 *
 * 保存之后，**下一次构站**（`npm run build`，构站那台机器连着后端）网站就按库里的内容出。
 * 构站那台机器连不上后端时（例如 GitHub Pages），网站整体用 `data/site/cases.md` 那份模版
 * —— 这是全站统一的两态口径，不是这一页的特殊行为。
 */
export default function AdminContentPage() {
  const [content, setContent] = useState<ContentDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** 读不到的原因（读不到就整块说明 + 重试，而不是停在一行"加载中…"）。 */
  const [loadError, setLoadError] = useState("");
  const notice = useActionNotice();

  const auth = useAuth();
  const roles = rolesOrAll(auth);
  const canWrite = canCallMethod(roles, "site.saveBlocks");

  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet === true) setRefreshing(true);
    else setLoading(true);
    try {
      /*
       * 读的是**后台内部**那一份（`site.getBlocks`），不是公开快照。
       *
       * v36 的「真实姓名」是内部字段：公开快照（`site.publicContent`，匿名也能读）
       * 的白名单里**故意没有**它。这一页要能看见并编辑实名，因此必须走内部读法 ——
       * 读公开快照的话实名永远是空的，一保存还会把库里已录的清掉。
       *
       * 内部读法拿不到时（后端比程序旧 / 没权限）**回落到公开快照**：
       * 其余四块照常能编，评价块置 `null`（页面显示"读不到评价"，且不交上去）。
       * 这样"后端旧"只影响评价这一块，不会让整页打不开。
       */
      let draft: ContentDraft;
      try {
        const blocks = await api.site.getBlocks();
        draft = blocks;
      } catch {
        const data = await api.site.publicContent();
        draft = {
          casesPage: data.siteContent.casesPage,
          featuredPage: data.siteContent.featuredPage,
          faqPage: data.siteContent.faqPage,
          copy: data.siteContent.copy,
          // 公开快照里评价是**匿名版**：不拿它当草稿（会把实名清掉），宁可说读不到
          reviewsPage: null,
        };
      }
      setContent(draft);
      setLoadError("");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "读不到网站内容。");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const casesPage: SiteCasesPage | null = content?.casesPage ?? null;
  const featuredPage: SiteFeaturedPage | null = content?.featuredPage ?? null;
  const faqPage: SiteFaqPage | null = content?.faqPage ?? null;
  const reviewsPage: SiteReviewsPage | null = content?.reviewsPage ?? null;
  /** 正在编辑哪一块页面文案（五块共用一套编辑器，用页签切换）。 */
  const [copyKey, setCopyKey] = useState<SiteCopyKey>("brand");
  const copyBlock: SiteCopyBlock | null = content?.copy?.[copyKey] ?? null;

  /**
   * 就地改草稿：`content` 是**整份** `siteContent`，保存时只把 `casesPage` 交上去
   * （服务端会把其余块原样保留），因此这里改动也只落在 `casesPage` 上。
   */
  function editCasesPage(patch: (draft: SiteCasesPage) => SiteCasesPage): void {
    setContent((prev) => (prev === null ? prev : { ...prev, casesPage: patch(prev.casesPage) }));
    notice.clear();
  }

  /** 特色课程树的节点总数（"共几门"那句话要的是这个数，不是一级课程数）。 */
  function countFeatured(courses: readonly SiteFeaturedCourse[]): number {
    return courses.reduce((sum, course) => sum + 1 + countFeatured(course.children), 0);
  }

  /** 常见问题的问答总数（"共几条"那句话用它）。 */
  function countFaq(groups: readonly SiteFaqGroup[]): number {
    return groups.reduce((sum, group) => sum + group.items.length, 0);
  }

  /** 改某一块页面文案的草稿（整块一起交，与案例 / 特色课程 / 常见问题同一套做法）。 */
  function editCopyBlock(key: SiteCopyKey, next: SiteCopyBlock): void {
    setContent((prev) => (prev === null ? prev : { ...prev, copy: { ...prev.copy, [key]: next } }));
    notice.clear();
  }

  /** 改常见问题草稿（整份分组一起交，与案例 / 特色课程同一套做法）。 */
  function editFaqPage(next: SiteFaqPage): void {
    setContent((prev) => (prev === null ? prev : { ...prev, faqPage: next }));
    notice.clear();
  }

  /** 改特色课程草稿（整棵树一起交，与案例同一套做法）。 */
  function editFeaturedPage(next: SiteFeaturedPage): void {
    setContent((prev) => (prev === null ? prev : { ...prev, featuredPage: next }));
    notice.clear();
  }

  /** 改家长 / 学生评价草稿（整份一起交，与案例 / 常见问题同一套做法）。 */
  function editReviewsPage(next: SiteReviewsPage): void {
    setContent((prev) => (prev === null ? prev : { ...prev, reviewsPage: next }));
    notice.clear();
  }

  /** 改一条评价的某个字段（分组 / 署名 / 科目 / 正文 / 补充 / 真实姓名）。 */
  function updateReview(index: number, patch: Partial<SiteReview>): void {
    if (reviewsPage === null) return;
    editReviewsPage({
      ...reviewsPage,
      reviews: reviewsPage.reviews.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  function addReview(): void {
    if (reviewsPage === null) return;
    // id 留空：服务端保存时生成；分组给个默认值（下拉里那两个之一）
    // `realName` 从空串起步：它是**内部实名**（只在后台显示），机构可以以后慢慢补
    editReviewsPage({
      ...reviewsPage,
      reviews: [
        ...reviewsPage.reviews,
        {
          id: "",
          group: REVIEW_GROUPS[0].key,
          quote: "",
          author: "",
          subject: "",
          description: "",
          realName: "",
        },
      ],
    });
  }

  function removeReview(index: number): void {
    if (reviewsPage === null) return;
    const target = reviewsPage.reviews[index];
    if (
      !window.confirm(
        `删除评价「${target?.author === "" || target === undefined ? "（未填署名）" : target.author}」？`,
      )
    ) {
      return;
    }
    editReviewsPage({
      ...reviewsPage,
      reviews: reviewsPage.reviews.filter((_item, i) => i !== index),
    });
  }

  function moveReview(index: number, delta: -1 | 1): void {
    if (reviewsPage === null) return;
    const swap = index + delta;
    if (swap < 0 || swap >= reviewsPage.reviews.length) return;
    const next = [...reviewsPage.reviews];
    const moved = next[index]!;
    next[index] = next[swap]!;
    next[swap] = moved;
    editReviewsPage({ ...reviewsPage, reviews: next });
  }

  function updateCase(id: string, patch: Partial<SiteCase>): void {
    editCasesPage((page) => ({
      ...page,
      cases: page.cases.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }

  function addCase(): void {
    // id 留空：服务端保存时生成（页面不需要知道 id 怎么来）
    editCasesPage((page) => ({
      ...page,
      cases: [
        ...page.cases,
        {
          id: "",
          title: "",
          fields: [
            { title: "年级", value: "" },
            { title: "科目", value: "" },
            { title: "入学水平", value: "" },
            { title: "当前水平", value: "" },
            { title: "辅导周期", value: "" },
            { title: "主要问题", value: "" },
          ],
          story: "",
        },
      ],
    }));
  }

  function removeCase(id: string): void {
    const target = casesPage?.cases.find((item) => item.id === id || (item.id === "" && id === ""));
    if (!window.confirm(`删除案例「${target?.title === "" || target === undefined ? "（未填标题）" : target.title}」？`)) {
      return;
    }
    editCasesPage((page) => ({
      ...page,
      // 草稿里新加的案例 id 是空串：那种情况下按下标删（同一次编辑里只有一个空 id）
      cases: page.cases.filter((item) => (id === "" ? item.id !== "" : item.id !== id)),
    }));
  }

  function moveCase(index: number, delta: -1 | 1): void {
    const swap = index + delta;
    if (casesPage === null || swap < 0 || swap >= casesPage.cases.length) return;
    editCasesPage((page) => {
      const next = [...page.cases];
      const moved = next[index]!;
      next[index] = next[swap]!;
      next[swap] = moved;
      return { ...page, cases: next };
    });
  }

  async function save(): Promise<void> {
    if (casesPage === null || featuredPage === null || faqPage === null || content === null) return;
    notice.clear();
    try {
      const saved = await notice.run(async () =>
        await api.site.saveBlocks({
          casesPage,
          featuredPage,
          faqPage,
          copy: content.copy,
          /*
           * 评价块：**后端版本太旧（读不到这一块）时不交上去**。
           * 旧后端不认识 `reviewsPage`，交上去会被静默忽略 ——
           * 那正是"看着保存成功、其实没存"的假成功，宁可这一次不保存它，
           * 页面上也已经写明"读不到评价（后端版本可能太旧）"。
           */
          ...(reviewsPage === null ? {} : { reviewsPage }),
        }),
      );
      if (saved !== null) setContent(saved);
      notice.succeed(
        `已保存学生案例 ${casesPage.cases.length} 条、特色课程 ${countFeatured(featuredPage.courses)} 门、` +
          `常见问题 ${countFaq(faqPage.groups)} 条` +
          (reviewsPage === null ? "" : `、家长与学生评价 ${reviewsPage.reviews.length} 条`) +
          "。" +
          "下一次构站（npm run build，且那台机器连着后端）网站就会按这份内容出。",
      );
    } catch {
      // `run` 已经把服务端原话放进 notice.error，这里不再翻译一遍
    }
  }

  const dirtyHint = useMemo(
    () =>
      "保存后网站要**重新构站**才更新（`npm run build`）；构站那台机器连不上后端时，" +
      "网站整体用 data/site/*.md 那份模版（案例与评价分别是 cases.md / reviews.md）。",
    [],
  );

  if (loading) {
    return (
      <>
        <PageHeading title="网站内容" description="宣传网站上的对外文案。" />
        <p className="mt-6 text-sm text-ink-400">加载中…</p>
      </>
    );
  }

  if (content === null) {
    return (
      <>
        <PageHeading title="网站内容" description="宣传网站上的对外文案。" />
        {/*
          重试走**安静刷新**（`{ quiet: true }`）：这一页的加载态由 `loading` 管，
          首屏那一次必须是裸 `load()`（自检只允许每页一处），重试时页面上已经有
          "读不到"这句话在看，不需要再把它换成"加载中…"（那反而是一次跳动）。
        */}
        <LoadFailure error={loadError} onRetry={() => void load({ quiet: true })} />
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="网站内容"
        description="宣传网站上的对外文案。目前是学生案例（/cases 与首页那块案例区的来源）。"
      />

      <div className="mt-4">
        <DataNotice onRefresh={() => void load({ quiet: true })} />
      </div>

      <Panel
        className="mt-4 mb-8"
        title="学生案例"
        description={dirtyHint}
        actions={
          canWrite ? (
            <span className="flex items-center gap-2">
              {refreshing && <span className="text-xs text-ink-400">刷新中…</span>}
              <Button variant="outline" size="sm" onClick={addCase}>
                新增案例
              </Button>
              <Button size="sm" disabled={notice.pending} onClick={() => void save()}>
                {notice.pending ? "保存中…" : "保存"}
              </Button>
            </span>
          ) : undefined
        }
      >
        <div className="px-4 py-4">
          {!canWrite && (
            <p className="mb-3 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
              你的角色可以看这些内容，但不能改（{methodOwnerText("site.saveBlocks")}）。
            </p>
          )}

          <ActionNoticeView notice={notice} className="mb-3" />

          {/* 页面标题区（eyebrow / title / description）——与网站那一页的头部一一对应 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label="页眉小字"
              value={casesPage?.heading.eyebrow ?? ""}
              onChange={(event) =>
                editCasesPage((page) => ({ ...page, heading: { ...page.heading, eyebrow: event.target.value } }))
              }
              disabled={!canWrite}
            />
            <TextField
              label="页面标题"
              value={casesPage?.heading.title ?? ""}
              onChange={(event) =>
                editCasesPage((page) => ({ ...page, heading: { ...page.heading, title: event.target.value } }))
              }
              disabled={!canWrite}
            />
            <TextField
              label="页脚提示"
              hint="例如「案例均经家长同意后发布」。留空则不显示"
              value={casesPage?.notice ?? ""}
              onChange={(event) => editCasesPage((page) => ({ ...page, notice: event.target.value }))}
              disabled={!canWrite}
            />
          </div>
          <div className="mt-3">
            <TextAreaField
              label="页面说明"
              rows={2}
              value={casesPage?.heading.description ?? ""}
              onChange={(event) =>
                editCasesPage((page) => ({ ...page, heading: { ...page.heading, description: event.target.value } }))
              }
              disabled={!canWrite}
            />
          </div>

          {(casesPage?.cases.length ?? 0) === 0 ? (
            <p className="mt-4 rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500">
              还没有案例。网站那一页会显示成「案例整理中」的空状态 ——
              想让家长看到真实过程，点右上角「新增案例」加一条（**请勿编造**，姓名可隐去）。
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {casesPage?.cases.map((item, index) => (
                <li key={item.id === "" ? `new-${String(index)}` : item.id} className="rounded-md border border-ink-200 bg-white px-3 py-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-64 flex-1">
                      <TextField
                        label={`案例 ${String(index + 1)} 标题`}
                        hint="形如「初二 李同学｜数学从 62 分到 91 分」"
                        value={item.title}
                        onChange={(event) => updateCase(item.id, { title: event.target.value })}
                        disabled={!canWrite}
                      />
                    </div>
                    {canWrite && (
                      <span className="flex items-center gap-1 pb-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveCase(index, -1)}
                          className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === (casesPage?.cases.length ?? 0) - 1}
                          onClick={() => moveCase(index, 1)}
                          className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCase(item.id)}
                          className="rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600"
                        >
                          删除
                        </button>
                      </span>
                    )}
                  </div>

                  {/*
                    字段是「名字 + 值」的可增删列表（与内容文件里的 `#### 字段: 值` 对应）：
                    不同案例关心的东西不一样（艺术类写「考级等级」），固定成六个字段
                    就得为每个新字段加一次迁移。
                  */}
                  <div className="mt-3 space-y-2">
                    {item.fields.map((field, fieldIndex) => (
                      <div key={`${item.id}-${String(fieldIndex)}`} className="flex flex-wrap items-center gap-2">
                        <input
                          value={field.title}
                          disabled={!canWrite}
                          onChange={(event) =>
                            updateCase(item.id, {
                              fields: item.fields.map((entry, i) =>
                                i === fieldIndex ? { ...entry, title: event.target.value } : entry,
                              ),
                            })
                          }
                          placeholder="字段名（如 入学水平）"
                          className="h-8 w-32 rounded-md border border-ink-200 px-2 text-xs outline-none focus:border-brand-400 disabled:bg-ink-50"
                        />
                        <input
                          value={field.value}
                          disabled={!canWrite}
                          onChange={(event) =>
                            updateCase(item.id, {
                              fields: item.fields.map((entry, i) =>
                                i === fieldIndex ? { ...entry, value: event.target.value } : entry,
                              ),
                            })
                          }
                          placeholder="值（如 62 分（期中））"
                          className="h-8 min-w-48 flex-1 rounded-md border border-ink-200 px-2 text-xs outline-none focus:border-brand-400 disabled:bg-ink-50"
                        />
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() =>
                              updateCase(item.id, {
                                fields: item.fields.filter((_entry, i) => i !== fieldIndex),
                              })
                            }
                            className="text-[11px] text-ink-400 hover:text-danger-600"
                          >
                            删除字段
                          </button>
                        )}
                      </div>
                    ))}
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => updateCase(item.id, { fields: [...item.fields, { title: "", value: "" }] })}
                        className="rounded-sm border border-dashed border-ink-300 px-2 py-1 text-[11px] text-ink-500 hover:border-brand-400 hover:text-brand-700"
                      >
                        + 加一个字段
                      </button>
                    )}
                  </div>

                  <div className="mt-3">
                    <TextAreaField
                      label="过程描述"
                      hint="段落之间空一行；写清「入学时是什么问题、先做了什么、后来怎么变」"
                      rows={4}
                      value={item.story}
                      onChange={(event) => updateCase(item.id, { story: event.target.value })}
                      disabled={!canWrite}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            网站上这一页在 <Link href="/cases" className="text-brand-700 hover:underline">/cases</Link>
            ，首页下方那块「学生案例」也取自同一份数据。**请勿编造**：写真实的过程与数字，
            姓名用「初二 李同学」这类称呼（页面底部会显示上面那句页脚提示）。
          </p>
        </div>
      </Panel>

      {/*
        家长 / 学生评价（v35 起在库里）：同一页（/cases）里、案例之后那一块。
        分「家长 / 学生」两组，**页面上不折叠**（评价短，直接看得见更有用）。
        保存按钮就在这一块上 —— 与案例 / 常见问题等一起提交，服务端各写各的块。
        ⚠️ 写真实评价（可隐去姓名）：**请勿编造**，页面上会显示下面那句页脚提示。
        v36：每条多一格**真实姓名**（内部实名，只在后台与库里；前台一个字都不显示）。
      */}
      <Panel
        className="mb-8"
        title="家长与学生评价"
        description="网站「学生案例」页里那块「家长与学生怎么说」：分家长 / 学生两组，评价短、页面上不折叠。写真实评价（可隐去姓名），请勿编造。「真实姓名」只给后台自己看，前台不会显示它。"
        actions={
          canWrite && reviewsPage !== null ? (
            <Button variant="outline" size="sm" onClick={addReview}>
              新增评价
            </Button>
          ) : undefined
        }
      >
        <div className="px-4 py-4">
          {reviewsPage === null ? (
            <p className="text-sm text-ink-500">
              读不到评价（后端版本可能太旧）：新增区块要重启后端才会生效，重启后再回到这一页。
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <TextField
                  label="页眉小字"
                  value={reviewsPage.heading.eyebrow}
                  onChange={(event) =>
                    editReviewsPage({
                      ...reviewsPage,
                      heading: { ...reviewsPage.heading, eyebrow: event.target.value },
                    })
                  }
                  disabled={!canWrite}
                />
                <TextField
                  label="区块标题"
                  value={reviewsPage.heading.title}
                  onChange={(event) =>
                    editReviewsPage({
                      ...reviewsPage,
                      heading: { ...reviewsPage.heading, title: event.target.value },
                    })
                  }
                  disabled={!canWrite}
                />
                <TextField
                  label="页脚提示"
                  hint="例如「评价均经家长/学生同意后发布」。留空则不显示"
                  value={reviewsPage.notice}
                  onChange={(event) => editReviewsPage({ ...reviewsPage, notice: event.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div className="mt-3">
                <TextAreaField
                  label="区块说明"
                  rows={2}
                  value={reviewsPage.heading.description}
                  onChange={(event) =>
                    editReviewsPage({
                      ...reviewsPage,
                      heading: { ...reviewsPage.heading, description: event.target.value },
                    })
                  }
                  disabled={!canWrite}
                />
              </div>

              <p className="mt-3 text-xs text-ink-500">
                共 {reviewsPage.reviews.length} 条评价（
                {REVIEW_GROUPS.map(
                  (group) =>
                    `${group.key} ${String(reviewsPage.reviews.filter((item) => item.group === group.key).length)} 条`,
                ).join(" / ")}
                ）。一条都没有时，网站上显示「评价整理中」—— 那是正常状态，不要用示例文字凑数。
              </p>

              {reviewsPage.reviews.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500">
                  还没有评价。点右上角「新增评价」加一条真实评价（可隐去姓名）——
                  **请勿编造**：没写过的评价不要挂上去，宁可就先空着。
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {reviewsPage.reviews.map((item, index) => (
                    <li
                      key={item.id === "" ? `new-review-${String(index)}` : item.id}
                      className="rounded-md border border-ink-200 bg-white px-3 py-3"
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-56 flex-1">
                          <TextField
                            label="署名"
                            hint="形如「初二 李同学家长」（可隐去姓名）"
                            value={item.author}
                            onChange={(event) => updateReview(index, { author: event.target.value })}
                            disabled={!canWrite}
                          />
                        </div>
                        {/*
                          列表上就能看出实名有没有填（v36）：署名旁边一行小字 ——
                          实名是内部信息，**只在这里显示**，前台一个字都不显示。
                        */}
                        <span className="pb-2.5 text-[11px] text-ink-500">
                          {item.realName.trim() === ""
                            ? "后台实名未填（前台照旧匿名）"
                            : `后台实名：${item.realName.trim()}`}
                        </span>
                        <div className="w-40">
                          <SelectInput
                            label="分组"
                            options={REVIEW_GROUPS.map((group) => ({
                              value: group.key,
                              label: group.label,
                            }))}
                            value={item.group}
                            onChange={(event) => updateReview(index, { group: event.target.value })}
                            disabled={!canWrite}
                          />
                        </div>
                        <div className="min-w-40 flex-1">
                          <TextField
                            label="科目"
                            hint="可留空"
                            value={item.subject}
                            onChange={(event) => updateReview(index, { subject: event.target.value })}
                            disabled={!canWrite}
                          />
                        </div>
                        <div className="min-w-40 flex-1">
                          {/*
                            v36：**真实姓名**（内部实名）。提示语里必须写明"前台不会显示它" ——
                            机构填的时候最怕的就是"填了会不会把全名挂到网站上"。
                          */}
                          <TextField
                            label="真实姓名（只在后台显示）"
                            hint="机构的内部实名，例：某某某／某某某妈妈。**前台不会显示它**（前台照旧显示上面那行署名）"
                            value={item.realName}
                            onChange={(event) => updateReview(index, { realName: event.target.value })}
                            disabled={!canWrite}
                          />
                        </div>
                        {canWrite && (
                          <span className="flex items-center gap-1 pb-1">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => moveReview(index, -1)}
                              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={index === reviewsPage.reviews.length - 1}
                              onClick={() => moveReview(index, 1)}
                              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeReview(index)}
                              className="rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600"
                            >
                              删除
                            </button>
                          </span>
                        )}
                      </div>

                      <div className="mt-3">
                        <TextAreaField
                          label="评价正文"
                          hint="家长 / 学生的原话；一条一段"
                          rows={3}
                          value={item.quote}
                          onChange={(event) => updateReview(index, { quote: event.target.value })}
                          disabled={!canWrite}
                        />
                      </div>
                      <div className="mt-3">
                        <TextAreaField
                          label="补充"
                          hint="可留空；写了会显示在署名下方"
                          rows={2}
                          value={item.description}
                          onChange={(event) => updateReview(index, { description: event.target.value })}
                          disabled={!canWrite}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {canWrite && reviewsPage !== null && (
            <div className="mt-4 flex items-center gap-3 border-t border-ink-100 pt-4">
              <Button disabled={notice.pending} onClick={() => void save()}>
                {notice.pending ? "保存中…" : "保存评价"}
              </Button>
              <span className="text-xs text-ink-500">
                与上面的学生案例、常见问题、特色课程**一起提交**（同一份「网站内容」草稿）。
              </span>
            </div>
          )}
        </div>
      </Panel>

      {/*
        常见问题（v21 起在库里）：分组 → 问答。分组标题就是网站上的**分区标题**，
        机构要求"以后端内容为主，前端只根据后端"，因此它整份在库里维护。
        保存按钮在第一块面板上 —— 三块内容一次交上去，服务端各写各的块（互不覆盖）。
      */}
      <Panel
        className="mb-8"
        title="常见问题"
        description="分组标题是网站上的分区标题；每组下面是问答。网站 /faq 以后端这份内容为准。"
        actions={
          canWrite ? (
            <Button
              variant="outline"
              size="sm"
              disabled={faqPage === null}
              onClick={() => {
                if (faqPage === null) return;
                editFaqPage({
                  ...faqPage,
                  groups: [
                    ...faqPage.groups,
                    { id: "", title: "", items: [{ id: "", question: "", answer: "" }] },
                  ],
                });
              }}
            >
              新增分组
            </Button>
          ) : undefined
        }
      >
        <div className="px-4 py-4">
          {faqPage === null ? (
            <p className="text-sm text-ink-500">读不到常见问题（后端版本可能太旧）。</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <TextField
                  label="页眉小字"
                  value={faqPage.heading.eyebrow}
                  onChange={(event) => editFaqPage({ ...faqPage, heading: { ...faqPage.heading, eyebrow: event.target.value } })}
                  disabled={!canWrite}
                />
                <TextField
                  label="页面标题"
                  value={faqPage.heading.title}
                  onChange={(event) => editFaqPage({ ...faqPage, heading: { ...faqPage.heading, title: event.target.value } })}
                  disabled={!canWrite}
                />
                <TextField
                  label="页脚提示"
                  value={faqPage.notice}
                  onChange={(event) => editFaqPage({ ...faqPage, notice: event.target.value })}
                  disabled={!canWrite}
                />
              </div>
              <div className="mt-3">
                <TextAreaField
                  label="页面说明"
                  rows={2}
                  value={faqPage.heading.description}
                  onChange={(event) => editFaqPage({ ...faqPage, heading: { ...faqPage.heading, description: event.target.value } })}
                  disabled={!canWrite}
                />
              </div>

              <p className="mt-3 text-xs text-ink-500">
                共 {countFaq(faqPage.groups)} 条问答、{faqPage.groups.length} 个分组。
                答案里支持 **粗体** 与 - 列表（多行答案写在同一个框里，空行分段）。
              </p>

              {faqPage.groups.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500">
                  还没有分组。点右上角「新增分组」开始（分组标题就是网站上的分区标题）。
                </p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {faqPage.groups.map((group, groupIndex) => (
                    <li key={group.id === "" ? `new-group-${String(groupIndex)}` : group.id} className="rounded-md border border-ink-200 bg-white px-3 py-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-56 flex-1">
                          <TextField
                            label={`分组 ${String(groupIndex + 1)} 标题`}
                            hint="页面上的分区标题，例如「试课与报名」"
                            value={group.title}
                            onChange={(event) =>
                              editFaqPage({
                                ...faqPage,
                                groups: faqPage.groups.map((item, i) =>
                                  i === groupIndex ? { ...item, title: event.target.value } : item,
                                ),
                              })
                            }
                            disabled={!canWrite}
                          />
                        </div>
                        {canWrite && (
                          <span className="flex items-center gap-1 pb-1">
                            <button
                              type="button"
                              onClick={() =>
                                editFaqPage({
                                  ...faqPage,
                                  groups: [
                                    ...faqPage.groups,
                                    { id: "", title: "（新分组）", items: [] },
                                  ].map((item, i) =>
                                    i === faqPage.groups.length && i !== groupIndex + 1 ? item : item,
                                  ),
                                })
                              }
                              className="rounded-sm border border-dashed border-ink-300 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-brand-400 hover:text-brand-700"
                            >
                              + 在末尾加分组
                            </button>
                            <button
                              type="button"
                              disabled={groupIndex === 0}
                              onClick={() => {
                                const next = [...faqPage.groups];
                                const moved = next[groupIndex]!;
                                next[groupIndex] = next[groupIndex - 1]!;
                                next[groupIndex - 1] = moved;
                                editFaqPage({ ...faqPage, groups: next });
                              }}
                              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              disabled={groupIndex === faqPage.groups.length - 1}
                              onClick={() => {
                                const next = [...faqPage.groups];
                                const moved = next[groupIndex]!;
                                next[groupIndex] = next[groupIndex + 1]!;
                                next[groupIndex + 1] = moved;
                                editFaqPage({ ...faqPage, groups: next });
                              }}
                              className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const counted = group.items.length;
                                if (!window.confirm(`删除分组「${group.title === "" ? "（未命名）" : group.title}」及其 ${String(counted)} 条问答？`)) return;
                                editFaqPage({
                                  ...faqPage,
                                  groups: faqPage.groups.filter((_item, i) => i !== groupIndex),
                                });
                              }}
                              className="rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600"
                            >
                              删除分组
                            </button>
                          </span>
                        )}
                      </div>

                      <div className="mt-3 space-y-3">
                        {group.items.map((item, itemIndex) => (
                          <div key={item.id === "" ? `new-item-${String(itemIndex)}` : item.id} className="rounded-md border border-ink-100 bg-ink-50/60 px-3 py-3">
                            <div className="flex items-end gap-2">
                              <div className="min-w-56 flex-1">
                                <TextField
                                  label="问题"
                                  value={item.question}
                                  onChange={(event) =>
                                    editFaqPage({
                                      ...faqPage,
                                      groups: faqPage.groups.map((g, i) =>
                                        i === groupIndex
                                          ? {
                                              ...g,
                                              items: g.items.map((q, j) =>
                                                j === itemIndex ? { ...q, question: event.target.value } : q,
                                              ),
                                            }
                                          : g,
                                      ),
                                    })
                                  }
                                  disabled={!canWrite}
                                />
                              </div>
                              {canWrite && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    editFaqPage({
                                      ...faqPage,
                                      groups: faqPage.groups.map((g, i) =>
                                        i === groupIndex
                                          ? { ...g, items: g.items.filter((_q, j) => j !== itemIndex) }
                                          : g,
                                      ),
                                    })
                                  }
                                  className="mb-1 rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600"
                                >
                                  删除问答
                                </button>
                              )}
                            </div>
                            <div className="mt-2">
                              <TextAreaField
                                label="答案"
                                hint="支持 **粗体** 与 - 列表；多行答案在同一框里，空行分段"
                                rows={3}
                                value={item.answer}
                                onChange={(event) =>
                                  editFaqPage({
                                    ...faqPage,
                                    groups: faqPage.groups.map((g, i) =>
                                      i === groupIndex
                                        ? {
                                            ...g,
                                            items: g.items.map((q, j) =>
                                              j === itemIndex ? { ...q, answer: event.target.value } : q,
                                            ),
                                          }
                                        : g,
                                    ),
                                  })
                                }
                                disabled={!canWrite}
                              />
                            </div>
                          </div>
                        ))}
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() =>
                              editFaqPage({
                                ...faqPage,
                                groups: faqPage.groups.map((g, i) =>
                                  i === groupIndex
                                    ? { ...g, items: [...g.items, { id: "", question: "", answer: "" }] }
                                    : g,
                                ),
                              })
                            }
                            className="rounded-sm border border-dashed border-ink-300 px-2 py-1 text-[11px] text-ink-500 hover:border-brand-400 hover:text-brand-700"
                          >
                            + 在这一组加一条问答
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {canWrite && (
            <div className="mt-4 flex items-center gap-3 border-t border-ink-100 pt-4">
              <Button disabled={notice.pending || faqPage === null} onClick={() => void save()}>
                {notice.pending ? "保存中…" : "保存常见问题"}
              </Button>
              <span className="text-xs text-ink-500">
                与上面的学生案例、特色课程**一起提交**（同一份「网站内容」草稿）。
              </span>
            </div>
          )}
        </div>
      </Panel>

      {/*
        特色课程（v20 起在库里）：三级课程树，每门课程在网站上都有自己的页面
        （网址由各级的「路径分段」拼出来）。保存按钮在上一块面板上 ——
        两块内容一次交上去，服务端各写各的块（互不覆盖）。
      */}
      <Panel
        className="mb-8"
        title="特色课程"
        description="三级课程树（一级 → 二级 → 三级）。网站 /courses 底部那块与 /courses/featured/** 的课程页都取自这里；二级课程名同时是课程表单里「可开班型」的候选。"
      >
        <div className="px-4 py-4">
          {featuredPage === null ? (
            <p className="text-sm text-ink-500">读不到特色课程（后端版本可能太旧）。</p>
          ) : (
            <FeaturedCoursesEditor page={featuredPage} canWrite={canWrite} onChange={editFeaturedPage} />
          )}
          {canWrite && (
            <div className="mt-4 flex items-center gap-3 border-t border-ink-100 pt-4">
              <Button disabled={notice.pending || featuredPage === null} onClick={() => void save()}>
                {notice.pending ? "保存中…" : "保存特色课程"}
              </Button>
              <span className="text-xs text-ink-500">
                与上面的学生案例**一起提交**（同一份「网站内容」草稿）：两块各写各的，谁也不覆盖谁。
              </span>
            </div>
          )}
        </div>
      </Panel>

      {/*
        页面文案（v22 起在库里）：品牌与联系方式 / 首页 / 关于 / 联系我们 / 时间安排。
        五块形状相同（短字段 + 分组），因此共用一套编辑器，用上面的页签切换；
        保存按钮在最上面那块面板上 —— 四类内容一次交上去，服务端各写各的块。
      */}
      <Panel
        className="mb-8"
        title="页面文案"
        description="整站骨架上的文案：品牌与联系方式（页头页脚）、首页、关于我们、联系我们、课程时间安排。网站只根据后端这一份出内容。"
        actions={
          <span className="flex flex-wrap items-center gap-1">
            {SITE_COPY_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setCopyKey(key)}
                className={
                  key === copyKey
                    ? "rounded-md border border-brand-400 bg-brand-50 px-2.5 py-1 text-xs text-brand-700"
                    : "rounded-md border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-ink-300"
                }
              >
                {SITE_COPY_LABELS[key]}
              </button>
            ))}
          </span>
        }
      >
        <div className="px-4 py-4">
          {copyBlock === null ? (
            <p className="text-sm text-ink-500">读不到这一块文案（后端版本可能太旧）。</p>
          ) : (
            <SiteCopyEditor
              blockKey={copyKey}
              block={copyBlock}
              canWrite={canWrite}
              onChange={(next) => editCopyBlock(copyKey, next)}
            />
          )}
          {canWrite && (
            <div className="mt-4 flex items-center gap-3 border-t border-ink-100 pt-4">
              <Button disabled={notice.pending || copyBlock === null} onClick={() => void save()}>
                {notice.pending ? "保存中…" : "保存页面文案"}
              </Button>
              <span className="text-xs text-ink-500">
                与上面的学生案例、特色课程、常见问题**一起提交**（同一份「网站内容」草稿）。
              </span>
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
