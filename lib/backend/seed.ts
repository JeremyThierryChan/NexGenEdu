import { getTeachersPageFromTemplate } from "@/lib/data/site";
import { coursesFromSite } from "./courses";
import { pricingConfigFromContent } from "./pricing";
import { siteContentFromContent } from "./site-content";
import { CURRENT_VERSION } from "./version";
import type {
  Assessment,
  Classroom,
  Database,
  Enrollment,
  HomeworkRecord,
  Lesson,
  LessonRecord,
  LessonTransaction,
  Payment,
  Student,
  Teacher,
} from "./types";

/**
 * **示例数据夹具**（不是系统的初始状态）。
 *
 * ⚠️ 系统的初始状态是**空库** —— 见 `lib/backend/initial.ts`。这里造的是示例数据，
 * 用途只剩两个：① 自检与演示要在一份"有内容"的库上跑；② `NEXGENEDU_ALLOW_SEED=1`
 * 时给人看界面。任何真实使用路径都不应该调它：早期 `load()` 在存储为空时灌的就是这份，
 * 于是员工第一次打开后台看到的是 8 位不是自己录的学生。
 *
 * 三条原则：
 *   1. **教师取自站点的真实教师列表**（`data/site/content.md` 的教师段），
 *      不另编人名；AI 智能体不参与排课，因此不进后台教师档案。
 *   2. **教室取自站点已有的场地名称**（301 教室 / 302 教室 / 自习区）。
 *   3. 学生与排课是**示例数据**，只用于把功能跑起来，名字里都带「示例·」前缀 ——
 *      万一它出现在真实库里，一眼就能认出来。
 */
