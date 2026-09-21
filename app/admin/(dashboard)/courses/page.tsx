"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { BulkImport } from "@/components/admin/BulkImport";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { Panel, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import {
  api,
  COURSE_SITE_KINDS,
  COURSE_STATUSES,
  type Course,
  type CourseSiteKind,
  type CourseSummary,
} from "@/lib/backend/api";
import { getCourseCategoryOptions, getFormOptions } from "@/lib/backend/options";
import { canRemoveCourse } from "@/lib/backend/courses";
import type { SiteContentImportReport } from "@/lib/backend/api";
import { pricingStatusForCourses, type LibraryPricingStatus } from "@/lib/backend/pricing";
import { cn } from "@/lib/utils/cn";

/**
 * 课程库。
 *
 * 排课的科目、教师可带科目、报课记录里的科目**都按课程名引用这里**。
 * 之前科目候选只来自网站内容，于是想开一门网站上还没有的课（围棋、书法、编程）
 * 就只能手打，名字一歪（「围棋」/「围棋课」）统计与课时对账就对不上。
 *
 * 两件事必须说清楚（页面里也写着）：
 *   1. 在这里加课程**不会**让宣传网站上多出一张卡片 —— 网站是静态内容，
 *      要上线得改 `data/site/content.md` 的课程栏目（见内容维护手册）；
 *   2. 网站来源的课程不能删（删了下次同步又回来），不想再排就改成「暂未开放」。
 */
