/**
 * 教务后台的领域模型。
 *
 * 这些类型是**伪后端服务的对外契约**：页面只认这里的类型，
 * 将来把实现从 localStorage 换成真实的服务端 API 时，类型不变、页面不改。
 */

import type { PricingConfig } from "./pricing";

/** 课程来源：网站内容里的卡片，还是后台自己加的。 */
export const COURSE_ORIGINS = ["网站", "后台"] as const;
export type CourseOrigin = (typeof COURSE_ORIGINS)[number];

/** 课程状态：开放（可以排课）/ 暂未开放（先建着，不排课）。 */
export const COURSE_STATUSES = ["开放", "暂未开放"] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/**
 * 课程库里的一门课。
 *
 * 它是后台的**课程台账**：排课的科目、教师可带科目、报课记录里的科目都按名字引用它。
 * 网站上的课程卡片会自动进来（`origin: "网站"`），机构自己加的课是 `origin: "后台"`。
 *
 * 边界：在后台加课程**不会**让宣传网站上多出一张卡片 —— 网站是静态内容，
 * 要上线得改 `data/site/content.md`（见内容维护手册）。后台的课程库解决的是
 * 「这门课要能排课、能记课时」，不是「这门课要在网站上展示」。
 */
export type Course = {
  /** id：网站课程用 `course-site-<卡片路径>`（稳定，重复同步不会重复添加）。 */
  id: string;
  /** 课程名（唯一）：排课科目、教师可带科目、报课科目都用这个名字。 */
  name: string;
  /** 分类：网站栏目名，或后台自定义（如「兴趣才艺」）。 */
  category: string;
  /** 可开班型（取自特色课程的班型名）；空数组表示还没填。 */
  forms: string[];
  origin: CourseOrigin;
  status: CourseStatus;
  note: string;
  /** 建档时间（ISO）；网站同步进来的课程为空串。 */
  createdAt: string;
};

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
  /**
   * 标价单价（元 / 节）。用于展示「优惠了多少」以及某些退费策略。
   * 为 0 表示这门课没有登记价格（例如赠送课）。
   */
  unitPrice: number;
  /** 与家长约定应缴的总额（可低于标价 = 优惠，也可高于实收 = 分期未付）。 */
  agreedAmount: number;
  /** 实收累计（由收款记录累加，不手工维护）。 */
  paidAmount: number;
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
  /** 标价单价（元 / 节）。 */
  unitPrice: number;
  /** 约定应缴总额。 */
  agreedAmount: number;
  /** 本次实收；0 表示先上课后付款。 */
  paidNow: number;
  method: PaymentMethod;
};

