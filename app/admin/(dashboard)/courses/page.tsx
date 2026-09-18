"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeading } from "@/components/ui/PageHeading";
import { Button } from "@/components/ui/Button";
import { DataNotice } from "@/components/admin/DataNotice";
import { MultiSelect } from "@/components/admin/MultiSelect";
import { Panel, SelectInput, TextAreaField, TextField } from "@/components/admin/AdminFields";
import { api, COURSE_STATUSES, type Course, type CourseSummary } from "@/lib/backend/api";
import { getCourseCategoryOptions, getFormOptions } from "@/lib/backend/options";
import { canRemoveCourse } from "@/lib/backend/courses";
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
  /** 每门课在报价配置里的定价状态（「打通」的可见部分）。 */
  const [pricingStatus, setPricingStatus] = useState<LibraryPricingStatus[]>([]);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [originFilter, setOriginFilter] = useState("全部");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  // 表单（新建 / 编辑共用）
  const [editing, setEditing] = useState<Course | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [forms, setForms] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("开放");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  const categoryOptions = useMemo(() => getCourseCategoryOptions(), []);
  const formOptions = useMemo(() => getFormOptions(), []);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, stats, config] = await Promise.all([
      api.courses.list(),
      api.courses.summary(),
      api.pricing.get(),
    ]);
    setCourses(list);
    setSummary(stats);
    setPricingStatus(pricingStatusForCourses(config, list));
    setLoading(false);
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
  }

  function startEdit(course: Course) {
    setEditing(course);
    setName(course.name);
    setCategory(course.category);
    setForms(course.forms);
    setStatus(course.status);
    setNote(course.note);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    };

    try {
      if (editing === null) {
        await api.courses.create({ ...payload, origin: "后台", createdAt: new Date().toISOString() });
        setMessage(`已添加课程「${payload.name}」。它现在可以用于排课、报课与教师科目。`);
      } else {
        await api.courses.update(editing.id, payload);
        setMessage(`已保存「${payload.name}」。`);
      }
      resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
    } finally {
      setPending(false);
    }
  }

  async function toggleStatus(course: Course) {
    setError("");
    await api.courses.update(course.id, {
      status: course.status === "开放" ? "暂未开放" : "开放",
    });
    await load();
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
      await load();
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
    await load();
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
        onReset={() => {
          void load();
        }}
      />

      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900">
        <strong className="font-medium">这里的课程不会自动出现在宣传网站上。</strong>
        网站页面是静态内容，要展示得在
        <code className="mx-1 rounded bg-white/70 px-1">data/site/content.md</code>
        的课程栏目里加一张卡片（见内容维护手册）。反过来，网站上新加了课程卡片后，
        点下面的「从网站同步」把它拉进课程库即可。
        <br />
        <strong className="font-medium">与报价的关系：</strong>
        课程库决定「能排哪些课」，报价页决定「这门课多少钱」。每门课下面是它的报价状态；
        没定价的课到「报价」页填一个基础价（那一步之后还要「导出配置」才会出现在家长的报价页上）。
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void syncFromSite()} disabled={syncing}>
          {syncing ? "同步中…" : "从网站同步课程"}
        </Button>
        {summary !== null && (
          <span className="text-xs text-ink-500">
            共 {summary.total} 门（网站 {summary.fromSite} · 后台 {summary.fromAdmin}）· 开放{" "}
            {summary.open} · 暂未开放 {summary.unavailable}
            {unpricedCount > 0 && ` · 未定价 ${unpricedCount} 门`}
          </span>
        )}
      </div>

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
          <span className="text-xs text-ink-400">{visible.length} 门</span>
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
