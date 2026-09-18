/**
 * 教务后台的领域模型。
 *
 * 这些类型是**伪后端服务的对外契约**：页面只认这里的类型，
 * 将来把实现从 localStorage 换成真实的服务端 API 时，类型不变、页面不改。
 */

/** 学生档案。 */
export type Student = {
  id: string;
  name: string;
  /** 年级，例如「初二」。 */
  grade: string;
  /** 家长联系方式（电话或微信）；监护人的姓名/微信等详见档案采集表。 */
  guardian: string;
  /**
   * 报读科目：由报课记录推导（见 lib/backend/enrollment.ts），
   * 不再单独维护一份，避免「改了报课、科目列表没变」。
   */
  subjects: string[];
  /**
   * 信息采集表（键 → 值），字段定义见 lib/backend/student-profile.ts。
   * 用键值对存储是为了加字段不用迁移数据：老档案读不到新字段就是空。
   */
  profile: StudentProfile;
  /** 报课记录：一门课一条，承载课时与退课状态。 */
  enrollments: Enrollment[];
  status: StudentStatus;
  /** 备注：薄弱点、家长诉求等。 */
  note: string;
  /** 建档时间（ISO）。 */
  createdAt: string;
};

/** 一条报课记录（含续费与退课）。 */
export type Enrollment = {
  id: string;
  /** 科目，例如「初中数学」；与课程名用同一套叫法。 */
  subject: string;
  /** 班型，例如「一对一定制课」。 */
  form: string;
  /** 指定教师；空串表示未指定。 */
  teacherId: string;
  /** 已购课时总数（含续费累加）。 */
  totalLessons: number;
  /** 已消耗课时（上课时扣减）。 */
  usedLessons: number;
  /** 报课日期（ISO）。 */
  startedAt: string;
  /** 退课 / 结课日期；空串表示仍在生效。 */
  endedAt: string;
  status: EnrollmentStatus;
  note: string;
  /** 报课 / 续费 / 退课流水，便于家长对账。 */
  history: EnrollmentHistoryItem[];
};

export type EnrollmentHistoryItem = {
  at: string;
  kind: "报课" | "续费" | "退课";
  lessons: number;
  note: string;
};

/**
 * 课时流水（账本）。
 *
 * 为什么需要一个账本，而不是只在报课记录上留个 usedLessons 数字：
 * 家长问「我孩子上了 20 节，为什么扣了 22 节」时，光看数字答不出来；
 * 老师点错了「标记已上」也必须能把课时退回去。因此每一次课时变动都留一条，
 * 并且**撤销也是留痕**（reversedAt 非空）而不是删除。
 *
 * 不变式（自检会校验）：某条报课的 usedLessons 必须等于它的「上课」条目合计，
 * totalLessons 必须等于「报课 + 续费」条目合计。
 */
export type LessonTransaction = {
  id: string;
  studentId: string;
  enrollmentId: string;
  /** 科目，冗余存一份：报名记录改名后流水仍读得懂。 */
  subject: string;
  /** 课时变动：上课为 -1，报课/续费为 +N，手工调整为 ±N。 */
  delta: number;
  kind: TransactionKind;
  /** 关联课节；历史数据或手工调整时为空串。 */
  lessonId: string;
  at: string;
  note: string;
  /** 撤销时间；空串表示有效。撤销的条目保留，便于追溯。 */
  reversedAt: string;
};

