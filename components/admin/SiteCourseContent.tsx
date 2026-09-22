"use client";

import { useEffect, useState } from "react";
import { Panel, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { coursesReferencingAnchor, bandsForTargets, uniqueBandAnchor, type CardAnchorSource } from "@/lib/backend/site-bands";
import { type SiteContent } from "@/lib/backend/api";

/**
 * 网站正文的**学科级设置与未挂到卡片的正文**。
 *
 * ## 这块面板留下的东西（以及为什么要缩到这么小）
 *
 * v15 起课程页正文进了库，这块面板是它唯一的编辑器。但"一门课一张卡片"改完之后，
 * **卡片点进去的那些小节正文已经能在课程卡片里直接改**（见 `courses/page.tsx` 的
 * 「网站正文（小节）」），再让人回这里找同一段文字就是两头找 ——
 * 所以这里只剩三类**不属于任何一张卡片**的东西：
 *
 *   1. 课程页本身的标题 / 描述 / 选修课父分组名（整页共用，没有归属的卡片）；
 *   2. 学科级字段：学科名 / 顺序 / 整组暂未开放 / 学科导语，以及新增学科；
 *   3. **没被任何卡片指向的小节**（网站上没有入口指到它 —— 要么挂到某张卡片上，要么删掉）。
 *
 * 面板里仍会**列出全部小节**（带「课程卡片 X 管」/「未挂到卡片」的标记）：正文是一整份文档，
 * 只显示一半会让人不知道改动影响到了什么。标记的作用是回答"这一段日常该去哪改"。
 *
 * ## 交互上的三个取舍
 *
 * 1. **整份编辑、一次保存**（服务端 `site.saveContent` 整份覆盖）：正文是一块一块的文字，
 *    逐块保存会让人不确定"我改的这段到底存了没有"。这里改完点一次保存，一次落盘、一条日志。
 * 2. **草稿由课程库页持有**（`content` / `onChange` 是 props）：卡片里的「网站正文」改的是
 *    **同一份**草稿。两处各存一份的话，在一处保存后到另一处保存，会把前一处刚存的改动
 *    静默盖回去 —— 那种"看起来保存成功了、内容却是旧的"最难查。
 * 3. **小节锚点（id）可以改但要提醒**：卡片上的标签是按锚点跳转的（「学考 → 高中物理学考」），
 *    改了锚点而卡片标签没跟着改，那一跳就会落空（服务端也拦：删掉 / 改掉被卡片指着的小节会被拒）。
 */
/**
 * 事件名：课程清单里的「网站正文」按钮 → 这块编辑器。
 *
 * 为什么用事件而不是把状态提到父组件：这两个面板在**同一个页面**里、但父组件（课程库页）
 * 不该知道课程正文的内部结构（学科 / 小节 / 锚点）。事件让"跳过去"这件事只依赖一个
 * 极小的约定（{cardName, targets}），父组件不必承担这层耦合。
 * （草稿本身是 props —— 那是数据，这个是"跳转"这个动作，两件事。）
 */
const FOCUS_EVENT = "nexgenedu:focus-site-subject";

/** 让这块面板展开并定位到这门课涉及的学科。 */
export function focusSiteSubject(detail: { cardName: string; targets: string[] }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail }));
}

export type SiteCourseContentProps = {
  /** 正文草稿（由课程库页持有，与卡片里的编辑共用一份）。null＝还没读到。 */
  content: SiteContent | null;
  /** 库里的课程卡片：用来标出"这个小节由哪张卡片管"。 */
  courses: readonly CardAnchorSource[];
  /** 首屏是否还在读。 */
  loading: boolean;
  /** 读不到正文的原因（读不到只影响编辑，页面其余部分照常）。 */
  loadError: string;
  /** 草稿有没有未保存的改动。 */
  dirty: boolean;
  /** 保存中（按钮禁用 + 文案）。 */
  saving: boolean;
  /** 保存结果提示 / 错误：动作发生在哪一块，提示就显示在哪一块旁边。 */
  notice: string;
  error: string;
  /** 改草稿：整份克隆后交给 mutate。 */
  onChange: (mutate: (draft: SiteContent) => void) => void;
  /** 保存整份正文（服务端 `site.saveContent`）。 */
  onSave: () => void;
};

