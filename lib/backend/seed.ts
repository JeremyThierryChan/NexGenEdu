import { getTeachersPage } from "@/lib/data/site";
import type { Classroom, Database, Lesson, Student, Teacher } from "./types";

/**
 * 伪后端的初始数据（示例数据）。
 *
 * 三条原则：
 *   1. **教师取自站点的真实教师列表**（`data/site/content.md` 的教师段），
 *      不另编人名；AI 智能体不参与排课，因此不进后台教师档案。
 *   2. **教室取自站点已有的场地名称**（301 教室 / 302 教室 / 自习区）。
 *   3. 学生与排课是**示例数据**，只用于把功能跑起来：界面上会明确标注
 *      「示例数据」，可一键重置。接入真实学员前不要当成正式数据。
 *
 * 首次打开后台时灌入，之后以浏览器里的存储为准（改过的数据不会被覆盖）。
 */
export function createSeedDatabase(now: Date = new Date()): Database {
  const teachers: Teacher[] = getTeachersPage()
    .teachers.filter((teacher) => teacher.kind === "teacher")
    .map((teacher, index) => ({
      id: `t${index + 1}`,
      name: teacher.name,
      subjects: teacher.subjects,
      role: teacher.role,
      phone: "",
      active: true,
    }));

  // 可用时段刻意留了两种形态：工作日晚上 + 周末全天（上课教室），
  // 以及自习室的全周开放 —— 方便一眼看出「不限时段」与「有时段」的区别
  const classrooms: Classroom[] = [
    {
      id: "c1",
      name: "301 教室",
      kind: "上课用教室",
      capacity: 8,
      availability: [
        { id: "c1-a1", weekdays: [1, 2, 3, 4, 5], start: "17:00", end: "21:30" },
        { id: "c1-a2", weekdays: [6, 7], start: "08:00", end: "21:30" },
      ],
      note: "白板 + 投影，小组课与一对一",
    },
    {
      id: "c2",
      name: "302 教室",
      kind: "上课用教室",
      capacity: 20,
      availability: [
        { id: "c2-a1", weekdays: [1, 2, 3, 4, 5, 6, 7], start: "08:00", end: "21:30" },
      ],
      note: "大班课 / 晚托",
    },
    {
      id: "c3",
      name: "自习区",
      kind: "自习室",
      capacity: 6,
      availability: [],
      note: "独立自习位，不限时段",
    },
  ];

  const students: Student[] = [
    student("s1", "示例·李同学", "初二", "138-0000-0001", ["初中数学", "初中物理"], 12, "在读", "几何证明薄弱，需固定节奏。", now),
    student("s2", "示例·王同学", "初三", "138-0000-0002", ["中考数学"], 4, "在读", "中考冲刺，重点压轴题。", now),
    student("s3", "示例·陈同学", "小学五年级", "138-0000-0003", ["小学数学", "小学英语"], 6, "在读", "计算习惯需要纠正。", now),
    student("s4", "示例·张同学", "高一", "138-0000-0004", ["高中数学", "高中物理"], 2, "在读", "课时快用完，需要提醒续课。", now),
    student("s5", "示例·刘同学", "初一", "138-0000-0005", ["初中英语"], 18, "在读", "语法体系刚建立。", now),
    student("s6", "示例·赵同学", "小学六年级", "138-0000-0006", ["小学数学"], 9, "在读", "小升初衔接。", now),
    student("s7", "示例·孙同学", "高二", "138-0000-0007", ["高中数学"], 0, "暂停", "暂停中，等月考后再排。", now),
    student("s8", "示例·周同学", "初三", "138-0000-0008", ["中考英语"], 3, "在读", "写作是主要失分点。", now),
  ];

  const lessons: Lesson[] = [
    lesson("l1", "初中数学", "一对一定制课", "t1", "c1", ["s1"], day(now, 0, 17, 30), 60),
    lesson("l2", "初中英语", "一对二 / 一对三小组课", "t1", "c1", ["s5"], day(now, 0, 19, 0), 90),
    lesson("l3", "中考数学", "一对多小班课", "t1", "c2", ["s2"], day(now, 0, 19, 30), 90),
    lesson("l4", "小学数学", "一对一定制课", "t1", "c1", ["s3", "s6"], day(now, 1, 17, 30), 60),
    lesson("l5", "高中数学", "一对一定制课", "t1", "c1", ["s4"], day(now, 1, 19, 0), 90),
    lesson("l6", "中考英语", "一对多小班课", "t1", "c2", ["s8"], day(now, 2, 18, 0), 90),
    lesson("l7", "初中物理", "一对一定制课", "t1", "c3", ["s1"], day(now, -1, 17, 30), 60, "已上"),
  ];

  return {
    version: 1,
    students,
    teachers,
    classrooms,
    lessons,
    updatedAt: now.toISOString(),
  };
}

/** 构造一天中的某个时刻：dayOffset 为相对今天的天数偏移。 */
function day(base: Date, dayOffset: number, hour: number, minute: number): string {
  const date = new Date(base);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function student(
  id: string,
  name: string,
  grade: string,
  guardian: string,
  subjects: string[],
  remainingLessons: number,
  status: Student["status"],
  note: string,
  now: Date,
): Student {
  return { id, name, grade, guardian, subjects, remainingLessons, status, note, createdAt: now.toISOString() };
}

function lesson(
  id: string,
  subject: string,
  form: string,
  teacherId: string,
  classroomId: string,
  studentIds: string[],
  startsAt: string,
  durationMinutes: number,
  status: Lesson["status"] = "已排",
): Lesson {
  return { id, subject, form, teacherId, classroomId, studentIds, startsAt, durationMinutes, status, note: "" };
}
