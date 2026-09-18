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

/** 教室 / 场地。 */
export type Classroom = {
  id: string;
  /** 名称，例如「301 教室」。 */
  name: string;
  /** 可容纳人数。 */
  capacity: number;
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
