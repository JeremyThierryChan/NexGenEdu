import { getFeaturedContent } from "@/lib/data/featured";
import { getCourseColumns } from "@/lib/data/site";

/**
 * 后台表单里的候选项。
 *
 * 后台与宣传网站共用同一套「科目 / 班型」叫法，因此这里直接从站点内容里取，
 * 而不是在后台再抄一份：抄一份的后果是两边慢慢对不上，
 * 排课里的科目名与课程页的科目名不一致，统计就对不起来了。
 *
 * 取值失败（内容被改坏）时不抛错，返回空数组 —— 表单仍可手填，
 * 不会因为候选项取不到就把整个后台打不开。
 */

/** 科目候选：课程总览里全部卡片名（小学语文 / 初中数学 / 高中物理 / 雅思 …）。 */
export function getSubjectOptions(): string[] {
  try {
    return getCourseColumns().flatMap((column) =>
      column.subgroups.flatMap((subgroup) => subgroup.cards.map((card) => card.title)),
    );
  } catch {
    return [];
  }
}

/** 班型候选：特色课程里「课内辅导」下的二级课程（一对一定制课 / 晚托管 …）。 */
export function getFormOptions(): string[] {
  try {
    return getFeaturedContent().courses.flatMap((course) =>
      course.children.map((child) => child.name),
    );
  } catch {
    return [];
  }
}