/** 收款方式。 */
export const PAYMENT_METHODS = ["微信", "支付宝", "现金", "银行转账", "其他"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_KINDS = ["收款", "退款"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/**
 * 收款记录（钱的账本，与课时流水分开）。
 *
 * 课时与钱是两本账：一次报课可能分期付款（课时一次给、钱分几次收），
 * 也可能有纯补款（不带课时）。因此收款记录独立成表，
 * 报课记录的 paidAmount 由它累加得出（自检会校验两者一致）。
 */
export type Payment = {
  id: string;
  studentId: string;
  /** 关联的报课记录；纯补款 / 无对应报课时为空串。 */
  enrollmentId: string;
  /** 收款为正、退款为正数但 kind 为「退款」。 */
  amount: number;
  kind: PaymentKind;
  method: PaymentMethod;
  at: string;
  note: string;
};

export type NewPayment = Omit<Payment, "id">;

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
  /** 补课：指向被补的那节课；空串表示这是一节普通课。 */
  makeupForLessonId: string;
};

/** 课堂记录：一节课的每个学生一条（由上课老师在课后填写）。 */
export type LessonRecord = {
  id: string;
  /** 关联的课节。 */
  lessonId: string;
  studentId: string;
  attendance: Attendance;
  /**
   * 请假时间（ISO）；空串表示没记录。
   * 用来判断是否「提前 24 小时请假」—— 这直接决定扣不扣课时，
   * 因此必须留时间戳而不是只记一个「请假」。
   */
  leaveRequestedAt: string;
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

/**
 * 操作日志。
 *
 * 纯前端阶段只记「谁、何时、对什么做了什么」，并**限制条数**（旧的自动丢弃）：
 * 日志本身也会占存储，无上限地涨下去迟早把 localStorage 撑满。
 * 接真后端后这一层应改为服务端审计（不可被前端篡改），现在至少能回答
 * 「这条数据是谁什么时候改的」。
 */
export type OperationLog = {
  id: string;
  at: string;
  /** 操作人（当前只有 admin）。 */
  operator: string;
  /** 对象类别：学生 / 教师 / 教室 / 排课 / 报课 / 收费 / 数据 … */
  entity: string;
  /** 动作：新建 / 修改 / 删除 / 标记已上 / 导入 … */
  action: string;
  /** 对象 id（删除后仍保留，便于追溯）。 */
  targetId: string;
  /** 可读的一句话，直接显示在日志里。 */
  summary: string;
};

/** 全局搜索的一条结果。 */
export type SearchHit = {
  kind: "学生" | "教师" | "教室" | "课程" | "排课";
  id: string;
  title: string;
  /** 副标题：用来区分同名对象（年级、科目、时间…）。 */
  subtitle: string;
  /** 点进去的地址。 */
  href: string;
};

/**
 * 咨询线索：家长口头咨询后登记，用来判断「这个安排能不能接」。
 *
 * 为什么值得单独存一条：家长问的多半是「每周六上午能排吗？指定陈老师行不行？」——
 * 这类对话当场就要给答复，事后再翻聊天记录找不着。存下来还能变成线索清单
 * （谁还没落定、谁已经安排了）。
 */
export type Inquiry = {
  id: string;
  /** 咨询时登记的学生信息（此时还没有学生档案）。 */
  studentName: string;
  grade: string;
  guardian: string;
  /** 想上的科目（用课程名，如「初中数学」）。 */
  subject: string;
  /** 单次时长（分钟）。 */
  durationMinutes: number;
  /** 间隔：每 1 周一次 / 每 2 周一次。 */
  intervalWeeks: number;
  /** 计划总节数（用来算要占未来多少个时段）。 */
  plannedLessons: number;
  /** 从哪一天开始（ISO）。 */
  startsAt: string;
  /**
   * 候选时段：家长给的备选，按优先级排列。
   * 判定时依次尝试，第一个能排下的就用它。
   */
  candidates: InquirySlot[];
  /** 指定教师；空串表示不限（系统按当周课时量推荐）。 */
  preferredTeacherId: string;
  /** 指定场地；空串表示不限。 */
  preferredClassroomId: string;
  /** 要跳过的日期（`YYYY-MM-DD`）：假期、考试周等。 */
  skipDates: string[];
  status: InquiryStatus;
  note: string;
  createdAt: string;
  /** 已安排时记录生成的课节，便于回溯与撤销。 */
  scheduledLessonIds: string[];
};

export const INQUIRY_STATUSES = ["待确认", "已安排", "已放弃"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** 一个候选时段：任意时间（不限于学校标准时段）。 */
export type InquirySlot = {
  id: string;
  /** 1=周一 … 7=周日。 */
  weekday: number;
  /** 开始时间「HH:MM」。 */
  start: string;
};

export type NewInquiry = Omit<Inquiry, "id" | "createdAt" | "scheduledLessonIds">;

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
  /** 收款 / 退款流水（钱的账本）。 */
  payments: Payment[];
  /** 操作日志（谁在什么时候改了什么）。 */
  logs: OperationLog[];
  /** 咨询线索。 */
  inquiries: Inquiry[];
  /** 课程库：后台的课程台账（网站课程 + 后台新增）。 */
  courses: Course[];
  /**
   * 报价配置（基础价、科目系数、班级系数、计费规则）。
   *
   * 它是**算钱的依据**，因此与业务数据一样存在库里、可迁移、可备份，
   * 而不是散在代码里。首次由站点内容（data/site/pricing.md）初始化。
   */
  pricing: PricingConfig;
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
  /** 补课：指向被补的那节课；空串表示这是一节普通课。 */
  makeupForLessonId: string;
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