export const TRANSACTION_KINDS = ["报课", "续费", "上课", "调整", "退课"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const ENROLLMENT_STATUSES = ["在读", "已退课"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** 报课入参。 */
export type NewEnrollment = {
  subject: string;
  form: string;
  teacherId: string;
  lessons: number;
  startedAt: string;
  note: string;
};

export const STUDENT_STATUSES = ["在读", "暂停", "结课"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** 教师档案。 */
export type Teacher = {
  id: string;
  name: string;
  /** 可带科目，与课程页的科目叫法保持一致。 */
  subjects: string[];
  /** 职务，例如「全科教师」「晚辅导老师」。 */
  role: string;
  phone: string;
  /** 是否在职；离职教师保留档案但不在排课里出现。 */
  active: boolean;
};

/** 教室用途。自习室也能被排课（学生来自习），因此两者都在同一个列表里，只是用途不同。 */
export const CLASSROOM_KINDS = ["上课用教室", "自习室"] as const;
export type ClassroomKind = (typeof CLASSROOM_KINDS)[number];

/**
 * 教室可用时段的一行：一周中的几天 + 一个时间区间。
 *
 * 为什么是「几天 + 一段」而不是每天一行：实际使用中「周一至周五 17:00–21:00」
 * 是常态，每天一行要录入五次且容易前后不一致。
 */
export type ClassroomAvailability = {
  /** 行自身的 id（表单增删行用，与教室 id 无关）。 */
  id: string;
  /** 适用星期：1=周一 … 7=周日。 */
  weekdays: number[];
  /** 开始时间「HH:MM」。 */
  start: string;
  /** 结束时间「HH:MM」，必须晚于开始时间。 */
  end: string;
};

/** 教室 / 场地。 */
export type Classroom = {
  id: string;
  /** 名称，例如「301 教室」。 */
  name: string;
  /** 用途：上课用教室 / 自习室。 */
  kind: ClassroomKind;
  /** 可容纳人数（自习室即座位数）。 */
  capacity: number;
  /** 可用时段；**留空表示不限**（营业时间内都可用）。 */
  availability: ClassroomAvailability[];
  note: string;
};

/** 课程状态。 */
export const LESSON_STATUSES = ["已排", "已上", "已取消"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/** 一节排好的课。 */
export type Lesson = {
  id: string;
  /** 科目，例如「初中数学」。 */
  subject: string;
  /** 班型，例如「一对一定制课」。 */
  form: string;
  teacherId: string;
  classroomId: string;
  /** 上课的学生；小组课 / 小班课会有多人。 */
  studentIds: string[];
  /** 开始时间（ISO）。 */
  startsAt: string;
  durationMinutes: number;
  status: LessonStatus;
  note: string;
};

/** 课堂记录：一节课的每个学生一条（由上课老师在课后填写）。 */
export type LessonRecord = {
  id: string;
  /** 关联的课节。 */
  lessonId: string;
  studentId: string;
  attendance: Attendance;
  focus: FocusLevel;
  interaction: InteractionLevel;
  /** 状态评分 1–5。 */
  rating: number;
  note: string;
  /** 填写时间（ISO）。 */
  recordedAt: string;
};

export const ATTENDANCE_OPTIONS = ["到课", "请假", "旷课"] as const;
export type Attendance = (typeof ATTENDANCE_OPTIONS)[number];

export const FOCUS_OPTIONS = ["高", "中", "低"] as const;
export type FocusLevel = (typeof FOCUS_OPTIONS)[number];

export const INTERACTION_OPTIONS = ["主动", "一般", "被动"] as const;
export type InteractionLevel = (typeof INTERACTION_OPTIONS)[number];

/** 作业记录（按次记录，因此挂学生而不是挂在课上）。 */
export type HomeworkRecord = {
  id: string;
  studentId: string;
  /** 作业日期（ISO）。 */
  date: string;
  subject: string;
  submission: Submission;
  /** 正确率 0–100；负数表示未统计。 */
  accuracy: number;
  /** 本次错题知识点。 */
  weakPoints: string;
  note: string;
};

export const SUBMISSION_OPTIONS = ["按时", "迟交", "未交"] as const;
export type Submission = (typeof SUBMISSION_OPTIONS)[number];

/** 阶段测评（按次记录，用于看趋势）。 */
export type Assessment = {
  id: string;
  studentId: string;
  subject: string;
  date: string;
  score: number;
  /**
   * 同科目的上一次分数，由服务在新增时自动带出（用于算趋势）。
   * null 表示这是该科目的第一次测评。
   */
  previousScore: number | null;
  /** 薄弱知识点。 */
  weakPoints: string;
  note: string;
};

/** 后台全部数据。 */
export type Database = {
  /** 数据结构版本，将来加字段时用于迁移。 */
  version: number;
  students: Student[];
  teachers: Teacher[];
  classrooms: Classroom[];
  lessons: Lesson[];
  /** 动态追踪：课堂记录 / 作业记录 / 阶段测评。 */
  lessonRecords: LessonRecord[];
  homeworkRecords: HomeworkRecord[];
  assessments: Assessment[];
  /** 课时流水（账本）。 */
  transactions: LessonTransaction[];
  /** 最后一次写入时间（ISO）。 */
  updatedAt: string;
};

/** 课堂记录入参：id 与填写时间由服务生成。 */
export type NewLessonRecord = Omit<LessonRecord, "id" | "recordedAt">;
/** 作业记录入参。 */
export type NewHomeworkRecord = Omit<HomeworkRecord, "id">;
/** 阶段测评入参：上一次分数由服务自动带出。 */
export type NewAssessment = Omit<Assessment, "id" | "previousScore">;

/** 新建时的入参：id、报课集合与时间戳由服务生成。 */
export type NewStudent = Omit<Student, "id" | "createdAt" | "enrollments" | "subjects"> & {
  subjects?: string[];
};
export type NewTeacher = Omit<Teacher, "id">;
export type NewClassroom = Omit<Classroom, "id">;
export type NewLesson = Omit<Lesson, "id">;

import type { StudentProfile } from "./student-profile";

/** 今日概览的汇总数据。 */
export type TodaySummary = {
  date: string;
  lessonCount: number;
  /** 今天有课的教师数。 */
  teacherCount: number;
  /** 今天的课时总时长（分钟）。 */
  totalMinutes: number;
  /** 教室占用：教室 + 今天的课次。 */
  classroomUsage: Array<{ classroom: Classroom; lessonCount: number }>;
  /** 课时不足的学生（剩余课时 ≤ 阈值）。 */
  lowLessonStudents: Array<{ student: Student; remainingLessons: number }>;
  studentCount: number;
  activeTeacherCount: number;
};

/** 排课入参（新建与编辑共用；编辑时带 id）。 */
export type LessonInput = {
  id?: string;
  subject: string;
  form: string;
  teacherId: string;
  classroomId: string;
  studentIds: string[];
  startsAt: string;
  durationMinutes: number;
  status: LessonStatus;
  note: string;
};

/**
 * 冲突检查结果。
 *
 * 分三类是因为处理方式不同：教师与教室冲突必须调整时间或换人/换教室，
 * 学生冲突往往是「同一个学生被排了两节课」，需要家长/学生层面确认。
 * 相邻时间（前一场结束＝后一场开始）**不算冲突**。
 */
export type ConflictReport = {
  teacher: Lesson[];
  classroom: Lesson[];
  students: Array<{ studentId: string; lesson: Lesson }>;
  /**
   * 时段落在教室可用时段之外（教室在该时段不开放）。
   * 与「撞课」不同：这不是两节课冲突，而是这间教室此时根本不用。
   * 教室没有设置可用时段时永远为 false。
   */
  classroomClosed: boolean;
  /**
   * 学生数超过教室容量。null 表示没超（或教室没有登记容量）。
   * 这类问题不会「撞课」，但会把学生塞进坐不下的房间。
   */
  overCapacity: { capacity: number; students: number } | null;
  /**
   * 教师不匹配这节课的科目（该教师的「可带科目」里没有这个科目）。
   * 教师没有登记科目时永远为 false —— 没登记不等于不能带。
   */
  teacherSubjectMismatch: boolean;
  /** 三类冲突的合计条数，页面用它判断能不能保存。 */
  total: number;
};

/** 「标记已上」的结果：课时扣减明细。 */
export type CompletionResult = {
  lesson: Lesson | null;
  /** 本次实际扣减的学生及其扣后剩余课时。 */
  deducted: Array<{ studentId: string; subject: string; remainingLessons: number }>;
  /**
   * 没能扣课时的学生（例如没有该科目的在读报课记录）。
   * 如实上报而不是随便找一条记录扣 —— 排课与课时对不上时，这里就是线索。
   */
  skipped: Array<{ studentId: string; reason: string }>;
  /** 这节课之前是否已经是「已上」状态。 */
  alreadyCompleted: boolean;
};
