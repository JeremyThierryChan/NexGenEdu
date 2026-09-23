"use client";

import { TextAreaField, TextField } from "@/components/admin/AdminFields";
import { deriveSlug } from "@/lib/backend/featured-tree";
import type { SiteFeaturedCourse, SiteFeaturedPage } from "@/lib/backend/api";

/**
 * 特色课程的编辑器（三级课程树）。
 *
 * ## 为什么是递归组件
 *
 * 特色课程是一棵**有层级的树**（一级 → 二级 → 三级），每一级在网站上都**有自己的页面**
 * （`/courses/featured/<一级>/<二级>/<三级>`）。用"一个扁平列表 + 缩进"来编辑虽然也能做，
 * 但"加一门子课程""把整棵子树删掉"这两件事在扁平列表里很别扭（要自己算父子关系）。
 * 递归组件让结构直接长在代码上：每一层渲染自己的字段 + 自己的子课程。
 *
 * ## 三条与后端一致的规则（这里只做**提示**，判定仍在服务端）
 *
 *   - **最多三级**：界面到第三级就不再显示「加子课程」（服务端也会拒绝，见
 *     `validateFeaturedPage`）；
 *   - **同级课程名不重复**：重复会让页面上的两条看起来一模一样，网址也会撞车；
 *   - **路径分段（slug）**：网址里那一段，留空＝按名字自动派生。**改名不会改网址**
 *     （这正是把 `slug` 与 `name` 分开存的原因），想换网址就在这里改。
 */
