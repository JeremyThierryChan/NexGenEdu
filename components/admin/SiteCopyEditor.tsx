"use client";

import { TextAreaField, TextField } from "@/components/admin/AdminFields";
import { SITE_COPY_LABELS } from "@/lib/backend/site-copy-model";
import type { SiteCopyBlock, SiteCopyGroup, SiteCopyItem, SiteCopyKey } from "@/lib/backend/api";

/**
 * 页面文案块编辑器（品牌与联系方式 / 首页 / 关于 / 联系我们 / 时间安排）。
 *
 * ## 为什么五个块共用**一个**组件
 *
 * 它们的形状完全一样：**短字段（键 → 值）+ 若干分组（分组标题 + 条目）**。
 * 五个块各写一套表单，就是五份要同步维护的界面代码（加一个字段要改五处）。
 * 这里按"块"渲染，块本身由 `SITE_COPY_KEYS` 决定 —— 以后再加一块文案，
 * 只要在模型里加一个键，界面自动就有。
 *
 * ## 短字段的键**不给改**（只能改值）
 *
 * 键是内容文件里的字段名，页面那侧按它取值（`CopySource.field("phone")`）。
 * 界面上允许改键的话，机构把 `phone` 改成 `tel` 的结果是页脚的电话**静默消失** ——
 * 而没有任何提示。因此这一栏是只读文字，值的输入框才是可编辑的。
 *
 * ## 分组的条目可以增删、可排序
 *
 * 一条条目 = 标题 + 值 + 正文（正文允许空）。内容文件里就是
 * `#### 标题 | 值` 加下方一段正文，因此界面上照这三样给。
 */
