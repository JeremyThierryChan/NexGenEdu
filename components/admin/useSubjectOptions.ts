"use client";

import { useEffect, useState } from "react";
import { api, type CourseOption } from "@/lib/backend/api";
import { getSubjectOptions } from "@/lib/backend/options";

/**
 * 科目候选（后台表单里所有「选科目」的地方共用）。
 *
 * 取值顺序刻意是「先给内容里的课程，再用课程库补齐」：
 *
 *   1. 初始值直接取网站内容里的课程卡片（同步、无需等待），表单立刻可用；
 *   2. 挂载后再问服务层要**课程库**的完整清单（网站课程 + 机构自己加的围棋、书法…），
 *      到了就替换掉。
 *
 * 这样即使服务层取不到（内容被改坏、存储异常），下拉也不会是空的 ——
 * 只是少了机构自建的课程，不会让人没法录入。
 *
 * 返回 `{ options, names }`：`options` 带分类（用于复选下拉分组），
 * `names` 是纯名字数组（用于 <SelectInput> 的单选场景）。
 */
export function useSubjectOptions(): { options: CourseOption[]; names: string[] } {
  const [options, setOptions] = useState<CourseOption[]>(() =>
    getSubjectOptions().map((name) => ({ name, category: "", origin: "网站" as const })),
  );

  useEffect(() => {
    let alive = true;
    void api.courses
      .options()
      .then((rows) => {
        if (alive && rows.length > 0) setOptions(rows);
      })
      .catch(() => {
        // 取不到就沿用内容里的课程：科目候选少几个，也不该让表单打不开
      });
    return () => {
      alive = false;
    };
  }, []);

  return { options, names: options.map((option) => option.name) };
}