export function FeaturedCoursesEditor({
  page,
  canWrite,
  onChange,
}: {
  page: SiteFeaturedPage;
  canWrite: boolean;
  onChange: (next: SiteFeaturedPage) => void;
}) {
  /** 按 id 递归改一棵子树（返回新的节点）；找不到就原样返回。 */
  function patchCourse(
    courses: SiteFeaturedCourse[],
    id: string,
    patch: (course: SiteFeaturedCourse) => SiteFeaturedCourse,
  ): SiteFeaturedCourse[] {
    return courses.map((course) =>
      course.id === id
        ? patch(course)
        : { ...course, children: patchCourse(course.children, id, patch) },
    );
  }

  function removeCourse(courses: SiteFeaturedCourse[], id: string): SiteFeaturedCourse[] {
    return courses
      .filter((course) => course.id !== id)
      .map((course) => ({ ...course, children: removeCourse(course.children, id) }));
  }

  /** 在某个节点下面加一门子课程（id 留空：服务端保存时生成）。 */
  function addChild(courses: SiteFeaturedCourse[], id: string, intoRoot = false): SiteFeaturedCourse[] {
    const created: SiteFeaturedCourse = {
      id: "",
      name: "",
      slug: "",
      fields: [],
      body: "",
      children: [],
    };
    if (intoRoot) return [...courses, created];
    return courses.map((course) =>
      course.id === id
        ? { ...course, children: [...course.children, created] }
        : { ...course, children: addChild(course.children, id) },
    );
  }

  /** 同级上移 / 下移：交换数组里的两项（顺序就是页面顺序）。 */
  function moveSibling(courses: SiteFeaturedCourse[], id: string, delta: -1 | 1): SiteFeaturedCourse[] {
    const index = courses.findIndex((course) => course.id === id);
    if (index !== -1) {
      const swap = index + delta;
      if (swap < 0 || swap >= courses.length) return courses;
      const next = [...courses];
      const moved = next[index]!;
      next[index] = next[swap]!;
      next[swap] = moved;
      return next;
    }
    return courses.map((course) => ({ ...course, children: moveSibling(course.children, id, delta) }));
  }

  function renderNode(course: SiteFeaturedCourse, depth: number, index: number, siblings: number): React.ReactNode {
    const slug = course.slug.trim() === "" ? deriveSlug(course.name) : course.slug.trim();
    return (
      <li
        key={course.id === "" ? `new-${String(depth)}-${String(index)}` : course.id}
        className={depth === 1 ? "rounded-md border border-ink-200 bg-white px-3 py-3" : "mt-3 rounded-md border border-ink-100 bg-ink-50/60 px-3 py-3"}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <TextField
              label={depth === 1 ? "一级课程名" : depth === 2 ? "二级课程名" : "三级课程名"}
              value={course.name}
              onChange={(event) =>
                onChange({ ...page, courses: patchCourse(page.courses, course.id, (item) => ({ ...item, name: event.target.value })) })
              }
              disabled={!canWrite}
            />
          </div>
          <div className="w-44">
            <TextField
              label="路径分段"
              hint={slug === "" ? "留空＝按名字派生" : `网址里那一段：${slug}`}
              value={course.slug}
              onChange={(event) =>
                onChange({ ...page, courses: patchCourse(page.courses, course.id, (item) => ({ ...item, slug: event.target.value })) })
              }
              disabled={!canWrite}
            />
          </div>
          {canWrite && (
            <span className="flex items-center gap-1 pb-1">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => onChange({ ...page, courses: moveSibling(page.courses, course.id, -1) })}
                className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === siblings - 1}
                onClick={() => onChange({ ...page, courses: moveSibling(page.courses, course.id, 1) })}
                className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`删除「${course.name === "" ? "（未命名）" : course.name}」？`)) return;
                  onChange({ ...page, courses: removeCourse(page.courses, course.id) });
                }}
                className="rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600"
              >
                删除
              </button>
            </span>
          )}
        </div>

        {/* 描述字段（适合对象 / 课程定位…）——可增删的键值对，与案例那边同一套做法 */}
        <div className="mt-2 space-y-2">
          {course.fields.map((field, fieldIndex) => (
            <div key={`${course.id}-${String(fieldIndex)}`} className="flex flex-wrap items-center gap-2">
              <input
                value={field.title}
                disabled={!canWrite}
                onChange={(event) =>
                  onChange({
                    ...page,
                    courses: patchCourse(page.courses, course.id, (item) => ({
                      ...item,
                      fields: item.fields.map((entry, i) =>
                        i === fieldIndex ? { ...entry, title: event.target.value } : entry,
                      ),
                    })),
                  })
                }
                placeholder="字段名（如 适合对象）"
                className="h-8 w-32 rounded-md border border-ink-200 px-2 text-xs outline-none focus:border-brand-400 disabled:bg-ink-50"
              />
              <input
                value={field.value}
                disabled={!canWrite}
                onChange={(event) =>
                  onChange({
                    ...page,
                    courses: patchCourse(page.courses, course.id, (item) => ({
                      ...item,
                      fields: item.fields.map((entry, i) =>
                        i === fieldIndex ? { ...entry, value: event.target.value } : entry,
                      ),
                    })),
                  })
                }
                placeholder="内容"
                className="h-8 min-w-48 flex-1 rounded-md border border-ink-200 px-2 text-xs outline-none focus:border-brand-400 disabled:bg-ink-50"
              />
              {canWrite && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...page,
                      courses: patchCourse(page.courses, course.id, (item) => ({
                        ...item,
                        fields: item.fields.filter((_entry, i) => i !== fieldIndex),
                      })),
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
              onClick={() =>
                onChange({
                  ...page,
                  courses: patchCourse(page.courses, course.id, (item) => ({
                    ...item,
                    fields: [...item.fields, { title: "适合对象", value: "" }],
                  })),
                })
              }
              className="rounded-sm border border-dashed border-ink-300 px-2 py-1 text-[11px] text-ink-500 hover:border-brand-400 hover:text-brand-700"
            >
              + 加一个字段
            </button>
          )}
        </div>

        <div className="mt-2">
          <TextAreaField
            label="详细介绍"
            hint="段落之间空一行；显示在这门课程的独立页面上"
            rows={3}
            value={course.body}
            onChange={(event) =>
              onChange({ ...page, courses: patchCourse(page.courses, course.id, (item) => ({ ...item, body: event.target.value })) })
            }
            disabled={!canWrite}
          />
        </div>

        {/*
          加子课程 / 子课程列表：到第三级就不再显示（网站的页面结构只到三级）
        */}
        {depth < 3 && (
          <div className="mt-3 border-l-2 border-ink-200 pl-3">
            {canWrite && (
              <button
                type="button"
                onClick={() => onChange({ ...page, courses: addChild(page.courses, course.id) })}
                className="rounded-sm border border-dashed border-ink-300 px-2 py-1 text-[11px] text-ink-500 hover:border-brand-400 hover:text-brand-700"
              >
                + 加一门子课程（{depth === 1 ? "二级" : "三级"}）
              </button>
            )}
            {course.children.length > 0 && (
              <ul className="mt-2">
                {course.children.map((child, childIndex) =>
                  renderNode(child, depth + 1, childIndex, course.children.length),
                )}
              </ul>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="页眉小字"
          value={page.heading.eyebrow}
          onChange={(event) => onChange({ ...page, heading: { ...page.heading, eyebrow: event.target.value } })}
          disabled={!canWrite}
        />
        <TextField
          label="页面标题"
          value={page.heading.title}
          onChange={(event) => onChange({ ...page, heading: { ...page.heading, title: event.target.value } })}
          disabled={!canWrite}
        />
        <TextField
          label="页脚提示"
          hint="例如「课程能否开班取决于当前排课与人数」"
          value={page.notice}
          onChange={(event) => onChange({ ...page, notice: event.target.value })}
          disabled={!canWrite}
        />
      </div>
      <div className="mt-3">
        <TextAreaField
          label="页面说明"
          rows={2}
          value={page.heading.description}
          onChange={(event) => onChange({ ...page, heading: { ...page.heading, description: event.target.value } })}
          disabled={!canWrite}
        />
      </div>

      {page.courses.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-ink-300 px-4 py-6 text-sm text-ink-500">
          还没有特色课程。点下面的「+ 加一门一级课程」开始 —— 每门课程在网站上都有自己的页面
          （网址由各级的「路径分段」拼出来）。
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {page.courses.map((course, index) => renderNode(course, 1, index, page.courses.length))}
        </ul>
      )}

      {canWrite && (
        <button
          type="button"
          onClick={() => onChange({ ...page, courses: addChild(page.courses, "", true) })}
          className="mt-4 rounded-md border border-dashed border-ink-300 px-3 py-2 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-700"
        >
          + 加一门一级课程
        </button>
      )}
    </div>
  );
}