export function SiteCopyEditor({
  blockKey,
  block,
  canWrite,
  onChange,
}: {
  blockKey: SiteCopyKey;
  block: SiteCopyBlock;
  canWrite: boolean;
  onChange: (next: SiteCopyBlock) => void;
}) {
  function patchGroup(index: number, patch: Partial<SiteCopyGroup>): void {
    onChange({
      ...block,
      groups: block.groups.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    });
  }

  function patchItem(groupIndex: number, itemIndex: number, patch: Partial<SiteCopyItem>): void {
    onChange({
      ...block,
      groups: block.groups.map((group, i) =>
        i === groupIndex
          ? { ...group, items: group.items.map((item, j) => (j === itemIndex ? { ...item, ...patch } : item)) }
          : group,
      ),
    });
  }

  function moveGroup(index: number, delta: -1 | 1): void {
    const swap = index + delta;
    if (swap < 0 || swap >= block.groups.length) return;
    const next = [...block.groups];
    const moved = next[index]!;
    next[index] = next[swap]!;
    next[swap] = moved;
    onChange({ ...block, groups: next });
  }

  return (
    <div>
      <p className="text-xs leading-relaxed text-ink-500">
        「{SITE_COPY_LABELS[blockKey]}」的短字段与分组。**字段名（左栏）是页面取值用的键，不能改** ——
        改它会让页面上那一处静默空掉；要改的是右边的值。
      </p>

      {block.fields.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-ink-300 px-3 py-4 text-xs text-ink-500">
          这一块没有短字段。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {block.fields.map((field, index) => (
            <li key={field.id === "" ? `new-field-${String(index)}` : field.id} className="flex flex-wrap items-center gap-2">
              <span
                title="页面按这个名字取值，不要改"
                className="h-8 w-40 shrink-0 truncate rounded-md border border-ink-200 bg-ink-50 px-2 font-mono text-[11px] leading-8 text-ink-500"
              >
                {field.key}
              </span>
              {field.value.includes("\n") || field.value.length > 40 ? (
                <div className="min-w-64 flex-1">
                  <TextAreaField
                    label=""
                    rows={2}
                    value={field.value}
                    onChange={(event) =>
                      onChange({
                        ...block,
                        fields: block.fields.map((item, i) =>
                          i === index ? { ...item, value: event.target.value } : item,
                        ),
                      })
                    }
                    disabled={!canWrite}
                  />
                </div>
              ) : (
                <input
                  value={field.value}
                  disabled={!canWrite}
                  onChange={(event) =>
                    onChange({
                      ...block,
                      fields: block.fields.map((item, i) =>
                        i === index ? { ...item, value: event.target.value } : item,
                      ),
                    })
                  }
                  className="h-8 min-w-48 flex-1 rounded-md border border-ink-200 px-2 text-xs outline-none focus:border-brand-400 disabled:bg-ink-50"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {block.groups.length > 0 && (
        <ul className="mt-4 space-y-4">
          {block.groups.map((group, groupIndex) => (
            <li
              key={group.id === "" ? `new-group-${String(groupIndex)}` : group.id}
              className="rounded-md border border-ink-200 bg-white px-3 py-3"
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <TextField
                    label="分组标题"
                    hint="页面上显示的小标题"
                    value={group.title}
                    onChange={(event) => patchGroup(groupIndex, { title: event.target.value })}
                    disabled={!canWrite}
                  />
                </div>
                <div className="min-w-64 flex-[2]">
                  <TextField
                    label="分组说明"
                    hint="显示在分组标题下面；留空则不显示"
                    value={group.description}
                    onChange={(event) => patchGroup(groupIndex, { description: event.target.value })}
                    disabled={!canWrite}
                  />
                </div>
                {canWrite && (
                  <span className="flex items-center gap-1 pb-1">
                    <button
                      type="button"
                      disabled={groupIndex === 0}
                      onClick={() => moveGroup(groupIndex, -1)}
                      className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={groupIndex === block.groups.length - 1}
                      onClick={() => moveGroup(groupIndex, 1)}
                      className="rounded-sm border border-ink-200 px-1.5 py-0.5 text-[11px] text-ink-500 hover:border-ink-300 disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`删除分组「${group.title === "" ? "（未命名）" : group.title}」及其 ${String(group.items.length)} 条内容？`)) return;
                        onChange({ ...block, groups: block.groups.filter((_g, i) => i !== groupIndex) });
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
                  <div
                    key={item.id === "" ? `new-item-${String(itemIndex)}` : item.id}
                    className="rounded-md border border-ink-100 bg-ink-50/60 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-48 flex-1">
                        <TextField
                          label="标题"
                          value={item.title}
                          onChange={(event) => patchItem(groupIndex, itemIndex, { title: event.target.value })}
                          disabled={!canWrite}
                        />
                      </div>
                      <div className="min-w-48 flex-[2]">
                        <TextField
                          label="值"
                          value={item.value}
                          onChange={(event) => patchItem(groupIndex, itemIndex, { value: event.target.value })}
                          disabled={!canWrite}
                        />
                      </div>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() =>
                            patchGroup(groupIndex, {
                              items: group.items.filter((_item, j) => j !== itemIndex),
                            })
                          }
                          className="mb-1 rounded-sm border border-danger-100 px-1.5 py-0.5 text-[11px] text-danger-600 hover:border-danger-600"
                        >
                          删除
                        </button>
                      )}
                    </div>
                    {(item.body !== "" || canWrite) && (
                      <div className="mt-2">
                        <TextAreaField
                          label="正文"
                          hint="显示在这一条下面；留空则不显示"
                          rows={2}
                          value={item.body}
                          onChange={(event) => patchItem(groupIndex, itemIndex, { body: event.target.value })}
                          disabled={!canWrite}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() =>
                      patchGroup(groupIndex, {
                        items: [...group.items, { id: "", title: "", value: "", body: "" }],
                      })
                    }
                    className="rounded-sm border border-dashed border-ink-300 px-2 py-1 text-[11px] text-ink-500 hover:border-brand-400 hover:text-brand-700"
                  >
                    + 在这一组加一条
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
