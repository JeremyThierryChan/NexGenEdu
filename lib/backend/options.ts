import { getFeaturedContent } from "@/lib/data/featured";
import { getScheduleContent } from "@/lib/data/pages";
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

/**
 * 学校标准时段的开始时间（从「时间安排」页的数据里取）。
 *
 * 咨询登记允许任意时间，但家长说的多半就是这些常规时段，因此界面上给一排
 * 快捷按钮。**从内容里读而不是抄一份**：抄一份迟早和「时间安排」页对不上。
 *
 * 返回形如 `[{ label: "晚第一节", start: "17:30" }]`；解析不出开始时间的跳过。
 */
export function getStandardSlots(): Array<{ label: string; start: string }> {
  try {
    const slots: Array<{ label: string; start: string }> = [];
    for (const group of getScheduleContent().groups) {
      for (const item of group.items) {
        // 值形如「17:30–19:30」，取破折号前的时间
        const match = /(\d{1,2}:\d{2})\s*[–—-]/.exec(item.value);
        if (match === null) continue;
        const start = match[1]!.padStart(5, "0");
        const label = `${group.title} · ${item.title}`;
        if (!slots.some((slot) => slot.start === start)) slots.push({ label, start });
      }
    }
    return slots;
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