export function SiteCourseContent({
  content,
  courses,
  loading,
  loadError,
  dirty,
  saving,
  notice,
  error,
  onChange,
  onSave,
}: SiteCourseContentProps) {
  /** 编辑器默认收起（21 个学科 / 61 个小节会把这页撑出好几屏，理由见下面的 render 注释）。 */
  const [expanded, setExpanded] = useState(false);
  const [openSubject, setOpenSubject] = useState<string>("");
  const [focusMessage, setFocusMessage] = useState("");
  /**
   * 「这一步被拒了」的本地提示（目前只有一条规则：被卡片指着的小节不许删）。
   *
   * 服务端也会拒同一件事（`validateSiteContent` 的删除护栏），这里先拦一道是为了**当场**
   * 说清是哪门课在指着它 —— 让整份保存（课程 + 正文 + 报价）跑到服务端才失败，
   * 人看到的是"什么都没保存上"，而原因藏在提示的最后一句里。
   */
  const [blockedMessage, setBlockedMessage] = useState("");

  /*
   * 监听"从课程清单跳过来"：展开面板，并打开命中该目标的学科。
   *
   * 命中规则来自 `bandsForTargets`（`lib/backend/site-bands.ts`）—— 与课程卡片里那块
   * 共用同一份实现。这里**不**另写一套：两套规则一有出入，就会出现"按钮说找不到、
   * 面板里明明看得见"，而那种不一致不会报错，只会让人不再相信这个按钮。
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ cardName: string; targets: string[] }>).detail;
      if (detail === undefined || content === null) return;
      setExpanded(true);
      const hits = bandsForTargets(content.coursePage.subjects, detail.targets);
      const hit = hits[0];
      // 找不到（卡片没写对锚点、或这门课还没有小节）时也展开，让人自己找 —— 静默不动作更糟
      setOpenSubject(hit?.subject.id ?? "");
      setFocusMessage(
        hit === undefined
          ? `「${detail.cardName}」还没有对应的小节：可以在课程卡片里给这个学科新增一节，或让卡片的靶点 / 标签指向已有小节。`
          : `已定位到学科「${hit.subject.name}」（「${detail.cardName}」指向它的「${hit.band.title.trim()}」）。` +
            "这门课的小节正文在它自己的课程卡片里改；这里有它的学科导语 / 整组暂未开放。",
      );
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [content]);

  /*
   * 标题与说明按"这块面板现在还剩什么"来写：**学科级设置**（课程页标题 / 学科导语 /
   * 整组暂未开放）与**未挂到卡片的正文**。每门课的小节正文已经搬到课程卡片里，
   * 标题再把"网站课程正文"整个揽在自己身上，就是在告诉人"该来这儿改" —— 那会让人白跑。
   */
  const panelTitle = "学科级设置与未挂到卡片的正文";
  const panelDescription =
    "网站课程页正文里**不属于某一张卡片**的部分：课程页标题、学科（语文 / 数学 / …）的导语与整组暂未开放，以及没有卡片指向的小节。";

  if (loading) {
    return (
      <Panel className="mt-5" title={panelTitle} description={panelDescription}>
        <p className="px-4 py-4 text-sm text-ink-400">加载中…</p>
      </Panel>
    );
  }

  if (content === null) {
    return (
      <Panel className="mt-5" title={panelTitle} description={panelDescription}>
        <p className="px-4 py-4 text-sm text-ink-500">{loadError === "" ? "读不到内容。" : loadError}</p>
      </Panel>
    );
  }

  const { coursePage } = content;
  /*
   * **默认收起**。
   *
   * 这块编辑器有 21 个学科、61 个小节，展开时能把「课程库」页撑出好几屏 ——
   * 而日常最常做的是看课程清单、改价格状态、改某门课的正文（那三件在上面），
   * 这里改的是整页级的文案（低频）。因此默认只留一行摘要（几个学科 / 几个小节 /
   * 有没有未保存的改动）+ 保存按钮，要改再点「展开编辑」。
   * 摘要行里保留保存按钮：改完不必滚回顶部去找它。
   */
  const bandCount = coursePage.subjects.reduce((sum, subject) => sum + subject.bands.length, 0);

  return (
    <Panel className="mt-5" title={panelTitle} description={panelDescription}>
      <div className="border-b border-ink-100 bg-brand-50/40 px-4 py-2">
        <p className="text-xs leading-relaxed text-ink-600">
          <strong className="font-medium">每门课的正文请在课程卡片的「网站正文」里改</strong>
          （打开「编辑」就能看到，标题 / 锚点 / 正文都在那里，与卡片一起保存）。
          这里只管学科级的东西，以及没有卡片指向的小节。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-xs text-ink-600">
          {coursePage.subjects.length} 个学科 / {bandCount} 个小节
          <span className="ml-2 text-ink-400">（网站上课程页的正文，低频修改）</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起编辑器" : "展开编辑"}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty}>
          {saving ? "保存中…" : dirty ? "保存网站内容" : "没有改动"}
        </Button>
        {dirty && <span className="text-xs text-warning-600">有未保存的改动</span>}
        {notice !== "" && <span className="text-xs text-success-600">{notice}</span>}
        {error !== "" && <span className="text-xs text-danger-600">{error}</span>}
      </div>

      {expanded && (
        <>
      <div className="border-t border-ink-100 px-4 pt-3">
        <p className="text-xs font-medium text-ink-700">课程页标题（整页共用，不属于任何卡片）</p>
      </div>
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <TextField
          label="课程页标题"
          value={coursePage.heading.title}
          onChange={(event) => onChange((draft) => { draft.coursePage.heading.title = event.target.value; })}
        />
        <TextField
          label="课程页小字（eyebrow）"
          value={coursePage.heading.eyebrow}
          onChange={(event) => onChange((draft) => { draft.coursePage.heading.eyebrow = event.target.value; })}
        />
        <TextField
          label="选修课的父分组名"
          hint="网站上把选修课收在一起的那个标题（例如「成人课程」）"
          value={coursePage.electiveTitle}
          onChange={(event) => onChange((draft) => { draft.coursePage.electiveTitle = event.target.value; })}
        />
      </div>
      <div className="px-4 pb-3">
        <TextAreaField
          label="课程页描述"
          rows={2}
          value={coursePage.heading.description}
          onChange={(event) => onChange((draft) => { draft.coursePage.heading.description = event.target.value; })}
        />
      </div>

      <div className="border-t border-ink-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-ink-700">学科与小节</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange((draft) => {
                const index = draft.coursePage.subjects.length + 1;
                const name = `新学科 ${index}`;
                draft.coursePage.subjects.push({
                  id: name,
                  name,
                  lead: "",
                  unavailable: false,
                  order: index,
                  bands: [{ id: `${name}小节1`, title: `${name}小节1`, body: "" }],
                });
                setOpenSubject(name);
              })
            }
          >
            新增学科
          </Button>
          {/* 保存按钮与提示留在上面的摘要行里，这里不再重复一份 */}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
          带「课程卡片 X 管」标记的小节日常在那张卡片的「网站正文」里改（这里也改得动 —— 改的是同一份草稿）；
          没有标记的叫「未挂到卡片」：网站上没有入口指到它，要么在某张卡片里把它选作靶点 / 标签，要么删掉。
        </p>
        {focusMessage !== "" && <p className="mt-1 text-[11px] text-brand-700">{focusMessage}</p>}
        {blockedMessage !== "" && (
          <p className="mt-2 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-[11px] leading-relaxed text-danger-600">
            {blockedMessage}
          </p>
        )}

        <ul className="mt-3 divide-y divide-ink-100 rounded-md border border-ink-200">
          {[...coursePage.subjects]
            .map((subject, index) => ({ subject, index }))
            .sort((a, b) => a.subject.order - b.subject.order)
            .map(({ subject, index }) => {
              const open = openSubject === subject.id;
              return (
                <li key={`${subject.id}-${index}`} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="text-sm text-ink-900 hover:text-brand-700"
                      onClick={() => setOpenSubject(open ? "" : subject.id)}
                    >
                      {open ? "▾" : "▸"} {subject.name}
                    </button>
                    <span className="text-[11px] text-ink-400">
                      {subject.bands.length} 个小节
                      {subject.unavailable && " · 暂未开放"}
                    </span>
                    <button
                      type="button"
                      className="ml-auto text-[11px] text-ink-400 hover:text-danger-600"
                      onClick={() => {
                        /*
                         * 删学科＝连它下面所有小节一起删：只要其中**一节**被卡片指着就先拦下来。
                         * 判据与服务端护栏同一个函数（`coursesReferencingAnchor`）——
                         * 前台说能删、服务端说不能，比两边都拦更糟。
                         */
                        const owned = subject.bands
                          .map((band) => ({ band, owners: coursesReferencingAnchor(courses, band.id) }))
                          .filter((item) => item.owners.length > 0);
                        if (owned.length > 0) {
                          setBlockedMessage(
                            `不能删掉学科「${subject.name}」：它下面还有 ${owned.length} 个小节被卡片指着（` +
                              owned
                                .map(
                                  (item) =>
                                    `${item.band.id} ← ${item.owners.map((course) => `「${course.name}」`).join("、")}`,
                                )
                                .join("；") +
                              "）。请先去那些卡片里改掉标签 / 靶点，或先删掉这几个小节，再删学科。",
                          );
                          return;
                        }
                        setBlockedMessage("");
                        onChange((draft) => {
                          draft.coursePage.subjects.splice(index, 1);
                        });
                      }}
                    >
                      删除学科
                    </button>
                  </div>

                  {open && (
                    <div className="mt-2 rounded-md bg-ink-50/60 px-3 py-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <TextField
                          label="学科名"
                          hint="也是锚点名（卡片标签按它关联）"
                          value={subject.name}
                          onChange={(event) =>
                            onChange((draft) => {
                              const target = draft.coursePage.subjects[index];
                              if (target === undefined) return;
                              target.name = event.target.value;
                              target.id = event.target.value;
                            })
                          }
                        />
                        <TextField
                          label="顺序"
                          type="number"
                          value={String(subject.order)}
                          onChange={(event) =>
                            onChange((draft) => {
                              const target = draft.coursePage.subjects[index];
                              if (target !== undefined) target.order = Number(event.target.value) || 0;
                            })
                          }
                        />
                        <label className="flex items-end gap-2 pb-1 text-xs text-ink-600">
                          <input
                            type="checkbox"
                            checked={subject.unavailable}
                            onChange={(event) =>
                              onChange((draft) => {
                                const target = draft.coursePage.subjects[index];
                                if (target !== undefined) target.unavailable = event.target.checked;
                              })
                            }
                          />
                          整组暂未开放
                        </label>
                      </div>

                      <div className="mt-2">
                        <TextAreaField
                          label="学科导语"
                          hint="网站上显示在这一组开头；留空则不显示这一段"
                          rows={2}
                          value={subject.lead}
                          onChange={(event) =>
                            onChange((draft) => {
                              const target = draft.coursePage.subjects[index];
                              if (target !== undefined) target.lead = event.target.value;
                            })
                          }
                        />
                      </div>

                      <div className="mt-3 space-y-3">
                        {subject.bands.map((band, bandIndex) => {
                          /*
                           * 哪张卡片管着这一节（没有就是"未挂到卡片"）。
                           * 用与服务端护栏同一个函数（`coursesReferencingAnchor`）：
                           * 这里显示"由 X 管"、服务端拦的也必须是同一批 X，否则标记会撒谎。
                           */
                          const owners = coursesReferencingAnchor(courses, band.id);
                          return (
                          <div key={`${band.id}-${bandIndex}`} className="rounded-md border border-ink-200 bg-white px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-ink-400">
                                {owners.length === 0
                                  ? "未挂到卡片（网站上没有入口指到它）"
                                  : `课程卡片 ${owners.map((course) => `「${course.name}」`).join("、")} 管`}
                              </span>
                              <button
                                type="button"
                                className="text-[11px] text-ink-400 hover:text-danger-600"
                                onClick={() => {
                                  // 与课程卡片里那个删除按钮同一条一致性规则（见上面的 blockedMessage）
                                  if (owners.length > 0) {
                                    setBlockedMessage(
                                      `不能删掉小节「${band.id}」：课程 ${owners
                                        .map((course) => `「${course.name}」`)
                                        .join("、")} 的卡片靶点 / 标签还指着它，` +
                                        "删了它网站上那张卡片点进去就会跳空。请先改掉那门课的标签 / 靶点，再回来删。",
                                    );
                                    return;
                                  }
                                  setBlockedMessage("");
                                  onChange((draft) => {
                                    draft.coursePage.subjects[index]?.bands.splice(bandIndex, 1);
                                  });
                                }}
                              >
                                删除这个小节
                              </button>
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <TextField
                                label="小节标题"
                                hint="可以写成「初中数学｜建立数学模型」：竖线之后是导语"
                                value={band.title}
                                onChange={(event) =>
                                  onChange((draft) => {
                                    const target = draft.coursePage.subjects[index]?.bands[bandIndex];
                                    if (target !== undefined) target.title = event.target.value;
                                  })
                                }
                              />
                              <TextField
                                label="小节锚点"
                                hint="卡片标签跳转用的名字；改它就要跟着改卡片标签"
                                value={band.id}
                                onChange={(event) =>
                                  onChange((draft) => {
                                    const target = draft.coursePage.subjects[index]?.bands[bandIndex];
                                    if (target !== undefined) target.id = event.target.value;
                                  })
                                }
                              />
                            </div>
                            <div className="mt-2">
                              <TextAreaField
                                label="正文"
                                rows={4}
                                value={band.body}
                                onChange={(event) =>
                                  onChange((draft) => {
                                    const target = draft.coursePage.subjects[index]?.bands[bandIndex];
                                    if (target !== undefined) target.body = event.target.value;
                                  })
                                }
                              />
                            </div>
                          </div>
                          );
                        })}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onChange((draft) => {
                              const target = draft.coursePage.subjects[index];
                              if (target === undefined) return;
                              // 锚点重名时自动取下一个可用值：服务端会拒整份保存，不能等那一步
                              const base = `${target.name}小节${target.bands.length + 1}`;
                              const anchor = uniqueBandAnchor(draft.coursePage.subjects, base);
                              target.bands.push({ id: anchor, title: base, body: "" });
                            })
                          }
                        >
                          新增小节
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      </div>
        </>
      )}
    </Panel>
  );
}
