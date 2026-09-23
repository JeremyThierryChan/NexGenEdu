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
  /**
   * 记录级版本号（v17 起）：初始 1，**每写一次 +1**，用于同一条记录的乐观锁。
   *
   * 概念、为什么是乐观锁而不是悲观锁、以及"不传 expectedVersion 也 +1"的取舍，
   * 全部写在 `lib/backend/concurrency.ts` 的文件头与 `bumpVersion` 的注释里 ——
   * 这一层只声明字段，不重复一遍理由（口径只留一份）。
   */
  version: number;
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
  /*
   * ── 以下字段是「网站课程页」需要的（v15 起）────────────────────────────
   *
   * 加它们的原因：网站要改成"能连上后端就以后端为准"，而课程卡片原先只存在于
   * 内容文件（`data/site/content.md` 的课程栏目）里 —— 后台看不到、改不了，
   * 也就没法"以库为准"。现在一张卡片就是课程库里的一行。
   */
  /** 卡片页面的路径分段（ASCII，例如 `junior-math`）。空串＝网站上不展示这张卡片。 */
  path: string;
  /** 栏目下的子栏目（高中课内分 必考科目 / 外语 / 七选三）；空串＝无子栏目。 */
  subgroup: string;
  /** 卡片上的细分标签（学考 / 选考 / A1…），点它跳到对应小节；空数组＝这门课没有细分。 */
  tags: CourseTag[];
  /** 卡片本身点进哪个小节（空串＝用课程名）。有标签时通常是第一个标签的目标。 */
  target: string;
  /** 在栏目里的显示顺序（越小越靠前）。 */
  order: number;
  /** 一句话介绍（选修课卡片用；学科卡片留空时网站用正文首段代替）。 */
  intro: string;
  /**
   * 这门课在**网站课程页**上以什么形态出现。
   *
   * 刻意做成显式字段而不是"有没有小节"这种推断：推断规则只在数据里成立，
   * 一旦有人在后台把某门课的小节删空，卡片就会从一个栏目跳到另一个栏目，
   * 而且没人知道为什么。
   */
  siteKind: CourseSiteKind;
};

/** 网站卡片上的细分标签（`学考→高中物理学考`）。 */
export type CourseTag = {
  /** 显示用文字（例如「学考」「A1」）。 */
  label: string;
  /** 跳到哪个小节（锚点名，例如「高中物理学考」）。 */
  target: string;
};

/**
 * 课程在网站课程页上的形态：
 *   - `学科`：有自己的学段小节（语文 → 小学语文 / 初中语文 / 高中语文），卡片点进小节
 *   - `选修`：单门课，只有一段介绍（成人英语口语、职场与商务英语）
 *   - `不展示`：只用于排课/记课时，网站上没有它（机构自建的课默认这个）
 */
export const COURSE_SITE_KINDS = ["学科", "选修", "不展示"] as const;
export type CourseSiteKind = (typeof COURSE_SITE_KINDS)[number];

/**
 * 网站内容的整体。
 *
 * 为什么单独成一块而不是塞进 `courses`：这里的「学科」与「卡片」是**两个粒度**。
 * 语文是一个学科（正文容器），小学语文 / 初中语文 / 高中语文是三张卡片；
 * 雅思学科与雅思卡片同名只是巧合，3D建模 & 3D打印 这个名字则两处都不一样。
 * 硬合成一张表，就要在每行里重复一份导语与小节，改一次要改 N 处。
 */
export type SiteContent = {
  coursePage: SiteCoursePage;
  /**
   * 教师页的标题区。
   *
   * 只存标题（eyebrow / title / description）—— 教师**本人**的资料在 `teachers` 表里。
   * 之所以连标题也搬进来：网站"以后端为准"时，课程页与教师页的标题如果还留在模版里，
   * 那两页就会变成"标题来自文件、内容来自库"的半截状态，改一次要跑两个地方。
   * （首页 / 关于 / 联系我们 这些页的标题仍来自模版 —— 它们不在这次的范围里。）
   */
  teacherPage: SiteTeacherPage;
  /**
   * 报价页的**短字段**（按钮文字、提示语这类文案）。
   *
   * 价格数字不在这里：它们本来就是库里的 `pricing` 配置（能算钱、后台可改）。
   * 分开存是因为两者的修改频率与责任不同 —— 改价要慎重，改提示语随手就改。
   */
  pricingPage: SitePricingPage;
};

