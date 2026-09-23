"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/backend/api";
import { featuredFormOptions } from "@/lib/backend/featured-tree";
import { getFormOptionsFromTemplate } from "@/lib/backend/options";

/**
 * 班型候选（后台表单里所有「选班型」的地方共用）。
 *
 * ## 取值顺序刻意是「先用模版垫一帧，再用库里那一份替换」
 *
 *   1. 初始值取**构建期的模版**（同步、无需等待），表单第一帧就有候选；
 *   2. 挂载后问一次后端，拿到**库里的特色课程树**（v20 起它在库里），到了就替换 ——
 *      机构在后台加的班型立刻出现在所有下拉里。
 *
 * 为什么必须走后端：班型候选就是特色课程的**二级课程名**，而特色课程已经搬进库
 * （后台「网站内容」页可增删改）。如果这里仍读模版，机构在后台加一个「寒假集训」，
 * 后台自己的下拉里反而看不到它 —— 那是这一版要拆掉的耦合。
 *
 * ## 为什么用模块级缓存
 *
 * 这一个 hook 被**五处**用（课程库、报课面板、学生建档、单节课表单、批量排课表单）。
 * 每处各请求一次整份公开数据（几百 KB）显然不合理；模块级共享一个 Promise 之后，
 * 一次页面加载只请求一次，五处共用同一份结果。
 */
let cached: Promise<string[]> | null = null;

/** 问一次后端要班型候选（同一个页面里多次调用只请求一次）。 */
function loadFormOptions(): Promise<string[]> {
  cached ??= api.site
    .publicContent()
    .then((data) => featuredFormOptions(data.siteContent.featuredPage))
    .catch(() => {
      /*
       * 取不到（后端没跑、登录过期、后端版本太旧没有 featuredPage）就返回模版那一份，
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
      // 后端返回空列表时不覆盖：宁可显示模版那一份，也不要让下拉空掉
      if (alive && names.length > 0) setOptions(names);
    });
    return () => {
      alive = false;
    };
  }, []);

  return options;
}
