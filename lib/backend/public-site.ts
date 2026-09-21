/**
 * **公开给宣传网站的只读数据**（字段白名单）。
 *
 * ## 为什么要单独一个模块
 *
 * 网站（GitHub Pages 之外的部署、或本地开发）在**构站那一刻**要问后端一句
 * "你的教师 / 课程 / 课程正文 / 报价是什么"。这个请求是**匿名**的 ——
 * 访客的浏览器、CI 机器人都能拿到，因此：
 *
 *   1. **按字段白名单构造**（而不是"把对象丢出去再挑着删"）：新增字段时忘了删，
 *      漏出去的是真数据；这里新增字段必须显式写一行，忘了就是没给出去 ——
 *      失败方向是安全的那个。
 *   2. **绝不出门**：学生与家长联系方式、收款与金额、操作日志、咨询线索、
 *      教师联系方式（电话）、教师课时费分成（内部成本口径）都不在其中。
 *   3. 只给**对外公开**的东西：教师介绍、课程与栏目、课程页正文、报价。
 *
 * `scripts/check.mts` 里有一组断言专门盯着这条边界（含"字段名里不能出现
 * 敏感词"的扫描），改这个文件时必须一起看。
 */

import type {
  PricingClassType,
  PricingDuration,
  PricingOtherItem,
  PricingRules,
  PricingStage,
  PricingSubject,
  PricingTrial,
} from "./pricing";
import type { Course, CourseTag, Database, SiteContent, Teacher } from "./types";

/** 公开的教师资料（**不含电话**）。 */
export type PublicTeacher = {
  name: string;
  role: string;
  subjects: string[];
  years: string;
  summary: string;
  bio: string;
  recommendation: string;
  order: number;
  kind: Teacher["kind"];
  active: boolean;
  /** 是否在宣传网站上展示（网站据此过滤，见 `Teacher.siteVisible`）。 */
  siteVisible: boolean;
};

/** 公开的课程（网站卡片所需的全部字段）。 */
export type PublicCourse = {
  name: string;
  category: string;
  forms: string[];
  status: Course["status"];
  path: string;
  subgroup: string;
  tags: CourseTag[];
  target: string;
  order: number;
  intro: string;
  siteKind: Course["siteKind"];
};

/**
 * 公开的报价配置。
 *
 * 刻意**不含 `teacherShare`**：教师课时费是机构的成本口径，属于内部数据。
 * 宣传网站上没有任何地方需要它，因此这里不给 —— 后来的人想加，请先想清楚
 * "上网的人拿它做什么"。
 */
export type PublicPricing = {
  rules: PricingRules;
  stages: PricingStage[];
  subjects: PricingSubject[];
  classTypes: PricingClassType[];
  durations: PricingDuration[];
  trial: PricingTrial | null;
  otherItems: PricingOtherItem[];
};

/** 公开数据整体（网站构站时拿到的就是这一份）。 */
export type PublicSite = {
  /** 数据格式版本：网站那侧据此判断"这份数据我读得懂吗"。 */
  version: number;
  /** 生成时间（ISO）：排查"网站为什么是旧内容"时第一眼看它。 */
  generatedAt: string;
  teachers: PublicTeacher[];
  courses: PublicCourse[];
  siteContent: SiteContent;
  pricing: PublicPricing;
};

/** 教师：只保留对外公开的字段（电话等一律不出门）。 */
function publicTeacher(teacher: Teacher): PublicTeacher {
  return {
    name: teacher.name,
    role: teacher.role,
    subjects: teacher.subjects,
    years: teacher.years,
    summary: teacher.summary,
    bio: teacher.bio,
    recommendation: teacher.recommendation,
    order: teacher.order,
    kind: teacher.kind,
    active: teacher.active,
    siteVisible: teacher.siteVisible,
  };
}

/** 课程：卡片所需的全部字段（备注 `note` 是内部备注，不公开）。 */
function publicCourse(course: Course): PublicCourse {
  return {
    name: course.name,
    category: course.category,
    forms: course.forms,
    status: course.status,
    path: course.path,
    subgroup: course.subgroup,
    tags: course.tags.map((tag) => ({ label: tag.label, target: tag.target })),
    target: course.target,
    order: course.order,
    intro: course.intro,
    siteKind: course.siteKind,
  };
}

/** 组装公开数据。 */
export function publicSite(db: Database): PublicSite {
  return {
    version: db.version,
    generatedAt: new Date().toISOString(),
    // 离职教师也带上（`active: false`）：网站那侧要按它过滤，
    // 而不是让后端替网站决定"哪些人该出现" —— 双方口径才会一致。
    teachers: db.teachers.map(publicTeacher),
    courses: db.courses.map(publicCourse),
    siteContent: {
      coursePage: db.siteContent.coursePage,
      teacherPage: db.siteContent.teacherPage,
      pricingPage: db.siteContent.pricingPage,
    },
    pricing: {
      rules: db.pricing.rules,
      stages: db.pricing.stages,
      subjects: db.pricing.subjects,
      classTypes: db.pricing.classTypes,
      durations: db.pricing.durations,
      trial: db.pricing.trial,
      otherItems: db.pricing.otherItems,
    },
  };
}
