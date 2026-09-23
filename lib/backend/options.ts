import { getScheduleContent } from "@/lib/data/pages";
import { getCourseColumnsFromTemplate, getSiteBrand } from "@/lib/data/site";
import { catalogFromSeed } from "./catalog-seed";
import { parseGapWindow, type GapWindow } from "./timetable";

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
    return getCourseColumnsFromTemplate().flatMap((column) =>
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

/**
 * 上课时间窗口（课表里「课前 / 课后」两段空档按它算）。
 *
 * 取自站点内容的「上课时间」字段（形如「每日 8:00–22:00（含节假日）」），
 * **刻意不写死 8:00–22:00**：机构改上课时间，课表的空档要跟着变。
 * 解析不出来时返回 null，调用方就只算课与课之间的空档 —— 宁可少显示，也不猜错。
 */
export function getClassHoursWindow(): GapWindow | null {
  try {
    return parseGapWindow(getSiteBrand().contact.classHours);
  } catch {
    return null;
  }
}

/**
 * 班型候选（**只读种子**，作为下拉的同步第一帧）。
 *
 * 真正的候选来自**库里的课程类型维度表**（`useFormOptions` 挂载后会用后端那一份替换掉它）：
 * v23 起「班型」在全系统只有一个口径 —— `catalog.formats`（一对一 / 一对二 / 一对三 /
 * 小班课（4-8人）/ 大班课（9-20人）），机构在后台「课程类型」页加一个班型，
 * 所有下拉里立刻都有它。这里取的是**同一份种子的同步副本**，留着它只有一个理由：
 * 表单第一帧不为空（构建期读不到库）。
 *
 * 以前这里取的是特色课程树的二级课程名（一对一 / 一对二…）——
 * 那是同一个概念的第二套写法，机构确认"以系统现行的那一套为准"之后已经废弃。
 */
export function getFormOptionsFromTemplate(): string[] {
  try {
    return catalogFromSeed().formats.map((format) => format.name);
  } catch {
    return [];
  }
}
