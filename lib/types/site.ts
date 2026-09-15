/**
 * 站点内容类型定义。
 *
 * 类型对应 data/site/*.md 的数据结构：frontmatter 提供短字段，
 * 正文的 `## 名称` 小节提供列表项（课程、教师、特色、数据等）。
 *
 * 未来接入数据库时，可以保留「内容块」这一层，与 Student / Teacher 等
 * 业务实体表并列存在。
 */

/** 全站品牌与联系方式（data/site/site.md） */
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
  placeholder: boolean;
};

export type ContactInfo = {
  phone: string;
  wechat: string;
  email: string;
  address: string;
  businessHours: string;
  placeholder: boolean;
};

/** 「标题 | 说明」形式的通用条目。 */
export type LabeledItem = {
  title: string;
  value: string;
};

/** 首页内容（data/site/home.md） */
export type HomeContent = {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  stats: LabeledItem[];
  features: LabeledItem[];
  courses: LabeledItem[];
  classrooms: LabeledItem[];
  cta: { title: string; description: string; label: string; href: string };
  placeholder: boolean;
};

/** 区块标题（首页各区块共用）。 */
export type SectionHeading = {
  eyebrow: string;
  title: string;
  description: string;
};

/** 课程（data/site/courses.md 中一个 `## 课程名` 小节） */
export type Course = {
  id: string;
  nameZh: string;
  /** 正文原文（Markdown）。 */
  content: string;
  placeholder: boolean;
};

/** 教师（data/site/teachers.md 中一个 `## 姓名` 小节） */
export type Teacher = {
  id: string;
  name: string;
  role: string;
  subjects: string[];
  years: string;
  summary: string;
  /** 字段之外的自由介绍（Markdown 原文）。 */
  bio: string;
  placeholder: boolean;
};

/** 关于我们（data/site/about.md） */
export type AboutContent = {
  eyebrow: string;
  title: string;
  description: string;
  philosophy: SectionHeading;
  campusTitle: string;
  principles: LabeledItem[];
  facts: LabeledItem[];
  campusParagraphs: string[];
  placeholder: boolean;
};

/** 联系我们（data/site/contact.md） */
export type ContactContent = {
  eyebrow: string;
  title: string;
  description: string;
  methods: LabeledItem[];
  routeTitle: string;
  routeDescription: string;
  routeParagraph: string;
  disabledActionLabel: string;
  placeholder: boolean;
};