/** 报价页的文案（对应内容文件里「页面: 智能报价」的短字段）。 */
export type SitePricingPage = {
  labels: SitePricingLabels;
};

/** 报价页用到的短字段（键名与网站侧 `PricingData.labels` 一一对应）。 */
export type SitePricingLabels = {
  result: string;
  submit: string;
  reset: string;
  unitPriceLabel: string;
  unit: string;
  totalLabel: string;
  formulaNote: string;
  calculatorTitle: string;
  calculatorHint: string;
  otherTitle: string;
  lessonsLabel: string;
  lessonsHint: string;
  durationLabel: string;
  classSizeLabel: string;
  classCostLabel: string;
  classCostHint: string;
};

/** 网站「课程」页的正文：页面标题 + 学科（含学段小节）+ 选修课父分组名。 */
export type SiteCoursePage = {
  /** 页面标题区（eyebrow / title / description）。 */
  heading: SiteHeading;
  /** 学科分组，按 `order` 升序显示。 */
  subjects: SiteSubject[];
  /**
   * 选修课的父分组名（内容文件里是「成人课程」）。
   *
   * 选修课本身**不在这里**：它们是课程库里的行（`siteKind: "选修"`），
   * 免得同一门课在库里存两份、改一处忘一处。
   */
  electiveTitle: string;
};

/** 网站「教师」页的标题区。 */
export type SiteTeacherPage = {
  heading: SiteHeading;
};

/** 页面上的一个标题区（三个短字段）。 */
export type SiteHeading = {
  eyebrow: string;
  title: string;
  description: string;
};

/**
 * 一个学科分组（语文 / 数学 / … / 3D建模 & 3D打印）。
 *
 * 学科是**正文容器**：它的正文由若干「学段小节」组成，
 * 卡片上的标签（学考 / 选考 / A1）指的就是这些小节的锚点。
 */
export type SiteSubject = {
  id: string;
  /** 学科名（也是课程页详情区里的分组名）。 */
  name: string;
  /** 分组导语（`### 语文` 与第一个小节之间的文字）；多数为空。 */
  lead: string;
  /** 整组暂未开放（3D建模 & 3D打印、编程与信息素养）。 */
  unavailable: boolean;
  /** 显示顺序（越小越靠前）。 */
  order: number;
  /** 学段小节；语言类课程（雅思 / 法语…）也有，按级别分。 */
  bands: SiteBand[];
};

/**
 * 一个学段小节。
 *
 * 标题里可以带导语（`初中数学｜建立数学模型`）：竖线之后的文字由网站自己拆出来，
 * 因此**只存标题全文**，不额外存一份导语 —— 存两份就会出现"标题改了、导语没改"。
 */
export type SiteBand = {
  id: string;
  /** 小节标题全文；`｜` 之后的部分是导语。 */
  title: string;
  /** 正文（Markdown，含「核心能力」列表）。 */
  body: string;
};

