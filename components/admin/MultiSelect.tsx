"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * 复选下拉（多选）。
 *
 * 为什么不用一排复选框：候选是**课程库里的全部课程**（现在 30 多门，以后还会更多），
 * 平铺出来会把表单撑得很长，找一门课要滚半天。收进下拉里，再加上搜索框，
 * 输入「围棋」就只剩一项。
 *
 * 为什么不用原生 `<select multiple>`：它要求按住 Ctrl 才能多选，
 * 机构老师第一次用基本都会选错（而且它没法搜索、没法分组、没法显示「已选几项」）。
 *
 * 交互：点按钮展开 → 搜索 / 勾选 → 点外部或 Esc 收起。选项可以按 `group` 分组
 * （科目的分组就是课程栏目，与网站上的叫法一致）。
 */
export type MultiSelectOption = {
  value: string;
  /** 分组名（可不填）；相同分组会排在一起并显示组标题。 */
  group?: string;
};

export function MultiSelect({
  label,
  hint,
  options,
  value,
  onChange,
  placeholder = "点击选择…",
  emptyText = "没有可选项",
  className,
}: {
  label: string;
  hint?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 点外部 / 按 Esc 收起：下拉不收起会挡住下面的字段
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const key = keyword.trim();
    if (key === "") return options;
    return options.filter((option) => option.value.includes(key));
  }, [options, keyword]);

  /** 按分组排列（没有分组的排在最后），保持传入顺序。 */
  const groups = useMemo(() => {
    const map = new Map<string, MultiSelectOption[]>();
    for (const option of filtered) {
      const group = option.group ?? "";
      const list = map.get(group);
      if (list === undefined) map.set(group, [option]);
      else list.push(option);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);
  };

  const summary =
    value.length === 0 ? placeholder : `已选 ${value.length} 项：${value.join("、")}`;

  return (
    <div className={cn("block", className)} ref={boxRef}>
      <span className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-ink-800">{label}</span>
        {hint !== undefined && <span className="text-xs text-ink-400">{hint}</span>}
      </span>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className={cn(
            "flex min-h-10 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
            open ? "border-brand-400" : "border-ink-300 hover:border-ink-400",
            value.length === 0 ? "text-ink-400" : "text-ink-900",
          )}
        >
          <span className="min-w-0 flex-1 break-words">{summary}</span>
          <span className="shrink-0 text-xs text-ink-400">{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-ink-200 bg-white shadow-lg">
            <div className="border-b border-ink-100 p-2">
              <input
                type="search"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="输入关键字筛选…"
                className="w-full rounded-md border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
              />
            </div>

            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-ink-400">
                  {options.length === 0 ? emptyText : "没有匹配的项"}
                </p>
              ) : (
                groups.map(([group, items]) => (
                  <div key={group === "" ? "__ungrouped" : group}>
                    {group !== "" && (
                      <p className="px-2.5 pt-2 pb-1 text-[11px] text-ink-400">{group}</p>
                    )}
                    {items.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm text-ink-800 hover:bg-ink-50"
                      >
                        <input
                          type="checkbox"
                          checked={value.includes(option.value)}
                          onChange={() => toggle(option.value)}
                        />
                        <span className="min-w-0 flex-1 break-words">{option.value}</span>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-2 py-1.5">
              <button
                type="button"
                onClick={() => {
                  const names = filtered.map((option) => option.value);
                  onChange([...new Set([...value, ...names])]);
                }}
                className="rounded px-2 py-1 text-xs text-brand-700 hover:bg-brand-50"
              >
                全选{keyword.trim() === "" ? "" : "筛选结果"}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-50"
              >
                清空
              </button>
            </div>
          </div>
        )}
      </div>

      {value.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {value.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => toggle(item)}
              title="点击移除"
              className="rounded-sm border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-600 hover:border-danger-100 hover:text-danger-600"
            >
              {item} ×
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
