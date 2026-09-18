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
  /** 家长联系方式（电话或微信）。 */
  guardian: string;
  /** 报读科目。 */
  subjects: string[];
  /** 剩余课时；排课与上课会消耗它。 */
  remainingLessons: number;
  status: StudentStatus;
  /** 备注：薄弱点、家长诉求等。 */
  note: string;
  /** 建档时间（ISO）。 */
  createdAt: string;
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

/** 后台全部数据。 */
export type Database = {
  /** 数据结构版本，将来加字段时用于迁移。 */
  version: number;
  students: Student[];
  teachers: Teacher[];
  classrooms: Classroom[];
  lessons: Lesson[];
  /** 最后一次写入时间（ISO）。 */
  updatedAt: string;
};

/** 新建时的入参：id 与时间戳由服务生成。 */
export type NewStudent = Omit<Student, "id" | "createdAt">;
export type NewTeacher = Omit<Teacher, "id">;
export type NewClassroom = Omit<Classroom, "id">;
export type NewLesson = Omit<Lesson, "id">;

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
  /** 三类冲突的合计条数，页面用它判断能不能保存。 */
  total: number;
};

/** 「标记已上」的结果：课时扣减明细。 */
export type CompletionResult = {
  lesson: Lesson | null;
  /** 本次实际扣减的学生（已上过的课重复标记时为空）。 */
  deducted: Array<{ studentId: string; remainingLessons: number }>;
  /** 这节课之前是否已经是「已上」状态。 */
  alreadyCompleted: boolean;
};