export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  // 批量导入面板（低频操作：导完就收起来，不占着页面）
  const [importing, setImporting] = useState(false);
  /** 每门课在报价配置里的定价状态（「打通」的可见部分）。 */
  const [pricingStatus, setPricingStatus] = useState<LibraryPricingStatus[]>([]);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  /** 刷新中（页面上已有数据，因此不清空列表 —— 见 load 的说明）。 */
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [originFilter, setOriginFilter] = useState("全部");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  /*
   * 「从网站导入内容」：两阶段（体检 → 确认写入）。
   * 体检结果逐条列出来给人看 —— 一次导入会动到教师资料、课程字段与课程正文，
   * 不列清楚就变成"点一下按钮，数据悄悄变了一片"。
   */
  const [siteCheck, setSiteCheck] = useState<SiteContentImportReport | null>(null);
  const [siteOverwrite, setSiteOverwrite] = useState(false);
  const [sitePending, setSitePending] = useState(false);

  // 表单（新建 / 编辑共用）
  const [editing, setEditing] = useState<Course | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [forms, setForms] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("开放");
  const [note, setNote] = useState("");
  /*
   * 网站卡片字段（v15）。课程库现在同时是**网站课程卡片**的来源：
   * 能连上后端时，网站上的栏目卡片就是这里的数据（见 docs/技术架构.md §10.1）。
   * 因此这几项要能在这里改，而不是只能去改内容文件。
   */
  const [path, setPath] = useState("");
  const [subgroup, setSubgroup] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [target, setTarget] = useState("");
  const [order, setOrder] = useState("");
  const [intro, setIntro] = useState("");
  const [siteKind, setSiteKind] = useState<CourseSiteKind>("不展示");
  const [pending, setPending] = useState(false);

  const categoryOptions = useMemo(() => getCourseCategoryOptions(), []);
  const formOptions = useMemo(() => getFormOptions(), []);

  /**
   * 读数据。
   *
   * `quiet: true` = **安静刷新**：页面上已经有数据时，不把列表换掉、只在旁边显示"刷新中…"。
   * 这一点是必须的：如果刷新时把整块列表换成一行"加载中…"，页面高度会从很高塌成一行，
   * 浏览器随即把滚动位置夹回顶部 —— 于是"点一下『设为暂未开放』就跳回页面顶部、
   * 还得再往下滑"（真实反馈）。首屏加载用 `loading`（那时本来就没内容可保）。
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet === true) setRefreshing(true);
    else setLoading(true);
    const [list, stats, config] = await Promise.all([
      api.courses.list(),
      api.courses.summary(),
      api.pricing.get(),
    ]);
    setCourses(list);
    setSummary(stats);
    setPricingStatus(pricingStatusForCourses(config, list));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setName("");
    setCategory("");
    setForms([]);
    setStatus("开放");
    setNote("");
    setPath("");
    setSubgroup("");
    setTagsText("");
    setTarget("");
    setOrder("");
    setIntro("");
    setSiteKind("不展示");
  }

  function startEdit(course: Course) {
    setEditing(course);
    setName(course.name);
    setCategory(course.category);
    setForms(course.forms);
    setStatus(course.status);
    setNote(course.note);
    setPath(course.path);
    setSubgroup(course.subgroup);
    // 标签写成「学考→高中物理学考、选考→高中物理选考」，与内容文件里的写法一致
    setTagsText(course.tags.map((tag) => `${tag.label}→${tag.target}`).join("、"));
    setTarget(course.target);
    setOrder(course.order === 999 ? "" : String(course.order));
    setIntro(course.intro);
    setSiteKind(course.siteKind);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 「学考→高中物理学考、选考→高中物理选考」→ 标签数组（箭头可省略，省略时两边同名）。 */
  function parseTags(text: string): Course["tags"] {
    return text
      .split(/[、,，\n]/)
      .map((raw) => raw.trim())
      .filter((raw) => raw !== "")
      .map((raw) => {
        const [label = "", jump = ""] = raw.split(/→|->/).map((part) => part.trim());
        return { label, target: jump !== "" ? jump : label };
      });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");

    const payload = {
      name: name.trim(),
      category: category.trim(),
      forms,
      status: (status === "暂未开放" ? "暂未开放" : "开放") as Course["status"],
      note: note.trim(),
      path: path.trim(),
      subgroup: subgroup.trim(),
      tags: parseTags(tagsText),
      // 卡片点进哪个小节：没填就按「课程名，其次是第一个标签的目标」推导（网站那侧的口径）
      target: target.trim(),
      order: order.trim() === "" || !Number.isFinite(Number(order)) ? 999 : Number(order),
      intro: intro.trim(),
      siteKind,
    };

    try {
      if (editing === null) {
        await api.courses.create({ ...payload, origin: "后台", createdAt: new Date().toISOString() });
        setMessage(
          siteKind === "不展示"
            ? `已添加课程「${payload.name}」。它现在可以用于排课、报课与教师科目。`
            : `已添加课程「${payload.name}」，并会在网站上以「${siteKind}」出现（连上后端构站时才生效）。`,
        );
      } else {
        await api.courses.update(editing.id, payload);
        setMessage(`已保存「${payload.name}」。`);
      }
      resetForm();
      await load({ quiet: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPending(false);
    }
  }

  /**
   * 切换「开放 / 暂未开放」。
   *
   * 刻意**就地更新这一条**（而不是整页重载）：一是不会因为列表被换掉而跳回顶部，
   * 二是少两次请求（只补一次 summary，用来更新上面的计数）。
   * 价格关联不受状态影响，因此不需要重算 pricingStatus。
   */
  async function toggleStatus(course: Course) {
    setError("");
    const next: Course["status"] = course.status === "开放" ? "暂未开放" : "开放";
    const updated = await api.courses.update(course.id, { status: next });
    if (updated !== null) {
      setCourses((prev) => (prev ?? []).map((item) => (item.id === course.id ? updated : item)));
    }
    setSummary(await api.courses.summary());
  }

  async function remove(course: Course) {
    const verdict = canRemoveCourse(course);
    if (!verdict.ok) {
      setError(verdict.reason);
      return;
    }
    if (!window.confirm(`删除课程「${course.name}」？已有课节与报课记录里的科目名不会变（它们按名字记的）。`)) {
      return;
    }
    try {
      await api.courses.remove(course.id);
      setMessage(`已删除「${course.name}」。`);
      await load({ quiet: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败。");
    }
  }

  async function syncFromSite() {
    setSyncing(true);
    setError("");
    setMessage("");
    const result = await api.courses.syncFromSite();
    setSyncing(false);
    setMessage(
      result.added.length === 0
        ? `网站上的课程都已在课程库里（共 ${result.total} 门）。`
        : `从网站同步了 ${result.added.length} 门课程：${result.added.join("、")}（现共 ${result.total} 门）。`,
    );
    await load({ quiet: true });
  }

  /** 体检：只算不写（服务端在深拷贝上算，库里一个字都不会变）。 */
  async function checkSiteContent() {
    setSitePending(true);
    setError("");
    setMessage("");
    try {
      setSiteCheck(await api.site.importFromContent({ write: false }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "体检失败。");
    } finally {
      setSitePending(false);
    }
  }

  /** 确认写入：默认只补空；勾了「用网站内容覆盖」才替换已有内容。 */
  async function applySiteContent() {
    setSitePending(true);
    setError("");
    setMessage("");
    try {
      const report = await api.site.importFromContent({ write: true, overwrite: siteOverwrite });
      setSiteCheck(report);
      const { counts } = report;
      setMessage(
        `已从网站内容导入：教师 新增 ${counts.teachersAdded} / 补资料 ${counts.teachersFilled}，` +
          `课程 新增 ${counts.coursesAdded} / 补字段 ${counts.coursesFilled}，` +
          `课程正文 ${counts.subjectsWritten} 个学科 / ${counts.bandsWritten} 个小节，` +
          `报价文案 ${counts.labelsFilled} 项。`,
      );
      await load({ quiet: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败。");
    } finally {
      setSitePending(false);
    }
  }

  const visible = useMemo(
    () =>
      (courses ?? []).filter((course) => {
        if (originFilter !== "全部" && course.origin !== originFilter) return false;
        const key = keyword.trim();
        return key === "" || course.name.includes(key) || course.category.includes(key);
      }),
    [courses, keyword, originFilter],
  );

  /** 还没配价格的课程（家长问价时答不上来的那些）。 */
  const unpricedCount = useMemo(
    () => pricingStatus.filter((item) => !item.priced).length,
    [pricingStatus],
  );
  const priceOf = useMemo(() => {
    const map = new Map<string, LibraryPricingStatus>();
    for (const item of pricingStatus) map.set(item.courseId, item);
    return map;
  }, [pricingStatus]);

  const grouped = useMemo(() => {
    const map = new Map<string, Course[]>();
    for (const course of visible) {
      const key = course.category.trim() === "" ? "未分类" : course.category.trim();
      const list = map.get(key);
      if (list === undefined) map.set(key, [course]);
      else list.push(course);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <>
      <PageHeading
        title="课程库"
        description="排课的科目、教师可带科目、报课科目都取自这里。网站上还没有的课（围棋、书法）也可以在这里先建起来。"
      />
      <DataNotice
        onRefresh={() => {
          // 同样用安静刷新：手动刷新也不该把列表清空、把页面高度塌掉
          void load({ quiet: true });
        }}
      />

      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <strong className="font-medium">课程会在网站上怎么出现，取决于两件事。</strong>
        一是下面每门课的「网站上怎么展示」：填了「学科 / 选修」与卡片路径的课程才会成为
        网站上的卡片（填「不展示」表示它只在后台用于排课与记课时）。二是网站**构站时能不能
        连上后端**：连得上就用库里的数据生成页面，连不上（例如 GitHub Pages）就整体回落到
        模版文件 <code className="mx-1 rounded bg-white/70 px-1">data/site/*.md</code>
        —— 口径见技术架构 §10.1。反过来，内容文件里新加了课程卡片后，点「从网站同步课程」
        把它拉进课程库；老库升级上来时点「从网站导入内容」把卡片字段与课程正文一次性补齐。
        <br />
        <strong className="font-medium">与报价的关系：</strong>
        课程库决定「能排哪些课」，报价页决定「这门课多少钱」。每门课下面是它的报价状态；
        没定价的课到「报价」页填一个基础价（那一步之后还要「导出配置」才会出现在家长的报价页上）。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void syncFromSite()} disabled={syncing}>
          {syncing ? "同步中…" : "从网站同步课程"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void checkSiteContent()}
          disabled={sitePending}
        >
          {sitePending ? "体检中…" : "从网站导入内容"}
        </Button>
        <Button variant="outline" onClick={() => setImporting((value) => !value)}>
          {importing ? "收起导入" : "批量导入"}
        </Button>
        {summary !== null && (
          <span className="text-xs text-ink-500">
            共 {summary.total} 门（网站 {summary.fromSite} · 后台 {summary.fromAdmin}）· 开放{" "}
            {summary.open} · 暂未开放 {summary.unavailable}
            {unpricedCount > 0 && ` · 未定价 ${unpricedCount} 门`}
          </span>
        )}
      </div>

      {importing && (
        <BulkImport fixedEntity="courses" onImported={async () => { await load({ quiet: true }); }} />
      )}

      {message !== "" && <p className="mt-2 text-xs leading-relaxed text-success-600">{message}</p>}
      {error !== "" && (
        <p className="mt-2 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-xs leading-relaxed text-danger-600">
          {error}
        </p>
      )}

      {/* ── 新建 / 编辑 ── */}
      <Panel
        className="mt-5"
        title={editing === null ? "新增课程" : `编辑「${editing.name}」`}
        description={
          editing === null
            ? "例如「围棋」「书法」「编程」。分类可以填网站栏目名，也可以自己写一个（如「兴趣才艺」）。"
            : "网站来源的课程也能改：状态、班型、分类、备注都是机构自己的信息；课程名改了以后，新排的课用新名字。"
        }
        actions={
          editing === null ? undefined : (
            <Button variant="ghost" size="sm" onClick={resetForm}>
              取消编辑
            </Button>
          )
        }
      >
        <form onSubmit={onSubmit} className="space-y-3 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label="课程名"
              hint="排课与统计都按这个名字记，请不要重复"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 围棋"
              required
            />
            <TextField
              label="分类"
              hint="可用下面的建议，也可以自己写"
              list="course-categories"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="例如 兴趣才艺"
            />
            <datalist id="course-categories">
              {categoryOptions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            <SelectInput
              label="状态"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={COURSE_STATUSES.map((item) => ({ value: item, label: item }))}
            />
          </div>

          <MultiSelect
            label="可开班型"
            hint="这门课按哪些班型开班（留空也可以，后面再补）"
            options={formOptions.map((item) => ({ value: item }))}
            value={forms}
            onChange={setForms}
            placeholder="选择班型（可多选）"
          />

          <TextAreaField
            label="备注"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：教材用《围棋入门》、需自备棋具"
          />

          {/*
            网站卡片字段（v15）：课程库同时是**网站课程卡片**的来源。
            刻意收在一个可折叠说明的区块里：只有"这门课要出现在网站上"时才需要填，
            日常加一门内部课（围棋、书法）用不上这些。
          */}
          <div className="mt-3 rounded-md border border-ink-200 bg-ink-50/50 px-3 py-3">
            <p className="text-xs font-medium text-ink-700">网站上怎么展示（选填）</p>
            <p className="mt-1 text-xs text-ink-500">
              网站能连上后端构站时，课程页的栏目卡片就按这里的数据生成；
              「不展示」表示这门课只在后台用于排课与记课时。
            </p>

            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <SelectInput
                label="网站形态"
                hint="学科＝有自己的学段小节；选修＝只有一段介绍"
                options={COURSE_SITE_KINDS.map((value) => ({ value, label: value }))}
                value={siteKind}
                onChange={(event) => setSiteKind(event.target.value as CourseSiteKind)}
              />
              <TextField
                label="卡片路径"
                hint="网址里的 ASCII 分段，例如 junior-math（不展示可留空）"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="例如 junior-math"
              />
              <TextField
                label="子栏目"
                hint="栏目再分组时填（高中课内分 必考科目 / 外语 / 七选三）"
                value={subgroup}
                onChange={(event) => setSubgroup(event.target.value)}
                placeholder="例如 七选三"
              />
              <TextField
                label="卡片标签"
                hint="「标签→小节名」用顿号分隔；不填表示这门课没有细分"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="例如 学考→高中物理学考、选考→高中物理选考"
              />
              <TextField
                label="卡片点进哪一节"
                hint="留空则用课程名（有标签时用第一个标签的目标）"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="例如 高中物理学考"
              />
              <TextField
                label="显示顺序"
                hint="同一栏目内越小越靠前；留空排在最后"
                type="number"
                value={order}
                onChange={(event) => setOrder(event.target.value)}
                placeholder="例如 1"
              />
            </div>

            <div className="mt-3">
              <TextAreaField
                label="一句话介绍"
                hint="选修课卡片会用到；学科卡片留空时网站用正文首段代替"
                rows={2}
                value={intro}
                onChange={(event) => setIntro(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : editing === null ? "添加课程" : "保存修改"}
            </Button>
            {editing === null && (
              <span className="text-xs text-ink-400">
                添加后可立即在「课程安排」「咨询」「学生报课」里选到这门课。
              </span>
            )}
          </div>
        </form>
      </Panel>

      {/*
        体检 / 导入结果面板：逐条列出会动什么，确认后才写。
        写成"列清单 + 两个按钮"，而不是"再点一次就写"—— 导入是不可撤销的动作。
      */}
      {siteCheck !== null && (
        <Panel
          className="mt-5"
          title={siteCheck.written ? "已从网站内容导入" : "从网站导入 · 体检结果（尚未写入）"}
          description="教师资料、课程卡片字段、课程正文、报价文案。默认**只补空**：机构在后台改过的内容不会被冲掉。"
        >
          <ul className="max-h-64 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-ink-600">
            {siteCheck.changes.map((item) => (
              <li key={item} className="border-b border-ink-50 py-1 last:border-0">
                {item}
              </li>
            ))}
          </ul>
          <label className="mx-4 mb-2 flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={siteOverwrite}
              onChange={(event) => setSiteOverwrite(event.target.checked)}
            />
            用网站内容**覆盖**已有内容（课程正文、课程字段、教师资料都会按内容文件重写）
          </label>
          <div className="flex items-center gap-2 px-4 pb-4">
            {!siteCheck.written && (
              <Button onClick={() => void applySiteContent()} disabled={sitePending}>
                {sitePending ? "导入中…" : "确认导入"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setSiteCheck(null)}>
              关闭
            </Button>
          </div>
        </Panel>
      )}

      {/* ── 列表 ── */}
      <Panel className="mt-5 mb-8" title="课程清单" description="按分类分组。网站来源的课程跟着内容文件走，不能删除。">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-3">
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索课程名或分类…"
            className="h-9 min-w-48 flex-1 rounded-md border border-ink-200 px-3 text-sm outline-none focus:border-brand-400"
          />
          <div className="flex items-center gap-1.5">
            {["全部", "网站", "后台"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setOriginFilter(item)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  originFilter === item
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-ink-200 text-ink-600 hover:border-ink-300",
                )}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-400">
            {visible.length} 门{refreshing ? "（刷新中…）" : ""}
          </span>
        </div>

        {loading ? (
          <p className="px-4 py-6 text-sm text-ink-400">加载中…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-500">没有匹配的课程。</p>
        ) : (
          <div className="divide-y divide-ink-100">
            {grouped.map(([group, items]) => (
              <div key={group} className="px-4 py-3">
                <h3 className="mb-2 text-xs font-medium text-ink-500">
                  {group}
                  <span className="ml-2 text-ink-400">{items.length} 门</span>
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((course) => (
                    <li
                      key={course.id}
                      className={cn(
                        "rounded-md border px-3 py-2",
                        course.status === "开放" ? "border-ink-200" : "border-dashed border-ink-300 bg-ink-50",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm text-ink-900">{course.name}</span>
                        <span className="flex items-center gap-1">
                          <span
                            className={cn(
                              "rounded-sm border px-1.5 py-0.5 text-[11px]",
                              course.origin === "后台"
                                ? "border-brand-200 bg-brand-50 text-brand-700"
                                : "border-ink-200 bg-white text-ink-500",
                            )}
                          >
                            {course.origin}
                          </span>
                          <span
                            className={cn(
                              "rounded-sm border px-1.5 py-0.5 text-[11px]",
                              course.status === "开放"
                                ? "border-success-100 bg-success-50 text-success-600"
                                : "border-ink-200 bg-ink-50 text-ink-500",
                            )}
                          >
                            {course.status}
                          </span>
                        </span>
                      </div>

                      {course.forms.length > 0 && (
                        <p className="mt-1 text-[11px] text-ink-500">
                          班型：{course.forms.join("、")}
                        </p>
                      )}
                      {course.note !== "" && (
                        <p className="mt-1 text-[11px] text-ink-400">{course.note}</p>
                      )}

                      {/* 报价状态：课程库与报价配置「打通」之后，这里能一眼看出哪门课还没定价 */}
                      {(() => {
                        const status = priceOf.get(course.id);
                        if (status === undefined) return null;
                        if (!status.priced) {
                          return (
                            <p className="mt-1 text-[11px] text-warning-600">
                              未定价 —— 到「报价」页给它填一个基础价，家长问价时才有依据
                            </p>
                          );
                        }
                        return (
                          <p className="mt-1 text-[11px] text-ink-500">
                            {status.basePrice === null
                              ? `已关联报价（${status.stageName} · 暂未开放）`
                              : `报价 ${status.basePrice} 元/节（${status.stageName}）`}
                          </p>
                        );
                      })()}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(course)}
                          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-600 hover:border-brand-300 hover:text-brand-700"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleStatus(course)}
                          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-600 hover:border-brand-300 hover:text-brand-700"
                        >
                          {course.status === "开放" ? "设为暂未开放" : "设为开放"}
                        </button>
                        {course.origin === "后台" && (
                          <button
                            type="button"
                            onClick={() => void remove(course)}
                            className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 hover:border-danger-100 hover:text-danger-600"
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
