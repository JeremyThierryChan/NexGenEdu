"use client";

import { useEffect, useState } from "react";
import { Panel, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { Button } from "@/components/ui/Button";
import { api, type SiteContent } from "@/lib/backend/api";

/**
 * **网站课程正文**编辑（学科 → 学段小节）。
 *
 * ## 为什么要有这块
 *
 * 网站的课程页正文原先只存在于 `data/site/content.md`：后台看不见、改不了。
 * 现在正文在库里（`db.siteContent.coursePage`），网站构站时连得上后端就用它 ——
 * 那就必须能在这里改，否则"以后端为准"只是把文件搬了个地方。
 *
 * ## 交互上的两个取舍
 *
 * 1. **整份编辑、一次保存**（服务端 `site.saveContent` 整份覆盖）：正文是一块一块的文字，
 *    逐块保存会让人不确定"我改的这段到底存了没有"。这里改完点一次保存，一次落盘、一条日志。
 * 2. **小节锚点（id）可以改但要提醒**：卡片上的标签是按锚点跳转的（「学考 → 高中物理学考」），
 *    改了锚点而卡片标签没跟着改，那一跳就会落空。因此锚点单独一行、带说明。
 */
/**
 * 事件名：课程清单里的「网站正文」按钮 → 这块编辑器。
 *
 * 为什么用事件而不是把状态提到父组件：这两个面板在**同一个页面**里、但父组件（课程库页）
 * 不该知道课程正文的内部结构（学科 / 小节 / 锚点）。事件让"跳过去"这件事只依赖一个
 * 极小的约定（{cardName, targets}），父组件不必承担这层耦合。
 */
const FOCUS_EVENT = "nexgenedu:focus-site-subject";

/** 让「网站课程正文」展开并定位到这门课涉及的小节（卡片与它的正文放一起看）。 */
export function focusSiteSubject(detail: { cardName: string; targets: string[] }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail }));
}