/** 学生档案。 */
export type Student = {
  id: string;
  /**
   * 记录级版本号（v17 起）：口径与取舍见 `lib/backend/concurrency.ts`。
   *
   * ## 哪些实体有它、哪些没有（以及为什么）
   *
   * 判据是「这条记录会不会被一个**先读出来 → 人改 → 整份提交**的表单写」：
   *
   * | 实体 | 有版本？ | 为什么 |
   * | --- | --- | --- |
   * | `Student` | ✅ | 信息采集表**整份覆盖** `profile`（后交的把前一个人填的整块盖掉）、学生档案表单整份提交 |
   * | `Teacher` | ✅ | 教师表单一次交上来十来个字段（资料 / 网站展示 / 顺序 / 可带科目） |
   * | `Course` | ✅ | 课程表单整份提交（名字 / 分类 / 班型 / 状态 / 网站卡片字段） |
   * | `Classroom` | ✅ | 教室表单连**可用时段**一起交 —— 而它直接决定排课冲突判定 |
   * | `Lesson` | ✅ | 排课表单整份覆盖时间 / 教师 / 教室 / 学生 |
   * | `Enrollment` | ❌（见下） | 它是 `Student.enrollments` 里的**数组元素**，位置靠 `id` 在数组里现找；而且真正被整份覆盖的表单是"学生"这条记录本身 —— **学生版本号已经覆盖它了**（报课 / 续费 / 退课 / 调整都会推学生的版本）。给它单独加版本号，就要在每条写入口同时维护两个版本号，多一处会对不上的口径 |
   * | `LessonRecord` | ❌ | 按「课节 + 学生」upsert，没有"读出来改再整份交"的长时间编辑；重复保存就是覆盖（本来就是最后填写的人说了算） |
   * | `HomeworkRecord` / `Assessment` | ❌ | 按次追加的记录（一次作业 / 一次测评），页面是"再记一条"而不是"改这一条" |
   * | `Payment` / `LessonTransaction` | ❌ | **账本**：只追加、只能整条撤销（`reversedAt`），不允许改写已发生的钱与课时 |
   * | `Inquiry` | ❌ | 咨询线索是"还没落定的口头咨询"，改它不会毁掉别人一份已成立的档案；判定与安排走的是业务动作而不是整份覆盖表单 |
   * | `OperationLog` | ❌ | 只追加的审计记录 |
   * | `pricing` / `siteContent` | ❌ **已知缺口** | 它们是**单份配置**（不是记录集合），同样有"两个人同时改价格"的风险，但给它们加版本号要单独一套（配置没有 `id`、也不是数组里的一条），因此这一轮**没做**。边界写在 `docs/后端开发方案.md` §7 的边界表里，不假装已经盖住 |
   */
  version: number;
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

/**
 * 改报课的入参（v16 起）。
 *
 * ## 能改什么、不能改什么
 *
 * 能改：**班型 / 指定教师 / 单价 / 约定应缴 / 备注**。
 * 不能改：**科目**与**课时数** ——
 *   - 科目是"这节课扣哪条报课"的匹配键（`enrollmentForLesson` 按科目名找），改了它，
 *     已排的课与账本里的流水会找不到这条报课，扣课时静默跳过；报错了科目请「退课」后重报；
 *   - 课时数只走「续费 / 调整」，那两条会写课时流水，账才对得上。
 */
export type EnrollmentEdit = {
  form?: string;
  teacherId?: string;
  unitPrice?: number;
  agreedAmount?: number;
  note?: string;
};

/**
 * 改动的影响范围（**像手机日历改日程那样**）。
 *
 *   - `"enrollment"`：只改这条报课记录，已排的课一节都不动；
 *   - `"future-lessons"`：连**后续还没上的**课一起改（换教师、换班型通常要这样）。
 *
 * 两种范围都**绝不碰过去**：已上的课与时间已过的课一律不动 ——
 * 那是发生过的事实，改了它账就对不上（老师、班型、课时都对不上）。
 */
export type EnrollmentEditScope = "enrollment" | "future-lessons";

/** 改报课的结果：改了记录，以及顺带改 / 跳过 / 没动的课。 */
export type EnrollmentEditResult = {
  student: Student | null;
  /** 这条报课改了什么（人话，界面直接显示）。 */
  changes: string[];
  /** 跟着改掉的课节（数量与时间，用于"改了哪几节"的确认）。 */
  updatedLessons: Array<{ id: string; startsAt: string }>;
  /**
   * 跳过的课：每一条都带原因 ——
   * 与新的教师/教室撞课、教师不带这个科目、时间已过…都在这里如实说明。
   */
  skippedLessons: Array<{ id: string; startsAt: string; reason: string }>;
  /** 时间已过、按规矩不动的课（用来回答"为什么这几节没跟着改"）。 */
  pastLessons: number;
};

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
/** 教师档案的来源：网站同步进来 / 后台自己建的（与课程 origin 同一套口径）。 */
export type TeacherOrigin = "网站" | "后台";

/**
 * 教师档案的**类型**。
 *
 * `AI` = 网站上的 AI 智能体（如「采苓 · 试课诊断」）：它们是**辅助工具**，
 * 做试课诊断与学习跟踪，不授课 —— 因此**不出现在排课下拉里**（见 `teachers.listActive`），
 * 但保留在档案里（机构要能看到"我们有哪些工具在服务学生"）。
 */
export type TeacherKind = "教师" | "AI";

export type Teacher = {
  id: string;
  /** 记录级版本号（v17 起）：教师表单整份覆盖这条记录，因此必须受乐观锁保护。 */
  version: number;
  name: string;
  /** 可带科目，与课程页的科目叫法保持一致。 */
  subjects: string[];
  /** 职务，例如「全科教师」「晚辅导老师」。 */
  role: string;
  phone: string;
  /** 是否在职；离职教师保留档案但不在排课里出现。 */
  active: boolean;
  /**
   * 以下四项是**教师资料**（v13 起）：从网站教师页导入，或在后台手填。
   * 加它们的原因：网站的教师页有完整的介绍（教龄、一句话简介、详细 bio），
   * 而这些信息在后台原本无处存放 —— 只能挂在网站文件里，后台看不见也搜不到。
   */
  /** 教龄，例如「5 年」（自由文本：网站上是「5 年」「10 年」这类）。 */
  years: string;
  /** 一句话简介（列表里显示）。 */
  summary: string;
  /** 详细介绍（多段文本，来自网站教师页）。 */
  bio: string;
  /**
   * 推荐理由（v14 起）：网站上「为什么推荐这位教师」的一句话。
   *
   * 与 `summary` 分开是有原因的：`summary` 是**这位教师是谁**（教什么、什么风格），
   * 推荐理由是**为什么选他**（机构对家长的推荐话术）。合成一个字段，
   * 网站教师卡片与首页推荐位就没法各说各的。
   */
  recommendation: string;
  /**
   * **是否在宣传网站上展示**（v16 起）。
   *
   * 为什么需要它：后台的教师档案里有两类人 —— 一类是"网站上已经公开的那几位"，
   * 另一类是机构自己录的内部老师（排课要用、但没打算放到宣传页上）。
   * 网站改成"以后端为准"之后，如果不加这个开关，**一次构站就会把内部老师的档案
   * （真名、没有简介）直接放到宣传页上** —— 这是真实会发生的意外，不是假想。
   *
   * 默认口径：网站内容导入进来的（`origin: "网站"`）默认展示，后台手建的默认不展示。
   * 想放上去就在教师表单里勾一下。
   */
  siteVisible: boolean;
  /**
   * 网站教师页的显示顺序（v14 起）：越小越靠前，未填按 999 排在最后。
   *
   * 用数字而不是数组下标：数组下标会让「重新排序」变成整表重写，
   * 而且导出/导入时顺序信息会丢（JSON 数组顺序不可靠）。
   */
  order: number;
  origin: TeacherOrigin;
  kind: TeacherKind;
};

export const TEACHER_ORIGINS = ["网站", "后台"] as const;
export const TEACHER_KINDS = ["教师", "AI"] as const;

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
  /** 记录级版本号（v17 起）：教室表单整份覆盖（含可用时段），改动会影响排课冲突判定。 */
  version: number;
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
  /**
   * 记录级版本号（v17 起）：排课表单整份覆盖时间 / 教师 / 教室 / 学生，
   * 而"这节课到底排给谁"正是最不能被人静默改掉的东西。
   */
  version: number;
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
   * **网站内容**（v15 起）：宣传网站上那些不是业务数据、但要能改的正文。
   *
   * 目前只有「课程页」一块：学科的导语与各学段小节的正文（语文 → 小学语文…）。
   * 卡片由 `courses` 提供，报价由 `pricing` 提供 —— 这里只放还没别处可放的正文。
   */
  siteContent: SiteContent;
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

/**
 * 建档时**一并报课**的入参（一个学生可以报多门，每门课时数各自独立）。
 *
 * 为什么允许在建档时一起报：家长来报名时说的就是「数学 10 节、英语 20 节」，
 * 先建档再逐门点「报课」会让人重复劳动，而且中途关掉页面就会留下
 * 「有档案、没课时」的半成品 —— 那种学生排课时会莫名其妙排不进去。
 *
 * 与 `NewEnrollment` 的区别只有一处：**全部字段可省**（有默认值），
 * 因为建档表单上只想问「科目 + 节数」这两个必答项。
 */
export type NewStudentEnrollment = {
  subject: string;
  /** 这门课买的节数（必填，> 0）。 */
  lessons: number;
  /** 班型；留空表示还没定，之后再改。 */
  form?: string;
  teacherId?: string;
  /** 标价单价（元 / 节）；建档时通常留空，钱到「收款」里再记。 */
  unitPrice?: number;
  agreedAmount?: number;
  paidNow?: number;
  method?: PaymentMethod;
  /** 开课日期（ISO）；留空表示就是今天。 */
  startedAt?: string;
  note?: string;
};

/**
 * 新建时的入参：id、报课集合与时间戳由服务生成。
 *
 * `enrollments` 是**建档时一并报课**（见 `NewStudentEnrollment`）：
 * 传了就顺手把报课记录建好（一次落盘、一条日志），不传就是只建档。
 *
 * `version` 与 `id` 同级**由服务端管**（新建一律从 1 开始），调用方传什么都不作数 ——
 * 与 id 同理：让调用方填版本号，就会出现"第一条记录从 37 开始"这种没人解释得清的数据。
 */
export type NewStudent = Omit<
  Student,
  "id" | "createdAt" | "enrollments" | "subjects" | "version"
> & {
  subjects?: string[];
  enrollments?: NewStudentEnrollment[];
};
export type NewTeacher = Omit<Teacher, "id" | "version">;
export type NewClassroom = Omit<Classroom, "id" | "version">;
export type NewLesson = Omit<Lesson, "id" | "version">;

import type { StudentProfile } from "./student-profile";

/** 今日概览的汇总数据。 */
export type TodaySummary = {
  date: string;
  /** 有效的课次（**不含已取消的课**，口径见 `lib/backend/lesson-stats.ts`）。 */
  lessonCount: number;
  /** 这天被取消了几节（单独给一个数，而不是混进 lessonCount）。 */
  cancelledLessonCount: number;
  /** 今天有课的教师数。 */
  teacherCount: number;
  /** 今天的课时总时长（分钟）。 */
  totalMinutes: number;
  /** 教室占用：教室 + 今天的课次。 */
  classroomUsage: Array<{ classroom: Classroom; lessonCount: number }>;
  /** 课时不足的学生（剩余课时 ≤ 阈值）。 */
  /**
   * 低课时预警的学生。
   *
   * `remainingLessons` 是**剩余最少的那一门**（不是合计）——排课受单科限制：
   * 数学只剩 3 节就排不了第 4 节数学课。合计在 `totalRemaining` 里，
   * `weakSubject` 说明是哪一门，界面上两个数都显示出来（审计之后统一的：与「待跟进」同一份判定）。
   */
  lowLessonStudents: Array<{
    student: Student;
    remainingLessons: number;
    totalRemaining: number;
    weakSubject: string;
  }>;
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
  /**
   * 扣课时后发现"超用"的学生（已用 > 购买）。
   *
   * 排课时已经按"课时够不够"先拦了一道，这里留一条兜底上报：**任何超用都必须说出来**。
   * 否则会出现"剩余课时显示 0"这种看不出欠账的状态 —— 机构就白送了课时。
   */
  overused: Array<{ studentId: string; name: string; subject: string; over: number }>;
};
