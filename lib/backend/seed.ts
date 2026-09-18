import { getTeachersPage } from "@/lib/data/site";
import { CURRENT_VERSION } from "./version";
import type {
  Assessment,
  Classroom,
  Database,
  Enrollment,
  HomeworkRecord,
  Lesson,
  LessonRecord,
  Student,
  Teacher,
} from "./types";

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

  // 学生的科目与课时都由「报课记录」决定（不再有单独的科目/课时字段），
  // 因此这里给每人 1–2 条报课；其中两位刻意留成低课时，用来看课时预警
  const students: Student[] = [
    student("s1", "示例·李同学", "初二", "138-0000-0001", "在读", "几何证明薄弱，需固定节奏。", now, [
      enroll("e1", "初中数学", "一对一定制课", 10, 3, now),
      enroll("e2", "初中物理", "一对二 / 一对三小组课", 6, 1, now),
    ]),
    student("s2", "示例·王同学", "初三", "138-0000-0002", "在读", "中考冲刺，重点压轴题。", now, [
      enroll("e3", "中考数学", "一对多小班课", 8, 4, now),
    ]),
    student("s3", "示例·陈同学", "小学五年级", "138-0000-0003", "在读", "计算习惯需要纠正。", now, [
      enroll("e4", "小学数学", "一对一定制课", 8, 2, now),
    ]),
    student("s4", "示例·张同学", "高一", "138-0000-0004", "在读", "课时快用完，需要提醒续课。", now, [
      enroll("e5", "高中数学", "一对一定制课", 4, 2, now),
    ]),
    student("s5", "示例·刘同学", "初一", "138-0000-0005", "在读", "语法体系刚建立。", now, [
      enroll("e6", "初中英语", "一对二 / 一对三小组课", 20, 2, now),
    ]),
    student("s6", "示例·赵同学", "小学六年级", "138-0000-0006", "在读", "小升初衔接。", now, [
      enroll("e7", "小学数学", "一对多小班课", 12, 3, now),
    ]),
    student("s7", "示例·孙同学", "高二", "138-0000-0007", "暂停", "暂停中，等月考后再排。", now, [
      enroll("e8", "高中数学", "一对一定制课", 6, 6, now),
    ]),
    student("s8", "示例·周同学", "初三", "138-0000-0008", "在读", "写作是主要失分点。", now, [
      enroll("e9", "中考英语", "一对多小班课", 6, 3, now),
    ]),
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

  /*
   * 动态追踪的示例数据：给「昨天那节课」填课堂记录，给两位学生各配几条
   * 作业记录与阶段测评 —— 这样打开页面就能看到趋势与统计的样子，
   * 而不是一片空白。
   */
  const lessonRecords: LessonRecord[] = [
    record("l7", "s1", "到课", "中", "一般", 3, "定理记不牢，讲第二遍才通。", now),
    record("l7", "s2", "到课", "高", "主动", 4, "压轴题思路清楚，计算偶有跳步。", now),
  ];

  const homeworkRecords: HomeworkRecord[] = [
    homework("s1", "初中数学", -3, "按时", 85, "二次函数最值", now),
    homework("s1", "初中数学", -1, "迟交", 70, "几何辅助线", now),
    homework("s1", "初中物理", -2, "按时", 92, "密度与浮力", now),
    homework("s2", "中考数学", -2, "按时", 78, "圆与相似综合", now),
  ];

  const assessments: Assessment[] = [
    assessment("s1", "初中数学", -30, 72, null, "函数与几何综合", now),
    assessment("s1", "初中数学", -2, 81, 72, "几何辅助线", now),
    assessment("s1", "初中物理", -2, 88, null, "电学计算", now),
    assessment("s2", "中考数学", -2, 91, 84, "压轴题步骤规范", now),
  ];

  return {
    // 必须是当前版本：写成旧版本会让新灌入的数据在下次读取时被迁移逻辑改写
    version: CURRENT_VERSION,
    students,
    teachers,
    classrooms,
    lessons,
    lessonRecords,
    homeworkRecords,
    assessments,
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
  status: Student["status"],
  note: string,
  now: Date,
  enrollments: Enrollment[],
): Student {
  return {
    id,
    name,
    grade,
    guardian,
    // 报读科目由报课推导，与 syncSubjects() 的口径一致
    subjects: enrollments.filter((item) => item.status === "在读").map((item) => item.subject),
    profile: {},
    enrollments,
    status,
    note,
    createdAt: now.toISOString(),
  };
}

/** 造一条课堂记录。 */
function record(
  lessonId: string,
  studentId: string,
  attendance: LessonRecord["attendance"],
  focus: LessonRecord["focus"],
  interaction: LessonRecord["interaction"],
  rating: number,
  note: string,
  now: Date,
): LessonRecord {
  return {
    id: `lr_${lessonId}_${studentId}`,
    lessonId,
    studentId,
    attendance,
    focus,
    interaction,
    rating,
    note,
    recordedAt: day(now, -1, 19, 0),
  };
}

/** 造一条作业记录；dayOffset 为相对今天的天数。 */
function homework(
  studentId: string,
  subject: string,
  dayOffset: number,
  submission: HomeworkRecord["submission"],
  accuracy: number,
  weakPoints: string,
  now: Date,
): HomeworkRecord {
  return {
    id: `hw_${studentId}_${subject}_${dayOffset}`,
    studentId,
    date: day(now, dayOffset, 20, 0),
    subject,
    submission,
    accuracy,
    weakPoints,
    note: "",
  };
}

/** 造一条阶段测评。 */
function assessment(
  studentId: string,
  subject: string,
  dayOffset: number,
  score: number,
  previousScore: number | null,
  weakPoints: string,
  now: Date,
): Assessment {
  return {
    id: `as_${studentId}_${subject}_${dayOffset}`,
    studentId,
    subject,
    date: day(now, dayOffset, 18, 0),
    score,
    previousScore,
    weakPoints,
    note: "",
  };
}

/** 造一条报课记录：total 已购课时，used 已消耗课时。 */
function enroll(
  id: string,
  subject: string,
  form: string,
  total: number,
  used: number,
  now: Date,
): Enrollment {
  return {
    id,
    subject,
    form,
    teacherId: "",
    totalLessons: total,
    usedLessons: used,
    startedAt: now.toISOString(),
    endedAt: "",
    status: "在读",
    note: "",
    history: [{ at: now.toISOString(), kind: "报课", lessons: total, note: "示例数据" }],
  };
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
