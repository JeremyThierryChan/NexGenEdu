/**
 * 站点内容类型定义。
 *
 * 类型对应 data/site/*.md 的数据结构：frontmatter 提供短字段，
 * 正文的 `## 名称` 小节提供列表项（课程、教师、特色、数据等）。
 *
 * 未来接入数据库时，可以保留「内容块」这一层，与 Student / Teacher 等
 * 业务实体表并列存在。
 */

/** 全站品牌与联系方式（content.md 的「页面: 全站」段） */
export type SiteBrand = {
  brandName: string;
  brandNameZh: string;
  tagline: string;
  description: string;
  copyrightHolder: string;
  keywords: string[];
  contact: ContactInfo;
  /** 首页 <title> 使用的页面标题。 */
  homeTitle: string;
  /** 页面标题模板中的机构名，例如「NexGenEdu 新锐教培」。 */
  titleSuffix: string;
};

export type ContactInfo = {
  phone: string;
  wechat: string;
  email: string;
  address: string;
  businessHours: string;
};

/** 「标题 | 说明」形式的通用条目。 */
export type LabeledItem = {
  title: string;
  value: string;
};

/** 首页内容（content.md 的「页面: 首页」段） */
export type HomeContent = {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  stats: LabeledItem[];
  features: LabeledItem[];
  /** 首页课程卡片：按栏目分组，每张卡片含若干可点击标签。 */
  courses: CourseCardItem[];
  classrooms: LabeledItem[];
  /** 试课体验区块。 */
  trial: {
    eyebrow: string;
    title: string;
    description: string;
    points: string[];
    cta: { label: string; href: string };
  };
  /** 学生案例入口区块。 */
  cases: {
    eyebrow: string;
    title: string;
    description: string;
    cta: { label: string; href: string };
  };
  cta: { title: string; description: string; label: string; href: string };
};

/** 首页课程卡片的一张卡片。 */
export type CourseCardItem = {
  /** 栏目名（小学课内 / 初中课内 / 高中课内 / 外语 / 课外兴趣 / 成人课程）。 */
  group: string;
  /** 卡片标题；标签只有一个时可留空，此时以标签作为标题。 */
  title: string;
  /** 卡片上的标签；每个标签可点，标签文字与跳转目标分开存。 */
  tags: Array<{ label: string; target: string }>;
};

/** 区块标题（首页各区块共用）。 */
export type SectionHeading = {
  eyebrow: string;
  title: string;
  description: string;
};

/** 课程（content.md 的「页面: 课程」段中一个分组） */
/**
 * 选修类课程（成人课程 / 课外兴趣）。
 *
 * 与学科课程不同：没有学段划分，只有名称、一句话介绍与开放状态。
 * 状态为「暂未开放」时页面显示标记，供家长了解后续会开设哪些课。
 */
export type ElectiveCourse = {
  id: string;
  name: string;
  /** 一句话介绍（取该分组下的正文）。 */
  description: string;
  /** 所属栏目（外语 / 课外兴趣 / 成人课程）。 */
  group: string;
  /** 是否已开放报名。 */
  available: boolean;
};

/** 课程下的一个学段小节（`#### 学段｜一句话` + 正文）。 */
export type CourseBand = {
  /** 小节标题，例如「小学数学｜建立数学基础」。 */
  title: string;
  /** 小节正文（Markdown）。 */
  content: string;
};

export type Course = {
  id: string;
  nameZh: string;
  /** 导语：`### 课程名` 与第一个 `#### 学段` 之间的文字（Markdown）。 */
  lead: string;
  /** 学段小节。语言类课程（雅思 / 法语等）没有小节，此时为空数组。 */
  bands: CourseBand[];
};

/** 教师（content.md 的「页面: 教师」段中一个分组） */
/**
 * 教学角色类型：
 *   teacher —— 真人授课教师
 *   ai      —— AI 智能体（辅助诊断与跟踪，不授课）
 * 卡片上会据此显示「AI 智能体」标记，避免家长误认为是真人教师。
 */
export type TeacherKind = "teacher" | "ai";

export type Teacher = {
  id: string;
  /** 角色类型，默认 teacher。 */
  kind: TeacherKind;
  name: string;
  role: string;
  subjects: string[];
  years: string;
  summary: string;
  /** 推荐理由：一句话说明为什么推荐这位教师，显示在卡片与详情页。 */
  recommendation: string;
  /** 展示顺序，越小越靠前；未填写时排在最后。 */
  order: number;
  /** 在职状态：填「离职」则保留资料但不在页面展示。 */
  active: boolean;
  /** 字段之外的自由介绍（Markdown 原文）。 */
  bio: string;
};

/** 关于我们（content.md 的「页面: 关于」段） */
export type AboutContent = {
  eyebrow: string;
  title: string;
  description: string;
  philosophy: SectionHeading;
  /** 服务形式区块标题与条目。 */
  serviceTitle: string;
  services: LabeledItem[];
  campusTitle: string;
  principles: LabeledItem[];
  facts: LabeledItem[];
  campusParagraphs: string[];
};

/** 联系我们（content.md 的「页面: 联系我们」段） */
export type ContactContent = {
  eyebrow: string;
  title: string;
  description: string;
  methods: LabeledItem[];
  routeTitle: string;
  routeDescription: string;
  routeParagraph: string;
  disabledActionLabel: string;
};

// ── 学生案例 / 常见问题 / 课程时间安排 ────────────────────────────────────────

/** 通用信息分组：标题 + 若干「名称 | 内容」条目。 */
export type InfoGroup = {
  title: string;
  note: string;
  items: LabeledItem[];
};

/** 页面公共头部字段。 */
export type PageIntro = {
  eyebrow: string;
  title: string;
  description: string;
  /** 页面底部的说明文字，留空则不显示。 */
  notice: string;
};

/** 常见问题：按分组归类的问答。 */
export type FaqGroup = {
  title: string;
  items: Array<{ question: string; answer: string }>;
};

export type FaqContent = PageIntro & {
  groups: FaqGroup[];
  /** 问题总数，用于页面提示。 */
  count: number;
};

/** 一个学生案例。 */
export type CaseItem = {
  id: string;
  /** 案例标题，形如「初二 李同学｜数学从 62 分到 91 分」。 */
  title: string;
  /** 案例的关键字段（年级、科目、入学/当前水平、辅导周期、主要问题）。 */
  fields: LabeledItem[];
  /** 入学水平，用于顶部前后对比展示。 */
  from: string;
  /** 当前水平，用于顶部前后对比展示。 */
  to: string;
  /** 过程描述（Markdown 原文）。 */
  story: string;
};

export type CasesContent = PageIntro & {
  cases: CaseItem[];
};

export type ScheduleContent = PageIntro & {
  groups: InfoGroup[];
};

// ── 特色课程（含层级与独立页面） ──────────────────────────────────────────────

/**
 * 一门特色课程。
 * 层级由数据文件的标题层级决定，children 是下一级课程。
 */
export type CourseDetail = {
  /** 本级的课程名，同时作为路径分段。 */
  slug: string;
  /** 从根到本课程的完整路径分段，例如 ["课内辅导", "一对多小班课", "精品小升初"]。 */
  path: string[];
  name: string;
  /** 课程描述字段（适合对象 / 课程定位 / 主要做法 / 可以期待）。 */
  fields: LabeledItem[];
  /** 详细介绍（Markdown 原文）。 */
  body: string;
  children: CourseDetail[];
};

export type FeaturedContent = PageIntro & {
  courses: CourseDetail[];
};