export function createSeedDatabase(now: Date = new Date()): Database {
  const teachers: Teacher[] = getTeachersPageFromTemplate()
    .teachers.filter((teacher) => teacher.kind === "teacher")
    .map((teacher, index) => ({
      id: `t${index + 1}`,
      version: 1,
      name: teacher.name,
      subjects: teacher.subjects,
      role: teacher.role,
      phone: "",
      active: true,
      // 资料字段（v13）：夹具一样从网站教师页取，因此与"从网站导入"的结果一致
      years: teacher.years ?? "",
      summary: teacher.summary ?? "",
      bio: teacher.bio ?? "",
      // 推荐理由与顺序（v14）：同样取自网站教师页（顺序用它自己的「排序」值，不用下标）
      recommendation: teacher.recommendation ?? "",
      order: teacher.order,
      // 夹具里的教师本来就来自网站，因此默认展示（v16）
      siteVisible: true,
      origin: "网站" as const,
      kind: "教师" as const,
    }));

  // 可用时段刻意留了两种形态：工作日晚上 + 周末全天（上课教室），
  // 以及自习室的全周开放 —— 方便一眼看出「不限时段」与「有时段」的区别
  const classrooms: Classroom[] = [
    {
      id: "c1",
      version: 1,
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
      version: 1,
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
      version: 1,
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
      // 报课 10 节、单价 200、优惠 200 → 约定 1800，只付了 1200（欠费样本）
      enroll("e1", "初中数学", "一对一定制课", 10, 3, now, { unitPrice: 200, discount: 200, paidRatio: 2 / 3 }),
      enroll("e2", "初中物理", "一对二 / 一对三小组课", 6, 1, now, { unitPrice: 160 }),
    ]),
    student("s2", "示例·王同学", "初三", "138-0000-0002", "在读", "中考冲刺，重点压轴题。", now, [
      enroll("e3", "中考数学", "一对多小班课", 8, 4, now),
    ]),
    student("s3", "示例·陈同学", "小学五年级", "138-0000-0003", "在读", "计算习惯需要纠正。", now, [
      enroll("e4", "小学数学", "一对一定制课", 8, 2, now),
    ]),
    student("s4", "示例·张同学", "高一", "138-0000-0004", "在读", "课时快用完，需要提醒续课。", now, [
      // 分期付款：约定 1200，只付了 600
      enroll("e5", "高中数学", "一对一定制课", 4, 2, now, { unitPrice: 300, paidRatio: 0.5 }),
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
    // 缺课样本：给「待补课」清单用（提前请假 → 不扣课时，但课要补）
    record("l6", "s8", "请假", "中", "一般", 3, "提前请假，需安排补课。", now),
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

  /*
   * 课时流水：示例数据的 usedLessons 是「历史消耗」，因此为每一条生成对应的
   * 「上课」流水，课时余额与流水才自洽（自检里有一条不变式校验这一点）。
   * 历史消耗没有关联到具体课节，lessonId 留空并注明。
   */
  const transactions: LessonTransaction[] = students.flatMap((student) =>
    student.enrollments.flatMap((enrollment) => {
      const rows: LessonTransaction[] = [
        {
          id: `tx_open_${enrollment.id}`,
          studentId: student.id,
          enrollmentId: enrollment.id,
          subject: enrollment.subject,
          delta: enrollment.totalLessons,
          kind: "报课",
          lessonId: "",
          at: enrollment.startedAt,
          note: "示例数据",
          reversedAt: "",
        },
      ];

      for (let index = 0; index < enrollment.usedLessons; index += 1) {
        rows.push({
          id: `tx_use_${enrollment.id}_${index}`,
          studentId: student.id,
          enrollmentId: enrollment.id,
          subject: enrollment.subject,
          delta: -1,
          kind: "上课",
          lessonId: "",
          at: day(now, -1 - index, 19, 0),
          note: "历史课时（未关联具体课节）",
          reversedAt: "",
        });
      }

      return rows;
    }),
  );

  /*
   * 收款流水：与报课记录上的 paidAmount 严格对应（自检会校验两者一致）。
   * 一条记录可能对应一次或多次收款 —— 这里刻意给「分期付款」留了一个样本。
   */
  const payments: Payment[] = students.flatMap((student) =>
    student.enrollments.flatMap((enrollment) => {
      const rows: Payment[] = [];
      const first = Math.round(enrollment.paidAmount * 0.6);
      const second = enrollment.paidAmount - first;

      if (first > 0) {
        rows.push({
          id: `pay_${enrollment.id}_1`,
          studentId: student.id,
          enrollmentId: enrollment.id,
          amount: first,
          kind: "收款",
          method: "微信",
          at: enrollment.startedAt,
          note: "报课收款",
        });
      }
      if (second > 0) {
        rows.push({
          id: `pay_${enrollment.id}_2`,
          studentId: student.id,
          enrollmentId: enrollment.id,
          amount: second,
          kind: "收款",
          method: "支付宝",
          at: day(now, -5, 15, 0),
          note: "分期第二笔",
        });
      }
      return rows;
    }),
  );

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
    transactions,
    payments,
    // 操作日志从空开始：示例数据不需要伪造「谁改过什么」
    logs: [],
    // 咨询线索也从空开始：这是一次性录入的真实对话，示例数据编不出意义
    inquiries: [],
    /*
     * 课程库：直接用网站内容里的课程卡片初始化（课程名与网站一致），
     * 机构自己加的课（围棋、书法）由 /admin/courses 页面添加。
     */
    courses: coursesFromSite(),
    /*
     * 报价配置：用站点内容（data/site/pricing.md）初始化，而不是在种子里
     * 再抄一份价格。抄一份的后果是「宣传页一个价、后台算出来另一个价」，
     * 而家长会先看到宣传页的价。
     */
    pricing: pricingConfigFromContent(),
    /*
     * 网站课程正文（v15）：同样取自站点内容。示例库也必须是「有内容」的状态，
     * 否则演示时网站会判定「后端没有课程正文」而回落到模版，看起来像功能没生效。
     */
    siteContent: siteContentFromContent(),
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
    // 夹具是"刚刚建好"的记录，因此与新建同口径：第 1 版
    version: 1,
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
    // 请假时间默认给「提前 2 天」：示例数据展示的是「提前请假不扣课时」这条规则
    leaveRequestedAt: attendance === "请假" ? day(now, -3, 10, 0) : "",
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

/**
 * 造一条报课记录：total 已购课时，used 已消耗课时。
 *
 * 金额按「单价 × 课时」算，并给三种典型情况各留一个样本：
 * 全额付清、有优惠、分期只付了一部分（用来演示欠费与对账单）。
 */
function enroll(
  id: string,
  subject: string,
  form: string,
  total: number,
  used: number,
  now: Date,
  money: { unitPrice: number; discount?: number; paidRatio?: number } = { unitPrice: 200 },
): Enrollment {
  const list = total * money.unitPrice;
  const agreed = Math.max(0, list - (money.discount ?? 0));
  const paid = Math.round(agreed * (money.paidRatio ?? 1));

  return {
    id,
    subject,
    form,
    teacherId: "",
    totalLessons: total,
    usedLessons: used,
    unitPrice: money.unitPrice,
    agreedAmount: agreed,
    paidAmount: paid,
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
  return {
    id,
    version: 1,
    subject, form, teacherId, classroomId, studentIds, startsAt, durationMinutes, status,
    note: "",
    makeupForLessonId: "",
  };
}
