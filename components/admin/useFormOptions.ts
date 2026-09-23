"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/backend/api";
import { getFormOptionsFromTemplate } from "@/lib/backend/options";

/**
 * 班型候选（后台表单里所有「选班型」的地方共用）。
 *
 * ## 口径：全系统只有一份
 *
 * 班型就是 `catalog.formats`（课程类型维度表里的一个维度）：
 * 一对一 / 一对二 / 一对三 / 小班课（4-8人）/ 大班课（9-20人）。
 * 报价的人数系数、学生档案的「班型」、排课的「班型」、课程库的「可开班型」
 * 全都按这一份走 —— 机构在后台「课程类型」页加一个班型，所有下拉立刻都有它。
 *
 * 以前这里取的是**特色课程树的二级课程名**（一对一 / 一对二…）：
 * 那让"班型"有了第二套写法，同一件事在两个下拉里名字不同，统计与报价就对不上。
 * 机构确认"以系统现行的那一套为准全部改过来"之后，改成了读维度表。
 *
 * ## 取值顺序刻意是「先用种子垫一帧，再用库里那一份替换」
 *
 *   1. 初始值取**构建期的种子**（同步、无需等待），表单第一帧就有候选；
 *   2. 挂载后问一次后端，拿到库里的维度表，到了就替换。
 *
 * ## 为什么用模块级缓存
 *
 * 这一个 hook 被**五处**用（课程库、报课面板、学生建档、单节课表单、批量排课表单）。
 * 每处各请求一次整份维度表显然不合理；模块级共享一个 Promise 之后，
 * 一次页面加载只请求一次，五处共用同一份结果。
 */
let cached: Promise<string[]> | null = null;

/** 问一次后端要班型候选（同一个页面里多次调用只请求一次）。 */
function loadFormOptions(): Promise<string[]> {
  cached ??= api.catalog
    .list()
    .then((catalog) => catalog.formats.map((format) => format.name))
    .catch(() => {
      /*
       * 取不到（后端没跑、登录过期、后端版本太旧没有 catalog）就返回种子那一份，
       * 并且**把缓存清掉**：下次挂载时重试一次，而不是永久停留在失败的结果上。
       */
      cached = null;
      return [];
    });
  return cached;
}

/** 班型候选。返回空数组表示"这一帧还没有"（表单可以照常渲染，只是下拉是空的）。 */
export function useFormOptions(): string[] {
  const [options, setOptions] = useState<string[]>(() => getFormOptionsFromTemplate());

  useEffect(() => {
    let alive = true;
    void loadFormOptions().then((names) => {
      // 后端返回空列表时不覆盖：宁可显示种子那一份，也不要让下拉空掉
      if (alive && names.length > 0) setOptions(names);
    });
    return () => {
      alive = false;
    };
  }, []);

  return options;
}
