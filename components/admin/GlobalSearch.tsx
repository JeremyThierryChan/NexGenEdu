"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type SearchHit } from "@/lib/backend/api";
import { groupHits } from "@/lib/backend/search";
import { cn } from "@/lib/utils/cn";

/**
 * 全局搜索（顶栏）。
 *
 * 后台入口很多，但「我要找某个人或某节课」是最高频的动作 —— 挨个页面翻太慢。
 * 这里一个框搜五类对象，结果按类别分组，点进去直达。
 *
 * 交互细节：
 * - 输入后 200ms 再去查（避免每敲一个字都打一次「服务」）；
 * - ↑↓ 选择、Enter 打开、Esc 关闭；
 * - 点外部关闭。
 */
export function GlobalSearch() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // 防抖查询
  useEffect(() => {
    const text = keyword.trim();
    if (text === "") {
      setHits([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.search(text).then((result) => {
        if (!cancelled) {
          setHits(result);
          setActive(0);
        }
      });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  // 点击外部关闭
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const groups = groupHits(hits);

  function go(hit: SearchHit) {
    setOpen(false);
    setKeyword("");
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (hits.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (value + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (value - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[active];
      if (hit !== undefined) go(hit);
    }
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 max-w-sm">
      <input
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="搜索学生 / 教师 / 教室 / 课 / 课程"
        aria-label="全局搜索"
        className="w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />

      {open && keyword.trim() !== "" && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-96 overflow-y-auto rounded-md border border-ink-200 bg-white shadow-lg">
          {groups.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-500">
              没有匹配「{keyword.trim()}」的记录。
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.kind}>
                <p className="border-b border-ink-100 bg-ink-50 px-3 py-1 text-[11px] text-ink-500">
                  {group.kind}
                </p>
                <ul>
                  {group.hits.map((hit) => {
                    const index = hits.indexOf(hit);
                    return (
                      <li key={`${hit.kind}-${hit.id}`}>
                        <button
                          type="button"
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(hit)}
                          className={cn(
                            "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors",
                            index === active ? "bg-brand-50" : "hover:bg-ink-50",
                          )}
                        >
                          <span className="text-sm text-ink-900">{hit.title}</span>
                          {hit.subtitle !== "" && (
                            <span className="text-xs text-ink-500">{hit.subtitle}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
