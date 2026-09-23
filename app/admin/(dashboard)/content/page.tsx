"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { Panel, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { DataNotice } from "@/components/admin/DataNotice";
import { LoadFailure } from "@/components/admin/LoadFailure";
import { ActionNoticeView } from "@/components/admin/ActionNotice";
import { useActionNotice } from "@/components/admin/useActionNotice";
import { rolesOrAll, useAuth } from "@/components/admin/AuthContext";
import { canCallMethod, methodOwnerText } from "@/lib/auth/roles";
import { api, type SiteContent } from "@/lib/backend/api";
import type { SiteCase, SiteCasesPage, SiteFeaturedCourse, SiteFeaturedPage } from "@/lib/backend/api";
import { FeaturedCoursesEditor } from "@/components/admin/FeaturedCoursesEditor";

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
  const [content, setContent] = useState<SiteContent | null>(null);
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
      const data = await api.site.publicContent();
      setContent(data.siteContent);
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

  /** 改特色课程草稿（整棵树一起交，与案例同一套做法）。 */
  function editFeaturedPage(next: SiteFeaturedPage): void {
    setContent((prev) => (prev === null ? prev : { ...prev, featuredPage: next }));
    notice.clear();
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
    if (casesPage === null || featuredPage === null) return;
    notice.clear();
    try {
      const saved = await notice.run(async () => await api.site.saveBlocks({ casesPage, featuredPage }));
      if (saved !== null) setContent(saved);
      notice.succeed(
        `已保存学生案例 ${casesPage.cases.length} 条、特色课程 ${countFeatured(featuredPage.courses)} 门。` +
          "下一次构站（npm run build，且那台机器连着后端）网站就会按这份内容出。",
      );
    } catch {
      // `run` 已经把服务端原话放进 notice.error，这里不再翻译一遍
    }
  }

  const dirtyHint = useMemo(
    () =>
      "保存后网站要**重新构站**才更新（`npm run build`）；构站那台机器连不上后端时，" +
      "网站整体用 data/site/cases.md 那份模版。",
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
    </>
  );
}
