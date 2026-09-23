/**
 * **网站内容里的教师资料**（只读：把 `data/site/content.md` 的教师页解析成一份清单）。
 *
 * ## 这个模块以前还干一件事（v32 删掉了）
 *
 * 它以前是"把网站内容搬进库"：教师资料 / 课程卡片字段 / 课程正文 / 报价文案，
 * 带体检（`write: false` 一个字都不写）与"默认只补空、不覆盖"。后台「课程」页
 * 有两个按钮走这条路（「从网站同步课程」「从网站导入内容」）。
 *
 * 机构口径（2026-09）：**现在都以后端为主**，因此那两个入口连同本模块的导入实现一起删掉。
 * 剩下的这一份 `siteTeachers()` 还在用：自检拿它当"内容文件里那几位教师"的基准
 * （用来核对"库里的教师"与"内容文件里的教师"是不是同一批）。
 *
 * 新装系统的初始数据仍然来自内容文件（`initial.ts` → `materializeSiteCourses()` 等）——
 * 那是"空库起步"，不是运行期的导入。
 */

import { getTeachersPageFromTemplate } from "@/lib/data/site";
import type { Teacher } from "./types";

/** 网站内容里的教师资料（含 AI），按网站上的顺序。 */
export function siteTeachers(): Array<{
  name: string;
  role: string;
  subjects: string[];
  years: string;
  summary: string;
  bio: string;
  recommendation: string;
  order: number;
  kind: Teacher["kind"];
  /** 来自网站内容的人 → 默认在网站上展示（`siteVisible`，v16）。 */
  siteVisible: boolean;
}> {
  try {
    return getTeachersPageFromTemplate()
      .teachers.map((teacher) => ({
        name: teacher.name,
        role: teacher.role,
        subjects: teacher.subjects,
        years: teacher.years ?? "",
        summary: teacher.summary ?? "",
        bio: teacher.bio ?? "",
        recommendation: teacher.recommendation ?? "",
        /*
         * 用教师自己的「排序」值，**不要**用数组下标。
         * `getTeachersPage()` 已经按「排序」排好序了，所以下标看起来"也对"——
         * 但只要有人给某位教师填了 10（例如两位 AI 智能体排在真人之后），
         * 下标法会把它变成 3，网站上的教师顺序就跟内容文件不一致了。
         * 我第一版就是这么写的，等价性断言当场抓到了。
         */
        order: teacher.order,
        kind: teacher.kind === "ai" ? ("AI" as const) : ("教师" as const),
        siteVisible: true,
      }));
  } catch {
    return [];
  }
}