export function SiteCourseContent() {
  const [content, setContent] = useState<SiteContent | null>(null);
  /** 编辑器默认收起（21 个学科 / 61 个小节会把这页撑出好几屏，理由见下面的 render 注释）。 */
  const [expanded, setExpanded] = useState(false);
  const [openSubject, setOpenSubject] = useState<string>("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.site
      .publicContent()
      .then((data) => {
        if (alive) setContent(data.siteContent);
      })
      .catch(() => setError("读不到网站内容（后端没在跑？）。"))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * 监听"从课程清单跳过来"：展开面板，并打开命中该目标的学科。
   *
   * 命中规则：卡片给的 targets（它自己指向的小节 + 各标签的目标）里，**任一**小节锚点
   * 落在某个学科里，就打开那个学科（多门命中时打开第一个 —— 卡片与小节通常是一对一，
   * 一对多时（如「高中物理」有学考/选考两节）打开含第一个命中的那个学科即可）。
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ cardName: string; targets: string[] }>).detail;
      if (detail === undefined || content === null) return;
      setExpanded(true);
      setMessage("");
      const targets = detail.targets.filter((item) => item.trim() !== "");
      const hit = content.coursePage.subjects.find((subject) =>
        subject.bands.some((band) => targets.includes(band.id) || targets.includes(band.title)),
      );
      // 找不到（卡片没写对锚点、或这门课还没有小节）时也展开，让人自己找 —— 静默不动作更糟
      setOpenSubject(hit?.id ?? "");
      setMessage(
        hit === undefined
          ? `「${detail.cardName}」还没有对应的小节正文：可以「新增学科」或让卡片指向已有小节。`
          : `已定位到「${hit.name}」的小节正文（「${detail.cardName}」指向它）。`,
      );
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [content]);

  /** 就地改一份草稿（不改原对象，避免"改了没有保存"看不出来）。 */
  function edit(next: (draft: SiteContent) => void) {
    setContent((current) => {
      if (current === null) return current;
      const draft = JSON.parse(JSON.stringify(current)) as SiteContent;
      next(draft);
      return draft;
    });
    setDirty(true);
    setMessage("");
  }

  async function save() {
    if (content === null) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.site.saveContent(content);
      setContent(saved);
      setDirty(false);
      setMessage(
        `已保存：${saved.coursePage.subjects.length} 个学科 / ` +
          `${saved.coursePage.subjects.reduce((sum, item) => sum + item.bands.length, 0)} 个小节。` +
          "重新构站一次（npm run build）网站就会跟着变。",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <Panel className="mt-5" title="网站课程正文" description="学科 → 学段小节，网站上课程页的正文。">
        <p className="px-4 py-4 text-sm text-ink-400">加载中…</p>
      </Panel>
    );
  }

  if (content === null) {
    return (
      <Panel className="mt-5" title="网站课程正文" description="学科 → 学段小节，网站上课程页的正文。">
        <p className="px-4 py-4 text-sm text-ink-500">{error === "" ? "读不到内容。" : error}</p>
      </Panel>
    );
  }

  const { coursePage } = content;
  /*
   * **默认收起**。
   *
   * 这块编辑器有 21 个学科、61 个小节，展开时能把「课程库」页撑出好几屏 ——
   * 而日常最常做的是看课程清单、改价格状态，不是改课程正文（那是低频的文案工作）。
   * 因此默认只留一行摘要（几个学科 / 几个小节 / 有没有未保存的改动）+ 保存按钮，
   * 要看正文再点「展开编辑」。摘要行里保留保存按钮：改完不必滚回顶部去找它。
   */
  const bandCount = coursePage.subjects.reduce((sum, subject) => sum + subject.bands.length, 0);

  return (
    <Panel
      className="mt-5"
      title="网站课程正文"
      description="网站上课程页的正文：学科（语文 / 数学 / …）与它们的学段小节（小学语文 / 初中数学…）。卡片在下面「课程清单」里，标签指向这里的小节锚点。"
    >
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
        <Button type="button" size="sm" onClick={() => void save()} disabled={pending || !dirty}>
          {pending ? "保存中…" : dirty ? "保存网站内容" : "没有改动"}
        </Button>
        {dirty && <span className="text-xs text-warning-600">有未保存的改动</span>}
        {message !== "" && <span className="text-xs text-success-600">{message}</span>}
        {error !== "" && <span className="text-xs text-danger-600">{error}</span>}
      </div>

      {expanded && (
        <>
      <div className="grid gap-3 border-t border-ink-100 px-4 py-3 sm:grid-cols-3">
        <TextField
          label="课程页标题"
          value={coursePage.heading.title}
          onChange={(event) => edit((draft) => { draft.coursePage.heading.title = event.target.value; })}
        />
        <TextField
          label="课程页小字（eyebrow）"
          value={coursePage.heading.eyebrow}
          onChange={(event) => edit((draft) => { draft.coursePage.heading.eyebrow = event.target.value; })}
        />
        <TextField
          label="选修课的父分组名"
          hint="网站上把选修课收在一起的那个标题（例如「成人课程」）"
          value={coursePage.electiveTitle}
          onChange={(event) => edit((draft) => { draft.coursePage.electiveTitle = event.target.value; })}
        />
      </div>
      <div className="px-4 pb-3">
        <TextAreaField
          label="课程页描述"
          rows={2}
          value={coursePage.heading.description}
          onChange={(event) => edit((draft) => { draft.coursePage.heading.description = event.target.value; })}
        />
      </div>

      <div className="border-t border-ink-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              edit((draft) => {
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
                      onClick={() =>
                        edit((draft) => {
                          draft.coursePage.subjects.splice(index, 1);
                        })
                      }
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
                            edit((draft) => {
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
                            edit((draft) => {
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
                              edit((draft) => {
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
                            edit((draft) => {
                              const target = draft.coursePage.subjects[index];
                              if (target !== undefined) target.lead = event.target.value;
                            })
                          }
                        />
                      </div>

                      <div className="mt-3 space-y-3">
                        {subject.bands.map((band, bandIndex) => (
                          <div key={`${band.id}-${bandIndex}`} className="rounded-md border border-ink-200 bg-white px-3 py-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <TextField
                                label="小节标题"
                                hint="可以写成「初中数学｜建立数学模型」：竖线之后是导语"
                                value={band.title}
                                onChange={(event) =>
                                  edit((draft) => {
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
                                  edit((draft) => {
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
                                  edit((draft) => {
                                    const target = draft.coursePage.subjects[index]?.bands[bandIndex];
                                    if (target !== undefined) target.body = event.target.value;
                                  })
                                }
                              />
                            </div>
                            <button
                              type="button"
                              className="mt-1 text-[11px] text-ink-400 hover:text-danger-600"
                              onClick={() =>
                                edit((draft) => {
                                  draft.coursePage.subjects[index]?.bands.splice(bandIndex, 1);
                                })
                              }
                            >
                              删除这个小节
                            </button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            edit((draft) => {
                              const target = draft.coursePage.subjects[index];
                              if (target === undefined) return;
                              const anchor = `${target.name}小节${target.bands.length + 1}`;
                              target.bands.push({ id: anchor, title: anchor, body: "" });
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
